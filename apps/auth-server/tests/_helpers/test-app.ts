import { expect } from "vitest";
import type { Env } from "../../src/auth";
import app from "../../src/index";

export const TEST_PUBLIC_ORIGIN = "https://api.auth-dev.vortex.so";
export const TEST_CONSOLE_ORIGIN = "https://console.auth-dev.vortex.so";
export const TEST_WRONG_ORIGIN = "https://evil.example.com";

export type TestSession = {
  user: {
    id: string;
    email: string;
    role: string;
    banned?: boolean | number | string | null;
    banExpires?: string | number | null;
  };
  impersonatedBy?: {
    userId: string;
  } | null;
};

export type StatementPlan = {
  match: RegExp | string;
  first?: unknown;
  all?: unknown[];
  run?: { meta?: { changes?: number } };
  error?: Error;
};

type RecordedStatement = {
  sql: string;
  params: unknown[];
};

function d1Meta(changes = 0) {
  return {
    changes,
    last_row_id: 0,
    duration: 0,
    served_by: "test",
  };
}

export class D1Spy {
  readonly statements: RecordedStatement[] = [];
  readonly executions: RecordedStatement[] = [];
  readonly batches: RecordedStatement[][] = [];

  constructor(private readonly plans: StatementPlan[] = []) {}

  prepare(sql: string) {
    const findPlan = () =>
      this.plans.find((plan) =>
        typeof plan.match === "string" ? sql.includes(plan.match) : plan.match.test(sql),
      );

    return {
      bind: (...params: unknown[]) => {
        this.statements.push({ sql, params });
        const plan = findPlan();
        const bound = {
          __sql: sql,
          __params: params,
          __plan: plan,
          first: async () => {
            this.executions.push({ sql, params });
            if (plan?.error) throw plan.error;
            return plan?.first ?? null;
          },
          all: async () => {
            this.executions.push({ sql, params });
            if (plan?.error) throw plan.error;
            return { results: plan?.all ?? [], success: true, meta: d1Meta() };
          },
          run: async () => {
            this.executions.push({ sql, params });
            if (plan?.error) throw plan.error;
            return { success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) };
          },
          raw: async () => {
            this.executions.push({ sql, params });
            if (plan?.error) throw plan.error;
            return plan?.all ?? [];
          },
        };
        return bound;
      },
      first: async () => {
        this.statements.push({ sql, params: [] });
        this.executions.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return plan?.first ?? null;
      },
      all: async () => {
        this.statements.push({ sql, params: [] });
        this.executions.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return { results: plan?.all ?? [], success: true, meta: d1Meta() };
      },
      run: async () => {
        this.statements.push({ sql, params: [] });
        this.executions.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return { success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) };
      },
      raw: async () => {
        this.statements.push({ sql, params: [] });
        this.executions.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return plan?.all ?? [];
      },
    };
  }

  async batch<T>(items: T[]): Promise<T[]> {
    const statements = items.map((item) => {
      const prepared = item as T & {
        __sql?: string;
        __params?: unknown[];
        __plan?: StatementPlan;
      };
      return {
        sql: prepared.__sql ?? "",
        params: prepared.__params ?? [],
        plan: prepared.__plan,
      };
    });
    this.batches.push(statements.map(({ sql, params }) => ({ sql, params })));
    const failed = statements.find(({ plan }) => plan?.error);
    if (failed?.plan?.error) throw failed.plan.error;
    for (const { sql, params } of statements) this.executions.push({ sql, params });
    return items.map(() => ({ results: [], success: true, meta: d1Meta() })) as T[];
  }

  exec(_sql: string): Promise<{ count: number }> {
    return Promise.resolve({ count: 0 });
  }
}

export class KVSpy {
  readonly deleted: string[] = [];
  readonly reads: Array<{ key: string; type: string; withMetadata: boolean }> = [];
  private readonly entries: Map<string, { bytes: Uint8Array; metadata: unknown }>;

  constructor(entries: Record<string, string | ArrayBuffer | { value: string | ArrayBuffer; metadata?: unknown }> = {}) {
    this.entries = new Map(
      Object.entries(entries).map(([key, entry]) => {
        const value = typeof entry === "object" && entry !== null && "value" in entry
          ? entry.value
          : entry;
        const metadata = typeof entry === "object" && entry !== null && "value" in entry
          ? entry.metadata ?? null
          : null;
        return [key, { bytes: toBytes(value), metadata }];
      }),
    );
  }

  async get(key: string, type: "text" | "arrayBuffer" | "json" | "stream" = "text") {
    this.reads.push({ key, type, withMetadata: false });
    return this.readValue(key, type);
  }

  private readValue(key: string, type: "text" | "arrayBuffer" | "json" | "stream") {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (type === "arrayBuffer") return entry.bytes.slice().buffer;
    if (type === "stream") {
      const bytes = entry.bytes.slice();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }
    const text = new TextDecoder().decode(entry.bytes);
    return type === "json" ? JSON.parse(text) : text;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options: { metadata?: unknown } = {},
  ) {
    this.entries.set(key, { bytes: toBytes(value), metadata: options.metadata ?? null });
  }

