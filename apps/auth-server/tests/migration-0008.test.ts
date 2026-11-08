/// <reference path="./sql.d.ts" />
import { describe, expect, it } from "vitest";
import sql from "../drizzle/0008_litellm_mcp_key.sql?raw";

describe("LiteLLM MCP key migration", () => {
  it("creates a purpose-separated encrypted key table with cascade deletion", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS litellm_user_mcp_key/i);
    expect(sql).toMatch(/user_id TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/litellm_user_id TEXT NOT NULL/i);
    expect(sql).toMatch(/key_alias TEXT NOT NULL/i);
    expect(sql).toMatch(/key_ciphertext TEXT NOT NULL/i);
    expect(sql).toMatch(/key_iv TEXT NOT NULL/i);
    expect(sql).toMatch(/key_wrap_version INTEGER NOT NULL DEFAULT 1/i);
    expect(sql).toMatch(/REFERENCES "?user"?\(id\) ON DELETE CASCADE/i);
  });
});
