from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx2 as httpx
import jwt
import pytest

from odoo_adapter.worker import MutationOutcomeUnknown

from .conftest import make_assertion, mcp_session
from .fakes import FakeAuthServer, FakeOdooServer
from .native_contract import real_http_tool_call, real_http_tool_result


def is_error(result: Any, text: str | None = None) -> None:
    assert result.is_error is True
    if text is not None:
        assert text in json.dumps(result.structured_content)


@pytest.mark.asyncio
async def test_missing_identity_allows_discovery_but_denies_tool_call(
    adapter_app: Any,
) -> None:
    async with mcp_session(adapter_app, "/mcp") as session:
        listed = await session.list_tools()
        assert len(listed.tools) == 40
        is_error(
            await session.call_tool(
                "search_records", {"model": "res.partner", "domain": []}
            ),
            "identity assertion required",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"issued_at": int(time.time()) - 100, "expires_in": 30},
        {"audience": "wrong-audience"},
        {"issuer": "https://wrong.example"},
        {"server": "odoo_test"},
        {"purpose": "test", "server": "odoo_test", "actor_id": "admin-1"},
        {"actor_id": "admin-1"},
    ],
)
async def test_invalid_assertions_are_http_rejected(
    adapter_app: Any,
    signing_keys: tuple[str, str],
    overrides: dict[str, Any],
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key, **overrides)
    response = await _initialize(adapter_app, "/mcp", assertion)
    assert response.status_code == 401
    assert response.json() == {"error": "invalid_identity"}


@pytest.mark.asyncio
async def test_wrong_algorithm_is_rejected(
    adapter_app: Any,
) -> None:
    now = int(time.time())
    assertion = jwt.encode(
        {
            "sub": "user-alice",
            "connection_id": "conn-alice",
            "version": 1,
            "purpose": "mcp",
            "server": "odoo",
            "iat": now,
            "exp": now + 45,
            "jti": "wrong-alg",
            "iss": "https://api.auth-dev.vortex.so",
            "aud": "vortex-odoo-adapter",
        },
        "not-an-es256-key-not-an-es256-key",
        algorithm="HS256",
    )
    response = await _initialize(adapter_app, "/mcp", assertion)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_fresh_resolve_rejects_wrong_version_key_uid_and_legacy_policy(
    adapter_app: Any,
    signing_keys: tuple[str, str],
    fake_auth: FakeAuthServer,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key, version=2, jti="security-fresh-resolve")
    arguments = {"model": "res.partner", "domain": [], "fields": ["id"]}
    async with mcp_session(adapter_app, "/mcp", assertion) as session:
        is_error(await session.call_tool("search_records", arguments))

        connection = fake_auth.connections["user-alice"]
        connection.version = 2
        connection.api_key = "secret-wrong-key"
        bad_key = payload_result(await session.call_tool("search_records", arguments))
        assert bad_key["success"] is False
        captured = capsys.readouterr()
        assert "secret-wrong-key" not in captured.out + captured.err + caplog.text

        connection.api_key = "alice-key"
        connection.odoo_uid = 999
        bad_uid = payload_result(await session.call_tool("search_records", arguments))
        assert bad_uid["success"] is False

        connection.odoo_uid = 11
        connection.policy = {
            "readProjects": True,
            "readTasks": True,
            "createTasks": False,
            "updateTasks": False,
            "allowedProjectIds": [1],
            "writableFields": [],
        }
        is_error(await session.call_tool("search_records", arguments))


@pytest.mark.asyncio
async def test_backend_response_without_native_adapter_contract_fails_closed(
    adapter_app: Any,
    signing_keys: tuple[str, str],
    fake_auth: FakeAuthServer,
) -> None:
    private_key, _ = signing_keys
    fake_auth.native_policy = False
    assertion = make_assertion(private_key, jti="security-missing-contract")
    async with mcp_session(adapter_app, "/mcp", assertion) as session:
        result = await session.call_tool(
            "search_records", {"model": "res.partner", "domain": []}
        )
        is_error(result, "authorization service rejected")


