// The Backups panel on the platform console's System health page (/platform/system-health): take a backup with
// "Back up now" and see it in the list, with the Backups component turning Operational. IDs refer to
// docs/SCENARIOS.md section 25 (PLT-U05..06).

import { test, expect } from "../../../src/sanity/fixtures";
import type { Page } from "@playwright/test";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../../src/config/env";
import { EMPTY_STORAGE } from "../../../src/ui/session";

test.use({ storageState: EMPTY_STORAGE, baseURL: UI_BASE_URL });
test.describe.configure({ mode: "serial" });

async function openSystemHealth(page: Page) {
	await page.goto("/platform/login");
	await expect(async () => {
		await page.getByLabel(/^Email/).fill(PLATFORM_ADMIN_EMAIL);
		await page.getByLabel(/^Password/).fill(PLATFORM_ADMIN_PASSWORD);
		await expect(page.getByLabel(/^Password/)).toHaveValue(PLATFORM_ADMIN_PASSWORD, { timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/\/platform\/dashboard/);
	await page.goto("/platform/system-health");
	await expect(page.getByRole("heading", { level: 2, name: "Backups" })).toBeVisible();
}

test.describe("PLT-U05 Back up now", () => {
	test("PLT-U05 Back up now writes a backup, says so, and lists it first with all three files", async ({ page }) => {
		await openSystemHealth(page);
		await page.getByRole("button", { name: "Back up now" }).click();
		const done = page.getByRole("alert").filter({ hasText: /^Backup operion-backup-\S+ written/ });
		await expect(done).toBeVisible({ timeout: 60_000 });
		const name = (await done.textContent())!.match(/operion-backup-\S+/)![0];

		const table = page.getByRole("table", { name: "Backups on disk" });
		const first = table.getByRole("row").nth(1);
		await expect(first).toContainText(name);
		await expect(first).toContainText("school.sql.gz, platform.sql.gz, uploads.zip");
		await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
	});

	test("PLT-U05 the button is disabled and reads Backing up… while a backup runs", async ({ page }) => {
		await openSystemHealth(page);
		await page.route("**/api/v1/platform/backups", async (route) => {
			if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
			await route.continue();
		});
		await page.getByRole("button", { name: "Back up now" }).click();
		await expect(page.getByRole("button", { name: "Backing up…" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Back up now" })).toBeEnabled({ timeout: 60_000 });
	});
});

test.describe("PLT-U06 health and warnings", () => {
	test("PLT-U06 after a backup the Backups component reads Operational, and an off schedule is called out", async ({ page }) => {
		await openSystemHealth(page);
		await page.getByRole("button", { name: "Back up now" }).click();
		await expect(page.getByRole("alert").filter({ hasText: /written/ })).toBeVisible({ timeout: 60_000 });
		const component = page.getByText("Backups", { exact: true }).locator("xpath=..").filter({ hasNot: page.getByRole("button") });
		await expect(component).toContainText("Operational");
		// The test stack runs with BACKUP_ENABLED unset, so the panel must warn that nothing runs on its own.
		await expect(page.getByRole("alert").filter({ hasText: /schedule/i })).toBeVisible();
	});

	test("PLT-U06 a failed backup shows the server's reason", async ({ page, diagnostics }) => {
		await openSystemHealth(page);
		await page.route("**/api/v1/platform/backups", (route) =>
			route.request().method() === "POST"
				? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "mysqldump for the school database failed (exit 2): Access denied" }) })
				: route.continue(),
		);
		await page.getByRole("button", { name: "Back up now" }).click();
		await expect(page.getByRole("alert").filter({ hasText: "Access denied" })).toBeVisible();
		// The 500 is the stub above, not a server fault; keep it out of the page-health check.
		diagnostics.failedRequests = diagnostics.failedRequests.filter((r) => !r.includes("/api/v1/platform/backups"));
		diagnostics.consoleErrors = diagnostics.consoleErrors.filter((e) => !/status of 500/.test(e));
	});
});
