import { describe, expect, it } from "vitest";
import { readJson, requestApp, TEST_PUBLIC_ORIGIN } from "./_helpers/test-app";

describe("OAuth discovery routes", () => {
  it("keeps root discovery on the public origin", async () => {
    const { response } = await requestApp("/.well-known/oauth-authorization-server", {
      origin: null,
    });
    const body = (await readJson(response)) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.issuer).toBe(TEST_PUBLIC_ORIGIN);
    expect(body.device_authorization_endpoint).toBe(`${TEST_PUBLIC_ORIGIN}/oauth/device`);
    expect(body.token_endpoint).toBe(`${TEST_PUBLIC_ORIGIN}/oauth/token`);
  });

  it("advertises the refresh_token grant alongside device_code", async () => {
    const { response } = await requestApp("/.well-known/oauth-authorization-server", {
      origin: null,
    });
    const body = (await readJson(response)) as { grant_types_supported: string[] };

    expect(body.grant_types_supported).toEqual([
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ]);
  });

  it("does not expose a second discovery document under /v1", async () => {
    const { response } = await requestApp("/v1/.well-known/oauth-authorization-server", {
      origin: null,
    });

    expect(response.status).toBe(404);
  });
});
