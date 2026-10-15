import type { Page } from "@playwright/test";

/** /reports/:id: definition form, lifecycle buttons, Run panel with parameter inputs, and the Share dialog. */
export class ReportDetailPage {
	constructor(private readonly page: Page) {}

	async open(id: number) {
		await this.page.goto(`/reports/${id}`);
		await this.page.getByRole("heading", { level: 1 }).waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { level: 1 });
	}

	status() {
		return this.page.locator(".MuiChip-root").first();
	}

	button(name: string) {
		return this.page.getByRole("button", { name, exact: true });
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}

	async publish() {
		const done = this.page.waitForResponse((r) => r.url().endsWith("/publish"));
		await this.button("Publish").click();
		await done;
	}

	async archive() {
		const done = this.page.waitForResponse((r) => r.url().endsWith("/archive"));
		await this.button("Archive").click();
		await done;
	}

	async duplicate() {
		const done = this.page.waitForResponse((r) => r.url().endsWith("/duplicate"));
		await this.button("Duplicate").click();
		await done;
	}

	async backToReports() {
		await this.page.getByRole("button", { name: "Back to reports" }).click();
	}

	// Definition form
	nameField() {
		return this.page.getByLabel("Name", { exact: false }).first();
	}

	descriptionField() {
		return this.page.getByLabel("Description");
	}

	sqlField() {
		return this.page.getByLabel("SQL query");
	}

	async saveChanges() {
		const saved = this.page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/v1\/reports\/\d+$/.test(r.url()));
		await this.button("Save changes").click();
		return saved;
	}

	// Run panel
	paramInput(label: string) {
		return this.page.getByLabel(label, { exact: true });
	}

	async run() {
		const done = this.page.waitForResponse((r) => r.url().endsWith("/run"));
		await this.button("Run").click();
		return done;
	}

	async exportCsv() {
		const download = this.page.waitForEvent("download");
		await this.button("Export as CSV").click();
		return download;
	}

	resultTable() {
		return this.page.getByRole("table");
	}

	noRows() {
		return this.page.getByText("No rows returned.");
	}

	// Share dialog
	shareDialog() {
		return this.page.getByRole("dialog", { name: "Share report" });
	}

	async openShare() {
		await this.button("Share").click();
		await this.shareDialog().waitFor();
	}

	async shareWith(principal: { type?: "USER" | "ROLE"; id: number | string; canRun?: boolean; canEdit?: boolean }) {
		const dialog = this.shareDialog();
		if (principal.type === "ROLE") {
			await dialog.getByRole("combobox", { name: /Share with/ }).click();
			await this.page.getByRole("option", { name: "Everyone with a role" }).click();
		}
		await dialog.getByLabel(principal.type === "ROLE" ? "Role ID" : "User ID").fill(String(principal.id));
		if (principal.canRun === false) await dialog.getByLabel("Can run").uncheck();
		if (principal.canEdit) await dialog.getByLabel("Can edit").check();
		const shared = this.page.waitForResponse((r) => r.url().endsWith("/share"));
		await dialog.getByRole("button", { name: "Share", exact: true }).click();
		return shared;
	}
}
