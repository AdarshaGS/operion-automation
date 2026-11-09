import type { Locator, Page } from "@playwright/test";

type PerformanceTab = "Overview" | "Scorecard" | "Appraisal cycles" | "Insights" | "Metrics";

/**
 * /performance (tabs: Overview, Scorecard, Appraisal cycles, Insights, Metrics) and the staff appraisal page
 * (/performance/staff/:personId) that a staff row opens. The cycle selector on Overview/Insights decides which
 * cycle the staff rows and the appraisal page show.
 */
export class PerformancePage {
	constructor(private readonly page: Page) {}

	async open(tab: PerformanceTab = "Overview") {
		await this.page.goto("/performance");
		await this.page.getByRole("heading", { name: "Performance", exact: true }).waitFor();
		if (tab !== "Overview") await this.tab(tab);
	}

	/** Opens /performance on a given cycle through the URL, the way a shared link or a reload would. */
	async openCycle(cycleId: number) {
		await this.page.goto(`/performance?cycle=${cycleId}`);
		await this.page.getByRole("heading", { name: "Performance", exact: true }).waitFor();
	}

	async tab(name: PerformanceTab) {
		await this.page.getByRole("tab", { name }).click();
	}

	row(text: string): Locator {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	// metrics

	/** Switches a metric on or off in its row and saves it; `weight` / `target` / `days` are typed when given. */
	async configureMetric(label: string, input: { enabled?: boolean; weight?: number; target?: number; days?: number } = {}) {
		const row = this.row(label).first();
		const inputs = row.getByRole("spinbutton");
		if (input.enabled !== undefined) await row.getByRole("switch").setChecked(input.enabled);
		if (input.weight !== undefined) await inputs.nth(0).fill(String(input.weight));
		if (input.target !== undefined) await inputs.nth(1).fill(String(input.target));
		if (input.days !== undefined) await inputs.nth(2).fill(String(input.days));
		await row.getByRole("button", { name: "Save" }).click();
	}

	selfViewSwitch(): Locator {
		return this.page.getByRole("switch", { name: "Teachers can see their own scorecard and appraisal" });
	}

	// scorecard

	async setPeriod(from: string, to: string) {
		await this.page.getByRole("textbox", { name: "From", exact: true }).fill(from);
		await this.page.getByRole("textbox", { name: "To", exact: true }).fill(to);
	}

	// cycles

	/** Opens the header's create dialog (available on every tab), fills it and submits; the dialog stays open if the server refuses. */
	async createCycle(input: { name: string; startDate: string; endDate: string }) {
		await this.page.getByRole("button", { name: "Create appraisal cycle" }).first().click();
		const dialog = this.dialog();
		await dialog.getByLabel("Cycle name").fill(input.name);
		await dialog.getByLabel("Review period starts").fill(input.startDate);
		await dialog.getByLabel("Review period ends").fill(input.endDate);
		await dialog.getByRole("button", { name: "Create cycle" }).click();
	}

	/** Closes a cycle from the Appraisal cycles tab and confirms the dialog. */
	async closeCycle(name: string) {
		await this.row(name).getByRole("button", { name: "Close cycle" }).click();
		await this.dialog().getByRole("button", { name: "Close cycle" }).click();
		await this.dialog().waitFor({ state: "detached" });
	}

	dialog(): Locator {
		return this.page.getByRole("dialog");
	}

	async cancelDialog() {
		await this.dialog().getByRole("button", { name: "Cancel" }).click();
	}

	// overview

	/** The value line of a summary card ("Total staff" -> "12"). */
	async cardValue(label: string): Promise<string> {
		const card = this.page.locator(".MuiPaper-root").filter({ has: this.page.getByText(label, { exact: true }) }).last();
		await card.waitFor();
		const lines = (await card.innerText()).split("\n").map((t) => t.trim()).filter(Boolean);
		return lines[lines.indexOf(label) + 1];
	}

	staffTable(): Locator {
		return this.page.getByRole("table", { name: "Staff performance" });
	}

	async searchStaff(text: string) {
		await this.page.getByRole("textbox", { name: "Search staff" }).fill(text);
	}

	async filterBy(filter: "Department" | "Designation" | "Review status", option: string) {
		await this.page.getByRole("combobox", { name: filter }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	/** Pagination text such as "1-10 of 14". */
	pagination(): Locator {
		return this.page.locator(".MuiTablePagination-displayedRows");
	}

	// staff appraisal page

	/** Picks the cycle in the header selector (Overview / Insights tabs). */
	async chooseCycle(cycleName: string) {
		await this.page.getByRole("combobox", { name: "Appraisal cycle" }).click();
		// A closed cycle is listed as "<name> (closed)".
		await this.page.getByRole("option", { name: new RegExp(`^${cycleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(closed\\))?$`) }).click();
	}

	/** From the Overview tab: choose the cycle, find the teacher with the search box, and open their appraisal page. */
	async openAppraisal(teacherName: string, cycleName: string) {
		await this.chooseCycle(cycleName);
		await this.page.getByRole("textbox", { name: "Search staff" }).fill(teacherName);
		await this.page.getByRole("button", { name: new RegExp(`appraisal for ${teacherName}$`) }).click();
		await this.page.getByRole("heading", { level: 1, name: teacherName }).waitFor();
	}

	/** From the Scorecard tab: clicking a row opens the appraisal page for the cycle the page has selected. */
	async openAppraisalFromScorecard(teacherName: string) {
		await this.row(teacherName).click();
		await this.page.getByRole("heading", { level: 1, name: teacherName }).waitFor();
	}

	/** The appraisal page's content (everything in view; the page is not a dialog). */
	detail(): Locator {
		return this.page.locator("body");
	}

	async backToPerformance() {
		await this.page.getByRole("link", { name: "Back to Performance" }).click();
		await this.page.getByRole("heading", { name: "Performance", exact: true }).waitFor();
	}

	/** Saves the viewer's own rating on the appraisal page; the star is picked by its label ("4 Stars"). */
	async rate(input: { as?: "Manager" | "Peer"; rating: number; comment?: string }) {
		if (input.as) {
			await this.page.getByRole("combobox", { name: "Rating as" }).click();
			await this.page.getByRole("option", { name: input.as, exact: true }).click();
		}
		await this.page.locator("label").filter({ hasText: new RegExp(`^${input.rating} Stars?$`) }).click();
		await this.page.getByLabel("Comments").fill(input.comment ?? "");
		await this.page.getByRole("button", { name: /^(Save|Update) rating$/ }).click();
	}

	async addGoal(title: string, details = "") {
		await this.page.getByRole("button", { name: "Add goal" }).click();
		const dialog = this.dialog();
		await dialog.getByRole("textbox", { name: /^Goal/ }).fill(title);
		await dialog.getByRole("textbox", { name: "Details" }).fill(details);
		await dialog.getByRole("button", { name: "Add goal" }).click();
		await dialog.waitFor({ state: "detached" });
	}

	async markGoal(title: string, status: "Open" | "Achieved" | "Partly achieved" | "Missed") {
		await this.page.getByRole("combobox", { name: `Status of ${title}` }).click();
		await this.page.getByRole("option", { name: status, exact: true }).click();
	}
}

/** The "My performance" tab a teacher gets on /learning once the organisation turns self-view on. */
export class MyPerformancePanel {
	constructor(private readonly page: Page) {}

	tab(): Locator {
		return this.page.getByRole("tab", { name: "My performance" });
	}

	async open() {
		await this.tab().click();
		await this.page.getByRole("heading", { name: "My scorecard" }).waitFor();
	}

	async chooseCycle(name: string) {
		await this.page.getByRole("combobox", { name: "Cycle" }).click();
		await this.page.getByRole("option", { name, exact: true }).click();
		await this.page.getByText("Ratings", { exact: true }).waitFor();
	}

	async selfAppraise(rating: number, comment: string) {
		await this.page.getByRole("combobox", { name: "Rating", exact: true }).click();
		await this.page.getByRole("option", { name: String(rating), exact: true }).click();
		await this.page.getByLabel("Comment").fill(comment);
		await this.page.getByRole("button", { name: "Save self-appraisal" }).click();
	}

	async addGoal(title: string) {
		await this.page.getByLabel("Goal", { exact: true }).fill(title);
		await this.page.getByRole("button", { name: "Add goal" }).click();
	}
}
