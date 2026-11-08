from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import time
from collections.abc import Callable, Iterator
from contextlib import AsyncExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, Tool

from .models import ADAPTER_CONTRACT, ResolveResponse

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
NATIVE_TOOL_SET = frozenset(NATIVE_TOOL_NAMES)
# Matches odoo_mcp.server.WRITE_APPROVAL_TTL_SECONDS (asserted in tests).
WRITE_APPROVAL_TTL_SECONDS = 600
ASYNC_TASK_PIN_SECONDS = 660
_MUTATION_TOOLS = frozenset({"execute_approved_write", "execute_method", "chatter_post"})
_CROSS_INSTANCE_TOOLS = frozenset(
    {
        "search_across_instances",
        "aggregate_across_instances",
        "accounting_health_across_instances",
    }
)


class WorkerError(RuntimeError):
    pass


class WorkerOverloaded(WorkerError):
    pass


class WorkerTimedOut(WorkerError):
    pass


class MutationOutcomeUnknown(WorkerTimedOut):
    pass


@dataclass(frozen=True, slots=True)
class WorkerKey:
    subject: str
    connection_id: str
    version: int
    policy_hash: str
    adapter_contract: str


@dataclass(slots=True)
class _WorkerJob:
    tool: str
    arguments: dict[str, Any]
    mutation: bool
    future: asyncio.Future[CallToolResult]


@contextmanager
def _discarded_stderr() -> Iterator[TextIO]:
    with open(os.devnull, "w", encoding="utf-8") as errlog:
        yield errlog


