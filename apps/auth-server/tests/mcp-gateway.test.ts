import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../src/lib/crypto";
import { mintMcpToken } from "../src/lib/mcp-token";
import {
  requestApp,
  TEST_PUBLIC_ORIGIN,
  type StatementPlan,
  userSession,
} from "./_helpers/test-app";

const MCP_SECRET = "test-mcp-token-secret-test-mcp-token-secret";
const LITELLM_BASE_URL = "https://llm-manager.example.test";
const USER = userSession();
const USER_KEY = "sk-mcp-user";
const SERVER = "meta_ads_mcp";

function entitledPlan(assigned = 1): StatementPlan {
  return {
    match: /SELECT u\.role AS role/i,
    first: { role: "user", banned: 0, banExpires: null, assigned },
  };
}

function profilePlans(servers: unknown[]): StatementPlan[] {
  return [
    {
      match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
      first: { profile_id: "profile-1" },
    },
    {
      match: /SELECT config, schema_version FROM bootstrap_profile WHERE id = \?/i,
      first: {
        config: JSON.stringify({
          $schemaVersion: 1,
          inferenceProvider: "gateway",
          managedMcpServers: servers,
        }),
        schema_version: 1,
      },
    },
  ];
}

async function allowedPlans(version = 1): Promise<StatementPlan[]> {
  const sealed = await encryptSecret(
    "test-secret-test-secret-test-secret",
    `mcp:${USER.user.id}`,
    USER_KEY,
  );
  return [
    { match: /SELECT version FROM mcp_token_version/i, first: { version } },
    {
      match: /SELECT id, email FROM "user" WHERE id = \?/i,
      first: { id: USER.user.id, email: USER.user.email },
    },
    entitledPlan(),
    ...profilePlans([
      {
        name: "meta-ads",
        transport: "http",
        url: `${TEST_PUBLIC_ORIGIN}/mcp/${SERVER}`,
      },
    ]),
    {
      match: /SELECT key_ciphertext, key_iv, key_alias FROM litellm_user_mcp_key/i,
      first: {
        key_ciphertext: sealed.ciphertext,
        key_iv: sealed.iv,
        key_alias: "vortex-sso-mcp:plain-user-id:stored",
      },
    },
  ];
}

async function token(version = 1) {
  return mintMcpToken(MCP_SECRET, USER.user.id, version);
}

