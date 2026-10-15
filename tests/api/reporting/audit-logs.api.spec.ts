// Audit log: reading it, filtering it, who may read it, and what running a report leaves in it.
// IDs refer to docs/SCENARIOS.md section 20 (RPT-09, RPT-10). The log is organisation-scoped by the
// controller itself (the table is not tenant-filtered), so tenant isolation is part of every read.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { admitStudent } from "../../../src/api/students";
import { AUDIT_ROW_SHAPE, createReport, REPORT, reportBody, REPORTS, runReport } from "../../../src/api/reports";
import { expectShape, PAGE_SHAPE } from "../../../src/api/shapes";

const AUDIT = "/api/v1/audit-logs";
const ENTITY_TYPES = "/api/v1/audit-logs/entity-types";

type Row = { id: number; organisationId: number; actorUserId: number | null; entityType: string; entityId: number | null; action: string; occurredAt: string };

async function entries(api: any, query: Record<string, string | number>): Promise<Row[]> {
	return (await api.get(AUDIT, { query })).expectStatus(200).body.content;
}

test.describe("reading the log", () => {
	test("RPT-09 the audit log is a page of entries, newest first, each with who, what and when", async ({ api }) => {
		await admitStudent(api);
		(await api.get(AUDIT, { query: { size: 20 } })).expectStatus(200).expectJson((page) => {
			expectShape(page, PAGE_SHAPE);
			expect(page.content.length).toBeGreaterThan(0);
			expect(page.content.length).toBeLessThanOrEqual(20);
			for (const row of page.content) expectShape(row, AUDIT_ROW_SHAPE);
			const times = page.content.map((r: Row) => Date.parse(r.occurredAt));
			expect(times).toEqual([...times].sort((a, b) => b - a));
		});
	});

	test("RPT-09 an entry for an admitted student names the student, the actor and the action", async ({ api }) => {
		const student = await admitStudent(api);
		const rows = await entries(api, { entityType: "Student", entityId: student.id });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]).toMatchObject({ entityType: "Student", entityId: student.id, action: "STUDENT_ADMITTED" });
		expect(rows[0].actorUserId).not.toBeNull();
	});

	test("RPT-09 size and page are honoured, and a page past the end is empty", async ({ api }) => {
		// Other specs write audit entries all the time, so both pages are read from the same fixed window.
		const to = new Date().toISOString();
		const first = (await api.get(AUDIT, { query: { size: 2, page: 0, to } })).expectStatus(200).body;
		expect(first.content).toHaveLength(2);
		expect(first.size).toBe(2);
		const second = (await api.get(AUDIT, { query: { size: 2, page: 1, to } })).expectStatus(200).body;
		expect(second.content.map((r: Row) => r.id)).not.toEqual(first.content.map((r: Row) => r.id));
		(await api.get(AUDIT, { query: { size: 2, page: 1_000_000, to } })).expectStatus(200).expectJson((p) => expect(p.content).toEqual([]));
	});

	test("RPT-09 filtering by entity type returns only that type, and the lookup lists the types that exist", async ({ api }) => {
		await admitStudent(api);
		const types: string[] = (await api.get(ENTITY_TYPES)).expectStatus(200).body;
		expect(Array.isArray(types)).toBe(true);
		expect(types).toContain("Student");
		expect(new Set(types).size, "entity types are listed once").toBe(types.length);
		const rows = await entries(api, { entityType: "Student", size: 30 });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.entityType === "Student")).toBe(true);
	});

	test("RPT-09 filtering by actor and by entity id narrows the result", async ({ api }) => {
		const student = await admitStudent(api);
		const byEntity = await entries(api, { entityType: "Student", entityId: student.id });
		const actor = byEntity[0].actorUserId as number;
		const byActor = await entries(api, { actorUserId: actor, size: 30 });
		expect(byActor.length).toBeGreaterThan(0);
		expect(byActor.every((r) => r.actorUserId === actor)).toBe(true);
		expect(await entries(api, { actorUserId: 99999999 })).toEqual([]);
		expect(await entries(api, { entityType: "Student", entityId: 99999999 })).toEqual([]);
		expect(await entries(api, { entityType: "NoSuchEntity" })).toEqual([]);
	});

	test("RPT-09 filtering by a time window returns only entries inside it", async ({ api }) => {
		const before = new Date(Date.now() - 1000).toISOString();
		const student = await admitStudent(api);
		const after = new Date(Date.now() + 1000).toISOString();
		const inside = await entries(api, { entityType: "Student", from: before, to: after });
		expect(inside.map((r) => r.entityId)).toContain(student.id);
		for (const row of inside) {
			expect(Date.parse(row.occurredAt)).toBeGreaterThanOrEqual(Date.parse(before));
			expect(Date.parse(row.occurredAt)).toBeLessThanOrEqual(Date.parse(after));
		}
		expect(await entries(api, { from: "2999-01-01T00:00:00Z" })).toEqual([]);
		expect(await entries(api, { to: "2000-01-01T00:00:00Z" })).toEqual([]);
	});

	test("RPT-09 a malformed filter returns 400, never 500", async ({ api }) => {
		for (const query of [{ from: "yesterday" }, { to: "2026-13-45T00:00:00Z" }, { actorUserId: "abc" }, { entityId: "abc" }] ) {
			(await api.get(AUDIT, { query })).expectStatus(400);
		}
	});

	test("RPT-09 an unknown sort column returns 400, never 500", async ({ api }) => {
		(await api.get(AUDIT, { query: { sort: "noSuchColumn,asc" } })).expectStatus(400);
	});

	test("RPT-09 a negative page or a zero size is handled without a server error", async ({ api }) => {
		(await api.get(AUDIT, { query: { page: -1 } })).expectStatus([200, 400]);
		(await api.get(AUDIT, { query: { size: 0 } })).expectStatus([200, 400]);
		(await api.get(AUDIT, { query: { size: -5 } })).expectStatus([200, 400]);
	});

	test("RPT-09 a very large page size is capped rather than returning the whole table", async ({ api }) => {
		const page = (await api.get(AUDIT, { query: { size: 1_000_000 } })).expectStatus(200).body;
		expect(page.size).toBeLessThanOrEqual(1000);
	});
});

