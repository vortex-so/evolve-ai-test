import { expect, test } from "@playwright/test";
import {
  CONSOLE_ORIGIN,
  d1Exec,
} from "./helpers";

test.describe("console /bootstrap-profiles", () => {
  test("list renders cowork-user with System badge + New profile button", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/bootstrap-profiles`);
    await expect(page.getByRole("heading", { name: /bootstrap profiles/i })).toBeVisible();
    const row = page.locator("tr", { hasText: /cowork-user/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText(/^system$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /new profile/i })).toBeVisible();
  });

  test("system profile Delete menuitem is disabled for cowork-user", async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/bootstrap-profiles`);
    const row = page.locator("tr", { hasText: /cowork-user/i }).first();
    await row.getByRole("button").last().click();
    const deleteItem = page.getByRole("menuitem", { name: /^delete$/i });
    await expect(deleteItem).toBeVisible();
    await expect(deleteItem).toHaveAttribute("aria-disabled", "true");
  });

  test("create valid profile → D1 row exists → delete via API cleanup", async ({ page, request }) => {
    const name = `e2e-profile-${Date.now()}`;
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/bootstrap-profiles`);
    await page.getByRole("button", { name: /new profile/i }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await page.locator("#profile-name").fill(name);
    await page.locator("#profile-description").fill("e2e test profile");

    const configEditor = sheet.locator("textarea").first();
    await configEditor.fill(
      JSON.stringify({
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so",
        inferenceModels: ["claude-sonnet-5"],
      }),
    );

    const createResp = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/bootstrap-profiles") &&
        r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await sheet.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    const res = await createResp;
    expect(res.status(), "profile create must 2xx").toBeLessThan(300);

    await page.waitForTimeout(1_500);
    const rows = await d1Exec(
      request,
      "SELECT id FROM bootstrap_profile WHERE name = ?",
      [name],
    );
    expect(rows.length, "row must exist in bootstrap_profile").toBe(1);

    await d1Exec(request, "DELETE FROM bootstrap_profile WHERE name = ? AND is_system = 0", [name]);
  });

  test("create with malformed JSON blocks submission (no D1 write, no POST fires)", async ({ page, request }) => {
    const name = `e2e-profile-badjson-${Date.now()}`;
    await page.goto(`${CONSOLE_ORIGIN}/dashboard/bootstrap-profiles`);
    await page.getByRole("button", { name: /new profile/i }).click();

    const sheet = page.getByRole("dialog");
    await page.locator("#profile-name").fill(name);
    const configEditor = sheet.locator("textarea").first();
    await configEditor.fill("{ not valid json");

    let postCount = 0;
    await page.route("**/api/admin/bootstrap-profiles", (route) => {
      if (route.request().method() === "POST") postCount++;
      route.continue();
    });

    await sheet.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await page.waitForTimeout(2_000);

    expect(postCount, "malformed JSON must block POST client-side").toBe(0);
    const rows = await d1Exec(
      request,
      "SELECT id FROM bootstrap_profile WHERE name = ?",
      [name],
    );
    expect(rows.length, "malformed JSON must NOT create D1 row").toBe(0);
  });
});
