import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

type FixtureMode = "legacy" | "native";
type JsonRecord = Record<string, unknown>;

type CapturedRequest = {
  at: string;
  method: string;
  path: string;
  status: number;
  body: unknown;
};

type TestResponse = {
  status: number;
  error: string;
};

type FixtureState = {
  connection: JsonRecord | null;
  lastPut: JsonRecord | null;
  nextTestResponse: TestResponse;
  requests: CapturedRequest[];
};

const HOST = "127.0.0.1";
const PORT = 4011;
const USER_ID = "native-test-user";
const ACTOR_ID = "fixture-admin";
const FIXED_NOW = Date.parse("2026-01-15T12:00:00.000Z");
const MAX_BODY_BYTES = 64 * 1024;
const LEGACY_WRITABLE_FIELDS = new Set(["name", "description", "date_deadline", "priority"]);
const ODOO_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIXTURE_MODE = readMode(process.env.ODOO_NATIVE_FIXTURE_MODE);
const ACTION_LOG =
  process.env.ODOO_NATIVE_ACTION_LOG ??
  path.join(
    "/tmp/opencode/odoo-native-qa",
    FIXTURE_MODE === "legacy" ? "red" : "green",
    "action-log.jsonl",
  );

const targetUser = {
  id: USER_ID,
  name: "Native Test User",
  email: "native-test@example.test",
  image: null,
  role: "admin",
  banned: false,
  banReason: null,
  banExpires: null,
  emailVerified: true,
  createdAt: "2025-12-01T00:00:00.000Z",
  updatedAt: "2026-01-15T12:00:00.000Z",
  accounts: [],
  twoFactor: [],
  passkeys: [],
};

function readMode(value: string | undefined): FixtureMode {
  if (!value || value === "legacy") return "legacy";
  if (value === "native") return "native";
  throw new Error(`ODOO_NATIVE_FIXTURE_MODE must be legacy or native, received ${value}`);
}

function legacyPolicy(): JsonRecord {
  return {
    readProjects: true,
    readTasks: true,
    createTasks: false,
    updateTasks: false,
    allowedProjectIds: [42],
    writableFields: ["name"],
  };
}

function nativePolicy(): JsonRecord {
  return {
    policyVersion: 2,
    enableWrites: false,
    allowedSideEffectMethods: [],
  };
}

function initialConnection(): JsonRecord {
  return {
    id: "fixture-odoo-connection",
    userId: USER_ID,
    provider: "odoo",
    baseUrl: "https://erp.vortex.so",
    database: "fixture-db",
    login: "native-test@example.test",
    enabled: true,
    version: 7,
    hasCredential: true,
    testedVersion: null,
    testedAt: null,
    testStatus: "not_tested",
    odooUid: null,
    policy: FIXTURE_MODE === "legacy" ? legacyPolicy() : nativePolicy(),
    createdAt: FIXED_NOW - 86_400_000,
    updatedAt: FIXED_NOW,
  };
}

function freshState(): FixtureState {
  return {
    connection: initialConnection(),
    lastPut: null,
    nextTestResponse: { status: 200, error: "fixture_test_failed" },
    requests: [],
  };
}

let state = freshState();

mkdirSync(path.dirname(ACTION_LOG), { recursive: true });
writeFileSync(ACTION_LOG, "", "utf8");

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;

  const sanitized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (/api.?key|secret|credential|token/i.test(key)) {
      sanitized[`${key}Present`] = typeof entry === "string" ? entry.length > 0 : entry != null;
      continue;
    }
    sanitized[key] = sanitize(entry);
  }
  return sanitized;
}

function appendAction(entry: JsonRecord): void {
  appendFileSync(
    ACTION_LOG,
    `${JSON.stringify({ at: new Date().toISOString(), mode: FIXTURE_MODE, ...entry })}\n`,
    "utf8",
  );
}

