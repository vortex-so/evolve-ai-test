import type { OdooPolicy } from "@vortex/schema";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AdminApp, AuditContext } from "../lib/admin-guard";
import { getActiveAdminStatus } from "../lib/entitlement";
import { decryptByokCredential, encryptByokCredential } from "./crypto";
import { connectionMetadata, getConnectionByUser, profileAllowsOdoo, type ConnectionRow } from "./db";
import { byokJsonError, readByokJson } from "./http";
import { mintByokAssertion } from "./identity";
import { testOdooConnection } from "./test-client";
import { parseOdooPolicy } from "./validation";
import { resolveOdooAliases } from "./routing";

const ODOO_ORIGIN = "https://erp.vortex.so";
const connectionInput = z.strictObject({
  version: z.number().int().nonnegative(),
  database: z.string().trim().min(1).max(200),
  login: z.string().trim().min(1).max(320),
  enabled: z.boolean(),
  apiKey: z.string().max(4096).optional(),
  policy: z.unknown(),
});
const versionInput = z.strictObject({ version: z.number().int().positive() });

function routeParam(c: Context<AdminApp>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new Error(`missing route parameter ${name}`);
  return value;
}

function connectionConfig(c: Context<AdminApp>): { encryptionSecret: string } | null {
  const encryptionSecret = c.env.BYOK_ENCRYPTION_SECRET?.trim();
  if (c.env.ODOO_BASE_URL !== ODOO_ORIGIN || !encryptionSecret || encryptionSecret.length < 32) return null;
  return { encryptionSecret };
}

function testConfig(c: Context<AdminApp>): { encryptionSecret: string; privateKey: string; testKey: string; testAlias: string } | null {
  const connection = connectionConfig(c);
  const privateKey = c.env.BYOK_ASSERTION_PRIVATE_KEY?.trim();
  const testKey = c.env.BYOK_TEST_LITELLM_KEY?.trim();
  if (!connection || !privateKey || !testKey) return null;
  try {
    return { ...connection, privateKey, testKey, testAlias: resolveOdooAliases(c.env).test };
  } catch {
    return null;
  }
}

