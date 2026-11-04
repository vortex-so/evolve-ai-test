import { validateBootstrapConfig } from "@vortex/schema";
import { describe, expect, it } from "vitest";
import { verifyMcpToken } from "../src/lib/mcp-token";
import {
  readJson,
  requestApp,
  TEST_PUBLIC_ORIGIN,
  userSession,
} from "./_helpers/test-app";

const MCP_SECRET = "test-mcp-token-secret-test-mcp-token-secret";

function plans(version: number | null = null, managedMcpServers?: unknown[]) {
  return [
    {
      match: /SELECT u\.role AS role/i,
      first: { role: "user", banned: 0, banExpires: null, assigned: 1 },
    },
    {
      match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
      first: { profile_id: "mcp-profile" },
    },
    {
      match: /SELECT config, schema_version FROM bootstrap_profile WHERE id = \?/i,
      first: {
        config: JSON.stringify({
          $schemaVersion: 1,
          inferenceProvider: "gateway",
          managedMcpServers: managedMcpServers ?? [
            {
              name: "meta-ads",
              transport: "http",
              url: `${TEST_PUBLIC_ORIGIN}/mcp/meta_ads_mcp`,
              headers: {
                Authorization: "Bearer admin-value",
                authorization: "Bearer lowercase-admin-value",
                "x-tenant": "vortex",
              },
            },
            {
              name: "posthog",
              transport: "http",
              url: "https://posthog.vortex.so/mcp",
              oauth: true,
            },
          ],
        }),
        schema_version: 1,
      },
    },
    {
      match: /SELECT version FROM mcp_token_version/i,
      first: version === null ? null : { version },
    },
  ];
}

async function bootstrap(
  env?: Record<string, string>,
  headers?: HeadersInit,
  version: number | null = null,
  managedMcpServers?: unknown[],
) {
  return requestApp("/user/bootstrap", {
    origin: null,
    session: userSession(),
    headers: { Authorization: "Bearer desktop-session", ...headers },
    plans: plans(version, managedMcpServers),
    env,
  });
}

describe("bootstrap MCP credential injection", () => {
  it("injects a stable per-user token into gateway entries only and stays schema-valid", async () => {
    const first = await bootstrap();
    const firstBody = (await readJson(first.response)) as {
      managedMcpServers: Array<Record<string, unknown>>;
    };
    const gateway = firstBody.managedMcpServers[0];
    const direct = firstBody.managedMcpServers[1];
    const gatewayHeaders = gateway?.headers as Record<string, string>;

    expect(first.response.status).toBe(200);
    expect(validateBootstrapConfig(firstBody)).toEqual(expect.objectContaining({ ok: true }));
    expect(gatewayHeaders["x-tenant"]).toBe("vortex");
    expect(gatewayHeaders.Authorization).toMatch(/^Bearer vmcp_/);
    expect(gatewayHeaders.Authorization).not.toBe("Bearer admin-value");
    expect(gatewayHeaders).not.toHaveProperty("authorization");
    expect(direct).not.toHaveProperty("headers");
    await expect(
      verifyMcpToken(MCP_SECRET, gatewayHeaders.Authorization.slice("Bearer ".length)),
    ).resolves.toEqual({ userId: "plain-user-id", version: 1 });

    const etag = first.response.headers.get("etag");
    const second = await bootstrap(undefined, { "If-None-Match": etag ?? "" });
    expect(second.response.status).toBe(304);
    expect(second.response.headers.get("etag")).toBe(etag);
  });

  it("strips stored gateway authorization when MCP_TOKEN_SECRET is unavailable", async () => {
    const { response } = await bootstrap({ MCP_TOKEN_SECRET: "" });
    const body = (await readJson(response)) as {
      managedMcpServers: Array<{ headers?: Record<string, string> }>;
    };

    expect(response.status).toBe(200);
    expect(body.managedMcpServers[0]?.headers).toEqual({ "x-tenant": "vortex" });
  });

  it("changes the ETag when the user's token version rotates", async () => {
    const versionOne = await bootstrap(undefined, undefined, 1);
    const versionTwo = await bootstrap(undefined, undefined, 2);

    expect(versionTwo.response.headers.get("etag")).not.toBe(
      versionOne.response.headers.get("etag"),
    );
  });

  it.each([
    `${TEST_PUBLIC_ORIGIN}/mcp/%2e%2e/device`,
    `${TEST_PUBLIC_ORIGIN}/mcp/../device`,
    `${TEST_PUBLIC_ORIGIN}/mcp/x/`,
    `${TEST_PUBLIC_ORIGIN}/mcp//x`,
    `${TEST_PUBLIC_ORIGIN}/mcp/x?y=1`,
    `${TEST_PUBLIC_ORIGIN}/mcp/x#f`,
    "https://api.auth-dev.vortex.so.evil.com/mcp/x",
    "https://user@api.auth-dev.vortex.so/mcp/x",
    `${TEST_PUBLIC_ORIGIN}/MCP/x`,
    `${TEST_PUBLIC_ORIGIN}\\mcp\\x`,
    `${TEST_PUBLIC_ORIGIN}/mcp/a%2Fb`,
  ])("does not inject authorization into non-canonical gateway URL %s", async (url) => {
    const { response, DB } = await bootstrap(undefined, undefined, null, [
      { name: "invalid", transport: "http", url },
    ]);
    const body = (await readJson(response)) as {
      managedMcpServers?: Array<{ headers?: Record<string, string> }>;
    };

    expect(response.status).toBe(200);
    expect(body.managedMcpServers?.[0]?.headers?.Authorization).toBeUndefined();
    expect(DB.statements.some(({ sql }) => /mcp_token_version/i.test(sql))).toBe(false);
  });
});
