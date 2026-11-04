import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import {
  AUTH_API_ORIGIN,
  AUTH_ORIGIN,
  CONSOLE_ORIGIN,
  cleanupUser,
  createVerifiedUser,
  d1Exec,
  signInViaApi,
  type DeviceAuthorization,
  type TokenGrantResult,
  type TokenPair,
} from "./helpers";
import {
  approveDeviceCode,
  exchangeDeviceCode,
  pollDeviceToken,
  refreshTokens,
  requestDeviceCode,
  signInWithDeviceCode,
} from "./helpers/device";
import { ADMIN_STATE_PATH } from "./helpers/global-setup";

const BOOTSTRAP_URL = `${AUTH_API_ORIGIN}/user/bootstrap`;
const GATEWAY_URL = `${AUTH_API_ORIGIN}/v1/messages`;

function expectNoStore(cacheControl: string | undefined): void {
  expect(cacheControl).toContain("no-store");
}

function requireTokenPair(result: TokenGrantResult): TokenPair {
  expect(result.status).toBe(200);
  expectNoStore(result.cacheControl);
  if (!("access_token" in result.body)) {
    throw new Error("token response did not contain a token pair");
  }
  return result.body;
}

async function bootstrap(request: APIRequestContext, accessToken: string) {
  return request.get(BOOTSTRAP_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function gateway(
  request: APIRequestContext,
  accessToken?: string,
) {
  return request.post(GATEWAY_URL, {
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    data: {
      model: "claude-haiku-4-5",
      max_tokens: 16,
      stream: true,
      messages: [{ role: "user", content: "Reply with OK" }],
    },
    timeout: 60_000,
  });
}

async function cleanupDeviceCodes(
  request: APIRequestContext,
  deviceCodes: string[],
): Promise<void> {
  if (deviceCodes.length === 0) return;
  const placeholders = deviceCodes.map(() => "?").join(", ");
  await d1Exec(
    request,
    `DELETE FROM deviceCode WHERE deviceCode IN (${placeholders})`,
    deviceCodes,
  );
}

async function revokeTokenFamily(
  request: APIRequestContext,
  tokens: TokenPair,
): Promise<void> {
  const rotated = await refreshTokens(request, tokens.refresh_token);
  if (rotated.status === 200) {
    await refreshTokens(request, tokens.refresh_token);
  }
}

test.describe("Claude Desktop admin device flow", () => {
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;
  let device: DeviceAuthorization;
  let tokens: TokenPair;
  const deviceCodes: string[] = [];
  const tokenFamilies: TokenPair[] = [];

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
  });

  test.afterAll(async () => {
    try {
      for (const tokenFamily of tokenFamilies) {
        await revokeTokenFamily(api, tokenFamily);
      }
    } finally {
      try {
        await cleanupDeviceCodes(api, deviceCodes);
      } finally {
        await api.dispose();
      }
    }
  });

  test("device verification URI is on the API origin and redirects to the auth-web device page", async ({
    page,
  }) => {
    device = await requestDeviceCode(api);
    deviceCodes.push(device.device_code);

    expect(device.verification_uri).toBe(`${AUTH_API_ORIGIN}/device`);
    expect(device.expires_in).toBe(600);

    await page.goto(device.verification_uri_complete);
    const finalUrl = new URL(page.url());
    expect(finalUrl.hostname).toBe(new URL(AUTH_ORIGIN).hostname);
    expect(finalUrl.pathname).toBe("/auth/device");
    expect(finalUrl.searchParams.get("user_code")).toBe(device.user_code);
  });

  test("admin approves a device code and receives access + refresh tokens", async ({
    page,
  }) => {
    const pending = await exchangeDeviceCode(api, device.device_code);
    expect(pending.status).toBe(400);
    expect(pending.body).toMatchObject({ error: "authorization_pending" });
    expectNoStore(pending.cacheControl);

    await approveDeviceCode(page, device);
    const result = await pollDeviceToken(api, device);
    tokens = result.body;

    expect(result.status).toBe(200);
    expectNoStore(result.cacheControl);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBeGreaterThan(600_000);
    expect(tokens.refresh_token).toEqual(expect.any(String));
    expect(tokens.refresh_token_expires_in).toBe(604_800);
  });

  test("refresh grant rotates tokens; replaying the old refresh token revokes the sign-in", async () => {
    const rotatedResult = await refreshTokens(api, tokens.refresh_token);
    const rotated = requireTokenPair(rotatedResult);
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.refresh_token_expires_in).toBe(604_800);

    const beforeReplay = await bootstrap(api, rotated.access_token);
    expect(beforeReplay.status()).toBe(200);

    const replay = await refreshTokens(api, tokens.refresh_token);
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: "invalid_grant" });
    expectNoStore(replay.cacheControl);

    await expect
      .poll(async () => (await bootstrap(api, rotated.access_token)).status(), {
        timeout: 10_000,
      })
      .toBe(401);
    const revoked = await bootstrap(api, rotated.access_token);
    expect(await revoked.json()).toEqual({ error: "invalid_token" });
  });

  test("bootstrap serves flat v1 config to the admin and 304 on If-None-Match", async ({
    page,
  }) => {
    const fresh = await signInWithDeviceCode(page, api);
    deviceCodes.push(fresh.device.device_code);
    tokenFamilies.push(fresh.body);
    const response = await bootstrap(api, fresh.body.access_token);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status()).toBe(200);
    expectNoStore(response.headers()["cache-control"]);
    expect(body.$schemaVersion).toBe(1);
    expect(Object.hasOwn(body, "$schema")).toBe(false);
    expect(body.inferenceGatewayBaseUrl).toBe(AUTH_API_ORIGIN);

    const etag = response.headers().etag;
    expect(etag).toEqual(expect.any(String));
    const cached = await fetch(BOOTSTRAP_URL, {
      headers: {
        Authorization: `Bearer ${fresh.body.access_token}`,
        "If-None-Match": etag,
      },
    });
    expect(
      cached.status,
      `If-None-Match ${etag} returned ETag ${cached.headers.get("etag")}`,
    ).toBe(304);
    expect(await cached.text()).toBe("");
  });
});

