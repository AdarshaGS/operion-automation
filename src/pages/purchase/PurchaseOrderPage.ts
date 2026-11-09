import type { Page } from "@playwright/test";

/** /purchase/orders/:id - one purchase order: status actions, line items, receive and return dialogs. */
export class PurchaseOrderPage {
	constructor(private readonly page: Page) {}

	async open(orderId: number) {
		await this.page.goto(`/purchase/orders/${orderId}`);
		await this.page.getByRole("heading", { name: `Purchase order #${orderId}`, level: 1 }).waitFor();
	}

	statusChip() {
		return this.page.getByRole("main").locator(".MuiChip-root").first();
	}

	/** The red error alert near the top of the page (behind the dialog while one is open). */
	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	button(name: string) {
		return this.page.getByRole("button", { name, exact: true });
	}

	lineRow(itemCode: string) {
		return this.page.getByRole("row").filter({ hasText: itemCode });
	}

	/** Cells of a line row as text, in column order: item, ordered, unit cost, received, returned. */
	async lineCells(itemCode: string) {
		const row = this.lineRow(itemCode);
		await row.waitFor();
		return row.getByRole("cell").allInnerTexts();
	}

	receiveDialog() {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: "Receive goods" }) });
	}

	async receive(quantities: Record<string, number>, entryDate?: string) {
		await this.button("Receive goods").click();
		const dialog = this.receiveDialog();
		if (entryDate) await dialog.getByLabel("Entry date").fill(entryDate);
		for (const [itemCode, quantity] of Object.entries(quantities)) await dialog.getByLabel(new RegExp(`^${itemCode} - .*\\(max`)).fill(String(quantity));
		await dialog.getByRole("button", { name: "Record receipt" }).click();
		return dialog;
	}

	returnDialog() {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: "Return to supplier" }) });
	}

	async returnLine(itemCode: string, quantity: number, reason?: string, remarks?: string) {
		await this.lineRow(itemCode).getByRole("button", { name: "Return" }).click();
		const dialog = this.returnDialog();
		await dialog.getByLabel(/^Quantity/).fill(String(quantity));
		if (reason) {
			await dialog.getByRole("combobox", { name: /^Reason/ }).click();
			await this.page.getByRole("option", { name: reason, exact: true }).click();
		}
		if (remarks) await dialog.getByLabel("Remarks").fill(remarks);
		await dialog.getByRole("button", { name: "Record return" }).click();
		return dialog;
	}
}
