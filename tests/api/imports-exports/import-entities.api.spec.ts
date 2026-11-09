// The bulk importers that had no API coverage: staff, vehicles & routes, inventory items and fee
// structures (subjects, class sections, opening balances, students, guardians, enrolments and
// books are covered in their module specs). IDs refer to docs/SCENARIOS.md section 29 (IMP-*).
// Every scenario works in its own throwaway organisation, so rows never collide with other specs.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { buildAcademicBase } from "../../../src/api/academics";
import { createCategory as createFeeCategory, createGroup, FEES } from "../../../src/api/fees";
import { INV, createCategory as createItemCategory } from "../../../src/api/inventory";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";
import { expectShape } from "../../../src/api/shapes";
import { csvFile, entity, importFile, staffLookups, type ImportRow } from "../../../src/api/imports";
import type { ApiClient } from "../../../src/api/apiClient";

const NO_INTERNALS = /No enum constant|com\.operion|java\.|Exception|could not execute|For input string/;

/** Runs an import and returns the per-row results. */
async function run(client: ApiClient, key: string, header: string[], lines: string[], validateOnly?: boolean): Promise<ImportRow[]> {
	return (await importFile(client, entity(key), csvFile(header, lines), validateOnly)).expectStatus(200).body as ImportRow[];
}

test.describe("staff import and export", () => {
	const header = entity("staff").templateHeaders;
	const row = (l: { department: string; designation: string; campus: string }, code: string, over: Partial<Record<string, string>> = {}) => {
		const v: Record<string, string> = { firstName: "Ravi", lastName: "Menon", dateOfBirth: "1985-01-01", gender: "MALE", email: `${code.toLowerCase()}@example.test`, phone: "9876500000", employeeCode: code, dateOfJoining: "2020-06-01", employmentType: "PERMANENT", department: l.department, designation: l.designation, campus: l.campus, ...over };
		return header.map((h) => v[h] ?? "").join(",");
	};

	test("IMP-20 validate-only checks the row without creating the staff member; a real import creates it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const code = uniqueCode("EMP");
		const exported = async () => (await org.client.get("/api/v1/hr/staff/export")).body as { employeeCode: string }[];

		const dry = await run(org.client, "staff", header, [row(lookups, code)], true);
		expect(dry).toEqual([{ row: 2, status: "VALID", message: expect.any(String), id: null }]);
		expect((await exported()).map((s) => s.employeeCode)).not.toContain(code);

		const real = await run(org.client, "staff", header, [row(lookups, code)]);
		expect(real[0]).toMatchObject({ row: 2, status: "IMPORTED", id: expect.any(Number) });
		const created = (await exported()).find((s) => s.employeeCode === code);
		expect(created).toMatchObject({ id: real[0].id, firstName: "Ravi", lastName: "Menon", department: lookups.department, designation: lookups.designation, employmentType: "PERMANENT", dateOfJoining: "2020-06-01" });
	});

	test("IMP-20 the export has the documented columns and types", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		await run(org.client, "staff", header, [row(lookups, uniqueCode("EMP"))]);
		(await org.client.get("/api/v1/hr/staff/export")).expectStatus(200).expectJson((rows) => {
			expect(rows).toHaveLength(1);
			expectShape(rows[0], { id: "number", employeeCode: "string", firstName: "string", lastName: "string", email: "string", department: "string", designation: "string", employmentType: "string", dateOfJoining: "string", status: "string" });
			expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(entity("staff").exportColumns));
		});
	});

	test("IMP-20 an employee code that already exists is a duplicate, in both a dry run and a real import", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const code = uniqueCode("EMP");
		const first = await run(org.client, "staff", header, [row(lookups, code)]);
		for (const validateOnly of [true, undefined]) {
			const again = await run(org.client, "staff", header, [row(lookups, code, { firstName: "Other" })], validateOnly);
			expect(again[0]).toMatchObject({ status: "DUPLICATE", id: first[0].id });
			expect(again[0].message).toContain(code);
		}
		expect((await org.client.get("/api/v1/hr/staff/export")).body).toHaveLength(1);
	});

	test("IMP-20 each missing required field fails its own row and names the field", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const required = ["firstName", "employeeCode", "dateOfJoining", "employmentType", "department", "designation", "campus"];
		const rows = await run(org.client, "staff", header, required.map((field) => row(lookups, uniqueCode("EMP"), { [field]: "" })), true);
		expect(rows.map((r) => r.status)).toEqual(required.map(() => "ERROR"));
		required.forEach((field, i) => expect(rows[i].message).toContain(field));
	});

	test("IMP-20 an unknown department, designation, campus or employment type is named in the error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const rows = await run(org.client, "staff", header, [
			row(lookups, uniqueCode("EMP"), { department: "Nowhere Dept" }),
			row(lookups, uniqueCode("EMP"), { designation: "Nowhere Role" }),
			row(lookups, uniqueCode("EMP"), { campus: "Nowhere Campus" }),
			row(lookups, uniqueCode("EMP"), { employmentType: "FREELANCE" }),
		], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR"]);
		["Nowhere Dept", "Nowhere Role", "Nowhere Campus", "FREELANCE"].forEach((value, i) => expect(rows[i].message).toContain(value));
	});

	test("IMP-20 department, designation and campus match regardless of letter case; the employment type too", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const rows = await run(org.client, "staff", header, [row(lookups, uniqueCode("EMP"), { department: lookups.department.toUpperCase(), designation: lookups.designation.toLowerCase(), campus: lookups.campus.toUpperCase(), employmentType: "part_time" })], true);
		expect(rows[0].status, rows[0].message).toBe("VALID");
	});

	test("IMP-20 a malformed date is a row error that is not a stack trace", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const rows = await run(org.client, "staff", header, [row(lookups, uniqueCode("EMP"), { dateOfJoining: "01/06/2020" })], true);
		expect(rows[0].status).toBe("ERROR");
		expect(rows[0].message).not.toMatch(NO_INTERNALS);
	});

	test("IMP-20 a failed row leaves no half-created person behind", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const persons = async () => ((await org.client.get("/api/v1/persons")).body as unknown[]).length;
		const before = await persons();
		const rows = await run(org.client, "staff", header, [row(lookups, uniqueCode("EMP"), { department: "Nowhere Dept" })]);
		expect(rows[0].status).toBe("ERROR");
		expect(await persons()).toBe(before);
	});

	test("IMP-20 a staff member imported by hand shows in the export with the same code", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const lookups = await staffLookups(org.client);
		const code = uniqueCode("EMP");
		const real = await run(org.client, "staff", header, [row(lookups, code)]);
		(await org.client.get("/api/v1/hr/staff/{id}", { params: { id: real[0].id as number } })).expectStatus(200).expectJson((staff) => expect(JSON.stringify(staff)).toContain(code));
	});
});

