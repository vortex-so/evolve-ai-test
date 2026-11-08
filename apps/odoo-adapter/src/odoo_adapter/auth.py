from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Literal

import jwt
from jwt import InvalidTokenError
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .models import IdentityClaims


class IdentityError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class VerifiedIdentity:
    claims: IdentityClaims
    assertion: str


class IdentityVerifier:
    def __init__(self, public_key: str, issuer: str, audience: str = "vortex-odoo-adapter"):
        self._public_key = public_key
        self._issuer = issuer
        self._audience = audience

    def verify(
        self,
        authorization: str,
        *,
        purpose: Literal["mcp", "test"],
        server: Literal["odoo", "odoo_test"],
    ) -> VerifiedIdentity:
        prefix = "Bearer "
        if not authorization.startswith(prefix) or len(authorization) == len(prefix):
            raise IdentityError("invalid identity assertion")
        assertion = authorization[len(prefix) :]
        try:
            raw: dict[str, Any] = jwt.decode(
                assertion,
                self._public_key,
                algorithms=["ES256"],
                audience=self._audience,
                issuer=self._issuer,
                options={
                    "require": [
                        "sub",
                        "connection_id",
                        "version",
                        "purpose",
                        "server",
                        "iat",
                        "exp",
                        "jti",
                    ]
                },
            )
            claims = IdentityClaims.model_validate(raw)
        except (InvalidTokenError, ValueError) as exc:
            raise IdentityError("invalid identity assertion") from exc
        now = int(time.time())
        if claims.exp - claims.iat > 60 or claims.exp <= claims.iat or claims.iat > now:
            raise IdentityError("invalid identity assertion")
        if claims.purpose != purpose or claims.server != server:
            raise IdentityError("identity assertion is not valid for this route")
        if purpose == "test" and not claims.actor_id:
            raise IdentityError("test identity requires actor_id")
        if purpose == "mcp" and claims.actor_id is not None:
            raise IdentityError("mcp identity must not contain actor_id")
        return VerifiedIdentity(claims=claims, assertion=assertion)


class IdentityMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        verifier: IdentityVerifier,
        *,
        purpose: Literal["mcp", "test"],
        server: Literal["odoo", "odoo_test"],
    ) -> None:
        self._app = app
        self._verifier = verifier
        self._purpose: Literal["mcp", "test"] = purpose
        self._server: Literal["odoo", "odoo_test"] = server

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        header = Headers(scope=scope).get("x-vortex-identity")
        if header is not None:
            try:
                identity = self._verifier.verify(header, purpose=self._purpose, server=self._server)
            except IdentityError:
                response = JSONResponse(
                    {"error": "invalid_identity"},
                    status_code=401,
                    headers={"cache-control": "no-store"},
                )
                await response(scope, receive, send)
                return
            scope.setdefault("state", {})["vortex_identity"] = identity
        await self._app(scope, receive, send)


def identity_from_context(ctx: Any) -> VerifiedIdentity:
    request_context = getattr(ctx, "request_context", None)
    request = getattr(request_context, "request", None)
    if request is None:
        request = getattr(ctx, "request", None)
    identity = getattr(request.state, "vortex_identity", None) if request else None
    if not isinstance(identity, VerifiedIdentity):
        raise IdentityError("identity assertion required")
    return identity