function conditionalAdminAudit(
  db: D1Database,
  ctx: AuditContext,
  input: { nonce: string; source: "byok_connection" | "byok_approval"; action: string; targetType: string; targetId: string; status: number; outcome?: "success" | "failure" },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO audit_log (
      id,created_at,request_id,actor_user_id,actor_email_snapshot,actor_role_snapshot,
      acting_as_user_id,action,target_type,target_id,target_snapshot,outcome,status_code,metadata,ip,user_agent
    ) SELECT ?,?,?,?,?,?,?,?,?,?,NULL,?, ?,NULL,?,?
      FROM ${input.source} WHERE id = ? AND mutation_nonce = ?`,
  ).bind(
    crypto.randomUUID(), Date.now(), ctx.request_id, ctx.actor_user_id, ctx.actor_email_snapshot,
    ctx.actor_role_snapshot, ctx.acting_as_user_id, input.action, input.targetType, input.targetId,
    input.outcome ?? "success", input.status, ctx.ip, ctx.user_agent, input.targetId, input.nonce,
  );
}

function changed(result: D1Result<unknown> | undefined): boolean {
  return (result?.meta.changes ?? 0) === 1;
}

async function connectionResponse(c: Context<AdminApp>, userId: string, connection?: ConnectionRow | null) {
  const row = connection === undefined ? await getConnectionByUser(c.env.DB, userId) : connection;
  return c.json({
    connection: row ? connectionMetadata(row) : null,
    gatewayUrl: `${c.env.PUBLIC_ORIGIN.replace(/\/+$/, "")}/mcp/odoo`,
    profileAllowsOdoo: await profileAllowsOdoo(c.env.DB, userId, c.env.PUBLIC_ORIGIN),
  });
}

async function parseBody<T>(c: Context<AdminApp>, schema: z.ZodType<T>): Promise<T | Response> {
  try {
    return schema.parse(await readByokJson(c));
  } catch (error) {
    return byokJsonError(error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "invalid_request", 400);
  }
}

async function putConnection(c: Context<AdminApp>): Promise<Response> {
  const secrets = connectionConfig(c);
  if (!secrets) return byokJsonError("byok_unavailable", 503);
  const parsed = await parseBody(c, connectionInput);
  if (parsed instanceof Response) return parsed;
  let policy: OdooPolicy;
  try {
    policy = parseOdooPolicy(parsed.policy);
  } catch {
    return byokJsonError("invalid_policy", 400);
  }
  const userId = routeParam(c, "id");
  const user = await c.env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(userId).first<{ id: string }>();
  if (!user) return byokJsonError("user_not_found", 404);
  const existing = await getConnectionByUser(c.env.DB, userId);
  const now = Date.now();
  const nonce = crypto.randomUUID();
  const auditContext = c.var.auditContext;
  if (!auditContext) return byokJsonError("audit_write_failed", 500);

  if (!existing) {
    if (parsed.version !== 0) return byokJsonError("version_conflict", 409);
    if (!parsed.apiKey?.trim()) return byokJsonError("api_key_required", 400);
    const id = crypto.randomUUID();
    const version = 1;
    const sealed = await encryptByokCredential(secrets.encryptionSecret, userId, id, version, parsed.apiKey.trim());
    const insert = c.env.DB.prepare(
      `INSERT INTO byok_connection (
        id,user_id,provider,base_url,database_name,login,credential_ciphertext,credential_iv,
        enabled,version,tested_version,tested_at,test_status,odoo_uid,policy_json,deleted_at,
        mutation_nonce,created_at,updated_at
      ) VALUES (?,?,'odoo',?,?,?,?,?,?,?,NULL,NULL,'not_tested',NULL,?,NULL,?,?,?)`,
    ).bind(
      id, userId, ODOO_ORIGIN, parsed.database, parsed.login, sealed.ciphertext, sealed.iv,
      parsed.enabled ? 1 : 0, version, JSON.stringify(policy), nonce, now, now,
    );
    try {
      const results = await c.env.DB.batch([
        insert,
        conditionalAdminAudit(c.env.DB, auditContext, {
          nonce, source: "byok_connection", action: "admin.byok.odoo.create",
          targetType: "byok_connection", targetId: id, status: 200,
        }),
      ]);
      if (!changed(results[0])) return byokJsonError("version_conflict", 409);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return byokJsonError(/constraint|unique/i.test(message) ? "version_conflict" : "audit_write_failed", /constraint|unique/i.test(message) ? 409 : 500);
    }
    return connectionResponse(c, userId);
  }

  if (parsed.version !== existing.version) return byokJsonError("version_conflict", 409);
  const resurrecting = existing.deleted_at !== null;
  const identityChanged = resurrecting || parsed.database !== existing.database_name || parsed.login !== existing.login;
  const suppliedApiKey = parsed.apiKey?.trim() ?? "";
  if ((identityChanged || resurrecting) && !suppliedApiKey) return byokJsonError("api_key_required", 400);
  const nextVersion = existing.version + 1;
  let apiKey = suppliedApiKey;
  if (!apiKey) {
    if (!existing.credential_ciphertext || !existing.credential_iv) return byokJsonError("api_key_required", 400);
    try {
      apiKey = await decryptByokCredential(secrets.encryptionSecret, userId, existing.id, existing.version, {
        ciphertext: existing.credential_ciphertext,
        iv: existing.credential_iv,
      });
    } catch {
      return byokJsonError("credential_unavailable", 503);
    }
  }
  const sealed = await encryptByokCredential(secrets.encryptionSecret, userId, existing.id, nextVersion, apiKey);
  const policyText = JSON.stringify(policy);
  const policyChanged = policyText !== existing.policy_json;
  const configChanged = identityChanged || policyChanged || Boolean(suppliedApiKey);
  // A successful test is tied to credentials/database/login/policy. Version-only
  // changes, including enable toggles, carry that result onto the new version.
  const preserveTest = !configChanged && existing.tested_version === existing.version && existing.test_status === "ok";
  const testedVersion = preserveTest ? nextVersion : configChanged ? null : existing.tested_version;
  const testStatus = preserveTest ? "ok" : configChanged ? "not_tested" : existing.test_status;
  const testedAt = configChanged ? null : existing.tested_at;
  const odooUid = configChanged ? null : existing.odoo_uid;
  const update = c.env.DB.prepare(
    `UPDATE byok_connection SET database_name=?,login=?,credential_ciphertext=?,credential_iv=?,enabled=?,
      version=?,tested_version=?,tested_at=?,test_status=?,odoo_uid=?,policy_json=?,deleted_at=NULL,mutation_nonce=?,updated_at=?
     WHERE id=? AND user_id=? AND version=?`,
  ).bind(
    parsed.database, parsed.login, sealed.ciphertext, sealed.iv, parsed.enabled ? 1 : 0,
    nextVersion, testedVersion, testedAt, testStatus, odooUid, policyText, nonce, now,
    existing.id, userId, existing.version,
  );
  let results;
  try {
    results = await c.env.DB.batch([
      update,
      conditionalAdminAudit(c.env.DB, auditContext, {
        nonce, source: "byok_connection", action: "admin.byok.odoo.update",
        targetType: "byok_connection", targetId: existing.id, status: 200,
      }),
    ]);
  } catch {
    return byokJsonError("audit_write_failed", 500);
  }
  if (!results || !changed(results[0])) return byokJsonError("version_conflict", 409);
  return connectionResponse(c, userId);
}

async function deleteConnection(c: Context<AdminApp>): Promise<Response> {
  const bodyVersion = Number(c.req.query("version"));
  if (!Number.isInteger(bodyVersion) || bodyVersion < 1) return byokJsonError("invalid_request", 400);
  const userId = routeParam(c, "id");
  const existing = await getConnectionByUser(c.env.DB, userId);
  if (!existing || existing.version !== bodyVersion || existing.deleted_at !== null) return byokJsonError("version_conflict", 409);
  const auditContext = c.var.auditContext;
  if (!auditContext) return byokJsonError("audit_write_failed", 500);
  const nonce = crypto.randomUUID();
  const now = Date.now();
  const update = c.env.DB.prepare(
    `UPDATE byok_connection SET credential_ciphertext=NULL,credential_iv=NULL,enabled=0,version=version+1,
      tested_version=NULL,tested_at=NULL,test_status='not_tested',odoo_uid=NULL,deleted_at=?,mutation_nonce=?,updated_at=?
     WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL`,
  ).bind(now, nonce, now, existing.id, userId, bodyVersion);
  let results;
  try {
    results = await c.env.DB.batch([
      update,
      conditionalAdminAudit(c.env.DB, auditContext, {
        nonce, source: "byok_connection", action: "admin.byok.odoo.delete",
        targetType: "byok_connection", targetId: existing.id, status: 200,
      }),
    ]);
  } catch {
    return byokJsonError("audit_write_failed", 500);
  }
  if (!results || !changed(results[0])) return byokJsonError("version_conflict", 409);
  return connectionResponse(c, userId);
}

async function testConnection(c: Context<AdminApp>): Promise<Response> {
  const secrets = testConfig(c);
  if (!secrets) return byokJsonError("byok_unavailable", 503);
  const parsed = await parseBody(c, versionInput);
  if (parsed instanceof Response) return parsed;
  const userId = routeParam(c, "id");
  const row = await getConnectionByUser(c.env.DB, userId);
  if (!row || row.version !== parsed.version || row.deleted_at !== null) return byokJsonError("version_conflict", 409);
  const actorId = c.var.adminSession?.user.id;
  if (!actorId || !(await getActiveAdminStatus(c.env.DB, actorId))) return byokJsonError("not_admin", 403);
  let assertion: string;
  try {
    assertion = await mintByokAssertion({
      privateKeyPem: secrets.privateKey, issuer: c.env.PUBLIC_ORIGIN, subject: userId,
      connectionId: row.id, version: row.version, purpose: "test", server: "odoo_test", actorId,
    });
  } catch {
    return byokJsonError("byok_unavailable", 503);
  }
  let uid: number | null = null;
  let status: "ok" | "failed" = "failed";
  try {
    uid = await testOdooConnection({
      baseUrl: c.env.LITELLM_BASE_URL,
      serviceKey: secrets.testKey,
      assertion,
      serverAlias: secrets.testAlias,
    });
    status = "ok";
  } catch (error) {
    status = "failed";
    console.warn("byok odoo test failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown error");
  }
  const nonce = crypto.randomUUID();
  const now = Date.now();
  const auditContext = c.var.auditContext;
  if (!auditContext) return byokJsonError("audit_write_failed", 500);
  const update = c.env.DB.prepare(
    `UPDATE byok_connection SET tested_version=?,tested_at=?,test_status=?,odoo_uid=?,mutation_nonce=?,updated_at=?
     WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL`,
  ).bind(status === "ok" ? row.version : null, now, status, uid, nonce, now, row.id, userId, row.version);
  let results;
  try {
    results = await c.env.DB.batch([
      update,
      conditionalAdminAudit(c.env.DB, auditContext, {
        nonce, source: "byok_connection", action: "admin.byok.odoo.test",
        targetType: "byok_connection", targetId: row.id, status: status === "ok" ? 200 : 502,
        outcome: status === "ok" ? "success" : "failure",
      }),
    ]);
  } catch {
    return byokJsonError("audit_write_failed", 500);
  }
  if (!results || !changed(results[0])) return byokJsonError("version_conflict", 409);
  if (status === "failed") return byokJsonError("connection_test_failed", 502);
  return connectionResponse(c, userId);
}

export function createByokAdminRoutes(): Hono<AdminApp> {
  const routes = new Hono<AdminApp>();
  routes.get("/users/:id/byok/odoo", async (c) => {
    const userId = routeParam(c, "id");
    return connectionResponse(c, userId);
  });
  routes.put("/users/:id/byok/odoo", putConnection);
  routes.delete("/users/:id/byok/odoo", deleteConnection);
  routes.post("/users/:id/byok/odoo/test", testConnection);

  routes.get("/byok/approvals", () => byokJsonError("custom_approval_retired", 410));
  routes.post("/byok/approvals/:id", () => byokJsonError("custom_approval_retired", 410));
  return routes;
}
