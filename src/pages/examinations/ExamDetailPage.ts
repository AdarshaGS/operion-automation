import type { Page } from "@playwright/test";

/** /examinations/exams/:id: schedules table and the publish-report-card dialog. */
export class ExamDetailPage {
	constructor(private readonly page: Page) {}

	async open(examId: number) {
		await this.page.goto(`/examinations/exams/${examId}`);
		// The exam page is tabbed (Overview first); the tab bar is the stable "loaded" signal.
		await this.page.getByRole("tab", { name: "Report cards" }).waitFor();
	}

	async addSchedule(input: { className: string; sectionName?: string; subjectName: string; date: string; maxMarks: number; passMarks: number }) {
		await this.openTab("Schedule");
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

	/** Opens a tab of the exam page; a no-op when it is already selected. */
	async openTab(name: "Overview" | "Schedule" | "Marks entry" | "Results" | "Report cards") {
		const tab = this.page.getByRole("tab", { name, exact: true });
		if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
	}

	scheduleRow(subjectName: string) {
		return this.page.getByRole("row").filter({ hasText: subjectName });
	}

	async openSchedule(subjectName: string) {
		await this.openTab("Schedule");
		await this.scheduleRow(subjectName).click();
	}

	async publishReportCard(studentText: string, scaleName: string) {
		await this.openTab("Report cards");
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

	async openReportCardsTab() {
		await this.openTab("Report cards");
	}

	/** Downloads the PDF of the card just published (the one in the summary). */
	downloadPdfButton() {
		return this.page.getByRole("button", { name: "Download PDF" });
	}

	async chooseSectionForPdf(className: string, sectionName: string) {
		await this.page.getByRole("combobox", { name: "Section" }).click();
		await this.page.getByRole("option", { name: new RegExp(`^${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( · .+)? - ${sectionName}$`) }).click();
	}

	downloadSectionPdfButton() {
		return this.page.getByRole("button", { name: "Download section report cards (PDF)" });
	}

	alert() {
		return this.page.getByRole("alert");
	}
}
