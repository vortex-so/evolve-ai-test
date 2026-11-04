/// <reference path="./sql.d.ts" />
import { describe, expect, it } from "vitest";
import sql from "../drizzle/0007_mcp_token_version.sql?raw";

describe("MCP token version migration", () => {
  it("creates the per-user version table with cascade deletion", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mcp_token_version/i);
    expect(sql).toMatch(/user_id TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/version INTEGER NOT NULL/i);
    expect(sql).toMatch(/rotated_at INTEGER NOT NULL/i);
    expect(sql).toMatch(/REFERENCES "?user"?\(id\) ON DELETE CASCADE/i);
  });
});
