import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createAuth, type Env } from "./auth";
import { buildDiscoveryMetadata } from "./bootstrap/discovery";
import { bootstrapHandler } from "./bootstrap/endpoint";
import {
  ADMIN_CONSOLE_LOCAL_ORIGIN,
  ADMIN_CONSOLE_ORIGIN,
  adminJsonError,
  blockImpersonated,
  requireAdmin,
  strictAdminOrigin,
  withAuditContext,
  type AdminApp,
} from "./lib/admin-guard";
import { logAuditWriteFailure, writeAudit, type AuditWriteInput } from "./lib/audit";
import { AdminGuardError, banSelfGuard, detectGuardFailure } from "./lib/admin-invariants";
import { createAdminRoutes } from "./routes/admin";
import { createGatewayRoutes } from "./gateway/routes";
import { mcpGatewayHandler } from "./gateway/mcp-routes";
import { createPluginMarketplaceRoutes } from "./plugins/routes";
import { isAdminRole, isEntitled } from "./lib/entitlement";
import { createRefreshTokenService } from "./lib/refresh-token";
import { createOAuthTokenHandler } from "./oauth/token";
import { getStoredKeyAlias } from "./lib/key-store";
import { createLitellmClient } from "./lib/litellm";

const app = new Hono<AdminApp>();

const ALLOWED_ORIGINS = [
  "https://auth.auth-dev.vortex.so",
  ADMIN_CONSOLE_ORIGIN,
  "https://vortex-auth-web-dev.vortex-so.workers.dev",
  "http://localhost:3000",
  ADMIN_CONSOLE_LOCAL_ORIGIN,
];

