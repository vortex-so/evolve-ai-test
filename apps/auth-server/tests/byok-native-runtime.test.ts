import { describe, expect, it } from "vitest";
import { encryptByokCredential } from "../src/byok/crypto";
import { mintByokAssertion } from "../src/byok/identity";
import { LEGACY_ODOO_POLICY, NATIVE_ODOO_POLICY, nativeConnectionRow } from "./_helpers/byok-native";
import { generateByokTestKeys } from "./_helpers/byok-keys";
import { requestApp, type StatementPlan } from "./_helpers/test-app";

const ADAPTER_CONTRACT = "odoo-native-v2";
const ENCRYPTION_SECRET = "test-byok-encryption-secret-with-entropy";
const RUNTIME_TOKEN = "test-byok-runtime-token-with-entropy";
const NATIVE_AUDIT_TOOLS = [
  "data_quality_report",
  "diagnose_odoo_call",
  "generate_json2_payload",
  "inspect_model_relationships",
  "diagnose_access",
  "upgrade_risk_report",
  "analyze_upgrade_log",
  "lookup_model_history",
  "fit_gap_report",
  "build_domain",
  "business_pack_report",
  "get_odoo_profile",
  "schema_catalog",
  "health_check",
  "list_instances",
  "list_models",
  "get_model_fields",
  "search_records",
  "read_record",
  "read_attachment",
  "aggregate_records",
  "search_employee",
  "search_holidays",
  "preview_write",
  "validate_write",
  "execute_approved_write",
  "chatter_post",
  "execute_method",
  "index_knowledge",
  "search_knowledge",
  "knowledge_stats",
  "receivable_payable_aging",
  "accounting_health_summary",
  "search_across_instances",
  "aggregate_across_instances",
  "accounting_health_across_instances",
  "submit_async_task",
  "get_async_task",
  "cancel_async_task",
  "list_async_tasks",
  "test_connection",
] as const;

async function internalIdentity(options: {
  subject?: string;
  version?: number;
  contract?: string | null;
} = {}) {
  const keys = await generateByokTestKeys();
  const token = await mintByokAssertion({
    privateKeyPem: keys.privateKey,
    issuer: "https://api.auth-dev.vortex.so",
    subject: options.subject ?? "plain-user-id",
    connectionId: "conn-native-1",
    version: options.version ?? 7,
    purpose: "mcp",
    server: "odoo",
  });
  return {
    headers: {
      Authorization: `Bearer ${RUNTIME_TOKEN}`,
      "x-vortex-identity": `Bearer ${token}`,
      ...(options.contract === null
        ? {}
        : { "x-vortex-adapter-contract": options.contract ?? ADAPTER_CONTRACT }),
    },
    env: { BYOK_ASSERTION_PUBLIC_KEY: keys.publicKey },
  };
}

function runtimePlans(row: Record<string, unknown> | null): StatementPlan[] {
  return [
    { match: /SELECT \* FROM byok_connection WHERE id =/i, first: row },
    { match: /SELECT u\.role AS role/i, first: { role: "user", banned: 0, banExpires: null, assigned: 1 } },
    {
      match: /SELECT bp\.config FROM bootstrap_user_profile/i,
      first: {
        config: JSON.stringify({
          managedMcpServers: [{ name: "odoo", url: "https://api.auth-dev.vortex.so/mcp/odoo" }],
        }),
      },
    },
  ];
}

async function nativeRow(overrides: Record<string, unknown> = {}) {
  const sealed = await encryptByokCredential(
    ENCRYPTION_SECRET,
    "plain-user-id",
    "conn-native-1",
    7,
    "raw-native-odoo-key",
  );
  return nativeConnectionRow(sealed, overrides);
}

