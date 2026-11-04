import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../drizzle/0005_device_code_created_at.sql",
  import.meta.url,
);

describe("deviceCode createdAt migration", () => {
  it("creates a guarded trigger for inserts without createdAt", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(
      /CREATE TRIGGER IF NOT EXISTS deviceCode_set_created_at/i,
    );
    expect(sql).toMatch(/AFTER INSERT ON deviceCode/i);
    expect(sql).toMatch(/WHEN NEW\.createdAt IS NULL/i);
  });
});
