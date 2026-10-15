// Inventory screens (/inventory, /inventory/items/{id}). IDs refer to docs/SCENARIOS.md section 12
// (INV-U*). Items are created with unique codes; transfers use a campus made for the test.

import { test, expect } from "../../../src/sanity/fixtures";
import { INV, balance, createCampus, createCategory, createItem, stockIn } from "../../../src/api/inventory";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";
import { storageStateFor } from "../../../src/ui/session";
import { createDisposableUser } from "../../../src/api/users";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { UI_BASE_URL } from "../../../src/config/env";
import { InventoryPage } from "../../../src/pages/inventory/InventoryPage";
import type { ApiClient } from "../../../src/api/apiClient";

async function campusName(api: ApiClient, id: number): Promise<string> {
	return (await api.get("/api/v1/campuses")).expectStatus(200).body.find((c: { id: number }) => c.id === id).name;
}

test.describe("INV-U01 items and stock", () => {
	test("INV-U01 an item added from the dialog is listed and opens its page", async ({ api, inventory, page }) => {
		const category = await createCategory(api);
		const code = uniqueCode("UI");
		const name = `UI item ${uniqueSuffix()}`;
		await inventory.open();
		await inventory.addItem({ category: category.name, code, name, unit: "Box", reorderLevel: 3, storageLocation: "Cupboard 1" });
		await expect(inventory.dialog("Add item")).toHaveCount(0);
		const row = inventory.row(code);
		await expect(row).toContainText(name);
		await expect(row).toContainText(category.name);
		await expect(row).toContainText("Box");
		await expect(row).toContainText("Cupboard 1");
		await row.click();
		await expect(page.getByRole("heading", { name })).toBeVisible();
		(await api.get(`${INV}/items`)).expectJson((list) => expect(list.find((i: { code: string }) => i.code === code)).toMatchObject({ name, reorderLevel: 3 }));
	});

	test("INV-U01 receiving stock from the item page updates the balance and ledger", async ({ api, seed, inventory, page }) => {
		const item = await createItem(api);
		await inventory.openItem(item.id);
		await expect(page.getByText("Pick a campus to view balance and stock activity.")).toBeVisible();
		await inventory.pickCampus(await campusName(api, seed.campusId));
		await expect(inventory.balance()).toHaveText("0");
		await inventory.recordEntry(25, "Annual order");
		await expect(inventory.balance()).toHaveText("25");
		await expect(inventory.ledgerRows()).toHaveCount(1);
		await expect(inventory.ledgerRows()).toContainText("+25");
		await expect(inventory.ledgerRows()).toContainText("Annual order");
		expect(await balance(api, item.id, seed.campusId)).toBe(25);
	});

	test("INV-U01 an issue and an adjustment appear in the ledger with their signs", async ({ api, seed, inventory }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 10);
		await inventory.openItem(item.id);
		await inventory.pickCampus(await campusName(api, seed.campusId));
		await inventory.recordIssue(4, "Class 7A");
		await expect(inventory.balance()).toHaveText("6");
		await inventory.recordAdjustment(-1, "DAMAGE");
		await expect(inventory.balance()).toHaveText("5");
		await expect(inventory.ledgerRows().filter({ hasText: "ISSUE" })).toContainText("-4");
		await expect(inventory.ledgerRows().filter({ hasText: "ISSUE" })).toContainText("Class 7A");
		await expect(inventory.ledgerRows().filter({ hasText: "ADJUSTMENT" })).toContainText("DAMAGE");
	});

	test("INV-U01 issuing more than the balance shows the error and keeps the balance", async ({ api, seed, inventory, page }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 2);
		await inventory.openItem(item.id);
		await inventory.pickCampus(await campusName(api, seed.campusId));
		const dialog = await inventory.recordIssue(5, "Too many");
		// The dialog stays open; Operion writes the server's reason to the page alert behind the modal.
		await expect(dialog, "the rejected issue's reason should be shown in the open dialog").toContainText(/insufficient|not enough|available|balance/i, { timeout: 5_000 }).catch(async (e) => {
			await page.keyboard.press("Escape");
			await expect(inventory.balance()).toHaveText("2");
			throw e;
		});
		await page.keyboard.press("Escape");
		await expect(inventory.balance()).toHaveText("2");
		expect(await balance(api, item.id, seed.campusId)).toBe(2);
	});

	test("INV-U01 the reorder level and storage location are updated from the item page", async ({ api, inventory, page }) => {
		const item = await createItem(api);
		await inventory.openItem(item.id);
		await expect(page.getByRole("heading", { name: item.name })).toBeVisible();
		await page.getByLabel("Reorder level (optional)").fill("9");
		await page.getByRole("button", { name: "Update" }).first().click();
		await page.getByLabel("Storage location (optional)").fill("Basement");
		await page.getByRole("button", { name: "Update" }).nth(1).click();
		await expect.poll(async () => (await api.get(`${INV}/items`)).body.find((i: { id: number }) => i.id === item.id)).toMatchObject({ reorderLevel: 9, storageLocation: "Basement" });
	});
});

