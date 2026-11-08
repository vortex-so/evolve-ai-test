import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AdminApp } from "../lib/admin-guard";
import { byokJsonError, readByokJson } from "./http";
import { authorizeByokRuntime, resolveByokRuntime } from "./runtime";

export const ODOO_ADAPTER_CONTRACT = "odoo-native-v2";

const nativeAuditTools = new Set([
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
]);
const auditMetadata = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/),
  z.boolean(),
).refine((value) => Object.keys(value).length <= 8, "too many metadata flags");
const auditInput = z.strictObject({
  tool: z.string().min(1).max(64),
  outcome: z.enum(["started", "success", "failure", "denied"]),
  metadata: auditMetadata.optional(),
});

async function body<T>(c: Context<AdminApp>, schema: z.ZodType<T>): Promise<T | Response> {
  try {
    return schema.parse(await readByokJson(c));
  } catch (error) {
    return byokJsonError(error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "invalid_request", 400);
  }
}

function assertion(c: Context<AdminApp>) {
  return c.var.byokAssertion;
}

function requireAdapterContract(c: Context<AdminApp>): Response | null {
  return c.req.header("x-vortex-adapter-contract") === ODOO_ADAPTER_CONTRACT
    ? null
    : byokJsonError("adapter_contract_mismatch", 409);
}

export function createByokInternalRoutes(): Hono<AdminApp> {
  const routes = new Hono<AdminApp>();
  routes.post("/resolve", async (c) => {
    const contractError = requireAdapterContract(c);
    if (contractError) return contractError;
    const identity = assertion(c);
    if (!identity) return byokJsonError("invalid_identity", 401);
    const parsed = await body(c, z.strictObject({}));
    if (parsed instanceof Response) return parsed;
    const resolved = await resolveByokRuntime(c.env, identity);
    if (!resolved) return byokJsonError("connection_unavailable", 403);
    c.header("cache-control", "no-store");
    return c.json({
      adapterContract: ODOO_ADAPTER_CONTRACT,
      connectionId: resolved.row.id,
      userId: resolved.row.user_id,
      version: resolved.row.version,
      baseUrl: resolved.row.base_url,
      database: resolved.row.database_name,
      login: resolved.row.login,
      apiKey: resolved.apiKey,
      policy: resolved.policy,
      odooUid: resolved.row.odoo_uid,
    });
  });

  routes.post("/approvals/preview", () => byokJsonError("custom_approval_retired", 410));
  routes.post("/approvals/:id/claim", () => byokJsonError("custom_approval_retired", 410));
  routes.post("/approvals/:id/complete", () => byokJsonError("custom_approval_retired", 410));

  routes.post("/audit", async (c) => {
    const contractError = requireAdapterContract(c);
    if (contractError) return contractError;
    const identity = assertion(c);
    if (!identity) return byokJsonError("invalid_identity", 401);
    const parsed = await body(c, auditInput);
    if (parsed instanceof Response) return parsed;
    if (!nativeAuditTools.has(parsed.tool)) return byokJsonError("invalid_tool", 400);
    const authorized = await authorizeByokRuntime(c.env, identity);
    if (!authorized) return byokJsonError("connection_unavailable", 403);
    const result = await c.env.DB.prepare(
      `INSERT INTO byok_runtime_audit (id,connection_id,user_id,version,tool,outcome,approval_id,created_at)
       SELECT ?,?,?,?,?,?,NULL,? FROM byok_connection
       WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL`,
    ).bind(
      crypto.randomUUID(), identity.connectionId, identity.sub, identity.version,
      parsed.tool, parsed.outcome, Date.now(), identity.connectionId, identity.sub, identity.version,
    ).run();
    if ((result.meta.changes ?? 0) !== 1) return byokJsonError("connection_unavailable", 403);
    return c.json({ ok: true });
  });
  return routes;
}
