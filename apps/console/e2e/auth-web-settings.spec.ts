import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, AUTH_ORIGIN } from "./helpers";

test.describe("auth-web settings", () => {
  test("/settings/account renders profile + verified badge + sign-out", async ({ page }) => {
    await page.goto(`${AUTH_ORIGIN}/settings/account`);
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
    await expect(page.getByText(/verified/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("/settings/security renders 2FA section + active sessions list without server error", async ({ page }) => {
    await page.goto(`${AUTH_ORIGIN}/settings/security`);
    await expect(page.locator("body")).not.toContainText(
      /Internal Server Error|A server error occurred/i,
    );
    await expect(page.getByText(/two-factor|2fa/i).first()).toBeVisible();
    await expect(page.getByText(/active sessions|no other sessions/i).first()).toBeVisible();
  });

  test("account page cross-link to security navigates", async ({ page }) => {
    await page.goto(`${AUTH_ORIGIN}/settings/account`);
    const link = page.getByRole("link", { name: /security/i }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${AUTH_ORIGIN}/settings/security`));
  });
});
