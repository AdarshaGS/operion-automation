import type { Page } from "@playwright/test";

/** Academics > Sections: the sections of the selected class offering. */
export class SectionsPanel {
	constructor(private readonly page: Page) {}

	row(name: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	addDialog() {
		return this.page.getByRole("dialog", { name: "Add section" });
	}

	async openAdd() {
		await this.page.getByRole("button", { name: "Add section" }).click();
		await this.addDialog().waitFor();
	}

	async fillSection(values: { name: string; capacity?: string; room?: string }) {
		await this.addDialog().getByLabel(/^Name/).fill(values.name);
		if (values.capacity !== undefined) await this.addDialog().getByLabel("Capacity").fill(values.capacity);
		if (values.room !== undefined) await this.addDialog().getByLabel("Room").fill(values.room);
	}

	async submitAdd() {
		await this.addDialog().getByRole("button", { name: "Add", exact: true }).click();
	}

	async toggleStatus(name: string | RegExp) {
		await this.row(name).getByRole("button", { name: /Deactivate|Reactivate/ }).click();
	}
}
