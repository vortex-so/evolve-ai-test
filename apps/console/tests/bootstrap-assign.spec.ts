import { expect, test, type Locator, type Page } from "@playwright/test";

import { ODOO_NATIVE_FIXTURE_ORIGIN } from "./odoo-native.playwright.config";

type FixtureState = {
  assignments: Record<string, string>;
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

function profileRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}

async function openAssignDialog(page: Page, profileName: string): Promise<Locator> {
  await page.goto("/dashboard/bootstrap-profiles");
  const row = profileRow(page, profileName);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await page.getByRole("menuitem", { name: "Assign users" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Bootstrap profile assignment", () => {
  test.beforeEach(async ({ page }) => {
    await resetFixture(page);
  });

  test("assigns several users picked by name without typing user IDs", async ({ page }) => {
    const dialog = await openAssignDialog(page, "marketing");
    await expect(dialog.getByLabel("User ID")).toHaveCount(0);

    const search = dialog.getByPlaceholder("Search by name or email");
    await search.fill("alice");
    await expect(dialog.getByRole("checkbox", { name: "Native Test User" })).toHaveCount(0);
    await dialog.getByRole("checkbox", { name: "Alice Marketing" }).check();

    await search.fill("");
    await dialog.getByRole("checkbox", { name: "Native Test User" }).check();
    await expect(dialog.getByRole("checkbox", { name: "Alice Marketing" })).toBeChecked();

    await dialog.getByRole("button", { name: "Assign 2 users" }).click();
    await expect(page.getByText("Assigned 2 users to marketing.")).toBeVisible();
    await expect(dialog).toBeHidden();

    const state = await fixtureState(page);
    expect(state.assignments).toEqual({
      "user-alice": "marketing-prod",
      "native-test-user": "marketing-prod",
      "user-bob": "marketing-prod",
    });
    const puts = state.requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.path).sort()).toEqual([
      "/admin/bootstrap/assignments/native-test-user",
      "/admin/bootstrap/assignments/user-alice",
    ]);
    await expect(profileRow(page, "marketing").getByRole("cell").nth(4)).toHaveText("3");
  });

  test("shows each user's current profile and locks users already in this profile", async ({ page }) => {
    const dialog = await openAssignDialog(page, "marketing");

    const bob = dialog.getByRole("checkbox", { name: "Bob Sales" });
    await expect(bob).toBeDisabled();
    await expect(dialog.getByText("Already in marketing")).toBeVisible();
    await expect(dialog.getByText("No profile").first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Assign \d+ users?/ })).toBeDisabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    const cowork = await openAssignDialog(page, "cowork-user");
    await expect(cowork.getByRole("checkbox", { name: "Bob Sales" })).toBeEnabled();
    await expect(cowork.getByText("marketing", { exact: true })).toBeVisible();
  });

  test("keeps failed users selected and reports a partial failure", async ({ page }) => {
    const dialog = await openAssignDialog(page, "marketing");
    await dialog.getByRole("checkbox", { name: "Alice Marketing" }).check();
    await dialog.getByRole("checkbox", { name: "Carol Locked" }).check();
    await dialog.getByRole("button", { name: "Assign 2 users" }).click();

    await expect(page.getByText(/Assigned 1 of 2 users\. Failed: Carol Locked/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Carol Locked" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Alice Marketing" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Assign 1 user" })).toBeEnabled();

    const state = await fixtureState(page);
    expect(state.assignments["user-alice"]).toBe("marketing-prod");
    expect(state.assignments["user-carol"]).toBeUndefined();
  });
});
