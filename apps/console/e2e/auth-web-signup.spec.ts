import { expect, test } from "@playwright/test";
import {
  AUTH_ORIGIN,
  DEFAULT_PASSWORD,
  NON_ADMIN_EMAIL,
  cleanupUser,
  currentSession,
  selectUser,
  uniqueEmail,
} from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("auth-web sign-up", () => {
  test("sign-up form renders + submits (rate-limit-tolerant)", async ({ page, request }) => {
    const email = uniqueEmail("signup-happy");
    await page.goto(`${AUTH_ORIGIN}/auth/sign-up`);

    await expect(page.getByRole("textbox", { name: /^name$/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^email$/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^password$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();

    const signUpResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/sign-up/email") && r.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByRole("textbox", { name: /^name$/i }).fill("Signup Happy");
    await page.getByRole("textbox", { name: /^email$/i }).fill(email);
    await page.getByRole("textbox", { name: /^password$/i }).fill(DEFAULT_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    const res = await signUpResponse;
    const status = res.status();
    expect([200, 429], `unexpected status ${status}: ${await res.text()}`).toContain(status);

    if (status === 200) {
      const row = await selectUser(request, email);
      expect(row, `200 response must have created user ${email}`).not.toBeNull();
      await cleanupUser(request, email);
    }
  });

  test("rejects invalid email (no D1 row created)", async ({ page, request }) => {
    const email = "not-an-email";
    await page.goto(`${AUTH_ORIGIN}/auth/sign-up`);
    await page.getByRole("textbox", { name: /^name$/i }).fill("Bad Email");
    await page.getByRole("textbox", { name: /^email$/i }).fill(email);
    await page.getByRole("textbox", { name: /^password$/i }).fill(DEFAULT_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await page.waitForTimeout(2_000);
    const row = await selectUser(request, email);
    expect(row, "invalid email must NOT create a user row").toBeNull();
  });

  test("duplicate email (reuses seeded user) does NOT create a session", async ({ page }) => {
    await page.goto(`${AUTH_ORIGIN}/auth/sign-up`);
    await page.getByRole("textbox", { name: /^name$/i }).fill("Second Attempt");
    await page.getByRole("textbox", { name: /^email$/i }).fill(NON_ADMIN_EMAIL);
    await page.getByRole("textbox", { name: /^password$/i }).fill(DEFAULT_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await page.waitForTimeout(3_000);
    const session = await currentSession(page.context());
    expect(session, "duplicate sign-up must NOT create a session").toBeNull();
  });
});
