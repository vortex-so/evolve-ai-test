import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { CONSOLE_ORIGIN, DEFAULT_PASSWORD } from "./constants";
import {
  deleteUserByEmail,
  demoteToUser,
  markUserVerified,
  promoteToAdmin,
  selectUser,
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
  adminRequest?: APIRequestContext,
): Promise<{ email: string; password: string; id: string }> {
  const email = uniqueEmail(input.prefix);
  const password = input.password ?? DEFAULT_PASSWORD;
  const name = input.name ?? "E2E User";
  let id: string;

  if (adminRequest) {
    const response = await adminRequest.post(`${CONSOLE_ORIGIN}/api/admin/users`, {
      headers: { Origin: CONSOLE_ORIGIN },
      data: { email, password, name, role: input.role ?? "user" },
    });
    if (!response.ok()) {
      throw new Error(
        `admin user creation failed for ${email}: ${response.status()} ${await response.text()}`,
      );
    }
    const created = await selectUser(request, email);
    if (typeof created?.id !== "string") {
      throw new Error(`admin user creation did not persist ${email}`);
    }
    id = created.id;
  } else {
    ({ id } = await signUpViaApi(context, { email, password, name }));
  }
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
  await deleteUserByEmail(request, email);
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
