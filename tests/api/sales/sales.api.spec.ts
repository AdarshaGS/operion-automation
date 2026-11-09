// Sales: create a sale (which issues stock and fixes the total), receipt numbers, payments, filtering,
// permissions and tenancy. IDs refer to docs/SCENARIOS.md section 14 (SAL-*). Each test that checks a
// balance uses its own item.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { INV, balance, createCustomerRecord } from "../../../src/api/inventory";
import { SALES, createSale, getSale, pay, saleBody, stockedItem } from "../../../src/api/sales";

const ids = (list: { id: number }[]) => list.map((x) => x.id);

test.describe("SAL-01 create a sale", () => {
	test("SAL-01 a new sale is COMPLETED and unpaid, with its lines, a total and a receipt number", async ({ api, seed }) => {
		const a = await stockedItem(api, seed.campusId);
		const b = await stockedItem(api, seed.campusId);
		const customer = await createCustomerRecord(api);
		const sale = await createSale(api, seed.campusId, { customerId: customer.id, lines: [[a.id, 3, 19.99], [b.id, 2, 100]] });
		expect(sale).toMatchObject({ customerId: customer.id, campusId: seed.campusId, saleDate: "2026-10-10", totalAmount: 259.97, amountPaid: 0, status: "COMPLETED" });
		expect(sale.receiptNumber).toMatch(/^RCT-\d{6}$/);
		const detail = await getSale(api, sale.id);
		expect(detail.lines).toHaveLength(2);
		expect(detail.lines.find((l) => l.itemId === a.id)).toMatchObject({ quantity: 3, unitPrice: 19.99, lineTotal: 59.97 });
		expect(detail.lines.find((l) => l.itemId === b.id)).toMatchObject({ quantity: 2, unitPrice: 100, lineTotal: 200 });
		expect(detail.payments).toEqual([]);
	});

	test("SAL-01 selling issues the stock: the balance drops by the quantity sold", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 10);
		await createSale(api, seed.campusId, { lines: [[item.id, 4, 25]] });
		expect(await balance(api, item.id, seed.campusId)).toBe(6);
	});

	test("SAL-01 a sale shows in the item's issue record against the customer", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 10);
		const customer = await createCustomerRecord(api);
		const sale = await createSale(api, seed.campusId, { customerId: customer.id, lines: [[item.id, 1, 25]] });
		const issues = (await api.get(`${INV}/stock-issues`, { query: { itemId: item.id, campusId: seed.campusId } })).expectStatus(200).body as { quantity: number; issuedTo: string; purpose: string }[];
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ quantity: 1, issuedTo: customer.name, purpose: `Sale #${sale.id}` });
	});

	test("SAL-01 a sale is listed and can be fetched", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId);
		(await api.get(SALES)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(sale.id));
		(await api.get(`${SALES}/{id}`, { params: { id: sale.id } })).expectStatus(200).expectJson((s) => expect(s.receiptNumber).toBe(sale.receiptNumber));
	});

	test("SAL-01 an unknown sale returns 404", async ({ api }) => {
		(await api.get(`${SALES}/{id}`, { params: { id: 999999999 } })).expectStatus(404);
	});

	test("SAL-01 an unknown customer, campus or item returns 404", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId);
		const customer = await createCustomerRecord(api);
		const ok = saleBody(customer.id, seed.campusId, [[item.id, 1, 5]]);
		(await api.post(SALES, { body: { ...ok, customerId: 999999999 } })).expectStatus(404);
		(await api.post(SALES, { body: { ...ok, campusId: 999999999 } })).expectStatus(404);
		(await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[999999999, 1, 5]]) })).expectStatus(404);
		expect(await balance(api, item.id, seed.campusId)).toBe(20);
	});

	// Validation: each is a client error and must be a 400 that leaves no sale and no stock movement behind.
	const invalid: [string, (c: number, k: number, i: number) => Record<string, unknown>][] = [
		["no lines", (c, k) => saleBody(c, k, [])],
		["lines missing", (c, k) => ({ customerId: c, campusId: k, saleDate: "2026-10-10" })],
		["a line of quantity 0", (c, k, i) => saleBody(c, k, [[i, 0, 5]])],
		["a line of negative quantity", (c, k, i) => saleBody(c, k, [[i, -2, 5]])],
		["a line with no unit price", (c, k, i) => ({ customerId: c, campusId: k, saleDate: "2026-10-10", lines: [{ itemId: i, quantity: 1 }] })],
		["a line with a negative unit price", (c, k, i) => saleBody(c, k, [[i, 1, -5]])],
		["no sale date", (c, k, i) => ({ ...saleBody(c, k, [[i, 1, 5]]), saleDate: null })],
		["no customer", (c, k, i) => ({ ...saleBody(c, k, [[i, 1, 5]]), customerId: null })],
		["no campus", (c, k, i) => ({ ...saleBody(c, k, [[i, 1, 5]]), campusId: null })],
	];
	for (const [name, build] of invalid) {
		test(`SAL-01 a sale with ${name} returns 400`, async ({ api, seed }) => {
			const item = await stockedItem(api, seed.campusId, 10);
			const customer = await createCustomerRecord(api);
			(await api.post(SALES, { body: build(customer.id, seed.campusId, item.id) })).expectStatus(400);
			expect(await balance(api, item.id, seed.campusId)).toBe(10);
			(await api.get(SALES, { query: { customerId: customer.id } })).expectJson((list) => expect(list).toEqual([]));
		});
	}

	test("SAL-01 an inactive customer cannot be sold to", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId);
		const customer = await createCustomerRecord(api);
		(await api.post(`${INV}/customers/{id}/status`, { params: { id: customer.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		const res = await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 1, 5]]) });
		expect([400, 409], `an inactive customer was accepted (${res.status})`).toContain(res.status);
	});

	test("SAL-01 a discontinued item cannot be sold", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId);
		const customer = await createCustomerRecord(api);
		(await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } })).expectStatus(200);
		const res = await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 1, 5]]) });
		expect([400, 409], `a discontinued item was sold (${res.status})`).toContain(res.status);
	});
});

