import type { BootstrapConfig } from "@vortex/schema";
import { validateBootstrapConfig } from "./config-schema";

export type { BootstrapConfig };

type ProfileContext = {
  gatewayBaseUrl: string;
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

function mergeDynamicFields(
  config: BootstrapConfig,
  ctx: ProfileContext,
): BootstrapConfig {
  const base = baseConfig(ctx);
  const servedConfig = { ...config };
  delete servedConfig.$schema;

  return {
    ...servedConfig,
    $schemaVersion: 1,
    inferenceGatewayBaseUrl: base.inferenceGatewayBaseUrl,
    expiresAt: base.expiresAt,
    otlpResourceAttributes: {
      ...(config.otlpResourceAttributes ?? {}),
      ...(base.otlpResourceAttributes ?? {}),
    },
  };
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
        return mergeDynamicFields(validation.data, ctx);
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
