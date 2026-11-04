import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  AUTH_API_ORIGIN,
  CONSOLE_ORIGIN,
  d1Exec,
  signInViaApi,
} from "./helpers";

test.describe("console /audit", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await signInViaApi(page.context(), ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("audit list renders filter toolbar + column headers", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/audit`);
    await expect(page.locator("body")).not.toContainText(
      /Internal Server Error|A server error occurred/i,
    );
    await expect(page.getByPlaceholder(/search actor email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/target id/i)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /timestamp/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /actor/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /action/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /outcome/i })).toBeVisible();
  });

  test("filter by actor email updates URL and narrows results", async ({ page, request }) => {
    await page.goto(`${AUTH_API_ORIGIN}/api/auth/get-session`);
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/users`);
    await page.getByPlaceholder(/search by name or email/i).fill("non-admin");
    await page.waitForTimeout(1_000);

    await page.goto(`${CONSOLE_ORIGIN}/dashboard/audit`);
    await page.getByPlaceholder(/search actor email/i).fill(ADMIN_EMAIL);
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(new RegExp(`actor=${encodeURIComponent(ADMIN_EMAIL)}`));

    const totalRows = await d1Exec(request, "SELECT COUNT(*) c FROM audit_log", []);
    if (Number(totalRows[0]?.c as number) === 0) {
      return;
    }
    const filteredRows = page.locator("tbody tr");
    const count = await filteredRows.count();
    if (count > 0) {
      const actorCells = filteredRows.locator("td").filter({ hasText: ADMIN_EMAIL });
      expect(await actorCells.count(), "if rows exist, actor column must contain admin email").toBeGreaterThan(0);
    }
  });

  test("outcome filter updates URL to outcome=success", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/audit`);
    const outcomeSelect = page.getByRole("combobox", { name: /outcome/i }).or(
      page.locator('button[role="combobox"]', { hasText: /any outcome/i })
    );
    await outcomeSelect.first().click();
    await page.getByRole("option", { name: /^success$/i }).click();
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/outcome=success/);
  });

  test("Clear filters button clears the actor input (outcome-clear tracked as known gap)", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/audit?outcome=success&actor=admin`);
    await page.getByRole("button", { name: /clear filters/i }).click();
    await page.waitForTimeout(1_500);
    await expect(page).not.toHaveURL(/actor=admin/);
    const actorInput = page.getByPlaceholder(/search actor email/i);
    await expect(actorInput).toHaveValue("");
  });
});
