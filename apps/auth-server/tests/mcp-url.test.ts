import { describe, expect, it } from "vitest";
import { parseGatewayMcpUrl } from "../src/lib/mcp-url";

const ORIGIN = "https://api.auth-dev.vortex.so";

describe("parseGatewayMcpUrl", () => {
  it("accepts only the exact canonical gateway URL", () => {
    expect(parseGatewayMcpUrl(`${ORIGIN}/ignored`, `${ORIGIN}/mcp/meta_ads_mcp`)).toBe(
      "meta_ads_mcp",
    );
  });

  it.each([
    `${ORIGIN}/mcp/%2e%2e/device`,
    `${ORIGIN}/mcp/../device`,
    `${ORIGIN}/mcp/x/`,
    `${ORIGIN}/mcp//x`,
    `${ORIGIN}/mcp/x?y=1`,
    `${ORIGIN}/mcp/x#f`,
    "https://api.auth-dev.vortex.so.evil.com/mcp/x",
    "https://user@api.auth-dev.vortex.so/mcp/x",
    `${ORIGIN}/MCP/x`,
    `${ORIGIN}\\mcp\\x`,
    `${ORIGIN}/mcp/a%2Fb`,
  ])("rejects non-canonical URL %s", (rawUrl) => {
    expect(parseGatewayMcpUrl(ORIGIN, rawUrl)).toBeNull();
  });
});
