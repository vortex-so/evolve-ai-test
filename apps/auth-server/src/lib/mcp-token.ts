const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const TOKEN_PATTERN = /^vmcp_([A-Za-z0-9_-]+)\.([1-9][0-9]*)\.([A-Za-z0-9_-]+)$/;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function signedMessage(userId: string, version: number): Uint8Array {
  return encoder.encode(`vmcp|${userId}|${version}`);
}

export async function mintMcpToken(
  secret: string,
  userId: string,
  version: number,
): Promise<string> {
  if (!userId || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("MCP token user and version must be valid");
  }
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret, "sign"),
    signedMessage(userId, version),
  );
  return `vmcp_${encodeBase64Url(encoder.encode(userId))}.${version}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyMcpToken(
  secret: string,
  token: string,
): Promise<{ userId: string; version: number } | null> {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const userPart = match[1];
  const versionPart = match[2];
  const signaturePart = match[3];
  if (!userPart || !versionPart || !signaturePart) return null;

  const userBytes = decodeBase64Url(userPart);
  const signature = decodeBase64Url(signaturePart);
  const version = Number(versionPart);
  if (!userBytes || !signature || signature.length !== 32 || !Number.isSafeInteger(version)) {
    return null;
  }

  let userId: string;
  try {
    userId = decoder.decode(userBytes);
  } catch {
    return null;
  }
  if (!userId || encodeBase64Url(encoder.encode(userId)) !== userPart) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret, "verify"),
    signature,
    signedMessage(userId, version),
  );
  return valid ? { userId, version } : null;
}

export function hasValidMcpTokenSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export async function getMcpTokenVersion(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT version FROM mcp_token_version WHERE user_id = ?")
    .bind(userId)
    .first<{ version: number }>();
  return row?.version ?? 1;
}
