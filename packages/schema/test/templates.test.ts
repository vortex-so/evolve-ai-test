import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const templatesDir = resolve(repoRoot, "docs/templates");
const bootstrapUrl = "https://api.auth-dev.vortex.so/user/bootstrap";

function readTemplate(name: string) {
  return readFileSync(resolve(templatesDir, name), "utf8");
}

describe("Claude Desktop deployment templates", () => {
  it("import-config.json has only device keys and no trustBootstrapDelivery", () => {
    const config = JSON.parse(readTemplate("import-config.json"));

    expect(config).toEqual({
      bootstrapUrl,
      deploymentMode: "3p",
      disableDeploymentModeChooser: true,
    });
    expect(config).not.toHaveProperty("trustBootstrapDelivery");
  });

  it("linux managed-settings.json uses JSON booleans", () => {
    const config = JSON.parse(readTemplate("linux-managed-settings.json"));

    expect(config).toEqual({
      bootstrapUrl,
      deploymentMode: "3p",
      disableDeploymentModeChooser: true,
    });
    expect(typeof config.disableDeploymentModeChooser).toBe("boolean");
  });

  it("windows .reg targets HKLM\\SOFTWARE\\Policies\\Claude with string values and CRLF", () => {
    const registry = readTemplate("windows-claude-3p.reg");

    expect(registry).toMatch(
      /^Windows Registry Editor Version 5\.00\r\n\r\n\[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude\]\r\n/,
    );
    expect(registry).toContain(`"bootstrapUrl"="${bootstrapUrl}"`);
    expect(registry).toContain('"deploymentMode"="3p"');
    expect(registry).toContain('"disableDeploymentModeChooser"="true"');
    expect(registry).not.toMatch(/(?<!\r)\n/);
  });

  it("macOS mobileconfig nests com.anthropic.claudefordesktop > Forced > mcx_preference_settings with string values", () => {
    const profile = readTemplate("macos-claude-3p.mobileconfig");
    const managedPreferences = profile.match(
      /<key>com\.anthropic\.claudefordesktop<\/key>\s*<dict>\s*<key>Forced<\/key>\s*<array>\s*<dict>\s*<key>mcx_preference_settings<\/key>\s*<dict>([\s\S]*?)<\/dict>\s*<\/dict>\s*<\/array>\s*<\/dict>/,
    );

    expect(profile).toContain(
      "<string>com.apple.ManagedClient.preferences</string>",
    );
    expect(managedPreferences).not.toBeNull();
    const settings = managedPreferences?.[1] ?? "";
    expect(settings).toMatch(
      new RegExp(
        `<key>bootstrapUrl</key>\\s*<string>${bootstrapUrl}</string>`,
      ),
    );
    expect(settings).toMatch(
      /<key>deploymentMode<\/key>\s*<string>3p<\/string>/,
    );
    expect(settings).toMatch(
      /<key>disableDeploymentModeChooser<\/key>\s*<string>true<\/string>/,
    );
    expect(settings).not.toContain("<true/>");
  });

  it("all templates point at the same bootstrapUrl ending in /user/bootstrap", () => {
    const templates = [
      "import-config.json",
      "linux-managed-settings.json",
      "windows-claude-3p.reg",
      "macos-claude-3p.mobileconfig",
    ].map(readTemplate);

    for (const template of templates) {
      expect(template).toContain(bootstrapUrl);
      expect(bootstrapUrl).toMatch(/\/user\/bootstrap$/);
    }
  });
});
