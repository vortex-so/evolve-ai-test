from __future__ import annotations

import socket
import threading
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Any

import httpx2 as httpx
import jwt
import pytest
import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from odoo_adapter.app import create_app
from odoo_adapter.config import Settings
from odoo_adapter.service import OriginPolicy

from .fakes import FakeAuthServer, FakeOdooServer


@pytest.fixture(scope="session")
def signing_keys() -> tuple[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        private_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return private_pem, public_pem


@pytest.fixture
def fake_odoo() -> Iterator[FakeOdooServer]:
    server = FakeOdooServer()
    server.start()
    try:
        yield server
    finally:
        server.close()


@pytest.fixture
def fake_auth(fake_odoo: FakeOdooServer) -> FakeAuthServer:
    return FakeAuthServer(fake_odoo.origin, native_policy=True)


@pytest.fixture
def native_fake_auth(fake_odoo: FakeOdooServer) -> FakeAuthServer:
    return FakeAuthServer(fake_odoo.origin, native_policy=True)


def _settings(public_key: str) -> Settings:
    return Settings(
        byok_auth_origin="https://api.auth-dev.vortex.so",
        byok_runtime_token="runtime-secret-runtime-secret-1234",
        assertion_public_key=public_key,
        odoo_allowed_origin="https://erp.vortex.so",
        worker_timeout_seconds=15,
        queue_timeout_seconds=3,
    )


@pytest.fixture
def adapter_app(
    signing_keys: tuple[str, str], fake_odoo: FakeOdooServer, fake_auth: FakeAuthServer
) -> Any:
    _, public_key = signing_keys
    return create_app(
        _settings(public_key),
        backend_transport=httpx.ASGITransport(app=fake_auth.app),
        origin_policy=OriginPolicy(fake_odoo.origin, allow_http_for_tests=True),
    )


@pytest.fixture
def native_adapter_app(
    signing_keys: tuple[str, str],
    fake_odoo: FakeOdooServer,
    native_fake_auth: FakeAuthServer,
) -> Any:
    _, public_key = signing_keys
    return create_app(
        _settings(public_key),
        backend_transport=httpx.ASGITransport(app=native_fake_auth.app),
        origin_policy=OriginPolicy(fake_odoo.origin, allow_http_for_tests=True),
    )


@pytest.fixture
def real_native_adapter_url(native_adapter_app: Any) -> Iterator[str]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = int(listener.getsockname()[1])
    server = uvicorn.Server(
        uvicorn.Config(
            native_adapter_app,
            host="127.0.0.1",
            port=port,
            log_level="critical",
            lifespan="on",
        )
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        listener.close()
        raise RuntimeError("loopback adapter server did not start")
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()



def make_assertion(
    private_key: str,
    *,
    sub: str = "user-alice",
    connection_id: str = "conn-alice",
    version: int = 1,
    purpose: str = "mcp",
    server: str = "odoo",
    audience: str = "vortex-odoo-adapter",
    issuer: str = "https://api.auth-dev.vortex.so",
    issued_at: int | None = None,
    expires_in: int = 45,
    actor_id: str | None = None,
    algorithm: str = "ES256",
    jti: str | None = None,
) -> str:
    now = int(time.time()) if issued_at is None else issued_at
    payload: dict[str, Any] = {
        "sub": sub,
        "connection_id": connection_id,
        "version": version,
        "purpose": purpose,
        "server": server,
        "iat": now,
        "exp": now + expires_in,
        "jti": jti or f"jti-{sub}-{now}-{purpose}",
        "iss": issuer,
        "aud": audience,
    }
    if actor_id is not None:
        payload["actor_id"] = actor_id
    return jwt.encode(payload, private_key, algorithm=algorithm)


@asynccontextmanager
async def mcp_session(
    app: Any, path: str, assertion: str | None = None
) -> AsyncIterator[ClientSession]:
    headers = {"x-vortex-identity": f"Bearer {assertion}"} if assertion else {}
    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport, base_url="http://adapter", headers=headers
        ) as client,
        streamable_http_client(f"http://adapter{path}", http_client=client) as streams,
        ClientSession(*streams[:2]) as session,
    ):
        await session.initialize()
        yield session
