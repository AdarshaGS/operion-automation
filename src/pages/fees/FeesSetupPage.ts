import type { Page } from "@playwright/test";

// Setup-time fee configuration (categories + structures) lives at /fees/setup; /fees itself is
// the daily fee-collection screen.
export class FeesSetupPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/fees/setup");
	}

	async addCategory(input: { code: string; name: string; description?: string }) {
		await this.page.getByRole("button", { name: "Add category" }).click();
		await this.page.getByLabel("Code").fill(input.code);
		await this.page.getByLabel("Name").fill(input.name);
		if (input.description) await this.page.getByLabel("Description").fill(input.description);
		await this.page.getByRole("button", { name: "Add", exact: true }).click();
	}

	// FeesPage renders FeeCategoriesPanel then FeeStructuresPanel (see FeesPage.tsx), so
	// their tables are reliably the 1st and 2nd <table> on the page - scoping by table
	// index avoids the two panels' rows colliding when a category/structure share text
	// (e.g. the same fee category name shows in both).
	private categoriesTable() {
		return this.page.getByRole("table").nth(0);
	}

	private structuresTable() {
		return this.page.getByRole("table").nth(1);
	}

	categoryRow(code: string) {
		return this.categoriesTable().getByRole("row").filter({ hasText: code });
	}

	async selectStructureScope(academicYearName: string, className: string) {
		await this.page.getByRole("combobox", { name: "Academic year" }).click();
		await this.page.getByRole("option", { name: academicYearName }).click();
		await this.page.getByRole("combobox", { name: "Class", exact: true }).click();
		await this.page.getByRole("option", { name: className }).click();
	}

	/** The class/year may already have a structure group (created by an earlier test or by hand);
	 * only run the "Set up" dialog when it doesn't. */
	async setUpStructureIfNeeded(name: string) {
		const setUp = this.page.getByRole("button", { name: "Set up" });
		const addComponent = this.page.getByRole("button", { name: "Add component" });
		await setUp.or(addComponent).waitFor();
		if (await setUp.isVisible()) {
			await setUp.click();
			await this.page.getByLabel("Name").fill(name);
			await this.page.getByRole("button", { name: "Create" }).click();
		}
	}

	async addStructure(input: { categoryName: string; amount: number; installmentDueDate: string }) {
		await this.page.getByRole("button", { name: "Add component" }).click();
		await this.page.getByRole("combobox", { name: "Fee category" }).click();
		await this.page.getByRole("option", { name: input.categoryName }).click();
		await this.page.getByLabel("Total amount").fill(String(input.amount));
		await this.page.getByLabel("Due date").fill(input.installmentDueDate);
		await this.page.getByLabel("Amount", { exact: true }).fill(String(input.amount));
		await this.page.getByRole("button", { name: "Add", exact: true }).click();
	}

	structureRow(categoryName: string) {
		return this.structuresTable().getByRole("row").filter({ hasText: categoryName });
	}
}
