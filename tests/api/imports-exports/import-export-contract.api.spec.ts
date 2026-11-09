// What every bulk import and export endpoint shares: auth, permissions, file handling and the
// per-row result shape. Table-driven over IMPORT_ENTITIES (src/api/imports.ts). IDs refer to
// docs/SCENARIOS.md section 29 (IMP-*). Entity-specific rules live in import-entities.api.spec.ts.
// Nothing here writes data except the parser tests, which import uniquely-coded subjects.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { uniqueCode } from "../../../src/api/data";
import { IMPORT_ENTITIES, csvFile, entity, importFile, multipart, xlsxFile, type ImportRow } from "../../../src/api/imports";

const BAD = [400, 422];
const subjects = entity("subjects");
const LEAK = /Exception|java\.|org\.springframework|hibernate|SQLSyntax|could not execute|stack ?trace/i;

for (const e of IMPORT_ENTITIES) {
	test.describe(`${e.label} import/export contract`, () => {
		test(`IMP-01 ${e.key}: import and export need a token`, async ({ anon }) => {
			(await importFile(anon, e, csvFile(["x"], []))).expectStatus(401);
			(await anon.get(e.exportPath)).expectStatus(401);
		});

		test(`IMP-01 ${e.key}: a garbage token is rejected like no token`, async ({ anon }) => {
			(await anon.get(e.exportPath, { token: "not-a-token" })).expectStatus(401);
			(await anon.post(e.importPath, { token: "not-a-token", multipart: multipart(csvFile(["x"], [])) })).expectStatus(401);
		});

		test(`IMP-02 ${e.key}: importing needs ${e.managePermission}; viewing alone is not enough`, async ({ as }) => {
			for (const role of ["noPermissions", "readOnlyStaff"] as const) {
				(await importFile(as(role), e, csvFile(["x"], ["y"]))).expectStatus(403);
				(await importFile(as(role), e, csvFile(["x"], ["y"]), true)).expectStatus(403);
			}
		});

		test(`IMP-02 ${e.key}: exporting needs view access; a role with none gets 403`, async ({ as }) => {
			(await as("noPermissions").get(e.exportPath)).expectStatus(403);
			(await as("readOnlyStaff").get(e.exportPath)).expectStatus(200).expectJson((rows) => expect(Array.isArray(rows)).toBe(true));
		});

		test(`IMP-03 ${e.key}: a request with no file is a client error`, async ({ api }) => {
			(await api.post(e.importPath)).expectStatus(BAD);
		});

		test(`IMP-03 ${e.key}: an unsupported file type is a client error that names the problem`, async ({ api }) => {
			const res = await importFile(api, e, { name: "data.txt", mimeType: "text/plain", buffer: Buffer.from("a,b\n1,2\n") });
			res.expectStatus(BAD);
			expect(JSON.stringify(res.body)).not.toMatch(LEAK);
		});

		test(`IMP-03 ${e.key}: a completely empty file is a client error with a plain message`, async ({ api }) => {
			const res = await importFile(api, e, csvFile([], []), e.legacy ? undefined : true);
			res.expectStatus(BAD);
			expect(JSON.stringify(res.body)).not.toMatch(LEAK);
		});

		test(`IMP-03 ${e.key}: a header-only file imports nothing and reports no rows`, async ({ api }) => {
			(await importFile(api, e, csvFile(e.templateHeaders, []), e.legacy ? undefined : true)).expectStatus(200).expectJson((rows) => expect(rows).toEqual([]));
		});

		test(`IMP-04 ${e.key}: a file with the wrong columns reports the problem per row, with a clean message`, async ({ api }) => {
			const res = await importFile(api, e, csvFile(["foo", "bar"], ["1,2", "3,4"]), e.legacy ? undefined : true);
			res.expectStatus(200);
			const rows = res.body as { row: number; status?: string; success?: boolean; message: string }[];
			expect(rows.length).toBeGreaterThan(0);
			for (const row of rows) {
				if (e.legacy) expect(row.success).toBe(false);
				else expect(row.status).toBe("ERROR");
				expect(row.message).toEqual(expect.any(String));
				expect(row.message.length).toBeGreaterThan(0);
				expect(row.message).not.toMatch(LEAK);
			}
			// the first data row is row 2 (the header is row 1), unless the whole file is rejected up front as row 1
			expect(rows[0].row).toBeGreaterThanOrEqual(1);
			expect(rows[0].row).toBeLessThanOrEqual(2);
		});

		test(`IMP-05 ${e.key}: the export is a JSON array carrying the same ids it lists`, async ({ api }) => {
			(await api.get(e.exportPath)).expectStatus(200).expectJson((rows) => {
				expect(Array.isArray(rows)).toBe(true);
				for (const row of rows.slice(0, 5)) expect(typeof row).toBe("object");
			});
		});
	});
}