@pytest.mark.asyncio
async def test_native_approval_replay_and_tamper_are_rejected(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    fake_odoo: FakeOdooServer,
) -> None:
    private_key, _ = signing_keys
    arguments = {
        "model": "res.partner",
        "operation": "write",
        "record_ids": [10],
        "values": {"name": "Executed Once"},
    }
    validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="security-replay-validate"),
        "validate_write",
        arguments,
    )
    approval = validated["approval"]
    first = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="security-replay-first"),
        "execute_approved_write",
        {"approval": approval, "confirm": True},
    )
    assert first["success"] is True
    replay = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="security-replay-second"),
        "execute_approved_write",
        {"approval": approval, "confirm": True},
    )
    _assert_native_denial(replay, "validated")
    assert len(fake_odoo.state.writes) == 1

    tampered = {**approval, "values": {"name": "Tampered"}}
    tamper_result = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="security-tamper"),
        "execute_approved_write",
        {"approval": tampered, "confirm": True},
    )
    _assert_native_denial(tamper_result, "token")
    assert len(fake_odoo.state.writes) == 1


@pytest.mark.asyncio
async def test_mutation_worker_failure_is_unknown_and_not_retried(
    adapter_app: Any,
    signing_keys: tuple[str, str],
    fake_odoo: FakeOdooServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key, jti="security-unknown-outcome")
    async with mcp_session(adapter_app, "/mcp", assertion) as session:
        validated = payload_result(
            await session.call_tool(
                "validate_write",
                {
                    "model": "res.partner",
                    "operation": "write",
                    "record_ids": [10],
                    "values": {"name": "Unknown"},
                },
            )
        )
        broker = adapter_app.state.policy_service._broker
        original = broker.call

        async def fail_mutation(*args: Any, **kwargs: Any) -> Any:
            if args[1] == "execute_approved_write":
                raise MutationOutcomeUnknown("worker crashed")
            return await original(*args, **kwargs)

        monkeypatch.setattr(broker, "call", fail_mutation)
        result = await session.call_tool(
            "execute_approved_write",
            {"approval": validated["approval"], "confirm": True},
        )
        is_error(result, "outcome is unknown")
    assert fake_odoo.state.writes == []


def payload_result(result: Any) -> dict[str, Any]:
    assert result.is_error is False
    structured = result.structured_content
    assert isinstance(structured, dict)
    nested = structured.get("result")
    return nested if set(structured) == {"result"} and isinstance(nested, dict) else structured


async def _initialize(app: Any, path: str, assertion: str) -> httpx.Response:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "security-test", "version": "1"},
        },
    }
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://adapter"
        ) as client,
    ):
        return await client.post(
            path,
            json=body,
            headers={
                "accept": "application/json, text/event-stream",
                "x-vortex-identity": f"Bearer {assertion}",
            },
        )


def _assert_native_denial(result: dict[str, Any], text: str) -> None:
    structured = result.get("structuredContent")
    assert isinstance(structured, dict), result
    nested = structured.get("result")
    payload = (
        nested
        if set(structured) == {"result"} and isinstance(nested, dict)
        else structured
    )
    assert text in json.dumps(payload)
    if result.get("isError") is not True:
        assert payload["success"] is False


@pytest.mark.asyncio
async def test_S4_exact_side_effect_methods_are_independent_of_enable_writes(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
    fake_odoo: FakeOdooServer,
) -> None:
    private_key, _ = signing_keys
    native_fake_auth.connections["user-alice"].policy["enableWrites"] = False
    allowed = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-side-effect-allowed"),
        "execute_method",
        {"model": "account.move", "method": "action_post", "args": [[1001]]},
    )
    assert allowed == {"success": True, "result": True}
    assert fake_odoo.state.account_moves[1001]["state"] == "posted"
    assert fake_odoo.state.side_effects == [
        {"model": "account.move", "method": "action_post", "id": 1001}
    ]

    unlisted = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-side-effect-unlisted"),
        "execute_method",
        {"model": "account.move", "method": "button_cancel", "args": [[1001]]},
    )
    _assert_native_denial(unlisted, "blocked")
    unknown = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-side-effect-unknown"),
        "execute_method",
        {"model": "account.move", "method": "totally_unknown", "args": [[1001]]},
    )
    _assert_native_denial(unknown, "blocked")
    direct_crud = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-direct-crud"),
        "execute_method",
        {"model": "res.partner", "method": "write", "args": [[10], {"name": "x"}]},
    )
    _assert_native_denial(direct_crud, "create/write/unlink")
    assert fake_odoo.state.writes == []


