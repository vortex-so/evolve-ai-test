import { expect, request as apiRequest, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  CONSOLE_ORIGIN,
  d1Exec,
} from "./helpers";

async function callBff(page: import("@playwright/test").Page, path: string, init?: RequestInit) {
  return page.evaluate(
    async ({ path: p, init: i }) => {
      const res = await fetch(p, {
        ...(i ?? {}),
        credentials: "include",
      });
      const text = await res.text();
      return { status: res.status, body: text };
    },
    { path, init },
  );
}

test.describe("console admin invariants (server-side guards)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${CONSOLE_ORIGIN}/dashboard`);
  });

  test("ban self is blocked with 403 cannot_ban_self", async ({ page, request }) => {
    const adminRows = await d1Exec(request, "SELECT id FROM user WHERE email = ?", [ADMIN_EMAIL]);
    const adminId = adminRows[0]?.id as string;
    expect(adminId).toBeTruthy();

    const res = await callBff(page, `/api/admin/users/${adminId}/ban`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ banReason: "self-test", banExpiresIn: 60 }),
    });

    expect(res.status, `expected 403, got ${res.status}: ${res.body}`).toBe(403);
    expect(res.body).toMatch(/cannot_ban_self/);

    const admin = await d1Exec(
      request,
      "SELECT banned FROM user WHERE email = ?",
      [ADMIN_EMAIL],
    );
    expect(admin[0]?.banned, "admin must NOT be banned").toBe(0);
  });

  test("demote the last admin returns 409 last_admin_protected", async ({ page, request }) => {
    const admins = await d1Exec(
      request,
      "SELECT id FROM user WHERE role = 'admin'",
      [],
    );
    if (admins.length !== 1) {
      test.skip(true, `not the last admin (${admins.length} admins exist) — skipping`);
    }
    const adminId = admins[0]?.id as string;

    const res = await callBff(page, `/api/admin/users/${adminId}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });

    expect(res.status, `expected 409, got ${res.status}: ${res.body}`).toBe(409);
    expect(res.body).toMatch(/last_admin_protected/);

    const check = await d1Exec(
      request,
      "SELECT role FROM user WHERE id = ?",
      [adminId],
    );
    expect(check[0]?.role, "last-admin must still be admin after blocked demote").toBe("admin");
  });

  test("system oauth client (claude-desktop) DELETE returns 409 system_client_protected", async ({ page, request }) => {
    const clientRows = await d1Exec(
      request,
      "SELECT id, is_system FROM oauthClient WHERE clientId = 'claude-desktop'",
      [],
    );
    expect(clientRows.length, "claude-desktop must exist").toBe(1);
    expect(clientRows[0]?.is_system, "claude-desktop must be is_system=1").toBe(1);
    const clientId = clientRows[0]?.id as string;

    const res = await callBff(page, `/api/admin/oauth-clients/${clientId}`, {
      method: "DELETE",
    });
    expect(res.status, `expected 409, got ${res.status}: ${res.body}`).toBe(409);
    expect(res.body).toMatch(/system_client_protected/);

    const stillThere = await d1Exec(
      request,
      "SELECT id FROM oauthClient WHERE id = ?",
      [clientId],
    );
    expect(stillThere.length, "system client must still exist after blocked delete").toBe(1);
  });

  test("system bootstrap profile (cowork-user) DELETE returns 409 system_profile_protected", async ({ page, request }) => {
    const profileRows = await d1Exec(
      request,
      "SELECT id FROM bootstrap_profile WHERE is_system = 1 AND name = 'cowork-user'",
      [],
    );
    expect(profileRows.length, "cowork-user system profile must exist").toBe(1);
    const profileId = profileRows[0]?.id as string;

    const res = await callBff(page, `/api/admin/bootstrap-profiles/${profileId}`, {
      method: "DELETE",
    });
    expect(res.status, `expected 409, got ${res.status}: ${res.body}`).toBe(409);
    expect(res.body).toMatch(/system_profile_protected/);
  });
});

test.describe("console admin invariants (server-side guards)", () => {
  test("BFF rejects request with NO session cookie (401 unauthenticated)", async () => {
    const anonymousRequest = await apiRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anonymousRequest.get(`${CONSOLE_ORIGIN}/api/admin/users`, {
        headers: { Origin: CONSOLE_ORIGIN },
      });
      expect(res.status()).toBe(401);
    } finally {
      await anonymousRequest.dispose();
    }
  });
});
