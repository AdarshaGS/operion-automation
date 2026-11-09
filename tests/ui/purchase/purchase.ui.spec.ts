// Purchase screens (/purchase, /purchase/orders/:id). IDs refer to docs/SCENARIOS.md section 13 (PUR-U*).
// Orders are built through the API where the screen under test starts from an existing one.

import { test, expect } from "../../../src/sanity/fixtures";
import { balance, createItem, createSupplier } from "../../../src/api/inventory";
import { PO, approvedOrder, createOrder, getOrder, receive, transition } from "../../../src/api/purchase";
import { createDisposableUser } from "../../../src/api/users";
import { signedInAs } from "../../../src/ui/asUser";
import { PurchasePage } from "../../../src/pages/purchase/PurchasePage";
import { PurchaseOrderPage } from "../../../src/pages/purchase/PurchaseOrderPage";
import type { ApiClient } from "../../../src/api/apiClient";

async function campusName(api: ApiClient, id: number): Promise<string> {
	return (await api.get("/api/v1/campuses")).expectStatus(200).body.find((c: { id: number }) => c.id === id).name;
}

test.describe("PUR-U01 create a purchase order", () => {
	test("PUR-U01 an order made from the dialog is listed as DRAFT and opens with its lines", async ({ api, seed, purchase, purchaseOrder, page }) => {
		const a = await createItem(api);
		const b = await createItem(api);
		const supplier = await createSupplier(api);
		const campus = await campusName(api, seed.campusId);
		await purchase.open();
		await purchase.createOrder({ supplier: supplier.name, campus, expectedDate: "2026-12-05", lines: [{ item: a.code, quantity: 10, unitCost: 25 }, { item: b.code, quantity: 4, unitCost: 99.5 }] });
		await expect(purchase.dialog()).toHaveCount(0);
		const row = purchase.row(supplier.name);
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(campus);
		await expect(row).toContainText("2026-12-05");
		await expect(row).toContainText("DRAFT");
		await row.click();
		await expect(page).toHaveURL(/\/purchase\/orders\/\d+$/);
		await expect(purchaseOrder.statusChip()).toHaveText("DRAFT");
		expect(await purchaseOrder.lineCells(a.code)).toEqual([`${a.code} - ${a.name}`, "10", "25", "0", "0", ""]);
		expect(await purchaseOrder.lineCells(b.code)).toEqual([`${b.code} - ${b.name}`, "4", "99.5", "0", "0", ""]);
		const created = (await api.get(PO)).expectStatus(200).body.find((o: { supplierId: number }) => o.supplierId === supplier.id);
		expect(created).toMatchObject({ status: "DRAFT", expectedDate: "2026-12-05", campusId: seed.campusId });
	});

	test("PUR-U01 Create stays disabled until supplier, campus and every line are filled", async ({ api, seed, purchase }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		await purchase.open();
		const dialog = await purchase.fillOrder({ supplier: supplier.name, campus: await campusName(api, seed.campusId), lines: [{ item: item.code, quantity: 5, unitCost: 10 }] });
		await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
		await dialog.getByLabel(/^Unit cost/).fill("");
		await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
		await dialog.getByLabel(/^Unit cost/).fill("10");
		await dialog.getByLabel(/^Quantity/).fill("0");
		await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
	});

	test("PUR-U01 a line can be added and removed, and the last line cannot be removed", async ({ purchase }) => {
		await purchase.open();
		await purchase.newOrderButton().click();
		const dialog = purchase.dialog();
		await expect(dialog.getByRole("button", { name: "Remove line" })).toBeDisabled();
		await dialog.getByRole("button", { name: "Add line" }).click();
		await expect(dialog.getByRole("combobox", { name: /^Item/ })).toHaveCount(2);
		await dialog.getByRole("button", { name: "Remove line" }).first().click();
		await expect(dialog.getByRole("combobox", { name: /^Item/ })).toHaveCount(1);
		await expect(dialog.getByRole("button", { name: "Remove line" })).toBeDisabled();
	});

	test("PUR-U01 an inactive supplier is not offered in the dialog", async ({ api, purchase, page }) => {
		const supplier = await createSupplier(api);
		(await api.post("/api/v1/inventory/suppliers/{id}/status", { params: { id: supplier.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		await purchase.open();
		await purchase.newOrderButton().click();
		await purchase.dialog().getByRole("combobox", { name: /^Supplier/ }).click();
		await expect(page.getByRole("option", { name: supplier.name, exact: true })).toHaveCount(0);
	});

	test("PUR-U01 an order that is not listed anywhere gives an error page, not a blank one", async ({ page }) => {
		await page.goto("/purchase/orders/999999999");
		await expect(page.getByRole("alert")).toContainText(/purchase order/i);
	});
});

test.describe("PUR-U02 work an order from its page", () => {
	test("PUR-U02 submit, approve, then receive in two goes to RECEIVED, with stock added", async ({ api, seed, purchaseOrder }) => {
		const item = await createItem(api);
		const order = await createOrder(api, seed.campusId, { lines: [[item.id, 10, 25]] });
		await purchaseOrder.open(order.id);
		await expect(purchaseOrder.statusChip()).toHaveText("DRAFT");
		await expect(purchaseOrder.button("Approve")).toHaveCount(0);
		await purchaseOrder.button("Submit").click();
		await expect(purchaseOrder.statusChip()).toHaveText("SUBMITTED");
		await expect(purchaseOrder.button("Submit")).toHaveCount(0);
		await purchaseOrder.button("Approve").click();
		await expect(purchaseOrder.statusChip()).toHaveText("APPROVED");
		await expect(purchaseOrder.button("Receive goods")).toBeVisible();

		const dialog = await purchaseOrder.receive({ [item.code]: 4 });
		await expect(dialog).toHaveCount(0);
		await expect(purchaseOrder.statusChip()).toHaveText("PARTIALLY_RECEIVED");
		expect((await purchaseOrder.lineCells(item.code)).slice(1, 5)).toEqual(["10", "25", "4", "0"]);
		expect(await balance(api, item.id, seed.campusId)).toBe(4);
		await expect(purchaseOrder.button("Cancel")).toHaveCount(0);

		await purchaseOrder.receive({ [item.code]: 6 });
		await expect(purchaseOrder.statusChip()).toHaveText("RECEIVED");
		await expect(purchaseOrder.button("Receive goods")).toHaveCount(0);
		expect(await balance(api, item.id, seed.campusId)).toBe(10);
	});

	test("PUR-U02 the receive dialog lists only lines still to receive, with the quantity left", async ({ api, seed, purchaseOrder }) => {
		const a = await createItem(api);
		const b = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[a.id, 5, 10], [b.id, 8, 10]] });
		await receive(api, order.id, [[order.lines.find((l) => l.itemId === a.id)!.id, 5]]);
		await purchaseOrder.open(order.id);
		await purchaseOrder.button("Receive goods").click();
		const dialog = purchaseOrder.receiveDialog();
		await expect(dialog.getByLabel(new RegExp(`^${b.code} - .*\\(max 8\\)`))).toBeVisible();
		await expect(dialog.getByLabel(new RegExp(`^${a.code} - `))).toHaveCount(0);
	});

	test("PUR-U02 a return from a received line shows under Returned and takes the stock back", async ({ api, seed, purchaseOrder }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 10, 25]] });
		await receive(api, order.id, [[order.lines[0].id, 10]]);
		await purchaseOrder.open(order.id);
		await expect(purchaseOrder.lineRow(item.code).getByRole("button", { name: "Return" })).toBeVisible();
		const dialog = await purchaseOrder.returnLine(item.code, 3, "WRONG_ITEM", "Wrong size");
		await expect(dialog).toHaveCount(0);
		expect((await purchaseOrder.lineCells(item.code)).slice(3, 5)).toEqual(["10", "3"]);
		expect(await balance(api, item.id, seed.campusId)).toBe(7);
		expect((await getOrder(api, order.id)).lines[0].quantityReturned).toBe(3);
	});

	test("PUR-U02 a line with nothing left to return has no Return button", async ({ api, seed, purchaseOrder }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 4, 25]] });
		await receive(api, order.id, [[order.lines[0].id, 4]]);
		await purchaseOrder.open(order.id);
		await purchaseOrder.returnLine(item.code, 4);
		await expect(purchaseOrder.lineRow(item.code).getByRole("button", { name: "Return" })).toHaveCount(0);
	});

	for (const stage of ["DRAFT", "SUBMITTED", "APPROVED"] as const) {
		test(`PUR-U02 a ${stage} order is cancelled from its page and then offers no actions`, async ({ api, seed, purchaseOrder }) => {
			const order = await createOrder(api, seed.campusId);
			if (stage !== "DRAFT") await transition(api, order.id, "submit");
			if (stage === "APPROVED") await transition(api, order.id, "approve");
			await purchaseOrder.open(order.id);
			await purchaseOrder.button("Cancel").click();
			await expect(purchaseOrder.statusChip()).toHaveText("CANCELLED");
			for (const name of ["Submit", "Approve", "Receive goods", "Cancel"]) await expect(purchaseOrder.button(name)).toHaveCount(0);
		});
	}

	test("PUR-U02 receiving more than is left keeps the dialog open and shows why", async ({ api, seed, purchaseOrder }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 5, 10]] });
		await purchaseOrder.open(order.id);
		const dialog = await purchaseOrder.receive({ [item.code]: 9 });
		// Operion writes the server's reason to the page alert behind the modal; it should be readable in the dialog.
		await expect(dialog, "the rejection reason should be visible in the open dialog").toContainText(/left to receive|only 5/i, { timeout: 5_000 });
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
	});

	test("PUR-U02 returning more than was received keeps the dialog open and shows why", async ({ api, seed, purchaseOrder }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 5, 10]] });
		await receive(api, order.id, [[order.lines[0].id, 5]]);
		await purchaseOrder.open(order.id);
		const dialog = await purchaseOrder.returnLine(item.code, 9);
		await expect(dialog, "the rejection reason should be visible in the open dialog").toContainText(/only 5 available|available to return/i, { timeout: 5_000 });
		expect(await balance(api, item.id, seed.campusId)).toBe(5);
	});

	test("PUR-U02 an action on an order another user already moved shows the server's reason on the page", async ({ api, seed, purchaseOrder }) => {
		const order = await createOrder(api, seed.campusId);
		await purchaseOrder.open(order.id);
		await transition(api, order.id, "submit");
		await purchaseOrder.button("Submit").click();
		await expect(purchaseOrder.alert()).toContainText(/draft purchase order can be submitted|was SUBMITTED/i);
	});
});

