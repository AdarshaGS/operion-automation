// Inventory catalogue, stock movements, suppliers, customers, assets, import/export. IDs refer to
// docs/SCENARIOS.md section 12 (INV-*). Each test that checks a balance uses its own item.

import { test, expect } from "../../../src/api/fixtures";
import { createPerson } from "../../../src/api/academics";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { createGuardian } from "../../../src/api/students";
import { INV, balance, createCampus, createCategory, createItem, createSupplier, issueBody, stockIn } from "../../../src/api/inventory";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";

const ids = (list: { id: number }[]) => list.map((x) => x.id);

test.describe("INV-01 categories", () => {
	test("INV-01 a new category is ACTIVE and listed", async ({ api }) => {
		const category = await createCategory(api, { description: "Paper and pens" });
		expect(category.status).toBe("ACTIVE");
		(await api.get(`${INV}/categories`)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(category.id));
	});

	test("INV-01 a second category with the same code returns 409", async ({ api }) => {
		const category = await createCategory(api);
		(await api.post(`${INV}/categories`, { body: { code: category.code, name: `Other ${uniqueSuffix()}` } })).expectStatus(409);
	});

	for (const [field, body] of [
		["no code", { name: "No code" }],
		["a blank name", { code: uniqueCode("CAT"), name: "  " }],
	] as const) {
		test(`INV-01 a category with ${field} returns 400`, async ({ api }) => {
			(await api.post(`${INV}/categories`, { body })).expectStatus(400);
		});
	}
});

test.describe("INV-02 and INV-03 items", () => {
	test("INV-02 an item keeps its category, unit, reorder level and storage location", async ({ api }) => {
		const category = await createCategory(api);
		const item = await createItem(api, { categoryId: category.id, unit: "Ream", reorderLevel: 5, storageLocation: "Store A" });
		expect(item).toMatchObject({ categoryId: category.id, unit: "Ream", reorderLevel: 5, storageLocation: "Store A", status: "ACTIVE" });
		(await api.get(`${INV}/items`)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(item.id));
	});

	test("INV-02 a second item with the same code returns 409", async ({ api }) => {
		const item = await createItem(api);
		const res = await api.post(`${INV}/items`, { body: { categoryId: item.categoryId, code: item.code, name: "Copy", unit: "Piece" } });
		expect(res.status, `duplicate item code answered ${res.status} ${JSON.stringify(res.body)}`).toBe(409);
	});

	test("INV-02 the same code in a different case is also a duplicate", async ({ api }) => {
		const item = await createItem(api, { code: uniqueCode("itm").toUpperCase() });
		const res = await api.post(`${INV}/items`, { body: { categoryId: item.categoryId, code: item.code.toLowerCase(), name: "Copy", unit: "Piece" } });
		expect(res.status, "the import treats codes case-insensitively, so the API should too").toBe(409);
	});

	for (const [field, patch] of [
		["no category", { categoryId: null }],
		["a blank name", { name: " " }],
		["no unit", { unit: null }],
		["no code", { code: null }],
		["a negative reorder level", { reorderLevel: -3 }],
	] as const) {
		test(`INV-02 an item with ${field} returns 400`, async ({ api }) => {
			const category = await createCategory(api);
			(await api.post(`${INV}/items`, { body: { categoryId: category.id, code: uniqueCode("ITM"), name: "Valid name", unit: "Piece", ...patch } })).expectStatus(400);
		});
	}

	test("INV-02 an unknown category returns 404", async ({ api }) => {
		(await api.post(`${INV}/items`, { body: { categoryId: 999999999, code: uniqueCode("ITM"), name: "Ghost", unit: "Piece" } })).expectStatus(404);
	});

	test("INV-03 reorder level, storage location and default supplier can be changed", async ({ api }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/items/{id}/reorder-level`, { params: { id: item.id }, body: { reorderLevel: 12 } })).expectStatus(200).expectJson((i) => expect(i.reorderLevel).toBe(12));
		(await api.post(`${INV}/items/{id}/storage-location`, { params: { id: item.id }, body: { storageLocation: "Shelf 4" } })).expectStatus(200).expectJson((i) => expect(i.storageLocation).toBe("Shelf 4"));
		(await api.post(`${INV}/items/{id}/default-supplier`, { params: { id: item.id }, body: { defaultSupplierId: supplier.id } })).expectStatus(200).expectJson((i) => {
			expect(i).toMatchObject({ defaultSupplierId: supplier.id, defaultSupplierName: supplier.name });
		});
		(await api.post(`${INV}/items/{id}/default-supplier`, { params: { id: item.id }, body: { defaultSupplierId: null } })).expectStatus(200).expectJson((i) => expect(i.defaultSupplierId).toBeNull());
		(await api.post(`${INV}/items/{id}/reorder-level`, { params: { id: item.id }, body: { reorderLevel: null } })).expectStatus(200).expectJson((i) => expect(i.reorderLevel).toBeNull());
	});

	test("INV-03 a negative reorder level returns 400", async ({ api }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/items/{id}/reorder-level`, { params: { id: item.id }, body: { reorderLevel: -1 } })).expectStatus(400);
	});

	test("INV-03 an inactive supplier cannot become an item's default supplier", async ({ api }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		(await api.post(`${INV}/items/{id}/default-supplier`, { params: { id: item.id }, body: { defaultSupplierId: supplier.id } })).expectStatus([400, 409]);
	});

	test("INV-03 a discontinued item leaves the list but stays in the export", async ({ api }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } })).expectStatus(200).expectJson((i) => expect(i.status).toBe("DISCONTINUED"));
		(await api.get(`${INV}/items`)).expectJson((list) => expect(ids(list)).not.toContain(item.id));
		(await api.get(`${INV}/items/export`)).expectStatus(200).expectJson((rows) => expect(rows.find((r: { id: number }) => r.id === item.id)).toMatchObject({ code: item.code, status: "DISCONTINUED" }));
	});

	test("INV-03 an unknown item cannot be discontinued (404)", async ({ api }) => {
		(await api.post(`${INV}/items/{id}/discontinue`, { params: { id: 999999999 } })).expectStatus(404);
	});
});

