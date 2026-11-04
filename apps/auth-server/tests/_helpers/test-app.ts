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
        return {
          first: async () => {
            if (plan?.error) throw plan.error;
            return plan?.first ?? null;
          },
          all: async () => {
            if (plan?.error) throw plan.error;
            return { results: plan?.all ?? [], success: true, meta: d1Meta() };
          },
          run: async () => {
            if (plan?.error) throw plan.error;
            return { success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) };
          },
          raw: async () => {
            if (plan?.error) throw plan.error;
            return plan?.all ?? [];
          },
        };
      },
      first: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return plan?.first ?? null;
      },
      all: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return { results: plan?.all ?? [], success: true, meta: d1Meta() };
      },
      run: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return { success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) };
      },
      raw: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        if (plan?.error) throw plan.error;
        return plan?.all ?? [];
      },
    };
  }

  batch<T>(items: T[]): Promise<T[]> {
    return Promise.resolve(items.map(() => ({ results: [], success: true, meta: d1Meta() })) as T[]);
  }

  exec(_sql: string): Promise<{ count: number }> {
    return Promise.resolve({ count: 0 });
  }
}

export class KVSpy {
  readonly deleted: string[] = [];
  private readonly entries: Map<string, string>;

  constructor(entries: Record<string, string> = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async get(key: string) {
    return this.entries.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.entries.set(key, value);
  }

  async delete(key: string) {
    this.deleted.push(key);
    this.entries.delete(key);
  }

  async list() {
    return { keys: [], list_complete: true, cursor: "" };
  }

  async getWithMetadata(key: string) {
    return { value: this.entries.get(key) ?? null, metadata: null };
  }

  async consume() {
    return { success: true };
  }
}

export function createTestEnv(
  plans: StatementPlan[] = [],
  kvEntries: Record<string, string> = {},
) {
  const DB = new D1Spy(plans);
  const KV = new KVSpy(kvEntries);
  return {
    DB,
    KV,
    env: {
      DB: DB as unknown as Env["DB"],
      AUTH_KV: KV as unknown as Env["AUTH_KV"],
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      NODE_ENV: "test",
      PUBLIC_ORIGIN: TEST_PUBLIC_ORIGIN,
      INFERENCE_GATEWAY_BASE_URL: TEST_PUBLIC_ORIGIN,
      LITELLM_BASE_URL: "https://llm-manager.example.test",
      LITELLM_ADMIN_KEY: "test-litellm-admin-key",
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
    env?: Record<string, string>;
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

  const { DB, KV, env: baseEnv } = createTestEnv(plans, options.kvEntries);
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

  return { response, DB, KV };
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
