import type { Page } from "@playwright/test";

export interface NewStudentInput {
	firstName: string;
	lastName: string;
	admissionNumber: string;
	admissionDate: string; // YYYY-MM-DD
	dateOfBirth?: string;
	gender?: string;
	previousSchool?: string;
	/** Admission now enrols the student in the same step - year, class and section are required. */
	enrolment: { academicYearName: string; className: string; sectionName: string; rollNumber?: number };
	phone?: string;
	address?: string;
	bloodGroup?: string;
	category?: string;
	nationality?: string;
	medicalAlerts?: string;
	emergencyContactName?: string;
	emergencyContactPhone?: string;
	/** The form's inline "Primary guardian" section (optional on the page). */
	guardian?: { firstName: string; lastName: string; phone?: string; relationship?: string; gender?: string };
}

export class StudentCreatePage {
	constructor(private readonly page: Page) {}

	async fill(input: NewStudentInput) {
		// Anchored regex rather than exact: required fields render as "First name *", and the form
		// also has "Guardian first/last name" fields that a plain substring match would hit.
		await this.page.getByLabel(/^First name/).fill(input.firstName);
		await this.page.getByLabel(/^Last name/).fill(input.lastName);
		if (input.dateOfBirth) await this.page.getByLabel("Date of birth").fill(input.dateOfBirth);
		// Gender is a required dropdown (Male / Female / Other), not free text.
		await this.page.getByRole("combobox", { name: /^Gender/ }).click();
		await this.page.getByRole("option", { name: input.gender ?? "Other", exact: true }).click();
		await this.page.getByLabel("Admission number").fill(input.admissionNumber);
		await this.page.getByLabel("Admission date").fill(input.admissionDate);
		if (input.previousSchool) await this.page.getByLabel("Previous school").fill(input.previousSchool);

		await this.page.getByRole("combobox", { name: /^Academic year/ }).click();
		await this.page.getByRole("option", { name: input.enrolment.academicYearName }).click();
		await this.page.getByRole("combobox", { name: /^Class/ }).click();
		await this.page.getByRole("option", { name: input.enrolment.className }).click();
		await this.page.getByRole("combobox", { name: /^Section/ }).click();
		await this.page.getByRole("option", { name: input.enrolment.sectionName, exact: true }).click();
		if (input.enrolment.rollNumber) await this.page.getByLabel("Roll number").fill(String(input.enrolment.rollNumber));
	}

	/** Everything the sanity admission types in: fill() plus the optional details and the guardian.
	 * The admission number may be empty - the form then leaves it for the backend to generate. */
	async fillAll(input: Omit<NewStudentInput, "admissionNumber"> & { admissionNumber?: string }) {
		await this.fill({ ...input, admissionNumber: input.admissionNumber ?? "" });
		if (input.phone) await this.page.getByLabel("Phone", { exact: true }).fill(input.phone);
		if (input.address) await this.page.getByLabel("Home address").fill(input.address);
		if (input.bloodGroup) await this.page.getByLabel("Blood group").fill(input.bloodGroup);
		if (input.category) await this.page.getByLabel("Category").fill(input.category);
		if (input.nationality) await this.page.getByLabel("Nationality").fill(input.nationality);
		if (input.medicalAlerts) await this.page.getByLabel("Medical alerts / allergies").fill(input.medicalAlerts);
		if (input.emergencyContactName) await this.page.getByLabel("Emergency contact name").fill(input.emergencyContactName);
		if (input.emergencyContactPhone) await this.page.getByLabel("Emergency contact phone").fill(input.emergencyContactPhone);
		const guardian = input.guardian;
		if (guardian) {
			await this.page.getByLabel("Guardian first name").fill(guardian.firstName);
			await this.page.getByLabel("Guardian last name").fill(guardian.lastName);
			// Guardian gender is required as soon as a guardian name is typed.
			await this.page.getByRole("combobox", { name: /^Guardian gender/ }).click();
			await this.page.getByRole("option", { name: guardian.gender ?? "Other", exact: true }).click();
			if (guardian.phone) await this.page.getByLabel("Guardian mobile").fill(guardian.phone);
			if (guardian.relationship) {
				await this.page.getByRole("combobox", { name: "Relationship" }).click();
				await this.page.getByRole("option", { name: guardian.relationship, exact: true }).click();
			}
		}
	}

	heading() {
		return this.page.getByRole("heading", { name: "Admit student" });
	}

	async submit() {
		await this.page.getByRole("button", { name: "Admit student" }).click();
	}
}
