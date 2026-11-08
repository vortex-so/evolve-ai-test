import { expect, test } from "@playwright/test";
import {
  AUTH_API_ORIGIN,
  AUTH_ORIGIN,
  NON_ADMIN_EMAIL,
  POSTMARK_SERVER_TOKEN,
  postmarkAvailable,
  waitForRecentMessage,
} from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("auth-web forgot-password", () => {
  test("submit renders + reset endpoint returns 200 or 429 (rate-limit-tolerant)", async ({
    page,
  }) => {
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

    let emailBody = "";
    await expect
      .poll(
        async () => {
          const details = await request.get(
            `https://api.postmarkapp.com/messages/outbound/${msg.MessageID}/details`,
            { headers: { Accept: "application/json", "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN } },
          );
          if (!details.ok()) return `details HTTP ${details.status()}`;
          const { TextBody, HtmlBody } = (await details.json()) as { TextBody?: string; HtmlBody?: string };
          emailBody = `${TextBody ?? ""} ${HtmlBody ?? ""}`;
          return "ok";
        },
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBe("ok");
    const link = emailBody.match(/https:\/\/[^\s"'<>]*reset-password[^\s"'<>]*/)?.[0];
    expect(link, "reset link in the email").toBeTruthy();

    const emailLink = await request.get(link!.replace(/&amp;/g, "&"), { maxRedirects: 0 });
    expect(emailLink.status()).toBe(302);
    const landing = new URL(emailLink.headers()["location"] ?? "", AUTH_API_ORIGIN);
    expect(landing.origin).toBe(AUTH_ORIGIN);
    expect(landing.pathname).toBe("/auth/reset-password");
    expect(landing.searchParams.get("token")).toBeTruthy();
  });
});
