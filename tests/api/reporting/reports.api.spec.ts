// Saved reports: seed, create, edit, duplicate, publish, archive, run and export, plus what the SQL guard
// accepts and rejects. IDs refer to docs/SCENARIOS.md section 20 (RPT-*).
//
// A report is a single SELECT over the curated `reporting_*` views. Its `:name` placeholders are bound as
// JDBC parameters and the views are filtered to the caller's organisation, so the data assertions here build
// their own student (shared organisation) or use a throwaway organisation where the count must be exact.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { admitStudent } from "../../../src/api/students";
import { expectShape } from "../../../src/api/shapes";
import { createReport, DATE_PARAMETER, REPORT, REPORTS, reportBody, RESPONSE_SHAPE, runReport, STUDENT_ROWS_SQL } from "../../../src/api/reports";

const BAD = 400;
/** Internal names must never reach a caller: enum classes, packages, the database login. */
const INTERNALS = /com\.operion|No enum constant|java\.|reporting_ro|@'localhost'|Exception/i;

const STANDARD_NAMES = [
	"Sales totals by item, customer and campus",
	"Stock on hand and valuation",
	"Low stock items",
	"Purchase spend by supplier",
];

test.describe("standard reports", () => {
	test("RPT-01 seeding a new organisation creates the four standard reports, published, and a second seed adds nothing", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const first = await org.client.post(`${REPORTS}/seed-standard`);
		first.expectStatus(200).expectJson((list) => {
			expect(list.map((r: { name: string }) => r.name).sort()).toEqual([...STANDARD_NAMES].sort());
			expect(list.every((r: { status: string }) => r.status === "PUBLISHED")).toBe(true);
			for (const r of list) expectShape(r, RESPONSE_SHAPE);
		});
		(await org.client.post(`${REPORTS}/seed-standard`)).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
		(await org.client.get(REPORTS)).expectStatus(200).expectJson((list) => expect(list).toHaveLength(4));
	});

	test("RPT-01 the standard reports declare their date parameters and column labels", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const seeded = (await org.client.post(`${REPORTS}/seed-standard`)).expectStatus(200).body;
		const sales = seeded.find((r: { name: string }) => r.name.startsWith("Sales totals"));
		expect(sales.parameters.map((p: { name: string }) => p.name)).toEqual(["fromDate", "toDate"]);
		expect(sales.parameters.every((p: { type: string }) => p.type === "DATE")).toBe(true);
		expect(sales.columns.map((c: { label: string }) => c.label)).toEqual(["Campus", "Customer", "Item", "Quantity", "Amount"]);
		const stock = seeded.find((r: { name: string }) => r.name.startsWith("Stock on hand"));
		expect(stock.parameters).toEqual([]);
	});

	test("RPT-03 every standard report runs: reports with date parameters need them, the others run as they are", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const seeded = (await org.client.post(`${REPORTS}/seed-standard`)).expectStatus(200).body;
		for (const report of seeded) {
			const parameters = Object.fromEntries(report.parameters.map((p: { name: string }) => [p.name, "2026-01-01"]));
			const res = await runReport(org.client, report.id, parameters);
			res.expectStatus(200).expectJson((body) => {
				expect(body.columns.length, `${report.name} should return columns`).toBeGreaterThan(0);
				expect(body.rows, `${report.name} on an empty organisation`).toEqual([]);
			});
		}
	});

	test("RPT-01 the standard reports in the shared organisation can be run with a date range", async ({ api }) => {
		const seeded = (await api.post(`${REPORTS}/seed-standard`)).expectStatus(200);
		expect(Array.isArray(seeded.body)).toBe(true);
		const list = (await api.get(REPORTS)).expectStatus(200).body;
		const sales = list.find((r: { name: string }) => r.name === STANDARD_NAMES[0]);
		expect(sales, "the sales report exists after seeding").toBeTruthy();
		(await runReport(api, sales.id, { fromDate: "2020-01-01", toDate: "2030-12-31" })).expectStatus(200).expectJson((body) => {
			expect(body.columns).toEqual(["campus_name", "customer_name", "item_name", "total_quantity", "total_amount"]);
		});
	});
});

