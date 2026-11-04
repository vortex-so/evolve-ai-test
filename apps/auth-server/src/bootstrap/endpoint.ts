import type { Context } from "hono";
import { resolveUserProfile, type BootstrapConfig } from "./profiles";
import type { Auth, Env } from "../auth";

async function etagOf(config: BootstrapConfig): Promise<string> {
  const { expiresAt: _drop, ...stable } = config;
  const canonical = JSON.stringify(stable, Object.keys(stable).sort());
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

/**
 * GET /user/bootstrap
 *
 * Bearer validation: Better Auth's device grant returns an opaque session
 * token, not a JWT — so we resolve the session via auth.api.getSession(),
 * which the `bearer` plugin makes work with `Authorization: Bearer <token>`.
 *
 * Claude Desktop contract:
 *   - 200 + JSON body matching bootstrap-config-v2, or 401/403
 *   - Cache-Control: no-store (responses carry credentials)
 *   - Support If-None-Match / return 304 on unchanged config
 *   - Never respond with 3xx — Claude Desktop treats redirects as errors so a
 *     same-origin open redirect can't exfiltrate the bearer.
 *
 * Full spec: https://claude.com/docs/third-party/claude-desktop/bootstrap
 */
export async function bootstrapHandler(
  c: Context<{
    Bindings: Env;
    Variables: {
      auth: Auth;
      session?: Awaited<ReturnType<Auth["api"]["getSession"]>> | null;
    };
  }>,
) {
  c.header("Cache-Control", "no-store");

  const session = c.var.session ?? (await c.var.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null));

  if (!session) return c.json({ error: "invalid_token" }, 401);

  const config = await resolveUserProfile(c.env.DB, {
    gatewayBaseUrl: c.env.INFERENCE_GATEWAY_BASE_URL,
    user: {
      id: session.user.id,
      email: session.user.email,
    },
  });

  const etag = await etagOf(config);
  c.header("ETag", etag);

  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }

  return c.json(config, 200);
}
