import { expect, test } from "@playwright/test";
import {
  CONSOLE_ORIGIN,
  d1Exec,
} from "./helpers";

test.describe("console /oauth-clients", () => {
  test("claude-desktop system client cannot be deleted (row action Delete disabled)", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/oauth-clients`);
    const row = page.locator("tr", { hasText: /claude-desktop/i }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /open client actions/i }).click();
    const deleteItem = page.getByRole("menuitem", { name: /^delete$/i });
    await expect(deleteItem).toBeVisible();
    await expect(deleteItem).toHaveAttribute("aria-disabled", "true");
  });

  test("create + one-time secret reveal + delete via D1 cleanup", async ({ page, request }) => {
    const uniqueName = `e2e-oauth-${Date.now()}`;

    await page.goto(`${CONSOLE_ORIGIN}/dashboard/oauth-clients`);
    await page.getByRole("button", { name: /new oauth client/i }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel(/^name$/i).fill(uniqueName);
    await sheet
      .getByLabel(/^redirect uris$/i)
      .fill("https://example.com/callback");

    const createResp = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/oauth-clients") &&
        r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await sheet.getByRole("button", { name: /^create client$/i }).click();
    const res = await createResp;
    expect([200, 201], `create must succeed: ${res.status()}`).toContain(res.status());
    const body = (await res.json()) as { id?: string; clientId?: string; clientSecret?: string };
    expect(body.clientId, "response must include clientId").toBeTruthy();
    expect(body.clientSecret, "response must include one-time clientSecret").toBeTruthy();

    const revealDialog = page.getByRole("dialog", { name: /client secret created/i });
    await expect(revealDialog).toBeVisible();
    await expect(revealDialog).toContainText(body.clientSecret!);

    const rows = await d1Exec(
      request,
      "SELECT id, clientId FROM oauthClient WHERE clientId = ?",
      [body.clientId!],
    );
    expect(rows.length, "row must exist in oauthClient after create").toBe(1);

    await d1Exec(request, "DELETE FROM oauthClient WHERE id = ? AND is_system = 0", [
      body.id!,
    ]);
  });

  test("rotate secret dialog opens for claude-desktop system client (rotate stays permitted)", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/oauth-clients`);
    const row = page.locator("tr", { hasText: /claude-desktop/i }).first();
    await row.getByRole("button", { name: /open client actions/i }).click();
    await page.getByRole("menuitem", { name: /rotate secret/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/rotate|secret/i);
  });
});
