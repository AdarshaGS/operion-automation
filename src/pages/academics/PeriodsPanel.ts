import type { Page } from "@playwright/test";

/** Academics > Periods: the school-day periods table and its Add / Edit period dialog. */
export class PeriodsPanel {
	constructor(private readonly page: Page) {}

	row(label: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: label });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async openAdd() {
		await this.page.getByRole("button", { name: "Add period" }).click();
		await this.dialog().waitFor();
	}

	async fill(values: { ordinal?: string; label: string; start: string; end: string; breakSlot?: boolean }) {
		const dialog = this.dialog();
		if (values.ordinal !== undefined) await dialog.getByLabel(/^Order/).fill(values.ordinal);
		await dialog.getByLabel(/^Label/).fill(values.label);
		await dialog.getByLabel(/^Start/).fill(values.start);
		await dialog.getByLabel(/^End/).fill(values.end);
		if (values.breakSlot !== undefined) await dialog.getByRole("checkbox", { name: /Break/ }).setChecked(values.breakSlot);
	}

	async submit() {
		await this.dialog().getByRole("button", { name: /^(Add|Save)$/ }).click();
	}

	async openEdit(label: string | RegExp) {
		await this.row(label).getByRole("button", { name: "Edit" }).click();
		await this.dialog().waitFor();
	}

	async delete(label: string | RegExp) {
		await this.row(label).getByRole("button", { name: "Delete" }).click();
	}
}
