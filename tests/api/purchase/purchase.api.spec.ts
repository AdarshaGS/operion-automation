// Purchase orders: create, the DRAFT -> SUBMITTED -> APPROVED -> receiving status machine, goods receipt
// (which adds stock), returns to the supplier (which removes it), permissions and tenancy. IDs refer to
// docs/SCENARIOS.md section 13 (PUR-*). Each test that checks a balance uses its own item.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { INV, balance, createItem, createSupplier, issueBody } from "../../../src/api/inventory";
import { PO, approvedOrder, createOrder, getOrder, receive, receiveBody, returnBody, transition } from "../../../src/api/purchase";

const ids = (list: { id: number }[]) => list.map((x) => x.id);

test.describe("PUR-01 create a purchase order", () => {
	test("PUR-01 a new order is a DRAFT with its lines, nothing received, and is listed", async ({ api, seed }) => {
		const a = await createItem(api);
		const b = await createItem(api);
		const supplier = await createSupplier(api);
		const order = await createOrder(api, seed.campusId, { supplierId: supplier.id, lines: [[a.id, 10, 25.5], [b.id, 4, 100]], expectedDate: "2026-11-15" });
		expect(order).toMatchObject({ supplierId: supplier.id, campusId: seed.campusId, expectedDate: "2026-11-15", status: "DRAFT" });
		const detail = await getOrder(api, order.id);
		expect(detail.lines).toHaveLength(2);
		expect(detail.lines.find((l) => l.itemId === a.id)).toMatchObject({ quantity: 10, unitCost: 25.5, quantityReceived: 0, quantityReturned: 0 });
		expect(detail.lines.find((l) => l.itemId === b.id)).toMatchObject({ quantity: 4, unitCost: 100, quantityReceived: 0 });
		(await api.get(PO)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(order.id));
	});

	test("PUR-01 creating an order does not change any stock", async ({ api, seed }) => {
		const item = await createItem(api);
		await createOrder(api, seed.campusId, { lines: [[item.id, 10, 5]] });
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
	});

	test("PUR-01 an unknown order returns 404", async ({ api }) => {
		(await api.get(`${PO}/{id}`, { params: { id: 999999999 } })).expectStatus(404);
	});

	test("PUR-01 an unknown supplier, campus or item returns 404", async ({ api, seed }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		const base = { supplierId: supplier.id, campusId: seed.campusId, expectedDate: "2026-11-01", lines: [{ itemId: item.id, quantity: 1, unitCost: 5 }] };
		(await api.post(PO, { body: { ...base, supplierId: 999999999 } })).expectStatus(404);
		(await api.post(PO, { body: { ...base, campusId: 999999999 } })).expectStatus(404);
		(await api.post(PO, { body: { ...base, lines: [{ itemId: 999999999, quantity: 1, unitCost: 5 }] } })).expectStatus(404);
	});

	// Validation: each of these is a client error and must be a 400 (and leave no order behind).
	const invalid: [string, (s: { supplierId: number; campusId: number; itemId: number }) => Record<string, unknown>][] = [
		["no lines", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01", lines: [] })],
		["lines missing", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01" })],
		["a line of quantity 0", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: 0, unitCost: 5 }] })],
		["a line of negative quantity", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: -3, unitCost: 5 }] })],
		["a line with no unit cost", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: 1 }] })],
		["a line with a negative unit cost", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: 1, unitCost: -5 }] })],
		["no expected date", (s) => ({ supplierId: s.supplierId, campusId: s.campusId, lines: [{ itemId: s.itemId, quantity: 1, unitCost: 5 }] })],
		["no supplier", (s) => ({ campusId: s.campusId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: 1, unitCost: 5 }] })],
		["no campus", (s) => ({ supplierId: s.supplierId, expectedDate: "2026-11-01", lines: [{ itemId: s.itemId, quantity: 1, unitCost: 5 }] })],
	];
	for (const [name, build] of invalid) {
		test(`PUR-01 an order with ${name} returns 400`, async ({ api, seed }) => {
			const item = await createItem(api);
			const supplier = await createSupplier(api);
			(await api.post(PO, { body: build({ supplierId: supplier.id, campusId: seed.campusId, itemId: item.id }) })).expectStatus(400);
		});
	}

	test("PUR-01 an inactive supplier cannot be ordered from", async ({ api, seed }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		const res = await api.post(PO, { body: { supplierId: supplier.id, campusId: seed.campusId, expectedDate: "2026-11-01", lines: [{ itemId: item.id, quantity: 1, unitCost: 5 }] } });
		expect([400, 409], `an inactive supplier was accepted (${res.status})`).toContain(res.status);
	});

	test("PUR-01 a discontinued item cannot be ordered", async ({ api, seed }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } })).expectStatus(200);
		const res = await api.post(PO, { body: { supplierId: supplier.id, campusId: seed.campusId, expectedDate: "2026-11-01", lines: [{ itemId: item.id, quantity: 1, unitCost: 5 }] } });
		expect([400, 409], `a discontinued item was accepted (${res.status})`).toContain(res.status);
	});
});

