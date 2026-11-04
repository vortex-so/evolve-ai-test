import { describe, expect, it } from "vitest";
import {
  adminSession,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

function auditInsertCount(statements: Array<{ sql: string }>) {
  return statements.filter(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)).length;
}

describe("bootstrap profile validation", () => {
  it("rejects invalid bootstrap profile config on create without writing D1 state and audits failure", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        name: "broken-profile",
        config: {
          inferenceProvider: "invalid_value",
        },
      },
    });
    const body = (await readJson(response)) as { code?: string; errors?: Array<{ path: string; message: string }> } | null;

    expect(response.status).toBe(400);
    expect(body?.code).toBe("invalid_bootstrap_config");
    expect(body?.errors?.length ?? 0).toBeGreaterThan(0);
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+bootstrap_profile/i.test(sql)),
      "invalid profile create must not execute a bootstrap_profile INSERT",
    ).toBe(false);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("accepts valid bootstrap profile config, persists it, and audits success", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        name: "valid-profile",
        config: {
          inferenceProvider: "gateway",
          inferenceGatewayBaseUrl: "https://api.auth-dev.vortex.so",
          inferenceModels: ["claude-sonnet-5"],
        },
      },
      plans: [{ match: /INSERT\s+INTO\s+bootstrap_profile/i, run: { meta: { changes: 1 } } }],
    });

    expect(response.status).toBe(200);
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+bootstrap_profile/i.test(sql)),
      "valid profile create must execute a bootstrap_profile INSERT",
    ).toBe(true);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("accepts a new official flat v1 key", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        name: "desktop-home-profile",
        config: {
          inferenceProvider: "gateway",
          desktopHome: "standard",
        },
      },
      plans: [{ match: /INSERT\s+INTO\s+bootstrap_profile/i, run: { meta: { changes: 1 } } }],
    });

    expect(response.status).toBe(200);
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+bootstrap_profile/i.test(sql)),
      "an official flat v1 key must pass validation and be persisted",
    ).toBe(true);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("rejects out-of-range and unknown keys with leaf error paths", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        name: "invalid-official-profile",
        config: {
          inferenceProvider: "gateway",
          configRecheckIntervalMinutes: 99,
          unknownManagedKey: true,
        },
      },
    });
    const body = (await readJson(response)) as {
      code?: string;
      errors?: Array<{ path: string; message: string }>;
    } | null;
    const paths = body?.errors?.map(({ path }) => path) ?? [];

    expect(response.status).toBe(400);
    expect(body?.code).toBe("invalid_bootstrap_config");
    expect(paths).toContain("configRecheckIntervalMinutes");
    expect(paths).toContain("unknownManagedKey");
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+bootstrap_profile/i.test(sql)),
      "invalid official-schema values must not be persisted",
    ).toBe(false);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("rejects invalid bootstrap profile config on patch without updating D1 state and audits failure", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles/profile-1", {
      method: "PATCH",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: {
        config: {
          inferenceProvider: "invalid_value",
        },
      },
    });
    const body = (await readJson(response)) as { code?: string; errors?: Array<{ path: string; message: string }> } | null;

    expect(response.status).toBe(400);
    expect(body?.code).toBe("invalid_bootstrap_config");
    expect(body?.errors?.length ?? 0).toBeGreaterThan(0);
    expect(
      DB.statements.some(({ sql }) => /UPDATE\s+bootstrap_profile\s+SET/i.test(sql)),
      "invalid profile patch must not execute a bootstrap_profile UPDATE",
    ).toBe(false);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("returns 404 profile_not_found on patch of nonexistent id and audits failure", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles/does-not-exist", {
      method: "PATCH",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { name: "renamed" },
      plans: [{ match: /UPDATE\s+bootstrap_profile\s+SET/i, run: { meta: { changes: 0 } } }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(404);
    expect(body?.code).toBe("profile_not_found");
    expect(
      DB.statements.some(({ sql }) => /UPDATE\s+bootstrap_profile\s+SET/i.test(sql)),
      "the guarded UPDATE must be attempted before returning 404",
    ).toBe(true);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });

  it("returns 404 profile_not_found on patch with is_default=true for nonexistent id WITHOUT clearing any other profile's is_default", async () => {
    const { response, DB } = await requestApp("/admin/bootstrap/profiles/does-not-exist", {
      method: "PATCH",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { is_default: true },
      plans: [{ match: /SELECT id FROM bootstrap_profile WHERE id = \?/i, first: null }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status).toBe(404);
    expect(body?.code).toBe("profile_not_found");
    expect(
      DB.statements.some(({ sql }) =>
        /UPDATE\s+bootstrap_profile\s+SET\s+is_default\s*=\s*0/i.test(sql),
      ),
      "must NOT clear another profile's is_default when target doesn't exist",
    ).toBe(false);
    expect(
      DB.statements.some(({ sql }) => /UPDATE\s+bootstrap_profile\s+SET/i.test(sql)),
      "must NOT execute the main UPDATE when target doesn't exist",
    ).toBe(false);
    expect(auditInsertCount(DB.statements)).toBe(1);
  });
});
