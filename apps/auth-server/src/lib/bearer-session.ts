import type { Context } from "hono";
import type { AdminApp, AdminSession } from "./admin-guard";

export async function authenticateBearerSession(c: Context<AdminApp>): Promise<AdminSession | null> {
  const authorization = c.req.header("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null;

  const testSession = c.req.header("x-test-session");
  if (c.env.NODE_ENV === "test" && testSession) {
    return c.get("session") ?? null;
  }

  return c.get("auth").api.getSession({
    headers: new Headers({ authorization }),
  }).catch(() => null);
}
