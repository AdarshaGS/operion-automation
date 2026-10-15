import type { Page } from "@playwright/test";

export class ForgotPasswordPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/forgot-password");
	}

	async requestReset(organisationSlug: string, email: string) {
		await this.page.getByLabel("Organisation slug").fill(organisationSlug);
		await this.page.getByLabel("Email").fill(email);
		await this.page.getByRole("button", { name: "Send reset link" }).click();
	}

	async backToSignIn() {
		await this.page.getByRole("link", { name: "Back to sign in" }).click();
	}

	confirmation() {
		return this.page.getByText(/If that account exists, a reset link has been sent/);
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
