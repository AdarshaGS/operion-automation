import type { Locator, Page } from "@playwright/test";

/** /inventory (stacked panels: Item categories, Items, Assets, Suppliers, Customers) and /inventory/items/{id}. */
export class InventoryPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/inventory");
		await this.page.getByRole("heading", { name: "Items", exact: true }).waitFor();
	}

	async openItem(itemId: number) {
		await this.page.goto(`/inventory/items/${itemId}`);
		await this.page.getByRole("button", { name: "Back to inventory" }).waitFor();
	}

	dialog(title: string | RegExp) {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: title }) });
	}

	async choose(scope: Locator | Page, label: string | RegExp, option: string) {
		await scope.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	row(text: string) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	button(name: string) {
		return this.page.getByRole("button", { name, exact: true });
	}

	// list page

	async addItem(input: { category: string; code: string; name: string; unit: string; reorderLevel?: number; storageLocation?: string }) {
		await this.button("Add item").click();
		const dialog = this.dialog("Add item");
		await this.choose(dialog, "Category", input.category);
		await dialog.getByLabel("Code").fill(input.code);
		await dialog.getByLabel("Name").fill(input.name);
		await dialog.getByRole("combobox", { name: "Unit" }).fill(input.unit);
		if (input.reorderLevel != null) await dialog.getByLabel("Reorder level (optional)").fill(String(input.reorderLevel));
		if (input.storageLocation) await dialog.getByLabel("Storage location (optional)").fill(input.storageLocation);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	async lowStockFor(campus: string, onlyLow = true) {
		await this.choose(this.page, "Campus (for low-stock check)", campus);
		if (onlyLow) await this.page.getByLabel("Low stock only").check();
	}

	// item page

	async pickCampus(campus: string) {
		await this.choose(this.page, "Campus", campus);
		await this.page.getByRole("heading", { name: "Stock ledger" }).waitFor();
	}

	/** The balance chip next to "Balance:". */
	balance() {
		return this.page.getByRole("heading").filter({ hasText: "Balance:" }).locator(".MuiChip-root").first();
	}

	lowStockChip() {
		return this.page.locator(".MuiChip-root").filter({ hasText: /^Low stock$/ });
	}

	ledgerRows() {
		return this.page.getByRole("row").filter({ has: this.page.locator(".MuiChip-root").filter({ hasText: /^(ENTRY|ISSUE|ADJUSTMENT)$/ }) });
	}

	async recordEntry(quantity: number, source?: string) {
		await this.button("Record entry").click();
		const dialog = this.dialog("Record stock entry");
		await dialog.getByLabel("Quantity").fill(String(quantity));
		if (source) await dialog.getByLabel("Source").fill(source);
		await dialog.getByRole("button", { name: "Record" }).click();
	}

	async recordIssue(quantity: number, issuedTo: string) {
		await this.button("Record issue").click();
		const dialog = this.dialog("Record stock issue");
		await dialog.getByLabel("Quantity").fill(String(quantity));
		await dialog.getByLabel("Issued to").fill(issuedTo);
		await dialog.getByRole("button", { name: "Record" }).click();
		return dialog;
	}

	async recordAdjustment(delta: number, reason: string) {
		await this.button("Record adjustment").click();
		const dialog = this.dialog("Record stock adjustment");
		await dialog.getByLabel("Quantity delta").fill(String(delta));
		await this.choose(dialog, "Reason", reason);
		await dialog.getByRole("button", { name: "Record" }).click();
	}

	async transfer(toCampus: string, quantity: number, remarks?: string) {
		await this.button("Transfer to another campus").click();
		const dialog = this.dialog("Transfer to another campus");
		await this.choose(dialog, "To campus", toCampus);
		await dialog.getByLabel("Quantity").fill(String(quantity));
		if (remarks) await dialog.getByLabel("Remarks").fill(remarks);
		await dialog.getByRole("button", { name: "Transfer" }).click();
		return dialog;
	}
}
