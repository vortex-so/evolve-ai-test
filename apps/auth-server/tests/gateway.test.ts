import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../src/lib/crypto";
import {
  requestApp,
  type StatementPlan,
  userSession,
} from "./_helpers/test-app";

const LITELLM_BASE_URL = "https://llm-manager.example.test";
const USER_KEY = "sk-user-gateway";
const USER = userSession();

function entitledPlan(assigned = 1) {
  return {
    match: /SELECT u\.role AS role/i,
    first: { role: "user", banned: 0, banExpires: null, assigned },
  };
}

async function storedKeyPlans(): Promise<StatementPlan[]> {
  const sealed = await encryptSecret(
    "test-secret-test-secret-test-secret",
    USER.user.id,
    USER_KEY,
  );
  return [
    entitledPlan(),
    {
      match: /SELECT key_ciphertext, key_iv, key_alias FROM litellm_user_key/i,
      first: {
        key_ciphertext: sealed.ciphertext,
        key_iv: sealed.iv,
        key_alias: "vortex-sso:plain-user-id:stored",
      },
    },
  ];
}

async function gatewayRequest(
  path: string,
  options: {
    method?: string;
    body?: string;
    headers?: HeadersInit;
    plans?: StatementPlan[];
    bearer?: boolean;
    session?: ReturnType<typeof userSession> | null;
  } = {},
) {
  return requestApp(path, {
    method: options.method ?? "POST",
    rawBody: options.body,
    origin: null,
    session: options.session === undefined ? USER : options.session,
    headers: {
      ...(options.bearer === false ? {} : { Authorization: "Bearer desktop-access" }),
      ...options.headers,
    },
    plans: options.plans ?? (await storedKeyPlans()),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inference gateway", () => {
  it("streams SSE from upstream unchanged", async () => {
    const bytes = "event: message_start\ndata: {\"type\":\"message_start\"}\n\n";
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await gatewayRequest("/v1/messages?beta=true", {
      body: "{\"stream\":true}",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(bytes);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(String(upstreamFetch.mock.calls[0]?.[0])).toBe(
      `${LITELLM_BASE_URL}/v1/messages?beta=true`,
    );
  });

  it("forwards anthropic headers and body unchanged and replaces credentials", async () => {
    const rawBody = "{\n  \"model\": \"claude-sonnet-5\",\n  \"messages\": []\n}";
    const upstreamRequests: Request[] = [];
    const upstreamFetch = vi.fn<typeof fetch>(async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      upstreamRequests.push(new Request(input, init));
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await gatewayRequest("/v1/messages", {
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "context-1m-2025-08-07",
        cookie: "session=secret",
        "x-api-key": "caller-key",
      },
    });

    expect(response.status).toBe(200);
    const upstreamRequest = upstreamRequests[0];
    if (!upstreamRequest) throw new Error("Expected an upstream request");
    expect(upstreamRequest.headers.get("authorization")).toBe(`Bearer ${USER_KEY}`);
    expect(upstreamRequest.headers.has("cookie")).toBe(false);
    expect(upstreamRequest.headers.has("x-api-key")).toBe(false);
    expect(upstreamRequest.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(upstreamRequest.headers.get("anthropic-beta")).toBe(
      "context-1m-2025-08-07",
    );
    expect(await upstreamRequest.text()).toBe(rawBody);
  });

  it("missing bearer returns authentication_error and never calls upstream", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await gatewayRequest("/v1/messages", { bearer: false });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: "error",
      error: expect.objectContaining({ type: "authentication_error" }),
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("cookie-only request returns authentication_error", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await gatewayRequest("/v1/messages", {
      bearer: false,
      headers: { cookie: "better-auth.session_token=cookie-session" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: "error",
      error: expect.objectContaining({ type: "authentication_error" }),
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("not entitled returns permission_error and never calls upstream", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await gatewayRequest("/v1/messages", {
      plans: [entitledPlan(0)],
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      type: "error",
      error: expect.objectContaining({ type: "permission_error" }),
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("passes an upstream 400 through with body and retry headers", async () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "bad" } };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(body, {
          status: 400,
          headers: { "retry-after": "7", "x-should-retry": "false" },
        }),
      ),
    );

    const { response } = await gatewayRequest("/v1/messages");

    expect(response.status).toBe(400);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(await response.json()).toEqual(body);
  });

  it("maps upstream 401 to retryable 502 and invalidates the stored key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith("/key/delete")) return Response.json({ ok: true });
        return Response.json({ error: { type: "authentication_error", message: "invalid key" } }, { status: 401 });
      }),
    );
    const plans = await storedKeyPlans();
    plans.push(
      {
        match: /SELECT key_alias FROM litellm_user_key/i,
        first: { key_alias: "vortex-sso:plain-user-id:stored" },
      },
      {
        match: /DELETE FROM litellm_user_key WHERE user_id/i,
        run: { meta: { changes: 1 } },
      },
    );

    const { response, DB } = await gatewayRequest("/v1/messages", { plans });

    expect(response.status).toBe(502);
    expect(response.headers.get("x-should-retry")).toBe("true");
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "api_error", message: "Upstream rejected the inference key; retry" },
    });
    expect(DB.statements.some(({ sql }) => /DELETE FROM litellm_user_key/i.test(sql))).toBe(true);
  });

  it("maps budget_exceeded upstream 429 to billing_error 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { message: "Monthly budget exceeded", type: "budget_exceeded" } },
          { status: 429 },
        ),
      ),
    );

    const { response } = await gatewayRequest("/v1/messages");

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "billing_error", message: "Monthly budget exceeded" },
    });
  });

  it("passes other upstream 429 responses through", async () => {
    const body = { error: { message: "rate limited", type: "rate_limit_error" } };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(body, { status: 429, headers: { "retry-after": "3" } }),
      ),
    );

    const { response } = await gatewayRequest("/v1/messages");

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(await response.json()).toEqual(body);
  });

  it("maps an upstream network error to retryable api_error 502", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline"))));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response } = await gatewayRequest("/v1/messages");

    expect(response.status).toBe(502);
    expect(response.headers.get("x-should-retry")).toBe("true");
    expect(await response.json()).toEqual({
      type: "error",
      error: expect.objectContaining({ type: "api_error" }),
    });
    expect(log).toHaveBeenCalled();
  });

  it("proxies GET /v1/models and POST /v1/messages/count_tokens", async () => {
    const upstreamFetch = vi.fn<typeof fetch>(async (input) =>
      Response.json({ path: new URL(String(input)).pathname }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const models = await gatewayRequest("/v1/models", { method: "GET" });
    const tokens = await gatewayRequest("/v1/messages/count_tokens", {
      body: "{\"messages\":[]}",
      headers: { "content-type": "application/json" },
    });

    expect(models.response.status).toBe(200);
    expect(await models.response.json()).toEqual({ path: "/v1/models" });
    expect(tokens.response.status).toBe(200);
    expect(await tokens.response.json()).toEqual({ path: "/v1/messages/count_tokens" });
  });

  it("decrypts stored keys with LITELLM_KEY_ENCRYPTION_SECRET when it is set", async () => {
    const sealed = await encryptSecret("dedicated-key-encryption-secret", USER.user.id, USER_KEY);
    const upstreamFetch = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Request(input, init).headers.get("authorization")).toBe(`Bearer ${USER_KEY}`);
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await requestApp("/v1/messages", {
      method: "POST",
      rawBody: "{}",
      origin: null,
      session: USER,
      headers: { Authorization: "Bearer desktop-access" },
      env: { LITELLM_KEY_ENCRYPTION_SECRET: "dedicated-key-encryption-secret" },
      plans: [
        entitledPlan(),
        {
          match: /SELECT key_ciphertext, key_iv, key_alias FROM litellm_user_key/i,
          first: { key_ciphertext: sealed.ciphertext, key_iv: sealed.iv, key_alias: "a" },
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to provision keys when no encryption secret is configured", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await requestApp("/v1/messages", {
      method: "POST",
      rawBody: "{}",
      origin: null,
      session: USER,
      headers: { Authorization: "Bearer desktop-access" },
      env: { BETTER_AUTH_SECRET: "", LITELLM_KEY_ENCRYPTION_SECRET: "" },
      plans: [entitledPlan()],
    });
    const body = (await response.json()) as { error: { type: string } };

    expect(response.status).toBe(502);
    expect(body.error.type).toBe("api_error");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("provisions a key on first use when none is stored", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith(`${LITELLM_BASE_URL}/user/list?`)) {
          return Response.json({
            users: [{ user_id: "litellm-user", user_email: USER.user.email }],
            total_pages: 1,
          });
        }
        if (url === `${LITELLM_BASE_URL}/key/generate`) {
          return Response.json({ key: "sk-provisioned", token_id: "token-id" });
        }
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe("Bearer sk-provisioned");
        return Response.json({ ok: true });
      }),
    );

    const { response, DB } = await gatewayRequest("/v1/messages", {
      plans: [
        entitledPlan(),
        { match: /INSERT INTO litellm_user_key/i, run: { meta: { changes: 1 } } },
      ],
    });

    expect(response.status).toBe(200);
    expect(calls.some((url) => url.startsWith(`${LITELLM_BASE_URL}/user/list?`))).toBe(true);
    expect(calls).toContain(`${LITELLM_BASE_URL}/key/generate`);
    expect(calls).toContain(`${LITELLM_BASE_URL}/v1/messages`);
    expect(DB.statements.some(({ sql }) => /INSERT INTO litellm_user_key/i.test(sql))).toBe(true);
  });
});
