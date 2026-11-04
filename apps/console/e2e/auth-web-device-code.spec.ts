import { expect, test } from "@playwright/test";
import {
  AUTH_API_ORIGIN,
  AUTH_ORIGIN,
  d1Exec,
} from "./helpers";

async function initiateDevice(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${AUTH_API_ORIGIN}/oauth/device`, {
    headers: {
      Origin: AUTH_ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
    },
    form: {
      client_id: "claude-desktop",
      scope: "openid offline_access bootstrap:read",
    },
  });
  if (!res.ok()) throw new Error(`device init failed ${res.status()}: ${await res.text()}`);
  return (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
  };
}

test.describe("auth-web /auth/device (device code flow)", () => {
  test("/auth/device without user_code renders manual code entry form", async ({ page }) => {
    await page.goto(`${AUTH_ORIGIN}/auth/device`);
    await page.waitForTimeout(2_000);
    await expect(page.getByText(/enter the code/i)).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("/auth/device?user_code=X shows Approve + Deny for a pending code", async ({ page, request }) => {
    const device = await initiateDevice(request);
    await page.goto(`${AUTH_ORIGIN}/auth/device?user_code=${device.user_code}`);
    await page.waitForTimeout(3_000);
    await expect(page.getByText(device.user_code)).toBeVisible();
    await expect(page.getByRole("button", { name: /^approve$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^deny$/i })).toBeVisible();
  });

  test("approve flips deviceCode.status to 'approved' in D1", async ({ page, request }) => {
    const device = await initiateDevice(request);
    await page.goto(`${AUTH_ORIGIN}/auth/device?user_code=${device.user_code}`);
    await page.waitForTimeout(3_000);

    const approveResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/device/approve") &&
        r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /^approve$/i }).click();
    const res = await approveResp;
    expect(res.status(), "approve endpoint must 200").toBe(200);
    await page.waitForTimeout(1_500);

    const rows = await d1Exec(
      request,
      "SELECT status FROM deviceCode WHERE userCode = ?",
      [device.user_code],
    );
    expect(rows[0]?.status, "deviceCode.status must be 'approved'").toBe("approved");
  });

  test("deny flips deviceCode.status to 'denied' in D1", async ({ page, request }) => {
    const device = await initiateDevice(request);
    await page.goto(`${AUTH_ORIGIN}/auth/device?user_code=${device.user_code}`);
    await page.waitForTimeout(3_000);

    const denyResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/device/deny") &&
        r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /^deny$/i }).click();
    const res = await denyResp;
    expect(res.status(), "deny endpoint must 200").toBe(200);
    await page.waitForTimeout(1_500);

    const rows = await d1Exec(
      request,
      "SELECT status FROM deviceCode WHERE userCode = ?",
      [device.user_code],
    );
    expect(rows[0]?.status, "deviceCode.status must be 'denied'").toBe("denied");
  });
});
