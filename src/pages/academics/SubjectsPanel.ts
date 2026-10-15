import type { Page } from "@playwright/test";

/** Academics > Subjects (also the Subjects step of the academic-setup wizard): the organisation's subject list. */
export class SubjectsPanel {
	constructor(private readonly page: Page) {}

	heading() {
		return this.page.getByRole("heading", { name: "Subjects", exact: true, level: 6 });
	}

	async add(subject: { name: string; code: string }) {
		await this.page.getByRole("button", { name: "Add subject" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add subject" });
		await dialog.getByLabel(/^Name/).fill(subject.name);
		await dialog.getByLabel(/^Code/).fill(subject.code);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	row(name: string) {
		return this.page.getByRole("row").filter({ has: this.page.getByRole("cell", { name, exact: true }) });
	}
}
