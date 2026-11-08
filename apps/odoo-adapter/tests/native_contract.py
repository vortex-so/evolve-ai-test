from __future__ import annotations

from typing import Any

import httpx2 as httpx

NATIVE_TOOL_NAMES = (
    "data_quality_report",
    "diagnose_odoo_call",
    "generate_json2_payload",
    "inspect_model_relationships",
    "diagnose_access",
    "upgrade_risk_report",
    "analyze_upgrade_log",
    "lookup_model_history",
    "fit_gap_report",
    "build_domain",
    "business_pack_report",
    "get_odoo_profile",
    "schema_catalog",
    "health_check",
    "list_instances",
    "list_models",
    "get_model_fields",
    "search_records",
    "read_record",
    "read_attachment",
    "aggregate_records",
    "search_employee",
    "search_holidays",
    "preview_write",
    "validate_write",
    "execute_approved_write",
    "chatter_post",
    "execute_method",
    "index_knowledge",
    "search_knowledge",
    "knowledge_stats",
    "receivable_payable_aging",
    "accounting_health_summary",
    "search_across_instances",
    "aggregate_across_instances",
    "accounting_health_across_instances",
    "submit_async_task",
    "get_async_task",
    "cancel_async_task",
    "list_async_tasks",
)


def mcp_headers(assertion: str) -> dict[str, str]:
    return {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        "x-vortex-identity": f"Bearer {assertion}",
    }


def mcp_request(method: str, params: dict[str, Any], request_id: int) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}


def initialize_params() -> dict[str, Any]:
    return {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "odoo-native-red", "version": "1"},
    }


async def real_http_mcp_request(
    base_url: str,
    assertion: str,
    method: str,
    params: dict[str, Any],
    *,
    request_id: int = 2,
    path: str = "/mcp",
) -> dict[str, Any]:
    async with httpx.AsyncClient(
        base_url=base_url, headers=mcp_headers(assertion), timeout=30
    ) as client:
        initialized = await client.post(
            path, json=mcp_request("initialize", initialize_params(), 1)
        )
        assert initialized.status_code == 200, initialized.text
        response = await client.post(
            path, json=mcp_request(method, params, request_id)
        )
        assert response.status_code == 200, response.text
        envelope = response.json()
        assert isinstance(envelope, dict)
        return envelope


async def real_http_tool_result(
    base_url: str,
    assertion: str,
    name: str,
    arguments: dict[str, Any],
    *,
    path: str = "/mcp",
) -> dict[str, Any]:
    envelope = await real_http_mcp_request(
        base_url,
        assertion,
        "tools/call",
        {"name": name, "arguments": arguments},
        path=path,
    )
    assert "error" not in envelope, envelope
    result = envelope["result"]
    assert isinstance(result, dict), envelope
    return result


async def real_http_tool_call(
    base_url: str,
    assertion: str,
    name: str,
    arguments: dict[str, Any],
    *,
    path: str = "/mcp",
) -> dict[str, Any]:
    result = await real_http_tool_result(
        base_url, assertion, name, arguments, path=path
    )
    assert result.get("isError") is not True, result
    structured = result.get("structuredContent")
    assert isinstance(structured, dict), result
    nested = structured.get("result")
    if set(structured) == {"result"} and isinstance(nested, dict):
        return nested
    return structured