test.describe("vehicles and routes import and export", () => {
	const header = entity("vehicles-routes").templateHeaders;
	const row = (campus: string, over: Partial<Record<string, string>> = {}) => {
		const v: Record<string, string> = { campus, registrationNumber: uniqueCode("KA01"), vehicleType: "BUS", capacity: "40", driverName: "", attendantName: "", routeName: "", routeCode: "", ...over };
		return header.map((h) => v[h] ?? "").join(",");
	};
	const campusOf = async (client: ApiClient) => ((await client.get("/api/v1/campuses")).body as { name: string }[])[0].name;
	const vehicles = async (client: ApiClient) => (await client.get("/api/v1/transport/vehicles/export")).body as { id: number; registrationNumber: string; vehicleType: string; capacity: number; campusName: string; status: string }[];

	test("IMP-21 a vehicle row is created and exported with its campus, type and capacity; a dry run creates nothing", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const reg = uniqueCode("KA01");
		expect((await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg, vehicleType: "van", capacity: "12" })], true))[0].status).toBe("VALID");
		expect(await vehicles(org.client)).toHaveLength(0);
		const real = await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg, vehicleType: "van", capacity: "12" })]);
		expect(real[0]).toMatchObject({ status: "IMPORTED", id: expect.any(Number) });
		expect(await vehicles(org.client)).toEqual([expect.objectContaining({ id: real[0].id, registrationNumber: reg, vehicleType: "VAN", capacity: 12, campusName: campus })]);
		expectShape((await vehicles(org.client))[0], { id: "number", registrationNumber: "string", vehicleType: "string", capacity: "number", campusName: "string", status: "string" });
	});

	test("IMP-21 a row with a route creates the vehicle and the route together", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const code = uniqueCode("RT");
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { routeName: "North loop", routeCode: code })]);
		expect(rows[0]).toMatchObject({ status: "IMPORTED" });
		expect(rows[0].message).toMatch(/route/i);
		(await org.client.get("/api/v1/transport/routes")).expectStatus(200).expectJson((routes) => expect(routes.map((r: { code: string }) => r.code)).toContain(code));
	});

	test("IMP-21 a new route can be attached to a vehicle that already exists", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const reg = uniqueCode("KA01");
		await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg })]);
		const code = uniqueCode("RT");
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg, routeName: "Late loop", routeCode: code })]);
		expect(rows[0].status).toBe("IMPORTED");
		expect(rows[0].message).toMatch(/attached/i);
		expect(await vehicles(org.client)).toHaveLength(1);
	});

	test("IMP-21 a registration number that exists (no route) and a route code that exists are duplicates", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const reg = uniqueCode("KA01");
		const code = uniqueCode("RT");
		await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg, routeName: "R", routeCode: code })]);
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { registrationNumber: reg.toLowerCase() }), row(campus, { routeName: "Again", routeCode: code.toLowerCase() })], true);
		expect(rows.map((r) => r.status)).toEqual(["DUPLICATE", "DUPLICATE"]);
	});

	test("IMP-21 a route name without a route code (or the reverse) is refused", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { routeName: "Only name" }), row(campus, { routeCode: uniqueCode("RT") })], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR"]);
		expect(rows[0].message).toMatch(/both/i);
	});

	test("IMP-21 required columns, an unknown campus, a bad vehicle type and a bad capacity each fail only their own row, in plain words", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const rows = await run(org.client, "vehicles-routes", header, [
			row(campus, { registrationNumber: "" }),
			row("Nowhere Campus"),
			row(campus, { vehicleType: "SPACESHIP" }),
			row(campus, { capacity: "forty" }),
			row(campus, { capacity: "" }),
			row(campus),
		], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR", "ERROR", "VALID"]);
		expect(rows[0].message).toContain("registrationNumber");
		expect(rows[1].message).toContain("Nowhere Campus");
		expect(rows[2].message, "names the bad value without leaking the enum class").toContain("SPACESHIP");
		for (const r of rows.slice(0, 5)) expect(r.message).not.toMatch(NO_INTERNALS);
	});

	test("IMP-21 an unknown driver is skipped with a note rather than failing the row", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { driverName: "Nobody Atall" })]);
		expect(rows[0].status).toBe("IMPORTED");
		expect(rows[0].message).toMatch(/Nobody Atall.*not found/);
	});

	test("IMP-21 a driver who exists is attached to the vehicle", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = await campusOf(org.client);
		const first = `Dev${uniqueSuffix()}`;
		const person = await org.client.post("/api/v1/persons", { body: { firstName: first, lastName: "Driver", dateOfBirth: "1980-01-01", gender: "MALE" } });
		person.expectStatus([200, 201]);
		const rows = await run(org.client, "vehicles-routes", header, [row(campus, { driverName: `${first} Driver` })]);
		expect(rows[0].status).toBe("IMPORTED");
		expect(rows[0].message).not.toMatch(/not found/);
		(await org.client.get("/api/v1/transport/vehicles/export")).expectJson((list) => expect(list[0].driverName).toContain(first));
	});
});

