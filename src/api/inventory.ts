// Inventory fixtures. Balances are per campus, so a test that needs an exact balance works on its own
// item (and, for transfers, its own campus) rather than sharing one with other tests.

import type { ApiClient } from "./apiClient";
import { uniqueCode, uniqueSuffix } from "./data";

export const INV = "/api/v1/inventory";

export async function createCategory(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${INV}/categories`, { body: { code: uniqueCode("CAT"), name: `Category ${uniqueSuffix()}`, description: null, ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; code: string; name: string; status: string };
}

export type Item = { id: number; categoryId: number; code: string; name: string; unit: string; reorderLevel: number | null; storageLocation: string | null; defaultSupplierId: number | null; status: string };

/** An item in a new category unless `categoryId` is given. */
export async function createItem(api: ApiClient, overrides: Record<string, unknown> = {}): Promise<Item> {
	const categoryId = overrides.categoryId ?? (await createCategory(api)).id;
	const res = await api.post(`${INV}/items`, { body: { code: uniqueCode("ITM"), name: `Item ${uniqueSuffix()}`, unit: "Piece", description: null, reorderLevel: null, storageLocation: null, defaultSupplierId: null, ...overrides, categoryId } });
	res.expectStatus(200);
	return res.body;
}

export async function createCampus(api: ApiClient): Promise<{ id: number; name: string }> {
	const code = uniqueCode("C");
	const res = await api.post("/api/v1/campuses", { body: { name: `Campus ${code}`, code } });
	res.expectStatus([200, 201]);
	return res.body;
}

export async function stockIn(api: ApiClient, itemId: number, campusId: number, quantity: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${INV}/stock-entries`, { body: { itemId, campusId, quantity, unitCost: 10, entryDate: "2026-09-01", source: "Vendor", supplierId: null, remarks: null, ...overrides } });
	res.expectStatus(200);
	return res.body;
}

export function issueBody(itemId: number, campusId: number, quantity: number, overrides: Record<string, unknown> = {}) {
	return { itemId, campusId, quantity, issuedDate: "2026-09-02", issuedTo: "Class 5B", purpose: "Class work", unitCost: null, departmentId: null, recipientPersonId: null, recipientStudentId: null, remarks: null, ...overrides };
}

export async function balance(api: ApiClient, itemId: number, campusId: number): Promise<number> {
	return (await api.get(`${INV}/items/{id}/balance`, { params: { id: itemId }, query: { campusId } })).expectStatus(200).body.balance;
}

export async function createSupplier(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${INV}/suppliers`, { body: { name: `Supplier ${uniqueSuffix()}`, contactPerson: "Ravi", phone: "9000000000", email: null, address: null, ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; name: string; status: string };
}

export async function createCustomerRecord(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${INV}/customers`, { body: { name: `Customer ${uniqueSuffix()}`, phone: "9222222222", ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; name: string; status: string };
}
