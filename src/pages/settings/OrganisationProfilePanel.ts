import type { Page } from "@playwright/test";

export interface ProfileFields {
	name?: string;
	legalName?: string;
	contactName?: string;
	contactEmail?: string;
	contactPhone?: string;
	addressLine1?: string;
	city?: string;
	state?: string;
	country?: string;
	pincode?: string;
	taxIdentifier?: string;
}

/** Settings > Organisation profile (also step 1 of the structure-setup wizard). */
export class OrganisationProfilePanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/profile");
		await this.nameField().waitFor();
	}

	nameField() {
		return this.page.getByLabel(/^Organisation name/);
	}

	async fill(fields: ProfileFields) {
		const map: [keyof ProfileFields, RegExp][] = [
			["name", /^Organisation name/],
			["legalName", /^Legal name/],
			["contactName", /^Contact name/],
			["contactEmail", /^Contact email/],
			["contactPhone", /^Contact phone/],
			["addressLine1", /^Address line 1/],
			["city", /^City/],
			["state", /^State/],
			["country", /^Country/],
			["pincode", /^Pincode/],
			["taxIdentifier", /^Legal \/ tax identifier/],
		];
		for (const [key, label] of map) {
			if (fields[key] !== undefined) await this.page.getByLabel(label).fill(fields[key]!);
		}
	}

	async save() {
		await this.page.getByRole("button", { name: "Save" }).click();
	}

	successAlert() {
		return this.page.getByText("Profile updated");
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
