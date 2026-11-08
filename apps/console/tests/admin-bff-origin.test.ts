import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_URL = "https://api.auth-dev.vortex.so";
const CONSOLE_URL = "https://console.auth-dev.vortex.so";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AUTH_API_URL", AUTH_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockSessionOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          session: { userId: "u", impersonatedBy: null },
          user: { id: "u", role: "admin" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

async function loadRequireAdminSession() {
  const mod = await import("../src/lib/admin-bff");
  return mod.requireAdminSession;
}

describe("requireAdminSession origin / referer policy", () => {
  it("accepts a request with a trusted Origin header", async () => {
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const result = await requireAdminSession(
      new Request(`${CONSOLE_URL}/api/admin/sessions`, {
        headers: { cookie: "session=admin", origin: CONSOLE_URL },
      }),
    );

    expect(result).not.toBeInstanceOf(Response);
  });

  it("accepts a request with NO Origin but a trusted Referer (same-origin browser GET)", async () => {
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const result = await requireAdminSession(
      new Request(`${CONSOLE_URL}/api/admin/sessions`, {
        headers: { cookie: "session=admin", referer: `${CONSOLE_URL}/dashboard` },
      }),
    );

    expect(result).not.toBeInstanceOf(Response);
  });

  it("rejects a request with an untrusted Origin header (403 origin_mismatch)", async () => {
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const result = (await requireAdminSession(
      new Request(`${CONSOLE_URL}/api/admin/sessions`, {
        headers: { cookie: "session=admin", origin: "https://evil.example.com" },
      }),
    )) as Response;

    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "origin_mismatch" });
  });

  it("rejects a request with NO Origin and NO Referer (403 origin_mismatch)", async () => {
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const result = (await requireAdminSession(
      new Request(`${CONSOLE_URL}/api/admin/sessions`, {
        headers: { cookie: "session=admin" },
      }),
    )) as Response;

    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "origin_mismatch" });
  });

  it("rejects a request with NO Origin and an untrusted Referer (403 origin_mismatch)", async () => {
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const result = (await requireAdminSession(
      new Request(`${CONSOLE_URL}/api/admin/sessions`, {
        headers: { cookie: "session=admin", referer: "https://evil.example.com/attack" },
      }),
    )) as Response;

    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "origin_mismatch" });
  });

  it("uses the production console origin without trusting a lookalike", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_AUTH_API_URL", "https://api.internal.vortex.so");
    vi.stubEnv("NEXT_PUBLIC_CONSOLE_URL", "https://console.internal.vortex.so");
    mockSessionOk();
    const requireAdminSession = await loadRequireAdminSession();

    const accepted = await requireAdminSession(
      new Request("https://console.internal.vortex.so/api/admin/sessions", {
        headers: {
          cookie: "session=admin",
          origin: "https://console.internal.vortex.so",
        },
      }),
    );
    expect(accepted).not.toBeInstanceOf(Response);

    const rejected = (await requireAdminSession(
      new Request("https://console.internal.vortex.so/api/admin/sessions", {
        headers: {
          cookie: "session=admin",
          origin: "https://console.internal.vortex.so.evil.example",
        },
      }),
    )) as Response;
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: "origin_mismatch" });
  });
});
