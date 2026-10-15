import type { Page } from "@playwright/test";

export class ResetPasswordPage {
	constructor(private readonly page: Page) {}

	/** The emailed link carries the slug and token as query parameters, which prefill the form. */
	async openLink(organisationSlug: string, token: string) {
		await this.page.goto(`/reset-password?org=${encodeURIComponent(organisationSlug)}&token=${encodeURIComponent(token)}`);
	}

	async openBlank() {
		await this.page.goto("/reset-password");
	}

	async fillManually(organisationSlug: string, token: string) {
		await this.page.getByLabel("Organisation slug").fill(organisationSlug);
		await this.page.getByLabel("Reset token").fill(token);
	}

	async setPassword(newPassword: string, confirmPassword = newPassword) {
		await this.page.getByLabel(/^New password/).fill(newPassword);
		await this.page.getByLabel(/^Confirm new password/).fill(confirmPassword);
		await this.page.getByRole("button", { name: "Reset password" }).click();
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}

	organisationSlugField() {
		return this.page.getByLabel("Organisation slug");
	}

	tokenField() {
		return this.page.getByLabel("Reset token");
	}
}
