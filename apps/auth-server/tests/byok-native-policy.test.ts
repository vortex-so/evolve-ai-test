import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptByokCredential, encryptByokCredential } from "../src/byok/crypto";
import { mintByokAssertion } from "../src/byok/identity";
import { parseOdooPolicy } from "../src/byok/validation";
import {
  LEGACY_ODOO_POLICY,
  NATIVE_ODOO_DEFAULT_POLICY,
  NATIVE_ODOO_POLICY,
  nativeConnectionRow,
} from "./_helpers/byok-native";
import { generateByokTestKeys } from "./_helpers/byok-keys";
import {
  adminSession,
  requestApp,
  TEST_CONSOLE_ORIGIN,
  TEST_WRONG_ORIGIN,
} from "./_helpers/test-app";

const ENCRYPTION_SECRET = "test-byok-encryption-secret-with-entropy";
const RUNTIME_TOKEN = "test-byok-runtime-token-with-entropy";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function internalAuth() {
  const keys = await generateByokTestKeys();
  const assertion = await mintByokAssertion({
    privateKeyPem: keys.privateKey,
    issuer: "https://api.auth-dev.vortex.so",
    subject: "plain-user-id",
    connectionId: "conn-native-1",
    version: 7,
    purpose: "mcp",
    server: "odoo",
  });
  return {
    headers: {
      Authorization: `Bearer ${RUNTIME_TOKEN}`,
      "x-vortex-identity": `Bearer ${assertion}`,
      "content-type": "application/json",
    },
    env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
  };
}

describe("native Odoo policy v2", () => {
  it("accepts the exact native contract and canonicalizes method entries", () => {
    expect(parseOdooPolicy({
      policyVersion: 2,
      enableWrites: true,
      allowedSideEffectMethods: [
        " project.task.write ",
        "project.task.create",
        "project.task.write",
      ],
    })).toEqual(NATIVE_ODOO_POLICY);
  });

  it("defaults an absent policy to native default-deny", () => {
    expect(parseOdooPolicy(undefined, { allowDefault: true })).toEqual(NATIVE_ODOO_DEFAULT_POLICY);
  });

  it.each([
    { ...NATIVE_ODOO_POLICY, allowedProjectIds: [7] },
    { ...NATIVE_ODOO_POLICY, preset: "project-tasks" },
    { ...NATIVE_ODOO_POLICY, readProjects: true },
    LEGACY_ODOO_POLICY,
  ])("rejects project-scoped, preset, extra, and legacy policy shapes %#", (policy) => {
    expect(() => parseOdooPolicy(policy)).toThrow();
  });

  it.each([
    {
      ...NATIVE_ODOO_POLICY,
      allowedSideEffectMethods: Array.from({ length: 201 }, (_, index) => `x.model_${index}.write`),
    },
    {
      ...NATIVE_ODOO_POLICY,
      allowedSideEffectMethods: [`x.${"m".repeat(250)}.write`],
    },
    { ...NATIVE_ODOO_POLICY, allowedSideEffectMethods: ["project.task.*"] },
    { ...NATIVE_ODOO_POLICY, allowedSideEffectMethods: ["project.task.write()"] },
    { ...NATIVE_ODOO_POLICY, allowedSideEffectMethods: ["project.task"] },
    { ...NATIVE_ODOO_POLICY, allowedSideEffectMethods: ["project task.write"] },
  ])("rejects unbounded or non-exact model.method entries %#", (policy) => {
    expect(() => parseOdooPolicy(policy)).toThrow();
  });
});

