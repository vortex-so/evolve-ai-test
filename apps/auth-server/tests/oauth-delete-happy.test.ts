import { describe, expect, it } from "vitest";
import {
  adminSession,
  expectSql,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

describe("oauth delete happy path", () => {
  it("deletes a non-system oauth client with the atomic guard and audits success", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients/client-123", {
      method: "DELETE",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /DELETE\s+FROM\s+oauthClient\s+WHERE\s+id\s*=\s*\?\s+AND\s+is_system\s*=\s*0/i, run: { meta: { changes: 1 } } }],
    });

    expect(response.status).toBe(200);
    expectSql(
      DB,
      /DELETE\s+FROM\s+oauthClient\s+WHERE\s+id\s*=\s*\?\s+AND\s+is_system\s*=\s*0/i,
      "oauth client delete must use the guarded SQL path",
    );
    expect(
      DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql)),
      "successful oauth client delete must write an audit row",
    ).toBe(true);
  });
});
