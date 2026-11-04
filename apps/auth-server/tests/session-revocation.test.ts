import { describe, expect, it } from "vitest";
import {
  adminSession,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

const targetUserId = "target-user-id";
const sessionToken = "target-session-token";
const kvEntries = {
  [`active-sessions-${targetUserId}`]: JSON.stringify([
    { token: sessionToken, expiresAt: Date.now() + 60_000 },
  ]),
  [sessionToken]: JSON.stringify({ session: { userId: targetUserId }, user: { id: targetUserId } }),
};

function expectAllSessionsRevoked(deleted: string[]) {
  expect(deleted).toEqual(
    expect.arrayContaining([sessionToken, `active-sessions-${targetUserId}`]),
  );
}

describe("admin mutation session revocation", () => {
  it("successful demotion revokes the target user's sessions", async () => {
    const { response, KV } = await requestApp("/api/auth/admin/set-role", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: targetUserId, role: "user" },
      kvEntries,
      plans: [
        { match: /UPDATE\s+user\s+SET\s+role/i, run: { meta: { changes: 1 } } },
      ],
    });

    expect(response.status).toBe(200);
    expectAllSessionsRevoked(KV.deleted);
  });

  it("successful ban revokes the target user's sessions", async () => {
    const { response, KV } = await requestApp("/api/auth/admin/ban-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: targetUserId, banReason: "policy", banExpiresIn: 3600 },
      kvEntries,
      plans: [
        { match: /UPDATE\s+user\s+SET\s+banned\s*=\s*1/i, run: { meta: { changes: 1 } } },
      ],
    });

    expect(response.status).toBe(200);
    expectAllSessionsRevoked(KV.deleted);
  });

  it("successful removal revokes the target user's sessions", async () => {
    const { response, KV } = await requestApp("/api/auth/admin/remove-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: targetUserId },
      kvEntries,
      plans: [
        {
          match: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i,
          run: { meta: { changes: 1 } },
        },
      ],
    });

    expect(response.status).toBe(200);
    expectAllSessionsRevoked(KV.deleted);
  });

  it("last-admin guard failure does not revoke sessions", async () => {
    const { response, KV } = await requestApp("/api/auth/admin/set-role", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: targetUserId, role: "user" },
      kvEntries,
      plans: [
        { match: /UPDATE\s+user\s+SET\s+role/i, run: { meta: { changes: 0 } } },
      ],
    });

    expect(response.status).toBe(409);
    expect(KV.deleted).toEqual([]);
  });

  it.each([
    {
      name: "demotion",
      path: "/api/auth/admin/set-role",
      body: { userId: targetUserId, role: "user" },
      mutation: /UPDATE\s+user\s+SET\s+role/i,
    },
    {
      name: "ban",
      path: "/api/auth/admin/ban-user",
      body: { userId: targetUserId, banReason: "policy", banExpiresIn: 3600 },
      mutation: /UPDATE\s+user\s+SET\s+banned\s*=\s*1/i,
    },
    {
      name: "removal",
      path: "/api/auth/admin/remove-user",
      body: { userId: targetUserId },
      mutation: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i,
    },
  ])("$name still revokes sessions when the synchronous audit write fails", async ({ path, body, mutation }) => {
    const { response, KV } = await requestApp(path, {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body,
      kvEntries,
      plans: [
        { match: mutation, run: { meta: { changes: 1 } } },
        { match: /INSERT\s+INTO\s+audit_log/i, error: new Error("audit unavailable") },
      ],
    });

    expect(response.status).toBe(500);
    expectAllSessionsRevoked(KV.deleted);
  });
});
