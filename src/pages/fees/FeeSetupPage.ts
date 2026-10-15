import type { Page } from "@playwright/test";

export interface FeeInstallment {
	dueDate: string;
	amount: number;
}

export interface FeeComponent {
	category: string;
	amount: number;
	frequency: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ONE_SHOT";
	oneShotDiscount?: number;
	installments: FeeInstallment[];
}

/** /fees/setup: Fee categories, and Fee structures per academic year + class, each made of
 * components (a category, its amount and the installment schedule it is paid by). */
export class FeeSetupPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/fees/setup");
		await this.categoriesHeading().waitFor();
	}

	categoriesHeading() {
		return this.page.getByRole("heading", { name: "Fee categories", exact: true });
	}

	structuresHeading() {
		return this.page.getByRole("heading", { name: "Fee structures", exact: true });
	}

	/** Each table lives in its own panel, and both can hold a "Tuition Fee" cell. */
	private panel(heading: string) {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: heading, exact: true }) });
	}

	/** A category row, matched on its code cell (codes are unique). */
	categoryRow(code: string) {
		return this.panel("Fee categories").getByRole("row").filter({ has: this.page.getByRole("cell", { name: code, exact: true }) });
	}

	async addCategory(category: { code: string; name: string; description?: string; type: "GENERAL" | "TRANSPORT" }) {
		await this.page.getByRole("button", { name: "Add category" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add fee category" });
		await dialog.getByLabel(/^Code/).fill(category.code);
		await dialog.getByLabel(/^Name/).fill(category.name);
		if (category.description) await dialog.getByLabel(/^Description/).fill(category.description);
		await dialog.getByRole("combobox", { name: /^Type/ }).click();
		await this.page.getByRole("option", { name: category.type, exact: true }).click();
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	/** Pick the year, then the class (labelled "<grade> · <campus>") whose structure to show. */
	async selectClass(yearName: string, classLabel: string) {
		await this.page.getByRole("combobox", { name: /^Academic year/ }).click();
		await this.page.getByRole("option", { name: yearName, exact: true }).click();
		await this.page.getByRole("combobox", { name: /^Class/ }).click();
		await this.page.getByRole("option", { name: classLabel, exact: true }).click();
	}

	noStructureNotice() {
		return this.page.getByText("No fee structure has been set up for this class yet.");
	}

	/** "Set up" on the notice opens a dialog pre-filled with a suggested name; returns that name. */
	async setUpStructure(): Promise<{ suggestedName: string; dialog: ReturnType<Page["getByRole"]> }> {
		await this.page.getByRole("button", { name: "Set up", exact: true }).click();
		const dialog = this.page.getByRole("dialog", { name: "Set up fee structure" });
		const suggestedName = await dialog.getByLabel(/^Name/).inputValue();
		return { suggestedName, dialog };
	}

	async createStructure(name: string) {
		const dialog = this.page.getByRole("dialog", { name: "Set up fee structure" });
		await dialog.getByLabel(/^Name/).fill(name);
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}

	structureName(name: string) {
		return this.panel("Fee structures").getByText(name, { exact: true });
	}

	componentDialog() {
		return this.page.getByRole("dialog", { name: "Add fee component" });
	}

	/** Fill the Add fee component dialog without submitting, so callers can check the totals warning. */
	async fillComponent(component: FeeComponent) {
		await this.page.getByRole("button", { name: "Add component" }).click();
		const dialog = this.componentDialog();
		await dialog.getByRole("combobox", { name: /^Fee category/ }).click();
		await this.page.getByRole("option", { name: component.category, exact: true }).click();
		await dialog.getByLabel(/^Total amount/).fill(String(component.amount));
		await dialog.getByRole("combobox", { name: /^Payment frequency/ }).click();
		await this.page.getByRole("option", { name: component.frequency, exact: true }).click();
		if (component.oneShotDiscount !== undefined) await dialog.getByLabel(/^One-shot discount/).fill(String(component.oneShotDiscount));
		for (let i = 1; i < component.installments.length; i++) await dialog.getByRole("button", { name: "Add installment" }).click();
		const dueDates = dialog.getByLabel("Due date");
		const amounts = dialog.getByLabel("Amount", { exact: true });
		for (const [i, installment] of component.installments.entries()) {
			await dueDates.nth(i).fill(installment.dueDate);
			await amounts.nth(i).fill(String(installment.amount));
		}
	}

	totalsWarning() {
		return this.componentDialog().getByText(/^Installments total .* must equal the structure amount/);
	}

	async submitComponent() {
		await this.componentDialog().getByRole("button", { name: "Add", exact: true }).click();
		await this.componentDialog().waitFor({ state: "hidden" });
	}

	/** A component row in the selected structure, matched on its category cell. */
	componentRow(category: string) {
		return this.panel("Fee structures").getByRole("row").filter({ has: this.page.getByRole("cell", { name: category, exact: true }) });
	}
}
