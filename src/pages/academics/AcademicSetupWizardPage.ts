import type { Page } from "@playwright/test";

/** The guided /academics/setup wizard: academic year, school setup template, grade levels, subjects, classes / sections, review. */
export class AcademicSetupWizardPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/academics/setup");
		await this.page.getByRole("heading", { name: "Academic setup", exact: true }).waitFor();
	}

	step(label: string) {
		return this.page.getByRole("tab", { name: new RegExp(label) });
	}

	async next() {
		await this.page.getByRole("button", { name: /^(Continue|Save and continue)$/ }).click();
	}

	reviewRow(label: string) {
		return this.page.getByText(label, { exact: true });
	}

	/** The innermost div holding the label is that row's own Stack, so the check icon can't come from another row. */
	reviewRowDoneIcon(label: string) {
		return this.page.locator("div").filter({ has: this.reviewRow(label) }).last().getByTestId("CheckCircleIcon");
	}

	async finish() {
		await this.page.getByRole("button", { name: "Finish setup" }).click();
	}
}
