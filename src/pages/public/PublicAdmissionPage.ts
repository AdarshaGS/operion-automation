import type { Page } from "@playwright/test";

export interface InquiryFields {
	firstName: string;
	lastName: string;
	dateOfBirth: string;
	gender?: string;
	desiredClass?: string;
	guardianName: string;
	guardianPhone: string;
	guardianEmail?: string;
	notes?: string;
}

/** The public /apply/:orgSlug admission inquiry form - no sign-in. */
export class PublicAdmissionPage {
	constructor(private readonly page: Page) {}

	async open(organisationSlug: string) {
		await this.page.goto(`/apply/${organisationSlug}`);
	}

	heading() {
		return this.page.getByRole("heading", { name: /Admission inquiry/ });
	}

	async fill(fields: InquiryFields) {
		await this.page.getByLabel(/^First name/).fill(fields.firstName);
		await this.page.getByLabel(/^Last name/).fill(fields.lastName);
		await this.page.getByLabel(/^Date of birth/).fill(fields.dateOfBirth);
		if (fields.gender) await this.choose("Gender", fields.gender);
		if (fields.desiredClass) await this.choose("Class applying for", fields.desiredClass);
		await this.page.getByLabel(/^Guardian name/).fill(fields.guardianName);
		await this.page.getByLabel(/^Phone/).fill(fields.guardianPhone);
		if (fields.guardianEmail !== undefined) await this.page.getByLabel(/^Email \(optional\)/).fill(fields.guardianEmail);
		if (fields.notes !== undefined) await this.page.getByLabel(/^Anything else we should know/).fill(fields.notes);
	}

	private async choose(label: string, option: string) {
		await this.page.getByRole("combobox", { name: new RegExp(`^${label}`) }).click();
		await this.page.getByRole("option", { name: option }).click();
	}

	async submit() {
		await this.page.getByRole("button", { name: "Submit inquiry" }).click();
	}

	successMessage() {
		return this.page.getByText(/Thank you - your inquiry has been received/);
	}

	invalidLinkMessage() {
		return this.page.getByText("This admission form link isn't valid.");
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
