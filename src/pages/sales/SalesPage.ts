import type { Locator, Page } from "@playwright/test";

export interface SaleLineInput {
	item: string;
	quantity: number;
	unitPrice: number;
}

/** /sales - the sales list and the "New sale" dialog. */
export class SalesPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/sales");
		await this.page.getByRole("heading", { name: "Sales", exact: true }).waitFor();
	}

	newSaleButton() {
		return this.page.getByRole("button", { name: "New sale" });
	}

	dialog() {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: "New sale" }) });
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	row(text: string) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	private async pick(combobox: Locator, option: string | RegExp) {
		await combobox.click();
		await this.page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
	}

	/** Opens the dialog and fills it, leaving it open. */
	async fillSale(input: { customer: string; campus: string; saleDate?: string; lines: SaleLineInput[] }) {
		await this.newSaleButton().click();
		const dialog = this.dialog();
		await this.pick(dialog.getByRole("combobox", { name: /^Customer/ }), new RegExp(`^${input.customer}`));
		await this.pick(dialog.getByRole("combobox", { name: /^Campus/ }), input.campus);
		if (input.saleDate) await dialog.getByLabel("Sale date").fill(input.saleDate);
		for (const [index, line] of input.lines.entries()) {
			if (index > 0) await dialog.getByRole("button", { name: "Add line" }).click();
			await this.pick(dialog.getByRole("combobox", { name: /^Item/ }).nth(index), new RegExp(`^${line.item} - `));
			await dialog.getByLabel(/^Quantity/).nth(index).fill(String(line.quantity));
			await dialog.getByLabel(/^Unit price/).nth(index).fill(String(line.unitPrice));
		}
		return dialog;
	}

	async completeSale(input: Parameters<SalesPage["fillSale"]>[0]) {
		const dialog = await this.fillSale(input);
		await dialog.getByRole("button", { name: "Complete sale" }).click();
		return dialog;
	}

	/** /sales/customers/:id - a customer's purchase history. */
	async openCustomerHistory(customerId: number, name: string) {
		await this.page.goto(`/sales/customers/${customerId}`);
		await this.page.getByRole("heading", { name: `Purchase history: ${name}`, level: 1 }).waitFor();
	}
}
