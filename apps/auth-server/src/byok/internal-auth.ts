import type { MiddlewareHandler } from "hono";
import type { AdminApp } from "../lib/admin-guard";
import { verifyByokAssertion } from "./identity";
import { byokJsonError } from "./http";

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let difference = left.length === right.length ? 0 : 1;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index]! ^ rightHash[index]!;
  return difference === 0;
}

function bearer(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(\S+)$/);
  return match?.[1] ?? null;
}

export const requireByokInternalAuth: MiddlewareHandler<AdminApp> = async (c, next) => {
  const configuredToken = c.env.BYOK_RUNTIME_TOKEN?.trim();
  const publicKey = c.env.BYOK_ASSERTION_PUBLIC_KEY?.trim();
  const serviceToken = bearer(c.req.header("authorization"));
  const assertionToken = bearer(c.req.header("x-vortex-identity"));
  if (!configuredToken || configuredToken.length < 32 || !publicKey) {
    return byokJsonError("byok_unavailable", 503);
  }
  if (!serviceToken || !(await constantTimeEqual(serviceToken, configuredToken))) {
    return byokJsonError("invalid_service_token", 401);
  }
  if (!assertionToken) return byokJsonError("invalid_identity", 401);
  try {
    c.set("byokAssertion", await verifyByokAssertion({
      token: assertionToken,
      publicKeyPem: publicKey,
      issuer: c.env.PUBLIC_ORIGIN,
    }));
  } catch {
    return byokJsonError("invalid_identity", 401);
  }
  await next();
};