describe("S1 native runtime contract", () => {
  it.each(["/internal/byok/resolve", "/internal/byok/audit"])(
    "rejects an old adapter on %s before any D1 work",
    async (path) => {
      const auth = await internalIdentity({ contract: null });
      const { response, DB } = await requestApp(path, {
        method: "POST",
        origin: null,
        body: path.endsWith("/audit") ? { tool: "health_check", outcome: "started" } : {},
        headers: auth.headers,
        env: auth.env,
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "adapter_contract_mismatch",
        code: "adapter_contract_mismatch",
      });
      expect(DB.statements).toHaveLength(0);
    },
  );

  it("returns native policy and the pinned adapter contract from resolve", async () => {
    const auth = await internalIdentity();
    const { response } = await requestApp("/internal/byok/resolve", {
      method: "POST",
      origin: null,
      body: {},
      headers: auth.headers,
      env: auth.env,
      plans: runtimePlans(await nativeRow()),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      adapterContract: ADAPTER_CONTRACT,
      userId: "plain-user-id",
      version: 7,
      policy: NATIVE_ODOO_POLICY,
      apiKey: "raw-native-odoo-key",
    });
  });

  it("never authorizes a legacy policy even with a valid current identity", async () => {
    const auth = await internalIdentity();
    const { response } = await requestApp("/internal/byok/resolve", {
      method: "POST",
      origin: null,
      body: {},
      headers: auth.headers,
      env: auth.env,
      plans: runtimePlans(await nativeRow({
        credential_ciphertext: "malformed-before-decryption",
        credential_iv: "malformed-before-decryption",
        policy_json: JSON.stringify(LEGACY_ODOO_POLICY),
      })),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "connection_unavailable",
      code: "connection_unavailable",
    });
  });

  it("keeps connection lookup bound to the signed user and version", async () => {
    const auth = await internalIdentity({ subject: "other-user-id", version: 6 });
    const { response, DB } = await requestApp("/internal/byok/resolve", {
      method: "POST",
      origin: null,
      body: {},
      headers: auth.headers,
      env: auth.env,
      plans: runtimePlans(null),
    });
    expect(response.status).toBe(403);
    const lookup = DB.executions.find(({ sql }) => /SELECT \* FROM byok_connection WHERE id =/i.test(sql));
    expect(lookup?.params).toEqual(["conn-native-1", "other-user-id", 6]);
  });
});

describe("S5 native runtime audit", () => {
  it("accepts the pinned native catalog plus test_connection without creating approvals", async () => {
    const auth = await internalIdentity();
    const row = await nativeRow();
    for (const tool of NATIVE_AUDIT_TOOLS) {
      const { response, DB } = await requestApp("/internal/byok/audit", {
        method: "POST",
        origin: null,
        body: {
          tool,
          outcome: "started",
          ...(tool === "submit_async_task" ? { metadata: { asyncJobSubmitted: true } } : {}),
        },
        headers: auth.headers,
        env: auth.env,
        plans: [
          ...runtimePlans(row),
          { match: /INSERT INTO byok_runtime_audit/i, run: { meta: { changes: 1 } } },
        ],
      });
      expect(response.status, tool).toBe(200);
      expect(DB.statements.some(({ sql }) => /byok_approval/i.test(sql))).toBe(false);
      const insert = DB.statements.find(({ sql }) => /INSERT INTO byok_runtime_audit/i.test(sql));
      expect(insert?.params[4]).toBe(tool);
      expect(insert?.sql).toMatch(/tool,outcome,approval_id,created_at[\s\S]*SELECT \?,\?,\?,\?,\?,\?,NULL,\?/i);
      expect(insert?.params).toHaveLength(10);
    }
  });

  it.each([
    { tool: "scan_addons_source", outcome: "started" },
    { tool: "arbitrary_rpc", outcome: "started" },
    { tool: "submit_async_task", outcome: "started", metadata: { jobId: "job-secret-1" } },
    { tool: "submit_async_task", outcome: "started", arguments: { apiKey: "secret" } },
  ])("rejects unknown tools and identifier or payload content %#", async (body) => {
    const auth = await internalIdentity();
    const { response, DB } = await requestApp("/internal/byok/audit", {
      method: "POST",
      origin: null,
      body,
      headers: auth.headers,
      env: auth.env,
    });
    expect(response.status).toBe(400);
    expect(DB.statements).toHaveLength(0);
  });
});
