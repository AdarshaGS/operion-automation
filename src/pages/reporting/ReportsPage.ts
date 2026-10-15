import type { Page } from "@playwright/test";

export interface NewReport {
	name: string;
	description?: string;
	sql: string;
	parameters?: { name: string; type?: string; label: string }[];
	columns?: { sourceColumn: string; label: string }[];
}

/** /reports: the report list (My reports / Shared reports tabs), the Create report dialog and Seed standard reports. */
export class ReportsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/reports");
		await this.page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
		await this.listLoaded();
	}

	/** The list shows either rows or the "No reports here yet." notice once GET /reports has answered. */
	async listLoaded() {
		await this.page.getByRole("row").nth(1).or(this.page.getByText("No reports here yet.")).first().waitFor();
	}

	async showTab(name: "My reports" | "Shared reports") {
		await this.page.getByRole("tab", { name }).click();
	}

	row(name: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	statusOf(name: string | RegExp) {
		return this.row(name).locator(".MuiChip-label");
	}

	createButton() {
		return this.page.getByRole("button", { name: "Create report" });
	}

	seedButton() {
		return this.page.getByRole("button", { name: "Seed standard reports" });
	}

	async seedStandard() {
		const seeded = this.page.waitForResponse((r) => r.url().includes("/api/v1/reports/seed-standard"));
		await this.seedButton().click();
		await seeded;
	}

	async openReport(name: string) {
		await this.row(name).click();
		await this.page.getByRole("heading", { name, level: 1 }).waitFor();
	}

	dialog() {
		return this.page.getByRole("dialog", { name: "Create report" });
	}

	async openCreateDialog() {
		await this.createButton().click();
		await this.dialog().waitFor();
	}

	async fillReport(report: NewReport) {
		const dialog = this.dialog();
		await dialog.getByLabel("Name", { exact: false }).first().fill(report.name);
		if (report.description) await dialog.getByLabel("Description").fill(report.description);
		await dialog.getByLabel("SQL query").fill(report.sql);
		for (const [i, p] of (report.parameters ?? []).entries()) {
			await dialog.getByRole("button", { name: "Add parameter" }).click();
			await dialog.getByLabel("Name (:name)").nth(i).fill(p.name);
			if (p.type) {
				await dialog.getByRole("combobox", { name: /^Type/ }).nth(i).click();
				await this.page.getByRole("option", { name: p.type, exact: true }).click();
			}
			await dialog.getByLabel("Label", { exact: false }).nth(i).fill(p.label);
		}
		for (const [i, c] of (report.columns ?? []).entries()) {
			await dialog.getByRole("button", { name: "Add column" }).click();
			await dialog.getByLabel("Source column").nth(i).fill(c.sourceColumn);
			await dialog.getByLabel("Display label").nth(i).fill(c.label);
		}
	}

	saveButton() {
		return this.dialog().getByRole("button", { name: "Save as draft" });
	}

	async createReport(report: NewReport) {
		await this.openCreateDialog();
		await this.fillReport(report);
		const created = this.page.waitForResponse((r) => r.url().endsWith("/api/v1/reports") && r.request().method() === "POST");
		await this.saveButton().click();
		return created;
	}
}
