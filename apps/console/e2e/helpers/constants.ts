export const CONSOLE_ORIGIN =
  process.env.PLAYWRIGHT_CONSOLE_ORIGIN ?? "https://console.auth-dev.vortex.so";
export const AUTH_ORIGIN =
  process.env.PLAYWRIGHT_AUTH_ORIGIN ?? "https://auth.auth-dev.vortex.so";
export const AUTH_API_ORIGIN =
  process.env.PLAYWRIGHT_AUTH_API_ORIGIN ?? "https://api.auth-dev.vortex.so";

export const ADMIN_EMAIL = "solution+e2e-admin@vortex.so";
export const ADMIN_PASSWORD = "password12345";
export const NON_ADMIN_EMAIL = "solution+e2e-non-admin@vortex.so";
export const NON_ADMIN_PASSWORD = "password12345";
export const DEFAULT_PASSWORD = "password12345";

export const CLOUDFLARE_ACCOUNT_ID = "672d1c1c2706c8738992bcd09704f6a4";
export const D1_DATABASE_ID = "0688760e-154e-4a61-8319-4e1d14a7c910";

export const POSTMARK_SERVER_TOKEN = process.env.PLAYWRIGHT_POSTMARK_TOKEN ?? "";
export const CLOUDFLARE_API_TOKEN = process.env.PLAYWRIGHT_CF_TOKEN ?? "";
