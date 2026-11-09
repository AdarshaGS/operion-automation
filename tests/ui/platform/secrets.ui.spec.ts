// The Secrets panel on the platform console's System health page. The test stack runs on development defaults, so
// the panel must list them by variable name and explain that production would refuse to start. IDs refer to
// docs/SCENARIOS.md section 25 (PLT-U07).

import { test, expect } from "../../../src/sanity/fixtures";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../../src/config/env";
import { EMPTY_STORAGE } from "../../../src/ui/session";

test.use({ storageState: EMPTY_STORAGE, baseURL: UI_BASE_URL });

test.describe("PLT-U07 Secrets panel", () => {
	test("PLT-U07 System health lists the secrets still at their defaults, by name only, with the production warning", async ({ page }) => {
		await page.goto("/platform/login");
		await expect(async () => {
			await page.getByLabel(/^Email/).fill(PLATFORM_ADMIN_EMAIL);
			await page.getByLabel(/^Password/).fill(PLATFORM_ADMIN_PASSWORD);
			await expect(page.getByLabel(/^Password/)).toHaveValue(PLATFORM_ADMIN_PASSWORD, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await page.getByRole("button", { name: "Sign in" }).click();
		await expect(page).toHaveURL(/\/platform\/dashboard/);
		await page.goto("/platform/system-health");

		await expect(page.getByRole("heading", { level: 2, name: "Secrets" })).toBeVisible();
		await expect(page.getByText(/^\d+ to fix$/)).toBeVisible();
		await expect(page.getByText(/refuses to start until these are set/)).toBeVisible();
		const table = page.getByRole("table", { name: "Secrets to set" });
		for (const setting of ["JWT_SECRET", "PLATFORM_JWT_SECRET", "INTEGRATION_SECRET_KEY", "REPORTING_DB_PASSWORD", "PLATFORM_ADMIN_PASSWORD"]) {
			await expect(table.getByRole("row").filter({ hasText: setting }).first()).toBeVisible();
		}
		await expect(table).not.toContainText("dev-only");

		const secretsComponent = page.getByText("Secrets", { exact: true }).locator("xpath=..").filter({ has: page.getByText("Down", { exact: true }) });
		await expect(secretsComponent).toBeVisible();
	});
});
