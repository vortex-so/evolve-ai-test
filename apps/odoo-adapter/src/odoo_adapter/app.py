from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx2 as httpx
from mcp.server import Server, ServerRequestContext
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    InputRequiredResult,
    ListToolsResult,
    PaginatedRequestParams,
    TextContent,
    ToolAnnotations,
)
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import ASGIApp, Receive, Scope, Send

from .auth import IdentityError, IdentityMiddleware, IdentityVerifier, identity_from_context
from .backend import BackendClient
from .config import Settings
from .service import AdapterError, OriginPolicy, PolicyService
from .worker import NATIVE_TOOL_NAMES, WorkerBroker, native_catalog

READ_ONLY = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=False,
)


class ExactMcpPathMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path")
        if scope["type"] == "http" and path in {"/mcp", "/test/mcp"}:
            scope = {**scope, "path": f"{path}/", "raw_path": f"{path}/".encode()}
        await self._app(scope, receive, send)


def _result(payload: dict[str, Any], *, error: bool = False) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, separators=(",", ":")))],
        structured_content=payload,
        is_error=error,
    )


def _error(message: str) -> CallToolResult:
    return _result({"error": message}, error=True)


def _build_normal_server(service: PolicyService) -> Server:
    catalog = native_catalog()
    if tuple(tool.name for tool in catalog) != NATIVE_TOOL_NAMES:
        raise RuntimeError("pinned upstream catalog does not match the native adapter contract")

    async def on_list_tools(
        ctx: ServerRequestContext,
        params: PaginatedRequestParams | None,
    ) -> ListToolsResult:
        del ctx, params
        return ListToolsResult(tools=list(catalog))

    async def on_call_tool(
        ctx: ServerRequestContext,
        params: CallToolRequestParams,
    ) -> CallToolResult | InputRequiredResult:
        try:
            identity = identity_from_context(ctx)
            arguments = dict(params.arguments or {})
            return await service.invoke_native(identity, params.name, arguments)
        except IdentityError:
            return _error("identity assertion required")
        except AdapterError as exc:
            return _error(str(exc))

    return Server(
        "Vortex Odoo Native Adapter",
        instructions="Native Odoo MCP tools scoped to the authenticated user's connection.",
        on_list_tools=on_list_tools,
        on_call_tool=on_call_tool,
    )


def _build_test_server(service: PolicyService) -> MCPServer[Any]:
    server = MCPServer(
        "Vortex Odoo Connection Test",
        instructions="This route only authenticates the configured Odoo connection.",
    )

    @server.tool(
        description="Authenticate the resolved Odoo connection without reading or writing models.",
        annotations=READ_ONLY,
        structured_output=True,
    )
    async def test_connection(ctx: Context) -> CallToolResult:
        try:
            identity = identity_from_context(ctx)
            return _result(await service.test_connection(identity))
        except IdentityError:
            return _error("identity assertion required")
        except AdapterError as exc:
            return _error(str(exc))

    return server


def create_app(
    settings: Settings,
    *,
    backend_transport: httpx.AsyncBaseTransport | None = None,
    origin_policy: OriginPolicy | None = None,
) -> Starlette:
    verifier = IdentityVerifier(settings.assertion_public_key, settings.byok_auth_origin)
    backend = BackendClient(
        origin=settings.byok_auth_origin,
        runtime_token=settings.byok_runtime_token,
        timeout_seconds=settings.backend_timeout_seconds,
        transport=backend_transport,
    )
    broker = WorkerBroker(
        queue_timeout_seconds=settings.queue_timeout_seconds,
        worker_timeout_seconds=settings.worker_timeout_seconds,
    )
    service = PolicyService(
        backend=backend,
        broker=broker,
        origins=origin_policy or OriginPolicy(settings.odoo_allowed_origin),
    )
    normal_server = _build_normal_server(service)
    test_server = _build_test_server(service)
    transport_security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    normal_mcp_app = normal_server.streamable_http_app(
        streamable_http_path="/",
        json_response=True,
        stateless_http=True,
        max_request_body_size=128 * 1024,
        transport_security=transport_security,
        host="0.0.0.0",
    )
    test_mcp_app = test_server.streamable_http_app(
        streamable_http_path="/",
        json_response=True,
        stateless_http=True,
        max_request_body_size=32 * 1024,
        transport_security=transport_security,
        host="0.0.0.0",
    )

    async def healthz(request: Request) -> JSONResponse:
        del request
        return JSONResponse({"ok": True}, headers={"cache-control": "no-store"})

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        del app
        async with contextlib.AsyncExitStack() as stack:
            await stack.enter_async_context(normal_server.session_manager.run())
            await stack.enter_async_context(test_server.session_manager.run())
            try:
                yield
            finally:
                await service.close()
                await backend.aclose()

    app = Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Mount(
                "/test/mcp",
                app=IdentityMiddleware(
                    test_mcp_app,
                    verifier,
                    purpose="test",
                    server="odoo_test",
                ),
            ),
            Mount(
                "/mcp",
                app=IdentityMiddleware(
                    normal_mcp_app,
                    verifier,
                    purpose="mcp",
                    server="odoo",
                ),
            ),
        ],
        lifespan=lifespan,
    )
    app.add_middleware(ExactMcpPathMiddleware)
    app.state.policy_service = service
    app.state.normal_server = normal_server
    app.state.test_server = test_server
    return app
