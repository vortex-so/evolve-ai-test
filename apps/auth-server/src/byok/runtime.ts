import { getActiveAdminStatus, isEntitled } from "../lib/entitlement";
import { decryptByokCredential } from "./crypto";
import { connectionPolicy, getConnectionByIdentity, profileAllowsOdoo, type ConnectionRow } from "./db";
import type { ByokAssertion } from "./identity";
import type { Env } from "../auth";
import type { OdooPolicy } from "@vortex/schema";

type RuntimeConnectionRow = ConnectionRow & {
  credential_ciphertext: string;
  credential_iv: string;
};

export type AuthorizedByok = {
  row: RuntimeConnectionRow;
  policy: OdooPolicy;
};

export type ResolvedByok = {
  row: ConnectionRow;
  policy: OdooPolicy;
  apiKey: string;
};

export async function authorizeByokRuntime(env: Env, assertion: ByokAssertion): Promise<AuthorizedByok | null> {
  const row = await getConnectionByIdentity(env.DB, assertion.connectionId, assertion.sub, assertion.version);
  if (!row || !row.credential_ciphertext || !row.credential_iv) return null;
  let policy: OdooPolicy;
  try {
    policy = connectionPolicy(row);
  } catch {
    return null;
  }
  if (assertion.purpose === "test") {
    if (!assertion.actorId || !(await getActiveAdminStatus(env.DB, assertion.actorId))) return null;
  } else {
    if (!(await isEntitled(env.DB, assertion.sub))) return null;
    if (!(await profileAllowsOdoo(env.DB, assertion.sub, env.PUBLIC_ORIGIN))) return null;
    if (row.enabled !== 1 || row.test_status !== "ok" || row.tested_version !== row.version) return null;
  }
  return { row: row as RuntimeConnectionRow, policy };
}

export async function resolveByokRuntime(env: Env, assertion: ByokAssertion): Promise<ResolvedByok | null> {
  const authorized = await authorizeByokRuntime(env, assertion);
  if (!authorized) return null;
  const { row, policy } = authorized;
  const secret = env.BYOK_ENCRYPTION_SECRET?.trim();
  if (!secret) return null;
  try {
    const apiKey = await decryptByokCredential(secret, row.user_id, row.id, row.version, {
      ciphertext: row.credential_ciphertext,
      iv: row.credential_iv,
    });
    return { row, policy, apiKey };
  } catch {
    return null;
  }
}