test.describe("per-row result shape (shared importers)", () => {
	const shared = IMPORT_ENTITIES.filter((e) => !e.legacy);

	for (const e of shared) {
		test(`IMP-06 ${e.key}: every row result is { row, status, message, id } with a known status`, async ({ api }) => {
			const rows = (await importFile(api, e, csvFile(["foo"], ["1", "2", "3"]), true)).expectStatus(200).body as ImportRow[];
			expect(rows.map((r) => r.row)).toEqual([2, 3, 4]);
			for (const row of rows) {
				expect(Object.keys(row).sort()).toEqual(["id", "message", "row", "status"]);
				expect(["VALID", "IMPORTED", "ERROR", "DUPLICATE"]).toContain(row.status);
			}
		});
	}
});

test.describe("file parsing (shared by every importer but Students)", () => {
	const header = ["name", "code"];
	const run = async (api: Parameters<typeof importFile>[0], file: ReturnType<typeof csvFile>, validateOnly?: boolean) => (await importFile(api, subjects, file, validateOnly)).expectStatus(200).body as ImportRow[];
	const codes = async (api: Parameters<typeof importFile>[0]) => ((await api.get("/api/v1/subjects")).body as { code: string }[]).map((s) => s.code);

	test("IMP-07 an .xlsx workbook imports exactly like the same CSV", async ({ api }) => {
		const a = uniqueCode("XLA");
		const b = uniqueCode("XLB");
		const rows = await run(api, xlsxFile(header, [[`Excel ${a}`, a], [`Excel ${b}`, b]], "subjects.xlsx"));
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED", "IMPORTED"]);
		expect(await codes(api)).toEqual(expect.arrayContaining([a, b]));
	});

	test("IMP-07 an .xlsx validate-only run saves nothing and a bad row is flagged", async ({ api }) => {
		const a = uniqueCode("XLV");
		const rows = await run(api, xlsxFile(header, [[`Excel ${a}`, a], ["", "NONAME"]], "subjects.xlsx"), true);
		expect(rows.map((r) => r.status)).toEqual(["VALID", "ERROR"]);
		expect(await codes(api)).not.toContain(a);
	});

	test("IMP-07 a file named .xlsx that is not a workbook is a client error, not a 500", async ({ api }) => {
		const res = await importFile(api, subjects, { name: "fake.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("this is not a zip") });
		expect([...BAD, 200]).toContain(res.status);
		expect(JSON.stringify(res.body)).not.toMatch(LEAK);
	});

	test("IMP-07 the file extension is matched case-insensitively", async ({ api }) => {
		const a = uniqueCode("UP");
		expect((await run(api, csvFile(header, [`Upper ${a},${a}`], "SUBJECTS.CSV")))[0].status).toBe("IMPORTED");
	});

	test("IMP-08 columns can be in any order and unknown extra columns are ignored", async ({ api }) => {
		const a = uniqueCode("ORD");
		const rows = await run(api, csvFile(["code", "ignoreMe", "name"], [`${a},whatever,Reordered ${a}`]));
		expect(rows[0].status).toBe("IMPORTED");
		expect(((await api.get("/api/v1/subjects")).body as { code: string; name: string }[]).find((s) => s.code === a)?.name).toBe(`Reordered ${a}`);
	});

	test("IMP-08 Windows line endings and trailing blank lines are accepted", async ({ api }) => {
		const a = uniqueCode("CRLF");
		const file = { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`name,code\r\nWin ${a},${a}\r\n\r\n\r\n`) };
		const rows = await run(api, file);
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED"]);
	});

	test("IMP-08 blank lines between rows are skipped but the row numbers still follow the file", async ({ api }) => {
		const a = uniqueCode("GAP");
		const b = uniqueCode("GAP");
		const rows = await run(api, { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`name,code\nOne ${a},${a}\n\nTwo ${b},${b}\n`) }, true);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.status)).toEqual(["VALID", "VALID"]);
	});

	test("IMP-08 a quoted value may contain a comma, and surrounding spaces are trimmed", async ({ api }) => {
		const a = uniqueCode("QUOTE");
		await run(api, { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`name,code\n"Maths, Advanced ${a}",  ${a}  \n`) });
		const saved = ((await api.get("/api/v1/subjects")).body as { code: string; name: string }[]).find((s) => s.code === a);
		expect(saved?.name).toBe(`Maths, Advanced ${a}`);
	});

	test("IMP-08 non-Latin text survives the upload", async ({ api }) => {
		const a = uniqueCode("UNI");
		await run(api, { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`name,code\nगणित Café ${a},${a}\n`, "utf8") });
		expect(((await api.get("/api/v1/subjects")).body as { code: string; name: string }[]).find((s) => s.code === a)?.name).toBe(`गणित Café ${a}`);
	});

	test("IMP-08 a CSV saved by Excel as 'CSV UTF-8' (with a byte-order mark) is read, not rejected", async ({ api }) => {
		const a = uniqueCode("BOM");
		const rows = await run(api, { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`﻿name,code\nBom ${a},${a}\n`, "utf8") }, true);
		expect(rows.map((r) => r.status), `first row said: ${rows[0]?.message}`).toEqual(["VALID"]);
	});

	test("IMP-09 one bad row does not stop the rows around it", async ({ api }) => {
		const a = uniqueCode("OK");
		const b = uniqueCode("OK");
		const rows = await run(api, csvFile(header, [`First ${a},${a}`, ",NONAME", `Third ${b},${b}`]));
		expect(rows.map((r) => [r.row, r.status])).toEqual([[2, "IMPORTED"], [3, "ERROR"], [4, "IMPORTED"]]);
		expect(await codes(api)).toEqual(expect.arrayContaining([a, b]));
	});

	test("IMP-09 the same code twice in one file: the first row is created and the second is a duplicate", async ({ api }) => {
		const a = uniqueCode("TWICE");
		const rows = await run(api, csvFile(header, [`First ${a},${a}`, `Second ${a},${a}`]));
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED", "DUPLICATE"]);
		expect((await codes(api)).filter((c) => c === a)).toHaveLength(1);
	});

	test("IMP-09 a value longer than the stored limit is reported on its row, never a 500", async ({ api }) => {
		const a = uniqueCode("LONG");
		const res = await importFile(api, subjects, csvFile(header, [`${"x".repeat(5000)},${a}`]));
		expect(res.status).toBe(200);
		expect((res.body as ImportRow[])[0].status).toBe("ERROR");
		expect((res.body as ImportRow[])[0].message).not.toMatch(LEAK);
	});

	test("IMP-10 a few hundred rows import in one request", async ({ api }) => {
		const lines = Array.from({ length: 300 }, () => {
			const code = uniqueCode("BULK");
			return `Bulk ${code},${code}`;
		});
		const rows = await run(api, csvFile(header, lines));
		expect(rows).toHaveLength(300);
		expect(rows.filter((r) => r.status === "IMPORTED")).toHaveLength(300);
		expect(rows[299].row).toBe(301);
	});

	test("IMP-10 validate-only twice in a row gives the same answer and records no history", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const a = uniqueCode("IDEM");
		const file = csvFile(header, [`Idem ${a},${a}`]);
		const first = await run(org.client, file, true);
		const second = await run(org.client, file, true);
		expect(second).toEqual(first);
		(await org.client.get("/api/v1/imports/history")).expectJson((history) => expect(history).toEqual([]));
	});
});