test.describe("PUR-02 status machine", () => {
	test("PUR-02 an order moves DRAFT -> SUBMITTED -> APPROVED", async ({ api, seed }) => {
		const order = await createOrder(api, seed.campusId);
		expect(order.status).toBe("DRAFT");
		expect((await transition(api, order.id, "submit")).status).toBe("SUBMITTED");
		expect((await transition(api, order.id, "approve")).status).toBe("APPROVED");
		expect((await getOrder(api, order.id)).status).toBe("APPROVED");
	});

	for (const stage of ["DRAFT", "SUBMITTED", "APPROVED"] as const) {
		test(`PUR-02 a ${stage} order can be cancelled and then stays cancelled`, async ({ api, seed }) => {
			const order = await createOrder(api, seed.campusId);
			if (stage !== "DRAFT") await transition(api, order.id, "submit");
			if (stage === "APPROVED") await transition(api, order.id, "approve");
			expect((await transition(api, order.id, "cancel")).status).toBe("CANCELLED");
			for (const action of ["submit", "approve", "cancel"] as const) (await api.post(`${PO}/{id}/${action}`, { params: { id: order.id } })).expectStatus(409);
			expect((await getOrder(api, order.id)).status).toBe("CANCELLED");
		});
	}

	test("PUR-02 out-of-order transitions return 409 and leave the status alone", async ({ api, seed }) => {
		const draft = await createOrder(api, seed.campusId);
		(await api.post(`${PO}/{id}/approve`, { params: { id: draft.id } })).expectStatus(409);
		(await api.post(`${PO}/{id}/receive`, { params: { id: draft.id }, body: receiveBody([[1, 1]]) })).expectStatus([404, 409]);
		expect((await getOrder(api, draft.id)).status).toBe("DRAFT");
		await transition(api, draft.id, "submit");
		(await api.post(`${PO}/{id}/submit`, { params: { id: draft.id } })).expectStatus(409);
		expect((await getOrder(api, draft.id)).status).toBe("SUBMITTED");
	});

	test("PUR-02 a SUBMITTED order cannot receive goods", async ({ api, seed }) => {
		const order = await createOrder(api, seed.campusId);
		await transition(api, order.id, "submit");
		const line = (await getOrder(api, order.id)).lines[0];
		(await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[line.id, 1]]) })).expectStatus(409);
		expect(await balance(api, line.itemId, seed.campusId)).toBe(0);
	});

	test("PUR-02 an order that has started receiving cannot be cancelled", async ({ api, seed }) => {
		const order = await approvedOrder(api, seed.campusId);
		const line = order.lines[0];
		await receive(api, order.id, [[line.id, 3]]);
		(await api.post(`${PO}/{id}/cancel`, { params: { id: order.id } })).expectStatus(409);
		expect((await getOrder(api, order.id)).status).toBe("PARTIALLY_RECEIVED");
	});

	test("PUR-02 an unknown order cannot be submitted, approved or cancelled (404)", async ({ api }) => {
		for (const action of ["submit", "approve", "cancel"]) (await api.post(`${PO}/{id}/${action}`, { params: { id: 999999999 } })).expectStatus(404);
	});
});

