import type { APIRequestContext } from "@playwright/test";
import {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  D1_DATABASE_ID,
} from "./constants";

const D1_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;

export function requireD1Token(): string {
  if (!CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "PLAYWRIGHT_CF_TOKEN required for D1 mutation tests. Skip or set the env var.",
    );
  }
  return CLOUDFLARE_API_TOKEN;
}

export async function d1Exec(
  request: APIRequestContext,
  sql: string,
  params: Array<string | number | null> = [],
): Promise<Array<Record<string, unknown>>> {
  const token = requireD1Token();
  const res = await request.post(D1_QUERY_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: { sql, params },
  });
  if (!res.ok()) {
    throw new Error(`D1 query failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    result: Array<{ results: Array<Record<string, unknown>>; success: boolean }>;
    success: boolean;
    errors?: Array<{ message: string }>;
  };
  if (!body.success) {
    throw new Error(`D1 error: ${JSON.stringify(body.errors)}`);
  }
  return body.result?.[0]?.results ?? [];
}

export async function markUserVerified(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await d1Exec(request, "UPDATE user SET emailVerified = 1 WHERE email = ?", [
    email,
  ]);
}

export async function promoteToAdmin(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await d1Exec(request, "UPDATE user SET role = 'admin' WHERE email = ?", [
    email,
  ]);
}

export async function demoteToUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await d1Exec(request, "UPDATE user SET role = 'user' WHERE email = ?", [
    email,
  ]);
}

export async function deleteUserByEmail(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await d1Exec(request, "DELETE FROM user WHERE email = ?", [email]);
}

export async function selectUser(
  request: APIRequestContext,
  email: string,
): Promise<Record<string, unknown> | null> {
  const rows = await d1Exec(
    request,
    "SELECT id, email, role, banned, banReason, emailVerified FROM user WHERE email = ?",
    [email],
  );
  return rows[0] ?? null;
}

export async function seedDeviceCode(
  request: APIRequestContext,
  input: {
    id: string;
    deviceCode: string;
    userCode: string;
    clientId: string;
    expiresAtMs: number;
    createdAtMs: number;
  },
): Promise<void> {
  await d1Exec(
    request,
    `INSERT INTO deviceCode (id, deviceCode, userCode, expiresAt, status, clientId, scope, createdAt)
     VALUES (?, ?, ?, ?, 'pending', ?, 'openid', ?)`,
    [
      input.id,
      input.deviceCode,
      input.userCode,
      String(new Date(input.expiresAtMs).toISOString()),
      input.clientId,
      input.createdAtMs,
    ],
  );
}
