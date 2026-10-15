// Who can see, run, edit, share and export a report, and that one organisation can never read another's
// rows. IDs refer to docs/SCENARIOS.md section 20 (RPT-05, RPT-07, STD-01..04, STD-12).
//
// Access is per report, not just per permission: REPORT_CREATE lets someone author reports and see their own;
// REPORT_MANAGE (and the Owner) sees and edits everything; anyone else needs a share (canRun / canEdit) to a
// user or a role. REPORT_EXPORT is a separate permission that sharing does not grant.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { createDisposableUser, type DisposableUser } from "../../../src/api/users";
import { admitStudent } from "../../../src/api/students";
import { createReport, REPORT, REPORTS, reportBody, runReport, STUDENT_ROWS_SQL } from "../../../src/api/reports";
import type { ApiClient } from "../../../src/api/apiClient";

const FORBIDDEN = 403;

async function author(api: ApiClient, anon: ApiClient, seed: any, extra: string[] = []): Promise<DisposableUser> {
	return createDisposableUser(api, anon, seed, ["REPORT_CREATE", ...extra]);
}

async function share(owner: ApiClient, reportId: number, principalType: "USER" | "ROLE", principalId: number, canRun = true, canEdit = false) {
	return owner.post(`${REPORT}/share`, { params: { id: reportId }, body: { principalType, principalId, canRun, canEdit } });
}

