from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from mcp.types import CallToolResult, TextContent
from pydantic import ValidationError

from odoo_adapter.models import OdooPolicy
from odoo_adapter.worker import (
    NATIVE_TOOL_NAMES,
    WorkerBroker,
    WorkerError,
    WorkerOverloaded,
    WorkerTimedOut,
    worker_key,
)

from .test_worker import config

OK = CallToolResult(
    content=[TextContent(type="text", text='{"success":true}')],
    structured_content={"result": {"success": True}},
    is_error=False,
)


@dataclass
class Controller:
    init_gate: asyncio.Event | None = None
    call_gates: dict[str, asyncio.Event] = field(default_factory=dict)
    crash_tools: set[str] = field(default_factory=set)
    started: dict[str, asyncio.Event] = field(default_factory=dict)


@pytest.fixture
def controller(monkeypatch: pytest.MonkeyPatch) -> Controller:
    ctl = Controller()

    class FakeSession:
        def __init__(self, *streams: object) -> None:
            del streams

        async def __aenter__(self) -> FakeSession:
            return self

        async def __aexit__(self, *exc: object) -> None:
            del exc

        async def initialize(self) -> None:
            if ctl.init_gate is not None:
                await ctl.init_gate.wait()

        async def list_tools(self) -> Any:
            return SimpleNamespace(tools=[SimpleNamespace(name=name) for name in NATIVE_TOOL_NAMES])

        async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
            del arguments
            started = ctl.started.get(name)
            if started is not None:
                started.set()
            gate = ctl.call_gates.get(name)
            if gate is not None:
                await gate.wait()
            if name in ctl.crash_tools:
                raise EOFError("worker stdout closed")
            return OK

    @asynccontextmanager
    async def fake_stdio(*args: object, **kwargs: object) -> AsyncIterator[tuple[object, object]]:
        del args, kwargs
        yield object(), object()

    monkeypatch.setattr("odoo_adapter.worker.ClientSession", FakeSession)
    monkeypatch.setattr("odoo_adapter.worker.stdio_client", fake_stdio)
    return ctl


async def _wait_started(ctl: Controller, tool: str) -> None:
    await asyncio.wait_for(ctl.started[tool].wait(), timeout=2)


@pytest.mark.asyncio
async def test_job_enqueued_behind_close_sentinel_is_rejected_not_stranded(
    controller: Controller,
) -> None:
    controller.call_gates["read_record"] = asyncio.Event()
    controller.started["read_record"] = asyncio.Event()
    broker = WorkerBroker(queue_timeout_seconds=2, worker_timeout_seconds=5)
    resolved = config(11, "alice")
    active = asyncio.create_task(broker.call(resolved, "read_record", {}))
    await _wait_started(controller, "read_record")
    worker = broker._workers[worker_key(resolved)]
    closing = asyncio.create_task(worker.close())
    await asyncio.sleep(0)
    late = asyncio.create_task(worker.call("list_models", {}))
    await asyncio.sleep(0)
    controller.call_gates["read_record"].set()
    assert (await asyncio.wait_for(active, timeout=2)) is OK
    with pytest.raises(WorkerError):
        await asyncio.wait_for(late, timeout=2)
    await asyncio.wait_for(closing, timeout=2)
    await broker.close()


@pytest.mark.asyncio
async def test_caller_blocked_on_full_queue_fails_promptly_after_crash(
    controller: Controller,
) -> None:
    controller.call_gates["execute_method"] = asyncio.Event()
    controller.started["execute_method"] = asyncio.Event()
    controller.crash_tools.add("execute_method")
    broker = WorkerBroker(queue_timeout_seconds=10, worker_timeout_seconds=10)
    resolved = config(11, "alice")
    crashing = asyncio.create_task(broker.call(resolved, "execute_method", {}))
    await _wait_started(controller, "execute_method")
    worker = broker._workers[worker_key(resolved)]
    queued = [asyncio.create_task(worker.call("list_models", {})) for _ in range(8)]
    await asyncio.sleep(0)
    blocked = asyncio.create_task(worker.call("list_models", {}))
    await asyncio.sleep(0)
    controller.call_gates["execute_method"].set()
    with pytest.raises(WorkerError):
        await asyncio.wait_for(crashing, timeout=2)
    for task in queued:
        with pytest.raises(WorkerError):
            await asyncio.wait_for(task, timeout=2)
    with pytest.raises(WorkerError):
        await asyncio.wait_for(blocked, timeout=2)
    await broker.close()


