import { describe, expect, it, vi } from "vitest";
import { createOAuthTokenHandler, type OAuthRefreshService } from "../src/oauth/token";

const TOKEN_URL = "https://api.auth-dev.vortex.so/oauth/token";

function formRequest(body: Record<string, string>) {
  return new Request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

function createRefreshService(): OAuthRefreshService {
  return {
    issueForAccessToken: vi.fn<OAuthRefreshService["issueForAccessToken"]>(async () => null),
    refresh: vi.fn<OAuthRefreshService["refresh"]>(async () => ({
      ok: false,
      error: "invalid_grant",
    })),
  };
}

describe("OAuth token handler", () => {
  it("adds a refresh token and expiry to a successful device_code response", async () => {
    const refreshService = createRefreshService();
    vi.mocked(refreshService.issueForAccessToken).mockResolvedValue({
      refreshToken: "refresh-one",
      expiresIn: 604_800,
    });
    const authHandler = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/auth/device/token");
      expect(await request.json()).toEqual({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: "device-code",
        scope: "bootstrap:read",
        client_id: "claude-desktop",
      });
      return Response.json({
        access_token: "access-one",
        token_type: "Bearer",
        expires_in: 604_800,
        scope: "bootstrap:read",
      });
    });
    const handler = createOAuthTokenHandler({ authHandler, refreshService });

    const response = await handler(
      formRequest({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: "device-code",
        scope: "bootstrap:read",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(await response.json()).toEqual({
      access_token: "access-one",
      token_type: "Bearer",
      expires_in: 604_800,
      scope: "bootstrap:read",
      refresh_token: "refresh-one",
      refresh_token_expires_in: 604_800,
    });
    expect(refreshService.issueForAccessToken).toHaveBeenCalledWith({
      accessToken: "access-one",
      clientId: "claude-desktop",
      scope: "bootstrap:read",
    });
  });

  it("returns rotated tokens for a refresh_token grant with no-store headers", async () => {
    const refreshService = createRefreshService();
    vi.mocked(refreshService.refresh).mockResolvedValue({
      ok: true,
      body: {
        access_token: "access-two",
        token_type: "Bearer",
        expires_in: 604_800,
        refresh_token: "refresh-two",
        refresh_token_expires_in: 604_800,
      },
    });
    const authHandler = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    const handler = createOAuthTokenHandler({ authHandler, refreshService });

    const response = await handler(
      formRequest({ grant_type: "refresh_token", refresh_token: "refresh-one" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(await response.json()).toEqual({
      access_token: "access-two",
      token_type: "Bearer",
      expires_in: 604_800,
      refresh_token: "refresh-two",
      refresh_token_expires_in: 604_800,
    });
    expect(refreshService.refresh).toHaveBeenCalledWith({
      refreshToken: "refresh-one",
      clientId: "claude-desktop",
    });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it("returns invalid_grant when refresh rotation fails", async () => {
    const refreshService = createRefreshService();
    const handler = createOAuthTokenHandler({
      authHandler: vi.fn(async () => Response.json({})),
      refreshService,
    });

    const response = await handler(
      formRequest({ grant_type: "refresh_token", refresh_token: "invalid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });

  it("rejects unsupported grants", async () => {
    const handler = createOAuthTokenHandler({
      authHandler: vi.fn(async () => Response.json({})),
      refreshService: createRefreshService(),
    });

    const response = await handler(formRequest({ grant_type: "authorization_code" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsupported_grant_type" });
  });

  it("rejects requests without grant_type", async () => {
    const handler = createOAuthTokenHandler({
      authHandler: vi.fn(async () => Response.json({})),
      refreshService: createRefreshService(),
    });

    const response = await handler(formRequest({ client_id: "claude-desktop" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
