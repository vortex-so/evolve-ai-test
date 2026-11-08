from __future__ import annotations

import inspect
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from mcp.types import CallToolResult, TextContent
from odoo_mcp.server import WRITE_APPROVAL_TTL_SECONDS

from odoo_adapter.models import ResolveResponse
from odoo_adapter.worker import (
    MutationOutcomeUnknown,
    WorkerBroker,
    WorkerError,
    normalize_hosted_arguments,
    worker_key,
)

from .fakes import FakeOdooServer


def config(
    uid: int,
    user_id: str,
    *,
    base_url: str = "https://erp.vortex.so",
    version: int = 1,
    enable_writes: bool = True,
    methods: list[str] | None = None,
) -> ResolveResponse:
    return ResolveResponse.model_validate(
        {
            "connectionId": f"conn-{user_id}",
            "userId": user_id,
            "version": version,
            "baseUrl": base_url,
            "database": "vortex",
            "login": "alice@example.com" if uid == 11 else "bob@example.com",
            "apiKey": "alice-key" if uid == 11 else "bob-key",
            "odooUid": uid,
            "adapterContract": "odoo-native-v2",
            "policy": {
                "policyVersion": 2,
                "enableWrites": enable_writes,
                "allowedSideEffectMethods": methods or [],
            },
        }
    )


def test_pinned_native_approval_ttl_is_600_seconds() -> None:
    assert WRITE_APPROVAL_TTL_SECONDS == 600


def test_S4_worker_pool_contract_is_bounded_and_clock_injectable() -> None:
    parameters = inspect.signature(WorkerBroker).parameters
    assert {"max_workers", "idle_timeout_seconds", "clock"} <= set(parameters)
    assert parameters["max_workers"].default == 2
    assert parameters["idle_timeout_seconds"].default == 660
    assert parameters["clock"].default is not inspect.Parameter.empty


def test_hosted_argument_guards_are_recursive_and_default_instance_only() -> None:
    assert normalize_hosted_arguments(
        "search_across_instances", {"model": "res.partner"}
    )["instances"] == ["default"]
    async_args = normalize_hosted_arguments(
        "submit_async_task",
        {"operation": "search_across_instances", "params": {"model": "res.partner"}},
    )
    assert async_args["params"]["instances"] == ["default"]
    with pytest.raises(WorkerError, match="scan_addons_source"):
        normalize_hosted_arguments(
            "submit_async_task", {"operation": "scan_addons_source", "params": {}}
        )
    with pytest.raises(WorkerError, match="default Odoo instance"):
        normalize_hosted_arguments("search_records", {"instance": "other"})
    with pytest.raises(WorkerError, match="local file uploads"):
        normalize_hosted_arguments(
            "validate_write", {"values": {"image_from_path": "/tmp/secret"}}
        )


@pytest.mark.asyncio
async def test_real_worker_reuses_process_and_removes_private_tempdir(
    fake_odoo: FakeOdooServer,
) -> None:
    broker = WorkerBroker(queue_timeout_seconds=2, worker_timeout_seconds=15)
    resolved = config(11, "alice", base_url=fake_odoo.origin)
    first = await broker.call(resolved, "list_instances", {})
    second = await broker.call(
        resolved,
        "search_records",
        {"model": "res.partner", "domain": [], "fields": ["id", "name"]},
    )
    assert first.is_error is False
    assert second.is_error is False
    assert len(broker._workers) == 1
    worker = next(iter(broker._workers.values()))
    temp_dir = worker.temp_dir
    assert isinstance(temp_dir, Path) and temp_dir.is_dir()
    assert temp_dir.stat().st_mode & 0o777 == 0o700
    await broker.close()
    assert not temp_dir.exists()
    assert broker._workers == {}


@pytest.mark.asyncio
async def test_pool_is_max_two_and_idle_clock_retires_without_sleep(
    fake_odoo: FakeOdooServer,
) -> None:
    now = [0.0]
    broker = WorkerBroker(
        queue_timeout_seconds=2,
        worker_timeout_seconds=15,
        clock=lambda: now[0],
    )
    first_config = config(11, "one", base_url=fake_odoo.origin)
    second_config = config(22, "two", base_url=fake_odoo.origin)
    third_config = config(11, "three", base_url=fake_odoo.origin)
    await broker.call(first_config, "list_instances", {})
    first_worker = broker._workers[worker_key(first_config)]
    await broker.call(second_config, "list_instances", {})
    await broker.call(third_config, "list_instances", {})
    assert len(broker._workers) == 2
    assert worker_key(first_config) not in broker._workers
    assert first_worker.closed is True

    second_worker = broker._workers[worker_key(second_config)]
    now[0] = 661
    await broker.call(second_config, "list_instances", {})
    assert broker._workers[worker_key(second_config)] is not second_worker
    assert second_worker.closed is True
    await broker.close()


@pytest.mark.asyncio
async def test_version_policy_and_principal_are_part_of_worker_key() -> None:
    base = config(11, "alice")
    assert worker_key(base) != worker_key(config(11, "alice", version=2))
    assert worker_key(base) != worker_key(config(11, "alice", enable_writes=False))
    assert worker_key(base) != worker_key(config(11, "other"))
    assert worker_key(base) != worker_key(
        config(11, "alice", methods=["account.move.action_post"])
    )


@pytest.mark.asyncio
async def test_mutation_crash_retires_worker_and_requires_new_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valid_result = CallToolResult(
        content=[TextContent(type="text", text='{"success":true}')],
        structured_content={"result": {"success": True}},
        is_error=False,
    )

    class FakeSession:
        def __init__(self, *streams: object) -> None:
            del streams

        async def __aenter__(self) -> FakeSession:
            return self

        async def __aexit__(self, *exc: object) -> None:
            del exc

        async def initialize(self) -> None:
            return None

        async def list_tools(self) -> Any:
            from odoo_adapter.worker import NATIVE_TOOL_NAMES

            return SimpleNamespace(
                tools=[SimpleNamespace(name=name) for name in NATIVE_TOOL_NAMES]
            )

        async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
            del arguments
            if name == "execute_approved_write":
                raise EOFError("worker stdout closed")
            return valid_result

    @asynccontextmanager
    async def fake_stdio(*args: object, **kwargs: object) -> AsyncIterator[tuple[object, object]]:
        del args, kwargs
        yield object(), object()

    monkeypatch.setattr("odoo_adapter.worker.ClientSession", FakeSession)
    monkeypatch.setattr("odoo_adapter.worker.stdio_client", fake_stdio)
    broker = WorkerBroker(queue_timeout_seconds=1, worker_timeout_seconds=1)
    resolved = config(11, "alice")
    with pytest.raises(MutationOutcomeUnknown, match="validation must be repeated"):
        await broker.call(
            resolved,
            "execute_approved_write",
            {"approval": {}, "confirm": True},
        )
    assert broker._workers == {}
    next_result = await broker.call(resolved, "preview_write", {})
    assert next_result == valid_result
    await broker.close()
