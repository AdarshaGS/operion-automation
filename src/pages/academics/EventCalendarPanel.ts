import type { Page } from "@playwright/test";

/** Communication > Events calendar: month grid with working-calendar entries and school events. */
export class EventCalendarPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/communication");
		await this.page.getByRole("heading", { name: "Events calendar" }).waitFor();
	}

	addDialog() {
		return this.page.getByRole("dialog", { name: "Add school event" });
	}

	async openAdd() {
		await this.page.getByRole("button", { name: "Add event" }).click();
		await this.addDialog().waitFor();
	}

	async fillEvent(values: { date: string; title: string; description?: string }) {
		await this.addDialog().getByLabel(/^Date/).fill(values.date);
		await this.addDialog().getByLabel(/^Title/).fill(values.title);
		if (values.description !== undefined) await this.addDialog().getByLabel("Description").fill(values.description);
	}

	async submitAdd() {
		await this.addDialog().getByRole("button", { name: "Add", exact: true }).click();
	}

	/** A chip on the grid (holiday, special working day or event) by its visible text. */
	chip(text: string) {
		return this.page.getByText(text, { exact: true });
	}

	async nextMonth() {
		await this.page.getByRole("button", { name: "Next month" }).click();
	}

	async previousMonth() {
		await this.page.getByRole("button", { name: "Previous month" }).click();
	}
}
