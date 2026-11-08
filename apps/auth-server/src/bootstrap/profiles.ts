import type { BootstrapConfig } from "@vortex/schema";
import { validateBootstrapConfig } from "./config-schema";
import {
  getMcpTokenVersion,
  hasValidMcpTokenSecret,
  mintMcpToken,
} from "../lib/mcp-token";
import { getActiveAdminStatus } from "../lib/entitlement";
import { parseGatewayMcpUrl } from "../lib/mcp-url";

export type { BootstrapConfig };

type ProfileContext = {
  gatewayBaseUrl: string;
  publicOrigin?: string;
  mcpTokenSecret?: string;
  user: {
    id: string;
    email: string;
    roles?: string[];
  };
};

/**
 * Base config shared by every entitled user. Overlay role-specific fields
 * on top of this in `selectProfile`.
 */
function baseConfig({ gatewayBaseUrl, user }: ProfileContext): BootstrapConfig {
  return {
    $schemaVersion: 1,
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: gatewayBaseUrl,
    inferenceGatewayAuthScheme: "bearer",
    // `interactive` + same-origin gateway means the same bearer used for the
    // bootstrap request is reused for inference. Origin-pinning enforces this.
    inferenceCredentialKind: "interactive",
    inferenceModels: [
      { name: "claude-sonnet-5", anthropicFamilyTier: "sonnet", isFamilyDefault: true },
      { name: "claude-haiku-4-5", anthropicFamilyTier: "haiku", isFamilyDefault: true },
    ],
    otlpResourceAttributes: {
      "user.id": user.id,
      "user.email": user.email,
    },
    // Cache for 1 hour. Claude Desktop re-checks every 10 minutes by default
    // (configRecheckIntervalMinutes supports 2-30) with If-None-Match.
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function injectMcpAuthorization(
  db: D1Database,
  config: BootstrapConfig,
  ctx: ProfileContext,
): Promise<BootstrapConfig> {
  if (!ctx.publicOrigin) return config;
  const servers: unknown = config.managedMcpServers;
  if (!Array.isArray(servers)) return config;

  const hasGatewayServer = servers.some(
    (entry) =>
      isRecord(entry) &&
      typeof entry.url === "string" &&
      parseGatewayMcpUrl(ctx.publicOrigin!, entry.url) !== null,
  );
  if (!hasGatewayServer) {
    return config;
  }

  let authorization: string | null = null;
  if (hasValidMcpTokenSecret(ctx.mcpTokenSecret)) {
    const version = await getMcpTokenVersion(db, ctx.user.id);
    authorization = `Bearer ${await mintMcpToken(ctx.mcpTokenSecret, ctx.user.id, version)}`;
  }
  const managedMcpServers = servers.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.url !== "string" ||
      parseGatewayMcpUrl(ctx.publicOrigin!, entry.url) === null
    ) {
      return entry;
    }
    const existingHeaders = isRecord(entry.headers)
      ? Object.fromEntries(
          Object.entries(entry.headers).filter(
            ([name]) => name.toLowerCase() !== "authorization",
          ),
        )
      : {};
    const headers = authorization
      ? { ...existingHeaders, Authorization: authorization }
      : existingHeaders;
    const updated = { ...entry };
    if (Object.keys(headers).length > 0) updated.headers = headers;
    else delete updated.headers;
    return updated;
  });

  return { ...config, managedMcpServers };
}

async function mergeDynamicFields(
  db: D1Database,
  config: BootstrapConfig,
  ctx: ProfileContext,
): Promise<BootstrapConfig> {
  const base = baseConfig(ctx);
  const servedConfig = { ...config };
  delete servedConfig.$schema;

  return injectMcpAuthorization(
    db,
    {
      ...servedConfig,
      $schemaVersion: 1,
      inferenceGatewayBaseUrl: base.inferenceGatewayBaseUrl,
      expiresAt: base.expiresAt,
      otlpResourceAttributes: {
        ...(config.otlpResourceAttributes ?? {}),
        ...(base.otlpResourceAttributes ?? {}),
      },
    },
    ctx,
  );
}

export function selectProfile(ctx: ProfileContext): BootstrapConfig {
  const base = baseConfig(ctx);
  const roles = new Set(ctx.user.roles ?? []);

  if (roles.has("cowork-power-user")) {
    return {
      ...base,
      inferenceModels: [
        { name: "claude-opus-5", anthropicFamilyTier: "opus", isFamilyDefault: true, supports1m: true, prefer1m: true },
        { name: "claude-sonnet-5", anthropicFamilyTier: "sonnet", isFamilyDefault: true },
      ],
      coworkEgressAllowedHosts: [
        "*.example.corp",
        "pypi.org",
        "registry.npmjs.org",
        "github.com",
      ],
    };
  }

  return base;
}

export function resolveFallbackRoles(_userId: string): string[] {
  return ["cowork-user"];
}

export async function resolveUserProfile(
  db: D1Database,
  ctx: ProfileContext,
): Promise<BootstrapConfig>;
export async function resolveUserProfile(
  db: D1Database,
  ctx: ProfileContext,
): Promise<BootstrapConfig> {
  const userId = ctx.user.id;

  const assigned = await db
    .prepare(
      `SELECT profile_id
       FROM bootstrap_user_profile
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ profile_id: string }>()
    .catch(() => null);

  const selected = assigned?.profile_id
    ? await db
        .prepare("SELECT config, schema_version FROM bootstrap_profile WHERE id = ?")
        .bind(assigned.profile_id)
        .first<{ config: string; schema_version: number }>()
        .catch(() => null)
    : await db
        .prepare("SELECT config, schema_version FROM bootstrap_profile WHERE is_default = 1")
        .first<{ config: string; schema_version: number }>()
        .catch(() => null);

  if (selected?.config) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(selected.config) as unknown;
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === "object" && Object.keys(parsed as Record<string, unknown>).length > 0) {
      const validation = validateBootstrapConfig(parsed);
      if (validation.ok) {
        return mergeDynamicFields(db, validation.data, ctx);
      }
    }
  }

  return selectProfile({
    ...ctx,
    user: {
      ...ctx.user,
      roles: resolveFallbackRoles(userId),
    },
  });
}

export async function resolveUserProfileStrict(
  db: D1Database,
  ctx: ProfileContext,
): Promise<BootstrapConfig | null> {
  const assigned = await db
    .prepare(
      `SELECT profile_id
       FROM bootstrap_user_profile
       WHERE user_id = ?`,
    )
    .bind(ctx.user.id)
    .first<{ profile_id: string }>();

  let selected: { config: string; schema_version: number } | null;
  if (assigned?.profile_id) {
    selected = await db
      .prepare("SELECT config, schema_version FROM bootstrap_profile WHERE id = ?")
      .bind(assigned.profile_id)
      .first<{ config: string; schema_version: number }>();
  } else {
    if (!(await getActiveAdminStatus(db, ctx.user.id))) return null;
    selected = await db
      .prepare("SELECT config, schema_version FROM bootstrap_profile WHERE is_default = 1")
      .first<{ config: string; schema_version: number }>();
  }

  if (!selected?.config) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(selected.config) as unknown;
  } catch {
    return null;
  }
  const validation = validateBootstrapConfig(parsed);
  return validation.ok ? validation.data : null;
}
