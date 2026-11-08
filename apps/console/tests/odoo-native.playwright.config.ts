import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type FixtureMode = "legacy" | "native";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const consoleRoot = path.resolve(testsDir, "..");

function readFixtureMode(value: string | undefined): FixtureMode {
  if (!value || value === "legacy") return "legacy";
  if (value === "native") return "native";
  throw new Error(`ODOO_NATIVE_FIXTURE_MODE must be legacy or native, received ${value}`);
}

export const ODOO_NATIVE_FIXTURE_MODE = readFixtureMode(
  process.env.ODOO_NATIVE_FIXTURE_MODE,
);
export const ODOO_NATIVE_CONSOLE_ORIGIN = "http://localhost:3001";
export const ODOO_NATIVE_FIXTURE_ORIGIN = "http://127.0.0.1:4011";
export const ODOO_NATIVE_USER_ID = "native-test-user";
export const ODOO_NATIVE_ARTIFACT_DIR =
  process.env.ODOO_NATIVE_ARTIFACT_DIR ??
  path.join(
    "/tmp/opencode/odoo-native-qa",
    ODOO_NATIVE_FIXTURE_MODE === "legacy" ? "red" : "green",
  );
export const ODOO_NATIVE_ACTION_LOG = path.join(
  ODOO_NATIVE_ARTIFACT_DIR,
  "action-log.jsonl",
);
export const ODOO_NATIVE_SURFACES_DIR = path.join(
  ODOO_NATIVE_ARTIFACT_DIR,
  "surfaces",
);
export const ODOO_NATIVE_PIXEL_DIFF_DIR = path.join(
  ODOO_NATIVE_ARTIFACT_DIR,
  "pixel-diff",
);

mkdirSync(ODOO_NATIVE_ARTIFACT_DIR, { recursive: true });
mkdirSync(ODOO_NATIVE_SURFACES_DIR, { recursive: true });
mkdirSync(ODOO_NATIVE_PIXEL_DIFF_DIR, { recursive: true });

const storageState = {
  cookies: [
    {
      name: "better-auth.session_token",
      value: "fixture-session",
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    },
    {
      name: "native_fixture_session",
      value: "true",
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
};

export default defineConfig({
  testDir: testsDir,
  testMatch: "odoo-native.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(ODOO_NATIVE_ARTIFACT_DIR, "playwright"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ODOO_NATIVE_ARTIFACT_DIR, "playwright-report.json") }],
  ],
  use: {
    baseURL: ODOO_NATIVE_CONSOLE_ORIGIN,
    storageState,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  webServer: [
    {
      name: "odoo-native-auth-fixture",
      command: "node --experimental-strip-types tests/fixtures/odoo-native-http.ts",
      cwd: consoleRoot,
      url: `${ODOO_NATIVE_FIXTURE_ORIGIN}/__fixture__/health`,
      env: {
        ...process.env,
        ODOO_NATIVE_FIXTURE_MODE,
        ODOO_NATIVE_ACTION_LOG,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "odoo-native-console",
      command: "pnpm exec next dev --hostname :: --port 3001",
      cwd: consoleRoot,
      url: `${ODOO_NATIVE_CONSOLE_ORIGIN}/403`,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_AUTH_API_URL: ODOO_NATIVE_FIXTURE_ORIGIN,
        NEXT_PUBLIC_AUTH_WEB_URL: ODOO_NATIVE_CONSOLE_ORIGIN,
        NEXT_PUBLIC_CONSOLE_URL: ODOO_NATIVE_CONSOLE_ORIGIN,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
