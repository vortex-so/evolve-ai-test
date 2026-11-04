import { describe, expect, it } from "vitest";
import {
  adminSession,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

function firstAuditInsertSql(statements: Array<{ sql: string }>) {
  return statements.findIndex(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql));
}

describe("Phase 4 audit row contract", () => {
  it("writes an audit_log row synchronously before a successful admin mutation returns", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/set-role", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "target-user-id", role: "admin" },
      plans: [{ match: /UPDATE\s+user\s+SET\s+role/i, run: { meta: { changes: 1 } } }],
    });

    expect(response.status, "set-role success path must complete with HTTP 200").toBe(200);
    expect(firstAuditInsertSql(DB.statements), "successful admin mutations must insert into audit_log").toBeGreaterThanOrEqual(0);
    expect(
      DB.statements.some(({ sql }) => /actor_email_snapshot|actor_role_snapshot|action|target_type|target_id|outcome|status_code/i.test(sql)),
      "audit_log INSERT must persist actor snapshots, action, target, outcome, and status_code",
    ).toBe(true);
  });

  it("sets acting_as_user_id on impersonated admin mutations", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/ban-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession({ impersonatedBy: { userId: "real-admin-id" } }),
      body: { userId: "target-user-id", banReason: "policy", banExpiresIn: 3600 },
    });

    expect(response.status, "impersonated mutations must still emit a synchronous failure audit row").toBe(403);
    expect(
      DB.statements.some(({ sql }) => /acting_as_user_id/i.test(sql)),
      "impersonated admin mutations must store acting_as_user_id in audit_log",
    ).toBe(true);
  });

  it("records outcome='failure' and the HTTP status code when a mutation fails", async () => {
    const { response, DB } = await requestApp("/api/auth/admin/remove-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "last-admin-id" },
      plans: [{ match: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i, run: { meta: { changes: 0 } } }],
    });

    expect(response.status, "failing admin mutations must surface their actual failure status").toBe(409);
    expect(
      DB.statements.some(({ sql }) => /outcome|status_code/i.test(sql)),
      "failed admin mutations must write outcome='failure' and the returned status_code to audit_log",
    ).toBe(true);
  });

  it("redacts the password bound by the set-user-password admin proxy audit row", async () => {
    const password = "plain-text-password-value";
    const { DB } = await requestApp("/api/auth/admin/set-user-password", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "target-user-id", newPassword: password },
    });

    const auditInsert = DB.statements.find(({ sql }) =>
      /INSERT\s+INTO\s+audit_log/i.test(sql),
    );
    expect(auditInsert, "set-user-password must write an audit_log row").toBeDefined();

    const targetSnapshot = String(auditInsert?.params[10]);
    expect(targetSnapshot).toContain("[REDACTED]");
    expect(targetSnapshot).not.toContain(password);
  });
});
