import { expect, test } from "@playwright/test";
import {
  AUTH_ORIGIN,
  NON_ADMIN_EMAIL,
  postmarkAvailable,
  waitForRecentMessage,
} from "./helpers";

test.describe("auth-web forgot-password", () => {
  test("submit renders + reset endpoint returns 200 or 429 (rate-limit-tolerant)", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(`${AUTH_ORIGIN}/auth/forgot-password`);

    await expect(page.getByRole("textbox", { name: /^email$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /reset|send|link/i })).toBeVisible();

    const resetResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/") &&
        /request-password-reset|forget-password/.test(r.url()) &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByRole("textbox", { name: /^email$/i }).fill(NON_ADMIN_EMAIL);
    await page.getByRole("button", { name: /reset|send|link/i }).click();

    const res = await resetResponse;
    const status = res.status();
    expect([200, 429], `unexpected status ${status}: ${await res.text()}`).toContain(status);
  });

  test("Postmark records a reset-password send (only if PLAYWRIGHT_POSTMARK_TOKEN set)", async ({
    page,
    request,
  }) => {
    test.skip(!postmarkAvailable(), "PLAYWRIGHT_POSTMARK_TOKEN not set — skipping delivery check");

    const start = Date.now();
    await page.context().clearCookies();
    await page.goto(`${AUTH_ORIGIN}/auth/forgot-password`);

    const resetResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/") &&
        /request-password-reset|forget-password/.test(r.url()) &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByRole("textbox", { name: /^email$/i }).fill(NON_ADMIN_EMAIL);
    await page.getByRole("button", { name: /reset|send|link/i }).click();
    const res = await resetResponse;
    if (res.status() === 429) test.skip(true, "rate-limited — skip Postmark check");

    const msg = await waitForRecentMessage(request, {
      toContains: NON_ADMIN_EMAIL,
      tag: "reset-password",
      sinceMs: start - 10_000,
    });
    expect(msg.Subject).toMatch(/reset/i);
  });
});
