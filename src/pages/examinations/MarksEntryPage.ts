import type { Page } from "@playwright/test";

/** /examinations/exams/:id/schedules/:id: enter marks, submit for review, approve, correct. */
export class MarksEntryPage {
	constructor(private readonly page: Page) {}

	async open(examId: number, scheduleId: number) {
		await this.page.goto(`/examinations/exams/${examId}/schedules/${scheduleId}`);
		await this.page.getByRole("button", { name: "Back to exam" }).waitFor();
	}

	row(studentName: string) {
		return this.page.getByRole("row").filter({ hasText: studentName });
	}

	async enter(studentName: string, marks: number | "absent", remarks?: string) {
		const row = this.row(studentName);
		if (marks === "absent") await row.getByRole("checkbox").check();
		else await row.getByRole("spinbutton").fill(String(marks));
		if (remarks) await row.getByRole("textbox").last().fill(remarks);
	}

	async saveMarks() {
		await this.page.getByRole("button", { name: "Submit marks" }).click();
	}

	registerStatus(status: "DRAFT" | "SUBMITTED" | "APPROVED") {
		return this.page.getByText(status, { exact: true });
	}

	async submitForReview() {
		await this.page.getByRole("button", { name: "Submit for review" }).click();
	}

	async approve() {
		await this.page.getByRole("button", { name: "Approve", exact: true }).click();
	}

	submitForReviewButton() {
		return this.page.getByRole("button", { name: "Submit for review" });
	}

	approveButton() {
		return this.page.getByRole("button", { name: "Approve", exact: true });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async correct(studentName: string, input: { marks?: number; absent?: boolean; remarks?: string }) {
		await this.row(studentName).getByRole("button", { name: /^Correct/ }).click();
		const dialog = this.dialog();
		if (input.marks !== undefined) await dialog.getByLabel("Marks obtained").fill(String(input.marks));
		if (input.absent !== undefined) await dialog.getByRole("checkbox").setChecked(input.absent);
		if (input.remarks !== undefined) await dialog.getByLabel("Remarks").fill(input.remarks);
		await dialog.getByRole("button", { name: "Save" }).click();
	}

	correctButton(studentName: string) {
		return this.row(studentName).getByRole("button", { name: /^Correct/ });
	}

	alert() {
		return this.page.getByRole("alert");
	}
}
