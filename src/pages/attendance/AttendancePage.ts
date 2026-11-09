import type { Page } from "@playwright/test";

/** /attendance: pick class, section and date, load the register, mark, submit, lock, correct. */
export class AttendancePage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/attendance");
		// The page lands on the Overview tab (which has its own Class filter); the register is the second tab.
		await this.page.getByRole("tab", { name: "Class Register" }).click();
		await this.page.getByRole("button", { name: "Load", exact: true }).waitFor();
	}

	async choose(className: string, sectionName: string) {
		await this.page.getByRole("combobox", { name: "Class" }).click();
		await this.page.getByRole("option", { name: classOption(className) }).click();
		await this.page.getByRole("combobox", { name: "Section" }).click();
		await this.page.getByRole("option", { name: sectionName, exact: true }).click();
	}

	async load(date: string) {
		await this.page.getByLabel("Date").fill(date);
		await this.page.getByRole("button", { name: "Load", exact: true }).click();
	}

	async chooseAndLoad(className: string, sectionName: string, date: string) {
		await this.choose(className, sectionName);
		await this.load(date);
	}

	row(studentName: string) {
		return this.page.getByRole("row").filter({ hasText: studentName });
	}

	async markAllPresent() {
		await this.page.getByRole("button", { name: "Mark all present" }).click();
	}

	/** Sets the status dropdown in a draft row. */
	async setStatus(studentName: string, status: string) {
		await this.row(studentName).getByRole("combobox").click();
		await this.page.getByRole("option", { name: status, exact: true }).click();
	}

	async setExcused(studentName: string) {
		await this.row(studentName).getByRole("checkbox").check();
	}

	async setRemarks(studentName: string, remarks: string) {
		await this.row(studentName).getByRole("textbox").fill(remarks);
	}

	async submitMarks() {
		await this.page.getByRole("button", { name: "Submit marks" }).click();
	}

	registerStatus(status: "DRAFT" | "SUBMITTED" | "LOCKED") {
		return this.page.getByText(status, { exact: true });
	}

	async submitRegister() {
		await this.page.getByRole("button", { name: "Submit", exact: true }).click();
	}

	async lockRegister() {
		await this.page.getByRole("button", { name: "Lock", exact: true }).click();
	}

	countChip(text: string) {
		return this.page.getByText(text, { exact: true });
	}

	correctButton(studentName: string) {
		return this.row(studentName).getByRole("button", { name: "Correct" });
	}

	unlockButton() {
		return this.page.getByRole("button", { name: /unlock/i });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async correct(studentName: string, newStatus: string, reason: string) {
		await this.correctButton(studentName).click();
		const dialog = this.dialog();
		await dialog.getByRole("combobox", { name: "New status" }).click();
		await this.page.getByRole("option", { name: newStatus, exact: true }).click();
		if (reason) await dialog.getByLabel("Reason").fill(reason);
		await dialog.getByRole("button", { name: "Save" }).click();
	}

	alert() {
		return this.page.getByRole("alert");
	}
}

/** Class pickers label options "<class> · <campus>"; match the class name with or without that suffix. */
export function classOption(className: string) {
	const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}( · .+)?$`);
}