@pytest.mark.asyncio
async def test_stored_native_approval_pins_worker_against_capacity_eviction(
    controller: Controller,
) -> None:
    del controller
    now = [0.0]
    broker = WorkerBroker(
        queue_timeout_seconds=2, worker_timeout_seconds=5, max_workers=1, clock=lambda: now[0]
    )
    alice, bob = config(11, "alice"), config(22, "bob")
    await broker.call(alice, "validate_write", {})
    alice_worker = broker._workers[worker_key(alice)]
    with pytest.raises(WorkerOverloaded):
        await broker.call(bob, "list_models", {})
    assert broker._workers[worker_key(alice)] is alice_worker
    assert (await broker.call(alice, "execute_approved_write", {"confirm": True})) is OK
    assert (await broker.call(bob, "list_models", {})) is OK
    assert alice_worker.closed is True
    await broker.close()


@pytest.mark.asyncio
async def test_approval_pin_expires_after_native_ttl(controller: Controller) -> None:
    del controller
    now = [0.0]
    broker = WorkerBroker(
        queue_timeout_seconds=2, worker_timeout_seconds=5, max_workers=1, clock=lambda: now[0]
    )
    alice, bob = config(11, "alice"), config(22, "bob")
    await broker.call(alice, "validate_write", {})
    now[0] = 599
    with pytest.raises(WorkerOverloaded):
        await broker.call(bob, "list_models", {})
    now[0] = 601
    assert (await broker.call(bob, "list_models", {})) is OK
    await broker.close()


@pytest.mark.asyncio
async def test_submitted_async_task_pins_worker_past_idle_ttl(controller: Controller) -> None:
    del controller
    now = [0.0]
    broker = WorkerBroker(
        queue_timeout_seconds=2, worker_timeout_seconds=5, max_workers=1, clock=lambda: now[0]
    )
    alice, bob = config(11, "alice"), config(22, "bob")
    await broker.call(alice, "submit_async_task", {"operation": "list_models", "params": {}})
    alice_worker = broker._workers[worker_key(alice)]
    with pytest.raises(WorkerOverloaded):
        await broker.call(bob, "list_models", {})
    now[0] = 500
    await broker.call(alice, "get_async_task", {"task_id": "t1"})
    assert broker._workers[worker_key(alice)] is alice_worker
    await broker.close()


@pytest.mark.asyncio
async def test_cancelled_startup_waiter_does_not_poison_shared_worker(
    controller: Controller,
) -> None:
    controller.init_gate = asyncio.Event()
    broker = WorkerBroker(queue_timeout_seconds=2, worker_timeout_seconds=5)
    resolved = config(11, "alice")
    first = asyncio.create_task(broker.call(resolved, "list_models", {}))
    await asyncio.sleep(0.05)
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    second = asyncio.create_task(broker.call(resolved, "list_models", {}))
    await asyncio.sleep(0)
    controller.init_gate.set()
    assert (await asyncio.wait_for(second, timeout=2)) is OK
    await broker.close()


@pytest.mark.asyncio
async def test_hung_worker_startup_times_out_and_is_discarded(controller: Controller) -> None:
    controller.init_gate = asyncio.Event()
    broker = WorkerBroker(queue_timeout_seconds=0.2, worker_timeout_seconds=0.3)
    resolved = config(11, "alice")
    with pytest.raises(WorkerTimedOut):
        await asyncio.wait_for(broker.call(resolved, "list_models", {}), timeout=2)
    assert broker._workers == {}
    await broker.close()


def _policy(method: str) -> OdooPolicy:
    return OdooPolicy.model_validate(
        {"policyVersion": 2, "enableWrites": False, "allowedSideEffectMethods": [method]}
    )


@pytest.mark.parametrize(
    "method",
    ["account.move.action_post", "res.partner.write", "account.bank.statement.line.action_x"],
)
def test_policy_method_grammar_accepts_typescript_valid_entries(method: str) -> None:
    assert _policy(method).allowed_side_effect_methods == [method]


@pytest.mark.parametrize(
    "method",
    [
        "project..task.write",
        "move.post",
        "account.move.",
        ".account.move.x",
        " account.move.action_post",
        "account.move.action-post",
        "account.move",
    ],
)
def test_policy_method_grammar_rejects_typescript_invalid_entries(method: str) -> None:
    with pytest.raises(ValidationError):
        _policy(method)
