import { describe, expect, it } from "vitest";
import {
  adminSession,
  expectSql,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

describe("oauth admin CRUD", () => {
  it("POST /admin/oauth-clients creates a client, audits success, and reveals the secret once", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        name: "Claude Desktop",
        uri: "https://claude.example.com",
        redirectUris: ["https://claude.example.com/callback"],
        scopes: ["openid", "offline_access", "bootstrap:read"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        requirePKCE: true,
        contacts: ["ops@example.com"],
        metadata: { tier: "internal" },
      },
      plans: [{ match: /INSERT INTO oauthClient/i, run: { meta: { changes: 1 } } }],
    });
    const body = (await readJson(response)) as { id?: string; clientId?: string; clientSecret?: string } | null;

    expect(response.status).toBe(200);
    expect(typeof body?.id).toBe("string");
    expect(typeof body?.clientId).toBe("string");
    expect(typeof body?.clientSecret).toBe("string");
    expectSql(DB, /INSERT INTO oauthClient/i, "oauth client create must insert into oauthClient");
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)),
      "successful oauth client create must write a synchronous audit row",
    ).toBe(true);
  });

  it("GET /admin/oauth-clients/:id returns parsed client fields without exposing the secret", async () => {
    const { response } = await requestApp("/admin/oauth-clients/client-123", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: /SELECT \* FROM oauthClient WHERE id = \?/i,
          first: {
            id: "client-123",
            clientId: "claude-desktop",
            clientSecret: "secret-should-not-leak",
            name: "Claude Desktop",
            redirectUris: '["https://claude.example.com/callback"]',
            scopes: '["openid","offline_access"]',
            grantTypes: '["urn:ietf:params:oauth:grant-type:device_code"]',
            responseTypes: '["code"]',
            contacts: '["ops@example.com"]',
            metadata: '{"tier":"internal"}',
            is_system: 0,
            disabled: 0,
          },
        },
      ],
    });
    const body = (await readJson(response)) as Record<string, unknown> | null;

    expect(response.status).toBe(200);
    expect(body?.clientSecret).toBeUndefined();
    expect(body?.redirectUris).toEqual(["https://claude.example.com/callback"]);
    expect(body?.scopes).toEqual(["openid", "offline_access"]);
    expect(body?.grantTypes).toEqual(["urn:ietf:params:oauth:grant-type:device_code"]);
    expect(body?.responseTypes).toEqual(["code"]);
    expect(body?.contacts).toEqual(["ops@example.com"]);
    expect(body?.metadata).toEqual({ tier: "internal" });
    expect(body?.is_system).toBe(0);
  });

  it("GET /admin/oauth-clients/:id returns 404 and audits failure when the client is missing", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients/missing-client", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /SELECT \* FROM oauthClient WHERE id = \?/i, first: null }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(404);
    expect(body?.code).toBe("oauth_client_not_found");
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)),
      "missing oauth client reads must write a failure audit row",
    ).toBe(true);
  });

  it("POST /admin/oauth-clients/:id/rotate-secret returns the replacement secret and audits success", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients/client-123/rotate-secret", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /UPDATE oauthClient SET clientSecret = \?, updatedAt = \? WHERE id = \?/i, run: { meta: { changes: 1 } } }],
    });
    const body = (await readJson(response)) as { id?: string; clientSecret?: string } | null;

    expect(response.status).toBe(200);
    expect(body?.id).toBe("client-123");
    expect(typeof body?.clientSecret).toBe("string");
    expectSql(
      DB,
      /UPDATE oauthClient SET clientSecret = \?, updatedAt = \? WHERE id = \?/i,
      "oauth client secret rotation must update clientSecret directly in D1",
    );
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)),
      "successful oauth client secret rotation must write a synchronous audit row",
    ).toBe(true);
  });

  it("POST /admin/oauth-clients/:id/rotate-secret returns 404 and audits failure when the client is missing", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients/missing-client/rotate-secret", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /UPDATE oauthClient SET clientSecret = \?, updatedAt = \? WHERE id = \?/i, run: { meta: { changes: 0 } } }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(404);
    expect(body?.code).toBe("oauth_client_not_found");
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)),
      "missing oauth client secret rotations must write a failure audit row",
    ).toBe(true);
  });

  it.each([
    {
      name: "create",
      path: "/admin/oauth-clients",
      method: "POST",
      body: {
        name: "Claude Desktop",
        redirectUris: ["https://claude.example.com/callback"],
        scopes: ["openid"],
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
      },
    },
    {
      name: "update",
      path: "/admin/oauth-clients/client-123",
      method: "PATCH",
      body: { name: "Updated" },
    },
    {
      name: "rotate secret",
      path: "/admin/oauth-clients/client-123/rotate-secret",
      method: "POST",
    },
  ])("blocks impersonated admin oauth mutation: $name", async ({ path, method, body }) => {
    const { response, DB } = await requestApp(path, {
      method,
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession({ impersonatedBy: { userId: "real-admin-id" } }),
      body,
    });
    const payload = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(403);
    expect(payload?.code).toBe("impersonated_admin_action_blocked");
    expect(
      DB.statements.some(({ sql }) => /INSERT|UPDATE|DELETE/i.test(sql) && !/INSERT\s+INTO\s+audit_log/i.test(sql)),
      "impersonated admin oauth mutations must not execute non-audit D1 writes",
    ).toBe(false);
  });

  it("GET /admin/oauth-clients never leaks clientSecret to the response", async () => {
    const seededRows = [
      {
        id: "client-1",
        clientId: "claude-desktop",
        clientSecret: "super-secret-should-not-leak-1",
        name: "Claude Desktop",
        redirectUris: JSON.stringify(["https://claude.example.com/callback"]),
        scopes: JSON.stringify(["openid"]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        contacts: null,
        metadata: null,
        is_system: 1,
      },
      {
        id: "client-2",
        clientId: "other",
        clientSecret: "super-secret-should-not-leak-2",
        name: "Other",
        redirectUris: JSON.stringify([]),
        scopes: JSON.stringify([]),
        grantTypes: JSON.stringify([]),
        responseTypes: JSON.stringify([]),
        contacts: null,
        metadata: null,
        is_system: 0,
      },
    ];
    const { response } = await requestApp("/admin/oauth-clients", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /SELECT \* FROM oauthClient/i, all: seededRows }],
    });
    const cloned = response.clone();
    const body = (await readJson(response)) as { rows?: Array<Record<string, unknown>> } | null;
    const raw = await cloned.text();

    expect(response.status).toBe(200);
    expect(Array.isArray(body?.rows)).toBe(true);
    expect(body!.rows).toHaveLength(2);
    for (const row of body!.rows!) {
      expect(row, "each row must be sanitized").not.toHaveProperty("clientSecret");
    }
    expect(raw, "raw response body must not contain any seeded secret").not.toMatch(
      /super-secret-should-not-leak/,
    );
  });
});
