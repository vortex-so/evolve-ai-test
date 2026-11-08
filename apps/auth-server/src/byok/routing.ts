export type OdooAliases = { normal: string; test: string };

type AliasEnv = {
  ODOO_MCP_ALIAS?: string;
  ODOO_TEST_MCP_ALIAS?: string;
};

const ALIAS_PATTERN = /^[a-z0-9_-]{1,64}$/;
const PRIVATE_ALIAS_PATTERN = /^odoo_[a-z0-9_]+$/;
const RESERVED_ALIASES = new Set(["meta_ads_mcp", "gsc_mcp", "gdocs_mcp", "gdrive_mcp"]);

function validForRole(alias: string, logical: "odoo" | "odoo_test"): boolean {
  return ALIAS_PATTERN.test(alias)
    && !RESERVED_ALIASES.has(alias)
    && (alias === logical || PRIVATE_ALIAS_PATTERN.test(alias));
}

export function resolveOdooAliases(env: AliasEnv): OdooAliases {
  const normal = env.ODOO_MCP_ALIAS ?? "odoo";
  const test = env.ODOO_TEST_MCP_ALIAS ?? "odoo_test";
  if (
    !validForRole(normal, "odoo")
    || !validForRole(test, "odoo_test")
    || normal === "odoo_test"
    || test === "odoo"
    || normal === test
  ) {
    throw new Error("invalid Odoo MCP alias configuration");
  }
  return { normal, test };
}
