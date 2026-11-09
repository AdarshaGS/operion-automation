import type { Page } from "@playwright/test";

/** /portal/payslips - the signed-in staff member's own finalized payslips. */
export class MyPayslipsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/portal/payslips");
		await this.page.getByRole("heading", { name: "My payslips" }).waitFor();
	}

	row(month: string) {
		return this.page.getByRole("row").filter({ hasText: month });
	}
}
