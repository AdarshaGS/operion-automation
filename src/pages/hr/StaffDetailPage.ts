import type { Page } from "@playwright/test";

/** /hr/staff/:id - a staff member's HR profile. */
export class StaffDetailPage {
	constructor(private readonly page: Page) {}

	async open(staffProfileId: number) {
		await this.page.goto(`/hr/staff/${staffProfileId}`);
		await this.page.getByRole("heading", { level: 1 }).waitFor();
	}

	name(fullName: string) {
		return this.page.getByRole("heading", { name: fullName, level: 1 });
	}

	/** "EMP-001 — Teacher (Academics)" under the name. */
	summary(employeeCode: string) {
		return this.page.getByText(new RegExp(`^${employeeCode} — `));
	}

	// Status, transfer and exit
	statusChip() {
		return this.page.getByRole("main").locator(".MuiChip-root").first();
	}

	async updateStatus(status: "ACTIVE" | "RESIGNED" | "TERMINATED") {
		await this.page.getByRole("combobox", { name: "Status" }).click();
		await this.page.getByRole("option", { name: status, exact: true }).click();
		await this.page.getByRole("button", { name: "Update status" }).click();
	}

	private dialog() {
		return this.page.getByRole("dialog");
	}

	private async choose(scope: ReturnType<StaffDetailPage["dialog"]>, label: RegExp | string, option: string) {
		await scope.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	async transfer(input: { designation: string; department?: string; effectiveDate?: string }) {
		await this.page.getByRole("button", { name: "Transfer", exact: true }).click();
		const dialog = this.dialog();
		if (input.department) await this.choose(dialog, /^Department/, input.department);
		await this.choose(dialog, /^Designation/, input.designation);
		if (input.effectiveDate) await dialog.getByLabel("Effective date").fill(input.effectiveDate);
		await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
	}

	assignmentRows() {
		return this.page.getByRole("table").filter({ has: this.page.getByRole("columnheader", { name: "Designation" }) }).getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}

	recordExitButton() {
		return this.page.getByRole("button", { name: "Record exit", exact: true });
	}

	async recordExit(input: { type: string; date: string; reason?: string }) {
		await this.recordExitButton().click();
		const dialog = this.dialog();
		await this.choose(dialog, /^Exit type/, input.type);
		await dialog.getByLabel("Exit date").fill(input.date);
		if (input.reason) await dialog.getByLabel("Reason").fill(input.reason);
		await dialog.getByRole("button", { name: "Record exit", exact: true }).click();
	}

	exitHistory() {
		return this.page.getByText("Exit history").locator("xpath=..");
	}

	/** The red error alert at the top of the profile (the page also has several blue "nothing yet" alerts). */
	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	// Bank and tax details
	bankField(label: "Account holder name" | "Account number" | "Bank name" | "Branch code" | "Tax identifier") {
		return this.page.getByLabel(label, { exact: true });
	}

	bankSection() {
		return this.page.locator("form").filter({ has: this.page.getByRole("heading", { name: /Bank & tax details/ }) });
	}

	async saveBank(input: { holder?: string; number?: string; bank?: string; branch?: string; tax?: string }) {
		if (input.holder !== undefined) await this.bankField("Account holder name").fill(input.holder);
		if (input.number !== undefined) await this.bankField("Account number").fill(input.number);
		if (input.bank !== undefined) await this.bankField("Bank name").fill(input.bank);
		if (input.branch !== undefined) await this.bankField("Branch code").fill(input.branch);
		if (input.tax !== undefined) await this.bankField("Tax identifier").fill(input.tax);
		await this.bankSection().getByRole("button", { name: /^(Save|Update)$/ }).click();
	}

	// Documents
	documentRows() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: "Documents", exact: true }) }).last().getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}

	async addDocument(input: { type: string; fileName: string; reference: string; expiry?: string }) {
		await this.page.getByRole("button", { name: "Add document" }).click();
		const dialog = this.dialog();
		await dialog.getByLabel("Document type").fill(input.type);
		await dialog.getByLabel("File name").fill(input.fileName);
		await dialog.getByLabel("File reference").fill(input.reference);
		if (input.expiry) await dialog.getByLabel("Expiry date (optional)").fill(input.expiry);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	// Leave balance
	private balancePanel() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: "Leave balance", exact: true }) }).last();
	}

	async checkBalance(leaveType: string, academicYear: string) {
		const panel = this.balancePanel();
		await this.choose(panel, "Leave type", leaveType);
		await this.choose(panel, "Academic year", academicYear);
		await panel.getByRole("button", { name: "Check" }).click();
	}

	async allocate(leaveType: string, academicYear: string, days: number) {
		const panel = this.balancePanel();
		await this.choose(panel, "Leave type", leaveType);
		await this.choose(panel, "Academic year", academicYear);
		await panel.getByLabel("Allocate days").fill(String(days));
		await panel.getByRole("button", { name: "Allocate", exact: true }).click();
	}

	balanceText() {
		return this.balancePanel().getByText(/Allocated:/).locator("xpath=..");
	}

	// Leave requests
	leaveRequestRows() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: "Leave requests", exact: true }) }).last().getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") });
	}

	async raiseLeave(input: { leaveType: string; academicYear: string; start: string; end: string; days: number; reason?: string }) {
		await this.page.getByRole("button", { name: "Raise request" }).click();
		const dialog = this.dialog();
		await this.choose(dialog, "Leave type", input.leaveType);
		await this.choose(dialog, "Academic year", input.academicYear);
		await dialog.getByLabel("Start date").fill(input.start);
		await dialog.getByLabel("End date").fill(input.end);
		await dialog.getByLabel("Number of days").fill(String(input.days));
		if (input.reason) await dialog.getByLabel("Reason").fill(input.reason);
		await dialog.getByRole("button", { name: "Raise", exact: true }).click();
	}

	/** Opens the "Raise request" dialog without filling anything in. */
	async openRaiseLeave() {
		await this.page.getByRole("button", { name: "Raise request" }).click();
		await this.dialog().waitFor();
	}

	async fillLeaveDates(start: string, end: string) {
		const dialog = this.dialog();
		await dialog.getByLabel("Start date").fill(start);
		await dialog.getByLabel("End date").fill(end);
	}

	/** The working-day hint under the dates ("N working days in this range. Not counted: ..." or the all-off warning). */
	leaveDaysHint() {
		return this.dialog().getByRole("alert");
	}

	leaveDaysField() {
		return this.dialog().getByLabel("Number of days");
	}

	// Salary structure (payroll)
	private salaryPanel() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByRole("heading", { name: "Salary structure", exact: true }) }).last();
	}

	salaryHistory() {
		return this.salaryPanel().getByText(/^From \d{4}-/);
	}

	salaryPanelText() {
		return this.salaryPanel();
	}

	async saveSalaryStructure(input: { effectiveFrom: string; basic: number; components?: Record<string, number> }) {
		const panel = this.salaryPanel();
		await panel.getByLabel("Effective from").fill(input.effectiveFrom);
		await panel.getByLabel("Basic amount").fill(String(input.basic));
		for (const [name, value] of Object.entries(input.components ?? {})) await panel.getByLabel(name).fill(String(value));
		await panel.getByRole("button", { name: "Save structure" }).click();
	}
}
