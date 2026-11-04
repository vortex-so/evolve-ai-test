import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { DEFAULT_PASSWORD } from "./constants";
import {
  deleteUserByEmail,
  demoteToUser,
  markUserVerified,
  promoteToAdmin,
} from "./d1";
import { signUpViaApi } from "./auth";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@evolveai.dev`;
}

export async function createVerifiedUser(
  context: BrowserContext,
  request: APIRequestContext,
  input: {
    prefix: string;
    role?: "user" | "admin";
    password?: string;
    name?: string;
  },
): Promise<{ email: string; password: string; id: string }> {
  const email = uniqueEmail(input.prefix);
  const password = input.password ?? DEFAULT_PASSWORD;
  const { id } = await signUpViaApi(context, {
    email,
    password,
    name: input.name ?? "E2E User",
  });
  await markUserVerified(request, email);
  if (input.role === "admin") {
    await promoteToAdmin(request, email);
  }
  return { email, password, id };
}

export async function cleanupUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  try {
    await deleteUserByEmail(request, email);
  } catch {}
}

export async function resetUserRoleToUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await demoteToUser(request, email);
}

export function expectHttpOk(status: number, path: string): void {
  expect(status, `${path} must be < 500`).toBeLessThan(500);
}
