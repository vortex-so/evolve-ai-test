import { validateBootstrapConfig } from "@vortex/schema";
import { describe, expect, it } from "vitest";
import {
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
  TEST_PUBLIC_ORIGIN,
  userSession,
} from "./_helpers/test-app";

const entitledFallbackPlans = [
  {
    match: /SELECT u\.role AS role/i,
    first: { role: "user", banned: 0, banExpires: null, assigned: 1 },
  },
];

async function requestFallback(headers: HeadersInit = {}) {
  return requestApp("/user/bootstrap", {
    origin: TEST_CONSOLE_ORIGIN,
    session: userSession(),
    headers: { Authorization: "Bearer test-bootstrap-token", ...headers },
    plans: entitledFallbackPlans,
  });
}

describe("bootstrap flat v1 response format", () => {
  it("serves $schemaVersion 1 without a $schema pointer", async () => {
    const { response } = await requestFallback();
    const body = (await readJson(response)) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.$schemaVersion).toBe(1);
    expect(body).not.toHaveProperty("$schema");
  });

  it("serves the configured inference gateway origin", async () => {
    const { response } = await requestFallback();
    const body = (await readJson(response)) as Record<string, unknown>;

    expect(body.inferenceGatewayBaseUrl).toBe(TEST_PUBLIC_ORIGIN);
  });

  it("serves a config accepted by the vendored official v1 schema", async () => {
    const { response } = await requestFallback();
    const body = await readJson(response);

    expect(validateBootstrapConfig(body)).toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it("never serves the nonexistent claude-haiku-5 model", async () => {
    const { response } = await requestFallback();
    const body = await response.text();

    expect(body).not.toContain("claude-haiku-5");
    expect(body).toContain("claude-haiku-4-5");
  });

  it("strips a legacy $schema pointer from a stored profile", async () => {
    const { response } = await requestApp("/user/bootstrap", {
      origin: TEST_CONSOLE_ORIGIN,
      session: userSession(),
      headers: { Authorization: "Bearer test-bootstrap-token" },
      plans: [
        ...entitledFallbackPlans,
        {
          match: /SELECT profile_id[\s\S]*FROM bootstrap_user_profile/i,
          first: { profile_id: "legacy-profile" },
        },
        {
          match: /SELECT config, schema_version FROM bootstrap_profile WHERE id = \?/i,
          first: {
            config: JSON.stringify({
              $schema: "https://claude.com/legacy-bootstrap-schema.json",
              inferenceProvider: "gateway",
              inferenceModels: ["claude-sonnet-5"],
            }),
            schema_version: 1,
          },
        },
      ],
    });
    const body = (await readJson(response)) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.$schemaVersion).toBe(1);
    expect(body).not.toHaveProperty("$schema");
  });

  it("returns 304 for a matching If-None-Match value", async () => {
    const first = await requestFallback();
    const etag = first.response.headers.get("etag");

    expect(first.response.status).toBe(200);
    expect(etag).toBeTruthy();

    const second = await requestFallback({ "If-None-Match": etag! });

    expect(second.response.status).toBe(304);
    expect(second.response.headers.get("etag")).toBe(etag);
    expect(second.response.headers.get("cache-control")).toBe("no-store");
    expect(await second.response.text()).toBe("");
  });

  it("returns 304 when If-None-Match carries the weak form of the ETag", async () => {
    const first = await requestFallback();
    const etag = first.response.headers.get("etag");

    expect(etag).toBeTruthy();

    const second = await requestFallback({ "If-None-Match": `W/${etag}` });

    expect(second.response.status).toBe(304);
    expect(second.response.headers.get("etag")).toBe(etag);
    expect(second.response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 304 when the matching ETag is one of several listed", async () => {
    const first = await requestFallback();
    const etag = first.response.headers.get("etag");

    expect(etag).toBeTruthy();

    const second = await requestFallback({
      "If-None-Match": `"different", W/${etag}, "also-different"`,
    });

    expect(second.response.status).toBe(304);
    expect(second.response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 304 for If-None-Match: *", async () => {
    const { response } = await requestFallback({ "If-None-Match": "*" });

    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 200 when the ETag differs", async () => {
    const { response } = await requestFallback({
      "If-None-Match": `W/"different"`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
