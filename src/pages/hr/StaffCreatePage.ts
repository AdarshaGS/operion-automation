import type { Page } from "@playwright/test";

export interface NewStaff {
	firstName: string;
	lastName: string;
	gender?: "Male" | "Female" | "Other";
	email: string;
	phone?: string;
	employeeCode: string;
	joiningDate: string;
	campus: string;
	department: string;
	roles: string[];
	designation: string;
	employmentType: "PERMANENT" | "CONTRACT" | "PART_TIME";
}

/** /hr/staff/new - "Add staff member": person + login roles + HR staff profile in one form; issues a staff invite. */
export class StaffCreatePage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/hr/staff/new");
		await this.page.getByRole("heading", { name: "Add staff member" }).waitFor();
	}

	private async choose(label: RegExp, option: string) {
		await this.page.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	async fill(staff: NewStaff) {
		await this.page.getByLabel(/^First name/).fill(staff.firstName);
		await this.page.getByLabel(/^Last name/).fill(staff.lastName);
		if (staff.gender) await this.choose(/^Gender/, staff.gender);
		await this.page.getByLabel(/^Email/).fill(staff.email);
		if (staff.phone) await this.page.getByLabel(/^Phone/).fill(staff.phone);
		await this.page.getByLabel(/^Member ID/).fill(staff.employeeCode);
		await this.page.getByLabel(/^Joining date/).fill(staff.joiningDate);
		await this.choose(/^Campus/, staff.campus);
		await this.choose(/^Department/, staff.department);
		// Role(s) is a multi-select: pick each, then close the list.
		await this.page.getByRole("combobox", { name: /^Role\(s\)/ }).click();
		for (const role of staff.roles) await this.page.getByRole("option", { name: role, exact: true }).click();
		await this.page.keyboard.press("Escape");
		await this.choose(/^Designation/, staff.designation);
		await this.choose(/^Employment type/, staff.employmentType);
	}

	async submit() {
		await this.page.getByRole("button", { name: "Add staff member" }).click();
	}

	/** The one-time "Staff invite issued" dialog - the claim link is what the new hire receives. */
	inviteDialog() {
		return this.page.getByRole("dialog", { name: "Staff invite issued" });
	}

	async claimLink(): Promise<string> {
		return this.inviteDialog().getByLabel("Claim link").inputValue();
	}

	async closeInvite() {
		await this.inviteDialog().getByRole("button", { name: "Close" }).click();
	}
}
