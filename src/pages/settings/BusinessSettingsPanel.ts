import type { Page } from "@playwright/test";

/** Settings > Business settings (timezone, currency, date format, working days). */
export class BusinessSettingsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/business");
		await this.currencyField().waitFor();
	}

	timezoneField() {
		return this.page.getByRole("combobox", { name: /^Timezone/ });
	}

	async setTimezone(name: string) {
		await this.timezoneField().click();
		await this.page.getByRole("option", { name, exact: true }).click();
	}

	currencyField() {
		return this.page.getByLabel(/^Default currency/);
	}

	dateFormatField() {
		return this.page.getByLabel(/^Date format/);
	}

	primaryColourField() {
		return this.page.getByLabel(/^Primary color/);
	}

	async setCurrency(code: string) {
		await this.currencyField().fill(code);
	}

	async setDateFormat(format: string) {
		await this.dateFormatField().fill(format);
	}

	/** Working-day checkboxes are labelled by day name. */
	workingDay(day: string) {
		return this.page.getByRole("checkbox", { name: new RegExp(day, "i") });
	}

	/** Sets every working-day checkbox so exactly `days` are ticked. */
	async setWorkingDays(days: string[]) {
		for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
			await this.workingDay(day).setChecked(days.includes(day));
		}
	}

	async save() {
		await this.page.getByRole("button", { name: "Save" }).click();
	}

	successAlert() {
		return this.page.getByText("Settings updated");
	}
}
