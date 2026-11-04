import { expect, type BrowserContext, type Page } from "@playwright/test";
import { AUTH_API_ORIGIN, AUTH_ORIGIN } from "./constants";

export async function signInViaApi(
  context: BrowserContext,
  email: string,
  password: string,
  attempts = 6,
): Promise<void> {
  let lastStatus = 0;
  let lastBody = "";
  for (let i = 0; i < attempts; i++) {
    const res = await context.request.post(
      `${AUTH_API_ORIGIN}/api/auth/sign-in/email`,
      {
        headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
        data: { email, password },
        timeout: 30_000,
      },
    );
    lastStatus = res.status();
    if (res.ok()) return;
    lastBody = await res.text();
    if (lastStatus === 429) {
      await new Promise((r) => setTimeout(r, 15_000 + i * 5_000));
      continue;
    }
    break;
  }
  throw new Error(
    `sign-in via API failed for ${email}: ${lastStatus} ${lastBody}`,
  );
}

export async function signUpViaApi(
  context: BrowserContext,
  input: { email: string; password: string; name: string },
): Promise<{ id: string }> {
  const res = await context.request.post(
    `${AUTH_API_ORIGIN}/api/auth/sign-up/email`,
    {
      headers: {
        Origin: AUTH_ORIGIN,
        "Content-Type": "application/json",
      },
      data: input,
    },
  );
  if (!res.ok()) {
    throw new Error(
      `sign-up via API failed for ${input.email}: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { user?: { id?: string } };
  const id = body.user?.id;
  if (!id) {
    throw new Error(`sign-up response missing user.id: ${JSON.stringify(body)}`);
  }
  return { id };
}

export async function signInViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("textbox", { name: /password/i }).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

export async function signOutViaButton(page: Page): Promise<void> {
  await page.getByRole("button", { name: /sign out/i }).click();
}

export async function currentSession(
  context: BrowserContext,
): Promise<Record<string, unknown> | null> {
  const res = await context.request.get(
    `${AUTH_API_ORIGIN}/api/auth/get-session`,
    {
      headers: { Origin: AUTH_ORIGIN },
    },
  );
  const text = await res.text();
  if (text === "null" || !text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function expectSignedIn(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  const session = await currentSession(context);
  expect(session, "expected a valid session but got null").not.toBeNull();
}
