import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  AUTH_API_ORIGIN,
  AUTH_ORIGIN,
  CONSOLE_ORIGIN,
  NON_ADMIN_EMAIL,
  d1Exec,
  selectUser,
  signInViaApi,
} from "./helpers";

const NON_ADMIN_NAME_RE = /E2E NonAdmin/;

async function openActionsFor(page: Page, email: string, nameRe: RegExp) {
  await page.goto(`${CONSOLE_ORIGIN}/dashboard/users`);
  await page.getByPlaceholder(/search by name or email/i).fill(email);
  await page.waitForTimeout(500);
  const trigger = page.getByRole("button", {
    name: new RegExp(`Open actions for ${nameRe.source}`, "i"),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
}

test.describe("console /users row actions", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.context().clearCookies();
    await signInViaApi(page.context(), ADMIN_EMAIL, ADMIN_PASSWORD);
    await d1Exec(
      request,
      "UPDATE user SET banned = 0, banReason = NULL, banExpires = NULL, role = 'user' WHERE email = ?",
      [NON_ADMIN_EMAIL],
    );
  });

  test("ban user writes banned=1 in D1 (then unban via same UI)", async ({ page, request }) => {
    await openActionsFor(page, NON_ADMIN_EMAIL, NON_ADMIN_NAME_RE);
    await page.getByRole("menuitem", { name: /^ban$/i }).click();

    const banConfirm = page.getByRole("button", { name: /^ban user$/i });
    await expect(banConfirm).toBeVisible();
    await banConfirm.click();
    await page.waitForTimeout(2_000);

    const banned = await selectUser(request, NON_ADMIN_EMAIL);
    expect(banned?.banned, "banned=1 after ban action").toBe(1);

    await page.reload();
    await openActionsFor(page, NON_ADMIN_EMAIL, NON_ADMIN_NAME_RE);
    await page.getByRole("menuitem", { name: /^unban$/i }).click();
    await page.waitForTimeout(2_000);

    const unbanned = await selectUser(request, NON_ADMIN_EMAIL);
    expect(unbanned?.banned, "banned=0 after unban action").toBe(0);
  });

  test("set role admin via dialog writes role='admin' + revert", async ({ page, request }) => {
    await openActionsFor(page, NON_ADMIN_EMAIL, NON_ADMIN_NAME_RE);
    await page.getByRole("menuitem", { name: /^set role$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^admin$/i }).click();
    await dialog.getByRole("button", { name: /^save role$/i }).click();
    await page.waitForTimeout(2_000);

    const promoted = await selectUser(request, NON_ADMIN_EMAIL);
    expect(promoted?.role, "role must be admin").toBe("admin");

    await d1Exec(request, "UPDATE user SET role = 'user' WHERE email = ?", [NON_ADMIN_EMAIL]);
  });

  test("revoke all sessions removes the target user's session rows", async ({ page, request }) => {
    const seedRes = await request.post(`${AUTH_API_ORIGIN}/api/auth/sign-in/email`, {
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
      data: { email: NON_ADMIN_EMAIL, password: "password12345" },
    });
    expect(seedRes.ok(), "seed sign-in must succeed").toBe(true);

    const beforeRows = await d1Exec(
      request,
      "SELECT COUNT(*) as c FROM session s JOIN user u ON u.id = s.userId WHERE u.email = ?",
      [NON_ADMIN_EMAIL],
    );
    const before = Number((beforeRows[0]?.c as number) ?? 0);
    expect(before, "must have at least one session to revoke").toBeGreaterThan(0);

    await openActionsFor(page, NON_ADMIN_EMAIL, NON_ADMIN_NAME_RE);
    await page.getByRole("menuitem", { name: /revoke all sessions/i }).click();
    const revokeResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.url().endsWith("/sessions") &&
        r.request().method() === "DELETE",
      { timeout: 15_000 },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^revoke sessions$/i })
      .click();
    const revokeRes = await revokeResp;
    expect(revokeRes.status(), "revoke-sessions must 200").toBe(200);
    await page.waitForTimeout(1_500);

    const afterRows = await d1Exec(
      request,
      "SELECT COUNT(*) as c FROM session s JOIN user u ON u.id = s.userId WHERE u.email = ?",
      [NON_ADMIN_EMAIL],
    );
    const after = Number((afterRows[0]?.c as number) ?? 0);
    expect(after, "sessions must be revoked").toBeLessThan(before);
  });
});