test.describe("PUR-03 receive goods", () => {
	test("PUR-03 a partial receipt adds stock, marks the order PARTIALLY_RECEIVED, and the rest completes it", async ({ api, seed }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 10, 25]] });
		const line = order.lines[0];
		const first = await receive(api, order.id, [[line.id, 4]]);
		expect(first.status).toBe("PARTIALLY_RECEIVED");
		expect(first.lines[0].quantityReceived).toBe(4);
		expect(await balance(api, item.id, seed.campusId)).toBe(4);
		const second = await receive(api, order.id, [[line.id, 6]]);
		expect(second.status).toBe("RECEIVED");
		expect(second.lines[0].quantityReceived).toBe(10);
		expect(await balance(api, item.id, seed.campusId)).toBe(10);
	});

	test("PUR-03 receiving at the ordered cost, or at a different cost, is recorded on the stock entry", async ({ api, seed }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 10, 25]] });
		const line = order.lines[0];
		await receive(api, order.id, [[line.id, 2]]);
		await receive(api, order.id, [[line.id, 3, 30]]);
		const entries = (await api.get(`${INV}/stock-entries`, { query: { itemId: item.id, campusId: seed.campusId } })).expectStatus(200).body as { quantity: number; unitCost: number; source: string }[];
		expect(entries).toHaveLength(2);
		expect(entries.find((e) => e.quantity === 2)).toMatchObject({ unitCost: 25, source: `Purchase Order #${order.id}` });
		expect(entries.find((e) => e.quantity === 3)).toMatchObject({ unitCost: 30 });
	});

	test("PUR-03 an order with several lines stays PARTIALLY_RECEIVED until every line is complete", async ({ api, seed }) => {
		const a = await createItem(api);
		const b = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[a.id, 5, 10], [b.id, 8, 20]] });
		const [la, lb] = [order.lines.find((l) => l.itemId === a.id)!, order.lines.find((l) => l.itemId === b.id)!];
		expect((await receive(api, order.id, [[la.id, 5]])).status).toBe("PARTIALLY_RECEIVED");
		expect((await receive(api, order.id, [[lb.id, 8]])).status).toBe("RECEIVED");
		expect(await balance(api, a.id, seed.campusId)).toBe(5);
		expect(await balance(api, b.id, seed.campusId)).toBe(8);
	});

	test("PUR-03 receiving more than is left to receive returns 409 and adds no stock", async ({ api, seed }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 5, 10]] });
		const line = order.lines[0];
		await receive(api, order.id, [[line.id, 3]]);
		(await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[line.id, 3]]) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
		expect((await getOrder(api, order.id)).lines[0].quantityReceived).toBe(3);
	});

	test("PUR-03 a receipt that is bad on its second line is rejected whole (no stock for the first)", async ({ api, seed }) => {
		const a = await createItem(api);
		const b = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[a.id, 5, 10], [b.id, 2, 10]] });
		const [la, lb] = [order.lines.find((l) => l.itemId === a.id)!, order.lines.find((l) => l.itemId === b.id)!];
		(await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[la.id, 5], [lb.id, 9]]) })).expectStatus(409);
		expect(await balance(api, a.id, seed.campusId)).toBe(0);
		const after = await getOrder(api, order.id);
		expect(after.status).toBe("APPROVED");
		expect(after.lines.map((l) => l.quantityReceived)).toEqual([0, 0]);
	});

	for (const [name, lines] of [["quantity 0", [[0, 0]]], ["a negative quantity", [[0, -2]]]] as const) {
		test(`PUR-03 receiving ${name} returns 400`, async ({ api, seed }) => {
			const order = await approvedOrder(api, seed.campusId);
			const lineId = order.lines[0].id;
			(await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody(lines.map(([, q]) => [lineId, q] as [number, number])) })).expectStatus(400);
			expect((await getOrder(api, order.id)).status).toBe("APPROVED");
		});
	}

	test("PUR-03 a receipt with no lines returns 400 and leaves the order APPROVED", async ({ api, seed }) => {
		const order = await approvedOrder(api, seed.campusId);
		const res = await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: { entryDate: "2026-10-05", lines: [] } });
		expect(res.status, "an empty receipt should be refused").toBe(400);
		expect((await getOrder(api, order.id)).status).toBe("APPROVED");
	});

	test("PUR-03 a receipt with no entry date returns 400", async ({ api, seed }) => {
		const order = await approvedOrder(api, seed.campusId);
		const res = await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: { lines: [{ lineId: order.lines[0].id, quantity: 1 }] } });
		expect(res.status).toBe(400);
		expect(await balance(api, order.lines[0].itemId, seed.campusId)).toBe(0);
	});

	test("PUR-03 receiving an unknown line returns 404", async ({ api, seed }) => {
		const order = await approvedOrder(api, seed.campusId);
		(await api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[999999999, 1]]) })).expectStatus(404);
	});

	test("PUR-03 a line that belongs to another order cannot be received against this one", async ({ api, seed }) => {
		const mine = await approvedOrder(api, seed.campusId);
		const other = await approvedOrder(api, seed.campusId);
		const foreign = other.lines[0];
		const res = await api.post(`${PO}/{id}/receive`, { params: { id: mine.id }, body: receiveBody([[foreign.id, 1]]) });
		expect([400, 404, 409], `received ${res.status}: ${JSON.stringify(res.body)}`).toContain(res.status);
		expect((await getOrder(api, other.id)).lines[0].quantityReceived).toBe(0);
	});

	test("PUR-03 two simultaneous receipts of the full quantity add it only once", async ({ api, seed }) => {
		const item = await createItem(api);
		const order = await approvedOrder(api, seed.campusId, { lines: [[item.id, 5, 10]] });
		const line = order.lines[0];
		const results = await Promise.all([1, 2].map(() => api.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[line.id, 5]]) })));
		expect({ ok: results.filter((r) => r.status === 200).length, balance: await balance(api, item.id, seed.campusId), received: (await getOrder(api, order.id)).lines[0].quantityReceived }, "the same goods were received twice").toEqual({ ok: 1, balance: 5, received: 5 });
	});
});