test.describe("SAL-02 stock limits", () => {
	test("SAL-02 selling more than the balance returns 409, leaves the balance and records no sale", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 3);
		const customer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 4, 10]]) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
		(await api.get(SALES, { query: { customerId: customer.id } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("SAL-02 the whole balance can be sold, and then nothing more", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 3);
		await createSale(api, seed.campusId, { lines: [[item.id, 3, 10]] });
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
		const customer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 1, 10]]) })).expectStatus(409);
	});

	test("SAL-02 a sale that is short on its second line is rejected whole (the first line's stock is untouched)", async ({ api, seed }) => {
		const a = await stockedItem(api, seed.campusId, 10);
		const b = await stockedItem(api, seed.campusId, 1);
		const customer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[a.id, 5, 10], [b.id, 2, 10]]) })).expectStatus(409);
		expect(await balance(api, a.id, seed.campusId)).toBe(10);
		expect(await balance(api, b.id, seed.campusId)).toBe(1);
		(await api.get(SALES, { query: { customerId: customer.id } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("SAL-02 stock at another campus cannot be sold from this one", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 10);
		const campus = (await api.post("/api/v1/campuses", { body: { name: `Sales campus ${Date.now()}`, code: `SC${Date.now()}`.slice(0, 12) } })).expectStatus([200, 201]).body;
		const customer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(customer.id, campus.id, [[item.id, 1, 5]]) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(10);
	});

	test("SAL-02 ten simultaneous sales of 1 against a balance of 5 never take it below zero", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 5);
		const customer = await createCustomerRecord(api);
		const results = await Promise.all(Array.from({ length: 10 }, () => api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 1, 10]]) })));
		const sold = results.filter((r) => r.status === 200).length;
		expect({ sold, balance: await balance(api, item.id, seed.campusId) }, "concurrent sales oversold the stock").toEqual({ sold: 5, balance: 0 });
	});
});

