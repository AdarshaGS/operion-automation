// One browser session for the whole sanity run. Phase 01 signs the new owner in; later phases
// pick that session up instead of logging out and in again. Run on its own, a phase finds no
// session and signs in through the form, so every phase file still works standalone.

import { expect, type Page } from "@playwright/test";
import type { LoginPage } from "../pages/auth/LoginPage";

export async function continueAsOwner(page: Page, loginPage: LoginPage, business: { slug: string; ownerEmail: string; ownerPassword: string }) {
	await page.goto("/dashboard");
	// The app settles on either the signed-in shell or the login form - wait for whichever shows up.
	const loginForm = page.getByLabel("Organisation slug");
	const signedInShell = page.getByRole("button", { name: "Toggle sidebar" });
	await expect(loginForm.or(signedInShell)).toBeVisible();
	if (await loginForm.isVisible()) {
		await loginPage.login(business.slug, business.ownerEmail, business.ownerPassword);
	}
	await expect(page).toHaveURL(/\/dashboard/);
	await expect(signedInShell).toBeVisible();
}