  async delete(key: string) {
    this.deleted.push(key);
    this.entries.delete(key);
  }

  async list() {
    return { keys: [], list_complete: true, cursor: "" };
  }

  async getWithMetadata(key: string, type: "text" | "arrayBuffer" | "json" | "stream" = "text") {
    this.reads.push({ key, type, withMetadata: true });
    const entry = this.entries.get(key);
    if (!entry) return { value: null, metadata: null };
    return { value: this.readValue(key, type), metadata: entry.metadata };
  }

  async consume() {
    return { success: true };
  }
}

function toBytes(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  return new Uint8Array(value.slice(0));
}

export function createTestEnv(
  plans: StatementPlan[] = [],
  kvEntries: Record<string, string> = {},
  pluginKvEntries: Record<string, string | ArrayBuffer | { value: string | ArrayBuffer; metadata?: unknown }> = {},
  existingPluginsKV?: KVSpy,
) {
  const DB = new D1Spy(plans);
  const KV = new KVSpy(kvEntries);
  const PluginsKV = existingPluginsKV ?? new KVSpy(pluginKvEntries);
  return {
    DB,
    KV,
    PluginsKV,
    env: {
      DB: DB as unknown as Env["DB"],
      AUTH_KV: KV as unknown as Env["AUTH_KV"],
      PLUGINS_KV: PluginsKV as unknown as Env["PLUGINS_KV"],
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      NODE_ENV: "test",
      PUBLIC_ORIGIN: TEST_PUBLIC_ORIGIN,
      INFERENCE_GATEWAY_BASE_URL: TEST_PUBLIC_ORIGIN,
      LITELLM_BASE_URL: "https://llm-manager.example.test",
      LITELLM_ADMIN_KEY: "test-litellm-admin-key",
      LITELLM_MCP_ACCESS_GROUP: "vortex-claude-desktop",
      MCP_TOKEN_SECRET: "test-mcp-token-secret-test-mcp-token-secret",
      AUTH_WEB_ORIGIN: "https://auth.auth-dev.vortex.so",
      POSTMARK_SERVER_TOKEN: "test-postmark-token",
      POSTMARK_FROM: "noreply@auth-dev.vortex.so",
      PRODUCT_NAME: "Vortex Auth",
      PRODUCT_URL: "https://auth.auth-dev.vortex.so",
    },
  };
}

export function adminSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    user: {
      id: "admin-user-id",
      email: "admin@vortex.so",
      role: "admin",
    },
    impersonatedBy: null,
    ...overrides,
  };
}

export function userSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    user: {
      id: "plain-user-id",
      email: "user@vortex.so",
      role: "user",
    },
    impersonatedBy: null,
    ...overrides,
  };
}

export async function requestApp(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: BodyInit;
    headers?: HeadersInit;
    origin?: string | null;
    session?: TestSession | null;
      plans?: StatementPlan[];
      kvEntries?: Record<string, string>;
      pluginKvEntries?: Record<string, string | ArrayBuffer | { value: string | ArrayBuffer; metadata?: unknown }>;
      pluginsKV?: KVSpy;
      env?: Partial<Env>;
  } = {},
) {
  const currentAdminQuery =
    'SELECT role, banned, banExpires FROM "user" WHERE id = ?';
  const plans = [...(options.plans ?? [])];
  const hasCurrentAdminOverride = plans.some((plan) =>
    typeof plan.match === "string"
      ? currentAdminQuery.includes(plan.match)
      : plan.match.test(currentAdminQuery),
  );
  if (options.session && !hasCurrentAdminOverride) {
    plans.unshift({
      match: currentAdminQuery,
      first: {
        role: options.session.user.role,
        banned: options.session.user.banned ?? 0,
        banExpires: options.session.user.banExpires ?? null,
      },
    });
  }

  const { DB, KV, PluginsKV, env: baseEnv } = createTestEnv(
    plans,
    options.kvEntries,
    options.pluginKvEntries,
    options.pluginsKV,
  );
  const env = { ...baseEnv, ...options.env };
  const headers = new Headers(options.headers ?? {});
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? TEST_CONSOLE_ORIGIN);
  }

  if (options.session !== undefined) {
    headers.set("X-Test-Session", JSON.stringify(options.session));
  }

  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await app.request(
    `${TEST_PUBLIC_ORIGIN}${path}`,
    {
      method: options.method ?? "GET",
      headers,
      body,
    },
    env,
  );

  return { response, DB, KV, PluginsKV };
}

export async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function expectSql(DB: D1Spy, matcher: RegExp | string, message: string) {
  const matched = DB.statements.some(({ sql }) =>
    typeof matcher === "string" ? sql.includes(matcher) : matcher.test(sql),
  );
  expect(matched, message).toBe(true);
}
