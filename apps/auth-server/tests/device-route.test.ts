import { describe, expect, it } from "vitest";
import { readJson, requestApp, TEST_PUBLIC_ORIGIN } from "./_helpers/test-app";

describe("device verification route", () => {
  it("redirects to auth-web with the user code", async () => {
    const { response } = await requestApp("/device?user_code=ABCD-1234", { origin: null });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auth.auth-dev.vortex.so/auth/device?user_code=ABCD-1234",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects invalid user codes without forwarding them", async () => {
    const { response } = await requestApp("/device?user_code=%3Cscript%3E", { origin: null });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auth.auth-dev.vortex.so/auth/device",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a verification_uri on the API origin /device", async () => {
    const form = new URLSearchParams({
      client_id: "claude-desktop",
      scope: "openid offline_access bootstrap:read",
    });
    const { response } = await requestApp("/oauth/device", {
      method: "POST",
      origin: null,
      rawBody: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const body = (await readJson(response)) as { verification_uri?: string } | null;

    expect(response.status).toBe(200);
    expect(body?.verification_uri).toBe(`${TEST_PUBLIC_ORIGIN}/device`);
  });
});