test.describe("Claude Desktop user entitlement flow", () => {
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;
  let userContext: BrowserContext | undefined;
  let user:
    | {
        email: string;
        password: string;
        id: string;
      }
    | undefined;
  let tokens: TokenPair | undefined;
  let assignmentCreated = false;
  const deviceCodes: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
  });

  test.afterAll(async ({ browser }) => {
    try {
      await userContext?.close();
      if (user) {
        const adminContext = await browser.newContext({ storageState: ADMIN_STATE_PATH });
        try {
          try {
            if (assignmentCreated) {
              await adminContext.request.delete(
                `${CONSOLE_ORIGIN}/api/admin/bootstrap-assignments/${user.id}`,
                { headers: { Origin: CONSOLE_ORIGIN } },
              );
            }
          } finally {
            await cleanupUser(api, user.email);
          }
        } finally {
          await adminContext.close();
        }
      }
    } finally {
      try {
        await cleanupDeviceCodes(api, deviceCodes);
      } finally {
        await api.dispose();
      }
    }
  });

  test("an unassigned user is refused: bootstrap 403 not_entitled and gateway 403 permission_error", async ({
    browser,
    page,
  }) => {
    userContext = await browser.newContext();
    user = await createVerifiedUser(userContext, api, {
      prefix: "claude-desktop-unassigned",
      role: "user",
      name: "Claude Desktop Unassigned E2E",
    }, page.request);
    await userContext.clearCookies();
    await signInViaApi(userContext, user.email, user.password);

    const userPage = await userContext.newPage();
    const result = await signInWithDeviceCode(userPage, api);
    deviceCodes.push(result.device.device_code);
    tokens = result.body;
    await userPage.close();

    const bootstrapResponse = await bootstrap(api, tokens.access_token);
    expect(bootstrapResponse.status()).toBe(403);
    expect(await bootstrapResponse.json()).toEqual({ error: "not_entitled" });

    const gatewayResponse = await gateway(api, tokens.access_token);
    const gatewayBody = (await gatewayResponse.json()) as {
      error?: { type?: string };
    };
    expect(gatewayResponse.status()).toBe(403);
    expect(gatewayBody.error?.type).toBe("permission_error");
  });

  test("assigning a profile entitles the user; revoking their sessions kills refresh", async ({
    page,
  }) => {
    if (!user || !tokens) throw new Error("unassigned-user setup did not complete");

    try {
      const profiles = await d1Exec(
        api,
        "SELECT id FROM bootstrap_profile WHERE name = 'cowork-user' AND is_system = 1 LIMIT 1",
      );
      const profileId = profiles[0]?.id;
      if (typeof profileId !== "string") {
        throw new Error("cowork-user profile ID was not found");
      }

      const assigned = await page.request.put(
        `${CONSOLE_ORIGIN}/api/admin/bootstrap-assignments/${user.id}`,
        {
          headers: { Origin: CONSOLE_ORIGIN },
          data: { profile_id: profileId },
        },
      );
      expect(
        assigned.status(),
        `profile assignment failed: ${assigned.status()} ${await assigned.text()}`,
      ).toBe(200);
      assignmentCreated = true;

      const entitled = await bootstrap(api, tokens.access_token);
      expect(entitled.status()).toBe(200);

      const revoked = await page.request.delete(
        `${CONSOLE_ORIGIN}/api/admin/users/${user.id}/sessions`,
        { headers: { Origin: CONSOLE_ORIGIN } },
      );
      expect(
        revoked.status(),
        `session revocation failed: ${revoked.status()} ${await revoked.text()}`,
      ).toBe(200);

      const refresh = await refreshTokens(api, tokens.refresh_token);
      expect(refresh.status).toBe(400);
      expect(refresh.body).toMatchObject({ error: "invalid_grant" });
      expectNoStore(refresh.cacheControl);
    } finally {
      let deleteStatus = 0;
      try {
        const deleted = await page.request.delete(
          `${CONSOLE_ORIGIN}/api/admin/bootstrap-assignments/${user.id}`,
          { headers: { Origin: CONSOLE_ORIGIN } },
        );
        deleteStatus = deleted.status();
      } finally {
        await cleanupUser(api, user.email);
        await userContext?.close();
        userContext = undefined;
      }
      if (deleteStatus < 300) assignmentCreated = false;
      expect(deleteStatus).toBeLessThan(300);
    }
  });
});

