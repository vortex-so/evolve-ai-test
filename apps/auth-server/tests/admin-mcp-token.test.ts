import { describe, expect, it } from "vitest";
import { mintMcpToken } from "../src/lib/mcp-token";
import {
  adminSession,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

const MCP_SECRET = "test-mcp-token-secret-test-mcp-token-secret";

describe("admin MCP token rotation", () => {
  it("bumps the version, writes an audit row, and makes the old token invalid", async () => {
    const userId = "target-user";
    const oldToken = await mintMcpToken(MCP_SECRET, userId, 1);
    const rotated = await requestApp(`/admin/users/${userId}/mcp-token/rotate`, {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: /INSERT INTO mcp_token_version/i,
          run: { meta: { changes: 1 } },
        },
      ],
    });

    expect(rotated.response.status).toBe(200);
    expect(
      rotated.DB.statements.some(
        ({ sql, params }) =>
          /INSERT INTO mcp_token_version/i.test(sql) &&
          /version\s*=\s*mcp_token_version\.version\s*\+\s*1/i.test(sql) &&
          params[0] === userId,
      ),
    ).toBe(true);
    expect(
      rotated.DB.statements.some(
        ({ sql, params }) =>
          /INSERT INTO audit_log/i.test(sql) && params.includes("admin.mcp_token.rotate"),
      ),
    ).toBe(true);

    const rejected = await requestApp("/mcp/meta_ads_mcp", {
      method: "POST",
      origin: null,
      headers: { Authorization: `Bearer ${oldToken}` },
      plans: [{ match: /SELECT version FROM mcp_token_version/i, first: { version: 2 } }],
    });
    expect(rejected.response.status).toBe(401);
  });

  it("keeps the token version unchanged when the atomic audit insert fails", async () => {
    const userId = "target-user";
    const rotated = await requestApp(`/admin/users/${userId}/mcp-token/rotate`, {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: /INSERT INTO mcp_token_version/i,
          run: { meta: { changes: 1 } },
        },
        {
          match: /INSERT INTO audit_log/i,
          error: new Error("audit insert failed"),
        },
      ],
    });

    expect(rotated.response.status).toBe(500);
    expect(rotated.DB.batches).toHaveLength(1);
    expect(rotated.DB.batches[0]).toHaveLength(2);
    expect(
      rotated.DB.executions.some(({ sql }) => /INSERT INTO mcp_token_version/i.test(sql)),
    ).toBe(false);
  });
});
