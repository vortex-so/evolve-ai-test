import { describe, expect, it } from "vitest";
import {
  type SecretConfig,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto";
import { createAuth } from "../src/auth";
import { createTestEnv } from "./_helpers/test-app";

const PREVIOUS_SECRET = "previous-secret-previous-secret-1234";
const CURRENT_SECRET = "current-secret-current-secret-567890";
const INSECURE_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

describe("Better Auth secret configuration", () => {
  it("rejects an empty secret outside tests", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "",
      }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters outside tests");
  });

  it("rejects a short secret outside tests", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "too-short",
      }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters outside tests");
  });

  it("rejects Better Auth's public default secret outside tests", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: INSECURE_DEFAULT_SECRET,
      }),
    ).toThrow("BETTER_AUTH_SECRET must not use Better Auth's public default");
  });

  it("rejects an invalid previous secret outside tests", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: CURRENT_SECRET,
        BETTER_AUTH_SECRET_PREVIOUS: "too-short",
      }),
    ).toThrow("BETTER_AUTH_SECRET_PREVIOUS must be at least 32 characters when set");
  });

  it("rejects the public default as a previous secret", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: CURRENT_SECRET,
        BETTER_AUTH_SECRET_PREVIOUS: INSECURE_DEFAULT_SECRET,
      }),
    ).toThrow("BETTER_AUTH_SECRET_PREVIOUS cannot preserve Better Auth's public default");
  });

  it("rejects duplicate current and previous secrets", () => {
    const { env } = createTestEnv();

    expect(() =>
      createAuth({
        ...env,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: CURRENT_SECRET,
        BETTER_AUTH_SECRET_PREVIOUS: CURRENT_SECRET,
      }),
    ).toThrow("BETTER_AUTH_SECRET_PREVIOUS must differ from BETTER_AUTH_SECRET");
  });

  it("decrypts legacy data with the previous secret after rotation", async () => {
    const legacyCiphertext = await symmetricEncrypt({
      key: PREVIOUS_SECRET,
      data: "persisted-private-key",
    });
    const { env } = createTestEnv();
    const auth = createAuth({
      ...env,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: CURRENT_SECRET,
      BETTER_AUTH_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    const context = await auth.$context;

    await expect(
      symmetricDecrypt({
        key: context.secretConfig,
        data: legacyCiphertext,
      }),
    ).resolves.toBe("persisted-private-key");

    const previousKeyConfig: SecretConfig = {
      keys: new Map([[1, PREVIOUS_SECRET]]),
      currentVersion: 1,
    };
    const previousVersionCiphertext = await symmetricEncrypt({
      key: previousKeyConfig,
      data: "versioned-private-key",
    });
    await expect(
      symmetricDecrypt({
        key: context.secretConfig,
        data: previousVersionCiphertext,
      }),
    ).resolves.toBe("versioned-private-key");

    const currentCiphertext = await symmetricEncrypt({
      key: context.secretConfig,
      data: "new-private-key",
    });
    expect(currentCiphertext).toMatch(/^\$ba\$2\$/);
  });
});
