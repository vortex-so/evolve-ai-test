import type { MiddlewareHandler } from "hono";
import type { Auth, Env } from "../auth";
import { getActiveAdminStatus } from "./entitlement";
import type { ByokAssertion } from "../byok/identity";

export const ADMIN_CONSOLE_ORIGIN = "https://console.auth-dev.vortex.so";
export const ADMIN_CONSOLE_LOCAL_ORIGIN = "http://localhost:3001";

export type AdminSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export type AuditContext = {
  actor_user_id: string;
  actor_email_snapshot: string;
  actor_role_snapshot: string;
  acting_as_user_id: string | null;
  request_id: string;
  ip: string | null;
  user_agent: string | null;
};

export type AdminApp = {
  Bindings: Env;
  Variables: {
    auth: Auth;
    session?: AdminSession | null;
    adminSession?: AdminSession;
    auditContext?: AuditContext;
    byokAssertion?: ByokAssertion;
  };
};

export function adminJsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error, code: error }), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function getImpersonatedBy(session: AdminSession): string | null {
  const raw = session as AdminSession & {
    impersonatedBy?: unknown;
    session?: { impersonatedBy?: unknown };
  };
  const value = raw.impersonatedBy ?? raw.session?.impersonatedBy;
  if (value && typeof value === "object" && "userId" in value && typeof value.userId === "string") {
    return value.userId;
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildAuditContext(
  c: Parameters<MiddlewareHandler<AdminApp>>[0],
  session: AdminSession,
): AuditContext {
  const forwardedFor = c.req.header("x-forwarded-for");
  return {
    actor_user_id: session.user.id,
    actor_email_snapshot: session.user.email,
    actor_role_snapshot: session.user.role ?? "user",
    acting_as_user_id: getImpersonatedBy(session),
    request_id: crypto.randomUUID(),
    ip: c.req.header("cf-connecting-ip") ?? forwardedFor?.split(",")[0]?.trim() ?? null,
    user_agent: c.req.header("user-agent") ?? null,
  };
}

export const strictAdminOrigin: MiddlewareHandler<AdminApp> = async (c, next) => {
  const origin = c.req.header("origin");
  if (origin !== ADMIN_CONSOLE_ORIGIN && origin !== ADMIN_CONSOLE_LOCAL_ORIGIN) {
    return adminJsonError("origin_mismatch", 403);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AdminApp> = async (c, next) => {
  const session = c.get("session") ?? (await c.get("auth").api.getSession({ headers: c.req.raw.headers }).catch(() => null));

  if (!session) {
    return adminJsonError("unauthenticated", 401);
  }

  if (!(await getActiveAdminStatus(c.env.DB, session.user.id))) {
    return adminJsonError("not_admin", 403);
  }

  c.set("session", session);
  c.set("adminSession", session);
  await next();
};

export const blockImpersonated: MiddlewareHandler<AdminApp> = async (c, next) => {
  const session = c.get("adminSession");
  if (!session) {
    return adminJsonError("unauthenticated", 401);
  }
  if (getImpersonatedBy(session)) {
    c.set("auditContext", c.get("auditContext") ?? buildAuditContext(c, session));
    return adminJsonError("impersonated_admin_action_blocked", 403);
  }
  await next();
};

export const withAuditContext: MiddlewareHandler<AdminApp> = async (c, next) => {
  const session = c.get("adminSession");
  if (!session) {
    return adminJsonError("unauthenticated", 401);
  }
  c.set("auditContext", buildAuditContext(c, session));
  await next();
};