async function mcpRequest(options: {
  path?: string;
  method?: string;
  bearer?: string | null;
  body?: string;
  headers?: HeadersInit;
  plans?: StatementPlan[];
  env?: Record<string, string>;
} = {}) {
  const bearer = options.bearer === undefined ? await token() : options.bearer;
  return requestApp(options.path ?? `/mcp/${SERVER}`, {
    method: options.method ?? "POST",
    rawBody: options.body,
    origin: null,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...options.headers,
    },
    plans: options.plans ?? (await allowedPlans()),
    env: options.env,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MCP gateway", () => {
  it("returns 401 with a bearer challenge when the token is missing", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);

    const { response } = await mcpRequest({ bearer: null });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns 401 for a bad or revoked token", async () => {
    const bad = await mcpRequest({ bearer: "vmcp_bad.1.bad" });
    const revoked = await mcpRequest({
      bearer: await token(1),
      plans: await allowedPlans(2),
    });

    expect(bad.response.status).toBe(401);
    expect(revoked.response.status).toBe(401);
  });

  it("returns 403 when the user is not entitled", async () => {
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(0),
      ],
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 when the selected profile does not allow the server", async () => {
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(),
        ...profilePlans([
          {
            name: "other",
            transport: "http",
            url: `${TEST_PUBLIC_ORIGIN}/mcp/other_mcp`,
          },
        ]),
      ],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "server_not_allowed" });
  });

  it.each([
    `${TEST_PUBLIC_ORIGIN}/mcp/%2e%2e/device`,
    `${TEST_PUBLIC_ORIGIN}/mcp/../device`,
    `${TEST_PUBLIC_ORIGIN}/mcp/${SERVER}/`,
    `${TEST_PUBLIC_ORIGIN}/mcp//${SERVER}`,
    `${TEST_PUBLIC_ORIGIN}/mcp/${SERVER}?y=1`,
    `${TEST_PUBLIC_ORIGIN}/mcp/${SERVER}#f`,
    `https://api.auth-dev.vortex.so.evil.com/mcp/${SERVER}`,
    `https://user@api.auth-dev.vortex.so/mcp/${SERVER}`,
    `${TEST_PUBLIC_ORIGIN}/MCP/${SERVER}`,
    `${TEST_PUBLIC_ORIGIN}\\mcp\\${SERVER}`,
    `${TEST_PUBLIC_ORIGIN}/mcp/meta%2Fads`,
  ])("denies a server represented by non-canonical profile URL %s", async (url) => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(),
        ...profilePlans([{ name: "invalid", transport: "http", url }]),
      ],
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns 503 and does not call upstream when profile lookup fails", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(),
        {
          match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
          error: new Error("D1 unavailable"),
        },
      ],
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "profile_unavailable" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["invalid", { config: "{not-json", schema_version: 1 }],
  ])("returns 403 when an assigned profile is %s", async (_case, selected) => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(),
        {
          match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
          first: { profile_id: "broken-profile" },
        },
        {
          match: /SELECT config, schema_version FROM bootstrap_profile WHERE id = \?/i,
          first: selected,
        },
      ],
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("uses the default profile for an active admin with no assignment", async () => {
    const adminUser = { ...USER, user: { ...USER.user, role: "admin" } };
    const sealed = await encryptSecret(
      "test-secret-test-secret-test-secret",
      `mcp:${adminUser.user.id}`,
      USER_KEY,
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ ok: true })));
    const { response } = await requestApp(`/mcp/${SERVER}`, {
      method: "POST",
      origin: null,
      headers: { Authorization: `Bearer ${await token()}` },
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: adminUser.user.id, email: adminUser.user.email },
        },
        { match: /SELECT u\.role AS role/i, first: { role: "admin", banned: 0, banExpires: null, assigned: 0 } },
        { match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i, first: null },
        { match: /SELECT role, banned, banExpires FROM "user"/i, first: { role: "admin", banned: 0, banExpires: null } },
        {
          match: /SELECT config, schema_version FROM bootstrap_profile WHERE is_default = 1/i,
          first: {
            config: JSON.stringify({
              $schemaVersion: 1,
              inferenceProvider: "gateway",
              managedMcpServers: [{ name: "meta", transport: "http", url: `${TEST_PUBLIC_ORIGIN}/mcp/${SERVER}` }],
            }),
            schema_version: 1,
          },
        },
        {
          match: /SELECT key_ciphertext, key_iv, key_alias FROM litellm_user_mcp_key/i,
          first: { key_ciphertext: sealed.ciphertext, key_iv: sealed.iv, key_alias: "mcp-alias" },
        },
      ],
    });

    expect(response.status).toBe(200);
  });

  it("returns 403 for a non-admin with no assignment instead of using a fallback", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const { response } = await mcpRequest({
      plans: [
        { match: /SELECT version FROM mcp_token_version/i, first: null },
        {
          match: /SELECT id, email FROM "user" WHERE id = \?/i,
          first: { id: USER.user.id, email: USER.user.email },
        },
        entitledPlan(),
        { match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i, first: null },
        { match: /SELECT role, banned, banExpires FROM "user"/i, first: { role: "user", banned: 0, banExpires: null } },
      ],
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns 404 for an invalid server name", async () => {
    const { response } = await mcpRequest({ path: "/mcp/bad.server" });
    expect(response.status).toBe(404);
  });

  it("proxies POST as an unbuffered stream with the MCP header allowlists", async () => {
    const events = "event: message\ndata: {\"ok\":true}\n\n";
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(events, {
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "upstream-session",
            "set-cookie": "secret=1",
          },
        });
      }),
    );

    const { response } = await mcpRequest({
      body: "{\"jsonrpc\":\"2.0\"}",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "mcp-session-id": "client-session",
        "mcp-protocol-version": "2025-03-26",
        cookie: "session=secret",
        "x-mcp-secret": "drop-me",
        "x-litellm-api-key": "drop-me-too",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBe("upstream-session");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(events);
    const upstream = requests[0];
    if (!upstream) throw new Error("Expected upstream MCP request");
    expect(upstream.url).toBe(`${LITELLM_BASE_URL}/${SERVER}/mcp`);
    expect(upstream.headers.get("x-litellm-api-key")).toBe(`Bearer ${USER_KEY}`);
    expect(upstream.headers.get("authorization")).toBeNull();
    expect(upstream.headers.get("cookie")).toBeNull();
    expect(upstream.headers.get("x-mcp-secret")).toBeNull();
    expect(upstream.headers.get("mcp-session-id")).toBe("client-session");
    expect(await upstream.text()).toBe("{\"jsonrpc\":\"2.0\"}");
  });

  it("overrides cacheable upstream MCP responses with Cache-Control: no-store", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({ ok: true }, { headers: { "cache-control": "public, s-maxage=600" } }),
      ),
    );

    const { response } = await mcpRequest();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["GET", "DELETE"])("proxies %s requests", async (method) => {
    const upstream = vi.fn<typeof fetch>(async (input, init) =>
      Response.json({ method: init?.method, url: String(input) }),
    );
    vi.stubGlobal("fetch", upstream);

    const { response } = await mcpRequest({
      method,
      path: `/mcp/${SERVER}?cursor=1`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      method,
      url: `${LITELLM_BASE_URL}/${SERVER}/mcp?cursor=1`,
    });
  });

  it("maps upstream 401 to 502 and invalidates the user key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith("/key/delete")) return Response.json({ ok: true });
        return Response.json({ error: "bad key" }, { status: 401 });
      }),
    );
    const plans = await allowedPlans();
    plans.push(
      {
        match: /SELECT key_alias FROM litellm_user_mcp_key/i,
        first: { key_alias: "vortex-sso-mcp:plain-user-id:stored" },
      },
      { match: /DELETE FROM litellm_user_mcp_key WHERE user_id/i, run: { meta: { changes: 1 } } },
    );

    const { response, DB } = await mcpRequest({ plans });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_rejected" });
    expect(DB.statements.some(({ sql }) => /DELETE FROM litellm_user_mcp_key/i.test(sql))).toBe(true);
  });

  it("maps upstream network errors to 502", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline"))));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response } = await mcpRequest();

    expect(response.status).toBe(502);
  });

  it("returns 503 when MCP_TOKEN_SECRET is missing or short", async () => {
    const { response } = await mcpRequest({ env: { MCP_TOKEN_SECRET: "short" } });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "mcp_gateway_unavailable" });
  });
});
