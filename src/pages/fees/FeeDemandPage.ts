import type { Page } from "@playwright/test";

/** /fees/demand: overdue invoices across the school, filter by class, send reminders. */
export class FeeDemandPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/fees/demand");
		await this.page.getByRole("heading", { name: "Overdue invoices" }).waitFor();
	}

	async filterByClass(className: string) {
		await this.page.getByRole("combobox", { name: "Class" }).click();
		await this.page.getByRole("option", { name: className, exact: true }).click();
	}

	row(invoiceNumber: string) {
		return this.page.getByRole("row").filter({ hasText: invoiceNumber });
	}

	async select(invoiceNumber: string) {
		await this.row(invoiceNumber).getByRole("checkbox").check();
	}

	async selectAll() {
		await this.page.getByRole("row").first().getByRole("checkbox").check();
	}

	sendButton() {
		return this.page.getByRole("button", { name: /Send reminders/ });
	}

	async sendReminders() {
		await this.sendButton().click();
	}

	notice() {
		return this.page.getByRole("alert").filter({ hasText: /^Sent \d+ reminder/ });
	}

	empty() {
		return this.page.getByRole("alert").filter({ hasText: /No overdue invoices/ });
	}
}
