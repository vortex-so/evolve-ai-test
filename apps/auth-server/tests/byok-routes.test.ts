import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptByokCredential } from "../src/byok/crypto";
import { mintByokAssertion } from "../src/byok/identity";
import { adminSession, requestApp, userSession, type StatementPlan } from "./_helpers/test-app";
import { generateByokTestKeys } from "./_helpers/byok-keys";
import {
  LEGACY_ODOO_POLICY,
  NATIVE_ODOO_DEFAULT_POLICY,
  NATIVE_ODOO_POLICY,
} from "./_helpers/byok-native";

const POLICY = NATIVE_ODOO_POLICY;
const ENCRYPTION_SECRET = "test-byok-encryption-secret-with-entropy";
const RUNTIME_TOKEN = "test-byok-runtime-token-with-entropy";
const ADAPTER_CONTRACT = "odoo-native-v2";

afterEach(() => {
  vi.unstubAllGlobals();
});

function connectionRow(sealed: { ciphertext: string; iv: string }, overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    user_id: "plain-user-id",
    provider: "odoo",
    base_url: "https://erp.vortex.so",
    database_name: "vortex",
    login: "user@example.com",
    credential_ciphertext: sealed.ciphertext,
    credential_iv: sealed.iv,
    enabled: 1,
    version: 3,
    tested_version: 3,
    tested_at: 1_800_000_000_000,
    test_status: "ok",
    odoo_uid: 17,
    policy_json: JSON.stringify(POLICY),
    deleted_at: null,
    mutation_nonce: "nonce",
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe("BYOK admin routes", () => {
  it("fails the test route closed for invalid Odoo transport aliases", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const { response } = await requestApp("/admin/users/plain-user-id/byok/odoo/test", {
      method: "POST",
      session: adminSession(),
      body: { version: 3 },
      env: {
        BYOK_ASSERTION_PRIVATE_KEY: "configured-private-key",
        BYOK_TEST_LITELLM_KEY: "configured-test-key",
        ODOO_TEST_MCP_ALIAS: "gdrive_mcp",
      },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "byok_unavailable", code: "byok_unavailable" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns metadata without credential readback", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "raw-odoo-key");
    const { response } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      session: adminSession(),
      plans: [
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: connectionRow(sealed) },
        { match: /SELECT bp\.config FROM bootstrap_user_profile/i, first: null },
      ],
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("raw-odoo-key");
    expect(text).not.toContain(sealed.ciphertext);
    expect(text).not.toContain(sealed.iv);
    expect(JSON.parse(text)).toMatchObject({ connection: { hasCredential: true, version: 3 } });
  });

  it("shows conservative metadata for an unmigrated legacy policy", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "raw-odoo-key");
    const { response } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      session: adminSession(),
      plans: [
        {
          match: /SELECT \* FROM byok_connection WHERE user_id/i,
          first: connectionRow(sealed, { policy_json: JSON.stringify(LEGACY_ODOO_POLICY) }),
        },
        { match: /SELECT bp\.config FROM bootstrap_user_profile/i, first: null },
      ],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        enabled: true,
        policy: NATIVE_ODOO_DEFAULT_POLICY,
        testedVersion: null,
        testedAt: null,
        testStatus: "not_tested",
        odooUid: null,
      },
    });
  });

  it("fails closed when BYOK secrets are not configured", async () => {
    const { response } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 0, database: "vortex", login: "user@example.com", enabled: false, apiKey: "secret", policy: POLICY },
      env: { BYOK_ENCRYPTION_SECRET: undefined },
    });
    expect(response.status).toBe(503);
  });

  it("returns 409 for stale updates and does not write an audit row", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "secret");
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 2, database: "vortex", login: "user@example.com", enabled: true, policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: connectionRow(sealed) },
      ],
    });
    expect(response.status).toBe(409);
    expect(DB.batches).toHaveLength(0);
  });

  it("carries a successful test to the new version for an enable-only mutation", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "secret");
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 3, database: "vortex", login: "user@example.com", enabled: false, policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: connectionRow(sealed) },
        { match: /UPDATE byok_connection SET database_name/i, run: { meta: { changes: 1 } } },
      ],
    });
    expect(response.status).toBe(200);
    const update = DB.batches[0]?.[0];
    expect(update?.params[5]).toBe(4);
    expect(update?.params[6]).toBe(4);
    expect(update?.params[8]).toBe("ok");
  });

  it("invalidates a successful test when the native policy changes", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "secret");
    const nextPolicy = {
      policyVersion: 2,
      enableWrites: false,
      allowedSideEffectMethods: [],
    } as const;
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 3, database: "vortex", login: "user@example.com", enabled: true, policy: nextPolicy },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: connectionRow(sealed) },
        { match: /UPDATE byok_connection SET database_name/i, run: { meta: { changes: 1 } } },
      ],
    });
    expect(response.status).toBe(200);
    const update = DB.batches[0]?.[0];
    expect(update?.params.slice(5, 11)).toEqual([
      4,
      null,
      null,
      "not_tested",
      null,
      JSON.stringify(nextPolicy),
    ]);
  });

  it("requires a fresh API key to recreate a tombstoned connection", async () => {
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 4, "old-secret");
    const tombstone = connectionRow(sealed, {
      credential_ciphertext: null,
      credential_iv: null,
      enabled: 0,
      version: 4,
      tested_version: null,
      test_status: "not_tested",
      deleted_at: Date.now(),
    });
    const denied = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT", session: adminSession(),
      body: { version: 4, database: "vortex", login: "user@example.com", enabled: false, policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: tombstone },
      ],
    });
    expect(denied.response.status).toBe(400);

    const recreated = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT", session: adminSession(),
      body: { version: 4, database: "vortex", login: "user@example.com", enabled: false, apiKey: "fresh-key", policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: tombstone },
        { match: /UPDATE byok_connection SET database_name/i, run: { meta: { changes: 1 } } },
      ],
    });
    expect(recreated.response.status).toBe(200);
    expect(recreated.DB.batches[0]?.[0]?.sql).toContain("deleted_at=NULL");
  });

  it("keeps the credential out of SQL parameters and batches mutation with audit", async () => {
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 0, database: "vortex", login: "user@example.com", enabled: false, apiKey: "raw-odoo-key", policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: null },
        { match: /INSERT INTO byok_connection/i, run: { meta: { changes: 1 } } },
      ],
    });
    expect(response.status).toBe(200);
    expect(DB.batches).toHaveLength(1);
    expect(DB.batches[0]).toHaveLength(2);
    expect(JSON.stringify(DB.statements)).not.toContain("raw-odoo-key");
  });

  it("does not commit a mutation when the conditional audit statement fails", async () => {
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: { version: 0, database: "vortex", login: "user@example.com", enabled: false, apiKey: "raw-odoo-key", policy: POLICY },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: null },
        { match: /INSERT INTO byok_connection/i, run: { meta: { changes: 1 } } },
        { match: /INSERT INTO audit_log/i, error: new Error("audit unavailable") },
      ],
    });
    expect(response.status).toBe(500);
    expect(DB.executions.some(({ sql }) => /INSERT INTO byok_connection/i.test(sql))).toBe(false);
  });
});

