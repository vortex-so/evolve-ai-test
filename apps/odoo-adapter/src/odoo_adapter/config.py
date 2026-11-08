from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def _https_origin(name: str, value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/"):
        raise ValueError(f"{name} must be an HTTPS origin without a path")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError(f"{name} must be a plain HTTPS origin")
    return f"https://{parsed.netloc}"


@dataclass(frozen=True, slots=True)
class Settings:
    byok_auth_origin: str
    byok_runtime_token: str
    assertion_public_key: str
    odoo_allowed_origin: str
    port: int = 8080
    backend_timeout_seconds: float = 5.0
    worker_timeout_seconds: float = 20.0
    queue_timeout_seconds: float = 10.0

    @classmethod
    def from_env(cls) -> Settings:
        token = os.environ.get("BYOK_RUNTIME_TOKEN", "")
        public_key = os.environ.get("BYOK_ASSERTION_PUBLIC_KEY", "")
        if len(token) < 32:
            raise ValueError("BYOK_RUNTIME_TOKEN must contain at least 32 characters")
        if "BEGIN PUBLIC KEY" not in public_key:
            raise ValueError("BYOK_ASSERTION_PUBLIC_KEY must be a PEM public key")
        port = int(os.environ.get("PORT", "8080"))
        if not 1 <= port <= 65535:
            raise ValueError("PORT must be between 1 and 65535")
        return cls(
            byok_auth_origin=_https_origin(
                "BYOK_AUTH_ORIGIN",
                os.environ.get("BYOK_AUTH_ORIGIN", "https://api.auth-dev.vortex.so"),
            ),
            byok_runtime_token=token,
            assertion_public_key=public_key,
            odoo_allowed_origin=_https_origin(
                "ODOO_ALLOWED_ORIGIN",
                os.environ.get("ODOO_ALLOWED_ORIGIN", "https://erp.vortex.so"),
            ),
            port=port,
        )
