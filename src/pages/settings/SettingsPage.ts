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

/** Settings > Imports & exports: one card per importable entity, each opening a workflow dialog. */
export class ImportsExportsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/imports-exports");
	}

	card(label: string) {
		return this.page.locator("div.MuiPaper-outlined").filter({ has: this.page.getByText(label, { exact: true }) }).first();
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	/** Uploads through the dialog's hidden file input. */
	async importFile(label: string, file: { name: string; mimeType: string; buffer: Buffer }) {
		await this.card(label).getByRole("button", { name: "Import" }).click();
		await this.dialog().locator("input[type=file]").setInputFiles(file);
	}

	chip(text: string | RegExp) {
		return this.dialog().getByText(text);
	}
}