function recordRequest(
  req: IncomingMessage,
  requestPath: string,
  status: number,
  body: unknown,
): void {
  const entry: CapturedRequest = {
    at: new Date().toISOString(),
    method: req.method ?? "GET",
    path: requestPath,
    status,
    body: sanitize(body),
  };
  state.requests.push(entry);
  appendAction({ type: "http", ...entry });
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  status: number,
  payload: unknown,
  requestBody: unknown = null,
): void {
  recordRequest(req, requestPath, status, requestBody);
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function connectionEnvelope(): JsonRecord {
  return {
    connection: state.connection,
    gatewayUrl: "http://127.0.0.1:4011/mcp/odoo",
    profileAllowsOdoo: true,
  };
}

function mutationEnvelope(): JsonRecord {
  return { connection: state.connection };
}

function hasFixtureSession(req: IncomingMessage): boolean {
  return (req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .includes("native_fixture_session=true");
}

async function readJson(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json_object");
  }
  return parsed as JsonRecord;
}

function versionOf(connection: JsonRecord | null): number {
  return typeof connection?.version === "number" ? connection.version : 0;
}

function matchesVersion(value: unknown, expected: number, positive = false): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (!positive || value > 0) &&
    value === expected
  );
}

function normalizeLegacyPolicy(value: unknown): JsonRecord {
  const policy = value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
  const allowedProjectIds = Array.isArray(policy.allowedProjectIds)
    ? [...new Set(policy.allowedProjectIds.filter(
        (entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry > 0,
      ))].sort((left, right) => left - right).slice(0, 100)
    : [];
  const writableFields = Array.isArray(policy.writableFields)
    ? [...new Set(policy.writableFields.filter(
        (entry): entry is string => typeof entry === "string" && LEGACY_WRITABLE_FIELDS.has(entry),
      ))]
    : [];

  return {
    readProjects: policy.readProjects === true,
    readTasks: policy.readTasks === true,
    createTasks: policy.createTasks === true,
    updateTasks: policy.updateTasks === true,
    allowedProjectIds,
    writableFields,
  };
}

function normalizeNativePolicy(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_policy");
  }
  const policy = value as JsonRecord;
  const keys = Object.keys(policy).sort();
  const expectedKeys = ["allowedSideEffectMethods", "enableWrites", "policyVersion"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    policy.policyVersion !== 2 ||
    typeof policy.enableWrites !== "boolean" ||
    !Array.isArray(policy.allowedSideEffectMethods) ||
    policy.allowedSideEffectMethods.length > 200
  ) {
    throw new Error("invalid_policy");
  }

  const methods = policy.allowedSideEffectMethods.map((entry) => {
    if (typeof entry !== "string") throw new Error("invalid_policy");
    const method = entry.trim();
    const parts = method.split(".");
    if (
      method.length === 0 ||
      method.length > 256 ||
      parts.length < 3 ||
      parts.some((part) => !ODOO_IDENTIFIER.test(part))
    ) {
      throw new Error("invalid_policy");
    }
    return method;
  });

  return {
    policyVersion: 2,
    enableWrites: policy.enableWrites,
    allowedSideEffectMethods: [...new Set(methods)].sort(),
  };
}

function policyForPut(body: JsonRecord): JsonRecord {
  return FIXTURE_MODE === "legacy"
    ? normalizeLegacyPolicy(body.policy)
    : normalizeNativePolicy(body.policy);
}

