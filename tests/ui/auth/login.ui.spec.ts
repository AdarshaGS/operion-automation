import { test, expect } from "../../../src/ui/fixtures";

test("signing in with valid credentials reaches the dashboard", async ({ page, loginPage, seed }) => {
	await loginPage.open();
	await loginPage.login(seed.organisationSlug, seed.ownerEmail, seed.ownerPassword);
	await expect(page).toHaveURL(/\/dashboard/);
});

test("signing in with a wrong password shows an error and stays on the login page", async ({ page, loginPage, seed }) => {
	await loginPage.open();
	await loginPage.login(seed.organisationSlug, seed.ownerEmail, "definitely-wrong-password");
	await expect(loginPage.errorAlert()).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});

test("visiting a protected page while signed out redirects to the login page", async ({ page }) => {
	await page.goto("/students");
	await expect(page).toHaveURL(/\/login/);
});
