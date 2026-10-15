import type { Page } from "@playwright/test";

export class GoLiveCheckPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/setup/go-live");
		await this.heading().waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Go-live check" });
	}

	notReadyBanner() {
		return this.page.getByText(/Some required setup is still missing/);
	}

	readyBanner() {
		return this.page.getByText(/Nothing is blocking go-live/);
	}

	fixButtons() {
		return this.page.getByRole("button", { name: "Fix" });
	}

	async fix(index = 0) {
		await this.fixButtons().nth(index).click();
	}

	async backToReview() {
		await this.page.getByRole("button", { name: "Back to school setup review" }).click();
	}
}
