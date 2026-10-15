// Fee structure groups, structures, installments, one-shot discount and the structure CSV import/export.
// IDs refer to docs/SCENARIOS.md section 9 (FEE-*). Each scenario builds its own draft-year class in the
// shared organisation (Operion #354), so reruns never collide on the one-group-per-(year, class) rule.

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { createCategory, createGroup, createStructure, installments, assign, FEES, feeSetup } from "../../../src/api/fees";
import { expectShape } from "../../../src/api/shapes";

const csv = (name: string, content: string) => ({ file: { name, mimeType: "text/csv", buffer: Buffer.from(content) } });

test.describe("structure groups", () => {
	test("FEE-06 creates a group for a year and class, reads it back by id and in the list", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		expectShape(group, { id: "number", name: "string", academicYearId: "number", schoolClassId: "number", status: "string" });
		expect(group.status).toBe("ACTIVE");
		(await api.get(`${FEES}/structure-groups/{groupId}`, { params: { groupId: group.id } })).expectStatus(200).expectJson((body) => expect(body.id).toBe(group.id));
		(await api.get(`${FEES}/structure-groups`, { query: { academicYearId: s.yearId, schoolClassId: s.base.classId } }))
			.expectStatus(200)
			.expectJson((list) => expect(list.map((g: { id: number }) => g.id)).toContain(group.id));
	});

	test("FEE-06 listing needs both the academic year and the class", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get(`${FEES}/structure-groups`, { query: { academicYearId: s.yearId } })).expectStatus(400);
		(await api.get(`${FEES}/structure-groups`, { query: { schoolClassId: s.base.classId } })).expectStatus(400);
	});

	test("FEE-06 a year and class pair holds only one group", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await createGroup(api, s.yearId, s.base.classId);
		(await api.post(`${FEES}/structure-groups`, { body: { name: "Second", academicYearId: s.yearId, schoolClassId: s.base.classId } })).expectStatus(409);
	});

	test("FEE-06 a group without a name returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(`${FEES}/structure-groups`, { body: { academicYearId: s.yearId, schoolClassId: s.base.classId } })).expectStatus(400);
	});

	test("FEE-06 a group for an unknown class or year returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(`${FEES}/structure-groups`, { body: { name: "x", academicYearId: s.yearId, schoolClassId: 99999999 } })).expectStatus(404);
		(await api.post(`${FEES}/structure-groups`, { body: { name: "x", academicYearId: 99999999, schoolClassId: s.base.classId } })).expectStatus(404);
	});

	test("FEE-06 an unknown group id returns 404", async ({ api }) => {
		(await api.get(`${FEES}/structure-groups/{groupId}`, { params: { groupId: 99999999 } })).expectStatus(404);
	});

	test("FEE-06 creating a group needs FEE_STRUCTURE_MANAGE; reading needs FEE_VIEW", async ({ api, as }) => {
		const s = await attendanceSetup(api, 1);
		const body = { name: "x", academicYearId: s.yearId, schoolClassId: s.base.classId };
		(await as("feesCollector").post(`${FEES}/structure-groups`, { body })).expectStatus(403);
		(await as("noPermissions").get(`${FEES}/structure-groups`, { query: { academicYearId: s.yearId, schoolClassId: s.base.classId } })).expectStatus(403);
		(await as("feesCollector").get(`${FEES}/structure-groups`, { query: { academicYearId: s.yearId, schoolClassId: s.base.classId } })).expectStatus(200);
	});
});

