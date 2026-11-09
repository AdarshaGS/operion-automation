import type { Page } from "@playwright/test";
import type { UploadFile } from "../../api/settings";

/** Settings > Custom fields: a table (Applies to, Label, Field key, Type, Required, Status, action) and an "Add custom field" dialog. No edit screen exists. */
export class CustomFieldsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/custom-fields");
		await this.heading().waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Custom fields", level: 6 });
	}

	row(text: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	dialog() {
		return this.page.getByRole("dialog", { name: "Add custom field" });
	}

	async openDialog() {
		await this.page.getByRole("button", { name: "Add custom field" }).click();
		await this.dialog().waitFor();
	}

	async chooseType(label: "Text" | "Number" | "Date" | "Yes/No" | "Choice list") {
		await this.dialog().getByRole("combobox", { name: "Type" }).click();
		await this.page.getByRole("option", { name: label, exact: true }).click();
	}

	async fill(fields: { label?: string; fieldKey?: string; choices?: string }) {
		if (fields.label !== undefined) await this.dialog().getByLabel(/^Label/).fill(fields.label);
		if (fields.fieldKey !== undefined) await this.dialog().getByLabel(/^Field key/).fill(fields.fieldKey);
		if (fields.choices !== undefined) await this.dialog().getByLabel("Choices").fill(fields.choices);
	}

	submit() {
		return this.dialog().getByRole("button", { name: /^(Add|Create|Save)/ });
	}

	errorAlert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}
}

/** Settings > Branding & documents: three upload slots, free-text fields and the three number formats. */
export class BrandingPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/branding");
		await this.heading().waitFor();
		await this.page.waitForLoadState("networkidle");
	}

	heading() {
		return this.page.getByRole("heading", { name: "Branding & documents", level: 6 });
	}

	/** Required inputs render their label with a trailing " *", so match on the start of the label. */
	field(label: string) {
		return this.page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}

	async set(label: string, value: string) {
		await this.field(label).fill(value);
	}

	save() {
		return this.page.getByRole("button", { name: "Save", exact: true });
	}

	successAlert() {
		return this.page.getByRole("alert").filter({ hasText: "Branding updated" });
	}

	errorAlert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	/** The hidden file input inside an upload slot ("School logo", "Official stamp", "Authorized signature"). */
	slotInput(label: string) {
		return this.page.locator("div").filter({ has: this.page.getByText(label.toUpperCase(), { exact: true }) }).last().locator('input[type="file"]');
	}

	async upload(label: string, file: UploadFile) {
		await this.slotInput(label).setInputFiles(file);
	}

	slotImage(label: string) {
		return this.page.getByRole("img", { name: label, exact: true });
	}
}

/** Settings > Letter formats: a form (style, page size, font style, font size, header subtext) beside a live A4 preview. */
export class LetterFormatsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/letter-formats");
		await this.page.getByLabel("Template style").waitFor();
		await this.page.waitForLoadState("networkidle");
	}

	async chooseDocument(label: "Question paper header" | "Report card") {
		await this.page.getByRole("tab", { name: label }).click();
	}

	async choose(field: "Template style" | "Page size", option: string) {
		await this.page.getByRole("combobox", { name: field }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	field(label: string) {
		return this.page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}

	save() {
		return this.page.getByRole("button", { name: "Save", exact: true });
	}

	errorAlert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}
}

/** Settings > ID Card Studio: palette, canvas, template properties and a student preview. */
export class IdCardStudioPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/id-card-studio");
		await this.page.getByRole("button", { name: "New template" }).waitFor();
		await this.page.waitForLoadState("networkidle");
	}

	templatePicker() {
		return this.page.getByRole("combobox", { name: "Load template" });
	}

	async addElement(label: string) {
		await this.page.getByRole("button", { name: label, exact: true }).click();
	}

	field(label: string) {
		return this.page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).first();
	}

	save() {
		return this.page.getByRole("button", { name: /^(Save template|Saving\.\.\.)$/ });
	}

	savedAlert() {
		return this.page.getByRole("alert").filter({ hasText: "Template saved" });
	}

	errorAlert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	previewButton() {
		return this.page.getByRole("button", { name: "Preview", exact: true });
	}
}

/** Settings > Integrations & API: one card per external service; a locked card for a service the platform owner has not enabled. */
export class IntegrationsPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/integrations");
		await this.page.getByRole("heading", { name: /Brevo/ }).waitFor();
		await this.page.waitForLoadState("networkidle");
	}

	card(title: string | RegExp) {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: title, level: 6 }) }).last();
	}

	field(card: ReturnType<IntegrationsPanel["card"]>, label: string | RegExp) {
		return card.getByLabel(label);
	}
}
