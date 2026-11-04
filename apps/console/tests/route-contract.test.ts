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
});
