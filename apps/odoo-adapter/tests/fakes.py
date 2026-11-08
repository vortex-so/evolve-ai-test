from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from socketserver import ThreadingMixIn
from typing import Any, cast
from xmlrpc.server import SimpleXMLRPCRequestHandler, SimpleXMLRPCServer

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


class _RpcHandler(SimpleXMLRPCRequestHandler):
    rpc_paths = ("/xmlrpc/2/common", "/xmlrpc/2/object")


class _ThreadedXmlRpcServer(ThreadingMixIn, SimpleXMLRPCServer):
    daemon_threads = True


@dataclass
class FakeOdooState:
    users: dict[str, tuple[str, int, int]] = field(
        default_factory=lambda: {
            "alice@example.com": ("alice-key", 11, 1),
            "bob@example.com": ("bob-key", 22, 2),
        }
    )
    projects: dict[int, dict[str, Any]] = field(
        default_factory=lambda: {
            1: {"id": 1, "name": "Alpha", "active": True},
            2: {"id": 2, "name": "Beta", "active": True},
        }
    )
    partners: dict[int, dict[str, Any]] = field(
        default_factory=lambda: {
            10: {
                "id": 10,
                "name": "Alice Partner",
                "email": "alice.partner@example.com",
                "owner_scope": 1,
            },
            20: {
                "id": 20,
                "name": "Bob Partner",
                "email": "bob.partner@example.com",
                "owner_scope": 2,
            },
        }
    )
    account_moves: dict[int, dict[str, Any]] = field(
        default_factory=lambda: {
            1001: {"id": 1001, "name": "ALICE/2026/001", "state": "draft", "owner_scope": 1},
            2002: {"id": 2002, "name": "BOB/2026/001", "state": "draft", "owner_scope": 2},
        }
    )
    tasks: dict[int, dict[str, Any]] = field(
        default_factory=lambda: {
            101: {
                "id": 101,
                "name": "Alpha task",
                "description": "first",
                "date_deadline": False,
                "priority": "0",
                "project_id": [1, "Alpha"],
            },
            202: {
                "id": 202,
                "name": "Beta task",
                "description": "second",
                "date_deadline": False,
                "priority": "1",
                "project_id": [2, "Beta"],
            },
        }
    )
    writes: list[dict[str, Any]] = field(default_factory=list)
    side_effects: list[dict[str, Any]] = field(default_factory=list)
    next_task_id: int = 300
    next_partner_id: int = 30
    lock: threading.Lock = field(default_factory=threading.Lock)
    delay_seconds: float = 0

    def authenticate(self, database: str, login: str, password: str, context: Any) -> int:
        del context
        if database != "vortex":
            return 0
        user = self.users.get(login)
        return user[1] if user and user[0] == password else 0

    def execute_kw(
        self,
        database: str,
        uid: int,
        password: str,
        model: str,
        method: str,
        args: list[Any],
        kwargs: dict[str, Any],
    ) -> Any:
        if self.delay_seconds:
            time.sleep(self.delay_seconds)
        project_id = self._authorized_project(database, uid, password)
        if method == "fields_get":
            return self._fields(model)
        if method == "search_read":
            return self._search_read(model, project_id, args, kwargs)
        if method == "read":
            return self._read(model, project_id, args, kwargs)
        if method == "search_count":
            return len(self._search_read(model, project_id, args, {**kwargs, "limit": 10_000}))
        if method == "read_group":
            return []
        if model == "account.move" and method == "action_post":
            return self._action_post(project_id, args)
        if model == "res.partner" and method == "create":
            return self._create_partner(project_id, args)
        if model == "res.partner" and method == "write":
            return self._write_partner(project_id, args)
        if model != "project.task":
            raise ValueError("model not allowed")
        if method == "create":
            return self._create(project_id, args)
        if method == "write":
            return self._write(project_id, args)
        raise ValueError("method not allowed")

    def _authorized_project(self, database: str, uid: int, password: str) -> int:
        if database != "vortex":
            raise ValueError("bad database")
        for expected_password, expected_uid, project_id in self.users.values():
            if uid == expected_uid and password == expected_password:
                return project_id
        raise ValueError("access denied")

    @staticmethod
    def _fields(model: str) -> dict[str, dict[str, Any]]:
        if model == "project.project":
            names = {"id": "integer", "name": "char", "active": "boolean"}
        elif model == "project.task":
            names = {
                "id": "integer",
                "name": "char",
                "description": "html",
                "date_deadline": "date",
                "priority": "selection",
                "project_id": "many2one",
            }
        elif model == "res.partner":
            names = {"id": "integer", "name": "char", "email": "char"}
        elif model == "account.move":
            names = {"id": "integer", "name": "char", "state": "selection"}
        else:
            raise ValueError("model not allowed")
        return {
            name: {
                "type": field_type,
                "string": name.replace("_", " ").title(),
                "readonly": name == "id",
                "required": name == "name",
                "store": True,
            }
            for name, field_type in names.items()
        }

    def _search_read(
        self, model: str, project_id: int, args: list[Any], kwargs: dict[str, Any]
    ) -> list[dict[str, Any]]:
        domain = args[0] if args else []
        if model == "project.project":
            records = list(self.projects.values())
            records = [record for record in records if record["id"] == project_id]
        elif model == "project.task":
            records = list(self.tasks.values())
            records = [record for record in records if record["project_id"][0] == project_id]
        elif model == "res.partner":
            records = list(self.partners.values())
            records = [record for record in records if record["owner_scope"] == project_id]
        elif model == "account.move":
            records = list(self.account_moves.values())
            records = [record for record in records if record["owner_scope"] == project_id]
        else:
            raise ValueError("model not allowed")
        records = [record for record in records if self._matches(record, domain)]
        offset = int(kwargs.get("offset", 0))
        limit = int(kwargs.get("limit", 10))
        return [
            self._select(record, kwargs.get("fields"))
            for record in records[offset : offset + limit]
        ]

    def _read(
        self, model: str, project_id: int, args: list[Any], kwargs: dict[str, Any]
    ) -> list[dict[str, Any]]:
        ids = args[0]
        if model == "project.project":
            source = self.projects
        elif model == "project.task":
            source = self.tasks
        elif model == "res.partner":
            source = self.partners
        elif model == "account.move":
            source = self.account_moves
        else:
            raise ValueError("model not allowed")
        records = []
        for record_id in ids:
            record = source.get(record_id)
            if record is None:
                continue
            if model == "project.project":
                actual_project = record["id"]
            elif model == "project.task":
                actual_project = record["project_id"][0]
            else:
                actual_project = record["owner_scope"]
            if actual_project == project_id:
                records.append(self._select(record, kwargs.get("fields")))
        return records

    def _create(self, project_id: int, args: list[Any]) -> int:
        values = dict(args[0])
        if values.get("project_id") != project_id:
            raise ValueError("project access denied")
        with self.lock:
            self.next_task_id += 1
            task_id = self.next_task_id
            record = {
                "id": task_id,
                "name": values["name"],
                "description": values.get("description", ""),
                "date_deadline": values.get("date_deadline", False),
                "priority": values.get("priority", "0"),
                "project_id": [project_id, self.projects[project_id]["name"]],
            }
            self.tasks[task_id] = record
            self.writes.append({"operation": "create", "id": task_id, "values": values})
        return task_id

    def _write(self, project_id: int, args: list[Any]) -> bool:
        ids, values = args
        with self.lock:
            for task_id in ids:
                task = self.tasks.get(task_id)
                if task is None or task["project_id"][0] != project_id:
                    raise ValueError("task access denied")
                if any(key in values for key in ("project_id", "stage_id", "user_ids")):
                    raise ValueError("relationship update denied")
                task.update(values)
                self.writes.append({"operation": "update", "id": task_id, "values": values})
        return True

    def _create_partner(self, project_id: int, args: list[Any]) -> int:
        values = dict(args[0])
        with self.lock:
            self.next_partner_id += 1
            partner_id = self.next_partner_id
            self.partners[partner_id] = {
                "id": partner_id,
                "name": values["name"],
                "email": values.get("email", False),
                "owner_scope": project_id,
            }
            self.writes.append(
                {
                    "operation": "create",
                    "model": "res.partner",
                    "id": partner_id,
                    "values": values,
                }
            )
        return partner_id

    def _write_partner(self, project_id: int, args: list[Any]) -> bool:
        ids, values = args
        with self.lock:
            for partner_id in ids:
                partner = self.partners.get(partner_id)
                if partner is None or partner["owner_scope"] != project_id:
                    raise ValueError("partner access denied")
                partner.update(values)
                self.writes.append(
                    {
                        "operation": "write",
                        "model": "res.partner",
                        "id": partner_id,
                        "values": values,
                    }
                )
        return True

    def _action_post(self, project_id: int, args: list[Any]) -> bool:
        record_ids = args[0] if args else []
        with self.lock:
            for move_id in record_ids:
                move = self.account_moves.get(move_id)
                if move is None or move["owner_scope"] != project_id:
                    raise ValueError("account move access denied")
                move["state"] = "posted"
                self.side_effects.append(
                    {"model": "account.move", "method": "action_post", "id": move_id}
                )
        return True

    @staticmethod
    def _select(record: dict[str, Any], fields: Any) -> dict[str, Any]:
        if not fields:
            return {key: value for key, value in record.items() if key != "owner_scope"}
        return {field: record.get(field, False) for field in fields}

    @staticmethod
    def _matches(record: dict[str, Any], domain: list[Any]) -> bool:
        for term in domain:
            if not isinstance(term, (list, tuple)) or len(term) != 3:
                continue
            field_name, operator, expected = term
            actual = record.get(field_name)
            if isinstance(actual, list) and actual:
                actual = actual[0]
            if operator == "=" and actual != expected:
                return False
            if operator == "in" and actual not in expected:
                return False
        return True


