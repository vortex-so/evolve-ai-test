import type { Context } from "hono";
import { resolveUserProfileStrict } from "../bootstrap/profiles";
import type { AdminApp } from "../lib/admin-guard";
import { isEntitled } from "../lib/entitlement";
import { getOrProvisionUserKey, invalidateUserKey } from "../lib/key-store";
import { createLitellmClient } from "../lib/litellm";
import {
  getMcpTokenVersion,
  hasValidMcpTokenSecret,
  verifyMcpToken,
} from "../lib/mcp-token";
import { parseGatewayMcpUrl } from "../lib/mcp-url";
import { mcpErrorResponse, proxyMcpRequest } from "./proxy";

type McpContext = Context<AdminApp>;
type UserRow = { id: string; email: string };
const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

function profileAllowsServer(
  config: Record<string, unknown>,
  publicOrigin: string,
  server: string,
): boolean {
  const servers = config.managedMcpServers;
  return Array.isArray(servers) && servers.some((entry) => {
    return (
      typeof entry === "object" &&
      entry !== null &&
      "url" in entry &&
      typeof entry.url === "string" &&
      parseGatewayMcpUrl(publicOrigin, entry.url) === server
    );
  });
}

export async function mcpGatewayHandler(c: McpContext): Promise<Response> {
  const server = c.req.param("server") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/i.test(server)) return c.notFound();
  if (!MCP_METHODS.has(c.req.method)) {
    return new Response(null, { status: 405, headers: { allow: "POST, GET, DELETE" } });
  }
  if (!hasValidMcpTokenSecret(c.env.MCP_TOKEN_SECRET)) {
    return mcpErrorResponse("mcp_gateway_unavailable", 503);
  }
  const mcpTokenSecret = c.env.MCP_TOKEN_SECRET;

  const authorization = c.req.header("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const bearerToken = match?.[1];
  const verified = bearerToken ? await verifyMcpToken(mcpTokenSecret, bearerToken) : null;
  if (!verified) return mcpErrorResponse("invalid_token", 401);

  const currentVersion = await getMcpTokenVersion(c.env.DB, verified.userId);
  if (verified.version !== currentVersion) return mcpErrorResponse("invalid_token", 401);

  const user = await c.env.DB
    .prepare('SELECT id, email FROM "user" WHERE id = ?')
    .bind(verified.userId)
    .first<UserRow>();
  if (!user || !(await isEntitled(c.env.DB, user.id))) {
    return mcpErrorResponse("not_entitled", 403);
  }

  let config: Record<string, unknown> | null;
  try {
    config = await resolveUserProfileStrict(c.env.DB, {
      gatewayBaseUrl: c.env.INFERENCE_GATEWAY_BASE_URL,
      publicOrigin: c.env.PUBLIC_ORIGIN,
      mcpTokenSecret,
      user,
    });
  } catch (error) {
    console.error("MCP profile resolution failed", {
      userId: user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return mcpErrorResponse("profile_unavailable", 503);
  }
  if (!config || !profileAllowsServer(config, c.env.PUBLIC_ORIGIN, server)) {
    return mcpErrorResponse("server_not_allowed", 403);
  }

  const litellm = createLitellmClient({
    baseUrl: c.env.LITELLM_BASE_URL,
    adminKey: c.env.LITELLM_ADMIN_KEY,
  });
  const keyStoreDeps = {
    db: c.env.DB,
    litellm,
    secret: c.env.LITELLM_KEY_ENCRYPTION_SECRET || c.env.BETTER_AUTH_SECRET,
    mcpAccessGroup: c.env.LITELLM_MCP_ACCESS_GROUP,
  };

  let userKey: string;
  try {
    if (!keyStoreDeps.secret) throw new Error("No key encryption secret configured");
    userKey = await getOrProvisionUserKey(keyStoreDeps, user, "mcp");
  } catch (error) {
    console.error("LiteLLM MCP key provisioning failed", {
      userId: user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return mcpErrorResponse("upstream_unavailable", 502);
  }

  const result = await proxyMcpRequest({
    request: c.req.raw,
    baseUrl: c.env.LITELLM_BASE_URL,
    server,
    userKey,
  });
  if (result.kind === "response") return result.response;
  if (result.kind === "network_error") {
    console.error("LiteLLM MCP request failed", { userId: user.id, server });
    return mcpErrorResponse("upstream_unavailable", 502);
  }
  if (result.status === 401) await invalidateUserKey(keyStoreDeps, user.id, "mcp");
  return mcpErrorResponse("upstream_rejected", 502);
}
