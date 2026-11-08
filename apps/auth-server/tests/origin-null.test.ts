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

  it("accepts the configured production console origin and rejects a lookalike", async () => {
    const productionEnv = {
      CONSOLE_ORIGIN: "https://console.internal.vortex.so",
      AUTH_WEB_ORIGIN: "https://auth.internal.vortex.so",
      AUTH_COOKIE_DOMAIN: ".internal.vortex.so",
    };

    const accepted = await requestApp("/admin/audit", {
      method: "GET",
      origin: productionEnv.CONSOLE_ORIGIN,
      session: adminSession(),
      env: productionEnv,
    });
    expect(accepted.response.status).toBe(200);

    const rejected = await requestApp("/admin/audit", {
      method: "GET",
      origin: "https://console.internal.vortex.so.evil.example",
      session: adminSession(),
      env: productionEnv,
    });
    expect(rejected.response.status).toBe(403);
    expect(await rejected.response.json()).toEqual({
      error: "origin_mismatch",
      code: "origin_mismatch",
    });
  });
});
