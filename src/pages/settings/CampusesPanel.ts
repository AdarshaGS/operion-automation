import type { Page } from "@playwright/test";

/** Settings > Campuses (also a step of the structure-setup wizard). Rows are added through an "Add campus" dialog. */
export class CampusesPanel {
	constructor(private readonly page: Page) {}

	heading() {
		return this.page.getByRole("heading", { name: "Campuses", exact: true });
	}

	async add(fields: { name: string; code: string; city?: string }) {
		await this.page.getByRole("button", { name: "Add campus" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add campus" });
		await dialog.getByLabel(/^Name/).fill(fields.name);
		await dialog.getByLabel(/^Code/).fill(fields.code);
		if (fields.city) await dialog.getByLabel(/^City/).fill(fields.city);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	row(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
