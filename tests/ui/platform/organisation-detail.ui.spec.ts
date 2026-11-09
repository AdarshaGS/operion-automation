// The platform console's organisation page (/platform/organisations/:id) and the shared shell around it after the
// dashboard redesign: light-by-default theme, compact account control, icon-rail sidebar on narrow screens, and the
// cards on the page (header, Features/Integrations toggle tiles, Contacts/Follow-ups/Activity). Every test provisions
// its own throwaway organisation through the API and signs in to the platform console through the UI.

import { test, expect } from "../../../src/sanity/fixtures";
import type { Page } from "@playwright/test";
import { API_BASE_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../../src/config/env";
import { provisionOrganisation } from "../../../src/setup/provisioning";
import { EMPTY_STORAGE } from "../../../src/ui/session";

test.use({ storageState: EMPTY_STORAGE, baseURL: UI_BASE_URL });

async function platformToken(): Promise<string> {
	const response = await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
	});
	return ((await response.json()) as { token: string }).token;
}

async function platformGet<T>(path: string, token: string): Promise<T> {
	const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
	return (await response.json()) as T;
}

/** A new organisation, and a page signed in to the platform console on its detail screen. */
async function openOrganisation(page: Page) {
	const slug = `plat-ui-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
	const name = `Platform UI ${slug}`;
	const org = await provisionOrganisation({ name, legalName: `${name} Trust`, slug, adminEmail: `owner@${slug}.test`, adminPassword: "Passw0rd!Passw0rd", adminFirstName: "Pat", adminLastName: "Lee" });
	await page.goto("/platform/login");
	await expect(async () => {
		await page.getByLabel(/^Email/).fill(PLATFORM_ADMIN_EMAIL);
		await page.getByLabel(/^Password/).fill(PLATFORM_ADMIN_PASSWORD);
		await expect(page.getByLabel(/^Password/)).toHaveValue(PLATFORM_ADMIN_PASSWORD, { timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/\/platform\/dashboard/);
	await page.goto(`/platform/organisations/${org.id}`);
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
	return { org, name, slug };
}

test.describe("PLAT-U01 the platform shell", () => {
	test.use({ colorScheme: "dark" });

	test("PLAT-U01 a first visit is in light mode even when the operating system prefers dark", async ({ page }) => {
		await page.goto("/platform/login");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	});

	test("PLAT-U01 the account control is a small avatar whose menu holds the sign-out and theme choices", async ({ page }) => {
		await openOrganisation(page);
		const account = page.getByRole("button", { name: "Account menu" });
		const box = await account.boundingBox();
		expect(box?.width ?? 999, "account control width (px)").toBeLessThanOrEqual(72);
		await account.click();
		await expect(page.getByRole("menuitem", { name: /Sign out/ })).toBeVisible();
	});
});

test.describe("PLAT-U02 the organisation page", () => {
	test("PLAT-U02 it shows the name, status, legal name and slug, and Organisations goes back to the list", async ({ page }) => {
		const { name, slug } = await openOrganisation(page);
		await expect(page.getByText("TRIAL", { exact: true })).toBeVisible();
		await expect(page.getByText(`${name} Trust · slug: ${slug}`)).toBeVisible();
		await page.getByRole("button", { name: "Organisations" }).first().click();
		await expect(page).toHaveURL(/\/platform\/organisations$/);
	});

	test("PLAT-U02 Change status moves the organisation to the chosen status", async ({ page }) => {
		const { org } = await openOrganisation(page);
		await page.getByRole("button", { name: "Change status" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox").click();
		await page.getByRole("option", { name: "ACTIVE" }).click();
		await dialog.getByRole("button", { name: /^(Change|Save|Update|Apply|Confirm)/ }).click();
		await expect(page.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
		const token = await platformToken();
		expect((await platformGet<{ status: string }>(`/api/v1/platform/organisations/${org.id}`, token)).status).toBe("ACTIVE");
	});

	test("PLAT-U02 every section card is present and the page does not scroll sideways", async ({ page }) => {
		await openOrganisation(page);
		for (const title of ["Subscription", "Invoices", "Features", "Integrations", "Contacts", "Follow-ups", "Activity"]) {
			await expect(page.getByRole("heading", { name: title, exact: true, level: 6 }), title).toBeVisible();
		}
		for (const [width, height] of [[1470, 900], [1024, 768], [390, 844]]) {
			await page.setViewportSize({ width, height });
			// The sidebar width animates when the viewport crosses a breakpoint, so wait for it to settle.
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `horizontal overflow at ${width}px` })
				.toBeLessThanOrEqual(0);
		}
	});

	test("PLAT-U02 the sidebar becomes an icon rail below 1200px and keeps its links reachable", async ({ page }) => {
		await openOrganisation(page);
		await page.setViewportSize({ width: 1470, height: 900 });
		await expect(page.getByRole("navigation", { name: "Main navigation" }).getByText("Organisations", { exact: true })).toBeVisible();
		await page.setViewportSize({ width: 1024, height: 768 });
		const nav = page.getByRole("navigation", { name: "Main navigation" });
		await expect(nav.getByText("Organisations", { exact: true })).toHaveCount(0);
		await nav.getByRole("button").nth(2).click();
		await expect(page).toHaveURL(/\/platform\//);
	});
});

test.describe("PLAT-U03 feature and integration switches", () => {
	test("PLAT-U03 switching a feature tile off is saved and switching it back on restores it", async ({ page }) => {
		const { org } = await openOrganisation(page);
		const token = await platformToken();
		const modules = () => platformGet<{ code: string; label: string; enabled: boolean }[]>(`/api/v1/platform/organisations/${org.id}/modules`, token);
		const target = (await modules()).find((m) => m.enabled);
		expect(target, "an enabled feature to switch").toBeTruthy();
		const toggle = page.getByRole("switch", { name: `${target!.label} enabled` });
		await expect(toggle).toBeChecked();
		// The switch is controlled and only flips once the API has answered, so click and then read the API.
		await toggle.click();
		await expect.poll(async () => (await modules()).find((m) => m.code === target!.code)?.enabled).toBe(false);
		await expect(toggle).not.toBeChecked();
		await toggle.click();
		await expect.poll(async () => (await modules()).find((m) => m.code === target!.code)?.enabled).toBe(true);
	});

	test("PLAT-U03 loading the page makes no failing request and logs no console error", async ({ page }) => {
		const problems: string[] = [];
		page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
		page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
		page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
		await openOrganisation(page);
		await page.waitForLoadState("networkidle");
		expect(problems).toEqual([]);
	});
});
