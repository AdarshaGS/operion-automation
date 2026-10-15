import type { Locator, Page } from "@playwright/test";

/** /learning (and /portal/teaching): tabs for homework, quizzes, materials, lesson plans, answer sheets and leaderboards. */
export class LearningPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/learning");
		await this.page.getByRole("tab", { name: "Homework" }).waitFor();
	}

	async tab(name: "Homework" | "Quizzes" | "Materials" | "Lesson plans" | "Answer sheets" | "Leaderboards") {
		await this.page.getByRole("tab", { name }).click();
	}

	dialog(title: string | RegExp) {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: title }) });
	}

	/** MUI select inside `scope` (a dialog or the page). */
	async choose(scope: Locator | Page, label: string, option: string) {
		await scope.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	row(text: string) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	button(name: string) {
		return this.page.getByRole("button", { name, exact: true });
	}

	// homework

	async assignHomework(input: { section: string; subject: string; title: string; dueDate: string; instructions?: string }) {
		await this.button("Assign").click();
		const dialog = this.dialog("Assign homework");
		await this.choose(dialog, "Section", input.section);
		await this.choose(dialog, "Subject", input.subject);
		await dialog.getByLabel("Title").fill(input.title);
		if (input.instructions) await dialog.getByLabel("Instructions").fill(input.instructions);
		await dialog.getByLabel("Due date").fill(input.dueDate);
		await dialog.getByRole("button", { name: "Assign" }).click();
	}

	async trackHomework(title: string) {
		await this.row(title).getByRole("button", { name: "Track" }).click();
		return this.dialog(`${title} – submissions`);
	}

	async reviewSubmission(tracker: Locator, studentName: string, feedback: string) {
		await tracker.getByRole("row").filter({ hasText: studentName }).getByRole("button", { name: "Review" }).click();
		await tracker.getByLabel(`Feedback for ${studentName}`).fill(feedback);
		await tracker.getByRole("button", { name: "Mark reviewed" }).click();
	}

	// quizzes

	async createQuiz(input: { section: string; subject: string; title: string; opensAt: string; closesAt: string }) {
		await this.button("New quiz").click();
		const dialog = this.dialog("New quiz");
		await this.choose(dialog, "Section", input.section);
		await this.choose(dialog, "Subject", input.subject);
		await dialog.getByLabel("Title").fill(input.title);
		await dialog.getByLabel("Opens").fill(input.opensAt);
		await dialog.getByLabel("Closes").fill(input.closesAt);
		await dialog.getByRole("button", { name: "Create draft" }).click();
		return dialog;
	}

	async addQuestion(quizDialog: Locator, input: { text: string; marks: number; options: string[]; correct: number }) {
		await quizDialog.getByLabel("Question", { exact: true }).fill(input.text);
		await quizDialog.getByLabel("Marks").fill(String(input.marks));
		for (let i = 2; i < input.options.length; i++) await quizDialog.getByRole("button", { name: "Add option" }).click();
		for (const [i, text] of input.options.entries()) await quizDialog.getByLabel(`Option ${i + 1}`, { exact: true }).fill(text);
		await quizDialog.getByLabel(`Option ${input.correct + 1} is correct`).check();
		await quizDialog.getByRole("button", { name: "Add question" }).click();
	}

	// lesson plans

	async newLessonPlan(input: { section: string; subject: string; date: string; title: string; objectives?: string }) {
		await this.button("New plan").click();
		const dialog = this.dialog("New lesson plan");
		await this.choose(dialog, "Section", input.section);
		await this.choose(dialog, "Subject", input.subject);
		await dialog.getByLabel("Date").fill(input.date);
		await dialog.getByLabel("Title").fill(input.title);
		if (input.objectives) await dialog.getByLabel("Objectives").fill(input.objectives);
		await dialog.getByRole("button", { name: "Save draft" }).click();
		return dialog;
	}

	// leaderboards

	async showBoard(section: string, track: "Quizzes" | "Academic" | "Rewards") {
		await this.choose(this.page, "Section", section);
		await this.page.getByRole("button", { name: track, exact: true }).click();
	}

	async grantReward(input: { student: string; title: string; points: number; reason?: string }) {
		await this.button("Grant reward").click();
		const dialog = this.dialog("Grant reward");
		await this.choose(dialog, "Student", input.student);
		await dialog.getByLabel("Title").fill(input.title);
		await dialog.getByLabel("Points (1-100)").fill(String(input.points));
		if (input.reason) await dialog.getByLabel("Reason (optional)").fill(input.reason);
		await dialog.getByRole("button", { name: "Grant" }).click();
		return dialog;
	}
}
