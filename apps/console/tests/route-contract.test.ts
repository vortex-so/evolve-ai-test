import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn(async () => ({
  session: { user: { id: "admin-id", role: "admin" }, impersonatedBy: null },
  cookieHeader: "session=admin",
}));
const proxyRequestToAuthServer = vi.fn(async (path: string) => new Response(JSON.stringify({ path })));
const proxyJsonToAuthServer = vi.fn(async (path: string) => new Response(JSON.stringify({ path })));
const withSearch = (path: string, searchParams: URLSearchParams) => {
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
};

vi.mock("@/lib/admin-bff", () => ({
  requireAdminSession,
  proxyRequestToAuthServer,
  proxyJsonToAuthServer,
  withSearch,
  readJsonBody: async (req: Request) => req.json(),
}));

async function routeContext(params: { id: string }) {
  return { params: Promise.resolve(params) };
}

describe("admin route contract", () => {
  beforeEach(() => {
    requireAdminSession.mockClear();
    proxyRequestToAuthServer.mockClear();
    proxyJsonToAuthServer.mockClear();
  });

  it("DELETE oauth client proxies to the guarded auth-server admin path", async () => {
    const mod = await import("../src/app/api/admin/oauth-clients/[id]/route");

    await mod.DELETE(new Request("https://console.test/api/admin/oauth-clients/client-1", { method: "DELETE" }), await routeContext({ id: "client-1" }));

    expect(proxyRequestToAuthServer).toHaveBeenCalledWith(
      "/admin/oauth-clients/client-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(proxyJsonToAuthServer).not.toHaveBeenCalled();
  });

  it("DELETE user sessions without a token proxies to revoke-user-sessions", async () => {
    const mod = await import("../src/app/api/admin/users/[id]/sessions/route");

    await mod.DELETE(new Request("https://console.test/api/admin/users/user-1/sessions", { method: "DELETE" }), await routeContext({ id: "user-1" }));

    expect(proxyJsonToAuthServer).toHaveBeenCalledWith(
      "/api/auth/admin/revoke-user-sessions",
      expect.objectContaining({ body: { userId: "user-1" } }),
    );
  });

  it("DELETE user sessions with a token still proxies to revoke-user-session", async () => {
    const mod = await import("../src/app/api/admin/users/[id]/sessions/route");

    await mod.DELETE(new Request("https://console.test/api/admin/users/user-1/sessions?token=session-token", { method: "DELETE" }), await routeContext({ id: "user-1" }));

    expect(proxyJsonToAuthServer).toHaveBeenCalledWith(
      "/api/auth/admin/revoke-user-session",
      expect.objectContaining({ body: { sessionToken: "session-token" } }),
    );
  });

  it("proxies Odoo BYOK reads and writes to the auth-server admin path", async () => {
    const mod = await import("../src/app/api/admin/users/[id]/byok/odoo/route");
    const request = new Request("https://console.test/api/admin/users/user-1/byok/odoo", {
      method: "PUT",
      body: JSON.stringify({ version: 0, database: "db", login: "user@example.com", enabled: true, policy: {} }),
      headers: { "content-type": "application/json" },
    });

    await mod.PUT(request, await routeContext({ id: "user-1" }));

    expect(proxyJsonToAuthServer).toHaveBeenCalledWith(
      "/admin/users/user-1/byok/odoo",
      expect.objectContaining({ method: "PUT", body: expect.anything() }),
    );
  });

  it("proxies Odoo connection tests through the BFF and retires approval decisions", async () => {
    const testRoute = await import("../src/app/api/admin/users/[id]/byok/odoo/test/route");
    await testRoute.POST(
      new Request("https://console.test/api/admin/users/user-1/byok/odoo/test", {
        method: "POST",
        body: JSON.stringify({ version: 1 }),
      }),
      await routeContext({ id: "user-1" }),
    );
    expect(proxyJsonToAuthServer).toHaveBeenCalledWith(
      "/admin/users/user-1/byok/odoo/test",
      expect.objectContaining({ body: { version: 1 } }),
    );

    const approvalRoute = await import("../src/app/api/admin/byok/approvals/[id]/route");
    const response = await approvalRoute.POST(
      new Request("https://console.test/api/admin/byok/approvals/approval-1", {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      }),
      await routeContext({ id: "approval-1" }),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "custom_approval_retired" }));
    expect(proxyJsonToAuthServer).not.toHaveBeenCalledWith(
      "/admin/byok/approvals/approval-1",
      expect.anything(),
    );
  });

  it("retires approval reads after the admin guard", async () => {
    const approvalRoute = await import("../src/app/api/admin/byok/approvals/route");
    const response = await approvalRoute.GET(
      new Request("https://console.test/api/admin/byok/approvals?limit=100"),
    );

    expect(requireAdminSession).toHaveBeenCalled();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "custom_approval_retired" }));
    expect(proxyRequestToAuthServer).not.toHaveBeenCalled();
  });
});
