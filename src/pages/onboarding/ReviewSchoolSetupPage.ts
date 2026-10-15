import type { Page } from "@playwright/test";

export class ReviewSchoolSetupPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/setup/review");
		await this.heading().waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Review school setup" });
	}

	async runGoLiveCheck() {
		await this.page.getByRole("button", { name: "Run go-live check" }).click();
	}

	async backToTemplate() {
		await this.page.getByRole("button", { name: "Back to school setup template" }).click();
	}

	cta(label: string) {
		return this.page.getByRole("button", { name: label });
	}
}
