// Report helpers. A report's SQL may only read the `reporting_*` views; the views are filtered to the
// caller's organisation by the `@reporting_org_id` session variable the backend sets before each run.

import type { ApiClient } from "./apiClient";
import { uniqueSuffix } from "./data";

export const REPORTS = "/api/v1/reports";
export const REPORT = "/api/v1/reports/{id}";

export interface ReportDraft {
	name: string;
	description: string | null;
	sqlQuery: string;
	parameters: { name: string; type: string; label: string; sortOrder: number }[];
	columns: { sourceColumn: string; label: string; sortOrder: number }[];
}

/** A valid draft body. Names are unique per call because the shared organisation accumulates reports. */
export function reportBody(overrides: Partial<ReportDraft> = {}): ReportDraft {
	return {
		name: `Auto report ${uniqueSuffix()}`,
		description: "Created by automation",
		sqlQuery: "SELECT 1 AS one",
		parameters: [],
		columns: [],
		...overrides,
	};
}

/** Students listed oldest first, so a `LIMIT n` is the same rows on every run. */
export const STUDENT_ROWS_SQL = "SELECT student_id, admission_number, student_name FROM reporting_students ORDER BY student_id LIMIT 3";

export const DATE_PARAMETER = { name: "fromDate", type: "DATE", label: "From date", sortOrder: 0 };

export async function createReport(client: ApiClient, overrides: Partial<ReportDraft> = {}) {
	const res = await client.post(REPORTS, { body: reportBody(overrides) });
	res.expectStatus([200, 201]);
	return res.body as { id: number; name: string; status: string; createdBy: number; sqlQuery: string; parameters: unknown[]; columns: unknown[] };
}

export async function runReport(client: ApiClient, id: number, parameters: Record<string, unknown> = {}) {
	return client.post(`${REPORT}/run`, { params: { id }, body: { parameters } });
}

export const RESPONSE_SHAPE = {
	id: "number",
	name: "string",
	description: "nullable",
	sqlQuery: "string",
	status: "string",
	createdBy: "number",
	parameters: "array",
	columns: "array",
} as const;

/** What the audit log screen needs from every row. */
export const AUDIT_ROW_SHAPE = {
	id: "number",
	organisationId: "number",
	actorUserId: "nullable",
	entityType: "string",
	entityId: "nullable",
	action: "string",
	occurredAt: "string",
} as const;
