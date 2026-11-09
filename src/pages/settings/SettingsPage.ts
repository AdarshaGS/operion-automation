import type { Page } from "@playwright/test";

/** Settings sections live at /settings/<key>; keys mirror web/src/modules/settings/settingsSections.tsx. */
export type SettingsSection =
	| "business" | "profile" | "campuses" | "departments" | "designations" | "school-template"
	| "users" | "roles" | "audit-logs" | "profile-change-requests"
	| "academic-years" | "working-calendar" | "branding" | "letter-formats" | "id-card-studio" | "notifications" | "custom-fields"
	| "privacy" | "regulatory-exports" | "transfer-connectors" | "imports-exports" | "integrations";

export class SettingsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings");
	}

	async openSection(section: SettingsSection) {
		await this.page.goto(`/settings/${section}`);
	}

	heading(name: string | RegExp) {
		return this.page.getByRole("heading", { name });
	}
}

/** Settings > Imports & exports: an Import tab of cards (one per importable entity, each opening the
 * validate -> preview -> confirm dialog), an Export tab of download buttons, and an import-history dialog. */
export class ImportsExportsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/imports-exports");
		await this.page.getByRole("heading", { name: "Imports & exports", level: 5 }).waitFor();
	}

	async openTab(name: "Import data" | "Export data") {
		await this.page.getByRole("tab", { name }).click();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Imports & exports", level: 5 });
	}

	/** Group headings on the Import tab: People, Academics, Finance, Operations, Library. */
	groupHeading(name: string) {
		return this.page.getByRole("heading", { name, exact: true });
	}

	cards() {
		return this.page.locator("div.MuiPaper-outlined").filter({ has: this.page.getByRole("button", { name: "Import", exact: true }) });
	}

	card(label: string) {
		return this.page.locator("div.MuiPaper-outlined").filter({ has: this.page.getByText(label, { exact: true }) }).first();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	/** Opens the card's import dialog and waits for its title. */
	async openImport(label: string) {
		await this.card(label).getByRole("button", { name: "Import", exact: true }).click();
		await this.dialog().getByRole("heading", { name: `Import ${label}` }).waitFor();
	}

	/** Uploads through the dialog's hidden file input. */
	async upload(file: { name: string; mimeType: string; buffer: Buffer }) {
		await this.dialog().locator("input[type=file]").setInputFiles(file);
	}

	/** Opens the card's dialog and uploads the file; for the flows that then assert on the preview/summary. */
	async importFile(label: string, file: { name: string; mimeType: string; buffer: Buffer }) {
		await this.card(label).getByRole("button", { name: "Import", exact: true }).click();
		await this.upload(file);
	}

	/** Result chips and text inside the open dialog: "Total rows: 2", "Valid: 2", "Imported: 1", "Errors: 1", "Duplicates: 1". */
	chip(text: string | RegExp) {
		return this.dialog().getByText(text);
	}

	/** The row-by-row result table in the dialog. */
	resultRows() {
		return this.dialog().getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}

	resultRow(rowNumber: number) {
		return this.dialog().getByRole("row").filter({ has: this.page.getByRole("cell", { name: String(rowNumber), exact: true }) });
	}

	alert() {
		return this.dialog().getByRole("alert");
	}

	uploadButton() {
		return this.dialog().getByText("Upload file", { exact: true });
	}

	confirmButton() {
		return this.dialog().getByRole("button", { name: /^Confirm import/ });
	}

	async confirm() {
		await this.confirmButton().click();
	}

	/** "Cancel" before the import runs, "Close" once the summary is showing. */
	async closeDialog() {
		await this.dialog().getByRole("button", { name: /^(Cancel|Close)$/ }).click();
		await this.dialog().waitFor({ state: "hidden" });
	}

	/** Clicks a download control and returns its file name and text. */
	async download(click: () => Promise<void>): Promise<{ fileName: string; text: string; buffer: Buffer }> {
		const pending = this.page.waitForEvent("download");
		await click();
		const download = await pending;
		const path = await download.path();
		const { readFile } = await import("node:fs/promises");
		const buffer = await readFile(path);
		return { fileName: download.suggestedFilename(), text: buffer.toString("utf8"), buffer };
	}

	/** The card's "Download template" button. */
	downloadTemplate(label: string) {
		return this.download(() => this.card(label).getByRole("button", { name: "Download template" }).click());
	}

	/** The dialog's own "Download template" button (start step). */
	downloadTemplateInDialog() {
		return this.download(() => this.dialog().getByRole("button", { name: "Download template" }).click());
	}

	downloadErrorReport() {
		return this.download(() => this.dialog().getByRole("button", { name: "Download error report" }).click());
	}

	/** Export tab button for an entity, e.g. "Students". */
	exportButton(label: string) {
		return this.page.getByRole("main").getByRole("button", { name: label, exact: true });
	}

	async exportCsv(label: string) {
		await this.openTab("Export data");
		return this.download(() => this.exportButton(label).click());
	}

	async openHistory() {
		await this.page.getByRole("button", { name: "View import history" }).click();
		await this.dialog().getByRole("heading", { name: "Import history" }).waitFor();
	}

	/** Rows of the import-history table (header excluded). */
	historyRows() {
		return this.dialog().getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}
}
