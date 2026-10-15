import type { Page } from "@playwright/test";

/** Settings > Roles: the role table, the Add role dialog and the Edit permissions dialog. */
export class RolesPanel {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/settings/roles");
		await this.page.getByRole("heading", { name: "Roles" }).first().waitFor();
	}

	row(name: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: name });
	}

	async openAddRole() {
		await this.page.getByRole("button", { name: /Add role/ }).click();
		await this.page.getByRole("dialog", { name: "Add role" }).waitFor();
	}

	addDialog() {
		return this.page.getByRole("dialog", { name: "Add role" });
	}

	async fillRole(name: string, description?: string) {
		await this.addDialog().getByLabel(/^Name/).fill(name);
		if (description !== undefined) await this.addDialog().getByLabel(/^Description/).fill(description);
	}

	async markPortal() {
		await this.addDialog().getByRole("checkbox", { name: /Portal role/ }).check();
	}

	/** Permission groups are accordions named after the module; ticks the checkbox for a code inside the open dialog. */
	async tickPermission(dialogName: string, module: string, code: string) {
		const dialog = this.page.getByRole("dialog", { name: dialogName });
		const checkbox = dialog.getByRole("checkbox", { name: new RegExp(`^${code} `) });
		if (!(await checkbox.isVisible())) await dialog.getByRole("button", { name: new RegExp(`^${module}`, "i") }).first().click();
		await checkbox.check();
	}

	async submitAdd() {
		await this.addDialog().getByRole("button", { name: "Add", exact: true }).click();
	}

	async chooseRowAction(name: string | RegExp, action: string) {
		await this.row(name).getByRole("button", { name: "Role actions" }).click();
		await this.page.getByRole("menuitem", { name: action }).click();
	}

	async openRowMenu(name: string | RegExp) {
		await this.row(name).getByRole("button", { name: "Role actions" }).click();
	}

	menuItem(action: string) {
		return this.page.getByRole("menuitem", { name: action });
	}

	editDialog(roleName: string) {
		return this.page.getByRole("dialog", { name: `Edit permissions — ${roleName}` });
	}

	async saveEdit(roleName: string) {
		await this.editDialog(roleName).getByRole("button", { name: "Save" }).click();
	}

	errorAlert() {
		return this.page.getByRole("alert");
	}
}
