import type { Page } from "@playwright/test";

/** /portal/guardian - a parent's view: today's attendance, fees, exam results, announcements. */
export class GuardianPortalPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/portal/guardian");
		await this.page.getByRole("heading", { name: "Parent portal" }).waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Parent portal" });
	}

	childButton(name: string) {
		return this.page.getByRole("button", { name });
	}

	section(title: "Fee invoices" | "Payments" | "Exam results" | "Announcements") {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByText(title, { exact: true }) }).last();
	}

	invoiceRow(invoiceNumber: string) {
		return this.page.getByRole("row").filter({ hasText: invoiceNumber });
	}

	paymentRow(receiptNumber: string) {
		return this.section("Payments").getByRole("row").filter({ hasText: receiptNumber });
	}

	/** The Download button on a Payments row; resolves to the browser download it starts. */
	async downloadReceipt(receiptNumber: string) {
		const download = this.page.waitForEvent("download");
		await this.paymentRow(receiptNumber).getByRole("button", { name: "Download" }).click();
		return download;
	}

	resultRow(examName: string) {
		return this.section("Exam results").getByRole("row").filter({ hasText: examName });
	}

	learningLink() {
		return this.page.getByRole("link", { name: /Homework/ });
	}
}
