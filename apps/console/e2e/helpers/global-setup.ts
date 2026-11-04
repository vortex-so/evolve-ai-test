import { chromium, request as apiRequest } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  AUTH_API_ORIGIN,
  AUTH_ORIGIN,
} from "./constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ADMIN_STATE_PATH = path.join(__dirname, "..", ".auth", "admin.json");

async function signInWithRetry(context: import("@playwright/test").APIRequestContext) {
  let lastErr = "";
  for (let i = 0; i < 8; i++) {
    const res = await context.post(`${AUTH_API_ORIGIN}/api/auth/sign-in/email`, {
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      timeout: 30_000,
    });
    if (res.ok()) return;
    lastErr = `${res.status()} ${await res.text()}`;
    if (res.status() === 429) {
      await new Promise((r) => setTimeout(r, 20_000 + i * 5_000));
      continue;
    }
    break;
  }
  throw new Error(`global-setup admin sign-in failed: ${lastErr}`);
}

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const req = await apiRequest.newContext();

  await signInWithRetry(req);
  const cookies = await req.storageState();
  await context.addCookies(cookies.cookies);
  await context.storageState({ path: ADMIN_STATE_PATH });

  await req.dispose();
  await context.close();
  await browser.close();
  console.log(`[global-setup] admin storage state written to ${ADMIN_STATE_PATH}`);
}