test.describe("structures and installments", () => {
	test("FEE-07 a three-installment structure keeps its installments in order and their amounts add up", async ({ api }) => {
		const s = await feeSetup(api, { students: 1, count: 3, each: 1000 });
		expect(s.structure.amount).toBe(3000);
		expect(s.structure.installments.map((i) => i.installmentNumber)).toEqual([1, 2, 3]);
		expect(s.structure.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(3000);
	});

	test("FEE-08 installments that do not add up to the amount return 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await api.post(`${FEES}/structures`, { body: { feeStructureGroupId: group.id, feeCategoryId: category.res.body.id, amount: 3000, installments: installments(s, 2, 1000), paymentFrequency: "MONTHLY" } })).expectStatus(400);
	});

	test("FEE-08 a structure with no installments returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await api.post(`${FEES}/structures`, { body: { feeStructureGroupId: group.id, feeCategoryId: category.res.body.id, amount: 100, installments: [], paymentFrequency: "MONTHLY" } })).expectStatus(400);
	});

	test("FEE-08 a body without the installments field returns 400, not 500", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await api.post(`${FEES}/structures`, { body: { feeStructureGroupId: group.id, feeCategoryId: category.res.body.id, amount: 100 } })).expectStatus(400);
	});

	test("FEE-08 a negative structure amount returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await createStructure(api, group.id, category.res.body.id, [{ installmentNumber: 1, dueDate: s.day(10), amount: -5 }])).expectStatus(400);
	});

	test("FEE-08 a zero structure amount returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await createStructure(api, group.id, category.res.body.id, [{ installmentNumber: 1, dueDate: s.day(10), amount: 0 }])).expectStatus(400);
	});

	test("FEE-08 two installments with the same number return 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const twin = [{ installmentNumber: 1, dueDate: s.day(10), amount: 5 }, { installmentNumber: 1, dueDate: s.day(11), amount: 5 }];
		const res = await createStructure(api, group.id, category.res.body.id, twin);
		res.expectStatus(400);
		expect(JSON.stringify(res.body)).not.toMatch(/conflicts with an existing/i);
	});

	test("FEE-08 one category can appear only once in a group", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await createStructure(api, group.id, category.res.body.id, installments(s, 1, 100))).expectStatus([200, 201]);
		(await createStructure(api, group.id, category.res.body.id, installments(s, 1, 100))).expectStatus(409);
	});

	test("FEE-08 a structure for an unknown category returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		(await createStructure(api, group.id, 99999999, installments(s, 1, 100))).expectStatus(404);
	});

	test("FEE-08 the list of structures for an unknown group is empty or 404, never a server error", async ({ api }) => {
		const res = await api.get(`${FEES}/structures`, { query: { feeStructureGroupId: 99999999 } });
		expect([200, 404]).toContain(res.status);
	});

	test("FEE-13 each payment frequency is stored and returned", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		for (const frequency of ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ONE_SHOT"]) {
			const category = await createCategory(api);
			const res = await createStructure(api, group.id, category.res.body.id, installments(s, 1, 100), { paymentFrequency: frequency });
			res.expectStatus([200, 201]).expectJson((body) => expect(body.paymentFrequency).toBe(frequency));
		}
	});

	test("FEE-13 an unknown payment frequency returns 400 without naming a Java class", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const res = await createStructure(api, group.id, category.res.body.id, installments(s, 1, 100), { paymentFrequency: "WEEKLY" });
		res.expectStatus(400);
		expect(JSON.stringify(res.body)).not.toMatch(/com\.operion|enum constant/i);
	});

	test("FEE-13 an omitted payment frequency defaults to MONTHLY", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const res = await api.post(`${FEES}/structures`, { body: { feeStructureGroupId: group.id, feeCategoryId: category.res.body.id, amount: 100, installments: installments(s, 1, 100) } });
		res.expectStatus([200, 201]).expectJson((body) => expect(body.paymentFrequency).toBe("MONTHLY"));
	});
});

test.describe("one-shot discount", () => {
	test("FEE-14 a one-shot discount is stored on the structure", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const res = await createStructure(api, group.id, category.res.body.id, installments(s, 1, 1200), { paymentFrequency: "ONE_SHOT", oneShotDiscountAmount: 200 });
		res.expectStatus([200, 201]).expectJson((body) => expect(body.oneShotDiscountAmount).toBe(200));
		(await api.get(`${FEES}/structures/{structureId}`, { params: { structureId: res.body.id } })).expectStatus(200).expectJson((body) => expect(body.oneShotDiscountAmount).toBe(200));
	});

	test("FEE-14 the one-shot discount is a suggestion only: an assignment without a discount bills the full amount", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const structure = (await createStructure(api, group.id, category.res.body.id, installments(s, 1, 1200), { paymentFrequency: "ONE_SHOT", oneShotDiscountAmount: 200 })).expectStatus([200, 201]).body;
		const assignment = await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: structure.id, paymentFrequency: "ONE_SHOT" } });
		assignment.expectStatus([200, 201]).expectJson((body) => {
			expect(body.discountAmount).toBe(0);
			expect(body.effectiveAmount).toBe(1200);
		});
	});

	test("FEE-14 applying the one-shot discount at assignment lowers the invoice to the discounted amount", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const structure = (await createStructure(api, group.id, category.res.body.id, installments(s, 1, 1200), { paymentFrequency: "ONE_SHOT", oneShotDiscountAmount: 200 })).expectStatus([200, 201]).body;
		const approvers = (await api.get(`${FEES}/approvers`)).expectStatus(200).body;
		const assignment = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: structure.id, paymentFrequency: "ONE_SHOT", discountAmount: 200, discountReason: "Pays in full", approvedBy: approvers[0].userId } })).expectStatus([200, 201]).body;
		expect(assignment.effectiveAmount).toBe(1000);
		const invoice = await api.post(`${FEES}/assignments/{assignmentId}/invoices`, { params: { assignmentId: assignment.id }, body: { feeStructureInstallmentId: structure.installments[0].id } });
		invoice.expectStatus([200, 201]).expectJson((body) => {
			expect(body.totalAmount).toBe(1000);
			expect(body.outstanding).toBe(1000);
		});
	});

	test("FEE-14 a one-shot discount larger than the structure amount returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await createStructure(api, group.id, category.res.body.id, installments(s, 1, 1200), { paymentFrequency: "ONE_SHOT", oneShotDiscountAmount: 5000 })).expectStatus(400);
	});

	test("FEE-14 a negative one-shot discount returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		(await createStructure(api, group.id, category.res.body.id, installments(s, 1, 1200), { oneShotDiscountAmount: -5 })).expectStatus(400);
	});
});

