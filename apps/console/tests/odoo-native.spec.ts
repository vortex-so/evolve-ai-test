import { expect, test, type Page } from "@playwright/test";

import {
  ODOO_NATIVE_FIXTURE_ORIGIN,
  ODOO_NATIVE_USER_ID,
} from "./odoo-native.playwright.config";

const userPath = `/dashboard/users/${ODOO_NATIVE_USER_ID}`;
const nativePolicy = {
  policyVersion: 2,
  enableWrites: true,
  allowedSideEffectMethods: [
    "res.partner.create",
    "res.partner.unlink",
    "res.partner.write",
  ],
};

type FixtureState = {
  connection: {
    version: number;
    baseUrl: string;
    hasCredential: boolean;
    testedVersion: number | null;
    testStatus: string;
    policy: Record<string, unknown>;
  } | null;
  lastPut: Record<string, unknown> | null;
  requests: Array<{ method: string; path: string; status: number; body: unknown }>;
};

async function resetFixture(page: Page): Promise<void> {
  const response = await page.request.post(`${ODOO_NATIVE_FIXTURE_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBeTruthy();
}

async function fixtureState(page: Page): Promise<FixtureState> {
  const response = await page.request.get(`${ODOO_NATIVE_FIXTURE_ORIGIN}/__fixture__/state`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as FixtureState;
}

async function openByok(page: Page): Promise<void> {
  await page.goto(userPath);
  await page.getByRole("tab", { name: "BYOK" }).click();
  await expect(page.getByText("Odoo connection")).toBeVisible();
}

test.describe("Odoo native controls", () => {
  test.beforeEach(async ({ page }) => {
    await resetFixture(page);
  });

  test("renders native write policy controls and removes legacy policy controls", async ({ page }) => {
    await openByok(page);

    await expect(page.getByLabel("Enable writes (ODOO_MCP_ENABLE_WRITES)")).toBeVisible();
    await expect(page.getByLabel("Allowed side-effect methods")).toBeVisible();
    await expect(page.getByText("Explicit allowed project IDs")).toHaveCount(0);
    await expect(page.getByText(/Writable:/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "BYOK approvals" })).toHaveCount(0);
  });

  test("saves native methods with trimmed, deduplicated, exact newline entries", async ({ page }) => {
    await openByok(page);

    await page.getByLabel("Allowed side-effect methods").fill(
      "  res.partner.write\nres.partner.create\nres.partner.write\nres.partner.unlink  ",
    );
    await page.getByLabel("Enable writes (ODOO_MCP_ENABLE_WRITES)").check();
    await page.getByRole("button", { name: "Save connection" }).click();

    await expect(page.getByText("Odoo connection saved.")).toBeVisible();
    const state = await fixtureState(page);
    expect(state.lastPut).toMatchObject({
      version: 7,
      policy: nativePolicy,
    });
    expect(state.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  });

  test("accepts methods typed key-by-key with Enter between entries", async ({ page }) => {
    await openByok(page);

    const methods = page.getByLabel("Allowed side-effect methods");
    await methods.click();
    await methods.pressSequentially("sale.order.action_confirm");
    await page.keyboard.press("Enter");
    await methods.pressSequentially("account.move.action_post");
    await expect(methods).toHaveValue("sale.order.action_confirm\naccount.move.action_post");
    await page.getByRole("button", { name: "Save connection" }).click();

    await expect(page.getByText("Odoo connection saved.")).toBeVisible();
    const state = await fixtureState(page);
    expect(state.lastPut).toMatchObject({
      policy: {
        policyVersion: 2,
        enableWrites: false,
        allowedSideEffectMethods: ["account.move.action_post", "sale.order.action_confirm"],
      },
    });
  });

  test("defaults native policy to writes off with no preset methods", async ({ page }) => {
    await openByok(page);

    await expect(page.getByLabel("Enable writes (ODOO_MCP_ENABLE_WRITES)")).not.toBeChecked();
    await expect(page.getByLabel("Allowed side-effect methods")).toHaveValue("");
    await expect(page.getByText("res.partner.create")).toHaveCount(0);
    await expect(page.getByText("res.partner.write")).toHaveCount(0);
    await expect(page.getByText("res.partner.unlink")).toHaveCount(0);
  });

  test("keeps connection metadata and clears only the credential on an empty-key save", async ({ page }) => {
    await openByok(page);

    await expect(page.getByLabel("Allowed side-effect methods")).toBeVisible();
    await page.getByRole("button", { name: "Save connection" }).click();
    await expect(page.getByText("Odoo connection saved.")).toBeVisible();

    const state = await fixtureState(page);
    expect(state.connection).toMatchObject({
      baseUrl: "https://erp.vortex.so",
      hasCredential: true,
    });
    expect(state.lastPut).not.toHaveProperty("apiKey");
  });

  test("merges a partial connection response after testing the saved connection", async ({ page }) => {
    await openByok(page);

    await expect(page.getByLabel("Enable writes (ODOO_MCP_ENABLE_WRITES)")).toBeVisible();
    await page.getByRole("button", { name: "Test saved connection" }).click();
    await expect(page.getByText("Odoo connection test passed.")).toBeVisible();
    await expect(page.getByText(/Test: ok/)).toBeVisible();

    const state = await fixtureState(page);
    expect(state.connection).toMatchObject({
      baseUrl: "https://erp.vortex.so",
      testedVersion: 7,
      testStatus: "ok",
    });
  });

  test("rejects invalid exact method names without sending a PUT and reports stale saves", async ({ page }) => {
    await openByok(page);

    const before = await fixtureState(page);
    await page.getByLabel("Allowed side-effect methods").fill("res.partner.bad-name");
    await page.getByLabel("Enable writes (ODOO_MCP_ENABLE_WRITES)").check();
    await page.getByRole("button", { name: "Save connection" }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();

    const afterInvalid = await fixtureState(page);
    expect(afterInvalid.requests.filter((request) => request.method === "PUT")).toHaveLength(0);

    const current = await fixtureState(page);
    const conflict = await page.request.put(
      `${ODOO_NATIVE_FIXTURE_ORIGIN}/admin/users/${ODOO_NATIVE_USER_ID}/byok/odoo`,
      {
        headers: { cookie: "native_fixture_session=true" },
        data: {
          version: current.connection?.version ?? 0,
          database: "fixture-db",
          login: "native-test@example.test",
          enabled: true,
          policy: {
            policyVersion: 2,
            enableWrites: false,
            allowedSideEffectMethods: [],
          },
        },
      },
    );
    expect(conflict.ok()).toBeTruthy();

    await page.getByLabel("Allowed side-effect methods").fill("res.partner.write");
    await page.getByRole("button", { name: "Save connection" }).click();
    await expect(page.getByText("This connection changed elsewhere. Reload before saving or testing.", { exact: true }).first()).toBeVisible();

    const finalState = await fixtureState(page);
    expect(
      finalState.requests.some(
        (request) => request.method === "PUT" && request.status === 409,
      ),
    ).toBeTruthy();
    expect(finalState.lastPut).not.toEqual(before.lastPut);
  });
});
