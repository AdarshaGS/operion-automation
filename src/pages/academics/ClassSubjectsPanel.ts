import type { Page } from "@playwright/test";

/** "Class subjects" on a class page (/academics/classes/:id): which subjects the class studies, mandatory or elective. */
export class ClassSubjectsPanel {
	constructor(private readonly page: Page) {}

	heading() {
		return this.page.getByRole("heading", { name: "Class subjects", exact: true });
	}

	async assign(subjectName: string, mandatory: boolean) {
		await this.page.getByRole("button", { name: "Assign subject" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Assign subject" });
		await dialog.getByRole("combobox", { name: /^Subject/ }).click();
		await this.page.getByRole("option", { name: subjectName, exact: true }).click();
		await dialog.getByRole("combobox", { name: /^Mandatory/ }).click();
		await this.page.getByRole("option", { name: mandatory ? "Yes" : "No (elective)", exact: true }).click();
		await dialog.getByRole("button", { name: "Assign", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	row(subjectName: string) {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name: subjectName, exact: true }) });
	}
}