test.describe("SAL-03 payments", () => {
	test("SAL-03 a part payment makes the sale PARTIALLY_PAID and the rest makes it PAID", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId, { lines: [[(await stockedItem(api, seed.campusId)).id, 4, 50]] });
		expect(sale.totalAmount).toBe(200);
		const first = await pay(api, sale.id, 75, "CASH");
		expect(first).toMatchObject({ amountPaid: 75, status: "PARTIALLY_PAID" });
		const second = await pay(api, sale.id, 125, "UPI");
		expect(second).toMatchObject({ amountPaid: 200, status: "PAID" });
		expect(second.payments.map((p) => [p.paymentMethod, p.amount]).sort()).toEqual([["CASH", 75], ["UPI", 125]]);
		expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: 200, status: "PAID" });
	});

	test("SAL-03 a single full payment makes the sale PAID", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId);
		expect((await pay(api, sale.id, sale.totalAmount, "CARD")).status).toBe("PAID");
	});

	for (const method of ["CASH", "CARD", "UPI", "CHEQUE", "BANK_TRANSFER"]) {
		test(`SAL-03 a ${method} payment is recorded with its method, amount and date`, async ({ api, seed }) => {
			const sale = await createSale(api, seed.campusId);
			const detail = await pay(api, sale.id, 10, method, { paidAt: "2026-10-12" });
			expect(detail.payments).toEqual([expect.objectContaining({ paymentMethod: method, amount: 10, paidAt: "2026-10-12" })]);
		});
	}

	test("SAL-03 a payment above what is outstanding returns 409 and records nothing", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId);
		await pay(api, sale.id, sale.totalAmount - 10);
		const res = await api.post(`${SALES}/{id}/payments`, { params: { id: sale.id }, body: { paymentMethod: "CASH", amount: 50, paidAt: "2026-10-11" } });
		expect(res.status, "paid more than the sale is worth").toBe(409);
		expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: sale.totalAmount - 10, status: "PARTIALLY_PAID" });
	});

	test("SAL-03 a sale that is already PAID refuses another payment", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId);
		await pay(api, sale.id, sale.totalAmount);
		const res = await api.post(`${SALES}/{id}/payments`, { params: { id: sale.id }, body: { paymentMethod: "CASH", amount: 1, paidAt: "2026-10-11" } });
		expect(res.status, "a PAID sale took another payment").toBe(409);
		expect((await getSale(api, sale.id)).amountPaid).toBe(sale.totalAmount);
	});

	for (const [name, body] of [
		["amount 0", { paymentMethod: "CASH", amount: 0, paidAt: "2026-10-11" }],
		["a negative amount", { paymentMethod: "CASH", amount: -5, paidAt: "2026-10-11" }],
		["no amount", { paymentMethod: "CASH", paidAt: "2026-10-11" }],
		["an unknown method", { paymentMethod: "BARTER", amount: 5, paidAt: "2026-10-11" }],
		["no method", { amount: 5, paidAt: "2026-10-11" }],
		["no date", { paymentMethod: "CASH", amount: 5 }],
	] as const) {
		test(`SAL-03 a payment with ${name} returns 400 and changes nothing`, async ({ api, seed }) => {
			const sale = await createSale(api, seed.campusId);
			(await api.post(`${SALES}/{id}/payments`, { params: { id: sale.id }, body })).expectStatus(400);
			expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: 0, status: "COMPLETED", payments: [] });
		});
	}

	test("SAL-03 a payment on an unknown sale returns 404", async ({ api }) => {
		(await api.post(`${SALES}/{id}/payments`, { params: { id: 999999999 }, body: { paymentMethod: "CASH", amount: 5, paidAt: "2026-10-11" } })).expectStatus(404);
	});

	test("SAL-03 two simultaneous payments that together exceed the total are not both accepted", async ({ api, seed }) => {
		const sale = await createSale(api, seed.campusId, { lines: [[(await stockedItem(api, seed.campusId)).id, 2, 50]] });
		const results = await Promise.all([1, 2].map(() => api.post(`${SALES}/{id}/payments`, { params: { id: sale.id }, body: { paymentMethod: "CASH", amount: 100, paidAt: "2026-10-11" } })));
		expect({ accepted: results.filter((r) => r.status === 200).length, paid: (await getSale(api, sale.id)).amountPaid }, "the sale was paid twice").toEqual({ accepted: 1, paid: 100 });
	});
});

