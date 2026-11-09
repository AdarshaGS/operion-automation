import type { Page } from "@playwright/test";

/** /portal/teacher - a teacher's sections, leave balance and leave requests. */
export class TeacherPortalPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/portal/teacher");
		await this.page.getByRole("heading", { name: "Teacher portal" }).waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Teacher portal" });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async requestLeave(input: { leaveType: string; start: string; end: string; days: number; reason?: string }) {
		await this.page.getByRole("button", { name: /Request leave/ }).click();
		const dialog = this.dialog();
		await dialog.getByRole("combobox", { name: "Leave type" }).click();
		await this.page.getByRole("option", { name: input.leaveType, exact: true }).click();
		await dialog.getByLabel("Start date").fill(input.start);
		await dialog.getByLabel("End date").fill(input.end);
		await dialog.getByLabel("Number of days").fill(String(input.days));
		if (input.reason) await dialog.getByLabel("Reason").fill(input.reason);
		await dialog.getByRole("button", { name: "Submit" }).click();
	}

	leaveRow(leaveType: string) {
		return this.page.getByRole("row").filter({ hasText: leaveType });
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}
}
