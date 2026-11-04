import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminSession,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
  userSession,
} from "./_helpers/test-app";

describe("bootstrap profile entitlement and fallback contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the assigned bootstrap profile for an entitled user", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession({ user: { id: "assigned-user-id", email: "assigned@vortex.so", role: "user" } }),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /SELECT u\.role AS role/i,
          first: { role: "user", banned: 0, banExpires: null, assigned: 1 },
        },
        {
          match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
          first: { profile_id: "power-user-profile" },
        },
        {
          match: /SELECT config, schema_version FROM bootstrap_profile WHERE id = \?/i,
          first: {
            config: JSON.stringify({
              inferenceProvider: "gateway",
              inferenceGatewayBaseUrl: "https://stored.example.com",
              inferenceGatewayAuthScheme: "bearer",
              inferenceCredentialKind: "interactive",
              inferenceModels: [
                { name: "claude-opus-5", anthropicFamilyTier: "opus", isFamilyDefault: true },
              ],
            }),
            schema_version: 1,
          },
        },
      ],
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(
      expect.objectContaining({
        inferenceModels: [
          expect.objectContaining({ name: "claude-opus-5", anthropicFamilyTier: "opus" }),
        ],
      }),
    );
    expect(
      DB.statements.some(({ sql }) => /bootstrap_profile WHERE id = \?/i.test(sql)),
      "bootstrap must load the explicitly assigned profile",
    ).toBe(true);
  });

  it("returns the default profile for an admin without an assignment", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /SELECT u\.role AS role/i,
          first: { role: "admin", banned: 0, banExpires: null, assigned: 0 },
        },
        {
          match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
          first: null,
        },
        {
          match: /SELECT config, schema_version FROM bootstrap_profile WHERE is_default = 1/i,
          first: {
            config: JSON.stringify({
              inferenceProvider: "gateway",
              inferenceModels: ["claude-sonnet-5"],
            }),
            schema_version: 1,
          },
        },
      ],
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        inferenceModels: ["claude-sonnet-5"],
      }),
    );
    expect(
      DB.statements.some(({ sql }) => /bootstrap_profile WHERE is_default = 1/i.test(sql)),
      "an entitled admin without an assignment must receive the default profile",
    ).toBe(true);
  });

  it("returns 403 for an unassigned non-admin without resolving a profile", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession(),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /SELECT u\.role AS role/i,
          first: { role: "user", banned: 0, banExpires: null, assigned: 0 },
        },
      ],
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(readJson(response)).resolves.toEqual({ error: "not_entitled" });
    expect(
      DB.statements.some(({ sql }) => /SELECT profile_id|SELECT config, schema_version/i.test(sql)),
      "profile resolution must not run for an unentitled user",
    ).toBe(false);
  });

  it("returns 403 for an actively banned user", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /SELECT u\.role AS role/i,
          first: { role: "admin", banned: 1, banExpires: null, assigned: 1 },
        },
      ],
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(readJson(response)).resolves.toEqual({ error: "not_entitled" });
    expect(
      DB.statements.some(({ sql }) => /SELECT profile_id|SELECT config, schema_version/i.test(sql)),
      "profile resolution must not run for a banned user",
    ).toBe(false);
  });

  it("returns 401 invalid_token without a bearer session", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(readJson(response)).resolves.toEqual({ error: "invalid_token" });
    expect(DB.statements).toHaveLength(0);
  });
});
