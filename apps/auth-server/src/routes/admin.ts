import { Hono, type Context } from "hono";
import { validateBootstrapConfig } from "../bootstrap/config-schema";
import type { AdminApp } from "../lib/admin-guard";
import {
  logAuditWriteFailure,
  prepareAuditStatement,
  writeAudit,
  type AuditWriteInput,
} from "../lib/audit";
import { detectGuardFailure } from "../lib/admin-invariants";

type DeviceRow = {
  id: string;
  deviceCode: string;
  userCode: string;
  userId: string | null;
  expiresAt: string | number;
  status: string;
  lastPolledAt: string | number | null;
  pollingInterval: number | null;
  clientId: string | null;
  scope: string | null;
  createdAt: number | null;
  userEmail: string | null;
  userName: string | null;
};

type AuditRow = {
  id: string;
  created_at: number;
  request_id: string | null;
  actor_user_id: string | null;
  actor_email_snapshot: string;
  actor_role_snapshot: string;
  acting_as_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_snapshot: string | null;
  outcome: string;
  status_code: number | null;
  metadata: string | null;
  ip: string | null;
  user_agent: string | null;
};

type BootstrapProfileRow = {
  id: string;
  name: string;
  description: string | null;
  config: string;
  schema_version: number;
  is_default: number;
  is_system: number;
  created_at: number;
  updated_at: number;
};

type SessionRow = {
  id: string;
  expiresAt: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  impersonatedBy: string | null;
  userEmail: string | null;
  userName: string | null;
};

