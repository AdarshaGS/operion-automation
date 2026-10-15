import type { Page } from "@playwright/test";

/** The guided /setup/structure wizard: organisation profile, business settings, academic year, campuses (optional), review - departments and designations come from the school setup template. */
export class StructureSetupPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/setup/structure");
		await this.page.getByRole("heading", { name: "Structure setup" }).waitFor();
	}

	step(label: string) {
		return this.page.getByRole("tab", { name: new RegExp(label) });
	}

	async goToStep(label: string) {
		await this.step(label).click();
	}

	async next() {
		await this.page.getByRole("button", { name: /^(Continue|Save and continue)$/ }).click();
	}

	async back() {
		await this.page.getByRole("button", { name: "Back" }).click();
	}

	async exitToDashboard() {
		await this.page.getByRole("button", { name: "Exit to dashboard" }).click();
	}

	async finish() {
		await this.page.getByRole("button", { name: "Finish setup" }).click();
	}

	/** The review section only - completed stepper tabs carry the same labels and check icons. */
	private reviewSection() {
		return this.page.locator("div").filter({ has: this.page.getByRole("heading", { name: "Review and finish" }) }).last();
	}

	reviewRow(label: string) {
		return this.reviewSection().getByText(label, { exact: true });
	}

	/** A review row is done when its icon is the filled check (MUI's default data-testid), not the empty circle. */
	reviewRowDoneIcon(label: string) {
		// The innermost div holding the label is that row's own Stack, so the icon lookup can't leak into another row.
		return this.reviewSection().locator("div").filter({ has: this.page.getByText(label, { exact: true }) }).last().getByTestId("CheckCircleIcon");
	}
}
