// GET /api/v1/imports/history and organisation isolation of imports and exports. IDs refer to
// docs/SCENARIOS.md section 29 (IMP-30 .. IMP-32). Each scenario provisions its own organisation(s).

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { uniqueCode } from "../../../src/api/data";
import { INV, createCategory as createItemCategory } from "../../../src/api/inventory";
import { IMPORT_ENTITIES, csvFile, entity, importFile, staffLookups, type ImportRow } from "../../../src/api/imports";
import { expectShape } from "../../../src/api/shapes";
import type { ApiClient } from "../../../src/api/apiClient";

interface Run {
	id: number;
	entityType: string;
	fileName: string;
	totalRows: number;
	importedCount: number;
	errorCount: number;
	duplicateCount: number;
	createdAt: string;
}

const history = async (client: ApiClient) => (await client.get("/api/v1/imports/history")).expectStatus(200).body as Run[];
const subjects = entity("subjects");

test.describe("import history", () => {
	test("IMP-30 a new organisation has no import history", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		expect(await history(org.client)).toEqual([]);
	});

	test("IMP-30 history needs a token", async ({ anon }) => {
		(await anon.get("/api/v1/imports/history")).expectStatus(401);
	});

	test("IMP-30 a real import is recorded with its file name, size and per-status counts", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const a = uniqueCode("H");
		const b = uniqueCode("H");
		const file = csvFile(["name", "code"], [`One ${a},${a}`, `Two ${b},${b}`, ",NONAME", `Dup ${a},${a}`], "term-subjects.csv");
		const rows = (await importFile(org.client, subjects, file)).expectStatus(200).body as ImportRow[];
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED", "IMPORTED", "ERROR", "DUPLICATE"]);

		const runs = await history(org.client);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ entityType: "Subject", fileName: "term-subjects.csv", totalRows: 4, importedCount: 2, errorCount: 1, duplicateCount: 1 });
		expectShape(runs[0], { id: "number", entityType: "string", fileName: "string", totalRows: "number", importedCount: "number", errorCount: "number", duplicateCount: "number", createdAt: "string" });
		expect(Date.parse(runs[0].createdAt)).not.toBeNaN();
		expect(Math.abs(Date.now() - Date.parse(runs[0].createdAt))).toBeLessThan(10 * 60 * 1000);
	});

	test("IMP-30 a dry run is not recorded", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("H");
		await importFile(org.client, subjects, csvFile(["name", "code"], [`Dry ${code},${code}`]), true);
		expect(await history(org.client)).toEqual([]);
	});

	test("IMP-30 history lists the newest import first and keeps one entry per run", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (const name of ["first.csv", "second.csv", "third.csv"]) {
			const code = uniqueCode("H");
			await importFile(org.client, subjects, csvFile(["name", "code"], [`${name} ${code},${code}`], name));
		}
		const runs = await history(org.client);
		expect(runs.map((r) => r.fileName)).toEqual(["third.csv", "second.csv", "first.csv"]);
		expect(new Set(runs.map((r) => r.id)).size).toBe(3);
	});

	test("IMP-30 an import where every row failed is still recorded", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await importFile(org.client, subjects, csvFile(["name", "code"], [",A", ",B"], "bad.csv"));
		expect((await history(org.client))[0]).toMatchObject({ fileName: "bad.csv", totalRows: 2, importedCount: 0, errorCount: 2, duplicateCount: 0 });
	});

	for (const e of IMPORT_ENTITIES.filter((x) => x.historyType)) {
		test(`IMP-30 ${e.key}: a real import is recorded as "${e.historyType}"`, async ({ request, calls }) => {
			const org = await createOtherOrganisation(request, calls);
			// a file whose columns match nothing: every importer reports the row as an error and still records the run
			(await importFile(org.client, e, csvFile(["unrelated"], ["x"], `${e.key}.csv`))).expectStatus(200);
			expect(await history(org.client)).toEqual([expect.objectContaining({ entityType: e.historyType, fileName: `${e.key}.csv`, totalRows: 1, importedCount: 0, errorCount: 1, duplicateCount: 0 })]);
		});
	}
});