describe("BYOK internal routes", () => {
  it("requires both the runtime token and signed identity", async () => {
    const { response } = await requestApp("/internal/byok/resolve", {
      method: "POST",
      origin: null,
      body: {},
      headers: { Authorization: "Bearer wrong" },
      env: { BYOK_ASSERTION_PUBLIC_KEY: "configured-but-not-used-for-bad-service-token" },
    });
    expect(response.status).toBe(401);
  });

  it("resolves only an active entitled, profiled, tested current connection", async () => {
    const keys = await generateByokTestKeys();
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "raw-odoo-key");
    const token = await mintByokAssertion({
      privateKeyPem: keys.privateKey,
      issuer: "https://api.auth-dev.vortex.so",
      subject: "plain-user-id",
      connectionId: "conn-1",
      version: 3,
      purpose: "mcp",
      server: "odoo",
    });
    const plans: StatementPlan[] = [
      { match: /SELECT \* FROM byok_connection WHERE id =/i, first: connectionRow(sealed) },
      { match: /SELECT u\.role AS role/i, first: { role: "user", banned: 0, banExpires: null, assigned: 1 } },
      { match: /SELECT bp\.config FROM bootstrap_user_profile/i, first: { config: JSON.stringify({ managedMcpServers: [{ name: "odoo", url: "https://api.auth-dev.vortex.so/mcp/odoo" }] }) } },
    ];
    const { response } = await requestApp("/internal/byok/resolve", {
      method: "POST",
      origin: null,
      body: {},
      headers: {
        Authorization: `Bearer ${RUNTIME_TOKEN}`,
        "x-vortex-identity": `Bearer ${token}`,
        "x-vortex-adapter-contract": ADAPTER_CONTRACT,
      },
      plans,
      env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      adapterContract: ADAPTER_CONTRACT,
      apiKey: "raw-odoo-key",
      version: 3,
      odooUid: 17,
      policy: POLICY,
    });
  });

  it("denies a banned principal even with a still-valid assertion", async () => {
    const keys = await generateByokTestKeys();
    const sealed = await encryptByokCredential(ENCRYPTION_SECRET, "plain-user-id", "conn-1", 3, "raw-odoo-key");
    const token = await mintByokAssertion({
      privateKeyPem: keys.privateKey, issuer: "https://api.auth-dev.vortex.so", subject: "plain-user-id",
      connectionId: "conn-1", version: 3, purpose: "mcp", server: "odoo",
    });
    const { response } = await requestApp("/internal/byok/resolve", {
      method: "POST", origin: null, body: {},
      headers: {
        Authorization: `Bearer ${RUNTIME_TOKEN}`,
        "x-vortex-identity": `Bearer ${token}`,
        "x-vortex-adapter-contract": ADAPTER_CONTRACT,
      },
      plans: [
        { match: /SELECT \* FROM byok_connection WHERE id =/i, first: connectionRow(sealed) },
        { match: /SELECT u\.role AS role/i, first: { role: "user", banned: 1, banExpires: null, assigned: 1 } },
      ],
      env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
    });
    expect(response.status).toBe(403);
  });

  it.each([
    ["other-user-id", 3],
    ["plain-user-id", 2],
  ] as const)("binds resolve to assertion principal %s and version %s", async (subject, version) => {
    const keys = await generateByokTestKeys();
    const token = await mintByokAssertion({
      privateKeyPem: keys.privateKey, issuer: "https://api.auth-dev.vortex.so", subject,
      connectionId: "conn-1", version, purpose: "mcp", server: "odoo",
    });
    const { response, DB } = await requestApp("/internal/byok/resolve", {
      method: "POST", origin: null, body: {},
      headers: {
        Authorization: `Bearer ${RUNTIME_TOKEN}`,
        "x-vortex-identity": `Bearer ${token}`,
        "x-vortex-adapter-contract": ADAPTER_CONTRACT,
      },
      plans: [{ match: /SELECT \* FROM byok_connection WHERE id =/i, first: null }],
      env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
    });
    expect(response.status).toBe(403);
    const lookup = DB.executions.find(({ sql }) => /SELECT \* FROM byok_connection WHERE id =/i.test(sql));
    expect(lookup?.params).toEqual(["conn-1", subject, version]);
  });

  it("retires claim execution without requiring the native adapter contract", async () => {
    const keys = await generateByokTestKeys();
    const token = await mintByokAssertion({
      privateKeyPem: keys.privateKey, issuer: "https://api.auth-dev.vortex.so", subject: "plain-user-id",
      connectionId: "conn-1", version: 3, purpose: "mcp", server: "odoo",
    });
    const { response, DB } = await requestApp("/internal/byok/approvals/approval-1/claim", {
      method: "POST", origin: null, body: {},
      headers: { Authorization: `Bearer ${RUNTIME_TOKEN}`, "x-vortex-identity": `Bearer ${token}` },
      env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "custom_approval_retired",
      code: "custom_approval_retired",
    });
    expect(DB.statements).toHaveLength(0);
  });

  it("rejects raw or unknown tool names from the sanitized audit API", async () => {
    const keys = await generateByokTestKeys();
    const token = await mintByokAssertion({
      privateKeyPem: keys.privateKey, issuer: "https://api.auth-dev.vortex.so", subject: "plain-user-id",
      connectionId: "conn-1", version: 3, purpose: "mcp", server: "odoo",
    });
    const { response, DB } = await requestApp("/internal/byok/audit", {
      method: "POST", origin: null,
      body: { tool: "arbitrary_rpc", outcome: "started" },
      headers: {
        Authorization: `Bearer ${RUNTIME_TOKEN}`,
        "x-vortex-identity": `Bearer ${token}`,
        "x-vortex-adapter-contract": ADAPTER_CONTRACT,
      },
      env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
    });
    expect(response.status).toBe(400);
    expect(DB.statements.some(({ sql }) => /INSERT INTO byok_runtime_audit/i.test(sql))).toBe(false);
  });
});
