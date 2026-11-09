// Purchase-order fixtures. A PO needs a supplier, a campus and items; receiving goods adds to the item's
// balance at the PO's campus (see inventory.ts), so specs that check balances use their own items.

import type { ApiClient } from "./apiClient";
import { createItem, createSupplier, stockIn } from "./inventory";

export const PO = "/api/v1/purchase/orders";

export interface PurchaseOrderLine {
	id: number;
	itemId: number;
	quantity: number;
	unitCost: number;
	quantityReceived: number;
	quantityReturned: number;
}

export interface PurchaseOrder {
	id: number;
	supplierId: number;
	campusId: number;
	expectedDate: string;
	status: string;
	lines?: PurchaseOrderLine[];
}

/** A draft PO for `campusId` with one line per `[itemId, quantity, unitCost]` (or one new item of 10 at 25.00). */
export async function createOrder(api: ApiClient, campusId: number, options: { lines?: [number, number, number][]; supplierId?: number; expectedDate?: string } = {}) {
	const supplierId = options.supplierId ?? (await createSupplier(api)).id;
	const lines = options.lines ?? [[(await createItem(api)).id, 10, 25]];
	const res = await api.post(PO, {
		body: { supplierId, campusId, expectedDate: options.expectedDate ?? "2026-10-30", lines: lines.map(([itemId, quantity, unitCost]) => ({ itemId, quantity, unitCost })) },
	});
	res.expectStatus(200);
	return res.body as PurchaseOrder;
}

export async function getOrder(api: ApiClient, id: number) {
	return (await api.get(`${PO}/{id}`, { params: { id } })).expectStatus(200).body as PurchaseOrder & { lines: PurchaseOrderLine[] };
}

export async function transition(api: ApiClient, id: number, action: "submit" | "approve" | "cancel") {
	const res = await api.post(`${PO}/{id}/${action}`, { params: { id } });
	res.expectStatus(200);
	return res.body as PurchaseOrder;
}

/** A PO taken to APPROVED, ready to receive. */
export async function approvedOrder(api: ApiClient, campusId: number, options: Parameters<typeof createOrder>[2] = {}) {
	const order = await createOrder(api, campusId, options);
	await transition(api, order.id, "submit");
	await transition(api, order.id, "approve");
	return getOrder(api, order.id);
}

export function receiveBody(lines: [number, number, (number | null)?][], entryDate = "2026-10-05") {
	return { entryDate, lines: lines.map(([lineId, quantity, unitCost]) => ({ lineId, quantity, unitCost: unitCost ?? null })) };
}

export async function receive(api: ApiClient, id: number, lines: [number, number, (number | null)?][]) {
	const res = await api.post(`${PO}/{id}/receive`, { params: { id }, body: receiveBody(lines) });
	res.expectStatus(200);
	return res.body as PurchaseOrder & { lines: PurchaseOrderLine[] };
}

export function returnBody(quantity: number, overrides: Record<string, unknown> = {}) {
	return { quantity, reason: "DEFECTIVE", returnDate: "2026-10-08", remarks: "Cracked", ...overrides };
}

export { stockIn };
