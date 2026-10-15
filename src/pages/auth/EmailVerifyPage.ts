import type { Page } from "@playwright/test";

export class EmailVerifyPage {
	constructor(private readonly page: Page) {}

	async openLink(organisationSlug: string, token: string) {
		await this.page.goto(`/verify-email?org=${encodeURIComponent(organisationSlug)}&token=${encodeURIComponent(token)}`);
	}

	async verify() {
		await this.page.getByRole("button", { name: "Verify email" }).click();
	}

	successAlert() {
		return this.page.getByText("Email verified.");
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
