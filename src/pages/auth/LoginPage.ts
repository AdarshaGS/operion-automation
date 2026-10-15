import { expect, type Page } from "@playwright/test";

export class LoginPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/login");
	}

	async login(organisationSlug: string, email: string, password: string) {
		// The form can re-render as the app finishes loading and wipe what was typed, so type until it sticks.
		await expect(async () => {
			await this.page.getByLabel("Organisation slug").fill(organisationSlug);
			await this.page.getByLabel("Email").fill(email);
			await this.page.getByLabel("Password").fill(password);
			await expect(this.page.getByLabel("Organisation slug")).toHaveValue(organisationSlug, { timeout: 1000 });
			await expect(this.page.getByLabel("Email")).toHaveValue(email, { timeout: 1000 });
			await expect(this.page.getByLabel("Password")).toHaveValue(password, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await this.page.getByRole("button", { name: "Sign in" }).click();
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}

	async goToForgotPassword() {
		await this.page.getByRole("link", { name: "Forgot password?" }).click();
	}

	async submitEmpty() {
		await this.page.getByRole("button", { name: "Sign in" }).click();
	}

	/** Fills the form and submits with Enter instead of clicking the button. */
	async loginWithEnterKey(organisationSlug: string, email: string, password: string) {
		await this.page.getByLabel("Organisation slug").fill(organisationSlug);
		await this.page.getByLabel("Email").fill(email);
		await this.page.getByLabel("Password").fill(password);
		await this.page.getByLabel("Password").press("Enter");
	}

	passwordField() {
		return this.page.getByLabel("Password");
	}
}
