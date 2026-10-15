import type { Page } from "@playwright/test";

/** Settings > Designations (designations come from the school setup template). Rows are added through an "Add designation" dialog. */
export class DesignationsPanel {
	constructor(private readonly page: Page) {}

	heading() {
		return this.page.getByRole("heading", { name: "Designations", exact: true, level: 6 });
	}

	async add(fields: { name: string }) {
		await this.page.getByRole("button", { name: "Add designation" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add designation" });
		await dialog.getByLabel(/^Name/).fill(fields.name);
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
