import type { Locator, Page } from "@playwright/test";

/** /hr - four panels on one page: Leave types, Staff, Pending leave requests, Pending job applications. */
export class HrPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/hr");
		await this.page.getByRole("heading", { name: "Leave types" }).waitFor();
	}

	/** The Paper holding a panel, found by its heading. */
	panel(heading: "Leave types" | "Staff" | "Pending leave requests" | "Pending job applications") {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: heading, exact: true }) }).last();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	// Leave types
	leaveTypeRow(name: string) {
		return this.panel("Leave types").getByRole("row").filter({ hasText: name });
	}

	async addLeaveType(input: { code: string; name: string; defaultAnnualDays?: number }) {
		await this.panel("Leave types").getByRole("button", { name: "Add leave type" }).click();
		const dialog = this.dialog();
		await dialog.getByLabel("Code").fill(input.code);
		await dialog.getByLabel("Name").fill(input.name);
		if (input.defaultAnnualDays !== undefined) await dialog.getByLabel("Default annual days").fill(String(input.defaultAnnualDays));
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	// Staff
	staffRow(employeeCode: string) {
		return this.panel("Staff").getByRole("row").filter({ hasText: employeeCode });
	}

	// Pending leave requests / job applications: one row each, with Approve and Reject buttons.
	pendingLeaveRow(text: string | RegExp) {
		return this.panel("Pending leave requests").getByRole("row").filter({ hasText: text });
	}

	applicationRow(text: string | RegExp) {
		return this.panel("Pending job applications").getByRole("row").filter({ hasText: text });
	}

	button(row: Locator, name: "Approve" | "Reject") {
		return row.getByRole("button", { name });
	}

	/** The "Upcoming holidays (next 60 days)" strip above the pending leave requests. */
	upcomingHolidaysHeading() {
		return this.page.getByText("Upcoming holidays (next 60 days)");
	}

	holidayChip(text: string | RegExp) {
		return this.page.locator(".MuiChip-root").filter({ hasText: text });
	}
}
