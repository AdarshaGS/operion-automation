import type { Page } from "@playwright/test";

/** /examinations/exams/:id: schedules table and the publish-report-card dialog. */
export class ExamDetailPage {
	constructor(private readonly page: Page) {}

	async open(examId: number) {
		await this.page.goto(`/examinations/exams/${examId}`);
		await this.page.getByRole("heading", { name: "Schedules" }).waitFor();
	}

	async addSchedule(input: { className: string; sectionName?: string; subjectName: string; date: string; maxMarks: number; passMarks: number }) {
		await this.page.getByRole("button", { name: "Add schedule" }).click();
		const dialog = this.page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Class" }).click();
		await this.page.getByRole("option", { name: input.className, exact: true }).click();
		if (input.sectionName) {
			await dialog.getByRole("combobox", { name: /Section/ }).click();
			await this.page.getByRole("option", { name: input.sectionName, exact: true }).click();
		}
		await dialog.getByRole("combobox", { name: "Subject" }).click();
		await this.page.getByRole("option", { name: input.subjectName, exact: true }).click();
		await dialog.getByLabel("Exam date").fill(input.date);
		await dialog.getByLabel("Max marks").fill(String(input.maxMarks));
		await dialog.getByLabel("Pass marks").fill(String(input.passMarks));
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	scheduleRow(subjectName: string) {
		return this.page.getByRole("row").filter({ hasText: subjectName });
	}

	async openSchedule(subjectName: string) {
		await this.scheduleRow(subjectName).click();
	}

	async publishReportCard(studentText: string, scaleName: string) {
		await this.page.getByRole("button", { name: "Publish report card" }).first().click();
		const dialog = this.page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Student" }).click();
		await this.page.getByRole("option", { name: studentText }).click();
		await dialog.getByRole("combobox", { name: "Grading scale" }).click();
		await this.page.getByRole("option", { name: scaleName, exact: true }).click();
		await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	}

	publishedSummary() {
		return this.page.getByRole("alert").filter({ hasText: /grade/ });
	}

	publishButton() {
		return this.page.getByRole("button", { name: "Publish report card" });
	}

	addScheduleButton() {
		return this.page.getByRole("button", { name: "Add schedule" });
	}

	alert() {
		return this.page.getByRole("alert");
	}
}
