// Sales fixtures. A sale needs a customer, a campus and items with stock at that campus (selling issues
// the stock), so specs create their own items and stock them rather than sharing balances.

import type { ApiClient } from "./apiClient";
import { createItem, createCustomerRecord, stockIn, type Item } from "./inventory";

export const SALES = "/api/v1/sales";

export interface SaleLine {
	id: number;
	itemId: number;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
}

export interface SalePayment {
	id: number;
	paymentMethod: string;
	amount: number;
	paidAt: string;
}

export interface Sale {
	id: number;
	customerId: number;
	campusId: number;
	receiptNumber: string;
	saleDate: string;
	totalAmount: number;
	amountPaid: number;
	status: string;
	lines?: SaleLine[];
	payments?: SalePayment[];
}

/** An item with `stock` units at `campusId`, ready to be sold. */
export async function stockedItem(api: ApiClient, campusId: number, stock = 20): Promise<Item> {
	const item = await createItem(api);
	await stockIn(api, item.id, campusId, stock);
	return item;
}

export function saleBody(customerId: number, campusId: number, lines: [number, number, number][], overrides: Record<string, unknown> = {}) {
	return { customerId, campusId, saleDate: "2026-10-10", lines: lines.map(([itemId, quantity, unitPrice]) => ({ itemId, quantity, unitPrice })), ...overrides };
}

/** A sale of one stocked item: `quantity` at `price` (and the customer is created unless given). */
export async function createSale(api: ApiClient, campusId: number, options: { customerId?: number; lines?: [number, number, number][]; stock?: number } = {}) {
	const customerId = options.customerId ?? (await createCustomerRecord(api)).id;
	const lines = options.lines ?? [[(await stockedItem(api, campusId, options.stock ?? 20)).id, 2, 50]];
	const res = await api.post(SALES, { body: saleBody(customerId, campusId, lines) });
	res.expectStatus(200);
	return res.body as Sale;
}

export async function getSale(api: ApiClient, id: number) {
	return (await api.get(`${SALES}/{id}`, { params: { id } })).expectStatus(200).body as Sale & { lines: SaleLine[]; payments: SalePayment[] };
}

export async function pay(api: ApiClient, id: number, amount: number, paymentMethod = "CASH", overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${SALES}/{id}/payments`, { params: { id }, body: { paymentMethod, amount, paidAt: "2026-10-11", ...overrides } });
	res.expectStatus(200);
	return res.body as Sale & { lines: SaleLine[]; payments: SalePayment[] };
}