test.describe("SAL-04 list and filter", () => {
	test("SAL-04 the list can be filtered to one customer", async ({ api, seed }) => {
		const mine = await createCustomerRecord(api);
		const other = await createCustomerRecord(api);
		const a = await createSale(api, seed.campusId, { customerId: mine.id });
		const b = await createSale(api, seed.campusId, { customerId: mine.id });
		const c = await createSale(api, seed.campusId, { customerId: other.id });
		(await api.get(SALES, { query: { customerId: mine.id } })).expectStatus(200).expectJson((list) => expect(ids(list).sort()).toEqual([a.id, b.id].sort()));
		(await api.get(SALES, { query: { customerId: other.id } })).expectJson((list) => expect(ids(list)).toEqual([c.id]));
	});

	test("SAL-04 a customer with no sales has an empty list", async ({ api }) => {
		const customer = await createCustomerRecord(api);
		(await api.get(SALES, { query: { customerId: customer.id } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("SAL-04 an unknown customerId filter returns an empty list", async ({ api }) => {
		(await api.get(SALES, { query: { customerId: 999999999 } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("SAL-04 a non-numeric customerId returns 400", async ({ api }) => {
		(await api.get(SALES, { query: { customerId: "abc" } })).expectStatus(400);
	});

	test("SAL-04 each sale in the list carries its paid amount and status", async ({ api, seed }) => {
		const customer = await createCustomerRecord(api);
		const sale = await createSale(api, seed.campusId, { customerId: customer.id });
		await pay(api, sale.id, 10);
		(await api.get(SALES, { query: { customerId: customer.id } })).expectJson((list) => expect(list[0]).toMatchObject({ id: sale.id, amountPaid: 10, status: "PARTIALLY_PAID", totalAmount: sale.totalAmount }));
	});
});

test.describe("SAL-05 receipt numbers", () => {
	// The receipt counter is per organisation, so the exact sequence is checked in a throwaway organisation.
	async function ownOrg(request: Parameters<typeof createOtherOrganisation>[0], calls: Parameters<typeof createOtherOrganisation>[1]) {
		const org = await createOtherOrganisation(request, calls);
		const campusId = (await org.client.get("/api/v1/campuses")).expectStatus(200).body[0].id as number;
		return { api: org.client, campusId };
	}
	const num = (s: { receiptNumber: string }) => Number(s.receiptNumber.slice(4));

	test("SAL-05 receipt numbers start at RCT-000001 and increase one at a time", async ({ request, calls }) => {
		const { api, campusId } = await ownOrg(request, calls);
		const a = await createSale(api, campusId);
		const b = await createSale(api, campusId);
		expect(a.receiptNumber).toBe("RCT-000001");
		expect(num(b)).toBe(num(a) + 1);
	});

	test("SAL-05 simultaneous sales get distinct receipt numbers", async ({ api, seed }) => {
		const item = await stockedItem(api, seed.campusId, 50);
		const customer = await createCustomerRecord(api);
		const results = await Promise.all(Array.from({ length: 8 }, () => api.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 1, 10]]) })));
		const numbers = results.filter((r) => r.status === 200).map((r) => r.body.receiptNumber as string);
		expect(numbers).toHaveLength(8);
		expect(new Set(numbers).size).toBe(8);
	});

	test("SAL-05 a rejected sale does not use up a receipt number", async ({ request, calls }) => {
		const { api, campusId } = await ownOrg(request, calls);
		const a = await createSale(api, campusId);
		const item = await stockedItem(api, campusId, 1);
		const customer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(customer.id, campusId, [[item.id, 5, 10]]) })).expectStatus(409);
		const b = await createSale(api, campusId);
		expect(num(b)).toBe(num(a) + 1);
	});
});

test.describe("SAL permissions and tenancy", () => {
	test("SAL every endpoint without a token returns 401", async ({ anon }) => {
		(await anon.get(SALES)).expectStatus(401);
		(await anon.get(`${SALES}/{id}`, { params: { id: 1 } })).expectStatus(401);
		(await anon.post(SALES, { body: {} })).expectStatus(401);
		(await anon.post(`${SALES}/{id}/payments`, { params: { id: 1 }, body: {} })).expectStatus(401);
	});

	test("SAL a member without SALES_VIEW cannot read sales", async ({ api, anon, seed }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const sale = await createSale(api, seed.campusId);
		(await nobody.client.get(SALES)).expectStatus(403);
		(await nobody.client.get(`${SALES}/{id}`, { params: { id: sale.id } })).expectStatus(403);
	});

	test("SAL a viewer can read sales but not create one or take a payment", async ({ api, anon, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["SALES_VIEW"]);
		const item = await stockedItem(api, seed.campusId, 10);
		const sale = await createSale(api, seed.campusId, { lines: [[item.id, 1, 50]] });
		(await viewer.client.get(SALES)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(sale.id));
		(await viewer.client.get(`${SALES}/{id}`, { params: { id: sale.id } })).expectStatus(200);
		(await viewer.client.post(SALES, { body: saleBody(sale.customerId, seed.campusId, [[item.id, 1, 5]]) })).expectStatus(403);
		(await viewer.client.post(`${SALES}/{id}/payments`, { params: { id: sale.id }, body: { paymentMethod: "CASH", amount: 5, paidAt: "2026-10-11" } })).expectStatus(403);
		expect(await balance(api, item.id, seed.campusId)).toBe(9);
		expect(await getSale(api, sale.id)).toMatchObject({ amountPaid: 0 });
	});

	test("SAL a SALES_MANAGE holder can sell and take payment", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["SALES_VIEW", "SALES_MANAGE"]);
		const item = await stockedItem(api, seed.campusId, 5);
		const customer = await createCustomerRecord(api);
		const created = (await manager.client.post(SALES, { body: saleBody(customer.id, seed.campusId, [[item.id, 2, 30]]) })).expectStatus(200).body;
		const paid = (await manager.client.post(`${SALES}/{id}/payments`, { params: { id: created.id }, body: { paymentMethod: "CASH", amount: 60, paidAt: "2026-10-11" } })).expectStatus(200).body;
		expect(paid.status).toBe("PAID");
	});

	test("SAL another organisation's sales, customers and items are invisible and untouchable", async ({ api, request, calls, seed }) => {
		const org = await createOtherOrganisation(request, calls);
		const theirCampus = (await org.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const theirItem = await stockedItem(org.client, theirCampus, 5);
		const theirCustomer = await createCustomerRecord(org.client);
		const theirs = await createSale(org.client, theirCampus, { customerId: theirCustomer.id, lines: [[theirItem.id, 1, 40]] });
		(await api.get(SALES)).expectJson((list) => expect(ids(list)).not.toContain(theirs.id));
		(await api.get(SALES, { query: { customerId: theirCustomer.id } })).expectJson((list) => expect(list).toEqual([]));
		(await api.get(`${SALES}/{id}`, { params: { id: theirs.id } })).expectStatus(404);
		(await api.post(`${SALES}/{id}/payments`, { params: { id: theirs.id }, body: { paymentMethod: "CASH", amount: 5, paidAt: "2026-10-11" } })).expectStatus(404);
		const mine = await stockedItem(api, seed.campusId, 5);
		const myCustomer = await createCustomerRecord(api);
		(await api.post(SALES, { body: saleBody(theirCustomer.id, seed.campusId, [[mine.id, 1, 5]]) })).expectStatus(404);
		(await api.post(SALES, { body: saleBody(myCustomer.id, theirCampus, [[mine.id, 1, 5]]) })).expectStatus(404);
		(await api.post(SALES, { body: saleBody(myCustomer.id, seed.campusId, [[theirItem.id, 1, 5]]) })).expectStatus(404);
		expect(await balance(org.client, theirItem.id, theirCampus)).toBe(4);
		expect(await getSale(org.client, theirs.id)).toMatchObject({ amountPaid: 0 });
	});
});
