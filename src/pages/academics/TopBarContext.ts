import { expect, type Page } from "@playwright/test";

/** The Campus and Academic year pickers in the top bar. */
export class TopBarContext {
	constructor(private readonly page: Page) {}

	yearButton() {
		return this.page.getByRole("button", { name: "Academic year" });
	}

	campusButton() {
		return this.page.getByRole("button", { name: "Campus" });
	}

	async selectYear(name: string) {
		await this.yearButton().click();
		await this.page.getByRole("menuitem", { name }).click();
	}

	async selectCampus(name: string) {
		await this.campusButton().click();
		await this.page.getByRole("menuitem", { name }).click();
		await expect(this.campusButton()).toContainText(name);
	}

	async yearOptions(): Promise<string[]> {
		await this.yearButton().click();
		const options = await this.page.getByRole("menuitem").allTextContents();
		await this.page.keyboard.press("Escape");
		return options;
	}
}
