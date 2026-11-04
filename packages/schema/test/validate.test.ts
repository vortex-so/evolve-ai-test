import { describe, expect, it } from "vitest";

import vendoredSchema from "../schemas/bootstrap-config-v1.schema.json";
import {
  consentRequiredPaths,
  validateBootstrapConfig,
} from "../src/validate";

function validationErrors(input: unknown) {
  const result = validateBootstrapConfig(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected validation to fail");
  }
  return result.errors;
}

describe("validateBootstrapConfig", () => {
  it("accepts a minimal flat gateway config", () => {
    const config = { inferenceProvider: "gateway", $schemaVersion: 1 };

    expect(validateBootstrapConfig(config)).toEqual({ ok: true, data: config });
  });

  it("accepts a rich valid profile", () => {
    const config = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://api.example.com",
      inferenceCredentialKind: "interactive",
      inferenceGatewayAuthScheme: "bearer",
      inferenceModels: [
        {
          name: "claude-sonnet-5",
          anthropicFamilyTier: "sonnet",
          isFamilyDefault: true,
          maxEffort: "high",
        },
        "claude-haiku-4-5",
      ],
      configRecheckIntervalMinutes: 10,
      desktopHome: "standard",
      banner: { enabled: true, text: "Managed by Vortex" },
      managedMcpServers: [
        {
          name: "internal-tools",
          transport: "http",
          url: "https://mcp.example.com/mcp",
        },
      ],
      otlpResourceAttributes: { "user.id": "u1" },
      expiresAt: 1778700000,
    };

    expect(validateBootstrapConfig(config)).toEqual({ ok: true, data: config });
  });

  it("accepts legacy $schema pointer", () => {
    const config = {
      inferenceProvider: "gateway",
      $schema:
        "https://claude.com/docs/third-party/claude-desktop/schemas/bootstrap-config-v2.schema.json",
    };

    expect(validateBootstrapConfig(config)).toEqual({ ok: true, data: config });
  });

  it("rejects unknown root key", () => {
    const errors = validationErrors({
      inferenceProvider: "gateway",
      bogusKey: true,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "bogusKey" }),
      ]),
    );
  });

  it("rejects out-of-range integer with leaf path", () => {
    const errors = validationErrors({
      inferenceProvider: "gateway",
      configRecheckIntervalMinutes: 99,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "configRecheckIntervalMinutes" }),
      ]),
    );
  });

  it("rejects bad enum deep in array with leaf path", () => {
    const errors = validationErrors({
      inferenceProvider: "gateway",
      inferenceModels: [{ name: "alias", maxEffort: "ultra" }],
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "inferenceModels.0.maxEffort" }),
      ]),
    );
    expect(errors.some((error) => error.path === "inferenceModels")).toBe(false);
  });

  it("rejects nested v2 format", () => {
    for (const config of [
      { inferenceProvider: "gateway", $schemaVersion: 2 },
      { inference: { provider: "gateway" } },
    ]) {
      const errors = validationErrors(config);
      expect(errors).toEqual([
        { path: "", message: expect.stringMatching(/nested v2/i) },
      ]);
    }
  });

  it("requires inferenceProvider", () => {
    const errors = validationErrors({});

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "inferenceProvider" }),
      ]),
    );
  });

  it("rejects non-object input", () => {
    for (const input of [null, [], "x"]) {
      expect(validateBootstrapConfig(input)).toEqual({
        ok: false,
        errors: [{ path: "", message: "Config must be a JSON object" }],
      });
    }
  });
});

describe("consentRequiredPaths", () => {
  it("consentRequiredPaths finds top-level and nested paths", () => {
    const config = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://x.example",
      managedMcpServers: [
        {
          name: "a",
          transport: "stdio",
          command: "/usr/bin/a",
          args: ["x"],
        },
        {
          name: "b",
          transport: "http",
          url: "https://b.example/mcp",
        },
      ],
    };

    expect(consentRequiredPaths(config)).toEqual([
      "inferenceGatewayBaseUrl",
      "managedMcpServers.0.args",
      "managedMcpServers.0.command",
    ]);
  });

  it("consentRequiredPaths returns [] for a config without consent keys", () => {
    expect(
      consentRequiredPaths({
        inferenceProvider: "gateway",
        configRecheckIntervalMinutes: 10,
      }),
    ).toEqual([]);
  });
});

it("vendored schema has the expected shape", () => {
  const properties = vendoredSchema.definitions.BootstrapConfig.properties;

  expect(Object.keys(properties).length).toBeGreaterThanOrEqual(140);
  expect(properties).toHaveProperty("inferenceGatewayBaseUrl");
  expect(properties).toHaveProperty("managedMcpServers");
  expect(properties).toHaveProperty("desktopHome");
});
