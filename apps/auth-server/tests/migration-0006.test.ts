/// <reference path="./sql.d.ts" />
import { describe, expect, it } from "vitest";
import sql from "../drizzle/0006_redact_audit_passwords.sql?raw";

describe("audit credential redaction migration", () => {
  it("scrubs existing credential fields in both JSON audit columns", () => {
    expect(sql).toMatch(/UPDATE audit_log[\s\S]*target_snapshot/i);
    expect(sql).toMatch(/UPDATE audit_log[\s\S]*metadata/i);
    expect(sql).toMatch(/json_valid\(target_snapshot\)/i);
    expect(sql).toMatch(/json_valid\(metadata\)/i);

    for (const path of [
      "newPassword",
      "password",
      "currentPassword",
      "secret",
      "clientSecret",
      "client_secret",
      "token",
    ]) {
      expect(sql).toContain(`$.${path}`);
    }

    expect(sql).toContain("[REDACTED]");
    expect(sql).toMatch(/json_extract\([^)]+,\s*'\$\.newPassword'\) IS NOT NULL/i);
    expect(sql).toMatch(/json_set\([^)]+,\s*'\$\.newPassword',\s*'\[REDACTED\]'\)/i);
  });
});
