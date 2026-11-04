import { describe, expect, it } from "vitest";
import {
  adminSession,
  expectSql,
  readJson,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

describe("Phase 4 system OAuth client guard contract", () => {
  it("returns 409 and preserves system clients such as claude-desktop", async () => {
    const { response, DB } = await requestApp("/admin/oauth-clients/claude-desktop", {
      method: "DELETE",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      plans: [{ match: /DELETE FROM oauthClient WHERE id = \? AND is_system = 0/, run: { meta: { changes: 0 } } }],
    });
    const body = (await readJson(response)) as { code?: string } | null;

    expect(response.status, "system oauth clients must not be deletable").toBe(409);
    expect(body?.code, "system client deletions must return code=system_client_protected").toBe(
      "system_client_protected",
    );
    expectSql(
      DB,
      /DELETE\s+FROM\s+oauthClient\s+WHERE\s+id\s*=\s*\?\s+AND\s+is_system\s*=\s*0/i,
      "oauth client deletion must use the atomic is_system=0 SQL guard",
    );
  });
});