test.describe("PUR-04 returns to the supplier", () => {
	async function receivedOrder(api: Parameters<typeof createOrder>[0], campusId: number, quantity = 10) {
		const item = await createItem(api);
		const order = await approvedOrder(api, campusId, { lines: [[item.id, quantity, 20]] });
		await receive(api, order.id, [[order.lines[0].id, quantity]]);
		return { item, order, line: order.lines[0] };
	}

	test("PUR-04 a return removes stock, shows on the line, and can be repeated up to the received quantity", async ({ api, seed }) => {
		const { item, order, line } = await receivedOrder(api, seed.campusId);
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(3) })).expectStatus(200).expectJson((r) => expect(r).toMatchObject({ purchaseOrderLineId: line.id, quantity: 3, reason: "DEFECTIVE", returnDate: "2026-10-08", remarks: "Cracked" }));
		expect(await balance(api, item.id, seed.campusId)).toBe(7);
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(7, { reason: "EXCESS" }) })).expectStatus(200);
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
		expect((await getOrder(api, order.id)).lines[0]).toMatchObject({ quantityReceived: 10, quantityReturned: 10 });
	});

	test("PUR-04 every reason is accepted", async ({ api, seed }) => {
		const { order, line } = await receivedOrder(api, seed.campusId, 8);
		for (const reason of ["DEFECTIVE", "EXCESS", "WRONG_ITEM", "OTHER"]) {
			(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(1, { reason }) })).expectStatus(200).expectJson((r) => expect(r.reason).toBe(reason));
		}
	});

	test("PUR-04 returning more than was received (counting earlier returns) returns 409 and changes no stock", async ({ api, seed }) => {
		const { item, order, line } = await receivedOrder(api, seed.campusId, 5);
		await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(4) });
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(2) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(1);
	});

	test("PUR-04 nothing can be returned from a line that has received nothing", async ({ api, seed }) => {
		const order = await approvedOrder(api, seed.campusId);
		const line = order.lines[0];
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(1) })).expectStatus(409);
		expect(await balance(api, line.itemId, seed.campusId)).toBe(0);
	});

	test("PUR-04 stock that has already been issued cannot be returned to the supplier", async ({ api, seed }) => {
		const { item, order, line } = await receivedOrder(api, seed.campusId, 10);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 8) })).expectStatus(200);
		const res = await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(5) });
		expect(res.status, "5 returned with only 2 in stock").toBe(409);
		expect(await balance(api, item.id, seed.campusId)).toBeGreaterThanOrEqual(0);
	});

	for (const [name, body] of [
		["quantity 0", returnBody(0)],
		["a negative quantity", returnBody(-1)],
		["an unknown reason", returnBody(1, { reason: "FELL_OFF_A_TRUCK" })],
		["no reason", returnBody(1, { reason: null })],
		["no return date", returnBody(1, { returnDate: null })],
	] as const) {
		test(`PUR-04 a return with ${name} returns 400`, async ({ api, seed }) => {
			const { item, order, line } = await receivedOrder(api, seed.campusId, 5);
			(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body })).expectStatus(400);
			expect(await balance(api, item.id, seed.campusId)).toBe(5);
		});
	}

	test("PUR-04 a line addressed through the wrong order, or an unknown line, is refused", async ({ api, seed }) => {
		const a = await receivedOrder(api, seed.campusId, 5);
		const b = await receivedOrder(api, seed.campusId, 5);
		const wrong = await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: a.order.id, lineId: b.line.id }, body: returnBody(1) });
		expect([400, 404], `wrong order answered ${wrong.status}`).toContain(wrong.status);
		expect(await balance(api, b.item.id, seed.campusId)).toBe(5);
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: a.order.id, lineId: 999999999 }, body: returnBody(1) })).expectStatus(404);
	});
});