test.describe("INV-04 to INV-07 stock movements", () => {
	test("INV-04 a stock entry raises the campus balance and is listed", async ({ api, seed }) => {
		const item = await createItem(api);
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
		const entry = await stockIn(api, item.id, seed.campusId, 40, { source: "Donation" });
		expect(entry).toMatchObject({ quantity: 40 });
		await stockIn(api, item.id, seed.campusId, 10);
		expect(await balance(api, item.id, seed.campusId)).toBe(50);
		(await api.get(`${INV}/stock-entries`, { query: { itemId: item.id, campusId: seed.campusId } })).expectStatus(200).expectJson((list) => expect(list).toHaveLength(2));
	});

	test("INV-04 stock received at one campus does not show at another", async ({ api, seed }) => {
		const item = await createItem(api);
		const other = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 7);
		expect(await balance(api, item.id, other.id)).toBe(0);
	});

	test("INV-04 an entry with a supplier records the supplier", async ({ api, seed }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 3, unitCost: 5, entryDate: "2026-09-01", supplierId: supplier.id } })).expectStatus(200).expectJson((e) => {
			expect(e).toMatchObject({ supplierId: supplier.id, supplierName: supplier.name });
		});
	});

	for (const quantity of [0, -5]) {
		test(`INV-04 an entry of quantity ${quantity} returns 400`, async ({ api, seed }) => {
			const item = await createItem(api);
			(await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity, entryDate: "2026-09-01" } })).expectStatus(400);
			expect(await balance(api, item.id, seed.campusId)).toBe(0);
		});
	}

	test("INV-04 an entry with a negative unit cost returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 2, unitCost: -10, entryDate: "2026-09-01" } })).expectStatus(400);
	});

	test("INV-04 an entry with no campus returns 400", async ({ api }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, quantity: 2, entryDate: "2026-09-01" } })).expectStatus(400);
	});

	test("INV-05 an issue lowers the balance and is listed with its recipient", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 20);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 8, { issuedTo: "Lab" }) })).expectStatus(200).expectJson((i) => expect(i).toMatchObject({ quantity: 8, issuedTo: "Lab" }));
		expect(await balance(api, item.id, seed.campusId)).toBe(12);
		(await api.get(`${INV}/stock-issues`, { query: { itemId: item.id, campusId: seed.campusId } })).expectStatus(200).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("INV-05 issuing exactly the balance empties it; one more returns 409", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 5);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 5) })).expectStatus(200);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
	});

	test("INV-05 issuing more than the balance returns 409 and leaves it unchanged", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 4) })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
	});

	test("INV-05 an issue to a staff person records the recipient name", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		const person = await createPerson(api, "Receiver");
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1, { recipientPersonId: person }) })).expectStatus(200).expectJson((i) => {
			expect(i.recipientPersonId).toBe(person);
			expect(i.recipientPersonName).toContain("Receiver");
		});
	});

	test("INV-05 an issue naming two recipients returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		const person = await createPerson(api, "Two");
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1, { recipientPersonId: person, recipientStudentId: seed.studentId }) })).expectStatus(400);
	});

	test("INV-05 an issue of quantity 0 returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 0) })).expectStatus(400);
	});

	test("INV-05 an issue to an unknown person returns 404", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1, { recipientPersonId: 999999999 }) })).expectStatus(404);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
	});

	test("INV-06 positive and negative adjustments change the balance and keep their reason", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 10);
		(await api.post(`${INV}/stock-adjustments`, { body: { itemId: item.id, campusId: seed.campusId, quantityDelta: 4, reason: "COUNT_CORRECTION", adjustmentDate: "2026-09-03" } })).expectStatus(200);
		(await api.post(`${INV}/stock-adjustments`, { body: { itemId: item.id, campusId: seed.campusId, quantityDelta: -6, reason: "DAMAGE", adjustmentDate: "2026-09-04", remarks: "Water leak" } })).expectStatus(200);
		expect(await balance(api, item.id, seed.campusId)).toBe(8);
		(await api.get(`${INV}/stock-adjustments`, { query: { itemId: item.id, campusId: seed.campusId } })).expectStatus(200).expectJson((list) => {
			expect(list.map((a: { reason: string }) => a.reason).sort()).toEqual(["COUNT_CORRECTION", "DAMAGE"]);
		});
	});

	test("INV-06 an adjustment that would take the balance below zero returns 409", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 2);
		(await api.post(`${INV}/stock-adjustments`, { body: { itemId: item.id, campusId: seed.campusId, quantityDelta: -3, reason: "LOSS", adjustmentDate: "2026-09-03" } })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(2);
	});

	for (const [field, patch] of [
		["a zero delta", { quantityDelta: 0 }],
		["no reason", { reason: null }],
		["an unknown reason", { reason: "ALIENS" }],
	] as const) {
		test(`INV-06 an adjustment with ${field} returns 400`, async ({ api, seed }) => {
			const item = await createItem(api);
			await stockIn(api, item.id, seed.campusId, 5);
			(await api.post(`${INV}/stock-adjustments`, { body: { itemId: item.id, campusId: seed.campusId, quantityDelta: 1, reason: "OTHER", adjustmentDate: "2026-09-03", ...patch } })).expectStatus(400);
			expect(await balance(api, item.id, seed.campusId)).toBe(5);
		});
	}

	test("INV-07 a transfer moves stock from one campus to another and is listed at both", async ({ api, seed }) => {
		const item = await createItem(api);
		const to = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 10);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: to.id, quantity: 4, transferDate: "2026-09-05", remarks: "Branch top-up" } })).expectStatus(200);
		expect(await balance(api, item.id, seed.campusId)).toBe(6);
		expect(await balance(api, item.id, to.id)).toBe(4);
		for (const campusId of [seed.campusId, to.id]) {
			(await api.get(`${INV}/stock-transfers`, { query: { itemId: item.id, campusId } })).expectStatus(200).expectJson((list) => expect(list).toHaveLength(1));
		}
	});

	test("INV-07 transferring more than the source holds returns 409 and moves nothing", async ({ api, seed }) => {
		const item = await createItem(api);
		const to = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: to.id, quantity: 5, transferDate: "2026-09-05" } })).expectStatus(409);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
		expect(await balance(api, item.id, to.id)).toBe(0);
	});

	test("INV-07 a transfer to the same campus returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: seed.campusId, quantity: 1, transferDate: "2026-09-05" } })).expectStatus(400);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
	});

	test("INV-07 a transfer of quantity 0 returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		const to = await createCampus(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: to.id, quantity: 0, transferDate: "2026-09-05" } })).expectStatus(400);
	});

	test("INV-07 a transfer to an unknown campus returns 404 and moves nothing", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 3);
		(await api.post(`${INV}/stock-transfers`, { body: { itemId: item.id, fromCampusId: seed.campusId, toCampusId: 999999999, quantity: 1, transferDate: "2026-09-05" } })).expectStatus(404);
		expect(await balance(api, item.id, seed.campusId)).toBe(3);
	});

	test("INV-08 ten simultaneous issues of 1 against a balance of 5 never take it below zero", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 5);
		const results = await Promise.all(Array.from({ length: 10 }, () => api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1) })));
		const ok = results.filter((r) => r.status === 200).length;
		const left = await balance(api, item.id, seed.campusId);
		expect({ issued: ok, balance: left }, "concurrent issues oversold the stock").toEqual({ issued: 5, balance: 0 });
	});
});