test.describe("what running a report records", () => {
	test("RPT-09 running a report writes a RUN entry with the actor, and the entity type shows up in the lookup", async ({ api }) => {
		const report = await createReport(api);
		await runReport(api, report.id);
		const rows = await entries(api, { entityType: "SavedReport", entityId: report.id });
		expect(rows.map((r) => r.action)).toContain("RUN");
		expect(rows[0].actorUserId).toBe(report.createdBy);
		expect((await api.get(ENTITY_TYPES)).body).toContain("SavedReport");
	});

	test("RPT-09 exporting a report writes an EXPORTED entry, separate from RUN", async ({ api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(200);
		const actions = (await entries(api, { entityType: "SavedReport", entityId: report.id })).map((r) => r.action);
		expect(actions).toContain("EXPORTED");
		expect(actions).not.toContain("RUN");
	});

	test("RPT-09 every run is logged, so three runs leave three entries", async ({ api }) => {
		const report = await createReport(api);
		for (let i = 0; i < 3; i++) await runReport(api, report.id);
		const runs = (await entries(api, { entityType: "SavedReport", entityId: report.id })).filter((r) => r.action === "RUN");
		expect(runs).toHaveLength(3);
	});

	test("RPT-09 an attempted run that fails (for example one reaching for an application table) is still on the record", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT no_such_column FROM reporting_students" });
		(await runReport(api, report.id)).expectStatus(400);
		expect((await entries(api, { entityType: "SavedReport", entityId: report.id })).length).toBeGreaterThan(0);
	});

	test("RPT-09 a run by someone the report was shared with is logged against that person, not the author", async ({ api, anon, seed }) => {
		const alice = await createDisposableUser(api, anon, seed, ["REPORT_CREATE"]);
		const bob = await createDisposableUser(api, anon, seed, []);
		const report = await createReport(alice.client);
		(await alice.client.post(`${REPORT}/share`, { params: { id: report.id }, body: { principalType: "USER", principalId: bob.userId, canRun: true, canEdit: false } })).expectStatus(200);
		(await runReport(bob.client, report.id)).expectStatus(200);
		const rows = await entries(api, { entityType: "SavedReport", entityId: report.id });
		expect(rows.some((r) => r.action === "RUN" && r.actorUserId === bob.userId)).toBe(true);
	});

	test("RPT-09 creating, editing, publishing, archiving and sharing a report are logged too, not only running it", async ({ api, anon, seed }) => {
		const bob = await createDisposableUser(api, anon, seed, []);
		const report = await createReport(api);
		(await api.put(REPORT, { params: { id: report.id }, body: reportBody({ name: `${report.name} v2` }) })).expectStatus(200);
		(await api.post(`${REPORT}/share`, { params: { id: report.id }, body: { principalType: "USER", principalId: bob.userId, canRun: true, canEdit: false } })).expectStatus(200);
		(await api.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(200);
		(await api.post(`${REPORT}/archive`, { params: { id: report.id } })).expectStatus(200);
		const rows = await entries(api, { entityType: "SavedReport", entityId: report.id });
		expect(rows.length, "definition changes and shares leave no entry today").toBeGreaterThanOrEqual(4);
	});

	test("RPT-09 the log does not carry the parameter values or the rows of a run", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT :secret AS secret", parameters: [{ name: "secret", type: "STRING", label: "Secret", sortOrder: 0 }] });
		await runReport(api, report.id, { secret: "do-not-log-me-4242" });
		const page = (await api.get(AUDIT, { query: { entityType: "SavedReport", entityId: report.id } })).expectStatus(200).body;
		expect(JSON.stringify(page)).not.toContain("do-not-log-me-4242");
	});
});

