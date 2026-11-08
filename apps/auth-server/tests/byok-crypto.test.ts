import { describe, expect, it } from "vitest";
import { decryptByokCredential, encryptByokCredential } from "../src/byok/crypto";

describe("BYOK credential encryption", () => {
  it("round-trips only with the exact user, connection, and version AAD", async () => {
    const secret = "byok-encryption-secret-with-enough-entropy";
    const sealed = await encryptByokCredential(secret, "user-1", "conn-1", 3, "odoo-api-key");

    await expect(decryptByokCredential(secret, "user-1", "conn-1", 3, sealed)).resolves.toBe("odoo-api-key");
    await expect(decryptByokCredential(secret, "user-2", "conn-1", 3, sealed)).rejects.toThrow();
    await expect(decryptByokCredential(secret, "user-1", "conn-1", 4, sealed)).rejects.toThrow();
  });

  it("fails closed for missing or malformed wrapping secrets", async () => {
    await expect(encryptByokCredential("", "user-1", "conn-1", 1, "key")).rejects.toThrow();
    await expect(encryptByokCredential("short", "user-1", "conn-1", 1, "key")).rejects.toThrow();
  });
});
