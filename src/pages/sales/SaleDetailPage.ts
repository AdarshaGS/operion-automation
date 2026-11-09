import type { Page } from "@playwright/test";

/** /sales/:id - a receipt: lines, totals, status, payments and the "Record payment" dialog. */
export class SaleDetailPage {
	constructor(private readonly page: Page) {}

	async open(saleId: number, receiptNumber: string) {
		await this.page.goto(`/sales/${saleId}`);
		await this.page.getByRole("heading", { name: `Receipt ${receiptNumber}`, level: 1 }).waitFor();
	}

	statusChip() {
		return this.page.getByRole("main").locator(".MuiChip-root").first();
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	totals() {
		return this.page.getByRole("main");
	}

	lineRow(itemCode: string) {
		return this.page.getByRole("row").filter({ hasText: itemCode });
	}

	paymentRows() {
		return this.page.getByRole("table").filter({ has: this.page.getByRole("columnheader", { name: "Method" }) }).getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}

	recordPaymentButton() {
		return this.page.getByRole("button", { name: "Record payment" });
	}

	printButton() {
		return this.page.getByRole("button", { name: "Print receipt" });
	}

	dialog() {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: "Record payment" }) });
	}

	async recordPayment(input: { method?: string; amount?: number; paidOn?: string }) {
		await this.recordPaymentButton().click();
		const dialog = this.dialog();
		if (input.method) {
			await dialog.getByRole("combobox", { name: /^Method/ }).click();
			await this.page.getByRole("option", { name: input.method, exact: true }).click();
		}
		if (input.amount !== undefined) await dialog.getByLabel(/^Amount/).fill(String(input.amount));
		if (input.paidOn) await dialog.getByLabel(/^Paid on/).fill(input.paidOn);
		await dialog.getByRole("button", { name: "Record", exact: true }).click();
		return dialog;
	}
}