test.describe("who may read it", () => {
	test("RPT-10 STD-01 the log needs a token", async ({ anon }) => {
		(await anon.get(AUDIT)).expectStatus(401);
		(await anon.get(ENTITY_TYPES)).expectStatus(401);
		(await anon.get(AUDIT, { token: "garbage.token.value" })).expectStatus(401);
	});

	for (const role of ["noPermissions", "readOnlyStaff", "feesCollector"] as const) {
		test(`RPT-10 a ${role} user cannot read the log or the entity-type lookup`, async ({ as }) => {
			(await as(role).get(AUDIT)).expectStatus(403).expectJson((b) => expect(b.error).toMatch(/ORGANISATION_MANAGE/));
			(await as(role).get(ENTITY_TYPES)).expectStatus(403);
		});
	}

	test("RPT-10 a person who can create reports but cannot manage the organisation cannot read the log", async ({ api, anon, seed }) => {
		const writer = await createDisposableUser(api, anon, seed, ["REPORT_CREATE", "REPORT_MANAGE", "REPORT_EXPORT"]);
		(await writer.client.get(AUDIT)).expectStatus(403);
	});

	test("RPT-10 a person with ORGANISATION_MANAGE can read the log", async ({ api, anon, seed }) => {
		const admin = await createDisposableUser(api, anon, seed, ["ORGANISATION_MANAGE"]);
		(await admin.client.get(AUDIT, { query: { size: 1 } })).expectStatus(200);
		(await admin.client.get(ENTITY_TYPES)).expectStatus(200);
	});
});

test.describe("another organisation", () => {
	test("RPT-10 STD-12 a new organisation's log holds only its own entries, never the shared organisation's", async ({ request, calls, api }) => {
		const report = await createReport(api);
		await runReport(api, report.id);
		const outsider = await createOtherOrganisation(request, calls);
		const page = (await outsider.client.get(AUDIT, { query: { size: 200 } })).expectStatus(200).body;
		expect(page.content.length).toBeGreaterThan(0);
		for (const row of page.content) expect(row.organisationId).toBe(outsider.id);
		expect(page.content.filter((r: Row) => r.entityType === "SavedReport")).toEqual([]);
		(await outsider.client.get(AUDIT, { query: { entityType: "SavedReport", entityId: report.id } })).expectStatus(200).expectJson((p) => expect(p.content).toEqual([]));
	});

	test("RPT-10 the entity-type lookup of a new organisation does not list types only the shared organisation has", async ({ request, calls, api }) => {
		await runReport(api, (await createReport(api)).id);
		const outsider = await createOtherOrganisation(request, calls);
		const types: string[] = (await outsider.client.get(ENTITY_TYPES)).expectStatus(200).body;
		expect(types).not.toContain("SavedReport");
		expect(types).not.toContain("StudentAttendance");
	});

	test("RPT-10 a run in one organisation is logged in that organisation only", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const report = await createReport(org.client);
		await runReport(org.client, report.id);
		const mine = (await org.client.get(AUDIT, { query: { entityType: "SavedReport", entityId: report.id } })).expectStatus(200).body.content;
		expect(mine.map((r: Row) => r.action)).toContain("RUN");
		expect(mine.every((r: Row) => r.organisationId === org.id)).toBe(true);
		const other = await createOtherOrganisation(request, calls);
		(await other.client.get(AUDIT, { query: { entityType: "SavedReport", entityId: report.id } })).expectStatus(200).expectJson((p) => expect(p.content).toEqual([]));
	});

	test("RPT-09 reports listed in REPORTS are unaffected by reading the log", async ({ api }) => {
		const before = (await api.get(REPORTS)).body.length;
		await api.get(AUDIT);
		expect((await api.get(REPORTS)).body.length).toBeGreaterThanOrEqual(before);
	});
});
