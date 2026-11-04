"use client";

/**
 * Browser-side auth client. INTENTIONALLY WITHOUT `adminClient()` — Phase 4 uses
 * the BFF boundary: browser calls `/api/admin/*` on the console origin, and the
 * console's Route Handlers proxy to auth-server admin endpoints server-to-server
 * with the session cookie. Direct browser -> auth-server admin calls would
 * expose the trust boundary. See apps/console/AGENTS.md.
 */
import { createAuthClient } from "better-auth/react";
import {
  deviceAuthorizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

const BASE_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "https://api.auth-dev.vortex.so";

export const authClient = createAuthClient({
  baseURL: BASE_URL,
  plugins: [
    deviceAuthorizationClient(),
    twoFactorClient(),
    oauthProviderClient(),
  ],
});
