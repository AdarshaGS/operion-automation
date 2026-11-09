import type { Locator, Page } from "@playwright/test";

/** /fees: pick a student, then assign fees, generate invoices, record payments, and correct them. */
export class FeeCollectionPage {
	constructor(private readonly page: Page) {}

	/** For assertions that need the raw page (option lists render outside the dialog). */
	page_() {
		return this.page;
	}

	async open() {
		await this.page.goto("/fees");
		await this.page.getByRole("heading", { name: "Fees & Collections" }).waitFor();
	}

	/** "Collect Fee" opens a dialog that first asks which student. The picker searches the server as
	 * you type and labels each option "First Last (STUDENT-ID)"; pass the name, or the name followed by
	 * anything in brackets (only the name is matched). Only the first name is typed: the search matches
	 * first name, last name or admission number one at a time, so a full name finds nothing (5fs). */
	async chooseStudent(nameOrLabel: string) {
		const name = nameOrLabel.replace(/\s*\(.*\)$/, "");
		await this.page.getByRole("button", { name: "Collect Fee" }).click();
		await this.page.getByRole("dialog", { name: /^Collect fee/ }).getByRole("combobox", { name: "Student" }).fill(name.split(" ")[0]);
		await this.page.getByRole("option", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`) }).click();
		await this.page.getByRole("heading", { name: "Fee assignments" }).or(this.accessBanner()).waitFor();
	}

	/** Closes the "Collect fee" dialog, back to the ledger. */
	async closeStudent() {
		await this.page.getByRole("dialog", { name: /^Collect fee/ }).getByRole("button", { name: "Close", exact: true }).click();
		await this.page.getByRole("dialog", { name: /^Collect fee/ }).waitFor({ state: "hidden" });
	}

	private dialog(title: RegExp | string) {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: title }) });
	}

	// ---- assignments ----
	assignmentRow(categoryName: string) {
		return this.page.getByRole("row").filter({ hasText: categoryName });
	}

	async openAssignDialog() {
		await this.page.getByRole("button", { name: "Assign fee" }).click();
		await this.dialog("Assign fee").waitFor();
	}

	async assign(input: { structureLabel: RegExp | string; frequency?: string; discountAmount?: number; discountReason?: string; approver?: string }) {
		await this.openAssignDialog();
		const dialog = this.dialog("Assign fee");
		await dialog.getByRole("combobox", { name: "Fee structure" }).click();
		await this.page.getByRole("option", { name: input.structureLabel }).click();
		if (input.frequency) {
			await dialog.getByRole("combobox", { name: "Payment frequency" }).click();
			await this.page.getByRole("option", { name: input.frequency, exact: true }).click();
		}
		if (input.discountAmount !== undefined) await dialog.getByLabel("Discount amount").fill(String(input.discountAmount));
		if (input.discountReason) await dialog.getByLabel("Discount reason").fill(input.discountReason);
		if (input.approver) {
			await dialog.getByRole("combobox", { name: "Approved by" }).click();
			await this.page.getByRole("option", { name: input.approver }).click();
		}
		await dialog.getByRole("button", { name: "Assign", exact: true }).click();
	}

	assignDialog() {
		return this.dialog("Assign fee");
	}

	async generateInvoice(categoryName: string, installmentNumber: number) {
		await this.assignmentRow(categoryName).getByRole("button", { name: "Generate invoice" }).click();
		const dialog = this.dialog("Generate invoice");
		await dialog.getByRole("combobox", { name: "Installment" }).click();
		await this.page.getByRole("option", { name: new RegExp(`^#${installmentNumber} `) }).click();
		await dialog.getByRole("button", { name: "Generate", exact: true }).click();
	}

	// ---- invoices ----
	invoiceRow(invoiceNumber: string) {
		return this.page.getByRole("row").filter({ hasText: invoiceNumber });
	}

	// ---- payments ----
	async openPaymentDialog() {
		await this.page.getByRole("button", { name: "Record payment" }).click();
		await this.dialog("Record payment").waitFor();
	}

	paymentDialog() {
		return this.dialog("Record payment");
	}

	async recordPayment(input: { amount: number; method?: string; reference?: string; bankName?: string; remarks?: string; allocate: { invoiceNumber: string; amount?: number }[] }) {
		await this.openPaymentDialog();
		const dialog = this.dialog("Record payment");
		await dialog.getByRole("spinbutton", { name: "Amount" }).fill(String(input.amount));
		if (input.method) {
			await dialog.getByRole("combobox", { name: "Method" }).click();
			await this.page.getByRole("option", { name: input.method, exact: true }).click();
		}
		if (input.reference) await dialog.getByLabel(/number|UTR|Transaction ID/i).fill(input.reference);
		if (input.bankName) await dialog.getByLabel("Bank name").fill(input.bankName);
		if (input.remarks) await dialog.getByLabel("Remarks").fill(input.remarks);
		for (const target of input.allocate) {
			const line = dialog.locator("div").filter({ hasText: target.invoiceNumber }).filter({ has: this.page.getByRole("checkbox") }).last();
			await line.getByRole("checkbox").check();
			if (target.amount !== undefined) await line.getByLabel("Allocate").fill(String(target.amount));
		}
	}

	async submitPayment() {
		await this.dialog("Record payment").getByRole("button", { name: "Record", exact: true }).click();
	}

	receiptDialog() {
		return this.dialog("Payment recorded");
	}

	async closeReceipt() {
		await this.receiptDialog().getByRole("button", { name: "Done" }).click();
	}

	paymentRow(receiptNumber: string) {
		return this.page.getByRole("row").filter({ hasText: receiptNumber });
	}

	/** The Receipt button on a payment-history row; resolves to the browser download it starts. */
	async downloadReceipt(receiptNumber: string) {
		const download = this.page.waitForEvent("download");
		await this.paymentRow(receiptNumber).getByRole("button", { name: "Receipt", exact: true }).click();
		return download;
	}

	/** "Download receipt" in the Payment recorded dialog. */
	async downloadReceiptFromDialog() {
		const download = this.page.waitForEvent("download");
		await this.receiptDialog().getByRole("button", { name: "Download receipt" }).click();
		return download;
	}

	async markBounced(receiptNumber: string) {
		await this.paymentRow(receiptNumber).getByRole("button", { name: "Mark bounced" }).click();
	}

	// ---- refunds, waivers, adjustments ----
	async openWaiver(invoiceNumber: string) {
		await this.invoiceRow(invoiceNumber).getByRole("button", { name: "Waive" }).click();
		await this.dialog(/Waive invoice/).waitFor();
	}

	waiverDialog() {
		return this.dialog(/Waive invoice/);
	}

	async fillCorrection(dialog: Locator, input: { amount?: number; reason?: string; approver?: string; proof?: { name: string; mimeType: string; buffer: Buffer } }) {
		if (input.amount !== undefined) await dialog.getByRole("spinbutton", { name: "Amount" }).fill(String(input.amount));
		if (input.reason !== undefined) await dialog.getByLabel("Reason").fill(input.reason);
		if (input.approver) {
			await dialog.getByRole("combobox", { name: /Approved by/ }).click();
			await this.page.getByRole("option", { name: input.approver }).click();
		}
		if (input.proof) await dialog.locator("input[type=file]").setInputFiles(input.proof);
	}

	async submitWaiver() {
		await this.waiverDialog().getByRole("button", { name: "Waive", exact: true }).click();
	}

	async openAdjustment(invoiceNumber: string) {
		await this.invoiceRow(invoiceNumber).getByRole("button", { name: "Adjust" }).click();
		await this.dialog(/Adjust invoice/).waitFor();
	}

	adjustmentDialog() {
		return this.dialog(/Adjust invoice/);
	}

	async submitAdjustment() {
		await this.adjustmentDialog().getByRole("button", { name: "Apply", exact: true }).click();
	}

	async openRefund(receiptNumber: string) {
		await this.paymentRow(receiptNumber).getByRole("button", { name: "Refund" }).click();
		await this.dialog(/Refund payment/).waitFor();
	}

	refundDialog() {
		return this.dialog(/Refund payment/);
	}

	/** The red "Missing required permission" style banner shown instead of the student's fees. */
	accessBanner() {
		return this.page.getByRole("alert").filter({ hasText: /Missing required permission/ });
	}
}
