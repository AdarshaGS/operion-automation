import { expect, type Page } from "@playwright/test";

export interface NewOrganisation {
	name: string;
	legalName: string;
	slug: string;
	adminFirstName: string;
	adminLastName: string;
	adminEmail: string;
	adminPassword: string;
}

/** /platform/organisations - every organisation on the platform, and the "Add organisation" dialog that provisions one. */
export class PlatformOrganisationsPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/platform/organisations");
		await this.heading().waitFor();
	}

	heading() {
		return this.page.getByRole("heading", { name: "Organisations", exact: true });
	}

	/** Fills only the required fields - the owner fills the business details in the structure wizard. */
	async add(org: NewOrganisation) {
		await this.page.getByRole("button", { name: "Add organisation" }).click();
		const dialog = this.page.getByRole("dialog", { name: "Add organisation" });
		const fields: [RegExp, string][] = [
			[/^School name/, org.name],
			[/^Legal name/, org.legalName],
			[/^Slug/, org.slug],
			[/^Admin first name/, org.adminFirstName],
			[/^Admin last name/, org.adminLastName],
			[/^Admin email/, org.adminEmail],
			[/^Admin password/, org.adminPassword],
		];
		for (const [label, value] of fields) await dialog.getByLabel(label).fill(value);
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		// Bounded: an unbounded waitFor sat out the whole 10-minute sanity timeout when the dialog stayed open.
		await expect(dialog, "the Add organisation dialog closes once the business is created").toBeHidden({ timeout: 30_000 });
	}

	row(slug: string) {
		return this.page.getByRole("row").filter({ hasText: slug });
	}

	/** Opens the organisation's detail page and returns its id from the URL. */
	async openDetail(slug: string): Promise<number> {
		await this.row(slug).click();
		await this.page.waitForURL(/\/platform\/organisations\/\d+$/);
		return Number(this.page.url().split("/").pop());
	}

	/** The on/off switch for a feature (module) on the organisation detail page, e.g. "Performance". */
	moduleSwitch(label: string) {
		return this.page.getByRole("switch", { name: `${label} enabled` });
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