test.describe("authentication and the permission matrix", () => {
	for (const [label, token] of [["without a token", null], ["with a garbage token", "garbage.token.value"]] as const) {
		test(`STD-01 STD-02 every report endpoint answers 401 ${label}`, async ({ api, anon }) => {
			const report = await createReport(api);
			const opts = (extra: object = {}) => ({ params: { id: report.id }, token, ...extra });
			const calls: [string, () => Promise<any>][] = [
				["list", () => anon.get(REPORTS, opts())],
				["create", () => anon.post(REPORTS, opts({ body: reportBody() }))],
				["seed", () => anon.post(`${REPORTS}/seed-standard`, opts())],
				["get", () => anon.get(REPORT, opts())],
				["update", () => anon.put(REPORT, opts({ body: reportBody() }))],
				["duplicate", () => anon.post(`${REPORT}/duplicate`, opts())],
				["publish", () => anon.post(`${REPORT}/publish`, opts())],
				["archive", () => anon.post(`${REPORT}/archive`, opts())],
				["share", () => anon.post(`${REPORT}/share`, opts({ body: { principalType: "USER", principalId: 1, canRun: true, canEdit: false } }))],
				["run", () => anon.post(`${REPORT}/run`, opts({ body: { parameters: {} } }))],
				["export", () => anon.post(`${REPORT}/export`, opts({ body: { parameters: {} } }))],
			];
			for (const [, call] of calls) (await call()).expectStatus(401);
		});
	}

	for (const role of ["noPermissions", "readOnlyStaff", "feesCollector"] as const) {
		test(`STD-03 STD-04 a ${role} user cannot create, seed, open, run, export, edit, publish, archive, duplicate or share someone else's report`, async ({ api, as }) => {
			const report = await createReport(api);
			const c = as(role);
			(await c.post(REPORTS, { body: reportBody() })).expectStatus(FORBIDDEN);
			(await c.post(`${REPORTS}/seed-standard`)).expectStatus(FORBIDDEN);
			(await c.get(REPORT, { params: { id: report.id } })).expectStatus(FORBIDDEN);
			(await c.put(REPORT, { params: { id: report.id }, body: reportBody() })).expectStatus(FORBIDDEN);
			(await c.post(`${REPORT}/duplicate`, { params: { id: report.id } })).expectStatus(FORBIDDEN);
			(await c.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(FORBIDDEN);
			(await c.post(`${REPORT}/archive`, { params: { id: report.id } })).expectStatus(FORBIDDEN);
			(await share(c, report.id, "USER", 1)).expectStatus(FORBIDDEN);
			(await runReport(c, report.id)).expectStatus(FORBIDDEN);
			(await c.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(FORBIDDEN);
		});

		test(`RPT-05 a ${role} user sees an empty list, not the organisation's reports`, async ({ api, as }) => {
			const report = await createReport(api);
			(await as(role).get(REPORTS)).expectStatus(200).expectJson((list) => {
				expect(list.map((r: { id: number }) => r.id)).not.toContain(report.id);
				expect(list).toEqual([]);
			});
		});
	}

	test("RPT-05 the owner sees every report in the organisation, including ones other people wrote", async ({ api, anon, seed }) => {
		const writer = await author(api, anon, seed);
		const theirs = await createReport(writer.client);
		(await api.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(theirs.id));
		(await api.get(REPORT, { params: { id: theirs.id } })).expectStatus(200);
		(await runReport(api, theirs.id)).expectStatus(200);
	});

	test("RPT-05 a person who can only create reports (no REPORT_MANAGE) cannot seed the standard reports", async ({ api, anon, seed }) => {
		const writer = await author(api, anon, seed);
		(await writer.client.post(`${REPORTS}/seed-standard`)).expectStatus(FORBIDDEN).expectJson((b) => expect(b.error).toMatch(/REPORT_MANAGE/));
	});

	test("RPT-05 REPORT_MANAGE without REPORT_CREATE can see and edit every report, but not create one", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["REPORT_MANAGE"]);
		const report = await createReport(api);
		(await manager.client.get(REPORT, { params: { id: report.id } })).expectStatus(200);
		(await manager.client.put(REPORT, { params: { id: report.id }, body: reportBody({ name: `${report.name} by manager` }) })).expectStatus(200);
		(await manager.client.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(200);
		(await manager.client.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(report.id));
		(await manager.client.post(REPORTS, { body: reportBody() })).expectStatus(FORBIDDEN);
	});
});

test.describe("authors and sharing", () => {
	test("RPT-05 a report is private to its author: another author cannot list, open, run, edit or share it", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await alice.client.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(mine.id));
		(await bob.client.get(REPORTS)).expectStatus(200).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).not.toContain(mine.id));
		(await bob.client.get(REPORT, { params: { id: mine.id } })).expectStatus(FORBIDDEN);
		(await runReport(bob.client, mine.id)).expectStatus(FORBIDDEN);
		(await bob.client.put(REPORT, { params: { id: mine.id }, body: reportBody() })).expectStatus(FORBIDDEN);
		(await share(bob.client, mine.id, "USER", bob.userId)).expectStatus(FORBIDDEN);
	});

	test("RPT-05 an author can run, edit, publish, share, duplicate and archive their own report", async ({ api, anon, seed }) => {
		const alice = await author(api, anon, seed);
		const mine = await createReport(alice.client);
		(await runReport(alice.client, mine.id)).expectStatus(200);
		(await alice.client.put(REPORT, { params: { id: mine.id }, body: reportBody({ name: `${mine.name} v2` }) })).expectStatus(200);
		(await alice.client.post(`${REPORT}/publish`, { params: { id: mine.id } })).expectStatus(200);
		(await alice.client.post(`${REPORT}/duplicate`, { params: { id: mine.id } })).expectStatus([200, 201]);
		(await share(alice.client, mine.id, "USER", alice.userId)).expectStatus(200);
		(await alice.client.post(`${REPORT}/archive`, { params: { id: mine.id } })).expectStatus(200);
	});

	test("RPT-05 sharing with a user lets them list, open and run the report but not edit, publish, archive or share it", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "USER", bob.userId, true, false)).expectStatus(200);

		(await bob.client.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(mine.id));
		(await bob.client.get(REPORT, { params: { id: mine.id } })).expectStatus(200);
		(await runReport(bob.client, mine.id)).expectStatus(200).expectJson((b) => expect(b.rows).toEqual([{ one: 1 }]));
		(await bob.client.put(REPORT, { params: { id: mine.id }, body: reportBody() })).expectStatus(FORBIDDEN);
		(await bob.client.post(`${REPORT}/publish`, { params: { id: mine.id } })).expectStatus(FORBIDDEN);
		(await bob.client.post(`${REPORT}/archive`, { params: { id: mine.id } })).expectStatus(FORBIDDEN);
		(await share(bob.client, mine.id, "USER", bob.userId)).expectStatus(FORBIDDEN);
	});

	test("RPT-05 a user the report was shared with can duplicate it into their own draft, which the original author cannot see", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "USER", bob.userId)).expectStatus(200);
		const copy = (await bob.client.post(`${REPORT}/duplicate`, { params: { id: mine.id } })).expectStatus([200, 201]).body;
		expect(copy).toMatchObject({ status: "DRAFT", createdBy: bob.userId });
		(await alice.client.get(REPORT, { params: { id: copy.id } })).expectStatus(FORBIDDEN);
	});

	test("RPT-05 sharing with a role gives everyone holding that role access, and nobody else", async ({ api, anon, seed }) => {
		const alice = await author(api, anon, seed);
		const colleague = await createDisposableUser(api, anon, seed, []);
		const outsider = await createDisposableUser(api, anon, seed, []);
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "ROLE", colleague.roleId)).expectStatus(200);
		(await runReport(colleague.client, mine.id)).expectStatus(200);
		(await colleague.client.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(mine.id));
		(await runReport(outsider.client, mine.id)).expectStatus(FORBIDDEN);
	});

	test("RPT-05 a share that allows editing lets the user change the definition and publish, but they still cannot export without REPORT_EXPORT", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "USER", bob.userId, true, true)).expectStatus(200);
		(await bob.client.put(REPORT, { params: { id: mine.id }, body: reportBody({ name: `${mine.name} by bob` }) })).expectStatus(200);
		(await bob.client.post(`${REPORT}/publish`, { params: { id: mine.id } })).expectStatus(200);
		(await bob.client.post(`${REPORT}/export`, { params: { id: mine.id }, body: { parameters: {} } })).expectStatus(FORBIDDEN).expectJson((b) => expect(b.error).toMatch(/REPORT_EXPORT/));
	});

	test("RPT-04 a user with REPORT_EXPORT can export a report that was shared with them", async ({ api, anon, seed }) => {
		const alice = await author(api, anon, seed, ["REPORT_EXPORT"]);
		const mine = await createReport(alice.client, { sqlQuery: STUDENT_ROWS_SQL });
		(await alice.client.post(`${REPORT}/export`, { params: { id: mine.id }, body: { parameters: {} } })).expectStatus(200).expectJson((b) => expect(b.columns).toEqual(["student_id", "admission_number", "student_name"]));
	});

	test("RPT-05 a share that lets someone edit but not run still lets them open the report they are editing", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "USER", bob.userId, false, true)).expectStatus(200);
		(await bob.client.put(REPORT, { params: { id: mine.id }, body: reportBody({ name: `${mine.name} edited by bob` }) })).expectStatus(200);
		(await bob.client.get(REPORT, { params: { id: mine.id } })).expectStatus(200);
	});

	test("RPT-05 sharing with a user or role that does not exist is rejected", async ({ api }) => {
		const report = await createReport(api);
		(await share(api, report.id, "USER", 99999999)).expectStatus([400, 404]);
		(await share(api, report.id, "ROLE", 99999999)).expectStatus([400, 404]);
	});

	test("RPT-05 an unknown principal type returns 400 and does not name the internal enum", async ({ api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/share`, { params: { id: report.id }, body: { principalType: "GROUP", principalId: 1, canRun: true, canEdit: false } }))
			.expectStatus(400)
			.expectJson((b) => expect(b.error).not.toMatch(/com\.operion|enum constant/i));
	});

	test("RPT-05 sharing twice with the same user gives a clear conflict, and an empty body is a 400", async ({ api, anon, seed }) => {
		const bob = await author(api, anon, seed);
		const report = await createReport(api);
		(await share(api, report.id, "USER", bob.userId)).expectStatus(200);
		(await share(api, report.id, "USER", bob.userId)).expectStatus(409).expectJson((b) => expect(b.error).toMatch(/already|shared/i));
		(await api.post(`${REPORT}/share`, { params: { id: report.id }, body: {} })).expectStatus(400);
	});

	test("RPT-05 a share with neither run nor edit is rejected as meaningless", async ({ api, anon, seed }) => {
		const bob = await author(api, anon, seed);
		const report = await createReport(api);
		(await share(api, report.id, "USER", bob.userId, false, false)).expectStatus(400);
	});

	test("RPT-05 archiving a report stops the people it was shared with from running it", async ({ api, anon, seed }) => {
		const [alice, bob] = [await author(api, anon, seed), await author(api, anon, seed)];
		const mine = await createReport(alice.client);
		(await share(alice.client, mine.id, "USER", bob.userId)).expectStatus(200);
		(await runReport(bob.client, mine.id)).expectStatus(200);
		(await alice.client.post(`${REPORT}/archive`, { params: { id: mine.id } })).expectStatus(200);
		(await runReport(bob.client, mine.id)).expectStatus([403, 404, 409, 410]);
	});

	test("RPT-05 publishing a report makes it visible to people who hold REPORT_VIEW, the permission described as 'View operational/academic reports'", async ({ api, as }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(200);
		(await as("readOnlyStaff").get(REPORTS)).expectStatus(200).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(report.id));
	});

	test("RPT-05 the standard reports seeded for the organisation can be opened by a colleague with REPORT_VIEW", async ({ api, as }) => {
		const list = (await api.post(`${REPORTS}/seed-standard`)).expectStatus(200);
		expect(Array.isArray(list.body)).toBe(true);
		const all = (await api.get(REPORTS)).body;
		const stock = all.find((r: { name: string }) => r.name === "Stock on hand and valuation");
		expect(stock?.status).toBe("PUBLISHED");
		(await as("readOnlyStaff").get(REPORT, { params: { id: stock.id } })).expectStatus(200);
	});
});

test.describe("what a report can read", () => {
	test("RPT-06 a person who may create reports but has no student permission cannot read student rows through a report", async ({ api, anon, seed }) => {
		const writer = await author(api, anon, seed);
		(await writer.client.get("/api/v1/students/search", { query: { size: 1 } })).expectStatus(FORBIDDEN);
		const report = await createReport(writer.client, { sqlQuery: STUDENT_ROWS_SQL });
		(await runReport(writer.client, report.id)).expectStatus(FORBIDDEN);
	});

	test("RPT-06 the same person cannot read staff records through a report either", async ({ api, anon, seed }) => {
		const writer = await author(api, anon, seed);
		const report = await createReport(writer.client, { sqlQuery: "SELECT employee_code, staff_name FROM reporting_staff LIMIT 5" });
		(await runReport(writer.client, report.id)).expectStatus(FORBIDDEN);
	});

	test("RPT-06 a person with only fee permissions cannot read every student's date of birth through a report they write", async ({ api, anon, seed }) => {
		const writer = await createDisposableUser(api, anon, seed, ["REPORT_CREATE", "FEE_VIEW"]);
		const report = await createReport(writer.client, { sqlQuery: "SELECT admission_number, student_name, date_of_birth FROM reporting_students LIMIT 5" });
		(await runReport(writer.client, report.id)).expectStatus(FORBIDDEN);
	});
});

test.describe("another organisation", () => {
	test("RPT-07 STD-12 a report in one organisation is invisible to another: list, get, run, export, edit, publish, archive, duplicate, share", async ({ request, calls, api }) => {
		const report = await createReport(api);
		const outsider = (await createOtherOrganisation(request, calls)).client;
		(await outsider.get(REPORTS)).expectStatus(200).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).not.toContain(report.id));
		(await outsider.get(REPORT, { params: { id: report.id } })).expectStatus(404);
		(await runReport(outsider, report.id)).expectStatus(404);
		(await outsider.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(404);
		(await outsider.put(REPORT, { params: { id: report.id }, body: reportBody({ name: "taken over" }) })).expectStatus(404);
		(await outsider.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(404);
		(await outsider.post(`${REPORT}/archive`, { params: { id: report.id } })).expectStatus(404);
		(await outsider.post(`${REPORT}/duplicate`, { params: { id: report.id } })).expectStatus(404);
		(await share(outsider, report.id, "USER", 1)).expectStatus(404);
		(await api.get(REPORT, { params: { id: report.id } })).expectJson((r) => expect(r.name).toBe(report.name));
	});

	test("RPT-07 reports run in a new organisation see only that organisation's rows, so the shared organisation's students never show", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (const view of ["reporting_students", "reporting_attendance_daily", "reporting_fee_invoices", "reporting_staff", "reporting_exam_results"]) {
			const report = await createReport(org.client, { sqlQuery: `SELECT organisation_id, COUNT(*) AS n FROM ${view} GROUP BY organisation_id` });
			(await runReport(org.client, report.id)).expectStatus(200).expectJson((b) => {
				for (const row of b.rows) expect(Number(row.organisation_id), `${view} row from another organisation`).toBe(org.id);
			});
		}
	});

	test("RPT-07 the organisation view returns only the caller's own settings row", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const report = await createReport(org.client, { sqlQuery: "SELECT organisation_id FROM reporting_organisation" });
		(await runReport(org.client, report.id)).expectStatus(200).expectJson((b) => {
			expect(b.rows.length).toBeLessThanOrEqual(1);
			for (const row of b.rows) expect(Number(row.organisation_id)).toBe(org.id);
		});
	});

	test("RPT-07 a report cannot switch to another organisation by assigning the session variable the views are filtered by", async ({ request, calls, api }) => {
		const probe = await createReport(api, { sqlQuery: "SELECT organisation_id FROM reporting_organisation" });
		const sharedOrgId = Number((await runReport(api, probe.id)).expectStatus(200).body.rows[0].organisation_id);
		await admitStudent(api);

		const outsider = await createOtherOrganisation(request, calls);
		const attempts = [
			`SELECT s.student_name FROM (SELECT @reporting_org_id := ${sharedOrgId} AS o) x CROSS JOIN reporting_students s LIMIT 3`,
			`SELECT COUNT(*) AS n FROM (SELECT @reporting_org_id := ${sharedOrgId} AS o) x JOIN reporting_students s`,
			`SELECT s.admission_number FROM reporting_students s, (SELECT @reporting_org_id := ${sharedOrgId} AS o) x LIMIT 3`,
		];
		for (const sqlQuery of attempts) {
			const created = await outsider.client.post(REPORTS, { body: reportBody({ sqlQuery }) });
			if (!created.ok) {
				created.expectStatus(400);
				continue;
			}
			const run = await runReport(outsider.client, created.body.id);
			run.expectStatus([200, 400, 403]).expectJson((b) => {
				const rows: Record<string, unknown>[] = b?.rows ?? [];
				const leaked = rows.some((row) => Object.values(row).some((v) => (typeof v === "number" ? v > 0 : v !== null && v !== undefined)));
				expect(leaked, `organisation ${outsider.id} read ${rows.length} rows that belong to organisation ${sharedOrgId}: ${sqlQuery}`).toBe(false);
			});
		}
	});

	test("RPT-07 another organisation cannot share a report with a user of ours, and we cannot share ours with a user of theirs", async ({ request, calls, api, anon, seed }) => {
		const outsider = await createOtherOrganisation(request, calls);
		const theirs = await createReport(outsider.client);
		const ours = await createReport(api);
		const colleague = await author(api, anon, seed);
		(await share(outsider.client, theirs.id, "USER", colleague.userId)).expectStatus([400, 404]);
		(await share(api, ours.id, "USER", outsider.session.userId)).expectStatus([400, 404]);
		(await runReport(outsider.client, ours.id)).expectStatus(404);
	});

	test("RPT-01 STD-12 seeding the standard reports in one organisation adds nothing to another", async ({ request, calls }) => {
		const [a, b] = [await createOtherOrganisation(request, calls), await createOtherOrganisation(request, calls)];
		(await a.client.post(`${REPORTS}/seed-standard`)).expectStatus(200).expectJson((l) => expect(l).toHaveLength(4));
		(await b.client.get(REPORTS)).expectStatus(200).expectJson((l) => expect(l).toEqual([]));
		(await b.client.post(`${REPORTS}/seed-standard`)).expectStatus(200).expectJson((l) => expect(l).toHaveLength(4));
		const aIds = (await a.client.get(REPORTS)).body.map((r: { id: number }) => r.id);
		const bIds = (await b.client.get(REPORTS)).body.map((r: { id: number }) => r.id);
		expect(aIds.filter((id: number) => bIds.includes(id))).toEqual([]);
	});

	test("RPT-07 a throwaway organisation's own users are isolated from each other the same way", async ({ request, calls, anon }) => {
		const org = await createOtherOrganisation(request, calls);
		const ctx = await organisationContext(org);
		const [alice, bob] = [await author(org.client, anon, ctx), await author(org.client, anon, ctx)];
		const mine = await createReport(alice.client);
		(await runReport(bob.client, mine.id)).expectStatus(FORBIDDEN);
		(await runReport(org.client, mine.id)).expectStatus(200);
	});
});
