import type { Page } from "@playwright/test";

/** /payroll - the "Payroll runs" and "Salary components" tabs. */
export class PayrollPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/payroll");
		await this.page.getByRole("heading", { name: "Payroll runs", exact: true }).waitFor();
	}

	async showComponents() {
		await this.page.getByRole("tab", { name: "Salary components" }).click();
		await this.page.getByRole("heading", { name: "Salary components", exact: true }).waitFor();
	}

	// Runs
	async generate(input: { month: string; year: number }) {
		await this.page.getByRole("combobox", { name: "Month" }).click();
		await this.page.getByRole("option", { name: input.month, exact: true }).click();
		await this.page.getByLabel("Year").fill(String(input.year));
		await this.page.getByRole("button", { name: "Generate run" }).click();
	}

	runRow(period: string) {
		return this.page.getByRole("row").filter({ hasText: period });
	}

	generateButton() {
		return this.page.getByRole("button", { name: "Generate run" });
	}

	/** The red error alert (the page also has blue "nothing yet" alerts). */
	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	// Components
	async addComponent(input: { name: string; type?: "Earning" | "Deduction"; basis?: "Flat amount" | "Percentage of basic" }) {
		await this.page.getByLabel("Name").fill(input.name);
		if (input.type) {
			await this.page.getByRole("combobox", { name: "Type" }).click();
			await this.page.getByRole("option", { name: input.type, exact: true }).click();
		}
		if (input.basis) {
			await this.page.getByRole("combobox", { name: "Calculated as" }).click();
			await this.page.getByRole("option", { name: input.basis, exact: true }).click();
		}
		await this.page.getByRole("button", { name: "Add component" }).click();
	}

	componentRow(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	addComponentButton() {
		return this.page.getByRole("button", { name: "Add component" });
	}
}