test.describe("import and export of structures", () => {
	test("FEE-15 the export lists a new structure with the names an admin recognises", async ({ api }) => {
		const s = await feeSetup(api, { students: 1, count: 1, each: 800 });
		const res = await api.get(`${FEES}/structures/export`);
		res.expectStatus(200).expectJson((rows) => {
			const mine = rows.find((r: { id: number }) => r.id === s.structure.id);
			expect(mine).toMatchObject({ academicYear: s.yearName, className: s.className, feeCategory: s.category.name, amount: 800, paymentFrequency: "MONTHLY", status: "ACTIVE" });
		});
	});

	test("FEE-15 a validate-only import reports the row as valid and creates nothing", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const content = `academicYear,className,feeCategory,amount,installmentDueDate,paymentFrequency\n${s.yearName},${s.className},${category.name},900,${s.day(5)},QUARTERLY\n`;
		const checked = await api.post(`${FEES}/structures/import`, { query: { validateOnly: true }, multipart: csv("s.csv", content) });
		checked.expectStatus(200).expectJson((rows) => expect(rows[0]).toMatchObject({ row: 2, status: "VALID" }));
		const exported = (await api.get(`${FEES}/structures/export`)).body as { feeCategory: string }[];
		expect(exported.map((r) => r.feeCategory)).not.toContain(category.name);
	});

	test("FEE-15 an import creates the structure with one installment, and a repeat is reported as a duplicate", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const content = `academicYear,className,feeCategory,amount,installmentDueDate,paymentFrequency\n${s.yearName},${s.className},${category.name},900,${s.day(5)},QUARTERLY\n`;
		const first = await api.post(`${FEES}/structures/import`, { multipart: csv("s.csv", content) });
		first.expectStatus(200).expectJson((rows) => expect(rows[0]).toMatchObject({ status: "IMPORTED", id: expect.any(Number) }));
		(await api.get(`${FEES}/structures/{structureId}`, { params: { structureId: first.body[0].id } })).expectStatus(200).expectJson((body) => {
			expect(body.amount).toBe(900);
			expect(body.paymentFrequency).toBe("QUARTERLY");
			expect(body.installments).toHaveLength(1);
		});
		const again = await api.post(`${FEES}/structures/import`, { multipart: csv("s.csv", content) });
		again.expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("DUPLICATE"));
	});

	test("FEE-15 rows with an unknown category, year, class or bad amount are reported per row", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const header = "academicYear,className,feeCategory,amount,installmentDueDate,paymentFrequency\n";
		const rows = [
			`${s.yearName},${s.className},No Such Category,900,${s.day(5)},MONTHLY`,
			`No Such Year,${s.className},${category.name},900,${s.day(5)},MONTHLY`,
			`${s.yearName},No Such Class,${category.name},900,${s.day(5)},MONTHLY`,
			`${s.yearName},${s.className},${category.name},not-a-number,${s.day(5)},MONTHLY`,
			`${s.yearName},${s.className},${category.name},900,not-a-date,MONTHLY`,
		].join("\n");
		const res = await api.post(`${FEES}/structures/import`, { query: { validateOnly: true }, multipart: csv("s.csv", header + rows) });
		res.expectStatus(200).expectJson((result) => {
			expect(result).toHaveLength(5);
			for (const row of result) expect(row.status).toBe("ERROR");
		});
	});

	test("FEE-15 an import with no file returns 400, not 500", async ({ api }) => {
		(await api.post(`${FEES}/structures/import`, {})).expectStatus(400);
	});

	test("FEE-15 importing needs FEE_STRUCTURE_MANAGE; exporting needs FEE_VIEW", async ({ as }) => {
		(await as("feesCollector").post(`${FEES}/structures/import`, { multipart: csv("s.csv", "academicYear\n") })).expectStatus(403);
		(await as("feesCollector").get(`${FEES}/structures/export`)).expectStatus(200);
		(await as("noPermissions").get(`${FEES}/structures/export`)).expectStatus(403);
	});

	test("FEE-15 import and export need a sign-in", async ({ anon }) => {
		(await anon.get(`${FEES}/structures/export`)).expectStatus(401);
		(await anon.post(`${FEES}/structures/import`, { multipart: csv("s.csv", "x\n") })).expectStatus(401);
	});
});
