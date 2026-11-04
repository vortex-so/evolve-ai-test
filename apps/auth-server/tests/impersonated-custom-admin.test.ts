import { describe, expect, it } from "vitest";
import { adminSession, readJson, requestApp, TEST_CONSOLE_ORIGIN } from "./_helpers/test-app";

const cases = [
  {
    name: "POST /admin/devices/expire",
    path: "/admin/devices/expire",
    method: "POST",
    body: { deviceCode: "device-code-1" },
  },
  {
    name: "POST /admin/bootstrap/profiles",
    path: "/admin/bootstrap/profiles",
    method: "POST",
    body: {
      name: "profile",
      config: { inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so" },
    },
  },
  {
    name: "PATCH /admin/bootstrap/profiles/:id",
    path: "/admin/bootstrap/profiles/profile-1",
    method: "PATCH",
    body: { description: "updated" },
  },
  {
    name: "DELETE /admin/bootstrap/profiles/:id",
    path: "/admin/bootstrap/profiles/profile-1",
    method: "DELETE",
  },
  {
    name: "PUT /admin/bootstrap/assignments/:user_id",
    path: "/admin/bootstrap/assignments/user-1",
    method: "PUT",
    body: { profile_id: "profile-1" },
  },
  {
    name: "DELETE /admin/bootstrap/assignments/:user_id",
    path: "/admin/bootstrap/assignments/user-1",
    method: "DELETE",
  },
  {
    name: "PATCH /admin/oauth-clients/:id",
    path: "/admin/oauth-clients/client-1",
    method: "PATCH",
    body: { name: "Updated" },
  },
  {
    name: "DELETE /admin/oauth-clients/:id",
    path: "/admin/oauth-clients/client-1",
    method: "DELETE",
  },
] as const;

describe("impersonated custom admin mutations", () => {
  it.each(cases)("blocks $name", async ({ path, method, body }) => {
    const { response, DB } = await requestApp(path, {
      method,
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession({ impersonatedBy: { userId: "real-admin-id" } }),
      body,
    });
    const payload = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(403);
    expect(payload?.code).toBe("impersonated_admin_action_blocked");
    expect(
      DB.statements.some(({ sql }) => /INSERT|UPDATE|DELETE/i.test(sql) && !/INSERT\s+INTO\s+audit_log/i.test(sql)),
      "impersonated admin mutations must not execute non-audit D1 writes",
    ).toBe(false);
  });
});