describe("native Odoo admin connection contract", () => {
  it("accepts a native PUT, keeps the ERP origin fixed, rewraps at the next version, and never returns credentials", async () => {
    const rawCredential = "raw-native-odoo-key";
    const oldSealed = await encryptByokCredential(
      ENCRYPTION_SECRET,
      "plain-user-id",
      "conn-native-1",
      7,
      rawCredential,
    );
    const existing = nativeConnectionRow(oldSealed);
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: {
        version: 7,
        database: "vortex",
        login: "user@example.com",
        enabled: false,
        policy: NATIVE_ODOO_POLICY,
      },
      plans: [
        { match: /SELECT id FROM "user"/i, first: { id: "plain-user-id" } },
        { match: /SELECT \* FROM byok_connection WHERE user_id/i, first: existing },
        { match: /UPDATE byok_connection SET database_name/i, run: { meta: { changes: 1 } } },
      ],
    });

    expect(response.status).toBe(200);
    const update = DB.batches[0]?.[0];
    expect(update?.params[5]).toBe(8);
    expect(update?.params[6]).toBe(8);
    expect(update?.params[8]).toBe("ok");
    expect(update?.params[10]).toBe(JSON.stringify(NATIVE_ODOO_POLICY));

    const rewrapped = {
      ciphertext: String(update?.params[2]),
      iv: String(update?.params[3]),
    };
    expect(rewrapped).not.toEqual(oldSealed);
    await expect(decryptByokCredential(
      ENCRYPTION_SECRET,
      "plain-user-id",
      "conn-native-1",
      8,
      rewrapped,
    )).resolves.toBe(rawCredential);

    const text = await response.text();
    expect(text).not.toContain(rawCredential);
    expect(text).not.toContain(oldSealed.ciphertext);
    expect(text).not.toContain(oldSealed.iv);
    expect(text).not.toContain(rewrapped.ciphertext);
    expect(text).not.toContain(rewrapped.iv);
    expect(JSON.parse(text)).toMatchObject({
      connection: {
        baseUrl: "https://erp.vortex.so",
        hasCredential: true,
      },
      gatewayUrl: "https://api.auth-dev.vortex.so/mcp/odoo",
      profileAllowsOdoo: false,
    });
  });

  it("does not expand the connection input with a caller-selected Odoo URL", async () => {
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      session: adminSession(),
      body: {
        version: 0,
        baseUrl: "https://other-erp.example.com",
        database: "vortex",
        login: "user@example.com",
        enabled: false,
        apiKey: "raw-native-odoo-key",
        policy: NATIVE_ODOO_POLICY,
      },
    });

    expect(response.status).toBe(400);
    expect(DB.statements.some(({ sql }) => /INSERT INTO byok_connection/i.test(sql))).toBe(false);
  });

  it("keeps strict admin origin enforcement on the native PUT", async () => {
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      origin: TEST_WRONG_ORIGIN,
      session: adminSession(),
      body: {
        version: 0,
        database: "vortex",
        login: "user@example.com",
        enabled: false,
        apiKey: "raw-native-odoo-key",
        policy: NATIVE_ODOO_POLICY,
      },
    });

    expect(response.status).toBe(403);
    expect(DB.statements).toHaveLength(0);
  });

  it("keeps impersonated admins from mutating native Odoo settings", async () => {
    const { response, DB } = await requestApp("/admin/users/plain-user-id/byok/odoo", {
      method: "PUT",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession({ impersonatedBy: { userId: "real-admin-id" } }),
      body: {
        version: 0,
        database: "vortex",
        login: "user@example.com",
        enabled: false,
        apiKey: "raw-native-odoo-key",
        policy: NATIVE_ODOO_POLICY,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "impersonated_admin_action_blocked" });
    expect(DB.statements.some(({ sql }) => /INSERT|UPDATE|DELETE/i.test(sql))).toBe(false);
  });
});

describe("retired custom approval endpoints", () => {
  it("returns 410 for the admin approval list", async () => {
    const { response } = await requestApp("/admin/byok/approvals", {
      session: adminSession(),
    });
    expect(response.status).toBe(410);
  });

  it("returns 410 before validating an admin approval decision", async () => {
    const { response } = await requestApp("/admin/byok/approvals/approval-1", {
      method: "POST",
      session: adminSession(),
      body: {},
    });
    expect(response.status).toBe(410);
  });

  it.each([
    "/internal/byok/approvals/preview",
    "/internal/byok/approvals/approval-1/claim",
    "/internal/byok/approvals/approval-1/complete",
  ])("returns 410 before parsing the retired runtime endpoint %s", async (path) => {
    const auth = await internalAuth();
    const { response } = await requestApp(path, {
      method: "POST",
      origin: null,
      rawBody: "{",
      headers: auth.headers,
      env: auth.env,
    });
    expect(response.status).toBe(410);
  });
});