test.describe("create, read and edit", () => {
	test("RPT-02 a created report is a draft owned by its author and reads back with its parameters and columns in order", async ({ api }) => {
		const body = reportBody({
			sqlQuery: "SELECT student_id, student_name FROM reporting_students WHERE admission_date >= :fromDate",
			parameters: [DATE_PARAMETER, { name: "toDate", type: "DATE", label: "To date", sortOrder: 1 }],
			columns: [
				{ sourceColumn: "student_id", label: "Student", sortOrder: 0 },
				{ sourceColumn: "student_name", label: "Name", sortOrder: 1 },
			],
		});
		const created = await api.post(REPORTS, { body });
		created.expectStatus([200, 201]).expectJson((r) => {
			expectShape(r, RESPONSE_SHAPE);
			expect(r).toMatchObject({ name: body.name, description: body.description, sqlQuery: body.sqlQuery, status: "DRAFT" });
		});
		(await api.get(REPORT, { params: { id: created.body.id } })).expectStatus(200).expectJson((r) => {
			expect(r.parameters).toEqual(body.parameters);
			expect(r.columns).toEqual(body.columns);
			expect(r.createdBy).toBe(created.body.createdBy);
		});
		(await api.get(REPORTS)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(created.body.id));
	});

	test("RPT-02 the description is optional", async ({ api }) => {
		(await api.post(REPORTS, { body: reportBody({ description: null }) })).expectStatus([200, 201]).expectJson((r) => expect(r.description).toBeNull());
	});

	test("RPT-02 every parameter type is accepted", async ({ api }) => {
		const parameters = ["STRING", "NUMBER", "DATE", "BOOLEAN"].map((type, i) => ({ name: `p${i}`, type, label: type, sortOrder: i }));
		const created = await createReport(api, { parameters });
		expect(created.parameters.map((p: any) => p.type)).toEqual(["STRING", "NUMBER", "DATE", "BOOLEAN"]);
	});

	test("RPT-02 an unknown report returns 404 and a non-numeric id returns 400", async ({ api }) => {
		(await api.get(REPORT, { params: { id: 99999999 } })).expectStatus(404);
		(await api.get(REPORT, { params: { id: "abc" } })).expectStatus(BAD);
		(await api.put(REPORT, { params: { id: 99999999 }, body: reportBody() })).expectStatus(404);
		for (const action of ["publish", "archive", "duplicate"]) {
			(await api.post(`${REPORT}/${action}`, { params: { id: 99999999 } })).expectStatus(404);
		}
	});

	test("RPT-02 editing replaces the definition, including a parameter or column that keeps its name", async ({ api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT student_id FROM reporting_students WHERE admission_date >= :fromDate",
			parameters: [DATE_PARAMETER],
			columns: [{ sourceColumn: "student_id", label: "Student", sortOrder: 0 }],
		});
		const edit = reportBody({
			name: `${report.name} edited`,
			description: "Edited",
			sqlQuery: "SELECT student_id, student_name FROM reporting_students WHERE admission_date >= :fromDate",
			parameters: [{ ...DATE_PARAMETER, label: "Admitted since" }],
			columns: [
				{ sourceColumn: "student_id", label: "Id", sortOrder: 0 },
				{ sourceColumn: "student_name", label: "Name", sortOrder: 1 },
			],
		});
		(await api.put(REPORT, { params: { id: report.id }, body: edit })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ id: report.id, name: edit.name, description: "Edited", status: "DRAFT" });
			expect(r.parameters).toEqual(edit.parameters);
			expect(r.columns).toEqual(edit.columns);
		});
		(await api.get(REPORT, { params: { id: report.id } })).expectJson((r) => expect(r.sqlQuery).toBe(edit.sqlQuery));
		(await runReport(api, report.id, { fromDate: "2020-01-01" })).expectStatus(200).expectJson((b) => expect(b.columns).toEqual(["student_id", "student_name"]));
	});

	test("RPT-02 editing a published report keeps it published", async ({ api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(200);
		(await api.put(REPORT, { params: { id: report.id }, body: reportBody({ name: `${report.name} v2` }) })).expectStatus(200).expectJson((r) => expect(r.status).toBe("PUBLISHED"));
	});
});

