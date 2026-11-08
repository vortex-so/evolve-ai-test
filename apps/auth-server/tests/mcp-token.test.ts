import { describe, expect, it } from "vitest";
import { mintMcpToken, verifyMcpToken } from "../src/lib/mcp-token";

const SECRET = "mcp-secret-mcp-secret-mcp-secret-1234";

describe("MCP bearer tokens", () => {
  it("mints and verifies a deterministic user/version token", async () => {
    const first = await mintMcpToken(SECRET, "user-123", 1);
    const second = await mintMcpToken(SECRET, "user-123", 1);

    expect(first).toBe(second);
    expect(first).toMatch(/^vmcp_[A-Za-z0-9_-]+\.1\.[A-Za-z0-9_-]+$/);
    await expect(verifyMcpToken(SECRET, first)).resolves.toEqual({
      userId: "user-123",
      version: 1,
    });
  });

  it("rejects a tampered signature", async () => {
    const token = await mintMcpToken(SECRET, "user-123", 1);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(verifyMcpToken(SECRET, tampered)).resolves.toBeNull();
  });

  it("rejects a token verified with the wrong secret", async () => {
    const token = await mintMcpToken(SECRET, "user-123", 1);

    await expect(
      verifyMcpToken("different-secret-different-secret-1234", token),
    ).resolves.toBeNull();
  });

  it.each([
    "",
    "vmcp_",
    "vmcp_bad.1",
    "vmcp_bad.zero.signature",
    "vmcp_bad.0.signature",
    "vmcp_***.1.signature",
    "vmcp_dXNlci0x.1.***",
    "Bearer vmcp_dXNlci0x.1.signature",
  ])("rejects malformed token %j", async (token) => {
    await expect(verifyMcpToken(SECRET, token)).resolves.toBeNull();
  });

  it("exposes the signed version so callers can reject a version mismatch", async () => {
    const token = await mintMcpToken(SECRET, "user-123", 2);
    const verified = await verifyMcpToken(SECRET, token);

    expect(verified?.version).toBe(2);
    expect(verified?.version).not.toBe(1);
  });
});
