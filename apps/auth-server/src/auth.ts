import { betterAuth } from "better-auth";
import { admin, bearer, deviceAuthorization, jwt, twoFactor } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { kvSecondaryStorage } from "./lib/kv-storage";
import { sendTemplateSafe } from "./lib/postmark";

const INSECURE_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

export type Env = {
  DB: D1Database;
  AUTH_KV: KVNamespace;
  PLUGINS_KV: KVNamespace;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_SECRET_PREVIOUS?: string;
  NODE_ENV: string;
  PUBLIC_ORIGIN: string;
  INFERENCE_GATEWAY_BASE_URL: string;
  LITELLM_BASE_URL: string;
  LITELLM_ADMIN_KEY: string;
  LITELLM_MCP_ACCESS_GROUP?: string;
  /** AES key-wrap secret for stored per-user LiteLLM keys; falls back to BETTER_AUTH_SECRET. */
  LITELLM_KEY_ENCRYPTION_SECRET?: string;
  MCP_TOKEN_SECRET?: string;
  CONSOLE_ORIGIN?: string;
  AUTH_COOKIE_DOMAIN?: string;
  ODOO_BASE_URL?: string;
  ODOO_MCP_ALIAS?: string;
  ODOO_TEST_MCP_ALIAS?: string;
  BYOK_ENCRYPTION_SECRET?: string;
  BYOK_RUNTIME_TOKEN?: string;
  BYOK_ASSERTION_PRIVATE_KEY?: string;
  BYOK_ASSERTION_PUBLIC_KEY?: string;
  BYOK_TEST_LITELLM_KEY?: string;
  MARKETPLACE_PUBLISH_TOKEN?: string;
  AUTH_WEB_ORIGIN: string;
  POSTMARK_SERVER_TOKEN: string;
  POSTMARK_FROM: string;
  PRODUCT_NAME: string;
  PRODUCT_URL: string;
};

/**
 * Build a Better Auth instance for a single request.
 *
 * Why per-request: Cloudflare Workers give us `env` at request time, not at
 * module init. We construct once per request and pass through Hono's context.
 */
export function createAuth(env: Env) {
  const currentSecret = env.BETTER_AUTH_SECRET?.trim();
  const previousSecret = env.BETTER_AUTH_SECRET_PREVIOUS?.trim();
  if (env.NODE_ENV !== "test") {
    if (!currentSecret || currentSecret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters outside tests");
    }
    if (currentSecret === INSECURE_DEFAULT_SECRET) {
      throw new Error("BETTER_AUTH_SECRET must not use Better Auth's public default");
    }
    if (previousSecret && previousSecret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET_PREVIOUS must be at least 32 characters when set");
    }
    if (previousSecret === INSECURE_DEFAULT_SECRET) {
      throw new Error(
        "BETTER_AUTH_SECRET_PREVIOUS cannot preserve Better Auth's public default",
      );
    }
    if (previousSecret === currentSecret) {
      throw new Error("BETTER_AUTH_SECRET_PREVIOUS must differ from BETTER_AUTH_SECRET");
    }
  }

  const rpID = new URL(env.PUBLIC_ORIGIN).hostname;
  const postmarkCfg = {
    token: env.POSTMARK_SERVER_TOKEN,
    from: env.POSTMARK_FROM,
    productName: env.PRODUCT_NAME,
    productUrl: env.PRODUCT_URL,
  };

  return betterAuth({
    baseURL: env.PUBLIC_ORIGIN,
    secret: previousSecret || currentSecret,
    secrets: currentSecret
      ? [
          { version: 2, value: currentSecret },
          ...(previousSecret ? [{ version: 1, value: previousSecret }] : []),
        ]
      : undefined,
    database: env.DB,
    secondaryStorage: kvSecondaryStorage(env.AUTH_KV),
    session: {
      storeSessionInDatabase: true,
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendTemplateSafe(postmarkCfg, {
          to: user.email,
          alias: "vortex-reset-password",
          model: { name: user.name, url },
          tag: "reset-password",
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTemplateSafe(postmarkCfg, {
          to: user.email,
          alias: "vortex-verify-email",
          model: { name: user.name, url },
          tag: "verify-email",
        });
      },
    },

    trustedOrigins: [
      env.PUBLIC_ORIGIN,
      env.AUTH_WEB_ORIGIN,
      env.CONSOLE_ORIGIN ?? "https://console.auth-dev.vortex.so",
      ...(env.NODE_ENV === "test" ? ["https://auth-web-dev.vortex-so.workers.dev"] : []),
    ],

    advanced: {
      useSecureCookies: true,
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      crossSubDomainCookies: {
        enabled: true,
        domain: env.AUTH_COOKIE_DOMAIN ?? ".auth-dev.vortex.so",
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      },
    },

    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 3600, max: 3 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/forget-password": { window: 3600, max: 3 },
        "/two-factor/*": { window: 60, max: 5 },
        "/admin/*": { window: 60, max: 300 },
      },
    },

    plugins: [
      bearer(),

      oauthProvider({
        scopes: ["openid", "profile", "email", "offline_access", "bootstrap:read"],
        loginPage: `${env.AUTH_WEB_ORIGIN}/auth/sign-in`,
        consentPage: `${env.AUTH_WEB_ORIGIN}/auth/oauth-consent`,
        allowDynamicClientRegistration: false,
        validAudiences: [env.PUBLIC_ORIGIN],
      }),

      deviceAuthorization({
        verificationUri: "/device",
        interval: "5s",
        expiresIn: "10m",
      }),

      jwt({
        jwks: { keyPairConfig: { alg: "RS256" } },
        jwt: {
          issuer: env.PUBLIC_ORIGIN,
          audience: env.PUBLIC_ORIGIN,
          expirationTime: "1h",
        },
      }),

      twoFactor({
        issuer: "Vortex Auth",
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await sendTemplateSafe(postmarkCfg, {
              to: user.email,
              alias: "vortex-twofa-otp",
              model: { name: user.name, otp },
              tag: "twofa-otp",
            });
          },
        },
      }),

      passkey({
        rpID,
        rpName: "Vortex Auth",
        origin: env.PUBLIC_ORIGIN,
      }),

      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        impersonationSessionDuration: 3600,
        defaultBanReason: "Policy violation",
        bannedUserMessage:
          "You have been banned. Contact support if you believe this is an error.",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
