import { describe, expect, it } from "vitest";
import { adminSession, requestApp, TEST_CONSOLE_ORIGIN } from "./_helpers/test-app";

describe("admin origin enforcement", () => {
  it("rejects GET /admin/audit when Origin is missing", async () => {
    const { response } = await requestApp("/admin/audit", {
      method: "GET",
      origin: null,
      session: adminSession(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_mismatch", code: "origin_mismatch" });
  });

  it("rejects GET /admin/audit when Origin is the literal null string", async () => {
    const { response } = await requestApp("/admin/audit", {
      method: "GET",
      origin: "null",
      session: adminSession(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_mismatch", code: "origin_mismatch" });
  });

  it("allows GET /admin/audit with the correct Origin", async () => {
    const { response } = await requestApp("/admin/audit", {
      method: "GET",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
    });

    expect(response.status).toBe(200);
  });
});
