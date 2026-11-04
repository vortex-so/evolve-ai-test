import { describe, expect, it } from "vitest";
import {
  adminSession,
  expectSql,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

describe("Phase 4 last-admin guard contract", () => {
  it("returns 409 last_admin_protected when setRole would demote the last admin", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/set-role", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "target-admin-id", role: "user" },
      plans: [{ match: /UPDATE\s+user\s+SET\s+role/i, run: { meta: { changes: 0 } } }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status, "demoting the last admin must return 409").toBe(409);
    expect(body?.code, "last-admin demotion must return code=last_admin_protected").toBe(
      "last_admin_protected",
    );
    expectSql(
      DB,
      /UPDATE\s+user\s+SET\s+role[\s\S]*role\s*!=\s*'admin'/i,
      "guard SQL must be evaluated for last-admin role demotion",
    );
    expectSql(
      DB,
      /LIKE\s*'%,admin,%'/i,
      "setRole must protect comma-list admin roles",
    );
  });

  it("allows setRole when another admin still exists", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/set-role", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "secondary-admin-id", role: "user" },
      plans: [{ match: /UPDATE\s+user\s+SET\s+role/i, run: { meta: { changes: 1 } } }],
    });

    expect(response.status, "demoting an admin is allowed when a second admin exists").toBe(200);
    expectSql(
      DB,
      /SELECT\s+COUNT\(\*\)\s+FROM\s+user[\s\S]*role\s*=\s*'admin'[\s\S]*id\s*!=/i,
      "setRole must count other admins, excluding the target user",
    );
  });

  it("returns 409 when removeUser targets the last admin", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/remove-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "last-admin-id" },
      plans: [{ match: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i, run: { meta: { changes: 0 } } }],
    });

    expect(response.status, "removeUser must reject deleting the last admin").toBe(409);
    expectSql(
      DB,
      /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?[\s\S]*role\s*!=\s*'admin'/i,
      "guard SQL must be evaluated for last-admin deletion",
    );
    expectSql(
      DB,
      /LIKE\s*'%,admin,%'/i,
      "removeUser must protect comma-list admin roles",
    );
  });

  it("returns 409 when banUser targets the last unbanned admin", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/ban-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "last-active-admin-id", banReason: "policy", banExpiresIn: 3600 },
      plans: [{ match: /UPDATE\s+user\s+SET\s+banned\s*=\s*1/i, run: { meta: { changes: 0 } } }],
    });

    expect(response.status, "banUser must reject banning the last unbanned admin").toBe(409);
    expectSql(
      DB,
      /UPDATE\s+user\s+SET\s+banned\s*=\s*1[\s\S]*typeof\s*\(\s*banExpires\s*\)[\s\S]*json_valid[\s\S]*unixepoch[\s\S]*ELSE\s+NULL[\s\S]*id\s*!=/i,
      "guard SQL must parse numeric and ISO expiries while failing closed on malformed values",
    );
    expectSql(
      DB,
      /LIKE\s*'%,admin,%'/i,
      "banUser must protect comma-list admin roles",
    );
  });
});
