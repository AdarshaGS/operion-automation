// A staff member accepting their invite: a different person on a different computer, so a fresh,
// signed-out browser window. The claim link carries only the token, so they type the school's slug.

import { expect, type Browser } from "@playwright/test";
import { UI_BASE_URL } from "../config/env";
import { EMPTY_STORAGE } from "../ui/session";

export async function claimStaffInvite(browser: Browser, claimLink: string, slug: string, password: string) {
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
	try {
		const staff = await context.newPage();
		await staff.goto(claimLink);
		await expect(staff.getByLabel("Invite token")).not.toHaveValue("");
		await expect(async () => {
			await staff.getByLabel("Organisation slug").fill(slug);
			await staff.getByLabel("Choose a password").fill(password);
			await staff.getByLabel("Confirm password").fill(password);
			await expect(staff.getByLabel("Organisation slug")).toHaveValue(slug, { timeout: 1000 });
			await expect(staff.getByLabel("Choose a password")).toHaveValue(password, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await staff.getByRole("button", { name: "Set up account" }).click();
		await expect(staff).not.toHaveURL(/\/claim-staff-invite/);
		await expect(staff.getByRole("button", { name: "Account menu" })).toBeVisible();
		await staff.waitForTimeout(1500);
	} finally {
		await context.close();
	}
}
