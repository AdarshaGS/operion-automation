// Sales screens (/sales, /sales/:id, /sales/customers/:id). IDs refer to docs/SCENARIOS.md section 14 (SAL-U*).
// Sales are made through the API where the screen under test starts from an existing one.

import { test, expect } from "../../../src/sanity/fixtures";
import { INV, balance, createCustomerRecord } from "../../../src/api/inventory";
import { SALES, createSale, getSale, pay, stockedItem } from "../../../src/api/sales";
import { createDisposableUser } from "../../../src/api/users";
import { signedInAs } from "../../../src/ui/asUser";
import { SalesPage } from "../../../src/pages/sales/SalesPage";
import { SaleDetailPage } from "../../../src/pages/sales/SaleDetailPage";
import type { ApiClient } from "../../../src/api/apiClient";

async function campusName(api: ApiClient, id: number): Promise<string> {
	return (await api.get("/api/v1/campuses")).expectStatus(200).body.find((c: { id: number }) => c.id === id).name;
}

test.describe("SAL-U01 make a sale", () => {
	test("SAL-U01 a sale made from the dialog is listed with its receipt number and opens as a receipt", async ({ api, seed, sales, saleDetail, page }) => {
		const a = await stockedItem(api, seed.campusId, 10);
		const b = await stockedItem(api, seed.campusId, 10);
		const customer = await createCustomerRecord(api);
		const campus = await campusName(api, seed.campusId);
		await sales.open();
		const dialog = await sales.fillSale({ customer: customer.name, campus, saleDate: "2026-10-12", lines: [{ item: a.code, quantity: 3, unitPrice: 19.99 }, { item: b.code, quantity: 2, unitPrice: 100 }] });
		await expect(dialog).toContainText("Total: 259.97");
		await dialog.getByRole("button", { name: "Complete sale" }).click();
		await expect(sales.dialog()).toHaveCount(0);
		const row = sales.row(customer.name);
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(campus);
		await expect(row).toContainText("2026-10-12");
		await expect(row).toContainText("259.97");
		await expect(row).toContainText("COMPLETED");
		await expect(row).toContainText(/RCT-\d{6}/);
		const created = (await api.get(SALES, { query: { customerId: customer.id } })).expectStatus(200).body[0];
		expect(await balance(api, a.id, seed.campusId)).toBe(7);
		expect(await balance(api, b.id, seed.campusId)).toBe(8);
		await row.click();
		await expect(page).toHaveURL(new RegExp(`/sales/${created.id}$`));
		await expect(saleDetail.statusChip()).toHaveText("COMPLETED");
		await expect(saleDetail.lineRow(a.code)).toContainText("19.99");
		await expect(saleDetail.lineRow(a.code)).toContainText("59.97");
		await expect(saleDetail.lineRow(b.code)).toContainText("200");
		await expect(saleDetail.totals()).toContainText("Total: 259.97");
		await expect(saleDetail.totals()).toContainText("Paid: 0");
		await expect(saleDetail.totals()).toContainText("Outstanding: 259.97");
		await expect(page.getByText("No payments recorded yet.")).toBeVisible();
	});

	test("SAL-U01 Complete sale stays disabled until customer, campus and every line are filled", async ({ api, seed, sales }) => {
		const item = await stockedItem(api, seed.campusId);
		const customer = await createCustomerRecord(api);
		await sales.open();
		const dialog = await sales.fillSale({ customer: customer.name, campus: await campusName(api, seed.campusId), lines: [{ item: item.code, quantity: 1, unitPrice: 5 }] });
		const submit = dialog.getByRole("button", { name: "Complete sale" });
		await expect(submit).toBeEnabled();
		await dialog.getByLabel(/^Unit price/).fill("");
		await expect(submit).toBeDisabled();
		await dialog.getByLabel(/^Unit price/).fill("5");
		await dialog.getByLabel(/^Quantity/).fill("0");
		await expect(submit).toBeDisabled();
	});

	test("SAL-U01 the dialog total follows the lines as they are edited", async ({ sales }) => {
		await sales.open();
		await sales.newSaleButton().click();
		const dialog = sales.dialog();
		await expect(dialog).toContainText("Total: 0.00");
		await dialog.getByLabel(/^Quantity/).fill("3");
		await dialog.getByLabel(/^Unit price/).fill("12.5");
		await expect(dialog).toContainText("Total: 37.50");
		await dialog.getByRole("button", { name: "Add line" }).click();
		await dialog.getByLabel(/^Quantity/).nth(1).fill("2");
		await dialog.getByLabel(/^Unit price/).nth(1).fill("10");
		await expect(dialog).toContainText("Total: 57.50");
		await dialog.getByRole("button", { name: "Remove line" }).first().click();
		await expect(dialog).toContainText("Total: 20.00");
	});

	test("SAL-U01 an inactive customer is not offered in the dialog", async ({ api, sales, page }) => {
		const customer = await createCustomerRecord(api);
		(await api.post(`${INV}/customers/{id}/status`, { params: { id: customer.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		await sales.open();
		await sales.newSaleButton().click();
		await sales.dialog().getByRole("combobox", { name: /^Customer/ }).click();
		await expect(page.getByRole("option", { name: new RegExp(`^${customer.name}`) })).toHaveCount(0);
	});

	test("SAL-U01 selling more than the balance keeps the dialog open, shows why and keeps the stock", async ({ api, seed, sales }) => {
		const item = await stockedItem(api, seed.campusId, 2);
		const customer = await createCustomerRecord(api);
		await sales.open();
		const dialog = await sales.completeSale({ customer: customer.name, campus: await campusName(api, seed.campusId), lines: [{ item: item.code, quantity: 5, unitPrice: 10 }] });
		// Operion writes the server's reason to the page alert behind the modal; it should be readable in the dialog.
		await expect(dialog, "the rejection reason should be visible in the open dialog").toContainText(/insufficient stock/i, { timeout: 5_000 });
		expect(await balance(api, item.id, seed.campusId)).toBe(2);
	});
});

test.describe("SAL-U02 receipt and payments", () => {
	test("SAL-U02 a part payment then the rest takes the sale COMPLETED -> PARTIALLY_PAID -> PAID", async ({ api, seed, saleDetail }) => {
		const item = await stockedItem(api, seed.campusId);
		const sale = await createSale(api, seed.campusId, { lines: [[item.id, 4, 50]] });
		await saleDetail.open(sale.id, sale.receiptNumber);
		await expect(saleDetail.statusChip()).toHaveText("COMPLETED");
		await saleDetail.recordPaymentButton().click();
		await expect(saleDetail.dialog().getByLabel(/^Amount/), "the outstanding amount is suggested").toHaveValue("200.00");
		await saleDetail.dialog().getByRole("button", { name: "Cancel" }).click();

		const dialog = await saleDetail.recordPayment({ method: "UPI", amount: 75, paidOn: "2026-10-12" });
		await expect(dialog).toHaveCount(0);
		await expect(saleDetail.statusChip()).toHaveText("PARTIALLY_PAID");
		await expect(saleDetail.totals()).toContainText("Paid: 75");
		await expect(saleDetail.totals()).toContainText("Outstanding: 125.00");
		await expect(saleDetail.paymentRows()).toHaveCount(1);
		const payment = saleDetail.paymentRows().first();
		for (const text of ["2026-10-12", "UPI", "75"]) await expect(payment).toContainText(text);

		await saleDetail.recordPayment({ method: "CASH" });
		await expect(saleDetail.statusChip()).toHaveText("PAID");
		await expect(saleDetail.totals()).toContainText("Outstanding: 0.00");
		await expect(saleDetail.recordPaymentButton(), "nothing is outstanding").toHaveCount(0);
		await expect(saleDetail.paymentRows()).toHaveCount(2);
		expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: 200, status: "PAID" });
	});

	test("SAL-U02 a sale paid in full from the API opens with no Record payment button and its payment listed", async ({ api, seed, saleDetail }) => {
		const sale = await createSale(api, seed.campusId);
		await pay(api, sale.id, sale.totalAmount, "CHEQUE");
		await saleDetail.open(sale.id, sale.receiptNumber);
		await expect(saleDetail.statusChip()).toHaveText("PAID");
		await expect(saleDetail.recordPaymentButton()).toHaveCount(0);
		await expect(saleDetail.paymentRows()).toContainText("CHEQUE");
	});

	test("SAL-U02 a payment above the outstanding amount is refused and shows why", async ({ api, seed, saleDetail }) => {
		const sale = await createSale(api, seed.campusId, { lines: [[(await stockedItem(api, seed.campusId)).id, 2, 50]] });
		await saleDetail.open(sale.id, sale.receiptNumber);
		const dialog = await saleDetail.recordPayment({ amount: 500 });
		await expect(dialog, "an overpayment should be refused with a reason in the dialog").toContainText(/exceeds|outstanding|more than/i, { timeout: 5_000 });
		expect((await getSale(api, sale.id)).amountPaid).toBe(0);
	});

	test("SAL-U02 a zero payment is refused and the sale is unchanged", async ({ api, seed, saleDetail }) => {
		const sale = await createSale(api, seed.campusId);
		await saleDetail.open(sale.id, sale.receiptNumber);
		const dialog = await saleDetail.recordPayment({ amount: 0 });
		await expect(dialog, "the reason should be visible in the open dialog").toContainText(/must be positive/i, { timeout: 5_000 });
		expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: 0, status: "COMPLETED" });
	});

	test("SAL-U02 the receipt has a Print receipt button and a way back to the list", async ({ api, seed, saleDetail, page }) => {
		const sale = await createSale(api, seed.campusId);
		await saleDetail.open(sale.id, sale.receiptNumber);
		await expect(saleDetail.printButton()).toBeVisible();
		await page.getByRole("button", { name: "Back to sales" }).click();
		await expect(page).toHaveURL(/\/sales$/);
	});

	test("SAL-U02 an unknown receipt gives an error, not a blank page", async ({ page }) => {
		await page.goto("/sales/999999999");
		await expect(page.getByRole("alert")).toContainText(/sale/i);
	});
});

