// Wraps per-user LiteLLM virtual keys for D1 storage; rotation is handled by re-provisioning,
// while the caller records the wrapping-key version in a separate column.

export type SealedSecret = { ciphertext: string; iv: string };

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode("vortex/litellm-key-wrap/v1");
const HKDF_INFO = encoder.encode("aes-256-gcm");
const IV_LENGTH = 12;

function assertSecret(secret: string): void {
  if (secret.length === 0) {
    throw new Error("secret must not be empty");
  }
}

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  assertSecret(secret);

  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: HKDF_INFO,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function encryptSecret(
  secret: string,
  aad: string,
  plaintext: string,
): Promise<SealedSecret> {
  const key = await deriveEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
  };
}

export async function decryptSecret(
  secret: string,
  aad: string,
  sealed: SealedSecret,
): Promise<string> {
  const key = await deriveEncryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(sealed.iv),
      additionalData: encoder.encode(aad),
    },
    key,
    decodeBase64(sealed.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}
