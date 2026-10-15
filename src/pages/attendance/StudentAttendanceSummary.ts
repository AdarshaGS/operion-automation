import type { Page } from "@playwright/test";

/** The "Attendance" panel of a student's detail page (/students/:id): month and year pickers and a percentage chip. */
export class StudentAttendanceSummary {
	constructor(private readonly page: Page) {}

	async open(studentId: number) {
		await this.page.goto(`/students/${studentId}`);
	}

	async pick(year: number, monthName: string) {
		await this.page.getByRole("spinbutton", { name: "Year" }).fill(String(year));
		await this.page.getByRole("combobox", { name: "Month" }).click();
		await this.page.getByRole("option", { name: monthName, exact: true }).click();
	}

	percentage() {
		return this.page.getByText(/% present$/);
	}

	counts() {
		return this.page.getByText(/days marked$/);
	}
}