test.describe("SAL-U03 customer history", () => {
	test("SAL-U03 History on the customers list shows that customer's sales and opens one", async ({ api, seed, inventory, page }) => {
		const mine = await createCustomerRecord(api);
		const other = await createCustomerRecord(api);
		const first = await createSale(api, seed.campusId, { customerId: mine.id });
		const second = await createSale(api, seed.campusId, { customerId: mine.id });
		const theirs = await createSale(api, seed.campusId, { customerId: other.id });
		await pay(api, second.id, second.totalAmount);
		await inventory.open();
		await inventory.row(mine.name).getByRole("button", { name: "History" }).click();
		await expect(page.getByRole("heading", { name: `Purchase history: ${mine.name}`, level: 1 })).toBeVisible();
		await expect(page.getByRole("row", { name: /RCT-/ })).toHaveCount(2);
		await expect(page.getByRole("row", { name: new RegExp(first.receiptNumber) })).toContainText("COMPLETED");
		await expect(page.getByRole("row", { name: new RegExp(second.receiptNumber) })).toContainText("PAID");
		await expect(page.getByText(theirs.receiptNumber)).toHaveCount(0);
		await page.getByRole("row", { name: new RegExp(first.receiptNumber) }).click();
		await expect(page).toHaveURL(new RegExp(`/sales/${first.id}$`));
	});

	test("SAL-U03 a customer with no sales says so", async ({ api, sales, page }) => {
		const customer = await createCustomerRecord(api);
		await sales.openCustomerHistory(customer.id, customer.name);
		await expect(page.getByText("No sales recorded for this customer yet.")).toBeVisible();
	});

	test("SAL-U03 an unknown customer gives an error, not a blank page", async ({ page }) => {
		await page.goto("/sales/customers/999999999");
		await expect(page.getByRole("alert")).toContainText(/customer/i);
	});
});