test.describe("INV-09 and INV-10 balance, low stock, discontinued", () => {
	test("INV-09 balance and low-stock without campusId return 400", async ({ api }) => {
		const item = await createItem(api);
		(await api.get(`${INV}/items/{id}/balance`, { params: { id: item.id } })).expectStatus(400);
		(await api.get(`${INV}/items/low-stock`)).expectStatus(400);
	});

	test("INV-09 the balance of an unknown item returns 404", async ({ api, seed }) => {
		(await api.get(`${INV}/items/{id}/balance`, { params: { id: 999999999 }, query: { campusId: seed.campusId } })).expectStatus(404);
	});

	test("INV-09 low stock lists items under their reorder level, not those above or without one", async ({ api, seed }) => {
		const campus = await createCampus(api);
		const low = await createItem(api, { reorderLevel: 10 });
		const fine = await createItem(api, { reorderLevel: 10 });
		const unset = await createItem(api);
		await stockIn(api, low.id, campus.id, 4);
		await stockIn(api, fine.id, campus.id, 25);
		(await api.get(`${INV}/items/low-stock`, { query: { campusId: campus.id } })).expectStatus(200).expectJson((list) => {
			expect(list.find((i: { id: number }) => i.id === low.id)).toMatchObject({ balance: 4, reorderLevel: 10 });
			expect(ids(list)).not.toContain(fine.id);
			expect(ids(list)).not.toContain(unset.id);
		});
	});

	test("INV-09 an item exactly at its reorder level counts as low stock", async ({ api }) => {
		const campus = await createCampus(api);
		const item = await createItem(api, { reorderLevel: 6 });
		await stockIn(api, item.id, campus.id, 6);
		(await api.get(`${INV}/items/low-stock`, { query: { campusId: campus.id } })).expectJson((list) => expect(ids(list)).toContain(item.id));
	});

	test("INV-09 a discontinued item is not reported as low stock", async ({ api }) => {
		const campus = await createCampus(api);
		const item = await createItem(api, { reorderLevel: 6 });
		await stockIn(api, item.id, campus.id, 1);
		await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } });
		(await api.get(`${INV}/items/low-stock`, { query: { campusId: campus.id } })).expectJson((list) => expect(ids(list)).not.toContain(item.id));
	});

	test("INV-10 a discontinued item cannot receive new stock (409)", async ({ api, seed }) => {
		const item = await createItem(api);
		await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } });
		const res = await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 5, entryDate: "2026-09-01" } });
		expect(res.status, "a discontinued item accepted a stock entry").toBe(409);
	});

	test("INV-10 remaining stock of a discontinued item can still be issued", async ({ api, seed }) => {
		const item = await createItem(api);
		await stockIn(api, item.id, seed.campusId, 4);
		await api.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } });
		(await api.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 4) })).expectStatus(200);
		expect(await balance(api, item.id, seed.campusId)).toBe(0);
	});
});

