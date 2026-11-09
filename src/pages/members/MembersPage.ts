import type { Page } from "@playwright/test";

export interface NewMember {
	firstName: string;
	lastName: string;
	/** The Add member dialog requires a gender; defaults to "Other". */
	gender?: string;
	email?: string;
	phone?: string;
	roles?: string[];
}

/** /members: the member list, the Add member dialog and the per-row actions menu. */
export class MembersPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/members");
		await this.page.getByRole("heading", { name: "Members" }).waitFor();
	}

	async openInviteLink() {
		await this.page.goto("/members/invite");
	}

	tile(label: string) {
		// A tile is the label with its number next to it. Matching the number too keeps the "Active" tile apart
		// from the many "Active" status chips in the member table below it.
		return this.page.locator("div").filter({ hasText: new RegExp(`^${label}\\s*\\d+$`) }).last();
	}

	async search(text: string) {
		await this.page.getByPlaceholder("Search members").fill(text);
	}

	async filterByStatus(label: string) {
		await this.page.getByRole("combobox", { name: /^Status/ }).click();
		await this.page.getByRole("option", { name: label }).click();
	}

	row(text: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	emptyState() {
		return this.page.getByText("No members match these filters.");
	}

	async addMemberButton() {
		return this.page.getByRole("button", { name: /Add member/ });
	}

	async openAddMember() {
		await this.page.getByRole("button", { name: /Add member/ }).click();
		await this.page.getByRole("dialog", { name: "Add member" }).waitFor();
	}

	dialog() {
		return this.page.getByRole("dialog", { name: "Add member" });
	}

	async fillMember(member: NewMember) {
		const dialog = this.dialog();
		await dialog.getByLabel(/^First name/).fill(member.firstName);
		await dialog.getByLabel(/^Last name/).fill(member.lastName);
		await dialog.getByRole("combobox", { name: /^Gender/ }).click();
		await this.page.getByRole("option", { name: member.gender ?? "Other", exact: true }).click();
		if (member.email !== undefined) await dialog.getByLabel(/^Email/).fill(member.email);
		if (member.phone !== undefined) await dialog.getByLabel(/^Phone/).fill(member.phone);
		if (member.roles?.length) {
			await dialog.getByRole("combobox", { name: /^Role\(s\)/ }).click();
			for (const role of member.roles) await this.page.getByRole("option", { name: role }).click();
			await this.page.keyboard.press("Escape");
		}
	}

	async submitInvite() {
		await this.dialog().getByRole("button", { name: "Invite" }).click();
	}

	async cancelAddMember() {
		await this.dialog().getByRole("button", { name: "Cancel" }).click();
	}

	/** The "Staff invite issued" dialog shown once after inviting or resending. */
	inviteIssuedDialog() {
		return this.page.getByRole("dialog", { name: "Staff invite issued" });
	}

	async inviteToken(): Promise<string> {
		return this.inviteIssuedDialog().getByLabel("Raw token").inputValue();
	}

	async closeInviteIssued() {
		await this.inviteIssuedDialog().getByRole("button", { name: "Close" }).click();
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}

	/** The row actions button is an unlabelled icon button, so it is found as the last button in the row. */
	async openRowMenu(text: string | RegExp) {
		await this.row(text).getByRole("button").last().click();
	}

	async chooseRowAction(text: string | RegExp, action: string) {
		await this.openRowMenu(text);
		await this.page.getByRole("menuitem", { name: action }).click();
	}

	rowAction(action: string) {
		return this.page.getByRole("menuitem", { name: action });
	}
}
