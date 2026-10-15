import type { Page } from "@playwright/test";

/** /admissions: status chips with counts over a paged applicant table; approve, reject and documents are dialogs. */
export class AdmissionsPage {
	constructor(private readonly page: Page) {}

	async open() {
		const loaded = this.page.waitForResponse((r) => r.url().includes("/api/v1/applicants") && !r.url().includes("status-counts"));
		await this.page.goto("/admissions");
		await loaded;
	}

	/** A status chip, e.g. chip("Pending") matches "Pending: 3". */
	chip(label: "All" | "Pending" | "Under Review" | "Approved" | "Rejected") {
		return this.page.getByRole("button", { name: new RegExp(`^${label}(:|$)`) });
	}

	async filterBy(label: "All" | "Pending" | "Under Review" | "Approved" | "Rejected") {
		await this.chip(label).click();
	}

	row(name: string) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	/** Pages forward until the row is on screen: the list is oldest first, so a new applicant is on the last page. */
	async revealRow(name: string) {
		const next = this.page.getByRole("button", { name: /next page/i });
		for (let guard = 0; guard < 50; guard++) {
			if (await this.row(name).count()) return;
			if (await next.isDisabled()) return;
			await next.click();
		}
	}

	emptyState(text: string | RegExp) {
		return this.page.getByRole("alert").filter({ hasText: text });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async startReview(name: string) {
		await this.row(name).getByRole("button", { name: "Start review" }).click();
	}

	async openApprove(name: string) {
		await this.row(name).getByRole("button", { name: "Approve" }).click();
	}

	async approve(input: { admissionNumber?: string; admissionDate: string; previousSchool?: string }) {
		const dialog = this.dialog();
		if (input.admissionNumber) await dialog.getByLabel("Admission number").fill(input.admissionNumber);
		await dialog.getByLabel("Admission date").fill(input.admissionDate);
		if (input.previousSchool) await dialog.getByLabel("Previous school").fill(input.previousSchool);
		await dialog.getByRole("button", { name: "Approve and admit" }).click();
	}

	async openReject(name: string) {
		await this.row(name).getByRole("button", { name: "Reject" }).click();
	}

	async openDocuments(name: string) {
		await this.row(name).getByRole("button", { name: "Documents" }).click();
	}

	documentCheckbox(label: string) {
		return this.dialog().getByRole("checkbox", { name: label });
	}

	publicLinkButton() {
		return this.page.getByRole("button", { name: "Public form link" });
	}
}