test.describe("inventory items import and export", () => {
	const header = entity("inventory-items").templateHeaders;
	const row = (category: string, code: string, over: Partial<Record<string, string>> = {}) => {
		const v: Record<string, string> = { category, code, name: `Item ${code}`, unit: "ream", description: "from csv", reorderLevel: "20", ...over };
		return header.map((h) => v[h] ?? "").join(",");
	};
	const items = async (client: ApiClient) => (await client.get(`${INV}/items/export`)).body as { id: number; categoryName: string; code: string; name: string; unit: string; description: string | null; reorderLevel: number | null; status: string }[];

	test("IMP-22 a dry run creates nothing; a real import creates the item in its category", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const code = uniqueCode("ITM");
		expect((await run(org.client, "inventory-items", header, [row(category.name, code)], true))[0].status).toBe("VALID");
		expect(await items(org.client)).toHaveLength(0);
		const real = await run(org.client, "inventory-items", header, [row(category.name, code)]);
		expect(real[0]).toMatchObject({ status: "IMPORTED", id: expect.any(Number) });
		expect(await items(org.client)).toEqual([expect.objectContaining({ id: real[0].id, categoryName: category.name, code, unit: "ream", description: "from csv", reorderLevel: 20 })]);
		expectShape((await items(org.client))[0], { id: "number", categoryName: "string", code: "string", name: "string", unit: "string", status: "string" });
	});

	test("IMP-22 description and reorder level are optional", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const code = uniqueCode("ITM");
		const rows = await run(org.client, "inventory-items", header, [row(category.name, code, { description: "", reorderLevel: "" })]);
		expect(rows[0].status).toBe("IMPORTED");
		expect((await items(org.client))[0]).toMatchObject({ code, reorderLevel: null });
	});

	test("IMP-22 an item code that exists is a duplicate whatever its case, and the original is untouched", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const code = uniqueCode("ITM");
		const first = await run(org.client, "inventory-items", header, [row(category.name, code)]);
		const again = await run(org.client, "inventory-items", header, [row(category.name, code.toLowerCase(), { name: "Changed", unit: "box" })]);
		expect(again[0]).toMatchObject({ status: "DUPLICATE", id: first[0].id });
		expect((await items(org.client))[0]).toMatchObject({ name: `Item ${code}`, unit: "ream" });
	});

	test("IMP-22 the same code twice in one file: first created, second a duplicate", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const code = uniqueCode("ITM");
		const rows = await run(org.client, "inventory-items", header, [row(category.name, code), row(category.name, code)]);
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED", "DUPLICATE"]);
	});

	test("IMP-22 required columns and an unknown category fail only their row; the category matches regardless of case", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const rows = await run(org.client, "inventory-items", header, [
			row(category.name, ""),
			row(category.name, uniqueCode("ITM"), { name: "" }),
			row(category.name, uniqueCode("ITM"), { unit: "" }),
			row("", uniqueCode("ITM")),
			row("No such category", uniqueCode("ITM")),
			row(category.name.toUpperCase(), uniqueCode("ITM")),
		], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR", "ERROR", "VALID"]);
		expect(rows[0].message).toContain("code");
		expect(rows[1].message).toContain("name");
		expect(rows[2].message).toContain("unit");
		expect(rows[3].message).toContain("category");
		expect(rows[4].message).toContain("No such category");
		for (const r of rows.slice(0, 5)) expect(r.message).not.toMatch(NO_INTERNALS);
	});

	test("IMP-22 a reorder level that is not a number is reported by the dry run, so the preview does not promise a row that then fails", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const line = row(category.name, uniqueCode("ITM"), { reorderLevel: "plenty" });
		const dry = await run(org.client, "inventory-items", header, [line], true);
		const real = await run(org.client, "inventory-items", header, [line]);
		expect(real[0].status, "a real import refuses the row").toBe("ERROR");
		expect(real[0].message).not.toMatch(NO_INTERNALS);
		expect(dry[0].status, `dry run said: ${dry[0].message}`).toBe("ERROR");
	});

	test("IMP-22 a negative reorder level is refused", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const category = await createItemCategory(org.client);
		const rows = await run(org.client, "inventory-items", header, [row(category.name, uniqueCode("ITM"), { reorderLevel: "-5" })]);
		expect(rows[0].status, `real import said: ${rows[0].message}`).toBe("ERROR");
	});
});

