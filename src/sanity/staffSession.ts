// A staff member working from their own computer: a fresh, signed-out browser window in which they
// sign in through the login form. The owner's page keeps its own session, so a phase can hand work
// back and forth (the teacher marks, the owner locks) without signing anyone out.

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { UI_BASE_URL } from "../config/env";
import { LoginPage } from "../pages/auth/LoginPage";
import { EMPTY_STORAGE } from "../ui/session";
import type { UiDiagnostics } from "../ui/fixtures";

export interface StaffWindow {
	page: Page;
	close(): Promise<void>;
}

/** Signs `email` in at `slug` in a new window. Console errors and 5xx calls seen there are added to
 * `diagnostics`, so the phase's "Browser health" step covers every window, not just the owner's. */
export async function signInAsStaff(
	browser: Browser,
	business: { slug: string },
	email: string,
	password: string,
	diagnostics?: UiDiagnostics,
): Promise<StaffWindow> {
	const context: BrowserContext = await browser.newContext({ baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
	const page = await context.newPage();
	if (diagnostics) {
		page.on("console", (msg) => {
			if (msg.type() === "error" && !/Download the React DevTools|^Failed to load resource:/i.test(msg.text())) diagnostics.consoleErrors.push(`[${email}] ${msg.text()}`);
		});
		page.on("pageerror", (error) => diagnostics.consoleErrors.push(`[${email}] Uncaught exception: ${error.message}`));
		page.on("response", (response) => {
			if (response.status() >= 500) diagnostics.failedRequests.push(`[${email}] ${response.status()} ${response.request().method()} ${response.url()}`);
		});
	}
	const loginPage = new LoginPage(page);
	await loginPage.open();
	await loginPage.login(business.slug, email, password);
	await expect(page).not.toHaveURL(/\/login/);
	await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
	return { page, close: () => context.close() };
}
