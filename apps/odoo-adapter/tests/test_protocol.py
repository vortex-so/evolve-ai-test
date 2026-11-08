from __future__ import annotations

from typing import Any

import httpx2 as httpx
import pytest
from odoo_mcp.server import mcp as upstream_mcp

from .conftest import make_assertion
from .native_contract import NATIVE_TOOL_NAMES, real_http_mcp_request


@pytest.mark.asyncio
async def test_health_exact_paths_static_schemas_and_unknown_tool(
    adapter_app: Any,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key)
    async with (
        adapter_app.router.lifespan_context(adapter_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=adapter_app),
            base_url="http://adapter",
            follow_redirects=False,
        ) as client,
    ):
        health = await client.get("/healthz")
        assert health.status_code == 200
        assert health.json() == {"ok": True}
        initialized = await client.post(
            "/mcp",
            json=_request("initialize", _initialize_params(), 1),
            headers=_headers(assertion),
        )
        assert initialized.status_code == 200
        assert initialized.history == []
        assert initialized.headers["content-type"].startswith("application/json")
        listed = await client.post(
            "/mcp",
            json=_request("tools/list", {}, 2),
            headers=_headers(assertion),
        )
        tools = listed.json()["result"]["tools"]
        upstream = [
            tool.model_dump(by_alias=True, exclude_none=True)
            for tool in await upstream_mcp.list_tools()
            if tool.name != "scan_addons_source"
        ]
        assert tools == upstream
        unknown_tool = await client.post(
            "/mcp",
            json=_request(
                "tools/call",
                {"name": "scan_addons_source", "arguments": {}},
                3,
            ),
            headers=_headers(assertion),
        )
        assert unknown_tool.json()["result"]["isError"] is True


@pytest.mark.asyncio
async def test_batches_and_unknown_methods_do_not_bypass_sdk(
    adapter_app: Any,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key)
    async with (
        adapter_app.router.lifespan_context(adapter_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=adapter_app), base_url="http://adapter"
        ) as client,
    ):
        batch = await client.post(
            "/mcp",
            json=[_request("tools/list", {}, 1), _request("tools/list", {}, 2)],
            headers=_headers(assertion),
        )
        assert batch.status_code == 400
        unknown = await client.post(
            "/mcp",
            json=_request("odoo/execute_method", {}, 3),
            headers=_headers(assertion),
        )
        assert unknown.status_code == 200
        assert unknown.json()["error"]["code"] == -32601


@pytest.mark.asyncio
async def test_route_purpose_isolation(
    adapter_app: Any,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    normal = make_assertion(private_key)
    test = make_assertion(private_key, purpose="test", server="odoo_test", actor_id="admin-1")
    async with (
        adapter_app.router.lifespan_context(adapter_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=adapter_app), base_url="http://adapter"
        ) as client,
    ):
        wrong_test = await client.post(
            "/test/mcp",
            json=_request("initialize", _initialize_params(), 1),
            headers=_headers(normal),
        )
        wrong_normal = await client.post(
            "/mcp",
            json=_request("initialize", _initialize_params(), 2),
            headers=_headers(test),
        )
        assert wrong_test.status_code == 401
        assert wrong_normal.status_code == 401


def _headers(assertion: str) -> dict[str, str]:
    return {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        "x-vortex-identity": f"Bearer {assertion}",
    }


def _initialize_params() -> dict[str, Any]:
    return {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "protocol-test", "version": "1"},
    }


def _request(method: str, params: dict[str, Any], request_id: int) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}


@pytest.mark.asyncio
async def test_pinned_upstream_catalog_freezes_41_tools_without_credentials() -> None:
    actual = tuple(tool.name for tool in await upstream_mcp.list_tools())
    assert len(actual) == 41
    assert "scan_addons_source" in actual
    assert tuple(name for name in actual if name != "scan_addons_source") == NATIVE_TOOL_NAMES


@pytest.mark.asyncio
async def test_S2_native_inventory(
    real_native_adapter_url: str,
    signing_keys: tuple[str, str],
) -> None:
    private_key, _ = signing_keys
    assertion = make_assertion(private_key, jti="s1-native-inventory")
    envelope = await real_http_mcp_request(
        real_native_adapter_url, assertion, "tools/list", {}
    )
    assert "error" not in envelope, envelope
    tools = envelope["result"]["tools"]
    names = tuple(tool["name"] for tool in tools)
    assert names == NATIVE_TOOL_NAMES
    assert len(names) == 40
    assert "scan_addons_source" not in names
    assert {"search_records", "preview_write", "execute_method", "submit_async_task"} <= set(
        names
    )
