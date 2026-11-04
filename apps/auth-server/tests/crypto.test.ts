import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";

const WRAPPING_SECRET = "worker-secret-with-sufficient-entropy";
const USER_ID = "user-123";
const VIRTUAL_KEY = "sk-litellm-sensitive-virtual-key";

describe("secret encryption", () => {
  it("round-trips a secret for the same aad", async () => {
    const sealed = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);

    await expect(decryptSecret(WRAPPING_SECRET, USER_ID, sealed)).resolves.toBe(VIRTUAL_KEY);
  });

  it("uses a fresh IV per call", async () => {
    const first = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);
    const second = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails to decrypt with a different aad", async () => {
    const sealed = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);

    await expect(decryptSecret(WRAPPING_SECRET, "user-456", sealed)).rejects.toThrow();
  });

  it("fails to decrypt with a different secret", async () => {
    const sealed = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);

    await expect(decryptSecret("different-worker-secret", USER_ID, sealed)).rejects.toThrow();
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const sealed = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);
    const decoded = atob(sealed.ciphertext);
    const tampered = String.fromCharCode(decoded.charCodeAt(0) ^ 1) + decoded.slice(1);

    await expect(
      decryptSecret(WRAPPING_SECRET, USER_ID, { ...sealed, ciphertext: btoa(tampered) }),
    ).rejects.toThrow();
  });

  it("rejects empty secret", async () => {
    await expect(encryptSecret("", USER_ID, VIRTUAL_KEY)).rejects.toThrow("secret must not be empty");
  });

  it("ciphertext does not contain the plaintext", async () => {
    const sealed = await encryptSecret(WRAPPING_SECRET, USER_ID, VIRTUAL_KEY);

    expect(atob(sealed.ciphertext)).not.toContain(VIRTUAL_KEY);
  });
});
