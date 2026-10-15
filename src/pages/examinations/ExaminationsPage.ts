import type { Page } from "@playwright/test";

/** /examinations: settings panel, grading scales panel and the exams list for an academic year. */
export class ExaminationsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/examinations");
		await this.page.getByRole("heading", { name: "Examination settings" }).waitFor();
	}

	// settings
	async chooseStrategy(label: string) {
		await this.page.getByRole("combobox", { name: "Overall pass/fail strategy" }).click();
		await this.page.getByRole("option", { name: label, exact: true }).click();
	}

	rankingSwitch() {
		return this.page.getByLabel("Compute subject-wise and class-wise rank");
	}

	thresholdField() {
		return this.page.getByLabel("Minimum aggregate percentage");
	}

	async saveSettings() {
		await this.page.getByRole("button", { name: "Save", exact: true }).click();
	}

	saved() {
		return this.page.getByRole("alert").filter({ hasText: "Saved." });
	}

	// grading scales
	async addScale(input: { name: string; defaultScale?: boolean; bands: { grade: string; min: number; remark?: string }[] }) {
		await this.page.getByRole("button", { name: "Add grading scale" }).click();
		const dialog = this.page.getByRole("dialog");
		await dialog.getByLabel("Name").fill(input.name);
		if (input.defaultScale) await dialog.getByLabel("Default scale").check();
		for (let i = 1; i < input.bands.length; i++) await dialog.getByRole("button", { name: "Add band" }).click();
		for (const [i, band] of input.bands.entries()) {
			await dialog.getByLabel("Grade").nth(i).fill(band.grade);
			await dialog.getByLabel("Min %").nth(i).fill(String(band.min));
			if (band.remark) await dialog.getByLabel("Remark").nth(i).fill(band.remark);
		}
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	scaleRow(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	// exams
	async chooseYear(yearName: string) {
		await this.page.getByRole("combobox", { name: "Academic year" }).click();
		await this.page.getByRole("option", { name: yearName, exact: true }).click();
	}

	async addExam(name: string, type: string) {
		await this.page.getByRole("button", { name: "Add exam" }).click();
		const dialog = this.page.getByRole("dialog");
		await dialog.getByLabel("Name").fill(name);
		await dialog.getByRole("combobox", { name: "Type" }).click();
		await this.page.getByRole("option", { name: type, exact: true }).click();
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	examRow(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	addExamButton() {
		return this.page.getByRole("button", { name: "Add exam" });
	}

	addScaleButton() {
		return this.page.getByRole("button", { name: "Add grading scale" });
	}

	alert() {
		return this.page.getByRole("alert");
	}
}