test.describe("INV-11 and INV-12 suppliers and customers", () => {
	test("INV-11 a supplier is created ACTIVE, deactivated, reactivated and stays listed", async ({ api }) => {
		const supplier = await createSupplier(api, { email: "orders@vendor.test", address: "1 Market Rd" });
		expect(supplier.status).toBe("ACTIVE");
		(await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("INACTIVE"));
		(await api.get(`${INV}/suppliers`)).expectJson((list) => expect(list.find((s: { id: number }) => s.id === supplier.id).status).toBe("INACTIVE"));
		(await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("ACTIVE"));
	});

	for (const [field, body] of [
		["a blank name", { name: " " }],
		["an invalid email", { name: `Supplier ${uniqueSuffix()}`, email: "not-an-email" }],
	] as const) {
		test(`INV-11 a supplier with ${field} returns 400`, async ({ api }) => {
			(await api.post(`${INV}/suppliers`, { body })).expectStatus(400);
		});
	}

	test("INV-11 an unknown supplier status returns 400", async ({ api }) => {
		const supplier = await createSupplier(api);
		(await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "BANKRUPT" } })).expectStatus(400);
	});

	test("INV-11 an inactive supplier cannot be named on a new stock entry", async ({ api, seed }) => {
		const item = await createItem(api);
		const supplier = await createSupplier(api);
		await api.post(`${INV}/suppliers/{id}/status`, { params: { id: supplier.id }, body: { status: "INACTIVE" } });
		(await api.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 1, entryDate: "2026-09-01", supplierId: supplier.id } })).expectStatus([400, 409]);
	});

	test("INV-12 a walk-in customer and a student-linked customer are created and listed", async ({ api, seed }) => {
		const walkIn = (await api.post(`${INV}/customers`, { body: { name: `Walk-in ${uniqueSuffix()}`, phone: "9111111111" } })).expectStatus(200).body;
		expect(walkIn).toMatchObject({ status: "ACTIVE", studentId: null });
		const linked = (await api.post(`${INV}/customers`, { body: { name: `Student buyer ${uniqueSuffix()}`, studentId: seed.studentId } })).expectStatus(200).body;
		expect(linked.studentId).toBe(seed.studentId);
		(await api.get(`${INV}/customers`)).expectStatus(200).expectJson((list) => expect(ids(list)).toEqual(expect.arrayContaining([walkIn.id, linked.id])));
	});

	test("INV-12 a customer can be deactivated", async ({ api }) => {
		const customer = (await api.post(`${INV}/customers`, { body: { name: `Customer ${uniqueSuffix()}` } })).expectStatus(200).body;
		(await api.post(`${INV}/customers/{id}/status`, { params: { id: customer.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((c) => expect(c.status).toBe("INACTIVE"));
	});

	test("INV-12 a customer linked to both a student and a guardian returns 400", async ({ api, seed }) => {
		const guardian = await createGuardian(api);
		(await api.post(`${INV}/customers`, { body: { name: `Both ${uniqueSuffix()}`, studentId: seed.studentId, guardianId: guardian.id } })).expectStatus(400);
	});

	test("INV-12 a customer with a blank name returns 400", async ({ api }) => {
		(await api.post(`${INV}/customers`, { body: { name: "" } })).expectStatus(400);
	});

	test("INV-12 a customer linked to an unknown student returns 404", async ({ api }) => {
		(await api.post(`${INV}/customers`, { body: { name: `Ghost ${uniqueSuffix()}`, studentId: 999999999 } })).expectStatus(404);
	});
});

test.describe("INV-13 assets", () => {
	async function asset(api: Parameters<typeof createItem>[0], campusId: number, overrides: Record<string, unknown> = {}) {
		const item = await createItem(api, { unit: "Unit" });
		const res = await api.post(`${INV}/assets`, { body: { itemId: item.id, campusId, assetTag: uniqueCode("TAG"), purchaseDate: "2026-01-10", warrantyExpiryDate: "2028-01-10", ...overrides } });
		res.expectStatus(200);
		return res.body as { id: number; assetTag: string; status: string; itemName: string };
	}

	test("INV-13 a registered asset is ACTIVE and listed at its campus only", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		expect(a.status).toBe("ACTIVE");
		(await api.get(`${INV}/assets`, { query: { campusId: seed.campusId } })).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(a.id));
		const other = await createCampus(api);
		(await api.get(`${INV}/assets`, { query: { campusId: other.id } })).expectJson((list) => expect(ids(list)).not.toContain(a.id));
	});

	test("INV-13 the asset list without campusId returns 400", async ({ api }) => {
		(await api.get(`${INV}/assets`)).expectStatus(400);
	});

	test("INV-13 an asset is assigned to a person and a location, then unassigned", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		const person = await createPerson(api, "Keeper");
		(await api.post(`${INV}/assets/{id}/assign`, { params: { id: a.id }, body: { assignedPersonId: person, assignedLocation: "Room 12" } })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ assignedPersonId: person, assignedLocation: "Room 12" });
			expect(r.assignedPersonName).toContain("Keeper");
		});
		(await api.post(`${INV}/assets/{id}/assign`, { params: { id: a.id }, body: { assignedPersonId: null, assignedLocation: null } })).expectStatus(200).expectJson((r) => expect(r.assignedPersonId).toBeNull());
	});

	test("INV-13 assigning to an unknown person returns 404", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		(await api.post(`${INV}/assets/{id}/assign`, { params: { id: a.id }, body: { assignedPersonId: 999999999, assignedLocation: null } })).expectStatus(404);
	});

	test("INV-13 status moves through UNDER_REPAIR, ACTIVE and DISPOSED", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		for (const status of ["UNDER_REPAIR", "ACTIVE", "DISPOSED"]) {
			(await api.post(`${INV}/assets/{id}/status`, { params: { id: a.id }, body: { status } })).expectStatus(200).expectJson((r) => expect(r.status).toBe(status));
		}
	});

	test("INV-13 a disposed asset cannot be reactivated or assigned", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		await api.post(`${INV}/assets/{id}/status`, { params: { id: a.id }, body: { status: "DISPOSED" } });
		const person = await createPerson(api, "Late");
		const assign = await api.post(`${INV}/assets/{id}/assign`, { params: { id: a.id }, body: { assignedPersonId: person, assignedLocation: "Room 1" } });
		const reactivate = await api.post(`${INV}/assets/{id}/status`, { params: { id: a.id }, body: { status: "ACTIVE" } });
		expect({ assign: assign.status, reactivate: reactivate.status }, "a disposed asset was assigned or brought back").toEqual({ assign: 409, reactivate: 409 });
	});

	test("INV-13 two assets with the same tag return 409", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		const item = await createItem(api);
		const res = await api.post(`${INV}/assets`, { body: { itemId: item.id, campusId: seed.campusId, assetTag: a.assetTag } });
		expect(res.status, `a duplicate asset tag answered ${res.status}`).toBe(409);
	});

	test("INV-13 an asset without a tag returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/assets`, { body: { itemId: item.id, campusId: seed.campusId, assetTag: null } })).expectStatus(400);
	});

	test("INV-13 an asset whose warranty ends before its purchase returns 400", async ({ api, seed }) => {
		const item = await createItem(api);
		(await api.post(`${INV}/assets`, { body: { itemId: item.id, campusId: seed.campusId, assetTag: uniqueCode("TAG"), purchaseDate: "2026-05-01", warrantyExpiryDate: "2025-05-01" } })).expectStatus(400);
	});

	test("INV-13 an unknown asset status returns 400", async ({ api, seed }) => {
		const a = await asset(api, seed.campusId);
		(await api.post(`${INV}/assets/{id}/status`, { params: { id: a.id }, body: { status: "MISPLACED_IN_SPACE" } })).expectStatus(400);
	});
});

