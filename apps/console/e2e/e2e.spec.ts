import { expect, test } from "@playwright/test";

const AUTH_ORIGIN = "https://auth.auth-dev.vortex.so";
const CONSOLE_ORIGIN =
  process.env.PLAYWRIGHT_CONSOLE_ORIGIN ?? "https://console.auth-dev.vortex.so";
const AUTH_API_ORIGIN =
  process.env.PLAYWRIGHT_AUTH_API_ORIGIN ?? "https://api.auth-dev.vortex.so";

const ADMIN_EMAIL = "p3-1785649016@evolveai.dev";
const ADMIN_PASSWORD = "password12345";
const NON_ADMIN_EMAIL = "non-admin-e2e@evolveai.dev";
const NON_ADMIN_PASSWORD = "password12345";

async function signInThroughUI(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("textbox", { name: /password/i }).fill(password);
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/sign-in/email") &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /^sign in$/i }).click();
  const response = await signInResponse;
  expect(
    response.ok(),
    `sign-in: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

test.describe("Vortex admin console — auth + admin guard", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated console/dashboard redirects to sign-in with redirect param", async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await expect(page).toHaveURL(
      new RegExp(
        `^${AUTH_ORIGIN.replace(/\./g, "\\.")}/auth/sign-in\\?redirect=`,
      ),
    );
    expect(page.url()).toContain(
      encodeURIComponent(`${CONSOLE_ORIGIN}/dashboard`),
    );
  });

  test("admin sign-in redirects back to console dashboard (cross-origin nav + redirect)", async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await page.waitForURL(new RegExp(`^${AUTH_ORIGIN}/auth/sign-in`));
    await signInThroughUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL(
      (url) => url.origin === CONSOLE_ORIGIN && url.pathname === "/dashboard",
      { timeout: 45_000 },
    );
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
  });
});

test.describe("Vortex admin console — auth + admin guard", () => {
  test("admin can see all 7 side-nav links and each renders without a server error", async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);

    const nav = page.locator("nav, aside").first();
    for (const label of [
      "Dashboard",
      "Users",
      "Sessions",
      "OAuth clients",
      "Devices",
      "Audit log",
      "Bootstrap profiles",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    for (const path of [
      "/dashboard/users",
      "/dashboard/sessions",
      "/dashboard/oauth-clients",
      "/dashboard/devices",
      "/dashboard/audit",
      "/dashboard/bootstrap-profiles",
    ]) {
      const response = await page.goto(`${CONSOLE_ORIGIN}${path}`);
      expect(response?.status(), `${path} must not 5xx`).toBeLessThan(500);
      await expect(page.locator("body")).not.toContainText(
        /This page couldn.?t load|Internal Server Error|A server error occurred/i,
      );
    }
  });
});

test.describe("Vortex admin console — auth + admin guard", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-out clears the session cookie across .auth-dev.vortex.so", async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await page.waitForURL(new RegExp(`^${AUTH_ORIGIN}/auth/sign-in`));
    await signInThroughUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL(
      (url) => url.origin === CONSOLE_ORIGIN && url.pathname === "/dashboard",
      { timeout: 45_000 },
    );

    const beforeSession = await page.request
      .get(`${AUTH_API_ORIGIN}/api/auth/get-session`, {
        headers: { origin: CONSOLE_ORIGIN },
      })
      .then((r) => r.text());
    expect(beforeSession).not.toBe("null");
    expect(beforeSession.length).toBeGreaterThan(2);

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(
      (url) => url.origin === AUTH_ORIGIN && url.pathname === "/",
      { timeout: 30_000 },
    );

    const afterSession = await page.request
      .get(`${AUTH_API_ORIGIN}/api/auth/get-session`, {
        headers: { origin: CONSOLE_ORIGIN },
      })
      .then((r) => r.text());
    expect(afterSession).toBe("null");

    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`^${AUTH_ORIGIN}/auth/sign-in`));
  });
});

test.describe("Vortex admin console — auth + admin guard", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("non-admin user is blocked from console/dashboard (redirects to /403 or sign-in)", async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await page.waitForURL(new RegExp(`^${AUTH_ORIGIN}/auth/sign-in`));
    await signInThroughUI(page, NON_ADMIN_EMAIL, NON_ADMIN_PASSWORD);

    await page.waitForURL(
      (url) =>
        url.pathname === "/403" ||
        url.pathname.startsWith("/auth/sign-in") ||
        url.origin === AUTH_ORIGIN,
      { timeout: 30_000 },
    );
    const url = new URL(page.url());
    const blocked =
      (url.origin === CONSOLE_ORIGIN && url.pathname === "/403") ||
      (url.origin === AUTH_ORIGIN);
    expect(
      blocked,
      `non-admin must not reach console/dashboard; landed on ${page.url()}`,
    ).toBe(true);

    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await expect(page).not.toHaveURL(`${CONSOLE_ORIGIN}/dashboard`);
  });

  test("admin sign-in → nav to console.auth-dev directly → session preserved (cross-subdomain cookie)", async ({
    page,
  }) => {
    await page.goto(`${AUTH_ORIGIN}/auth/sign-in`);
    await signInThroughUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL((url) => url.pathname === "/" || url.pathname.startsWith("/dashboard"));

    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
    await expect(page).toHaveURL(`${CONSOLE_ORIGIN}/dashboard`);
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
  });
});
