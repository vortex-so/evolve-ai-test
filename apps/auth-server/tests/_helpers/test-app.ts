import { expect } from "vitest";
import app from "../../src/index";

export const TEST_PUBLIC_ORIGIN = "https://api.auth-dev.vortex.so";
export const TEST_CONSOLE_ORIGIN = "https://console.auth-dev.vortex.so";
export const TEST_WRONG_ORIGIN = "https://evil.example.com";

export type TestSession = {
  user: {
    id: string;
    email: string;
    role: string;
  };
  impersonatedBy?: {
    userId: string;
  } | null;
};

type StatementPlan = {
  match: RegExp | string;
  first?: unknown;
  all?: unknown[];
  run?: { meta?: { changes?: number } };
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
          first: async () => (plan?.first ?? null),
          all: async () => ({ results: plan?.all ?? [], success: true, meta: d1Meta() }),
          run: async () => ({ success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) }),
          raw: async () => plan?.all ?? [],
        };
      },
      first: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        return plan?.first ?? null;
      },
      all: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        return { results: plan?.all ?? [], success: true, meta: d1Meta() };
      },
      run: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
        return { success: true, meta: d1Meta(plan?.run?.meta?.changes ?? 0) };
      },
      raw: async () => {
        this.statements.push({ sql, params: [] });
        const plan = findPlan();
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

export function createTestEnv(plans: StatementPlan[] = []) {
  const DB = new D1Spy(plans);
  return {
    DB,
    env: {
      DB: DB as unknown as D1Database,
      AUTH_KV: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
        list: async () => ({ keys: [], list_complete: true, cursor: "" }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
        consume: async () => ({ success: true }),
      } as unknown as KVNamespace,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      NODE_ENV: "test",
      PUBLIC_ORIGIN: TEST_PUBLIC_ORIGIN,
      INFERENCE_GATEWAY_BASE_URL: TEST_PUBLIC_ORIGIN,
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
    headers?: HeadersInit;
    origin?: string | null;
    session?: TestSession | null;
    plans?: StatementPlan[];
  } = {},
) {
  const { DB, env } = createTestEnv(options.plans ?? []);
  const headers = new Headers(options.headers ?? {});
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? TEST_CONSOLE_ORIGIN);
  }

  if (options.session !== undefined) {
    headers.set("X-Test-Session", JSON.stringify(options.session));
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
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

  return { response, DB };
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
