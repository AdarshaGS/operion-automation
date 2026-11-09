import type { Page } from "@playwright/test";

/** /portal/profile - the signed-in person's details and their profile change requests. */
export class ProfilePage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/portal/profile");
		await this.page.getByRole("heading", { name: "Change requests" }).waitFor();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	field(label: string) {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name: label, exact: true }) });
	}

	async requestChange(input: { phone?: string; email?: string; photoUrl?: string }) {
		await this.page.getByRole("button", { name: "Request a change" }).click();
		const dialog = this.dialog();
		if (input.phone) await dialog.getByLabel("Phone").fill(input.phone);
		if (input.email) await dialog.getByLabel("Email").fill(input.email);
		if (input.photoUrl) await dialog.getByLabel("Photo URL").fill(input.photoUrl);
		await dialog.getByRole("button", { name: "Submit" }).click();
	}

	requestRow(text: string) {
		return this.page.getByRole("row").filter({ hasText: text });
	}
}
