import type { Page } from "@playwright/test";

/** Settings > Academic years (also step 1 of the academic-setup wizard): add a year, mark it current. */
export class AcademicYearsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/academic-years");
		await this.heading().waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Academic years", exact: true, level: 6 });
	}

	async add(year: { name: string; startDate: string; endDate: string }) {
		await this.page.getByRole("button", { name: "Add academic year" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add academic year" });
		await dialog.getByLabel(/^Name/).fill(year.name);
		await dialog.getByLabel(/^Start date/).fill(year.startDate);
		await dialog.getByLabel(/^End date/).fill(year.endDate);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	row(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	async markCurrent(name: string) {
		await this.row(name).getByRole("button", { name: "Mark current" }).click();
	}

	currentChip(name: string) {
		return this.row(name).getByText("Current", { exact: true });
	}
}