test.describe("duplicate, publish and archive", () => {
	test("RPT-02 duplicating copies the definition into a new draft and leaves the source alone", async ({ api }) => {
		const source = await createReport(api, {
			sqlQuery: "SELECT student_id FROM reporting_students WHERE admission_date >= :fromDate",
			parameters: [DATE_PARAMETER],
			columns: [{ sourceColumn: "student_id", label: "Student", sortOrder: 0 }],
		});
		(await api.post(`${REPORT}/publish`, { params: { id: source.id } })).expectStatus(200);
		const copy = await api.post(`${REPORT}/duplicate`, { params: { id: source.id } });
		copy.expectStatus([200, 201]).expectJson((c) => {
			expect(c.id).not.toBe(source.id);
			expect(c).toMatchObject({ name: `${source.name} (copy)`, status: "DRAFT", sqlQuery: source.sqlQuery });
			expect(c.parameters).toEqual(source.parameters);
			expect(c.columns).toEqual(source.columns);
		});
		(await api.get(REPORT, { params: { id: source.id } })).expectJson((s) => expect(s).toMatchObject({ name: source.name, status: "PUBLISHED" }));
	});

	test("RPT-02 publishing moves a draft to published, and publishing again is a 409 with a clear message", async ({ api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("PUBLISHED"));
		(await api.post(`${REPORT}/publish`, { params: { id: report.id } })).expectStatus(409).expectJson((b) => expect(b.error).toMatch(/only a draft/i));
	});

	test("RPT-02 archiving works from draft and from published, cannot be undone, and an archived report cannot be edited or published", async ({ api }) => {
		const draft = await createReport(api);
		(await api.post(`${REPORT}/archive`, { params: { id: draft.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("ARCHIVED"));
		const published = await createReport(api);
		(await api.post(`${REPORT}/publish`, { params: { id: published.id } })).expectStatus(200);
		(await api.post(`${REPORT}/archive`, { params: { id: published.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("ARCHIVED"));

		(await api.post(`${REPORT}/publish`, { params: { id: draft.id } })).expectStatus(409);
		(await api.put(REPORT, { params: { id: draft.id }, body: reportBody() })).expectStatus(409).expectJson((b) => expect(b.error).toMatch(/archived/i));
		(await api.get(REPORT, { params: { id: draft.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("ARCHIVED"));
	});

	test("RPT-02 an archived report can still be duplicated into a fresh draft", async ({ api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/archive`, { params: { id: report.id } })).expectStatus(200);
		(await api.post(`${REPORT}/duplicate`, { params: { id: report.id } })).expectStatus([200, 201]).expectJson((c) => expect(c.status).toBe("DRAFT"));
	});
});

test.describe("running and exporting", () => {
	test("RPT-03 the rows come from the underlying data: a student admitted now is found by admission number", async ({ api }) => {
		const student = await admitStudent(api);
		const report = await createReport(api, {
			sqlQuery: "SELECT admission_number, student_name, student_status FROM reporting_students WHERE admission_number = :admissionNumber",
			parameters: [{ name: "admissionNumber", type: "STRING", label: "Admission number", sortOrder: 0 }],
		});
		(await runReport(api, report.id, { admissionNumber: student.admissionNumber })).expectStatus(200).expectJson((body) => {
			expect(body.columns).toEqual(["admission_number", "student_name", "student_status"]);
			expect(body.rows).toHaveLength(1);
			expect(body.rows[0].admission_number).toBe(student.admissionNumber);
		});
		(await runReport(api, report.id, { admissionNumber: "NO-SUCH-NUMBER" })).expectStatus(200).expectJson((body) => expect(body.rows).toEqual([]));
	});

	test("RPT-03 the row count of a report equals the number of students the students API lists", async ({ api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: "SELECT COUNT(*) AS total FROM reporting_students" });
		const fromReport = (await runReport(api, report.id)).expectStatus(200).body.rows[0].total;
		const fromApi = (await api.get("/api/v1/students/search", { query: { size: 1 } })).expectStatus(200).body.totalElements;
		// Other specs admit students in parallel, so the report (read second or first) may be a few rows apart.
		expect(Math.abs(Number(fromReport) - Number(fromApi))).toBeLessThanOrEqual(25);
		expect(Number(fromReport)).toBeGreaterThan(0);
	});

	test("RPT-03 result columns follow the SELECT aliases in order and every row is keyed by them", async ({ api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: STUDENT_ROWS_SQL.replace("student_id,", "student_id AS id,").replace("student_name", "student_name AS name") });
		(await runReport(api, report.id)).expectStatus(200).expectJson((body) => {
			expect(body.columns).toEqual(["id", "admission_number", "name"]);
			expect(body.rows.length).toBeGreaterThan(0);
			for (const row of body.rows) expect(Object.keys(row)).toEqual(body.columns);
		});
	});

	test("RPT-03 a draft report can be run by its author", async ({ api }) => {
		const report = await createReport(api);
		expect(report.status).toBe("DRAFT");
		(await runReport(api, report.id)).expectStatus(200).expectJson((body) => expect(body).toEqual({ columns: ["one"], rows: [{ one: 1 }] }));
	});

	test("RPT-03 filter values are bound as parameters: a value made of SQL is just text", async ({ api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT COUNT(*) AS n FROM reporting_students WHERE admission_number = :adm",
			parameters: [{ name: "adm", type: "STRING", label: "Admission number", sortOrder: 0 }],
		});
		for (const value of ["x' OR '1'='1", "'; DROP TABLE students; --", "%", "\" OR 1=1 #"]) {
			(await runReport(api, report.id, { adm: value })).expectStatus(200).expectJson((body) => expect(body.rows).toEqual([{ n: 0 }]));
		}
	});

	test("RPT-03 a NUMBER, DATE and BOOLEAN parameter are bound with their type", async ({ api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT :n AS n, :flag AS flag, :since AS since",
			parameters: [
				{ name: "n", type: "NUMBER", label: "N", sortOrder: 0 },
				{ name: "flag", type: "BOOLEAN", label: "Flag", sortOrder: 1 },
				{ name: "since", type: "DATE", label: "Since", sortOrder: 2 },
			],
		});
		(await runReport(api, report.id, { n: 42, flag: true, since: "2026-01-15" })).expectStatus(200).expectJson((body) => {
			expect(Number(body.rows[0].n)).toBe(42);
			expect(String(body.rows[0].since)).toContain("2026-01-15");
		});
	});

	test("RPT-03 a missing parameter value returns 400 naming the parameter", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT :adm AS adm", parameters: [{ name: "adm", type: "STRING", label: "Adm", sortOrder: 0 }] });
		(await runReport(api, report.id, {})).expectStatus(BAD).expectJson((b) => expect(b.error).toMatch(/adm/));
	});

	test("RPT-03 a run request with no parameters object at all returns 400, never 500", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT :adm AS adm", parameters: [{ name: "adm", type: "STRING", label: "Adm", sortOrder: 0 }] });
		(await api.post(`${REPORT}/run`, { params: { id: report.id }, body: {} })).expectStatus(BAD);
		(await api.post(`${REPORT}/run`, { params: { id: report.id } })).expectStatus(BAD);
	});

	test("RPT-03 a placeholder in the SQL that was never declared as a parameter is rejected, not silently run as NULL", async ({ api }) => {
		const created = await api.post(REPORTS, { body: reportBody({ sqlQuery: "SELECT COUNT(*) AS n FROM reporting_students WHERE admission_number = :undeclared" }) });
		if (created.ok) {
			// If it is accepted at save time it must fail when it is run, not return a count of 0.
			(await runReport(api, created.body.id, {})).expectStatus(BAD);
		} else {
			created.expectStatus(BAD);
		}
	});

	test("RPT-03 a value that does not match the declared parameter type is rejected with a readable message, not passed to the database", async ({ api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT :since AS since, :n AS n",
			parameters: [{ ...DATE_PARAMETER, name: "since" }, { name: "n", type: "NUMBER", label: "N", sortOrder: 1 }],
		});
		for (const values of [{ since: "not-a-date", n: 1 }, { since: "2026-01-01", n: "abc" }, { since: "", n: 1 }]) {
			(await runReport(api, report.id, values)).expectStatus(BAD).expectJson((b) => {
				expect(b.error).toMatch(/since|date|number|\bn\b/i);
				expect(b.error).not.toMatch(INTERNALS);
				expect(b.error).not.toMatch(/Incorrect \w+ value|Report query failed/i);
			});
		}
	});

	test("RPT-03 a query that returns nothing gives the columns and an empty list", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT student_id FROM reporting_students WHERE student_id < 0" });
		(await runReport(api, report.id)).expectStatus(200).expectJson((body) => expect(body).toEqual({ columns: ["student_id"], rows: [] }));
	});

	test("RPT-03 a query that runs for too long is stopped and answers with an error, not a hang", async ({ api }) => {
		test.setTimeout(60_000);
		const report = await createReport(api, { sqlQuery: "SELECT SLEEP(30) AS slept" });
		const started = Date.now();
		(await runReport(api, report.id)).expectStatus([BAD, 408, 504]);
		expect(Date.now() - started, "the 10 second query timeout should cut the run short").toBeLessThan(20_000);
	});

	test("RPT-03 a result larger than the row limit is flagged as truncated instead of silently cut", async ({ api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: "SELECT a.student_id FROM reporting_students a CROSS JOIN reporting_students b" });
		const run = (await runReport(api, report.id)).expectStatus(200);
		expect(run.body.rows.length).toBeLessThanOrEqual(5000);
		expect(run.body.truncated ?? run.body.limited ?? run.body.hasMore, "the response should say rows were left out").toBe(true);
	});

	test("RPT-03 an unknown report cannot be run", async ({ api }) => {
		(await runReport(api, 99999999)).expectStatus(404);
	});

	test("RPT-04 exporting returns the same columns and rows as running, with the parameters applied", async ({ api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: STUDENT_ROWS_SQL });
		const run = (await runReport(api, report.id)).expectStatus(200).body;
		(await api.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(200).expectJson((body) => {
			expect(body.columns).toEqual(run.columns);
			expect(body.rows).toEqual(run.rows);
		});
	});

	test("RPT-04 exporting an unknown report returns 404 and a missing parameter returns 400", async ({ api }) => {
		(await api.post(`${REPORT}/export`, { params: { id: 99999999 }, body: { parameters: {} } })).expectStatus(404);
		const report = await createReport(api, { sqlQuery: "SELECT :adm AS adm", parameters: [{ name: "adm", type: "STRING", label: "Adm", sortOrder: 0 }] });
		(await api.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(BAD);
	});

	test("RPT-04 an export with more rows than the row limit says so", async ({ api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: "SELECT a.student_id FROM reporting_students a CROSS JOIN reporting_students b" });
		const exported = (await api.post(`${REPORT}/export`, { params: { id: report.id }, body: { parameters: {} } })).expectStatus(200);
		expect(exported.body.rows.length).toBeLessThanOrEqual(5000);
		expect(exported.body.truncated ?? exported.body.limited ?? exported.body.hasMore, "an export that drops rows must say so").toBe(true);
	});
});

// The guard in front of the read-only database login: only a single SELECT gets through.
test.describe("SQL guard", () => {
	const REJECTED: [string, string][] = [
		["an empty query", ""],
		["a blank query", "   \n  "],
		["a DELETE", "DELETE FROM students"],
		["an UPDATE", "UPDATE students SET status = 'X'"],
		["an INSERT", "INSERT INTO students (id) VALUES (1)"],
		["a DROP", "DROP TABLE students"],
		["an ALTER", "ALTER TABLE students ADD COLUMN x INT"],
		["a TRUNCATE", "TRUNCATE TABLE students"],
		["a GRANT", "GRANT ALL ON *.* TO 'x'@'%'"],
		["a CALL", "CALL do_something()"],
		["two statements", "SELECT 1; SELECT 2"],
		["a data change after a SELECT", "SELECT 1; DELETE FROM students"],
		["a line comment", "SELECT 1 AS one -- hidden"],
		["a block comment", "SELECT /* hidden */ 1 AS one"],
		["a hash comment", "SELECT 1 AS one # hidden"],
		["a lock", "SELECT student_id FROM reporting_students FOR UPDATE"],
		["a write to a file", "SELECT student_name FROM reporting_students INTO OUTFILE '/tmp/students.txt'"],
		["a write to a dump file", "SELECT student_name FROM reporting_students INTO DUMPFILE '/tmp/students.bin'"],
	];

	for (const [label, sqlQuery] of REJECTED) {
		test(`RPT-08 ${label} is rejected when the report is saved, with a 400 and a readable message`, async ({ api }) => {
			(await api.post(REPORTS, { body: reportBody({ sqlQuery }) })).expectStatus(BAD).expectJson((b) => {
				expect(typeof b.error).toBe("string");
				expect(b.error).not.toMatch(INTERNALS);
			});
		});
	}

	test("RPT-08 the same checks apply when an existing report is edited", async ({ api }) => {
		const report = await createReport(api);
		for (const sqlQuery of ["DELETE FROM students", "SELECT 1; SELECT 2", "SELECT 1 -- x", ""]) {
			(await api.put(REPORT, { params: { id: report.id }, body: reportBody({ sqlQuery }) })).expectStatus(BAD);
		}
		(await api.get(REPORT, { params: { id: report.id } })).expectJson((r) => expect(r.sqlQuery).toBe("SELECT 1 AS one"));
	});

	test("RPT-08 a trailing semicolon, lower case and leading whitespace are fine", async ({ api }) => {
		for (const sqlQuery of ["SELECT 1 AS one;", "select 1 as one", "  \n SELECT 1 AS one"]) {
			(await api.post(REPORTS, { body: reportBody({ sqlQuery }) })).expectStatus([200, 201]);
		}
	});

	test("RPT-08 a harmless word like 'Update' inside a text value or a REPLACE() function does not block a valid read-only query", async ({ api }) => {
		for (const sqlQuery of [
			"SELECT student_name FROM reporting_students WHERE student_name = 'Update me'",
			"SELECT REPLACE(student_name, 'a', 'b') AS name FROM reporting_students LIMIT 1",
			"SELECT class_name AS `set` FROM reporting_students LIMIT 1",
		]) {
			(await api.post(REPORTS, { body: reportBody({ sqlQuery }) })).expectStatus([200, 201]);
		}
	});

	test("RPT-08 a malformed request body returns 400, never 500", async ({ api }) => {
		for (const body of [{ name: "only a name" }, {}, { sqlQuery: "SELECT 1" }, { name: "x", sqlQuery: "SELECT 1" }]) {
			(await api.post(REPORTS, { body })).expectStatus(BAD);
		}
		(await api.post(REPORTS, { body: { ...reportBody(), parameters: "nope" } })).expectStatus(BAD);
	});

	test("RPT-08 a blank report name is rejected", async ({ api }) => {
		(await api.post(REPORTS, { body: reportBody({ name: "" }) })).expectStatus(BAD);
		(await api.post(REPORTS, { body: reportBody({ name: "   " }) })).expectStatus(BAD);
	});

	test("RPT-08 a name longer than the stored limit is a 400 that says so, not a bare conflict", async ({ api }) => {
		(await api.post(REPORTS, { body: reportBody({ name: "x".repeat(400) }) })).expectStatus(BAD);
	});

	test("RPT-08 an unknown parameter type returns 400 and does not leak the internal enum name", async ({ api }) => {
		(await api.post(REPORTS, { body: reportBody({ parameters: [{ name: "a", type: "UUID", label: "A", sortOrder: 0 }] }) }))
			.expectStatus(BAD)
			.expectJson((b) => expect(b.error).not.toMatch(INTERNALS));
	});

	test("RPT-08 two parameters, or two columns, with the same name are rejected with a message that names them", async ({ api }) => {
		const dupParams = await api.post(REPORTS, {
			body: reportBody({ parameters: [{ name: "a", type: "STRING", label: "A", sortOrder: 0 }, { name: "a", type: "STRING", label: "A again", sortOrder: 1 }] }),
		});
		dupParams.expectStatus([BAD, 409]).expectJson((b) => expect(b.error).toMatch(/parameter/i));
		const dupColumns = await api.post(REPORTS, {
			body: reportBody({ columns: [{ sourceColumn: "one", label: "A", sortOrder: 0 }, { sourceColumn: "one", label: "B", sortOrder: 1 }] }),
		});
		dupColumns.expectStatus([BAD, 409]).expectJson((b) => expect(b.error).toMatch(/column/i));
	});

	test("RPT-02 a second report with the name of an existing one is flagged (the standard-report seed treats the name as the identity)", async ({ api }) => {
		const first = reportBody();
		(await api.post(REPORTS, { body: first })).expectStatus([200, 201]);
		(await api.post(REPORTS, { body: first })).expectStatus([409, BAD]).expectJson((b) => expect(b.error).toMatch(/name|already/i));
	});

	test("RPT-06 a query on an application table is refused when it is run, and no rows come back", async ({ api }) => {
		for (const sqlQuery of ["SELECT * FROM students", "SELECT * FROM users", "SELECT password_hash FROM users"]) {
			const report = await createReport(api, { sqlQuery });
			(await runReport(api, report.id)).expectStatus([BAD, 403]).expectJson((b) => {
				expect(b.rows).toBeUndefined();
				// Names the user and host of the read-only database login today.
				expect(b.error).not.toMatch(INTERNALS);
			});
		}
	});

	test("RPT-06 a database error is reported without the SQL, the column or table names, or the database login", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT no_such_column FROM reporting_students" });
		(await runReport(api, report.id)).expectStatus(BAD).expectJson((b) => {
			expect(b.error).not.toMatch(/no_such_column|field list|reporting_students/i);
			expect(b.error).not.toMatch(INTERNALS);
		});
	});

	test("RPT-06 a fully qualified name in another schema is refused too", async ({ api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT * FROM mysql.user" });
		(await runReport(api, report.id)).expectStatus([BAD, 403]).expectJson((b) => expect(b.rows).toBeUndefined());
	});

	test("RPT-06 the reporting views the database login can read are exactly the curated ones, each with an organisation column", async ({ api }) => {
		const views = [
			"reporting_students", "reporting_attendance_daily", "reporting_fee_invoices", "reporting_fee_payments", "reporting_exam_results",
			"reporting_staff", "reporting_sales", "reporting_inventory_stock", "reporting_purchase_orders", "reporting_organisation",
		];
		for (const view of views) {
			const report = await createReport(api, { sqlQuery: `SELECT * FROM ${view} LIMIT 1` });
			(await runReport(api, report.id)).expectStatus(200).expectJson((b) => expect(b.columns, `${view} columns`).toContain("organisation_id"));
		}
	});
});