test.describe("organisation isolation", () => {
	test("IMP-31 one organisation's import history is not visible to another", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);
		const code = uniqueCode("H");
		await importFile(a.client, subjects, csvFile(["name", "code"], [`Mine ${code},${code}`], "a-only.csv"));
		expect((await history(a.client)).map((r) => r.fileName)).toEqual(["a-only.csv"]);
		expect(await history(b.client)).toEqual([]);
	});

	test("IMP-31 an export holds only the caller's organisation's rows", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);

		const subjectCode = uniqueCode("ISO");
		await importFile(a.client, subjects, csvFile(["name", "code"], [`Iso ${subjectCode},${subjectCode}`]));

		const category = await createItemCategory(a.client);
		const itemCode = uniqueCode("ISO");
		await importFile(a.client, entity("inventory-items"), csvFile(entity("inventory-items").templateHeaders, [`${category.name},${itemCode},Iso item,pc,,`]));

		const campus = ((await a.client.get("/api/v1/campuses")).body as { name: string }[])[0].name;
		const reg = uniqueCode("ISO");
		await importFile(a.client, entity("vehicles-routes"), csvFile(entity("vehicles-routes").templateHeaders, [`${campus},${reg},BUS,30,,,,`]));

		const lookups = await staffLookups(a.client);
		const empCode = uniqueCode("ISO");
		await importFile(a.client, entity("staff"), csvFile(entity("staff").templateHeaders, [`Iso,Staff,1990-01-01,MALE,,,${empCode},2020-01-01,PERMANENT,${lookups.department},${lookups.designation},${lookups.campus}`]));

		const isbn = `978${String(Date.now()).slice(-10)}`;
		await importFile(a.client, entity("books"), csvFile(entity("books").templateHeaders, [`${isbn},Iso book,Author,,,`]));

		const mine = async (client: ApiClient, key: string) => JSON.stringify((await client.get(entity(key).exportPath)).expectStatus(200).body);
		for (const [key, value] of [["subjects", subjectCode], ["inventory-items", itemCode], ["vehicles-routes", reg], ["staff", empCode], ["books", isbn]] as const) {
			expect(await mine(a.client, key), `${key} export of the owning organisation`).toContain(value);
			expect(await mine(b.client, key), `${key} export of another organisation`).not.toContain(value);
		}
		expect((await b.client.get(`${INV}/items/export`)).body).toEqual([]);
	});

	test("IMP-32 duplicate detection is per organisation: the same code imports cleanly into another one", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);

		const subjectCode = uniqueCode("SAME");
		const subjectFile = csvFile(["name", "code"], [`Same ${subjectCode},${subjectCode}`]);
		expect(((await importFile(a.client, subjects, subjectFile)).body as ImportRow[])[0].status).toBe("IMPORTED");
		expect(((await importFile(b.client, subjects, subjectFile)).body as ImportRow[])[0].status).toBe("IMPORTED");
		expect(((await importFile(b.client, subjects, subjectFile)).body as ImportRow[])[0].status).toBe("DUPLICATE");

		const itemHeader = entity("inventory-items").templateHeaders;
		const itemCode = uniqueCode("SAME");
		for (const org of [a, b]) {
			const category = await createItemCategory(org.client);
			const rows = (await importFile(org.client, entity("inventory-items"), csvFile(itemHeader, [`${category.name},${itemCode},Same item,pc,,`]))).body as ImportRow[];
			expect(rows[0].status, `${org.slug}: ${rows[0].message}`).toBe("IMPORTED");
		}

		const reg = uniqueCode("SAME");
		for (const org of [a, b]) {
			const campus = ((await org.client.get("/api/v1/campuses")).body as { name: string }[])[0].name;
			const rows = (await importFile(org.client, entity("vehicles-routes"), csvFile(entity("vehicles-routes").templateHeaders, [`${campus},${reg},BUS,30,,,,`]))).body as ImportRow[];
			expect(rows[0].status, `${org.slug}: ${rows[0].message}`).toBe("IMPORTED");
		}

		const empCode = uniqueCode("SAME");
		for (const org of [a, b]) {
			const l = await staffLookups(org.client);
			const rows = (await importFile(org.client, entity("staff"), csvFile(entity("staff").templateHeaders, [`Same,Staff,1990-01-01,MALE,,,${empCode},2020-01-01,PERMANENT,${l.department},${l.designation},${l.campus}`]))).body as ImportRow[];
			expect(rows[0].status, `${org.slug}: ${rows[0].message}`).toBe("IMPORTED");
		}
	});

	test("IMP-32 a row can only name lookups (category, campus, department) from its own organisation", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(a.client);
		const rows = (await importFile(b.client, entity("inventory-items"), csvFile(entity("inventory-items").templateHeaders, [`${category.name},${uniqueCode("X")},Stolen,pc,,`]), true)).expectStatus(200).body as ImportRow[];
		expect(rows[0].status).toBe("ERROR");
		expect(rows[0].message).toContain(category.name);

		const lookups = await staffLookups(a.client);
		const staff = (await importFile(b.client, entity("staff"), csvFile(entity("staff").templateHeaders, [`X,Y,1990-01-01,MALE,,,${uniqueCode("X")},2020-01-01,PERMANENT,${lookups.department},${lookups.designation},${lookups.campus}`]), true)).body as ImportRow[];
		expect(staff[0].status).toBe("ERROR");
		expect(staff[0].message).toMatch(/Unknown department/);
	});
});
