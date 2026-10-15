import type { Page } from "@playwright/test";

/** Academics > Class offerings: the classes table and its Add class / Edit class dialogs. */
export class ClassOfferingsPanel {
	constructor(private readonly page: Page) {}

	row(name: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	addDialog() {
		return this.page.getByRole("dialog", { name: "Add class" });
	}

	async openAdd() {
		await this.page.getByRole("button", { name: "Add class" }).click();
		await this.addDialog().waitFor();
	}

	private async chooseIn(label: RegExp, option: string | RegExp) {
		await this.addDialog().getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option }).click();
	}

	async fillClass(values: { year: string; campus: string; grade: string; displayName?: string }) {
		await this.chooseIn(/^Academic year/, values.year);
		await this.chooseIn(/^Campus/, values.campus);
		await this.chooseIn(/^Grade level/, values.grade);
		if (values.displayName !== undefined) await this.addDialog().getByLabel("Display name").fill(values.displayName);
	}

	async submitAdd() {
		await this.addDialog().getByRole("button", { name: "Add", exact: true }).click();
	}

	async rename(name: string | RegExp, newName: string) {
		await this.row(name).getByRole("button", { name: "Edit" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Edit class" });
		await dialog.getByLabel("Display name").fill(newName);
		await dialog.getByRole("button", { name: "Save" }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	async toggleStatus(name: string | RegExp) {
		await this.row(name).getByRole("button", { name: /Deactivate|Reactivate/ }).click();
	}

	/** The inline error banner; it sits behind the Add class dialog when that is open. */
	errorBanner() {
		return this.page.getByRole("alert").filter({ hasText: /./ });
	}
}