const corsOptions = {
  origin: (origin: string | undefined) => (ALLOWED_ORIGINS.includes(origin ?? "") ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["content-type", "authorization", "x-requested-with"],
  exposeHeaders: ["set-auth-token", "x-retry-after"],
  maxAge: 600,
};

type AdminContext = Context<AdminApp>;

async function writeSuccessAuditOr500(c: AdminContext, input: AuditWriteInput): Promise<Response | null> {
  try {
    await writeAudit(c.env, c.var.auditContext, input);
    return null;
  } catch {
    return adminJsonError("audit_write_failed", 500);
  }
}

async function writeFailureAudit(c: AdminContext, input: AuditWriteInput): Promise<void> {
  try {
    await writeAudit(c.env, c.var.auditContext, input);
  } catch (error) {
    logAuditWriteFailure(error, input);
  }
}

async function revokeUserSessions(c: AdminContext, userId: string): Promise<void> {
  try {
    const internalAdapter = (await c.var.auth.$context).internalAdapter;
    await internalAdapter.deleteUserSessions(userId);
  } catch (error) {
    console.error("Better Auth session revocation after admin mutation failed", {
      userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

app.use("/api/auth/*", cors(corsOptions));
app.use("/admin/*", cors(corsOptions));

app.use("*", async (c, next) => {
  try {
    c.set("auth", createAuth(c.env));
  } catch (e) {
    const isDev = c.env.NODE_ENV !== "production";
    console.error("AUTH_INIT_ERR", e);
    return c.text(
      isDev ? `AUTH_INIT_ERR: ${String(e)}\n${(e as Error)?.stack ?? ""}` : "Internal Server Error",
      500,
    );
  }

  const testSession = c.req.header("x-test-session");
  if (testSession && c.env.NODE_ENV === "test") {
    try {
      c.set("session", JSON.parse(testSession));
    } catch {
      c.set("session", null);
    }
  } else if (
    c.req.path.startsWith("/v1/")
    || c.req.path.startsWith("/mcp/")
    || c.req.path.startsWith("/claude/plugins/")
    || c.req.path === "/device"
  ) {
    c.set("session", null);
  } else {
    const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers }).catch(() => null);
    c.set("session", session);
  }

  await next();
});

app.onError((err, c) => {
  const isDev = c.env.NODE_ENV !== "production";
  console.error("RUNTIME_ERR", err);
  return c.text(isDev ? `RUNTIME_ERR: ${String(err)}\n${err.stack ?? ""}` : "Internal Server Error", 500);
});

app.get("/.well-known/oauth-authorization-server", (c) => c.json(buildDiscoveryMetadata(c.env.PUBLIC_ORIGIN)));

app.post("/oauth/device", async (c) => c.var.auth.handler(await formToJson(c.req.raw, "/api/auth/device/code")));
app.post("/oauth/token", async (c) => {
  const internalAdapter = (await c.var.auth.$context).internalAdapter;
  const refreshService = createRefreshTokenService({
    db: c.env.DB,
    sessions: {
      async createSession(userId) {
        const session = await internalAdapter.createSession(userId);
        return {
          id: session.id,
          token: session.token,
          expiresAt: session.expiresAt,
        };
      },
      deleteSession: (token) => internalAdapter.deleteSession(token),
    },
    isEntitled: (userId) => isEntitled(c.env.DB, userId),
  });
  return createOAuthTokenHandler({
    authHandler: (request) => c.var.auth.handler(request),
    refreshService,
  })(c.req.raw);
});

app.get("/device", (c) => {
  const redirect = new URL("/auth/device", c.env.AUTH_WEB_ORIGIN);
  const userCode = c.req.query("user_code");
  if (userCode && /^[A-Za-z0-9-]{4,32}$/.test(userCode)) {
    redirect.searchParams.set("user_code", userCode);
  }
  c.header("cache-control", "no-store");
  return c.redirect(redirect.toString(), 302);
});

app.route("/v1", createGatewayRoutes());
app.all("/mcp/:server", mcpGatewayHandler);
app.route("/claude/plugins", createPluginMarketplaceRoutes());

app.get("/user/bootstrap", (c) => bootstrapHandler(c));

app.use("/admin/*", strictAdminOrigin, requireAdmin, blockImpersonated, withAuditContext);
app.route("/admin", createAdminRoutes());

app.on(["POST", "GET"], "/api/auth/admin/*", async (c) => {
  const path = c.req.path.replace(/^\/api\/auth/, "");
  const body = await readJsonBody(c.req.raw.clone());
  const targetId = getAdminTargetId(body);
  const method = c.req.method.toUpperCase();
  const isMutation = method !== "GET";

  const guardResponse = await runAdminChain(c);
  if (guardResponse) {
    if (isMutation) {
      await writeFailureAudit(c, {
        action: `better_auth${path.replaceAll("/", ".")}`,
        target_type: "user",
        target_id: targetId,
        target_snapshot: body,
        outcome: "failure",
        status_code: guardResponse.status,
      });
    }
    return guardResponse;
  }

  try {
    if (method === "POST" && path === "/admin/set-role") {
      return await handleSetRole(c, body);
    }
    if (method === "POST" && path === "/admin/remove-user") {
      return await handleRemoveUser(c, body);
    }
    if (method === "POST" && path === "/admin/ban-user") {
      return await handleBanUser(c, body);
    }
  } catch (error) {
    if (error instanceof AdminGuardError) {
      if (isMutation) {
        await writeFailureAudit(c, {
          action: `better_auth${path.replaceAll("/", ".")}`,
          target_type: "user",
          target_id: targetId,
          target_snapshot: body,
          outcome: "failure",
          status_code: error.status,
        });
      }
      return adminJsonError(error.code, error.status);
    }
    throw error;
  }

  let response: Response;
  try {
    response = await c.var.auth.handler(c.req.raw);
  } catch (error) {
    if (isMutation) {
      await writeFailureAudit(c, {
        action: `better_auth${path.replaceAll("/", ".")}`,
        target_type: "user",
        target_id: targetId,
        target_snapshot: body,
        outcome: "failure",
        status_code: 500,
        metadata: { error: String(error) },
      });
    }
    throw error;
  }
  if (isMutation) {
    const auditFailure = await writeSuccessAuditOr500(c, {
      action: `better_auth${path.replaceAll("/", ".")}`,
      target_type: "user",
      target_id: targetId,
      target_snapshot: body,
      outcome: response.ok ? "success" : "failure",
      status_code: response.status,
    });
    if (auditFailure) {
      return auditFailure;
    }
  }
  return response;
});

app.on(["POST", "GET"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

app.get("/", (c) =>
  c.json({
    service: "vortex-auth-server",
    ui: "https://auth.auth-dev.vortex.so",
    discovery: `${c.env.PUBLIC_ORIGIN}/.well-known/oauth-authorization-server`,
    bootstrap: `${c.env.PUBLIC_ORIGIN}/user/bootstrap`,
  }),
);

async function formToJson(req: Request, newPath: string): Promise<Request> {
  const url = new URL(req.url);
  url.pathname = newPath;
  const ct = req.headers.get("content-type") ?? "";
  const headers = new Headers(req.headers);
  const obj: Record<string, string> = {};
  if (ct.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await req.formData();
      for (const [k, v] of form) obj[k] = String(v);
    } catch {}
  } else if (req.body) {
    const text = await req.text();
    if (text) {
      try {
        Object.assign(obj, JSON.parse(text) as Record<string, string>);
      } catch {}
    }
  }
  if (!obj.client_id) obj.client_id = "claude-desktop";
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(url, { method: req.method, headers, body: JSON.stringify(obj) });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getAdminTargetId(body: Record<string, unknown>): string | null {
  const value = body.userId ?? body.user_id;
  return typeof value === "string" ? value : null;
}

async function runAdminChain(c: AdminContext) {
  for (const middleware of [strictAdminOrigin, requireAdmin, blockImpersonated, withAuditContext] as const) {
    let nextCalled = false;
    const response = await middleware(c, async () => {
      nextCalled = true;
    });
    if (response instanceof Response) {
      return response;
    }
    if (!nextCalled) {
      return adminJsonError("unauthenticated", 401);
    }
  }
  return null;
}

async function handleSetRole(
  c: AdminContext,
  body: Record<string, unknown>,
) {
  const targetUserId = typeof body.userId === "string" ? body.userId : null;
  const newRole = typeof body.role === "string" ? body.role : null;
  if (!targetUserId || !newRole) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.set-role",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: 400,
    });
    return adminJsonError("invalid_request", 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE user SET role = ? WHERE id = ?
      AND (
        (role != 'admin' AND (',' || replace(role, ' ', '') || ',') NOT LIKE '%,admin,%')
        OR (? = 'admin' OR (',' || replace(?, ' ', '') || ',') LIKE '%,admin,%')
        OR (
          SELECT COUNT(*) FROM user
          WHERE (role = 'admin' OR (',' || replace(role, ' ', '') || ',') LIKE '%,admin,%')
            AND id != ?
        ) > 0
      )`,
  )
    .bind(newRole, targetUserId, newRole, newRole, targetUserId)
    .run();

  const guardFailure = detectGuardFailure(result, "last_admin_protected", "Cannot demote the last admin");

  if (guardFailure) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.set-role",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: guardFailure.status,
    });
    return new Response(JSON.stringify(guardFailure), { status: guardFailure.status, headers: { "content-type": "application/json" } });
  }

  const auditFailure = await writeSuccessAuditOr500(c, {
    action: "better_auth.admin.set-role",
    target_type: "user",
    target_id: targetUserId,
    target_snapshot: body,
    outcome: "success",
    status_code: 200,
  });
  if (!isAdminRole(newRole)) {
    await revokeUserSessions(c, targetUserId);
  }
  if (auditFailure) {
    return auditFailure;
  }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
}

async function handleRemoveUser(
  c: AdminContext,
  body: Record<string, unknown>,
) {
  const targetUserId = typeof body.userId === "string" ? body.userId : null;
  if (!targetUserId) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.remove-user",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: 400,
    });
    return adminJsonError("invalid_request", 400);
  }

  const [storedInferenceKeyAlias, storedMcpKeyAlias] = await Promise.all([
    getStoredKeyAlias(c.env.DB, targetUserId, "inference"),
    getStoredKeyAlias(c.env.DB, targetUserId, "mcp"),
  ]);

  const result = await c.env.DB.prepare(
    `DELETE FROM user WHERE id = ?
      AND (
        (role != 'admin' AND (',' || replace(role, ' ', '') || ',') NOT LIKE '%,admin,%')
        OR (
          SELECT COUNT(*) FROM user
          WHERE (role = 'admin' OR (',' || replace(role, ' ', '') || ',') LIKE '%,admin,%')
            AND id != ?
        ) > 0
      )`,
  )
    .bind(targetUserId, targetUserId)
    .run();

  const guardFailure = detectGuardFailure(result, "last_admin_protected", "Cannot delete the last admin");

  if (guardFailure) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.remove-user",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: guardFailure.status,
    });
    return new Response(JSON.stringify(guardFailure), { status: guardFailure.status, headers: { "content-type": "application/json" } });
  }

  const auditFailure = await writeSuccessAuditOr500(c, {
    action: "better_auth.admin.remove-user",
    target_type: "user",
    target_id: targetUserId,
    target_snapshot: body,
    outcome: "success",
    status_code: 200,
  });
  await revokeUserSessions(c, targetUserId);
  if (auditFailure) {
    return auditFailure;
  }
  const storedKeyAliases = [storedInferenceKeyAlias, storedMcpKeyAlias].filter(
    (alias): alias is string => alias !== null,
  );
  if (storedKeyAliases.length > 0) {
    try {
      await createLitellmClient({
        baseUrl: c.env.LITELLM_BASE_URL,
        adminKey: c.env.LITELLM_ADMIN_KEY,
      }).deleteKeysByAlias(storedKeyAliases);
    } catch (error) {
      console.error("LiteLLM key cleanup after user removal failed", {
        userId: targetUserId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
}

async function handleBanUser(
  c: AdminContext,
  body: Record<string, unknown>,
) {
  const targetUserId = typeof body.userId === "string" ? body.userId : null;
  if (!targetUserId) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.ban-user",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: 400,
    });
    return adminJsonError("invalid_request", 400);
  }

  banSelfGuard(c.var.adminSession!, targetUserId);

  const reason = typeof body.banReason === "string" ? body.banReason : "Policy violation";
  const expires = typeof body.banExpiresIn === "number" ? new Date(Date.now() + body.banExpiresIn * 1000).toISOString() : null;
  const result = await c.env.DB.prepare(
    `UPDATE user SET banned = 1, banReason = ?, banExpires = ?
      WHERE id = ?
        AND (
          (role != 'admin' AND (',' || replace(role, ' ', '') || ',') NOT LIKE '%,admin,%')
          OR (
            SELECT COUNT(*) FROM user
            WHERE (role = 'admin' OR (',' || replace(role, ' ', '') || ',') LIKE '%,admin,%')
              AND (
                COALESCE(banned, 0) = 0
                OR (
                  banExpires IS NOT NULL
                  AND CASE
                    WHEN typeof(banExpires) IN ('integer', 'real') THEN
                      CASE
                        WHEN abs(CAST(banExpires AS REAL)) < 1000000000000
                          THEN CAST(banExpires AS REAL) * 1000
                        ELSE CAST(banExpires AS REAL)
                      END
                    WHEN json_valid(trim(CAST(banExpires AS TEXT))) THEN
                      CASE
                        WHEN json_type(trim(CAST(banExpires AS TEXT))) IN ('integer', 'real') THEN
                          CASE
                            WHEN abs(CAST(banExpires AS REAL)) < 1000000000000
                              THEN CAST(banExpires AS REAL) * 1000
                            ELSE CAST(banExpires AS REAL)
                          END
                        ELSE NULL
                      END
                    WHEN unixepoch(CAST(banExpires AS TEXT)) IS NOT NULL THEN
                      unixepoch(CAST(banExpires AS TEXT)) * 1000
                    ELSE NULL
                  END <= unixepoch('now') * 1000
                )
              )
              AND id != ?
          ) > 0
        )`,
  )
    .bind(reason, expires, targetUserId, targetUserId)
    .run();

  const guardFailure = detectGuardFailure(result, "last_admin_protected", "Cannot ban the last active admin");

  if (guardFailure) {
    await writeFailureAudit(c, {
      action: "better_auth.admin.ban-user",
      target_type: "user",
      target_id: targetUserId,
      target_snapshot: body,
      outcome: "failure",
      status_code: guardFailure.status,
    });
    return new Response(JSON.stringify(guardFailure), { status: guardFailure.status, headers: { "content-type": "application/json" } });
  }

  const auditFailure = await writeSuccessAuditOr500(c, {
    action: "better_auth.admin.ban-user",
    target_type: "user",
    target_id: targetUserId,
    target_snapshot: body,
    outcome: "success",
    status_code: 200,
  });
  await revokeUserSessions(c, targetUserId);
  if (auditFailure) {
    return auditFailure;
  }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
}

export default app satisfies ExportedHandler<Env>;
