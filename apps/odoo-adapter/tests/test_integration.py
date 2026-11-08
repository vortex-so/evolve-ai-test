from __future__ import annotations

from typing import Any

import pytest
from mcp.types import CallToolResult

from .conftest import make_assertion, mcp_session
from .fakes import FakeAuthServer, FakeOdooServer
from .native_contract import real_http_tool_call, real_http_tool_result


def payload(result: CallToolResult) -> dict[str, Any]:
    assert result.is_error is False
    assert isinstance(result.structured_content, dict)
    structured = result.structured_content
    nested = structured.get("result")
    if set(structured) == {"result"} and isinstance(nested, dict):
        return nested
    return structured


@pytest.mark.asyncio
async def test_test_route_authenticates_without_model_access(
    adapter_app: Any,
    signing_keys: tuple[str, str],
    fake_odoo: FakeOdooServer,
    fake_auth: FakeAuthServer,
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(
        private_key,
        purpose="test",
        server="odoo_test",
        actor_id="admin-1",
    )
    async with mcp_session(adapter_app, "/test/mcp", assertion) as session:
        listed = await session.list_tools()
        assert [tool.name for tool in listed.tools] == ["test_connection"]
        result = payload(await session.call_tool("test_connection", {}))
        assert result == {"ok": True, "uid": 11}
    assert fake_odoo.state.writes == []
    assert fake_auth.audits[-2:] == [
        {"tool": "test_connection", "outcome": "started"},
        {"tool": "test_connection", "outcome": "success"},
    ]


@pytest.mark.asyncio
async def test_first_connection_test_accepts_null_uid_but_normal_mcp_denies(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
) -> None:
    private_key, _ = signing_keys
    native_fake_auth.connections["user-alice"].odoo_uid = None
    tested = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(
            private_key,
            purpose="test",
            server="odoo_test",
            actor_id="admin-1",
            jti="first-test-null-uid",
        ),
        "test_connection",
        {},
        path="/test/mcp",
    )
    assert tested == {"ok": True, "uid": 11}

    normal = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="normal-null-uid"),
        "search_records",
        {"model": "res.partner", "domain": []},
    )
    assert normal["isError"] is True
    assert "tested Odoo UID" in str(normal["structuredContent"])


@pytest.mark.asyncio
async def test_connection_test_rejects_existing_uid_mismatch(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
) -> None:
    private_key, _ = signing_keys
    native_fake_auth.connections["user-alice"].odoo_uid = 999
    result = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(
            private_key,
            purpose="test",
            server="odoo_test",
            actor_id="admin-1",
            jti="first-test-mismatch",
        ),
        "test_connection",
        {},
        path="/test/mcp",
    )
    assert result["isError"] is True
    assert "does not match connection owner" in str(result["structuredContent"])


@pytest.mark.asyncio
async def test_S1_native_v2_policy_resolves_without_legacy_project_fields(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    result = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(
            private_key,
            purpose="test",
            server="odoo_test",
            actor_id="admin-1",
            jti="s1-native-policy-test",
        ),
        "test_connection",
        {},
        path="/test/mcp",
    )
    assert result == {"ok": True, "uid": 11}


def _native_write_arguments(name: str) -> dict[str, Any]:
    return {
        "model": "res.partner",
        "operation": "write",
        "record_ids": [10],
        "values": {"name": name},
    }


@pytest.mark.asyncio
async def test_S2_nonproject_rbac(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    alice = make_assertion(private_key, jti="s2-alice-partners")
    bob = make_assertion(
        private_key,
        sub="user-bob",
        connection_id="conn-bob",
        jti="s2-bob-partners",
    )
    arguments = {
        "model": "res.partner",
        "domain": [],
        "fields": ["id", "name", "email"],
        "limit": 10,
        "order": "id asc",
    }
    alice_result = await real_http_tool_call(
        real_native_adapter_url, alice, "search_records", arguments
    )
    bob_result = await real_http_tool_call(
        real_native_adapter_url, bob, "search_records", arguments
    )
    assert alice_result["success"] is True
    assert bob_result["success"] is True
    assert alice_result["result"] == [
        {"id": 10, "name": "Alice Partner", "email": "alice.partner@example.com"}
    ]
    assert bob_result["result"] == [
        {"id": 20, "name": "Bob Partner", "email": "bob.partner@example.com"}
    ]


@pytest.mark.asyncio
async def test_S3_confirmation_lifecycle_across_distinct_http_sessions(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
    fake_odoo: FakeOdooServer,
) -> None:
    private_key, _ = signing_keys
    arguments = _native_write_arguments("Alice Partner Approved")
    preview = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-preview"),
        "preview_write",
        arguments,
    )
    validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-validate"),
        "validate_write",
        arguments,
    )
    assert preview["approval"]["token"] == validated["approval"]["token"]
    assert validated["approval_status"]["stored"] is True

    executed = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-execute"),
        "execute_approved_write",
        {"approval": validated["approval"], "confirm": True},
    )
    assert executed == {
        "success": True,
        "tool": "execute_approved_write",
        "model": "res.partner",
        "operation": "write",
        "result": True,
        "instance": "default",
    }
    assert fake_odoo.state.partners[10]["name"] == "Alice Partner Approved"
    assert [write for write in fake_odoo.state.writes if write.get("model") == "res.partner"] == [
        {
            "operation": "write",
            "model": "res.partner",
            "id": 10,
            "values": {"name": "Alice Partner Approved"},
        }
    ]
    assert native_fake_auth.approvals == {}
    assert native_fake_auth.completions == []


@pytest.mark.asyncio
async def test_S3_confirm_false_and_writes_off_deny_without_mutation(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
    fake_odoo: FakeOdooServer,
) -> None:
    private_key, _ = signing_keys
    arguments = _native_write_arguments("Must Not Persist")
    validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-deny-validate"),
        "validate_write",
        arguments,
    )
    declined = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-deny-confirm"),
        "execute_approved_write",
        {"approval": validated["approval"], "confirm": False},
    )
    assert declined["isError"] is False
    declined_payload = declined["structuredContent"]["result"]
    assert declined_payload["success"] is False
    assert "confirm=true" in declined_payload["error"]
    assert fake_odoo.state.writes == []

    native_fake_auth.connections["user-alice"].policy["enableWrites"] = False
    writes_off_arguments = _native_write_arguments("Writes Off")
    writes_off_validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-writes-off-validate"),
        "validate_write",
        writes_off_arguments,
    )
    writes_off = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s3-deny-writes-off"),
        "execute_approved_write",
        {"approval": writes_off_validated["approval"], "confirm": True},
    )
    assert writes_off["isError"] is False
    writes_off_payload = writes_off["structuredContent"]["result"]
    assert writes_off_payload["success"] is False
    assert "write execution disabled" in writes_off_payload["error"]
    assert fake_odoo.state.writes == []