test.describe("SAL-U04 access", () => {
	test("SAL-U04 a sales viewer sees the sales but is offered no New sale or Record payment", async ({ api, anon, seed, browser }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["SALES_VIEW"]);
		const sale = await createSale(api, seed.campusId);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, viewer.email);
		try {
			const list = new SalesPage(page);
			await list.open();
			await expect(list.row(sale.receiptNumber)).toBeVisible();
			const offered: string[] = [];
			if (await list.newSaleButton().isVisible()) offered.push("New sale");
			const detail = new SaleDetailPage(page);
			await detail.open(sale.id, sale.receiptNumber);
			if (await detail.recordPaymentButton().isVisible()) offered.push("Record payment");
			expect(offered, "buttons the viewer cannot use (the API answers 403)").toEqual([]);
		} finally {
			await context.close();
		}
	});

	test("SAL-U04 a member with no sales permission is told they have no access rather than shown an empty list", async ({ api, anon, seed, browser }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, nobody.email);
		try {
			await page.goto("/sales");
			await page.waitForLoadState("networkidle");
			await expect.soft(page.getByText("No sales yet."), "an empty list is shown instead of an access message").toHaveCount(0);
			await expect.soft(page.getByRole("link", { name: "Sales", exact: true }), "the menu still offers Sales").toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