test.describe("fee structures import and export", () => {
	const header = entity("fee-structures").templateHeaders;

	/** A year + class with a fee group, and a fee category to put structures under. */
	async function setup(request: Parameters<typeof createOtherOrganisation>[0], calls: Parameters<typeof createOtherOrganisation>[1]) {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false, markCurrent: false });
		const group = await createGroup(org.client, base.yearId, base.classId);
		const year = ((await org.client.get("/api/v1/academic-years")).body as { id: number; name: string }[]).find((y) => y.id === base.yearId)!.name;
		const klass = ((await org.client.get("/api/v1/school-classes")).body as { id: number; displayName: string }[]).find((c) => c.id === base.classId)!.displayName;
		const category = async () => {
			const made = await createFeeCategory(org.client);
			made.res.expectStatus([200, 201]);
			return made.name;
		};
		const row = (feeCategory: string, over: Partial<Record<string, string>> = {}) => {
			const v: Record<string, string> = { academicYear: year, className: klass, feeCategory, amount: "10000.00", installmentDueDate: "2100-06-15", paymentFrequency: "ONE_SHOT", ...over };
			return header.map((h) => v[h] ?? "").join(",");
		};
		const structures = async () => (await org.client.get(`${FEES}/structures/export`)).body as { id: number; academicYear: string; className: string; feeCategory: string; amount: number; paymentFrequency: string; status: string }[];
		return { org, base, group, year, klass, category, row, structures };
	}

	test("IMP-23 a dry run creates nothing; a real import creates the structure with one installment for the full amount", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const name = await s.category();
		expect((await run(s.org.client, "fee-structures", header, [s.row(name)], true))[0].status).toBe("VALID");
		expect(await s.structures()).toHaveLength(0);
		const real = await run(s.org.client, "fee-structures", header, [s.row(name)]);
		expect(real[0]).toMatchObject({ status: "IMPORTED", id: expect.any(Number) });
		expect(await s.structures()).toEqual([expect.objectContaining({ id: real[0].id, academicYear: s.year, className: s.klass, feeCategory: name, amount: 10000, paymentFrequency: "ONE_SHOT" })]);
		(await s.org.client.get(`${FEES}/structures/{structureId}`, { params: { structureId: real[0].id as number } })).expectStatus(200).expectJson((structure) => {
			expect(structure.amount).toBe(10000);
			expect(structure.installments).toEqual([expect.objectContaining({ installmentNumber: 1, dueDate: "2100-06-15", amount: 10000 })]);
		});
	});

	test("IMP-23 a blank payment frequency defaults to MONTHLY; the frequency is case-insensitive", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const rows = await run(s.org.client, "fee-structures", header, [s.row(await s.category(), { paymentFrequency: "" }), s.row(await s.category(), { paymentFrequency: "half_yearly" })]);
		expect(rows.map((r) => r.status)).toEqual(["IMPORTED", "IMPORTED"]);
		expect((await s.structures()).map((x) => x.paymentFrequency).sort()).toEqual(["HALF_YEARLY", "MONTHLY"]);
	});

	test("IMP-23 a fee category already in the group is a duplicate and the amount is not changed", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const name = await s.category();
		await run(s.org.client, "fee-structures", header, [s.row(name)]);
		const again = await run(s.org.client, "fee-structures", header, [s.row(name.toUpperCase(), { amount: "99999" })]);
		expect(again[0].status).toBe("DUPLICATE");
		expect(await s.structures()).toEqual([expect.objectContaining({ amount: 10000 })]);
	});

	test("IMP-23 an unknown year, class, category or a class with no fee group is named in the error", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const name = await s.category();
		const otherClass = await s.org.client.post("/api/v1/school-classes", { body: { academicYearId: s.base.yearId, campusId: s.base.campusId, gradeLevelId: (await s.org.client.post("/api/v1/grade-levels", { body: { name: `G${uniqueSuffix()}`, sequenceOrder: Math.floor(Math.random() * 1e9) + 1, stage: "PRIMARY" } })).body.id, displayName: `NoGroup ${uniqueSuffix()}` } });
		otherClass.expectStatus([200, 201]);
		const rows = await run(s.org.client, "fee-structures", header, [
			s.row(name, { academicYear: "1999-2000" }),
			s.row(name, { className: "Nowhere class" }),
			s.row("Nowhere category"),
			s.row(name, { className: otherClass.body.displayName }),
		], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR"]);
		["1999-2000", "Nowhere class", "Nowhere category", otherClass.body.displayName].forEach((value, i) => expect(rows[i].message).toContain(value));
		expect(rows[3].message).toMatch(/fee structure/i);
	});

	test("IMP-23 a bad amount, due date or frequency fails its own row with a readable message", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const rows = await run(s.org.client, "fee-structures", header, [
			s.row(await s.category(), { amount: "ten thousand" }),
			s.row(await s.category(), { amount: "" }),
			s.row(await s.category(), { installmentDueDate: "15/06/2100" }),
			s.row(await s.category(), { installmentDueDate: "" }),
			s.row(await s.category(), { paymentFrequency: "FORTNIGHTLY" }),
			s.row(await s.category()),
		], true);
		expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR", "ERROR", "VALID"]);
		expect(rows[0].message).toContain("amount");
		expect(rows[2].message).toMatch(/yyyy-MM-dd/);
		expect(rows[4].message).toContain("FORTNIGHTLY");
		for (const r of rows.slice(0, 5)) expect(r.message).not.toMatch(NO_INTERNALS);
	});

	test("IMP-23 a zero or negative amount is refused, in the dry run and the real import", async ({ request, calls }) => {
		const s = await setup(request, calls);
		const lines = [s.row(await s.category(), { amount: "0" }), s.row(await s.category(), { amount: "-500" })];
		const dry = await run(s.org.client, "fee-structures", header, lines, true);
		const real = await run(s.org.client, "fee-structures", header, lines);
		expect(real.map((r) => r.status), `real import said: ${real.map((r) => r.message).join(" | ")}`).toEqual(["ERROR", "ERROR"]);
		expect(await s.structures(), "no zero or negative structure was created").toHaveLength(0);
		expect(dry.map((r) => r.status), `dry run said: ${dry.map((r) => r.message).join(" | ")}`).toEqual(["ERROR", "ERROR"]);
	});

	test("IMP-23 the export has the documented columns", async ({ request, calls }) => {
		const s = await setup(request, calls);
		await run(s.org.client, "fee-structures", header, [s.row(await s.category())]);
		(await s.org.client.get(`${FEES}/structures/export`)).expectStatus(200).expectJson((rows) => {
			expectShape(rows[0], { id: "number", academicYear: "string", className: "string", feeCategory: "string", amount: "number", paymentFrequency: "string", status: "string" });
			expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(entity("fee-structures").exportColumns));
		});
	});
});
