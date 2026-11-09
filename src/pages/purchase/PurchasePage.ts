import type { Locator, Page } from "@playwright/test";

export interface OrderLineInput {
	item: string;
	quantity: number;
	unitCost: number;
}

/** /purchase - the purchase-order list and the "New purchase order" dialog. */
export class PurchasePage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/purchase");
		await this.page.getByRole("heading", { name: "Purchase orders", exact: true }).waitFor();
	}

	newOrderButton() {
		return this.page.getByRole("button", { name: "New purchase order" });
	}

	dialog() {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: "New purchase order" }) });
	}

	/** The red error alert at the top of the panel (behind the dialog while it is open). */
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
	async fillOrder(input: { supplier: string; campus: string; expectedDate?: string; lines: OrderLineInput[] }) {
		await this.newOrderButton().click();
		const dialog = this.dialog();
		await this.pick(dialog.getByRole("combobox", { name: /^Supplier/ }), input.supplier);
		await this.pick(dialog.getByRole("combobox", { name: /^Campus/ }), input.campus);
		if (input.expectedDate) await dialog.getByLabel("Expected date").fill(input.expectedDate);
		for (const [index, line] of input.lines.entries()) {
			if (index > 0) await dialog.getByRole("button", { name: "Add line" }).click();
			await this.pick(dialog.getByRole("combobox", { name: /^Item/ }).nth(index), new RegExp(`^${line.item} - `));
			await dialog.getByLabel(/^Quantity/).nth(index).fill(String(line.quantity));
			await dialog.getByLabel(/^Unit cost/).nth(index).fill(String(line.unitCost));
		}
		return dialog;
	}

	async createOrder(input: Parameters<PurchasePage["fillOrder"]>[0]) {
		const dialog = await this.fillOrder(input);
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		return dialog;
	}
}
