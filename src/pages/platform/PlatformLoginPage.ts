import { expect, type Page } from "@playwright/test";

/** /platform/login - the platform operator's sign-in, a separate identity plane from organisation users. */
export class PlatformLoginPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/platform/login");
	}

	async login(email: string, password: string) {
		// The form can re-render as the app finishes loading and wipe what was typed, so type until it sticks.
		await expect(async () => {
			await this.page.getByLabel(/^Email/).fill(email);
			await this.page.getByLabel(/^Password/).fill(password);
			await expect(this.page.getByLabel(/^Email/)).toHaveValue(email, { timeout: 1000 });
			await expect(this.page.getByLabel(/^Password/)).toHaveValue(password, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await this.page.getByRole("button", { name: "Sign in" }).click();
	}

	async signOut() {
		await this.page.getByRole("button", { name: "Sign out" }).click();
	}
}
