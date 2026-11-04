import { describe, expect, it } from "vitest";

import {
  consentRequiredKeys,
  validateBootstrapConfigHint,
} from "../src/app/dashboard/bootstrap-profiles/bootstrap-config-hint-schema";

describe("validateBootstrapConfigHint", () => {
  it("hint accepts a valid official key (desktopHome)", () => {
    expect(
      validateBootstrapConfigHint({
        inferenceProvider: "gateway",
        desktopHome: "standard",
      }),
    ).toEqual([]);
  });

  it("hint rejects an unknown key with its path", () => {
    const errors = validateBootstrapConfigHint({
      inferenceProvider: "gateway",
      bogusKey: true,
    });

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "bogusKey" })]),
    );
  });

  it("hint rejects nested v2 configs", () => {
    const errors = validateBootstrapConfigHint({
      inference: { provider: "gateway" },
    });

    expect(errors).toEqual([
      { path: "", message: expect.stringMatching(/nested v2/i) },
    ]);
  });
});

describe("consentRequiredKeys", () => {
  it("consentRequiredKeys lists inferenceGatewayBaseUrl and managedMcpServers.0.command", () => {
    const keys = consentRequiredKeys({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://gateway.example.com",
      managedMcpServers: [
        {
          name: "internal",
          transport: "stdio",
          command: "/usr/bin/tool",
        },
      ],
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        "inferenceGatewayBaseUrl",
        "managedMcpServers.0.command",
      ]),
    );
  });

  it("consentRequiredKeys returns [] for non-objects", () => {
    for (const input of [null, undefined, "x", 42, true, []]) {
      expect(consentRequiredKeys(input)).toEqual([]);
    }
  });
});
