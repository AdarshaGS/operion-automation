import type { Page } from "@playwright/test";

export class ClaimStaffInvitePage {
	constructor(private readonly page: Page) {}

	async openLink(organisationSlug: string, token: string) {
		await this.page.goto(`/claim-staff-invite?org=${encodeURIComponent(organisationSlug)}&token=${encodeURIComponent(token)}`);
	}

	async setUp(password: string, confirmPassword = password) {
		await this.page.getByLabel("Choose a password").fill(password);
		await this.page.getByLabel("Confirm password").fill(confirmPassword);
		await this.page.getByRole("button", { name: "Set up account" }).click();
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
