from __future__ import annotations

import asyncio
import xmlrpc.client
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from mcp.types import CallToolResult

from .auth import VerifiedIdentity
from .backend import BackendClient, BackendError
from .models import ADAPTER_CONTRACT, ResolveResponse
from .worker import MutationOutcomeUnknown, WorkerBroker, WorkerError


class AdapterError(RuntimeError):
    def __init__(self, message: str, *, denied: bool = False):
        super().__init__(message)
        self.denied = denied


@dataclass(frozen=True, slots=True)
class OriginPolicy:
    allowed_origin: str
    allow_http_for_tests: bool = False

    def validate(self, value: str) -> None:
        if value != self.allowed_origin:
            raise AdapterError("connection origin is not allowed", denied=True)
        parsed = urlsplit(value)
        if parsed.scheme != "https" and not self.allow_http_for_tests:
            raise AdapterError("connection origin must use HTTPS", denied=True)
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise AdapterError("connection origin is invalid", denied=True)


class PolicyService:
    def __init__(
        self,
        *,
        backend: BackendClient,
        broker: WorkerBroker,
        origins: OriginPolicy,
    ) -> None:
        self._backend = backend
        self._broker = broker
        self._origins = origins

    async def invoke_native(
        self,
        identity: VerifiedIdentity,
        tool: str,
        arguments: dict[str, Any],
    ) -> CallToolResult:
        started = False
        try:
            config = await self._resolve(identity)
            await self._backend.audit(identity, tool=tool, outcome="started")
            started = True
            result = await self._broker.call(config, tool, arguments)
            await self._backend.audit(
                identity,
                tool=tool,
                outcome="failure" if result.is_error else "success",
            )
            return result
        except MutationOutcomeUnknown as exc:
            if started:
                await self._safe_audit(identity, tool, "failure")
            raise AdapterError(
                "mutation outcome is unknown; repeat validation before any retry"
            ) from exc
        except AdapterError:
            if started:
                await self._safe_audit(identity, tool, "denied")
            raise
        except WorkerError as exc:
            if started:
                await self._safe_audit(identity, tool, "failure")
            raise AdapterError(str(exc), denied=True) from exc
        except BackendError as exc:
            if started:
                await self._safe_audit(identity, tool, "failure")
            await self._broker.retire_owner(
                identity.claims.sub, identity.claims.connection_id
            )
            raise AdapterError(
                "authorization service rejected the invocation", denied=True
            ) from exc

    async def test_connection(
        self, identity: VerifiedIdentity, config: ResolveResponse | None = None
    ) -> dict[str, Any]:
        resolved = config or await self._resolve(identity)
        await self._backend.audit(identity, tool="test_connection", outcome="started")
        try:
            uid = await authenticate_xmlrpc(resolved)
            if resolved.odoo_uid is not None and uid != resolved.odoo_uid:
                await self._broker.retire_owner(resolved.user_id, resolved.connection_id)
                raise AdapterError("authenticated Odoo user does not match connection owner")
            await self._backend.audit(identity, tool="test_connection", outcome="success")
            return {"ok": True, "uid": uid}
        except AdapterError:
            await self._safe_audit(identity, "test_connection", "failure")
            raise

    async def close(self) -> None:
        await self._broker.close()

    async def _resolve(self, identity: VerifiedIdentity) -> ResolveResponse:
        try:
            config = await self._backend.resolve(identity)
            self._validate_resolution(identity, config)
            return config
        except (BackendError, AdapterError):
            await self._broker.retire_owner(
                identity.claims.sub, identity.claims.connection_id
            )
            raise

    def _validate_resolution(self, identity: VerifiedIdentity, config: ResolveResponse) -> None:
        claims = identity.claims
        if (
            config.connection_id != claims.connection_id
            or config.user_id != claims.sub
            or config.version != claims.version
            or config.adapter_contract != ADAPTER_CONTRACT
        ):
            raise AdapterError("resolved connection does not match identity", denied=True)
        self._origins.validate(config.base_url)
        if claims.purpose == "mcp" and config.odoo_uid is None:
            raise AdapterError("connection requires a tested Odoo UID", denied=True)

    async def _safe_audit(
        self,
        identity: VerifiedIdentity,
        tool: str,
        outcome: Literal["failure", "denied"],
    ) -> None:
        try:
            await self._backend.audit(identity, tool=tool, outcome=outcome)
        except BackendError:
            return


async def authenticate_xmlrpc(config: ResolveResponse) -> int:
    def authenticate() -> int:
        parsed = urlsplit(config.base_url)
        if parsed.scheme == "https":
            transport: xmlrpc.client.Transport = _TimeoutSafeTransport(timeout=10)
        else:
            transport = _TimeoutTransport(timeout=10)
        proxy = xmlrpc.client.ServerProxy(
            f"{config.base_url}/xmlrpc/2/common",
            transport=transport,
            allow_none=True,
        )
        uid = proxy.authenticate(config.database, config.login, config.api_key, {})
        if not isinstance(uid, int) or isinstance(uid, bool) or uid <= 0:
            raise AdapterError("Odoo authentication failed")
        return uid

    return await asyncio.to_thread(authenticate)


class _TimeoutTransport(xmlrpc.client.Transport):
    def __init__(self, *, timeout: float):
        super().__init__()
        self._timeout = timeout

    def make_connection(self, host: Any) -> Any:
        connection = super().make_connection(host)
        connection.timeout = self._timeout
        return connection


class _TimeoutSafeTransport(xmlrpc.client.SafeTransport):
    def __init__(self, *, timeout: float):
        super().__init__()
        self._timeout = timeout

    def make_connection(self, host: Any) -> Any:
        connection = super().make_connection(host)
        connection.timeout = self._timeout
        return connection