test.describe("INV-14 import and export", () => {
	const csv = (rows: string[]) => ({ name: "items.csv", mimeType: "text/csv", buffer: Buffer.from(["code,name,unit,category,description,reorderLevel", ...rows].join("\n")) });

	test("INV-14 validateOnly reports rows without saving; a real import creates the item", async ({ api }) => {
		const category = await createCategory(api);
		const code = uniqueCode("IMP");
		const file = csv([`${code},Imported pen,Piece,${category.name},Blue,15`]);
		(await api.post(`${INV}/items/import`, { query: { validateOnly: true }, multipart: { file } })).expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("VALID"));
		(await api.get(`${INV}/items`)).expectJson((list) => expect(list.map((i: { code: string }) => i.code)).not.toContain(code));
		(await api.post(`${INV}/items/import`, { query: { validateOnly: false }, multipart: { file } })).expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("IMPORTED"));
		(await api.get(`${INV}/items`)).expectJson((list) => expect(list.find((i: { code: string }) => i.code === code)).toMatchObject({ name: "Imported pen", reorderLevel: 15, categoryId: category.id }));
	});

	test("INV-14 an existing code is DUPLICATE and an unknown category is ERROR, while good rows still import", async ({ api }) => {
		const category = await createCategory(api);
		const existing = await createItem(api, { categoryId: category.id });
		const fresh = uniqueCode("IMP");
		(await api.post(`${INV}/items/import`, { multipart: { file: csv([`${existing.code},Again,Piece,${category.name},,`, `${uniqueCode("IMP")},Orphan,Piece,No Such Category ${uniqueSuffix()},,`, `${fresh},Good,Piece,${category.name},,`]) } }))
			.expectStatus(200)
			.expectJson((rows) => expect(rows.map((r: { status: string }) => r.status)).toEqual(["DUPLICATE", "ERROR", "IMPORTED"]));
		(await api.get(`${INV}/items`)).expectJson((list) => expect(list.map((i: { code: string }) => i.code)).toContain(fresh));
	});

	test("INV-14 a row with a missing required column or a non-numeric reorder level is ERROR", async ({ api }) => {
		const category = await createCategory(api);
		(await api.post(`${INV}/items/import`, { query: { validateOnly: true }, multipart: { file: csv([`,No code,Piece,${category.name},,`, `${uniqueCode("IMP")},Bad level,Piece,${category.name},,lots`]) } }))
			.expectStatus(200)
			.expectJson((rows) => expect(rows.map((r: { status: string }) => r.status), "validate-only should flag a reorder level of 'lots'").toEqual(["ERROR", "ERROR"]));
	});

	test("INV-14 an import without a file returns 400", async ({ api }) => {
		(await api.post(`${INV}/items/import`, {})).expectStatus(400);
	});

	test("INV-14 the export lists items with category and default supplier names", async ({ api }) => {
		const supplier = await createSupplier(api);
		const category = await createCategory(api);
		const item = await createItem(api, { categoryId: category.id, defaultSupplierId: supplier.id, storageLocation: "Bay 2" });
		(await api.get(`${INV}/items/export`)).expectStatus(200).expectJson((rows) => {
			expect(rows.find((r: { id: number }) => r.id === item.id)).toMatchObject({ code: item.code, categoryName: category.name, defaultSupplierName: supplier.name, storageLocation: "Bay 2", status: "ACTIVE" });
		});
	});
});

