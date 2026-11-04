import { Hono, type Context } from "hono";
import type { AdminApp } from "../lib/admin-guard";
import { isEntitled } from "../lib/entitlement";
import { getOrProvisionUserKey, invalidateUserKey } from "../lib/key-store";
import { createLitellmClient } from "../lib/litellm";
import {
  provisioningFailureResponse,
  proxyInferenceRequest,
  upstreamKeyRejectedResponse,
  upstreamNetworkErrorResponse,
} from "./proxy";

function gatewayError(type: "authentication_error" | "permission_error", message: string, status: number) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

type GatewayContext = Context<AdminApp>;

async function authenticateGateway(c: GatewayContext) {
  const authorization = c.req.header("authorization");
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) return null;

  const testSession = c.req.header("x-test-session");
  if (c.env.NODE_ENV === "test" && testSession) {
    return c.get("session") ?? null;
  }

  return c.get("auth").api.getSession({
    headers: new Headers({ authorization }),
  }).catch(() => null);
}

async function gatewayHandler(c: GatewayContext) {
  const session = await authenticateGateway(c);
  if (!session) {
    return gatewayError("authentication_error", "A valid bearer token is required", 401);
  }
  if (!(await isEntitled(c.env.DB, session.user.id))) {
    return gatewayError("permission_error", "This user is not entitled to inference", 403);
  }

  const litellm = createLitellmClient({
    baseUrl: c.env.LITELLM_BASE_URL,
    adminKey: c.env.LITELLM_ADMIN_KEY,
  });
  const keyStoreDeps = {
    db: c.env.DB,
    litellm,
    secret: c.env.BETTER_AUTH_SECRET,
  };

  let userKey: string;
  try {
    userKey = await getOrProvisionUserKey(keyStoreDeps, {
      id: session.user.id,
      email: session.user.email,
    });
  } catch (error) {
    console.error("LiteLLM key provisioning failed", {
      userId: session.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return provisioningFailureResponse();
  }

  const result = await proxyInferenceRequest({
    request: c.req.raw,
    baseUrl: c.env.LITELLM_BASE_URL,
    userKey,
  });
  if (result.kind === "response") return result.response;
  if (result.kind === "network_error") {
    console.error("LiteLLM inference request failed", { userId: session.user.id });
    return upstreamNetworkErrorResponse();
  }

  await invalidateUserKey(keyStoreDeps, session.user.id);
  return upstreamKeyRejectedResponse();
}

const gateway = new Hono<AdminApp>();

gateway.post("/messages", gatewayHandler);
gateway.post("/messages/count_tokens", gatewayHandler);
gateway.get("/models", gatewayHandler);

export function createGatewayRoutes() {
  return gateway;
}
