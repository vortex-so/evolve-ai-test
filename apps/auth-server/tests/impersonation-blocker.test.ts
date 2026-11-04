import { describe, expect, it } from "vitest";
import { adminSession, readJson, requestApp, TEST_CONSOLE_ORIGIN } from "./_helpers/test-app";

describe("Phase 4 impersonation blocker contract", () => {
  it("blocks admin mutations when session.impersonatedBy is set", async () => {
    const { response } = await requestApp("/api/auth/admin/ban-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession({ impersonatedBy: { userId: "real-admin-id" } }),
      body: {
        userId: "target-user-id",
        banReason: "policy test",
        banExpiresIn: 3600,
      },
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(
      response.status,
      "admin mutations must reject impersonated sessions with 403 before touching state",
    ).toBe(403);
    expect(body?.code, "impersonated mutations must expose code=impersonated_admin_action_blocked").toBe(
      "impersonated_admin_action_blocked",
    );
  });
});
