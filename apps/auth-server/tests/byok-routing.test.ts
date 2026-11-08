import { describe, expect, it } from "vitest";
import { resolveOdooAliases } from "../src/byok/routing";

describe("Odoo MCP transport aliases", () => {
  it("uses logical defaults when aliases are omitted", () => {
    expect(resolveOdooAliases({})).toEqual({ normal: "odoo", test: "odoo_test" });
  });

  it("accepts distinct lower-case Odoo-prefixed transport aliases", () => {
    expect(resolveOdooAliases({
      ODOO_MCP_ALIAS: "odoo_prod",
      ODOO_TEST_MCP_ALIAS: "odoo_prod_test",
    })).toEqual({ normal: "odoo_prod", test: "odoo_prod_test" });
  });

  it.each([
    { ODOO_MCP_ALIAS: "Odoo_prod" },
    { ODOO_MCP_ALIAS: "odoo-prod" },
    { ODOO_MCP_ALIAS: "meta_ads_mcp" },
    { ODOO_MCP_ALIAS: "odoo_test" },
    { ODOO_TEST_MCP_ALIAS: "odoo" },
    { ODOO_MCP_ALIAS: "odoo_same", ODOO_TEST_MCP_ALIAS: "odoo_same" },
    { ODOO_TEST_MCP_ALIAS: "gdrive_mcp" },
  ])("rejects malformed, reserved, logical-crossed, or duplicate aliases %#", (env) => {
    expect(() => resolveOdooAliases(env)).toThrow();
  });
});
