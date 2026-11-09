import type { Page } from "@playwright/test";

/** /payroll/runs/:id - one run's totals, payslips and lifecycle buttons. */
export class PayrollRunPage {
	constructor(private readonly page: Page) {}

	async open(runId: number) {
		await this.page.goto(`/payroll/runs/${runId}`);
		await this.page.getByRole("heading", { name: /^Payroll - / }).waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: /^Payroll - / });
	}

	finalizeButton() {
		return this.page.getByRole("button", { name: "Finalize run" });
	}

	discardButton() {
		return this.page.getByRole("button", { name: "Discard draft" });
	}

	correctionButton() {
		return this.page.getByRole("button", { name: "Start correction run" });
	}

	totalsRow(label: "Teachers" | "Other staff") {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name: label, exact: true }) });
	}

	payslipRow(employeeCode: string) {
		return this.page.getByRole("row").filter({ hasText: employeeCode });
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}
}