test.describe("Claude Desktop gateway flow", () => {
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;
  const deviceCodes: string[] = [];
  const tokenFamilies: TokenPair[] = [];

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
  });

  test.afterAll(async () => {
    try {
      for (const tokenFamily of tokenFamilies) {
        await revokeTokenFamily(api, tokenFamily);
      }
    } finally {
      try {
        await cleanupDeviceCodes(api, deviceCodes);
      } finally {
        await api.dispose();
      }
    }
  });

  test("gateway rejects a missing bearer with 401 authentication_error", async () => {
    const response = await gateway(api);
    const body = (await response.json()) as {
      error?: { type?: string };
    };

    expect(response.status()).toBe(401);
    expect(body.error?.type).toBe("authentication_error");
  });

  test("gateway streams a real completion for an entitled user", async ({
    page,
  }) => {
    const result = await signInWithDeviceCode(page, api);
    deviceCodes.push(result.device.device_code);
    tokenFamilies.push(result.body);
    const response = await gateway(api, result.body.access_token);
    const body = await response.text();

    let errorSummary = "";
    if (response.status() !== 200) {
      try {
        const errorBody = JSON.parse(body) as {
          error?: { message?: string; type?: string };
        };
        errorSummary = ` type=${errorBody.error?.type ?? "unknown"} message=${errorBody.error?.message ?? "unknown"}`;
      } catch {
        errorSummary = " body=non-json";
      }
    }

    expect(
      response.status(),
      `gateway response: ${response.status()}${errorSummary}`,
    ).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
  });
});
