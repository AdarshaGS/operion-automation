import type { Page } from "@playwright/test";

export class StudentListPage {
	constructor(private readonly page: Page) {}

	/** Resolves once the first page of results has arrived, so later filters cannot race it. */
	async open() {
		const loaded = this.page.waitForResponse((r) => r.url().includes("/api/v1/students/search"));
		await this.page.goto("/students");
		await loaded;
	}

	private async afterSearchResponse(contains: string[], action: () => Promise<void>) {
		const response = this.page.waitForResponse((r) => r.url().includes("/api/v1/students/search") && contains.every((part) => r.url().includes(part)));
		await action();
		await response;
	}

	async admitStudent() {
		await this.page.getByRole("button", { name: "Admit student" }).click();
	}

	row(admissionNumber: string) {
		return this.page.getByRole("row").filter({ hasText: admissionNumber });
	}

	async search(text: string) {
		await this.afterSearchResponse([`search=${encodeURIComponent(text)}`], () => this.page.getByLabel("Search").fill(text));
	}

	async chooseFilter(label: "Class" | "Section" | "Status", option: string | RegExp) {
		await this.page.getByRole("combobox", { name: label }).click();
		const param = label === "Class" ? "schoolClassId=" : label === "Section" ? "sectionId=" : "status=";
		await this.afterSearchResponse([param], () => this.page.getByRole("option", { name: option, exact: typeof option === "string" }).click());
	}

	async setAdmittedBetween(from: string, to: string) {
		await this.page.getByLabel("Admitted from").fill(from);
		await this.afterSearchResponse([`admissionDateFrom=${from}`, `admissionDateTo=${to}`], () => this.page.getByLabel("Admitted to").fill(to));
	}

	async clearFilters() {
		await this.afterSearchResponse([], () => this.page.getByRole("button", { name: "Clear filters" }).click());
	}

	/** The "N students" line under the filters. */
	count() {
		return this.page.getByText(/^\d+ students?$/);
	}

	emptyState(text: string | RegExp) {
		return this.page.getByRole("alert").filter({ hasText: text });
	}

	admitButton() {
		return this.page.getByRole("button", { name: "Admit student" });
	}

	nextPage() {
		return this.page.getByRole("button", { name: /next page/i });
	}

	async openStudent(admissionNumber: string) {
		await this.row(admissionNumber).click();
	}
}
