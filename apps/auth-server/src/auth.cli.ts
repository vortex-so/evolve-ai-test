/**
 * Build-time Better Auth instance used ONLY by the `better-auth generate` CLI
 * to derive the D1 schema. Never imported by the Worker runtime.
 *
 * Uses `node:sqlite` (Node 22.5+/24) so we don't need better-sqlite3's native
 * build. Only the plugin config matters for schema derivation — the actual DB
 * driver is a throwaway.
 *
 * IF YOU CHANGE PLUGIN CONFIG IN src/auth.ts, MIRROR IT HERE.
 */
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { admin, bearer, deviceAuthorization, jwt, twoFactor } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";

const STUB_ORIGIN = "https://example.invalid";

export const auth = betterAuth({
  baseURL: STUB_ORIGIN,
  secret: "cli-stub-secret-not-used-at-runtime",
  database: new DatabaseSync(":memory:"),
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  plugins: [
    bearer(),
    oauthProvider({
      scopes: ["openid", "profile", "email", "offline_access", "bootstrap:read"],
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      allowDynamicClientRegistration: false,
      validAudiences: [STUB_ORIGIN],
    }),
    deviceAuthorization({ interval: "5s", expiresIn: "10m" }),
    jwt({
      jwks: { keyPairConfig: { alg: "RS256" } },
      jwt: { issuer: STUB_ORIGIN, audience: STUB_ORIGIN, expirationTime: "1h" },
    }),
    twoFactor({ issuer: "Vortex Auth" }),
    passkey({ rpID: "example.invalid", rpName: "Vortex Auth", origin: STUB_ORIGIN }),
    admin(),
  ],
});

export default auth;
