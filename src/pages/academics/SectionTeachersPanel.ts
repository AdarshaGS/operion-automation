import type { Page } from "@playwright/test";

/** "Teacher assignments" on a section page (/academics/classes/:id/sections/:sectionId). */
export class SectionTeachersPanel {
	constructor(private readonly page: Page) {}

	async assign(assignment: { type: "HOMEROOM" | "SUBJECT" | "CO_TEACHER"; subject?: string; teacher: string; startDate: string }) {
		await this.page.getByRole("button", { name: "Assign teacher" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Assign teacher" });
		await dialog.getByRole("combobox", { name: /^Type/ }).click();
		await this.page.getByRole("option", { name: assignment.type, exact: true }).click();
		if (assignment.subject) {
			await dialog.getByRole("combobox", { name: /^Subject/ }).click();
			await this.page.getByRole("option", { name: assignment.subject, exact: true }).click();
		}
		await dialog.getByRole("combobox", { name: /^Teacher/ }).click();
		await this.page.getByRole("option", { name: assignment.teacher, exact: true }).click();
		await dialog.getByLabel(/^Start date/).fill(assignment.startDate);
		await dialog.getByRole("button", { name: "Assign", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	row(type: string, teacher: string) {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name: type, exact: true }) }).filter({ hasText: teacher });
	}
}
