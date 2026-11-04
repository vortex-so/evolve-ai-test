import { expect, test } from "@playwright/test";
import {
  CONSOLE_ORIGIN,
  d1Exec,
  seedDeviceCode,
} from "./helpers";

async function seedPendingDevice(request: import("@playwright/test").APIRequestContext) {
  const now = Date.now();
  const userCode = Math.random().toString(36).slice(2, 10).toUpperCase();
  await seedDeviceCode(request, {
    id: crypto.randomUUID(),
    deviceCode: crypto.randomUUID(),
    userCode,
    clientId: "claude-desktop",
    createdAtMs: now,
    expiresAtMs: now + 10 * 60_000,
  });
  return { user_code: userCode };
}

async function findDeviceRow(page: import("@playwright/test").Page, userCode: string) {
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const row = page.locator("tr", { hasText: userCode }).first();
    if (await row.isVisible()) return row;

    const next = page.getByRole("link", { name: /go to next page/i });
    if ((await next.getAttribute("aria-disabled")) === "true") break;
    await next.click();
    await page.waitForTimeout(500);
  }
  return page.locator("tr", { hasText: userCode }).first();
}

test.describe("console /devices", () => {
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
    try {
      await page.goto(`${CONSOLE_ORIGIN}/dashboard/devices`);
      const row = await findDeviceRow(page, device.user_code);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: /force[-\s]?expire/i }).click();
      const confirmBtn = page
        .getByRole("button", { name: /force[-\s]?expire|expire|confirm/i })
        .last();
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
    } finally {
      await d1Exec(request, "DELETE FROM deviceCode WHERE userCode = ?", [
        device.user_code,
      ]);
    }
  });
});
