import { describe, expect, it } from "vitest";
import {
  adminSession,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
  TEST_WRONG_ORIGIN,
  userSession,
} from "./_helpers/test-app";

const endpoints = [
  "/admin/audit",
  "/admin/devices",
  "/admin/bootstrap-profiles",
  "/admin/oauth-clients",
];

describe("Phase 4 admin endpoint authz contract", () => {
  it.each(endpoints)("%s returns 401 without a session", async (path) => {
    const { response } = await requestApp(path, { origin: TEST_CONSOLE_ORIGIN });

    expect(response.status, `${path} must reject unauthenticated callers with 401`).toBe(401);
  });

  it.each(endpoints)("%s returns 403 for a non-admin session", async (path) => {
    const { response } = await requestApp(path, {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession(),
    });

    expect(response.status, `${path} must reject non-admin callers with 403`).toBe(403);
  });

  it.each(endpoints)("%s returns 403 for the wrong Origin even with an admin session", async (path) => {
    const { response } = await requestApp(path, {
      origin: TEST_WRONG_ORIGIN,
      session: adminSession(),
    });

    expect(response.status, `${path} must pin Origin and reject ${TEST_WRONG_ORIGIN}`).toBe(403);
  });

  it.each(endpoints)("%s returns JSON 200 for admin + correct Origin", async (path) => {
    const { response } = await requestApp(path, {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
    });
    const body = await readJson(response);

    expect(response.status, `${path} must allow admins from the console origin`).toBe(200);
    expect(
      response.headers.get("content-type")?.includes("application/json") ?? false,
      `${path} must respond with JSON for successful admin reads`,
    ).toBe(true);
    expect(body, `${path} must return a JSON payload on success`).not.toBeNull();
  });

  it("rejects a demoted admin whose cached session still says admin", async () => {
    const { response } = await requestApp("/admin/audit", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: 'SELECT role, banned, banExpires FROM "user" WHERE id = ?',
          first: { role: "user", banned: 0, banExpires: null },
        },
      ],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "not_admin" });
  });

  it("rejects a banned admin whose cached session still says admin", async () => {
    const { response } = await requestApp("/admin/audit", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: 'SELECT role, banned, banExpires FROM "user" WHERE id = ?',
          first: { role: "admin", banned: 1, banExpires: null },
        },
      ],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "not_admin" });
  });

  it("rejects a deleted admin whose cached session still says admin", async () => {
    const { response } = await requestApp("/admin/audit", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: 'SELECT role, banned, banExpires FROM "user" WHERE id = ?',
          first: null,
        },
      ],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "not_admin" });
  });

  it("allows an admin whose temporary ban has expired", async () => {
    const { response } = await requestApp("/admin/audit", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [
        {
          match: 'SELECT role, banned, banExpires FROM "user" WHERE id = ?',
          first: { role: "admin", banned: 1, banExpires: "2020-01-01T00:00:00.000Z" },
        },
      ],
    });

    expect(response.status).toBe(200);
  });
});
