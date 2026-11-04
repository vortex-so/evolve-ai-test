import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
  userSession,
} from "./_helpers/test-app";

describe("Phase 4 bootstrap profile fallback contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the default bootstrap_profile when the user has no bootstrap_user_profile row", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession(),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /bootstrap_profile/i,
          first: {
            id: "default-cowork-user",
            name: "cowork-user",
            config: JSON.stringify({
              inferenceProvider: "gateway",
              inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so",
              inferenceGatewayAuthScheme: "bearer",
              inferenceCredentialKind: "interactive",
              inferenceModels: ["claude-sonnet-5"],
            }),
          },
        },
      ],
    });
    const body = await readJson(response);

    expect(response.status, "bootstrap must succeed for entitled users with no explicit assignment").toBe(200);
    expect(body, "bootstrap should return the default bootstrap_profile config, not the hardcoded fallback").toEqual(
      expect.objectContaining({
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so",
        inferenceModels: ["claude-sonnet-5"],
      }),
    );
    expect(
      DB.statements.some(({ sql }) => /bootstrap_user_profile/i.test(sql)),
      "bootstrap lookup must consult bootstrap_user_profile before falling back to the default profile",
    ).toBe(true);
  });

  it("returns the assigned bootstrap profile after Zod validation", async () => {
    const { response, DB } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession({ user: { id: "assigned-user-id", email: "assigned@vortex.so", role: "user" } }),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        {
          match: /bootstrap_user_profile/i,
          first: {
            user_id: "assigned-user-id",
            profile_id: "power-user-profile",
          },
        },
        {
          match: /bootstrap_profile/i,
          first: {
            id: "power-user-profile",
            name: "power-user",
            config: JSON.stringify({
              inferenceProvider: "gateway",
              inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so",
              inferenceGatewayAuthScheme: "bearer",
              inferenceCredentialKind: "interactive",
              inferenceModels: [
                { name: "claude-opus-5", anthropicFamilyTier: "opus", isFamilyDefault: true },
              ],
            }),
          },
        },
      ],
    });
    const body = await readJson(response);

    expect(response.status, "bootstrap must return the assigned profile for explicitly mapped users").toBe(200);
    expect(body, "assigned bootstrap response must come from the validated DB config blob").toEqual(
      expect.objectContaining({
        inferenceModels: [
          expect.objectContaining({ name: "claude-opus-5", anthropicFamilyTier: "opus" }),
        ],
      }),
    );
    expect(
      DB.statements.some(({ sql }) => /bootstrap_profile/i.test(sql)),
      "bootstrap must read bootstrap_profile rows from D1 before responding",
    ).toBe(true);
  });
});
