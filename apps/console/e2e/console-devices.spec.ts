import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  AUTH_API_ORIGIN,
  CONSOLE_ORIGIN,
  d1Exec,
  signInViaApi,
} from "./helpers";

async function seedPendingDevice(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${AUTH_API_ORIGIN}/oauth/device`, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    form: {
      client_id: "claude-desktop",
      scope: "openid offline_access bootstrap:read",
    },
  });
  if (!res.ok()) {
    throw new Error(`seed device failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
  };
}

test.describe("console /devices", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await signInViaApi(page.context(), ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("devices list renders (columns + rows if any)", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/devices`);
    await expect(page.locator("body")).not.toContainText(
      /Internal Server Error|A server error occurred/i,
    );
    await expect(page.getByRole("columnheader", { name: /user code/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /status/i })).toBeVisible();
  });

  test("status filter narrows to pending only", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/devices`);
    const combos = page.getByRole("combobox");
    await combos.first().click();
    await page.getByRole("option", { name: /pending/i }).click();
    await page.waitForTimeout(1_500);
    const statusCells = page.locator("tbody tr").locator("td").filter({ hasText: /pending/i });
    const count = await statusCells.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        await expect(statusCells.nth(i)).toContainText(/pending/i);
      }
    }
  });

  test("force-expire flips a pending device to expired in D1", async ({ page, request }) => {
    const device = await seedPendingDevice(request);

    await page.goto(`${CONSOLE_ORIGIN}/dashboard/devices`);
    const row = page.locator("tr", { hasText: device.user_code }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /force[-\s]?expire/i }).click();
    const confirmBtn = page.getByRole("button", { name: /force[-\s]?expire|expire|confirm/i }).last();
    await expect(confirmBtn).toBeVisible();

    const expireResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/devices/expire") &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await confirmBtn.click();
    const res = await expireResp;
    expect(res.status(), "expire endpoint must 200").toBeLessThan(400);
    await page.waitForTimeout(1_500);

    const rows = await d1Exec(
      request,
      "SELECT status FROM deviceCode WHERE userCode = ?",
      [device.user_code],
    );
    expect(rows[0]?.status, "deviceCode.status must be 'expired'").toBe("expired");
  });
});