type OAuthClientRow = Record<string, unknown> & {
  id: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUris?: string | null;
  scopes?: string | null;
  grantTypes?: string | null;
  responseTypes?: string | null;
  contacts?: string | null;
  metadata?: string | null;
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, code: error, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clampLimit(raw: string | undefined, fallback = 20, max = 100): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function encodeCursor(left: string | number, right: string): string {
  return `${left},${right}`;
}

function decodeCursor(cursor: string): { left: number; right: string } {
  const idx = cursor.indexOf(",");
  if (idx <= 0) throw new Error("invalid_cursor");
  const left = Number(cursor.slice(0, idx));
  const right = cursor.slice(idx + 1);
  if (!Number.isFinite(left) || !right) throw new Error("invalid_cursor");
  return { left, right };
}

function parseJsonField<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeArrayish(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizeBoolean(value: unknown): number | undefined {
  if (typeof value !== "boolean") return undefined;
  return value ? 1 : 0;
}

function normalizeObjectish(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseOAuthClientRow(row: OAuthClientRow): Record<string, unknown> {
  const client = { ...row } as Record<string, unknown>;
  delete client.clientSecret;

  for (const field of ["redirectUris", "scopes", "grantTypes", "responseTypes", "contacts", "metadata"] as const) {
    const value = row[field];
    if (typeof value === "string") {
      client[field] = parseJsonField(value, field === "metadata" ? {} : []);
    }
  }

  return client;
}

function getConstraintErrorStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE|FOREIGN KEY|constraint/i.test(message) ? 409 : null;
}

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

async function first<T>(statement: D1PreparedStatement): Promise<T | null> {
  return (await statement.first<T>()) ?? null;
}

async function writeSuccessAuditOr500(
  c: Context<AdminApp>,
  input: AuditWriteInput,
): Promise<Response | null> {
  try {
    await writeAudit(c.env, c.var.auditContext, input);
    return null;
  } catch {
    return jsonError("audit_write_failed", 500);
  }
}

async function writeFailureAudit(c: Context<AdminApp>, input: AuditWriteInput): Promise<void> {
  try {
    await writeAudit(c.env, c.var.auditContext, input);
  } catch (error) {
    logAuditWriteFailure(error, input);
  }
}

export function createAdminRoutes() {
  const admin = new Hono<AdminApp>();

  admin.get("/audit", async (c) => {
    const limit = clampLimit(c.req.query("limit"), 20, 100);
    const cursor = c.req.query("cursor");
    const clauses = ["1 = 1"];
    const values: Array<string | number> = [];

    const actor = c.req.query("actor");
    if (actor) {
      clauses.push("(actor_user_id = ? OR actor_email_snapshot LIKE ?)");
      values.push(actor, `%${actor}%`);
    }

    for (const [key, column] of [
      ["action", "action"],
      ["target_type", "target_type"],
      ["target_id", "target_id"],
      ["outcome", "outcome"],
    ] as const) {
      const value = c.req.query(key);
      if (value) {
        clauses.push(`${column} = ?`);
        values.push(value);
      }
    }

    const from = c.req.query("from");
    if (from) {
      clauses.push("created_at >= ?");
      values.push(Number(from));
    }

    const to = c.req.query("to");
    if (to) {
      clauses.push("created_at <= ?");
      values.push(Number(to));
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      clauses.push("(created_at < ? OR (created_at = ? AND id > ?))");
      values.push(decoded.left, decoded.left, decoded.right);
    }

    const rows = await all<AuditRow>(
      c.env.DB.prepare(
        `SELECT * FROM audit_log
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC, id ASC
         LIMIT ?`,
      ).bind(...values, limit + 1),
    );

    const next = rows.length > limit ? rows.pop() ?? null : null;
    const parsedRows = rows.map((row) => ({
      ...row,
      target_snapshot: parseJsonField(row.target_snapshot, null),
      metadata: parseJsonField(row.metadata, null),
    }));

    return c.json({
      rows: parsedRows,
      items: parsedRows,
      next_cursor: next ? encodeCursor(next.created_at, next.id) : cursor ?? null,
    });
  });

  admin.get("/devices", async (c) => {
    const limit = clampLimit(c.req.query("limit"), 20, 100);
    const status = c.req.query("status");
    const userId = c.req.query("userId");
    const cursor = c.req.query("cursor");
    const clauses = ["1 = 1"];
    const values: Array<string | number> = [];

    if (status) {
      clauses.push("dc.status = ?");
      values.push(status);
    }
    if (userId) {
      clauses.push("dc.userId = ?");
      values.push(userId);
    }
    if (cursor) {
      const decoded = decodeCursor(cursor);
      clauses.push("(COALESCE(dc.createdAt, 0) < ? OR (COALESCE(dc.createdAt, 0) = ? AND dc.id > ?))");
      values.push(decoded.left, decoded.left, decoded.right);
    }

    const rows = await all<DeviceRow>(
      c.env.DB.prepare(
        `SELECT
          dc.id,
          dc.deviceCode,
          dc.userCode,
          dc.userId,
          dc.expiresAt,
          dc.status,
          dc.lastPolledAt,
          dc.pollingInterval,
          dc.clientId,
          dc.scope,
          dc.createdAt,
          u.email AS userEmail,
          u.name AS userName
         FROM deviceCode dc
         LEFT JOIN user u ON u.id = dc.userId
         WHERE ${clauses.join(" AND ")}
         ORDER BY dc.createdAt DESC, dc.id ASC
          LIMIT ?`,
       ).bind(...values, limit + 1),
     );

    const next = rows.length > limit ? rows.pop() ?? null : null;
    return c.json({
      rows,
      items: rows,
      next_cursor: next ? encodeCursor(next.createdAt ?? 0, next.id) : cursor ?? null,
    });
  });

  admin.post("/devices/expire", async (c) => {
    const body: { deviceCode?: string } = await c.req
      .json<{ deviceCode?: string }>()
      .catch(() => ({} as { deviceCode?: string }));
    if (!body.deviceCode) {
      await writeFailureAudit(c, {
        action: "admin.devices.expire",
        target_type: "device_code",
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("invalid_request", 400);
    }

    const result = await c.env.DB.prepare(
      "UPDATE deviceCode SET status='expired' WHERE deviceCode=? AND status='pending'",
    )
      .bind(body.deviceCode)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      await writeFailureAudit(c, {
        action: "admin.devices.expire",
        target_type: "device_code",
        target_id: body.deviceCode,
        target_snapshot: body,
        outcome: "failure",
        status_code: 404,
      });
      return jsonError("device_not_found_or_not_pending", 404);
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.devices.expire",
      target_type: "device_code",
      target_id: body.deviceCode,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.get("/bootstrap-profiles", async (c) => {
    const rows = await all<BootstrapProfileRow>(
      c.env.DB.prepare("SELECT * FROM bootstrap_profile ORDER BY is_default DESC, is_system DESC, name ASC"),
    );
    const items = rows.map((row) => ({ ...row, config: parseJsonField(row.config, {}) }));
    return c.json({ rows: items, items });
  });

  admin.get("/bootstrap/profiles", async (c) => {
    const rows = await all<BootstrapProfileRow>(
      c.env.DB.prepare("SELECT * FROM bootstrap_profile ORDER BY is_default DESC, is_system DESC, name ASC"),
    );
    const items = rows.map((row) => ({ ...row, config: parseJsonField(row.config, {}) }));
    return c.json({ rows: items, items });
  });

  admin.post("/bootstrap/profiles", async (c) => {
    const body: { name?: string; description?: string | null; config?: unknown; is_default?: boolean } = await c.req
      .json<{ name?: string; description?: string | null; config?: unknown; is_default?: boolean }>()
      .catch(() => ({} as { name?: string; description?: string | null; config?: unknown; is_default?: boolean }));

    if (!body.name || body.config === undefined) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_profiles.create",
        target_type: "bootstrap_profile",
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("invalid_request", 400);
    }

    const validation = validateBootstrapConfig(body.config);
    if (!validation.ok) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_profiles.create",
        target_type: "bootstrap_profile",
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
        metadata: { errors: validation.errors },
      });
      return jsonError("invalid_bootstrap_config", 400, { errors: validation.errors });
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    if (body.is_default) {
      await c.env.DB.prepare("UPDATE bootstrap_profile SET is_default = 0 WHERE is_default = 1").run();
    }

    await c.env.DB.prepare(
      `INSERT INTO bootstrap_profile (
        id, name, description, config, schema_version, is_default, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
      .bind(id, body.name, body.description ?? null, JSON.stringify(validation.data), 1, body.is_default ? 1 : 0, now, now)
      .run();

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.bootstrap_profiles.create",
      target_type: "bootstrap_profile",
      target_id: id,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ profile: { id, ...body, config: validation.data } });
  });

  admin.patch("/bootstrap/profiles/:id", async (c) => {
    const id = c.req.param("id");
    const body: { name?: string; description?: string | null; config?: unknown; is_default?: boolean } = await c.req
      .json<{ name?: string; description?: string | null; config?: unknown; is_default?: boolean }>()
      .catch(() => ({} as { name?: string; description?: string | null; config?: unknown; is_default?: boolean }));

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(body.name);
    }
    if (body.description !== undefined) {
      updates.push("description = ?");
      values.push(body.description ?? null);
    }
    if (body.config !== undefined) {
      const validation = validateBootstrapConfig(body.config);
      if (!validation.ok) {
        await writeFailureAudit(c, {
          action: "admin.bootstrap_profiles.update",
          target_type: "bootstrap_profile",
          target_id: id,
          target_snapshot: body,
          outcome: "failure",
          status_code: 400,
          metadata: { errors: validation.errors },
        });
        return jsonError("invalid_bootstrap_config", 400, { errors: validation.errors });
      }
      updates.push("config = ?");
      values.push(JSON.stringify(validation.data));
    }
    if (body.is_default !== undefined) {
      if (body.is_default) {
        const existing = await c.env.DB.prepare("SELECT id FROM bootstrap_profile WHERE id = ?")
          .bind(id)
          .first();
        if (!existing) {
          await writeFailureAudit(c, {
            action: "admin.bootstrap_profiles.update",
            target_type: "bootstrap_profile",
            target_id: id,
            target_snapshot: body,
            outcome: "failure",
            status_code: 404,
          });
          return jsonError("profile_not_found", 404);
        }
        await c.env.DB.prepare("UPDATE bootstrap_profile SET is_default = 0 WHERE is_default = 1 AND id != ?")
          .bind(id)
          .run();
      }
      updates.push("is_default = ?");
      values.push(body.is_default ? 1 : 0);
    }

    if (updates.length === 0) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_profiles.update",
        target_type: "bootstrap_profile",
        target_id: id,
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("no_fields_to_update", 400);
    }

    updates.push("updated_at = ?");
    values.push(Date.now());
    const result = await c.env.DB.prepare(`UPDATE bootstrap_profile SET ${updates.join(", ")} WHERE id = ?`).bind(...values, id).run();
    if ((result.meta?.changes ?? 0) === 0) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_profiles.update",
        target_type: "bootstrap_profile",
        target_id: id,
        target_snapshot: body,
        outcome: "failure",
        status_code: 404,
      });
      return jsonError("profile_not_found", 404);
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.bootstrap_profiles.update",
      target_type: "bootstrap_profile",
      target_id: id,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.delete("/bootstrap/profiles/:id", async (c) => {
    const id = c.req.param("id");
    const result = await c.env.DB.prepare("DELETE FROM bootstrap_profile WHERE id=? AND is_system=0").bind(id).run();
    const guardFailure = detectGuardFailure(result, "system_profile_protected", "System profiles cannot be deleted");
    if (guardFailure) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_profiles.delete",
        target_type: "bootstrap_profile",
        target_id: id,
        outcome: "failure",
        status_code: guardFailure.status,
      });
      return jsonError(guardFailure.code, guardFailure.status, { message: guardFailure.message });
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.bootstrap_profiles.delete",
      target_type: "bootstrap_profile",
      target_id: id,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.get("/bootstrap/assignments/:user_id", async (c) => {
    const userId = c.req.param("user_id");
    const assignment = await first(
      c.env.DB.prepare(
        `SELECT bup.user_id, bup.profile_id, bup.assigned_by_user_id, bup.created_at, bup.updated_at, bp.name AS profile_name
         FROM bootstrap_user_profile bup
         JOIN bootstrap_profile bp ON bp.id = bup.profile_id
         WHERE bup.user_id = ?`,
      ).bind(userId),
    );
    return c.json({ assignment });
  });

  admin.put("/bootstrap/assignments/:user_id", async (c) => {
    const userId = c.req.param("user_id");
    const body: { profile_id?: string } = await c.req
      .json<{ profile_id?: string }>()
      .catch(() => ({} as { profile_id?: string }));
    if (!body.profile_id) {
      await writeFailureAudit(c, {
        action: "admin.bootstrap_assignments.upsert",
        target_type: "bootstrap_assignment",
        target_id: userId,
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("invalid_request", 400);
    }

    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO bootstrap_user_profile (user_id, profile_id, assigned_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         profile_id=excluded.profile_id,
         updated_at=?,
         assigned_by_user_id=?`,
    )
      .bind(userId, body.profile_id, c.var.adminSession?.user.id ?? null, now, now, now, c.var.adminSession?.user.id ?? null)
      .run();

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.bootstrap_assignments.upsert",
      target_type: "bootstrap_assignment",
      target_id: userId,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.delete("/bootstrap/assignments/:user_id", async (c) => {
    const userId = c.req.param("user_id");
    await c.env.DB.prepare("DELETE FROM bootstrap_user_profile WHERE user_id = ?").bind(userId).run();
    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.bootstrap_assignments.delete",
      target_type: "bootstrap_assignment",
      target_id: userId,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.post("/users/:id/mcp-token/rotate", async (c) => {
    const userId = c.req.param("id");
    const rotatedAt = Date.now();
    const rotateStatement = c.env.DB.prepare(
      `INSERT INTO mcp_token_version (user_id, version, rotated_at)
       VALUES (?, 2, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         version = mcp_token_version.version + 1,
         rotated_at = excluded.rotated_at`,
    )
      .bind(userId, rotatedAt);
    const auditStatement = prepareAuditStatement(c.env.DB, c.var.auditContext, {
      action: "admin.mcp_token.rotate",
      target_type: "user",
      target_id: userId,
      outcome: "success",
      status_code: 200,
    });
    if (!auditStatement) return jsonError("audit_write_failed", 500);
    try {
      await c.env.DB.batch([rotateStatement, auditStatement]);
    } catch {
      return jsonError("audit_write_failed", 500);
    }
    return c.json({ success: true });
  });

  admin.get("/sessions", async (c) => {
    const limit = clampLimit(c.req.query("limit"), 20, 100);
    const cursor = c.req.query("cursor");
    const clauses = ["1 = 1"];
    const values: Array<string> = [];

    if (cursor) {
      const decoded = decodeCursor(cursor);
      clauses.push("(s.createdAt < ? OR (s.createdAt = ? AND s.id > ?))");
      values.push(String(decoded.left), String(decoded.left), decoded.right);
    }

    const rows = await all<SessionRow>(
      c.env.DB.prepare(
        `SELECT
          s.id,
          s.expiresAt,
          s.token,
          s.createdAt,
          s.updatedAt,
          s.ipAddress,
          s.userAgent,
          s.userId,
          s.impersonatedBy,
          u.email AS userEmail,
          u.name AS userName
         FROM session s
         LEFT JOIN user u ON u.id = s.userId
         WHERE ${clauses.join(" AND ")}
         ORDER BY s.createdAt DESC, s.id ASC
         LIMIT ?`,
      ).bind(...values, limit + 1),
    );

    const next = rows.length > limit ? rows.pop() ?? null : null;
    return c.json({ rows, items: rows, next_cursor: next ? encodeCursor(next.createdAt, next.id) : cursor ?? null });
  });

  admin.get("/user/:id/details", async (c) => {
    const id = c.req.param("id");
    const user = await first(
      c.env.DB.prepare(
        `SELECT
          u.*,
          COALESCE(s.sessions, '[]') AS sessions,
          COALESCE(a.accounts, '[]') AS accounts,
          COALESCE(tf.twoFactor, '[]') AS twoFactor,
          COALESCE(pk.passkeys, '[]') AS passkeys
         FROM user u
         LEFT JOIN (
           SELECT userId, json_group_array(json_object('id', id, 'createdAt', createdAt, 'updatedAt', updatedAt, 'expiresAt', expiresAt, 'ipAddress', ipAddress, 'userAgent', userAgent, 'impersonatedBy', impersonatedBy)) AS sessions
           FROM session GROUP BY userId
         ) s ON s.userId = u.id
         LEFT JOIN (
           SELECT userId, json_group_array(json_object('id', id, 'accountId', accountId, 'providerId', providerId, 'scope', scope, 'createdAt', createdAt, 'updatedAt', updatedAt)) AS accounts
           FROM account GROUP BY userId
         ) a ON a.userId = u.id
         LEFT JOIN (
           SELECT userId, json_group_array(json_object('id', id, 'verified', verified, 'failedVerificationCount', failedVerificationCount, 'lockedUntil', lockedUntil)) AS twoFactor
           FROM twoFactor GROUP BY userId
         ) tf ON tf.userId = u.id
         LEFT JOIN (
           SELECT userId, json_group_array(json_object('id', id, 'name', name, 'credentialID', credentialID, 'counter', counter, 'deviceType', deviceType, 'backedUp', backedUp, 'transports', transports, 'createdAt', createdAt, 'aaguid', aaguid)) AS passkeys
           FROM passkey GROUP BY userId
         ) pk ON pk.userId = u.id
         WHERE u.id = ?`,
      ).bind(id),
    );

    if (!user) {
      return jsonError("user_not_found", 404);
    }

    return c.json({
      user: {
        ...(user as Record<string, unknown>),
        sessions: parseJsonField((user as { sessions: string }).sessions, []),
        accounts: parseJsonField((user as { accounts: string }).accounts, []),
        twoFactor: parseJsonField((user as { twoFactor: string }).twoFactor, []),
        passkeys: parseJsonField((user as { passkeys: string }).passkeys, []),
      },
    });
  });

  admin.get("/oauth-clients", async (c) => {
    const rows = await all<OAuthClientRow>(c.env.DB.prepare("SELECT * FROM oauthClient ORDER BY name ASC LIMIT 100"));
    const sanitized = rows.map(parseOAuthClientRow);
    return c.json({ rows: sanitized, items: sanitized, next_cursor: null });
  });

  admin.get("/oauth-clients/:id", async (c) => {
    const id = c.req.param("id");
    const client = await first<OAuthClientRow>(c.env.DB.prepare("SELECT * FROM oauthClient WHERE id = ?").bind(id));

    if (!client) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.get",
        target_type: "oauth_client",
        target_id: id,
        outcome: "failure",
        status_code: 404,
      });
      return jsonError("oauth_client_not_found", 404);
    }

    return c.json(parseOAuthClientRow(client));
  });

  admin.post("/oauth-clients", async (c) => {
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));

    const redirectUris = Array.isArray(body.redirectUris) ? body.redirectUris : body.redirect_uris;
    const scopes = Array.isArray(body.scopes) ? body.scopes : undefined;
    const grantTypes = Array.isArray(body.grantTypes) ? body.grantTypes : body.grant_types;
    const responseTypes = Array.isArray(body.responseTypes) ? body.responseTypes : body.response_types;
    const tokenEndpointAuthMethod =
      typeof body.tokenEndpointAuthMethod === "string"
        ? body.tokenEndpointAuthMethod
        : typeof body.token_endpoint_auth_method === "string"
          ? body.token_endpoint_auth_method
          : undefined;
    const requirePKCE =
      typeof body.requirePKCE === "boolean"
        ? body.requirePKCE
        : typeof body.require_pkce === "boolean"
          ? body.require_pkce
          : undefined;
    const contacts = Array.isArray(body.contacts) ? body.contacts : undefined;

    if (!Array.isArray(redirectUris) || !Array.isArray(scopes) || !Array.isArray(grantTypes) || !Array.isArray(responseTypes)) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.create",
        target_type: "oauth_client",
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("invalid_request", 400);
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomUUID();
    const normalizedRequirePKCE = normalizeBoolean(requirePKCE) ?? 0;

    try {
      await c.env.DB.prepare(
        `INSERT INTO oauthClient (
          id, clientId, clientSecret, name, uri, redirectUris, scopes, grantTypes, responseTypes,
          tokenEndpointAuthMethod, requirePKCE, contacts, metadata, is_system, disabled, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
        .bind(
          id,
          clientId,
          clientSecret,
          typeof body.name === "string" ? body.name : null,
          typeof body.uri === "string" ? body.uri : null,
          JSON.stringify(redirectUris),
          JSON.stringify(scopes),
          JSON.stringify(grantTypes),
          JSON.stringify(responseTypes),
          tokenEndpointAuthMethod ?? null,
          normalizedRequirePKCE,
          normalizeArrayish(contacts) ?? null,
          normalizeObjectish(body.metadata) ?? null,
          now,
          now,
        )
        .run();
    } catch (error) {
      const status = getConstraintErrorStatus(error) ?? 500;
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.create",
        target_type: "oauth_client",
        target_id: id,
        target_snapshot: body,
        outcome: "failure",
        status_code: status,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return jsonError(status === 409 ? "oauth_client_conflict" : "oauth_client_create_failed", status);
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.oauth_clients.create",
      target_type: "oauth_client",
      target_id: id,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }

    return c.json({ id, clientId, clientSecret });
  });

  admin.patch("/oauth-clients/:id", async (c) => {
    const id = c.req.param("id");
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const map: Array<[string, unknown]> = [
      ["name", body.name],
      ["uri", body.uri],
      ["logoUri", body.logo_uri],
      ["redirectUris", normalizeArrayish(body.redirectUris)],
      ["scopes", normalizeArrayish(body.scopes)],
      ["contacts", normalizeArrayish(body.contacts)],
      ["tos", body.tos],
      ["policy", body.policy],
    ];

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [column, value] of map) {
      if (value !== undefined) {
        updates.push(`${column} = ?`);
        values.push((value as string | number | null) ?? null);
      }
    }

    if (updates.length === 0) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.update",
        target_type: "oauth_client",
        target_id: id,
        target_snapshot: body,
        outcome: "failure",
        status_code: 400,
      });
      return jsonError("no_fields_to_update", 400);
    }

    const result = await c.env.DB.prepare(`UPDATE oauthClient SET ${updates.join(", ")} WHERE id = ?`).bind(...values, id).run();
    if ((result.meta?.changes ?? 0) === 0) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.update",
        target_type: "oauth_client",
        target_id: id,
        target_snapshot: body,
        outcome: "failure",
        status_code: 404,
      });
      return jsonError("oauth_client_not_found", 404);
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.oauth_clients.update",
      target_type: "oauth_client",
      target_id: id,
      target_snapshot: body,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.post("/oauth-clients/:id/rotate-secret", async (c) => {
    const id = c.req.param("id");
    const clientSecret = crypto.randomUUID();
    const updatedAt = Date.now();

    const result = await c.env.DB.prepare("UPDATE oauthClient SET clientSecret = ?, updatedAt = ? WHERE id = ?")
      .bind(clientSecret, updatedAt, id)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.rotate_secret",
        target_type: "oauth_client",
        target_id: id,
        outcome: "failure",
        status_code: 404,
      });
      return jsonError("oauth_client_not_found", 404);
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.oauth_clients.rotate_secret",
      target_type: "oauth_client",
      target_id: id,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }

    return c.json({ id, clientSecret });
  });

  admin.delete("/oauth-clients/:id", async (c) => {
    const id = c.req.param("id");
    const result = await c.env.DB.prepare("DELETE FROM oauthClient WHERE id = ? AND is_system = 0").bind(id).run();
    const guardFailure = detectGuardFailure(result, "system_client_protected", "System OAuth clients cannot be deleted");

    if (guardFailure) {
      await writeFailureAudit(c, {
        action: "admin.oauth_clients.delete",
        target_type: "oauth_client",
        target_id: id,
        outcome: "failure",
        status_code: guardFailure.status,
      });
      return jsonError(guardFailure.code, guardFailure.status, { message: guardFailure.message });
    }

    const auditFailure = await writeSuccessAuditOr500(c, {
      action: "admin.oauth_clients.delete",
      target_type: "oauth_client",
      target_id: id,
      outcome: "success",
      status_code: 200,
    });
    if (auditFailure) {
      return auditFailure;
    }
    return c.json({ success: true });
  });

  admin.get("/oauth-clients/:id/consents", async (c) => {
    const id = c.req.param("id");
    const items = await all<Record<string, unknown>>(
      c.env.DB.prepare("SELECT * FROM oauthConsent WHERE clientId = ? LIMIT 100").bind(id),
    );
    return c.json({ rows: items, items, next_cursor: null });
  });

  return admin;
}
