from __future__ import annotations

from typing import Any, Literal

import httpx2 as httpx

from .auth import VerifiedIdentity
from .models import ADAPTER_CONTRACT, ResolveResponse


class BackendError(RuntimeError):
    pass


class BackendClient:
    def __init__(
        self,
        *,
        origin: str,
        runtime_token: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=origin,
            timeout=timeout_seconds,
            follow_redirects=False,
            transport=transport,
        )
        self._runtime_token = runtime_token

    async def aclose(self) -> None:
        await self._client.aclose()

    def _headers(self, identity: VerifiedIdentity) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self._runtime_token}",
            "x-vortex-identity": f"Bearer {identity.assertion}",
            "x-vortex-adapter-contract": ADAPTER_CONTRACT,
            "content-type": "application/json",
        }

    async def _post(
        self, identity: VerifiedIdentity, path: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            response = await self._client.post(path, headers=self._headers(identity), json=body)
        except httpx.HTTPError as exc:
            raise BackendError("authorization service unavailable") from exc
        if response.status_code >= 300:
            raise BackendError("authorization service rejected the request")
        try:
            data = response.json()
        except ValueError as exc:
            raise BackendError("authorization service returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise BackendError("authorization service returned an invalid response")
        return data

    async def resolve(self, identity: VerifiedIdentity) -> ResolveResponse:
        try:
            return ResolveResponse.model_validate(
                await self._post(identity, "/internal/byok/resolve", {})
            )
        except ValueError as exc:
            raise BackendError("authorization service returned an incompatible contract") from exc

    async def audit(
        self,
        identity: VerifiedIdentity,
        *,
        tool: str,
        outcome: Literal["started", "success", "failure", "denied"],
    ) -> None:
        data = await self._post(
            identity,
            "/internal/byok/audit",
            {"tool": tool, "outcome": outcome},
        )
        if data != {"ok": True}:
            raise BackendError("authorization service rejected the audit event")