test.describe("PUR-U03 access", () => {
	test("PUR-U03 a purchase viewer sees the orders but is offered no create or workflow actions", async ({ api, anon, seed, browser }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["PURCHASE_VIEW"]);
		const order = await approvedOrder(api, seed.campusId);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, viewer.email);
		try {
			const list = new PurchasePage(page);
			await list.open();
			await expect(list.row("APPROVED").first()).toBeVisible();
			const offered: string[] = [];
			if (await list.newOrderButton().isVisible()) offered.push("New purchase order");
			const detail = new PurchaseOrderPage(page);
			await detail.open(order.id);
			for (const name of ["Submit", "Approve", "Receive goods", "Cancel"]) if (await detail.button(name).isVisible()) offered.push(name);
			expect(offered, "buttons the viewer cannot use (the API answers 403)").toEqual([]);
		} finally {
			await context.close();
		}
	});

	test("PUR-U03 a member with no purchase permission is told they have no access rather than shown an empty list", async ({ api, anon, seed, browser }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, nobody.email);
		try {
			await page.goto("/purchase");
			await page.waitForLoadState("networkidle");
			await expect.soft(page.getByText("No purchase orders yet."), "an empty list is shown instead of an access message").toHaveCount(0);
			await expect.soft(page.getByRole("link", { name: "Purchase" }), "the menu still offers Purchase").toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