test.describe("PUR permissions and tenancy", () => {
	test("PUR every endpoint without a token returns 401", async ({ anon }) => {
		(await anon.get(PO)).expectStatus(401);
		(await anon.get(`${PO}/{id}`, { params: { id: 1 } })).expectStatus(401);
		(await anon.post(PO, { body: {} })).expectStatus(401);
		(await anon.post(`${PO}/{id}/submit`, { params: { id: 1 } })).expectStatus(401);
		(await anon.post(`${PO}/{id}/receive`, { params: { id: 1 }, body: {} })).expectStatus(401);
	});

	test("PUR a member without PURCHASE_VIEW cannot read orders", async ({ api, anon, seed }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const order = await createOrder(api, seed.campusId);
		(await nobody.client.get(PO)).expectStatus(403);
		(await nobody.client.get(`${PO}/{id}`, { params: { id: order.id } })).expectStatus(403);
	});

	test("PUR a viewer can read orders but not create, move, receive or return", async ({ api, anon, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["PURCHASE_VIEW"]);
		const order = await approvedOrder(api, seed.campusId);
		const line = order.lines[0];
		(await viewer.client.get(PO)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(order.id));
		(await viewer.client.get(`${PO}/{id}`, { params: { id: order.id } })).expectStatus(200);
		(await viewer.client.post(PO, { body: { supplierId: order.supplierId, campusId: seed.campusId, expectedDate: "2026-11-01", lines: [{ itemId: line.itemId, quantity: 1, unitCost: 1 }] } })).expectStatus(403);
		for (const action of ["submit", "approve", "cancel"]) (await viewer.client.post(`${PO}/{id}/${action}`, { params: { id: order.id } })).expectStatus(403);
		(await viewer.client.post(`${PO}/{id}/receive`, { params: { id: order.id }, body: receiveBody([[line.id, 1]]) })).expectStatus(403);
		(await viewer.client.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: order.id, lineId: line.id }, body: returnBody(1) })).expectStatus(403);
		expect(await balance(api, line.itemId, seed.campusId)).toBe(0);
		expect((await getOrder(api, order.id)).status).toBe("APPROVED");
	});

	test("PUR a PURCHASE_MANAGE holder can run an order end to end", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["PURCHASE_VIEW", "PURCHASE_MANAGE"]);
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		const order = await createOrder(manager.client, seed.campusId, { supplierId: supplier.id, lines: [[item.id, 10, 25]] });
		await transition(manager.client, order.id, "submit");
		await transition(manager.client, order.id, "approve");
		const detail = await getOrder(manager.client, order.id);
		expect((await receive(manager.client, order.id, [[detail.lines[0].id, 10]])).status).toBe("RECEIVED");
	});

	test("PUR another organisation's orders are invisible and untouchable", async ({ api, request, calls, seed }) => {
		const org = await createOtherOrganisation(request, calls);
		const theirCampus = (await org.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const theirs = await approvedOrder(org.client, theirCampus);
		const line = theirs.lines[0];
		(await api.get(PO)).expectJson((list) => expect(ids(list)).not.toContain(theirs.id));
		(await api.get(`${PO}/{id}`, { params: { id: theirs.id } })).expectStatus(404);
		(await api.post(`${PO}/{id}/cancel`, { params: { id: theirs.id } })).expectStatus(404);
		(await api.post(`${PO}/{id}/receive`, { params: { id: theirs.id }, body: receiveBody([[line.id, 1]]) })).expectStatus(404);
		(await api.post(`${PO}/{orderId}/lines/{lineId}/returns`, { params: { orderId: theirs.id, lineId: line.id }, body: returnBody(1) })).expectStatus(404);
		const mine = await approvedOrder(api, seed.campusId);
		(await api.post(`${PO}/{id}/receive`, { params: { id: mine.id }, body: receiveBody([[line.id, 1]]) })).expectStatus(404);
		const theirSupplier = await createSupplier(org.client);
		(await api.post(PO, { body: { supplierId: theirSupplier.id, campusId: seed.campusId, expectedDate: "2026-11-01", lines: [{ itemId: mine.lines[0].itemId, quantity: 1, unitCost: 1 }] } })).expectStatus(404);
		(await api.post(PO, { body: { supplierId: mine.supplierId, campusId: theirCampus, expectedDate: "2026-11-01", lines: [{ itemId: mine.lines[0].itemId, quantity: 1, unitCost: 1 }] } })).expectStatus(404);
		expect((await getOrder(org.client, theirs.id)).status).toBe("APPROVED");
	});
});
