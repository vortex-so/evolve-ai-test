"use client";

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
