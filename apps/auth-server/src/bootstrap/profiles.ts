import type { BootstrapConfig } from "@vortex/schema";
import { validateBootstrapConfig } from "./config-schema";

export type { BootstrapConfig };

type ProfileContext = {
  gatewayBaseUrl: string;
  user: {
    id: string;
    email: string;
    // Populate from your directory; wire this in resolveUserRoles().
    roles?: string[];
  };
};

/**
 * Base config shared by every entitled user. Overlay role-specific fields
 * on top of this in `selectProfile`.
 */
function baseConfig({ gatewayBaseUrl, user }: ProfileContext): BootstrapConfig {
  return {
    $schema:
      "https://claude.com/docs/third-party/claude-desktop/schemas/bootstrap-config-v2.schema.json",
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: gatewayBaseUrl,
    inferenceGatewayAuthScheme: "bearer",
    // `interactive` + same-origin gateway means the same bearer used for the
    // bootstrap request is reused for inference. Origin-pinning enforces this.
    inferenceCredentialKind: "interactive",
    inferenceModels: [
      { name: "claude-sonnet-5", anthropicFamilyTier: "sonnet", isFamilyDefault: true },
      { name: "claude-haiku-5", anthropicFamilyTier: "haiku" },
    ],
    otlpResourceAttributes: {
      "user.id": user.id,
      "user.email": user.email,
    },
    // Cache for 1 hour. Claude Desktop re-polls every 30 min with If-None-Match
    // regardless, so short expiries mostly hurt server load.
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function mergeDynamicFields(
  config: BootstrapConfig,
  ctx: ProfileContext,
): BootstrapConfig {
  const base = baseConfig(ctx);
  return {
    ...config,
    $schema: config.$schema ?? base.$schema,
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

/**
 * Return the set of Claude Desktop entitlements for this user. Empty array
 * means the caller is authenticated but not entitled — the endpoint responds
 * with 403.
 *
 * Wire this to your directory (Entra `roles`/`groups`, Okta `groups`, your own
 * `user_role` table) as needed. For a bare Better Auth deployment where every
 * signed-in user should get the default profile, return `["cowork-user"]`.
 */
export function resolveUserRoles(_userId: string): string[] {
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
    try {
      const parsed = JSON.parse(selected.config) as unknown;
      if (parsed && typeof parsed === "object" && Object.keys(parsed as Record<string, unknown>).length > 0) {
        const validation = validateBootstrapConfig(parsed);
        if (validation.ok) {
          return mergeDynamicFields(validation.data, ctx);
        }
      }
    } catch {}
  }

  return selectProfile({
    ...ctx,
    user: {
      ...ctx.user,
      roles: resolveUserRoles(userId),
    },
  });
}
