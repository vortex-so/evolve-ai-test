import { describe, expect, it } from "vitest";
import {
  adminSession,
  expectSql,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

describe("Phase 4 cursor pagination contract", () => {
  it("GET /admin/audit paginates after a created_at,id cursor and returns next_cursor", async () => {
    const { response, DB } = await requestApp("/admin/audit?cursor=1722600000000,audit_002&limit=25", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
    });
    const body = (await readJson(response)) as { next_cursor?: string; rows?: unknown[] } | null;

    expect(response.status, "GET /admin/audit must succeed for admin callers").toBe(200);
    expect(Array.isArray(body?.rows), "/admin/audit must return a rows array").toBe(true);
    expect(typeof body?.next_cursor, "/admin/audit must include next_cursor when more rows exist").toBe("string");
    expectSql(
      DB,
      /ORDER\s+BY\s+created_at\s+DESC\s*,\s*id\s+ASC/i,
      "/admin/audit must order rows by (created_at DESC, id ASC)",
    );
  });

  it("GET /admin/devices paginates after a createdAt,id cursor and returns next_cursor", async () => {
    const { response, DB } = await requestApp("/admin/devices?cursor=1722600000000,device_002&limit=25", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
    });
    const body = (await readJson(response)) as { next_cursor?: string; rows?: unknown[] } | null;

    expect(response.status, "GET /admin/devices must succeed for admin callers").toBe(200);
    expect(Array.isArray(body?.rows), "/admin/devices must return a rows array").toBe(true);
    expect(typeof body?.next_cursor, "/admin/devices must include next_cursor when more rows exist").toBe("string");
    expectSql(
      DB,
      /ORDER\s+BY\s+(?:dc\.)?createdAt\s+DESC\s*,\s*(?:dc\.)?id\s+ASC/i,
      "/admin/devices must order rows by (createdAt DESC, id ASC), qualification allowed",
    );
  });
});
