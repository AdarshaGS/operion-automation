import type { Page } from "@playwright/test";

/** /dashboard - greeting, hero stats, setup guide, quick actions, charts and the per-module tiles. */
export class DashboardPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/dashboard");
		await this.greeting().waitFor();
	}

	greeting() {
		return this.page.getByRole("heading", { level: 1 }).filter({ hasText: /^Good (morning|afternoon|evening), / });
	}

	alert() {
		return this.page.locator('[role="alert"].MuiAlert-colorError');
	}

	/** The big number under a hero card's label ("Active students", "Today's attendance", "Fees due"). */
	hero(label: string) {
		return this.page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
	}

	sectionHeading(title: string) {
		return this.page.getByRole("heading", { name: title, exact: true, level: 6 });
	}

	/** The number in a section tile, e.g. tile("Fees", "Total invoiced"). */
	tile(section: string, label: string) {
		return this.sectionHeading(section).locator("xpath=..").getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
	}

	chartTitle(title: string) {
		return this.page.getByRole("heading", { name: title, exact: true, level: 6 });
	}

	// Setup guide
	setupCard() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByText("Next setup step", { exact: true }) }).last();
	}

	dismissSetup() {
		return this.page.getByRole("button", { name: "Dismiss setup guide" });
	}

	setupProgressText() {
		return this.page.getByText(/of \d+ setup tasks complete/);
	}

	// Quick actions
	quickActionsCard() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByText("Quick actions", { exact: true }) }).last();
	}

	dismissQuickActions() {
		return this.page.getByRole("button", { name: "Dismiss quick actions" });
	}

	quickAction(label: string) {
		return this.quickActionsCard().getByText(label, { exact: true });
	}

	/** The first-run banner above everything when there are no students yet. */
	firstStep() {
		return this.page.locator(".MuiPaper-root").filter({ has: this.page.getByText(/^(Set up your academic year|Add your first students)$/) }).last();
	}

	summaryStats() {
		return this.page.getByRole("button", { name: "Summary stats" });
	}
}