test.describe("permissions and tenancy", () => {
	for (const path of ["/items", "/categories", "/suppliers", "/customers", "/items/export"]) {
		test(`INV GET ${path} without a token returns 401`, async ({ anon }) => {
			(await anon.get(`${INV}${path}`)).expectStatus(401);
		});
	}

	test("INV a member without INVENTORY_VIEW cannot read the catalogue", async ({ api, anon, seed }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		(await nobody.client.get(`${INV}/items`)).expectStatus(403);
		(await nobody.client.get(`${INV}/suppliers`)).expectStatus(403);
	});

	test("INV a viewer can read but not create items, move stock, or register assets", async ({ api, anon, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["INVENTORY_VIEW"]);
		const item = await createItem(api);
		(await viewer.client.get(`${INV}/items`)).expectStatus(200);
		(await viewer.client.get(`${INV}/items/{id}/balance`, { params: { id: item.id }, query: { campusId: seed.campusId } })).expectStatus(200);
		(await viewer.client.post(`${INV}/items`, { body: { categoryId: item.categoryId, code: uniqueCode("X"), name: "x", unit: "Piece" } })).expectStatus(403);
		(await viewer.client.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 1, entryDate: "2026-09-01" } })).expectStatus(403);
		(await viewer.client.post(`${INV}/assets`, { body: { itemId: item.id, campusId: seed.campusId, assetTag: uniqueCode("T") } })).expectStatus(403);
		(await viewer.client.post(`${INV}/suppliers`, { body: { name: "x" } })).expectStatus(403);
	});

	test("INV a stock keeper can receive and issue but not adjust or edit the catalogue", async ({ api, anon, seed }) => {
		const keeper = await createDisposableUser(api, anon, seed, ["INVENTORY_VIEW", "INVENTORY_STOCK_MANAGE"]);
		const item = await createItem(api);
		(await keeper.client.post(`${INV}/stock-entries`, { body: { itemId: item.id, campusId: seed.campusId, quantity: 3, entryDate: "2026-09-01" } })).expectStatus(200);
		(await keeper.client.post(`${INV}/stock-issues`, { body: issueBody(item.id, seed.campusId, 1) })).expectStatus(200);
		(await keeper.client.post(`${INV}/stock-adjustments`, { body: { itemId: item.id, campusId: seed.campusId, quantityDelta: -1, reason: "LOSS", adjustmentDate: "2026-09-03" } })).expectStatus(403);
		(await keeper.client.post(`${INV}/items/{id}/discontinue`, { params: { id: item.id } })).expectStatus(403);
	});

	test("INV another organisation's items, campuses and assets are invisible and untouchable", async ({ api, request, calls, seed }) => {
		const org = await createOtherOrganisation(request, calls);
		const theirCampus = (await org.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const theirItem = await createItem(org.client);
		await stockIn(org.client, theirItem.id, theirCampus, 9);
		const theirSupplier = await createSupplier(org.client);
		(await api.get(`${INV}/items`)).expectJson((list) => expect(ids(list)).not.toContain(theirItem.id));
		(await api.get(`${INV}/suppliers`)).expectJson((list) => expect(ids(list)).not.toContain(theirSupplier.id));
		(await api.get(`${INV}/items/{id}/balance`, { params: { id: theirItem.id }, query: { campusId: theirCampus } })).expectStatus(404);
		(await api.post(`${INV}/stock-issues`, { body: issueBody(theirItem.id, theirCampus, 1) })).expectStatus(404);
		(await api.post(`${INV}/items/{id}/discontinue`, { params: { id: theirItem.id } })).expectStatus(404);
		(await api.post(`${INV}/items`, { body: { categoryId: theirItem.categoryId, code: uniqueCode("X"), name: "Cross", unit: "Piece" } })).expectStatus(404);
		const mine = await createItem(api);
		(await api.post(`${INV}/stock-entries`, { body: { itemId: mine.id, campusId: theirCampus, quantity: 1, entryDate: "2026-09-01" } })).expectStatus(404);
		(await api.post(`${INV}/items/{id}/default-supplier`, { params: { id: mine.id }, body: { defaultSupplierId: theirSupplier.id } })).expectStatus(404);
		expect(await balance(org.client, theirItem.id, theirCampus)).toBe(9);
		void seed;
	});
});
