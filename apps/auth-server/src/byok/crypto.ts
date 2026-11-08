export type ByokSealedCredential = { ciphertext: string; iv: string };

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode("vortex/byok-wrap/v1");
const HKDF_INFO = encoder.encode("aes-256-gcm");
const IV_LENGTH = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length < 32) throw new Error("BYOK_ENCRYPTION_SECRET must be at least 32 characters");
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(userId: string, connectionId: string, version: number): Uint8Array {
  return encoder.encode(`${userId}\n${connectionId}\n${version}`);
}

export async function encryptByokCredential(
  secret: string,
  userId: string,
  connectionId: string,
  version: number,
  apiKey: string,
): Promise<ByokSealedCredential> {
  if (!apiKey) throw new Error("api key required");
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(userId, connectionId, version) },
    key,
    encoder.encode(apiKey),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

export async function decryptByokCredential(
  secret: string,
  userId: string,
  connectionId: string,
  version: number,
  sealed: ByokSealedCredential,
): Promise<string> {
  const key = await deriveKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(sealed.iv),
      additionalData: aad(userId, connectionId, version),
    },
    key,
    base64ToBytes(sealed.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
