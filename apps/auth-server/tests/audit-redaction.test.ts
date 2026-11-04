import { describe, expect, it } from "vitest";
import { redactAuditValue } from "../src/lib/audit";

describe("audit credential redaction", () => {
  it("redacts a top-level newPassword value", () => {
    expect(redactAuditValue({ newPassword: "plain-text-password" })).toEqual({
      newPassword: "[REDACTED]",
    });
  });

  it("redacts sensitive values in nested objects", () => {
    expect(
      redactAuditValue({
        user: {
          credentials: {
            clientSecret: "client-secret-value",
          },
        },
      }),
    ).toEqual({
      user: {
        credentials: {
          clientSecret: "[REDACTED]",
        },
      },
    });
  });

  it("redacts sensitive values inside arrays", () => {
    expect(
      redactAuditValue({
        attempts: [
          { otp: "123456" },
          { api_key: "api-key-value" },
          { label: "preserved" },
        ],
      }),
    ).toEqual({
      attempts: [
        { otp: "[REDACTED]" },
        { api_key: "[REDACTED]" },
        { label: "preserved" },
      ],
    });
  });

  it("matches sensitive keys case-insensitively", () => {
    expect(
      redactAuditValue({
        PASSWORD: "password-value",
        Authorization: "Bearer credential",
        PRIVATE_KEY: "private-key-value",
      }),
    ).toEqual({
      PASSWORD: "[REDACTED]",
      Authorization: "[REDACTED]",
      PRIVATE_KEY: "[REDACTED]",
    });
  });

  it("preserves non-sensitive keys and allowlisted endpoint metadata", () => {
    expect(
      redactAuditValue({
        userId: "user-id",
        role: "admin",
        token_endpoint: "https://issuer.example.test/oauth/token",
      }),
    ).toEqual({
      userId: "user-id",
      role: "admin",
      token_endpoint: "https://issuer.example.test/oauth/token",
    });
  });

  it.each([undefined, null, "text", 42, true])(
    "leaves non-object input unchanged: %s",
    (value) => {
      expect(redactAuditValue(value)).toBe(value);
    },
  );
});
