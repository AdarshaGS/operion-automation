import type { Page } from "@playwright/test";

/** /communication - the compose form, the drafts table and the published feed. */
export class AnnouncementsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/communication");
		await this.page.getByRole("heading", { name: "Compose announcement" }).waitFor();
	}

	async fillMessage(title: string, body: string) {
		await this.page.getByLabel("Title", { exact: true }).fill(title);
		await this.page.getByLabel("Body", { exact: true }).fill(body);
	}

	/** Ticks "Schedule for later" and sets "Publish at" (local date-time, "YYYY-MM-DDTHH:mm"). */
	async scheduleFor(localDateTime: string) {
		await this.page.getByRole("checkbox", { name: "Schedule for later instead of publishing manually" }).check();
		await this.page.getByLabel("Publish at").fill(localDateTime);
	}

	/** The note under "Publish at" when that day is a holiday or weekly off. */
	dayOffNotice() {
		return this.page.getByRole("alert").filter({ hasText: /Unless you tick the box below/ });
	}

	sendAnywayCheckbox() {
		return this.page.getByRole("checkbox", { name: "Send on that day anyway" });
	}

	async saveDraft() {
		await this.page.getByRole("button", { name: "Save as draft" }).click();
	}

	private draftsPanel() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: "Drafts", exact: true }) }).last();
	}

	draftRow(title: string) {
		return this.draftsPanel().getByRole("row").filter({ hasText: title });
	}

	/** The "Sends even on a day off" chip on a draft row. */
	dayOffChip(title: string) {
		return this.draftRow(title).getByText("Sends even on a day off");
	}
}
