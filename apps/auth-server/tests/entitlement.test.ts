import { describe, expect, it } from "vitest";
import { isEntitled } from "../src/lib/entitlement";

type EntitlementRow = {
  role: string | null;
  banned: boolean | number | null;
  banExpires: string | number | null;
  assigned: boolean | number;
};

class D1Spy {
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly row: EntitlementRow | null) {}

  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => {
        this.statements.push({ sql, params });
        return {
          first: async () => this.row,
        };
      },
    };
  }
}

function createDb(row: EntitlementRow | null) {
  return new D1Spy(row);
}

async function expectEntitlement(
  row: EntitlementRow | null,
  expected: boolean,
  userId = "user-1",
  now = Date.parse("2026-01-01T00:00:00.000Z"),
) {
  const db = createDb(row);

  await expect(
    isEntitled(db as unknown as Parameters<typeof isEntitled>[0], userId, now),
  ).resolves.toBe(expected);
  expect(db.statements).toHaveLength(1);
  expect(db.statements[0]?.params).toEqual([userId]);
  expect(db.statements[0]?.sql).toMatch(/bootstrap_user_profile/i);
}

describe("isEntitled", () => {
  it("admin without assignment is entitled", async () => {
    await expectEntitlement({ role: "admin", banned: 0, banExpires: null, assigned: 0 }, true);
  });

  it("user with an assignment is entitled", async () => {
    await expectEntitlement({ role: "user", banned: 0, banExpires: null, assigned: 1 }, true);
  });

  it("user without assignment is not entitled", async () => {
    await expectEntitlement({ role: "user", banned: 0, banExpires: null, assigned: 0 }, false);
  });

  it("unknown user is not entitled", async () => {
    await expectEntitlement(null, false, "missing-user");
  });

  it("banned admin is not entitled", async () => {
    await expectEntitlement(
      { role: "admin", banned: 1, banExpires: "2026-01-02T00:00:00.000Z", assigned: 0 },
      false,
    );
  });

  it("malformed banExpires on a banned user is treated as an active ban", async () => {
    await expectEntitlement(
      { role: "admin", banned: 1, banExpires: "not-a-date", assigned: 0 },
      false,
    );
  });

  it("user whose ban has expired is entitled again when assigned", async () => {
    await expectEntitlement(
      { role: "user", banned: 1, banExpires: Date.parse("2025-12-31T23:59:59.000Z"), assigned: 1 },
      true,
    );
  });

  it("role list containing admin counts as admin", async () => {
    await expectEntitlement({ role: "user,admin,owner", banned: 0, banExpires: null, assigned: 0 }, true);
  });
});
