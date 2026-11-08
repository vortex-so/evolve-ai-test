import type { OdooApprovalItem, OdooConnectionMetadata, OdooPolicy } from "@vortex/schema";
import { getActiveAdminStatus } from "../lib/entitlement";
import { parseGatewayMcpUrl } from "../lib/mcp-url";
import { parseOdooPolicy } from "./validation";

export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: "odoo";
  base_url: string;
  database_name: string;
  login: string;
  credential_ciphertext: string | null;
  credential_iv: string | null;
  enabled: number;
  version: number;
  tested_version: number | null;
  tested_at: number | null;
  test_status: "not_tested" | "ok" | "failed";
  odoo_uid: number | null;
  policy_json: string;
  deleted_at: number | null;
  mutation_nonce: string;
  created_at: number;
  updated_at: number;
};

export type ApprovalRow = {
  id: string;
  connection_id: string;
  user_id: string;
  user_email?: string;
  version: number;
  operation: "create" | "update";
  payload_json: string;
  before_json: string | null;
  payload_hash: string;
  status: OdooApprovalItem["status"];
  created_at: number;
  expires_at: number;
  approved_by: string | null;
  approved_at: number | null;
};

export async function getConnectionByUser(db: D1Database, userId: string): Promise<ConnectionRow | null> {
  return (await db.prepare("SELECT * FROM byok_connection WHERE user_id = ?").bind(userId).first<ConnectionRow>()) ?? null;
}

export async function getConnectionByIdentity(
  db: D1Database,
  connectionId: string,
  userId: string,
  version: number,
): Promise<ConnectionRow | null> {
  return (await db.prepare(
    "SELECT * FROM byok_connection WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL",
  ).bind(connectionId, userId, version).first<ConnectionRow>()) ?? null;
}

export function connectionPolicy(row: ConnectionRow): OdooPolicy {
  return parseOdooPolicy(JSON.parse(row.policy_json) as unknown);
}

export function connectionMetadata(row: ConnectionRow): OdooConnectionMetadata {
  let policy: OdooPolicy;
  let policyValid = true;
  try {
    policy = connectionPolicy(row);
  } catch {
    policy = parseOdooPolicy(undefined, { allowDefault: true });
    policyValid = false;
  }
  return {
    id: row.id,
    userId: row.user_id,
    provider: "odoo",
    baseUrl: row.base_url,
    database: row.database_name,
    login: row.login,
    enabled: row.enabled === 1,
    version: row.version,
    hasCredential: Boolean(row.credential_ciphertext && row.credential_iv),
    testedVersion: policyValid ? row.tested_version : null,
    testedAt: policyValid ? row.tested_at : null,
    testStatus: policyValid ? row.test_status : "not_tested",
    odooUid: policyValid ? row.odoo_uid : null,
    policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function configAllowsOdoo(configText: string, publicOrigin: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || !("managedMcpServers" in parsed)) return false;
  const servers = parsed.managedMcpServers;
  return Array.isArray(servers) && servers.some((entry) => {
    if (typeof entry !== "object" || entry === null || !("url" in entry) || typeof entry.url !== "string") return false;
    return parseGatewayMcpUrl(publicOrigin, entry.url) === "odoo";
  });
}

export async function profileAllowsOdoo(
  db: D1Database,
  userId: string,
  publicOrigin: string,
): Promise<boolean> {
  const assigned = await db.prepare(
    `SELECT bp.config FROM bootstrap_user_profile bup
     JOIN bootstrap_profile bp ON bp.id = bup.profile_id
     WHERE bup.user_id = ?`,
  ).bind(userId).first<{ config: string }>();
  if (assigned) return configAllowsOdoo(assigned.config, publicOrigin);
  if (!(await getActiveAdminStatus(db, userId))) return false;
  const fallback = await db.prepare(
    "SELECT config FROM bootstrap_profile WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1",
  ).first<{ config: string }>();
  return fallback ? configAllowsOdoo(fallback.config, publicOrigin) : false;
}

export function approvalItem(row: ApprovalRow): OdooApprovalItem {
  const status = row.status === "executing" && row.expires_at <= Date.now()
    ? "outcome_unknown"
    : row.status;
  return {
    id: row.id,
    connectionId: row.connection_id,
    userId: row.user_id,
    userEmail: row.user_email ?? "",
    version: row.version,
    operation: row.operation,
    payload: JSON.parse(row.payload_json) as OdooApprovalItem["payload"],
    before: row.before_json ? JSON.parse(row.before_json) as object : null,
    payloadHash: row.payload_hash,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
