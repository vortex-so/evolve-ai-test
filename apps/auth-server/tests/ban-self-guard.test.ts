import { describe, expect, it } from "vitest";
import { adminSession, readJson, requestApp, TEST_CONSOLE_ORIGIN } from "./_helpers/test-app";

describe("Phase 4 ban-self guard contract", () => {
  it("rejects POST /api/auth/admin/ban-user when the target is the acting admin", async () => {
    const session = adminSession();
    const { response } = await requestApp("/api/auth/admin/ban-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session,
      body: {
        userId: session.user.id,
        banReason: "self-test",
        banExpiresIn: 3600,
      },
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status, "admins must never be able to ban themselves").toBe(403);
    expect(body?.code, "ban-self must return code=cannot_ban_self").toBe("cannot_ban_self");
  });
});
