import type { Page } from "@playwright/test";

/** Settings > School setup template: apply the starter template, or pick a module-based starter pack. */
export class SchoolTemplatePanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/school-template");
		await this.page.getByRole("heading", { name: "School setup template" }).first().waitFor();
	}

	/** The primary action is "Apply school template" until module selection is available, then "Set up with starter pack". */
	async apply() {
		const direct = this.page.getByRole("button", { name: "Apply school template" });
		const starter = this.page.getByRole("button", { name: "Set up with starter pack" });
		await direct.or(starter).click();
		const confirm = this.page.getByRole("button", { name: "Apply starter pack" });
		if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
	}

	appliedMessage() {
		return this.page.getByText(/Added \d+ new items?\.|Everything was already in place/);
	}

	async openStarterPack() {
		await this.page.getByRole("button", { name: "Set up with starter pack" }).click();
	}

	async applyStarterPack() {
		await this.page.getByRole("button", { name: "Apply starter pack" }).click();
	}

	async reviewSetup() {
		await this.page.getByRole("button", { name: "Review school setup" }).first().click();
	}

	/** A template row by its name (e.g. a grade). */
	row(name: string) {
		return this.page.getByText(name, { exact: true });
	}

	/** One catalog category ("Grades", "Classes", "Sections", ...) - an accordion whose header shows a count chip. */
	category(label: string) {
		const header = this.page.getByRole("button", { name: new RegExp(`^${label}\\b`) });
		return {
			header,
			/** The count chip in the header: "12" when all are ticked, "3 of 12 included" otherwise. */
			count: () => this.page.locator(".MuiAccordion-root").filter({ has: header }).locator(".MuiChip-root").first(),
			expand: async () => {
				if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
			},
			item: (name: string) => this.page.locator(".MuiAccordion-root").filter({ has: header }).getByRole("row").filter({ has: this.page.getByRole("cell", { name, exact: true }) }),
			add: async (name: string) => {
				const accordion = this.page.locator(".MuiAccordion-root").filter({ has: header });
				await accordion.getByRole("button", { name: "Add", exact: true }).click();
				const dialog = this.page.getByRole("dialog", { name: /^Add / });
				await dialog.getByLabel(/^Name/).fill(name);
				await dialog.getByRole("button", { name: "Save" }).click();
				await dialog.waitFor({ state: "hidden" });
			},
		};
	}

	/** The starter-pack questionnaire dialog ("Set up your school"). */
	starterPack() {
		const dialog = this.page.getByRole("dialog", { name: "Set up your school" });
		return {
			dialog,
			question: (label: string) => dialog.getByRole("switch", { name: label }),
			answer: async (label: string, yes: boolean) => dialog.getByRole("switch", { name: label }).setChecked(yes),
			/** A module chip under "Modules switched on (n)". */
			enabledModules: () => dialog.getByText(/^Modules switched on \(\d+\)$/),
			hiddenModules: () => dialog.getByText(/^Hidden for your school \(\d+\)$/),
			module: (label: string) => dialog.locator(".MuiChip-root").filter({ hasText: new RegExp(`^${label}$`) }),
		};
	}

	/** Shown instead of creating classes when there is no current year or no active campus. */
	classesNote() {
		return this.page.getByText(/so no classes were created/);
	}
}