@pytest.mark.asyncio
async def test_S4_instance_only_and_async_local_scan_guard(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    instances = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-list-instances"),
        "list_instances",
        {},
    )
    assert instances["success"] is True
    assert instances["default"] == "default"
    assert instances["instance_count"] == 1
    assert [entry["name"] for entry in instances["instances"]] == ["default"]
    serialized = json.dumps(instances)
    assert "alice-key" not in serialized
    assert "alice@example.com" not in serialized

    other_instance = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-other-instance"),
        "search_records",
        {"model": "res.partner", "domain": [], "instance": "other"},
    )
    _assert_native_denial(other_instance, "instance")

    local_scan = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-local-scan"),
        "submit_async_task",
        {"operation": "scan_addons_source", "params": {}},
    )
    _assert_native_denial(local_scan, "scan_addons_source")

    submitted = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-data-quality-submit"),
        "submit_async_task",
        {
            "operation": "data_quality_report",
            "params": {
                "model": "res.partner",
                "checks": ["missing_required"],
                "sample_limit": 10,
            },
        },
    )
    assert submitted["success"] is True
    task_id = submitted["task_id"]
    completed: dict[str, Any] | None = None
    statuses: list[dict[str, Any]] = []
    for attempt in range(50):
        polled = await real_http_tool_call(
            real_native_adapter_url,
            make_assertion(private_key, jti=f"s4-data-quality-poll-{attempt}"),
            "get_async_task",
            {"task_id": task_id},
        )
        statuses.append(polled)
        if polled.get("status") in {"succeeded", "failed", "cancelled"}:
            completed = polled
            break
        await asyncio.sleep(0.05)
    assert completed is not None, statuses[-3:]
    assert completed["status"] == "succeeded"
    assert completed["result"]["success"] is True


@pytest.mark.asyncio
async def test_S4_cross_user_approval_and_job_reuse_are_denied(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    write_arguments = {
        "model": "res.partner",
        "operation": "write",
        "record_ids": [10],
        "values": {"name": "Alice Only"},
    }
    validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-alice-validate"),
        "validate_write",
        write_arguments,
    )
    bob = make_assertion(
        private_key,
        sub="user-bob",
        connection_id="conn-bob",
        jti="s4-bob-approval-reuse",
    )
    reused_approval = await real_http_tool_result(
        real_native_adapter_url,
        bob,
        "execute_approved_write",
        {"approval": validated["approval"], "confirm": True},
    )
    _assert_native_denial(reused_approval, "validated")

    submitted = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-alice-job-submit"),
        "submit_async_task",
        {
            "operation": "data_quality_report",
            "params": {"model": "res.partner", "checks": ["missing_required"]},
        },
    )
    reused_job = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(
            private_key,
            sub="user-bob",
            connection_id="conn-bob",
            jti="s4-bob-job-reuse",
        ),
        "get_async_task",
        {"task_id": submitted["task_id"]},
    )
    _assert_native_denial(reused_job, "task")


@pytest.mark.asyncio
async def test_S4_config_version_or_policy_change_retires_native_state(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
    native_fake_auth: FakeAuthServer,
    fake_odoo: FakeOdooServer,
) -> None:
    private_key, _ = signing_keys
    arguments = {
        "model": "res.partner",
        "operation": "write",
        "record_ids": [10],
        "values": {"name": "Stale Approval"},
    }
    validated = await real_http_tool_call(
        real_native_adapter_url,
        make_assertion(private_key, jti="s4-version-one-validate"),
        "validate_write",
        arguments,
    )
    connection = native_fake_auth.connections["user-alice"]
    connection.version = 2
    connection.policy = {
        "policyVersion": 2,
        "enableWrites": True,
        "allowedSideEffectMethods": [],
    }
    retired = await real_http_tool_result(
        real_native_adapter_url,
        make_assertion(private_key, version=2, jti="s4-version-two-execute"),
        "execute_approved_write",
        {"approval": validated["approval"], "confirm": True},
    )
    _assert_native_denial(retired, "validated")
    assert fake_odoo.state.writes == []