function connectionFromPut(body: JsonRecord, policy: JsonRecord): JsonRecord {
  const previous = state.connection;
  const now = Date.now();
  const suppliedApiKey = typeof body.apiKey === "string" && body.apiKey.length > 0;
  const database = typeof body.database === "string" ? body.database : "fixture-db";
  const login = typeof body.login === "string" ? body.login : "native-test@example.test";
  const identityChanged =
    !previous ||
    previous.hasCredential !== true ||
    previous.database !== database ||
    previous.login !== login;
  const policyChanged = JSON.stringify(previous?.policy) !== JSON.stringify(policy);
  const configChanged = identityChanged || policyChanged || suppliedApiKey;
  const nextVersion = versionOf(previous) + 1;
  const preserveTest =
    !configChanged &&
    previous?.testStatus === "ok" &&
    previous.testedVersion === versionOf(previous);

  return {
    id: String(previous?.id ?? "fixture-odoo-connection"),
    userId: USER_ID,
    provider: "odoo",
    baseUrl: "https://erp.vortex.so",
    database,
    login,
    enabled: body.enabled === true,
    version: nextVersion,
    hasCredential: previous?.hasCredential === true || suppliedApiKey,
    testedVersion: preserveTest ? nextVersion : configChanged ? null : previous?.testedVersion ?? null,
    testedAt: configChanged ? null : previous?.testedAt ?? null,
    testStatus: preserveTest ? "ok" : configChanged ? "not_tested" : previous?.testStatus ?? "not_tested",
    odooUid: configChanged ? null : previous?.odooUid ?? null,
    policy,
    createdAt: typeof previous?.createdAt === "number" ? previous.createdAt : now,
    updatedAt: now,
  };
}

function statePayload(): JsonRecord {
  return {
    mode: FIXTURE_MODE,
    userId: USER_ID,
    actorId: ACTOR_ID,
    connection: state.connection,
    lastPut: state.lastPut,
    nextTestResponse: state.nextTestResponse,
    requests: state.requests,
    actionLog: ACTION_LOG,
  };
}

