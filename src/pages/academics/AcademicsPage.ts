import type { Page } from "@playwright/test";

/** /academics: the tab strip plus the "Class offering" and "Section" pickers shared by several tabs. */
export class AcademicsPage {
	constructor(private readonly page: Page) {}

	async open(tab?: string) {
		await this.page.goto("/academics");
		await this.page.getByRole("tab", { name: "Grade levels" }).waitFor();
		if (tab) await this.openTab(tab);
	}

	async openTab(tab: string) {
		await this.page.getByRole("tab", { name: tab, exact: true }).click();
	}

	/** Picks an option of a MUI select by its field label. */
	private async choose(label: string | RegExp, option: string | RegExp) {
		await this.page.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option }).click();
	}

	async selectClassOffering(name: string | RegExp) {
		await this.choose("Class offering", name);
	}

	async selectSection(name: string) {
		await this.choose("Section", new RegExp(`^${name}$`));
	}

	/** Class offering then section, as the Teacher assignments and Timetable tabs require. */
	async selectClassAndSection(className: string, sectionName: string) {
		await this.selectClassOffering(className);
		await this.selectSection(sectionName);
	}

	hint(text: string | RegExp) {
		return this.page.getByRole("alert").filter({ hasText: text });
	}
}