test.describe("INV-U02 low stock", () => {
	test("INV-U02 an item under its reorder level is flagged Low stock on the list and its page", async ({ api, inventory }) => {
		const campus = await createCampus(api);
		const low = await createItem(api, { reorderLevel: 10 });
		const fine = await createItem(api, { reorderLevel: 10 });
		await stockIn(api, low.id, campus.id, 3);
		await stockIn(api, fine.id, campus.id, 30);
		await inventory.open();
		await inventory.lowStockFor(campus.name);
		await expect(inventory.row(low.code)).toContainText("Low stock");
		await expect(inventory.row(fine.code)).toHaveCount(0);
		await inventory.openItem(low.id);
		await inventory.pickCampus(campus.name);
		await expect(inventory.balance()).toHaveText("3");
		await expect(inventory.lowStockChip()).toBeVisible();
	});

	test("INV-U02 an item above its reorder level shows no Low stock chip", async ({ api, inventory }) => {
		const campus = await createCampus(api);
		const item = await createItem(api, { reorderLevel: 2 });
		await stockIn(api, item.id, campus.id, 8);
		await inventory.openItem(item.id);
		await inventory.pickCampus(campus.name);
		await expect(inventory.balance()).toHaveText("8");
		await expect(inventory.lowStockChip()).toHaveCount(0);
	});
});

test.describe("INV-U03 transfers", () => {
	test("INV-U03 a transfer from the item page moves stock to the other campus", async ({ api, seed, inventory }) => {
		const item = await createItem(api);
		const to = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 12);
		await inventory.openItem(item.id);
		await inventory.pickCampus(await campusName(api, seed.campusId));
		await inventory.transfer(to.name, 5, "Branch top-up");
		await expect(inventory.dialog("Transfer to another campus")).toHaveCount(0);
		await expect(inventory.balance()).toHaveText("7");
		expect(await balance(api, item.id, to.id)).toBe(5);
		await inventory.pickCampus(to.name);
		await expect(inventory.balance()).toHaveText("5");
	});

	test("INV-U03 a transfer is shown in the ledger of both campuses", async ({ api, seed, inventory }) => {
		const item = await createItem(api);
		const to = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 6);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: to.id, quantity: 2, transferDate: "2026-09-05" } })).expectStatus(200);
		await inventory.openItem(item.id);
		await inventory.pickCampus(to.name);
		await expect(inventory.ledgerRows(), "the destination ledger should show the incoming transfer").toContainText("+2");
		await inventory.pickCampus(await campusName(api, seed.campusId));
		await expect(inventory.ledgerRows().filter({ hasText: "-2" }), "the source ledger should show the outgoing transfer").toHaveCount(1);
	});
});

test.describe("INV-U access", () => {
	test("INV-U01 an inventory viewer is offered no add, stock or transfer actions", async ({ api, anon, seed, browser }) => {
		const item = await createItem(api);
		const user = await createDisposableUser(api, anon, seed, ["INVENTORY_VIEW"]);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		try {
			const page = await context.newPage();
			const inventory = new InventoryPage(page);
			await inventory.open();
			const offered: string[] = [];
			for (const name of ["Add category", "Add item", "Add asset", "Add supplier", "Add customer"]) if (await inventory.button(name).isVisible()) offered.push(name);
			await inventory.openItem(item.id);
			await inventory.pickCampus(await campusName(api, seed.campusId));
			for (const name of ["Record entry", "Record issue", "Record adjustment", "Transfer to another campus"]) if (await inventory.button(name).isVisible()) offered.push(name);
			expect(offered, "buttons the viewer cannot use (the API answers 403)").toEqual([]);
		} finally {
			await context.close();
		}
	});
});
