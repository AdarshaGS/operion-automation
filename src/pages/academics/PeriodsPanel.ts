import type { Page } from "@playwright/test";

export type SlotKind = "TEACHING" | "BREAK" | "SPECIAL";
const KIND_OPTION: Record<SlotKind, RegExp> = { TEACHING: /^Class period$/, BREAK: /^Break/, SPECIAL: /^Special slot/ };

/** Academics > Periods: the school-day periods table and its Add / Edit period dialog. */
export class PeriodsPanel {
	constructor(private readonly page: Page) {}

	row(label: string | RegExp) {
		return this.page.getByRole("row").filter({ hasText: label });
	}

	dialog() {
		return this.page.getByRole("dialog");
	}

	async openAdd() {
		await this.page.getByRole("button", { name: "Add period" }).click();
		await this.dialog().waitFor();
	}

	async fill(values: { ordinal?: string; label: string; start: string; end: string; breakSlot?: boolean; kind?: SlotKind }) {
		const dialog = this.dialog();
		if (values.ordinal !== undefined) await dialog.getByLabel(/^Order/).fill(values.ordinal);
		await dialog.getByLabel(/^Label/).fill(values.label);
		await dialog.getByLabel(/^Start/).fill(values.start);
		await dialog.getByLabel(/^End/).fill(values.end);
		const kind = values.kind ?? (values.breakSlot ? "BREAK" : undefined);
		if (kind) await this.chooseKind(kind);
	}

	/** The "Kind" select replaced the old Break checkbox: class period, break, or a special slot such as assembly. */
	async chooseKind(kind: SlotKind) {
		await this.dialog().getByRole("combobox", { name: "Kind" }).click();
		await this.page.getByRole("option", { name: KIND_OPTION[kind] }).click();
	}

	async submit() {
		await this.dialog().getByRole("button", { name: /^(Add|Save)$/ }).click();
	}

	async openEdit(label: string | RegExp) {
		await this.row(label).getByRole("button", { name: "Edit" }).click();
		await this.dialog().waitFor();
	}

	async delete(label: string | RegExp) {
		await this.row(label).getByRole("button", { name: "Delete" }).click();
	}
}
