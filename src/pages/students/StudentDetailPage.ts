import type { Page } from "@playwright/test";

export class StudentDetailPage {
	constructor(private readonly page: Page) {}

	async expectStudentIdInUrl() {
		return this.page.waitForURL(/\/students\/\d+$/);
	}

	studentName(fullName: string) {
		return this.page.getByText(fullName, { exact: true });
	}

	admissionNumber(value: string) {
		return this.page.getByText(value, { exact: true });
	}

	statusChip(status: string) {
		return this.page.getByText(status, { exact: true });
	}

	/** Moves Student.status ADMITTED -> ACTIVE (see Student.java) - the only UI path to
	 * that transition, added alongside this suite (StudentDetailPage.tsx's EnrollDialog). */
	async enroll(input: { academicYearName: string; className: string; sectionName: string; rollNumber?: number; enrolledDate: string }) {
		await this.page.getByRole("button", { name: "Enroll student" }).click();
		await this.page.getByRole("combobox", { name: "Academic year" }).click();
		await this.page.getByRole("option", { name: input.academicYearName }).click();
		await this.page.getByRole("combobox", { name: "Class" }).click();
		await this.page.getByRole("option", { name: input.className }).click();
		await this.page.getByRole("combobox", { name: "Section" }).click();
		await this.page.getByRole("option", { name: input.sectionName, exact: true }).click();
		if (input.rollNumber) await this.page.getByLabel("Roll number").fill(String(input.rollNumber));
		await this.page.getByLabel("Enrolled date").fill(input.enrolledDate);
		await this.page.getByRole("button", { name: "Enroll", exact: true }).click();
	}

	enrolledBanner() {
		// Scoped to the success Alert (role="alert") and anchored on "Enrolled -" (with the
		// dash) so this doesn't collide with the enroll dialog's "Enrolled date" field label,
		// which can still be in the DOM mid-close when this is checked.
		return this.page.getByRole("alert").filter({ hasText: "Enrolled -" });
	}

	panelHeading(name: string) {
		return this.page.getByRole("heading", { name, exact: true });
	}

	/** A panel is the Paper that holds the heading. */
	panel(name: string) {
		return this.page.locator("div.MuiPaper-root").filter({ has: this.panelHeading(name) }).last();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async addGuardian(input: { firstName: string; lastName: string; gender?: string; phone?: string; email?: string; relationship?: string; primary?: boolean; emergencyContact?: boolean; contactPriority?: number }) {
		await this.panel("Guardians").getByRole("button", { name: "Add guardian" }).click();
		const dialog = this.dialog();
		await dialog.getByLabel(/^First name/).fill(input.firstName);
		await dialog.getByLabel(/^Last name/).fill(input.lastName);
		await dialog.getByRole("combobox", { name: /^Gender/ }).click();
		await this.page.getByRole("option", { name: input.gender ?? "Other", exact: true }).click();
		if (input.phone) await dialog.getByLabel("Phone").fill(input.phone);
		if (input.email) await dialog.getByLabel("Email").fill(input.email);
		if (input.relationship) {
			await dialog.getByRole("combobox", { name: "Relationship" }).click();
			await this.page.getByRole("option", { name: input.relationship, exact: true }).click();
		}
		if (input.primary) await dialog.getByLabel("Primary guardian").check();
		if (input.emergencyContact) await dialog.getByLabel("Emergency contact").check();
		if (input.contactPriority) await dialog.getByLabel("Contact priority").fill(String(input.contactPriority));
		await dialog.getByRole("button", { name: /^Add/ }).last().click();
	}

	guardianRow(name: string) {
		return this.panel("Guardians").getByRole("row").filter({ hasText: name });
	}
}