def _canonical_policy_hash(config: ResolveResponse) -> str:
    canonical = json.dumps(
        {
            "policyVersion": 2,
            "enableWrites": config.policy.enable_writes,
            "allowedSideEffectMethods": config.policy.canonical_methods(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def worker_key(config: ResolveResponse) -> WorkerKey:
    return WorkerKey(
        subject=config.user_id,
        connection_id=config.connection_id,
        version=config.version,
        policy_hash=_canonical_policy_hash(config),
        adapter_contract=config.adapter_contract,
    )


def _walk_host_boundary(value: Any) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key.endswith("_from_path"):
                raise WorkerError("local file uploads are unavailable on the hosted adapter")
            if key == "instance" and nested not in (None, "default"):
                raise WorkerError("only the default Odoo instance is available")
            if key == "instances" and nested not in (None, "default", ["default"]):
                raise WorkerError("cross-instance calls are limited to ['default']")
            _walk_host_boundary(nested)
    elif isinstance(value, list):
        for nested in value:
            _walk_host_boundary(nested)


def normalize_hosted_arguments(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    loaded = json.loads(json.dumps(arguments))
    if not isinstance(loaded, dict):
        raise WorkerError("tool arguments must be an object")
    normalized: dict[str, Any] = loaded
    _walk_host_boundary(normalized)
    if tool == "submit_async_task":
        if normalized.get("operation") == "scan_addons_source":
            raise WorkerError("scan_addons_source is unavailable on the hosted adapter")
        params = normalized.setdefault("params", {})
        if isinstance(params, dict) and normalized.get("operation") in _CROSS_INSTANCE_TOOLS:
            params["instances"] = ["default"]
    elif tool in _CROSS_INSTANCE_TOOLS:
        normalized["instances"] = ["default"]
    return normalized


class _NativeWorker:
    def __init__(
        self,
        key: WorkerKey,
        config: ResolveResponse,
        *,
        worker_timeout_seconds: float,
        queue_timeout_seconds: float,
        clock: Callable[[], float],
    ) -> None:
        self.key = key
        self.config = config
        self._worker_timeout_seconds = worker_timeout_seconds
        self._queue_timeout_seconds = queue_timeout_seconds
        self._clock = clock
        self._queue: asyncio.Queue[_WorkerJob | None] = asyncio.Queue(maxsize=8)
        self._ready: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._owner = asyncio.create_task(self._run(), name=f"odoo-worker:{key.subject}")
        self.last_used = clock()
        self.active = False
        self.closed = False
        self.failure: WorkerError | None = None
        self.temp_dir: Path | None = None
        # Upstream keeps native approvals and async task ids in-process, so a worker
        # holding them must not be evicted or idle-expired until they lapse.
        self._approval_expiries: list[float] = []
        self._async_pinned_until = 0.0

    @property
    def idle(self) -> bool:
        return not self.active and self._queue.empty()

    def pinned(self, now: float) -> bool:
        self._approval_expiries = [expiry for expiry in self._approval_expiries if expiry > now]
        return bool(self._approval_expiries) or self._async_pinned_until > now

    def _closed_error(self) -> WorkerError:
        return self.failure or WorkerError("upstream worker is closed")

    async def call(self, tool: str, arguments: dict[str, Any]) -> CallToolResult:
        try:
            await asyncio.wait_for(
                asyncio.shield(self._ready), timeout=self._worker_timeout_seconds
            )
        except TimeoutError as exc:
            raise WorkerTimedOut("upstream worker startup timed out") from exc
        if self.failure is not None or self.closed:
            raise self._closed_error()
        future: asyncio.Future[CallToolResult] = asyncio.get_running_loop().create_future()
        job = _WorkerJob(tool, arguments, tool in _MUTATION_TOOLS, future)
        try:
            await asyncio.wait_for(self._queue.put(job), timeout=self._queue_timeout_seconds)
        except TimeoutError as exc:
            raise WorkerOverloaded("worker queue wait timed out") from exc
        if self.closed:
            # The owner already drained the queue; nobody else will reject this job.
            self._reject_pending(self._closed_error())
        return await future

    def _record_state(self, job: _WorkerJob, result: CallToolResult | None) -> None:
        now = self._clock()
        if job.tool == "execute_approved_write" and self._approval_expiries:
            self._approval_expiries.pop(0)
        if result is None or result.is_error:
            return
        if job.tool == "validate_write":
            self._approval_expiries.append(now + WRITE_APPROVAL_TTL_SECONDS)
        elif job.tool == "submit_async_task":
            self._async_pinned_until = now + ASYNC_TASK_PIN_SECONDS

    async def close(self) -> None:
        if self.closed:
            await self._owner
            return
        try:
            self._queue.put_nowait(None)
        except asyncio.QueueFull:
            await self._queue.put(None)
        try:
            await asyncio.wait_for(
                self._owner,
                timeout=self._worker_timeout_seconds + self._queue_timeout_seconds,
            )
        except TimeoutError:
            self._owner.cancel()
            await asyncio.gather(self._owner, return_exceptions=True)

    async def _run(self) -> None:
        try:
            with tempfile.TemporaryDirectory(prefix="vortex-odoo-") as temp_name:
                self.temp_dir = Path(temp_name)
                self.temp_dir.chmod(0o700)
                parameters = StdioServerParameters(
                    command=sys.executable,
                    args=["-m", "odoo_adapter.upstream_worker"],
                    env=_worker_env(self.config, self.temp_dir),
                    cwd=self.temp_dir,
                )
                async with AsyncExitStack() as stack:
                    errlog = stack.enter_context(_discarded_stderr())
                    streams = await stack.enter_async_context(
                        stdio_client(parameters, errlog=errlog)
                    )
                    session = await stack.enter_async_context(ClientSession(*streams))
                    await session.initialize()
                    listed = await session.list_tools()
                    if tuple(tool.name for tool in listed.tools) != NATIVE_TOOL_NAMES:
                        raise WorkerError("upstream tool surface did not match native contract")
                    self._ready.set_result(None)
                    while True:
                        job = await self._queue.get()
                        if job is None:
                            self._queue.task_done()
                            break
                        self.active = True
                        try:
                            async with asyncio.timeout(self._worker_timeout_seconds):
                                result = await session.call_tool(job.tool, job.arguments)
                            self._record_state(job, result)
                            if not job.future.done():
                                job.future.set_result(result)
                        except Exception as exc:
                            self._record_state(job, None)
                            error: WorkerError
                            if job.mutation:
                                error = MutationOutcomeUnknown(
                                    "upstream worker failed after mutation dispatch; "
                                    "validation must be repeated"
                                )
                            elif isinstance(exc, TimeoutError):
                                error = WorkerTimedOut("upstream worker timed out")
                            else:
                                error = WorkerError("upstream worker failed")
                            # Mark failed before waking the caller so new calls fail fast.
                            self.failure = error
                            if not job.future.done():
                                job.future.set_exception(error)
                            raise error from exc
                        finally:
                            self.active = False
                            self.last_used = self._clock()
                            self._queue.task_done()
        except Exception as exc:
            error = exc if isinstance(exc, WorkerError) else WorkerError("upstream worker failed")
            self.failure = self.failure or error
        finally:
            # No await between marking closed and draining: any job enqueued later is
            # rejected by its own caller in call().
            self.closed = True
            self.temp_dir = None
            if not self._ready.done():
                self._ready.set_exception(self._closed_error())
                self._ready.exception()
            self._reject_pending(self._closed_error())

    def _reject_pending(self, error: WorkerError) -> None:
        while True:
            try:
                job = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if job is not None and not job.future.done():
                job.future.set_exception(error)
            self._queue.task_done()


def _worker_env(config: ResolveResponse, temp_dir: Path) -> dict[str, str]:
    if config.odoo_uid is None:
        raise WorkerError("native worker requires a tested Odoo UID")
    return {
        "HOME": str(temp_dir),
        "TMPDIR": str(temp_dir),
        "XDG_CONFIG_HOME": str(temp_dir / "config"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "MCP_TRANSPORT": "stdio",
        "MCP_LOG_LEVEL": "CRITICAL",
        "ODOO_MCP_LOG_LEVEL": "CRITICAL",
        "ODOO_MCP_LOG_JSON": "0",
        "ODOO_MCP_PLUGINS": "",
        "ODOO_MCP_TOOLS_EXCLUDE": "scan_addons_source",
        "ODOO_MCP_ALLOW_UNKNOWN_METHODS": "0",
        "ODOO_MCP_ELICIT_WRITES": "0",
        "ODOO_MCP_ENABLE_WRITES": "1" if config.policy.enable_writes else "0",
        "ODOO_MCP_ALLOWED_SIDE_EFFECT_METHODS": ",".join(
            config.policy.allowed_side_effect_methods
        ),
        "ODOO_MCP_RETRY_ATTEMPTS": "0",
        "ODOO_MCP_ASYNC_MAX_WORKERS": "1",
        "ODOO_MCP_ASYNC_MAX_TASKS": "8",
        "ODOO_MCP_CROSS_INSTANCE_WORKERS": "1",
        "ODOO_MCP_SCHEMA_CACHE_MAX": "32",
        "ODOO_MCP_SCHEMA_CACHE_TTL": "600",
        "ODOO_URL": config.base_url,
        "ODOO_DB": config.database,
        "ODOO_USERNAME": config.login,
        "ODOO_PASSWORD": config.api_key,
        "ODOO_TRANSPORT": "xmlrpc",
        "ODOO_TIMEOUT": "10",
        "ODOO_VERIFY_SSL": "1",
        "VORTEX_EXPECTED_ODOO_UID": str(config.odoo_uid),
    }


class WorkerBroker:
    def __init__(
        self,
        *,
        queue_timeout_seconds: float,
        worker_timeout_seconds: float,
        max_workers: int = 2,
        idle_timeout_seconds: float = 660,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._queue_timeout_seconds = queue_timeout_seconds
        self._worker_timeout_seconds = worker_timeout_seconds
        self.max_workers = max_workers
        self.idle_timeout_seconds = idle_timeout_seconds
        self._clock = clock
        self._lock = asyncio.Lock()
        self._workers: dict[WorkerKey, _NativeWorker] = {}

    async def call(
        self,
        config: ResolveResponse,
        tool: str,
        arguments: dict[str, Any],
    ) -> CallToolResult:
        if tool not in NATIVE_TOOL_SET:
            raise WorkerError("adapter attempted an unapproved upstream tool")
        normalized = normalize_hosted_arguments(tool, arguments)
        worker = await self._worker_for(config)
        try:
            return await worker.call(tool, normalized)
        except WorkerError:
            await self._discard(worker)
            raise

    async def retire_owner(self, subject: str, connection_id: str) -> None:
        async with self._lock:
            retiring = [
                worker
                for key, worker in self._workers.items()
                if key.subject == subject and key.connection_id == connection_id
            ]
            for worker in retiring:
                self._workers.pop(worker.key, None)
        await asyncio.gather(*(worker.close() for worker in retiring), return_exceptions=True)

    async def close(self) -> None:
        async with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        await asyncio.gather(*(worker.close() for worker in workers), return_exceptions=True)

    async def _worker_for(self, config: ResolveResponse) -> _NativeWorker:
        key = worker_key(config)
        to_close: list[_NativeWorker] = []
        async with self._lock:
            now = self._clock()
            for existing_key, existing in list(self._workers.items()):
                same_owner = (
                    existing_key.subject == key.subject
                    and existing_key.connection_id == key.connection_id
                )
                expired = (
                    existing.idle
                    and now - existing.last_used >= self.idle_timeout_seconds
                    and not existing.pinned(now)
                )
                superseded = same_owner and existing_key != key and existing.idle
                failed = existing.closed or existing.failure is not None
                if expired or superseded or failed:
                    self._workers.pop(existing_key, None)
                    to_close.append(existing)
            selected = self._workers.get(key)
            if selected is None:
                if len(self._workers) >= self.max_workers:
                    idle = [
                        candidate
                        for candidate in self._workers.values()
                        if candidate.idle and not candidate.pinned(now)
                    ]
                    if not idle:
                        raise WorkerOverloaded("all native workers are busy or hold approvals")
                    victim = min(idle, key=lambda candidate: candidate.last_used)
                    self._workers.pop(victim.key, None)
                    to_close.append(victim)
                selected = _NativeWorker(
                    key,
                    config,
                    worker_timeout_seconds=self._worker_timeout_seconds,
                    queue_timeout_seconds=self._queue_timeout_seconds,
                    clock=self._clock,
                )
                self._workers[key] = selected
        await asyncio.gather(*(candidate.close() for candidate in to_close), return_exceptions=True)
        return selected

    async def _discard(self, worker: _NativeWorker) -> None:
        async with self._lock:
            if self._workers.get(worker.key) is worker:
                self._workers.pop(worker.key, None)
        await worker.close()


def native_catalog() -> tuple[Tool, ...]:
    from odoo_mcp.server import mcp as upstream_mcp

    async def load() -> tuple[Tool, ...]:
        tools = await upstream_mcp.list_tools()
        return tuple(tool for tool in tools if tool.name != "scan_addons_source")

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(load())
    raise RuntimeError("native_catalog must be loaded before the application event loop starts")


assert ADAPTER_CONTRACT == "odoo-native-v2"
