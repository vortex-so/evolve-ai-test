import {
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { AUTH_API_ORIGIN } from "./constants";

const CLIENT_ID = "claude-desktop";
const DEVICE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";

export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
  cacheControl: string | undefined;
};

export type TokenPair = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token: string;
  refresh_token_expires_in: number;
};

export type OAuthError = {
  error: string;
};

export type TokenGrantResult = {
  status: number;
  cacheControl: string | undefined;
  body: TokenPair | OAuthError;
};

export async function requestDeviceCode(
  request: APIRequestContext,
): Promise<DeviceAuthorization> {
  const response = await request.post(`${AUTH_API_ORIGIN}/oauth/device`, {
    form: {
      client_id: CLIENT_ID,
      scope: "openid offline_access",
    },
  });
  if (!response.ok()) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      message?: string;
    };
    throw new Error(
      `device authorization failed: status=${response.status()} code=${errorBody.code ?? errorBody.error ?? "unknown"} message=${errorBody.message ?? "unknown"}`,
    );
  }

  const body = (await response.json()) as Omit<
    DeviceAuthorization,
    "cacheControl"
  >;
  return {
    ...body,
    cacheControl: response.headers()["cache-control"],
  };
}

export async function approveDeviceCode(
  page: Page,
  device: DeviceAuthorization,
): Promise<void> {
  await page.goto(device.verification_uri_complete);
  await expect(page.getByText("Approve sign-in?", { exact: true })).toBeVisible();
  await expect(page.getByText(device.user_code, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^approve$/i }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
}

export async function exchangeDeviceCode(
  request: APIRequestContext,
  deviceCode: string,
): Promise<TokenGrantResult> {
  return tokenGrant(request, {
    grant_type: DEVICE_GRANT_TYPE,
    device_code: deviceCode,
    client_id: CLIENT_ID,
  });
}

export async function refreshTokens(
  request: APIRequestContext,
  refreshToken: string,
): Promise<TokenGrantResult> {
  return tokenGrant(request, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
}

export async function pollDeviceToken(
  request: APIRequestContext,
  device: DeviceAuthorization,
  timeoutMs = 60_000,
): Promise<TokenGrantResult & { body: TokenPair }> {
  const deadline = Date.now() + timeoutMs;
  let pollingIntervalSeconds = Math.max(1, device.interval);
  let lastStatus = 0;
  let lastError = "unknown_error";

  while (Date.now() < deadline) {
    const result = await exchangeDeviceCode(request, device.device_code);
    if (result.status === 200 && "access_token" in result.body) {
      return { ...result, body: result.body };
    }

    lastStatus = result.status;
    lastError = "error" in result.body ? result.body.error : "invalid_response";
    if (
      lastStatus !== 400 ||
      (lastError !== "authorization_pending" && lastError !== "slow_down")
    ) {
      break;
    }
    if (lastError === "slow_down") pollingIntervalSeconds += 5;
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalSeconds * 1_000));
  }

  throw new Error(
    `device token polling failed: status=${lastStatus} error=${lastError}`,
  );
}

export async function signInWithDeviceCode(
  page: Page,
  request: APIRequestContext,
): Promise<TokenGrantResult & { body: TokenPair; device: DeviceAuthorization }> {
  const device = await requestDeviceCode(request);
  await approveDeviceCode(page, device);
  return { ...(await pollDeviceToken(request, device)), device };
}

async function tokenGrant(
  request: APIRequestContext,
  form: Record<string, string>,
): Promise<TokenGrantResult> {
  const response = await request.post(`${AUTH_API_ORIGIN}/oauth/token`, { form });
  return {
    status: response.status(),
    cacheControl: response.headers()["cache-control"],
    body: (await response.json()) as TokenPair | OAuthError,
  };
}
