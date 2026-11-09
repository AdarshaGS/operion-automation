import type { Page } from "@playwright/test";

/** /payroll/payslips/:id - the admin payslip: lines, net pay, and (while the run is a draft) adjustments. */
export class PayslipPage {
	constructor(private readonly page: Page) {}

	async open(payslipId: number) {
		await this.page.goto(`/payroll/payslips/${payslipId}`);
		await this.page.getByRole("heading", { name: /^Payslip - / }).waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: /^Payslip - / });
	}

	lineRow(label: string) {
		return this.page.getByRole("row").filter({ hasText: label });
	}

	netPay() {
		return this.page.getByRole("heading", { name: "Net pay" }).locator("xpath=following-sibling::*[1]");
	}

	async addAdjustment(input: { label: string; type?: "Earning" | "Deduction"; amount: number }) {
		await this.page.getByLabel("Label").fill(input.label);
		if (input.type) {
			await this.page.getByRole("combobox", { name: "Type" }).click();
			await this.page.getByRole("option", { name: input.type, exact: true }).click();
		}
		await this.page.getByLabel("Amount").fill(String(input.amount));
		await this.page.getByRole("button", { name: "Add", exact: true }).click();
	}

	adjustmentForm() {
		return this.page.getByRole("heading", { name: "Add adjustment" });
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}
}
