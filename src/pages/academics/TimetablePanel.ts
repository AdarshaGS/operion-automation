import type { Locator, Page } from "@playwright/test";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** Academics > Timetable: the weekly grid (table layout) and the cell dialog used to place or clear a slot. */
export class TimetablePanel {
	constructor(private readonly page: Page) {}

	periodRow(periodLabel: string) {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name: new RegExp(`^${periodLabel}\\b`) }) });
	}

	/** The cell for a weekday and period; column 0 is the period label. */
	cell(day: string, periodLabel: string): Locator {
		return this.periodRow(periodLabel).getByRole("cell").nth(DAYS.indexOf(day) + 1);
	}

	async openCell(day: string, periodLabel: string) {
		await this.cell(day, periodLabel).click();
		await this.dialog().waitFor();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async choosePair(text: string | RegExp) {
		await this.dialog().getByRole("combobox", { name: "Subject — teacher" }).click();
		await this.page.getByRole("option", { name: text }).click();
	}

	async save() {
		await this.dialog().getByRole("button", { name: "Save" }).click();
	}

	async clearSlot() {
		await this.dialog().getByRole("button", { name: "Clear slot" }).click();
	}

	async place(day: string, periodLabel: string, pair: string | RegExp) {
		await this.openCell(day, periodLabel);
		await this.choosePair(pair);
		await this.save();
		await this.dialog().waitFor({ state: "hidden" });
	}

	dialogError() {
		return this.dialog().getByRole("alert");
	}
}