class FakeOdooServer:
    def __init__(self) -> None:
        self.state = FakeOdooState()
        self.server = _ThreadedXmlRpcServer(
            ("127.0.0.1", 0), requestHandler=_RpcHandler, allow_none=True, logRequests=False
        )
        self.server.register_function(cast(Any, self.state.authenticate), "authenticate")
        self.server.register_function(cast(Any, self.state.execute_kw), "execute_kw")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def origin(self) -> str:
        address = self.server.server_address
        raw_host, port = address[0], address[1]
        host = raw_host.decode() if isinstance(raw_host, bytes) else raw_host
        return f"http://{host}:{port}"

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


@dataclass
class FakeConnection:
    connection_id: str
    user_id: str
    version: int
    base_url: str
    login: str
    api_key: str
    odoo_uid: int | None
    policy: dict[str, Any]


class FakeAuthServer:
    def __init__(self, odoo_origin: str, *, native_policy: bool = False) -> None:
        policy = (
            {
                "policyVersion": 2,
                "enableWrites": True,
                "allowedSideEffectMethods": ["account.move.action_post"],
            }
            if native_policy
            else {
                "readProjects": True,
                "readTasks": True,
                "createTasks": True,
                "updateTasks": True,
                "allowedProjectIds": [1],
                "writableFields": ["name", "description", "date_deadline", "priority"],
            }
        )
        self.connections = {
            "user-alice": FakeConnection(
                "conn-alice",
                "user-alice",
                1,
                odoo_origin,
                "alice@example.com",
                "alice-key",
                11,
                policy,
            ),
            "user-bob": FakeConnection(
                "conn-bob",
                "user-bob",
                1,
                odoo_origin,
                "bob@example.com",
                "bob-key",
                22,
                (
                    {
                        "policyVersion": 2,
                        "enableWrites": False,
                        "allowedSideEffectMethods": [],
                    }
                    if native_policy
                    else {**policy, "allowedProjectIds": [2]}
                ),
            ),
        }
        self.approvals: dict[str, dict[str, Any]] = {}
        self.audits: list[dict[str, Any]] = []
        self.completions: list[dict[str, Any]] = []
        self.counter = 0
        self.fail_complete = False
        self.native_policy = native_policy
        self.app = Starlette(
            routes=[
                Route("/internal/byok/resolve", self.resolve, methods=["POST"]),
                Route("/internal/byok/audit", self.audit, methods=["POST"]),
                Route("/internal/byok/approvals/preview", self.preview, methods=["POST"]),
                Route(
                    "/internal/byok/approvals/{approval_id:str}/claim",
                    self.claim,
                    methods=["POST"],
                ),
                Route(
                    "/internal/byok/approvals/{approval_id:str}/complete",
                    self.complete,
                    methods=["POST"],
                ),
            ]
        )

    def approve(self, approval_id: str) -> None:
        self.approvals[approval_id]["status"] = "approved"

    async def resolve(self, request: Request) -> JSONResponse:
        if self.native_policy and (
            request.headers.get("x-vortex-adapter-contract") != "odoo-native-v2"
        ):
            return JSONResponse({"error": "adapter_contract_required"}, status_code=400)
        claims = self._claims(request)
        user_id = str(claims["sub"])
        connection = self.connections[user_id]
        if (
            claims["connection_id"] != connection.connection_id
            or claims["version"] != connection.version
        ):
            return JSONResponse({"error": "connection_unavailable"}, status_code=403)
        return JSONResponse(
            {
                "connectionId": connection.connection_id,
                "userId": connection.user_id,
                "version": connection.version,
                "baseUrl": connection.base_url,
                "database": "vortex",
                "login": connection.login,
                "apiKey": connection.api_key,
                "policy": connection.policy,
                "odooUid": connection.odoo_uid,
                **({"adapterContract": "odoo-native-v2"} if self.native_policy else {}),
            }
        )

    async def audit(self, request: Request) -> JSONResponse:
        self._authorize(request)
        if self.native_policy and (
            request.headers.get("x-vortex-adapter-contract") != "odoo-native-v2"
        ):
            return JSONResponse({"error": "adapter_contract_required"}, status_code=400)
        body = await request.json()
        if not isinstance(body.get("tool"), str) or body.get("outcome") not in {
            "started",
            "success",
            "failure",
            "denied",
        }:
            return JSONResponse({"error": "invalid_audit"}, status_code=400)
        self.audits.append(body)
        return JSONResponse({"ok": True})

    async def preview(self, request: Request) -> JSONResponse:
        self._authorize(request)
        body = await request.json()
        self.counter += 1
        approval_id = str(uuid.uuid4())
        payload_hash = hashlib.sha256(
            json.dumps(
                {
                    "operation": body["operation"],
                    "payload": body["payload"],
                    "before": body.get("before"),
                },
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        self.approvals[approval_id] = {
            "approvalId": approval_id,
            "operation": body["operation"],
            "payload": body["payload"],
            "before": body.get("before"),
            "payloadHash": payload_hash,
            "status": "pending",
            "userId": self._user_id(request),
        }
        expires = datetime.now(UTC) + timedelta(minutes=5)
        return JSONResponse(
            {
                "approvalId": approval_id,
                "status": "pending",
                "expiresAt": int(expires.timestamp() * 1000),
                "payloadHash": payload_hash,
            }
        )

    async def claim(self, request: Request) -> JSONResponse:
        self._authorize(request)
        approval = self.approvals.get(request.path_params["approval_id"])
        if (
            approval is None
            or approval["status"] != "approved"
            or approval["userId"] != self._user_id(request)
        ):
            return JSONResponse({"error": "not_approved"}, status_code=409)
        approval["status"] = "executing"
        return JSONResponse(
            {key: value for key, value in approval.items() if key not in {"status", "userId"}}
        )

    async def complete(self, request: Request) -> JSONResponse:
        self._authorize(request)
        if self.fail_complete:
            return JSONResponse({"error": "audit_write_failed"}, status_code=500)
        approval_id = request.path_params["approval_id"]
        body = await request.json()
        self.approvals[approval_id]["status"] = body["status"]
        self.completions.append({"approvalId": approval_id, **body})
        return JSONResponse({"ok": True})

    def _authorize(self, request: Request) -> None:
        if request.headers.get("authorization") != "Bearer runtime-secret-runtime-secret-1234":
            raise ValueError("bad service token")

    def _user_id(self, request: Request) -> str:
        return str(self._claims(request)["sub"])

    def _claims(self, request: Request) -> dict[str, Any]:
        self._authorize(request)
        assertion = request.headers["x-vortex-identity"].removeprefix("Bearer ")
        payload = json.loads(_urlsafe_decode(assertion.split(".")[1]))
        if not isinstance(payload, dict):
            raise ValueError("invalid fake assertion")
        return cast(dict[str, Any], payload)


def _urlsafe_decode(value: str) -> str:
    import base64

    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded).decode()
