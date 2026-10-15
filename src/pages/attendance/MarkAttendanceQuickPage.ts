import type { Page } from "@playwright/test";

/** /attendance/mark: the focused "mark today" screen. Always today's date, so it works only on a section of the current year. */
export class MarkAttendanceQuickPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/attendance/mark");
		await this.page.getByRole("combobox", { name: "Class" }).waitFor();
	}

	async choose(className: string, sectionName: string) {
		await this.page.getByRole("combobox", { name: "Class" }).click();
		await this.page.getByRole("option", { name: className, exact: true }).click();
		await this.page.getByRole("combobox", { name: "Section" }).click();
		await this.page.getByRole("option", { name: sectionName, exact: true }).click();
	}

	row(studentName: string) {
		return this.page.getByRole("row").filter({ hasText: studentName });
	}

	async markAllPresent() {
		await this.page.getByRole("button", { name: "Mark all present" }).click();
	}

	async submit() {
		await this.page.getByRole("button", { name: "Submit", exact: true }).click();
	}

	success() {
		return this.page.getByRole("alert").filter({ hasText: "Attendance marked for today." });
	}

	alreadyMarked() {
		return this.page.getByRole("alert").filter({ hasText: "already been marked today" });
	}
}
