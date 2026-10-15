// Lightweight response-contract helpers. We deliberately don't pull in a schema library:
// the point is to catch a missing/renamed/retyped field in the response, which these
// cover, while keeping the specs readable.

import { expect } from "@playwright/test";

export type FieldType = "string" | "number" | "boolean" | "array" | "object" | "nullable";

/** Asserts every listed field exists with the given JS type (`nullable` = present, any value). */
export function expectShape(body: unknown, shape: Record<string, FieldType>): void {
	expect(body, "response body should be a JSON object").toEqual(expect.any(Object));
	const record = body as Record<string, unknown>;
	for (const [field, type] of Object.entries(shape)) {
		expect(record, `response is missing field "${field}"`).toHaveProperty(field);
		const value = record[field];
		switch (type) {
			case "nullable":
				break;
			case "array":
				expect(Array.isArray(value), `field "${field}" should be an array, got ${typeof value}`).toBe(true);
				break;
			case "object":
				expect(value !== null && typeof value === "object" && !Array.isArray(value), `field "${field}" should be an object`).toBe(true);
				break;
			default:
				expect(typeof value, `field "${field}" should be a ${type}`).toBe(type);
		}
	}
}

/** Shape of Operion's PageResponse<T> envelope. */
export const PAGE_SHAPE: Record<string, FieldType> = {
	content: "array",
	page: "number",
	size: "number",
	totalElements: "number",
	totalPages: "number",
};