async function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === "/__fixture__/health" && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, { ok: true, mode: FIXTURE_MODE });
    return true;
  }

  if (url.pathname === "/__fixture__/state" && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, statePayload());
    return true;
  }

  if (url.pathname === "/__fixture__/reset" && req.method === "POST") {
    const priorRequestCount = state.requests.length;
    state = freshState();
    appendAction({ type: "reset", priorRequestCount });
    sendJson(req, res, url.pathname, 200, statePayload());
    return true;
  }

  if (url.pathname === "/__fixture__/test-response" && req.method === "POST") {
    const body = await readJson(req);
    const status = Number(body.status);
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      sendJson(req, res, url.pathname, 400, { error: "invalid_status" }, body);
      return true;
    }
    state.nextTestResponse = {
      status,
      error: typeof body.error === "string" ? body.error : "fixture_test_failed",
    };
    sendJson(req, res, url.pathname, 200, { nextTestResponse: state.nextTestResponse }, body);
    return true;
  }

  return false;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (await handleControl(req, res, url)) return;

  if (!hasFixtureSession(req)) {
    sendJson(req, res, url.pathname, 401, { error: "unauthenticated" });
    return;
  }

  if (url.pathname === "/api/auth/get-session" && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, {
      session: {
        id: "fixture-admin-session",
        userId: ACTOR_ID,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      user: {
        id: ACTOR_ID,
        name: "Fixture Admin",
        email: "fixture-admin@example.test",
        role: "admin",
      },
    });
    return;
  }

  if (url.pathname === `/admin/user/${USER_ID}/details` && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, { user: targetUser });
    return;
  }

  if (url.pathname === "/admin/users" && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, {
      users: [targetUser],
      next_cursor: null,
      total: 1,
    });
    return;
  }

  if (url.pathname === "/api/auth/admin/list-user-sessions" && req.method === "POST") {
    const body = await readJson(req);
    sendJson(req, res, url.pathname, 200, { sessions: [] }, body);
    return;
  }

  if (
    (url.pathname === "/api/auth/admin/revoke-user-session" ||
      url.pathname === "/api/auth/admin/revoke-user-sessions") &&
    req.method === "POST"
  ) {
    const body = await readJson(req);
    sendJson(req, res, url.pathname, 200, { success: true }, body);
    return;
  }

  if (url.pathname === "/admin/audit" && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, {
      items: [
        {
          id: "fixture-audit-1",
          created_at: FIXED_NOW,
          action: "admin.byok.odoo.fixture",
          actor_email_snapshot: "fixture-admin@example.test",
          actor_user_id: ACTOR_ID,
          target_type: "user",
          target_id: USER_ID,
          outcome: "success",
          status_code: 200,
          ip: HOST,
          user_agent: "odoo-native-http-fixture",
        },
      ],
      next_cursor: null,
      total: 1,
    });
    return;
  }

  const byokPath = `/admin/users/${USER_ID}/byok/odoo`;
  if (url.pathname === byokPath && req.method === "GET") {
    sendJson(req, res, url.pathname, 200, connectionEnvelope());
    return;
  }

  if (url.pathname === byokPath && req.method === "PUT") {
    const body = await readJson(req);
    if (!matchesVersion(body.version, versionOf(state.connection))) {
      sendJson(req, res, url.pathname, 409, { error: "version_conflict" }, body);
      return;
    }
    if (!state.connection && !(typeof body.apiKey === "string" && body.apiKey.length > 0)) {
      sendJson(req, res, url.pathname, 400, { error: "api_key_required" }, body);
      return;
    }
    let policy: JsonRecord;
    try {
      policy = policyForPut(body);
    } catch {
      sendJson(req, res, url.pathname, 400, { error: "invalid_policy" }, body);
      return;
    }
    state.lastPut = sanitize(body) as JsonRecord;
    state.connection = connectionFromPut(body, policy);
    sendJson(req, res, url.pathname, 200, mutationEnvelope(), body);
    return;
  }

  if (url.pathname === `${byokPath}/test` && req.method === "POST") {
    const body = await readJson(req);
    if (!state.connection || !matchesVersion(body.version, versionOf(state.connection), true)) {
      sendJson(req, res, url.pathname, 409, { error: "version_conflict" }, body);
      return;
    }

    const configured = state.nextTestResponse;
    state.nextTestResponse = { status: 200, error: "fixture_test_failed" };
    if (configured.status < 200 || configured.status >= 300) {
      state.connection = {
        ...state.connection,
        testedVersion: null,
        testedAt: Date.now(),
        testStatus: "failed",
        odooUid: null,
        updatedAt: Date.now(),
      };
      sendJson(req, res, url.pathname, configured.status, { error: configured.error }, body);
      return;
    }

    state.connection = {
      ...state.connection,
      testedVersion: versionOf(state.connection),
      testedAt: Date.now(),
      testStatus: "ok",
      odooUid: 73,
      updatedAt: Date.now(),
    };
    sendJson(req, res, url.pathname, configured.status, mutationEnvelope(), body);
    return;
  }

  if (url.pathname === byokPath && req.method === "DELETE") {
    const versionText = url.searchParams.get("version");
    const version = versionText === null || versionText.trim() === "" ? null : Number(versionText);
    if (!state.connection || !matchesVersion(version, versionOf(state.connection), true)) {
      sendJson(req, res, url.pathname, 409, { error: "version_conflict" });
      return;
    }
    const now = Date.now();
    state.connection = {
      ...state.connection,
      enabled: false,
      version: versionOf(state.connection) + 1,
      hasCredential: false,
      testedVersion: null,
      testedAt: null,
      testStatus: "not_tested",
      odooUid: null,
      updatedAt: now,
    };
    sendJson(req, res, url.pathname, 200, mutationEnvelope());
    return;
  }

  sendJson(req, res, url.pathname, 404, { error: "fixture_route_not_found" });
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "fixture_error";
    const status = message === "payload_too_large" ? 413 : 400;
    sendJson(req, res, req.url ?? "/", status, { error: message });
  });
});

function shutdown(signal: string): void {
  appendAction({ type: "shutdown", signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 4_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, HOST, () => {
  appendAction({ type: "startup", host: HOST, port: PORT });
  console.log(`odoo-native fixture (${FIXTURE_MODE}) listening on http://${HOST}:${PORT}`);
});
