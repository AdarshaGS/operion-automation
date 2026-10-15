import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { uniqueCode } from "../../../src/api/data";
import { expectShape } from "../../../src/api/shapes";
import type { SeedData } from "../../../src/setup/session";

async function createCategory(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const code = uniqueCode("CAT");
	const res = await api.post("/api/v1/fees/categories", { body: { code, name: `Category ${code}`, description: "automation", categoryType: "GENERAL", ...overrides } });
	return { res, code };
}

async function createGroup(api: ApiClient, seed: SeedData) {
	// A (year, class) pair holds one active group; reuse if the seeded one exists.
	const existing = await api.get("/api/v1/fees/structure-groups", { query: { academicYearId: seed.academicYearId, schoolClassId: seed.classId } });
	if (existing.ok && Array.isArray(existing.body) && existing.body.length > 0) return existing.body[0];
	const res = await api.post("/api/v1/fees/structure-groups", { body: { name: uniqueCode("Group"), academicYearId: seed.academicYearId, schoolClassId: seed.classId } });
	res.expectStatus([200, 201]);
	return res.body;
}

async function createStructure(api: ApiClient, seed: SeedData, amount = 1200) {
	const group = await createGroup(api, seed);
	const category = (await createCategory(api)).res;
	category.expectStatus([200, 201]);
	const res = await api.post("/api/v1/fees/structures", {
		body: {
			feeStructureGroupId: group.id,
			feeCategoryId: category.body.id,
			amount,
			paymentFrequency: "MONTHLY",
			installments: [{ installmentNumber: 1, dueDate: "2026-07-10", amount }],
		},
	});
	res.expectStatus([200, 201]);
	return res.body;
}

test.describe("POST /api/v1/fees/categories", () => {
	test("creates a category", async ({ api }) => {
		const { res, code } = await createCategory(api);
		res.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", code: "string", name: "string", status: "string", categoryType: "string" });
			expect(body.code).toBe(code);
		});
	});

	test("rejects a duplicate code", async ({ api }) => {
		const { code } = await createCategory(api);
		const dup = await api.post("/api/v1/fees/categories", { body: { code, name: "Dup", categoryType: "GENERAL" } });
		dup.expectStatus([400, 409]);
	});

	test("rejects a category without a name", async ({ api }) => {
		(await api.post("/api/v1/fees/categories", { body: { code: uniqueCode("CAT"), categoryType: "GENERAL" } })).expectStatus(400);
	});

	test("rejects an unknown category type", async ({ api }) => {
		(await createCategory(api, { categoryType: "NOT_A_TYPE" })).res.expectStatus(400);
	});

	test("requires authentication", async ({ anon }) => {
		(await anon.post("/api/v1/fees/categories", { body: { code: "x", name: "x" } })).expectStatus(401);
	});

	for (const role of ["readOnlyStaff", "noPermissions"] as const) {
		test(`is forbidden for ${role} (no FEE_CATEGORY_MANAGE)`, async ({ as }) => {
			(await createCategory(as(role))).res.expectStatus(403);
		});
	}
});

test.describe("GET /api/v1/fees/categories", () => {
	test("lists categories including a newly created one", async ({ api }) => {
		const { code } = await createCategory(api);
		(await api.get("/api/v1/fees/categories")).expectStatus(200).expectJson((body) => expect(body.map((c: { code: string }) => c.code)).toContain(code));
	});

	test("is allowed for fees collector and forbidden without FEE_VIEW", async ({ as }) => {
		(await as("feesCollector").get("/api/v1/fees/categories")).expectStatus(200);
		(await as("noPermissions").get("/api/v1/fees/categories")).expectStatus(403);
	});

	test("requires authentication", async ({ anon }) => {
		(await anon.get("/api/v1/fees/categories")).expectStatus(401);
	});
});

test.describe("fee structures", () => {
	test("POST /api/v1/fees/structures creates a structure with its installments", async ({ api, seed }) => {
		const structure = await createStructure(api, seed, 1500);
		expectShape(structure, { id: "number", feeStructureGroupId: "number", feeCategoryId: "number", amount: "number", status: "string", installments: "array" });
		expect(structure.installments).toHaveLength(1);
		expect(structure.installments[0].amount).toBe(1500);
	});

	test("POST /api/v1/fees/structures rejects a missing group", async ({ api, seed }) => {
		const category = (await createCategory(api)).res;
		const res = await api.post("/api/v1/fees/structures", {
			body: { feeStructureGroupId: 99999999, feeCategoryId: category.body.id, amount: 100, installments: [{ installmentNumber: 1, dueDate: "2026-07-10", amount: 100 }] },
		});
		res.expectStatus([400, 404]);
	});

	test("POST /api/v1/fees/structures is forbidden for a fees collector (no FEE_STRUCTURE_MANAGE)", async ({ as, seed }) => {
		const res = await as("feesCollector").post("/api/v1/fees/structures", { body: { feeStructureGroupId: 1, feeCategoryId: 1, amount: 1, installments: [] } });
		res.expectStatus(403);
	});

	test("GET /api/v1/fees/structures lists a group's structures", async ({ api, seed }) => {
		const structure = await createStructure(api, seed);
		const res = await api.get("/api/v1/fees/structures", { query: { feeStructureGroupId: structure.feeStructureGroupId } });
		res.expectStatus(200).expectJson((body) => expect(body.map((s: { id: number }) => s.id)).toContain(structure.id));
	});

	test("GET /api/v1/fees/structures requires the group id", async ({ api }) => {
		(await api.get("/api/v1/fees/structures")).expectStatus(400);
	});

	test("GET /api/v1/fees/structures/{structureId} returns the structure", async ({ api, seed }) => {
		const structure = await createStructure(api, seed);
		(await api.get("/api/v1/fees/structures/{structureId}", { params: { structureId: structure.id } }))
			.expectStatus(200)
			.expectJson((body) => expect(body.id).toBe(structure.id));
	});

	test("GET /api/v1/fees/structures/{structureId} returns 404 for an unknown id", async ({ api }) => {
		(await api.get("/api/v1/fees/structures/{structureId}", { params: { structureId: 99999999 } })).expectStatus(404);
	});
});

test.describe("fee collection journey: assign -> invoice -> pay", () => {
	test("assigns a structure, generates an invoice and records a payment that settles it", async ({ api, seed }) => {
		const structure = await createStructure(api, seed, 2000);

		const assignment = await api.post("/api/v1/fees/assignments", {
			body: { studentEnrollmentId: seed.studentEnrollmentId, feeStructureId: structure.id, paymentFrequency: "MONTHLY" },
		});
		assignment.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", baseAmount: "number", effectiveAmount: "number", status: "string" });
			expect(body.baseAmount).toBe(2000);
			expect(body.effectiveAmount).toBe(2000);
		});

		(await api.get("/api/v1/fees/assignments/{assignmentId}", { params: { assignmentId: assignment.body.id } }))
			.expectStatus(200)
			.expectJson((body) => expect(body.id).toBe(assignment.body.id));

		const invoice = await api.post("/api/v1/fees/assignments/{assignmentId}/invoices", {
			params: { assignmentId: assignment.body.id },
			body: { feeStructureInstallmentId: structure.installments[0].id },
		});
		invoice.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", invoiceNumber: "string", totalAmount: "number", amountPaid: "number", outstanding: "number", status: "string" });
			expect(body.totalAmount).toBe(2000);
			expect(body.outstanding).toBe(2000);
		});

		const payment = await api.post("/api/v1/fees/payments", {
			body: {
				academicYearId: seed.academicYearId,
				amount: 2000,
				paymentMethod: "CASH",
				paymentDate: "2026-07-05",
				allocations: [{ invoiceId: invoice.body.id, amount: 2000 }],
			},
		});
		payment.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", receiptNumber: "string", amount: "number", status: "string" });
			expect(body.amount).toBe(2000);
		});

		(await api.get("/api/v1/fees/invoices/{invoiceId}", { params: { invoiceId: invoice.body.id } }))
			.expectStatus(200)
			.expectJson((body) => {
				expect(body.amountPaid).toBe(2000);
				expect(body.outstanding).toBe(0);
			});
		(await api.get("/api/v1/fees/payments/{paymentId}", { params: { paymentId: payment.body.id } }))
			.expectStatus(200)
			.expectJson((body) => expect(body.receiptNumber).toBe(payment.body.receiptNumber));
	});

	test("a payment cannot allocate more than an invoice's outstanding amount", async ({ api, seed }) => {
		const structure = await createStructure(api, seed, 500);
		const assignment = await api.post("/api/v1/fees/assignments", { body: { studentEnrollmentId: seed.studentEnrollmentId, feeStructureId: structure.id, paymentFrequency: "MONTHLY" } });
		assignment.expectStatus([200, 201]);
		const invoice = await api.post("/api/v1/fees/assignments/{assignmentId}/invoices", {
			params: { assignmentId: assignment.body.id },
			body: { feeStructureInstallmentId: structure.installments[0].id },
		});
		invoice.expectStatus([200, 201]);
		const payment = await api.post("/api/v1/fees/payments", {
			body: { academicYearId: seed.academicYearId, amount: 900, paymentMethod: "CASH", paymentDate: "2026-08-05", allocations: [{ invoiceId: invoice.body.id, amount: 900 }] },
		});
		payment.expectStatus([400, 409, 422]);
	});

	test("recording a payment is forbidden for read-only staff (no FEE_COLLECT)", async ({ as, seed }) => {
		const res = await as("readOnlyStaff").post("/api/v1/fees/payments", {
			body: { academicYearId: seed.academicYearId, amount: 1, paymentMethod: "CASH", paymentDate: "2026-07-05", allocations: [] },
		});
		res.expectStatus(403);
	});

	test("assigning a fee is forbidden for read-only staff (no FEE_ASSIGNMENT_MANAGE)", async ({ as, seed }) => {
		(await as("readOnlyStaff").post("/api/v1/fees/assignments", { body: { studentEnrollmentId: seed.studentEnrollmentId, feeStructureId: 1 } })).expectStatus(403);
	});
});

test.describe("fee read endpoints", () => {
	test("GET /api/v1/fees/invoices lists a student's invoices", async ({ api, seed }) => {
		(await api.get("/api/v1/fees/invoices", { query: { studentEnrollmentId: seed.studentEnrollmentId } })).expectStatus(200).expectJson((body) => expect(Array.isArray(body)).toBe(true));
	});

	test("GET /api/v1/fees/invoices without its required parameter is a client error, not a 500", async ({ api }) => {
		(await api.get("/api/v1/fees/invoices")).expectStatus(400);
	});

	test("GET /api/v1/fees/invoices/overdue lists overdue invoices", async ({ api }) => {
		(await api.get("/api/v1/fees/invoices/overdue")).expectStatus(200).expectJson((body) => expect(Array.isArray(body)).toBe(true));
	});

	test("GET /api/v1/fees/invoices/{invoiceId} returns 404 for an unknown id", async ({ api }) => {
		(await api.get("/api/v1/fees/invoices/{invoiceId}", { params: { invoiceId: 99999999 } })).expectStatus(404);
	});

	test("GET /api/v1/fees/payments lists a student's payment history", async ({ api, seed }) => {
		(await api.get("/api/v1/fees/payments", { query: { studentEnrollmentId: seed.studentEnrollmentId } })).expectStatus(200).expectJson((body) => expect(Array.isArray(body)).toBe(true));
	});

	test("GET /api/v1/fees/assignments lists a student's assignments", async ({ api, seed }) => {
		(await api.get("/api/v1/fees/assignments", { query: { studentEnrollmentId: seed.studentEnrollmentId } })).expectStatus(200).expectJson((body) => expect(Array.isArray(body)).toBe(true));
	});

	test("fee reads are forbidden without FEE_VIEW", async ({ as, seed }) => {
		for (const path of ["/api/v1/fees/invoices", "/api/v1/fees/payments", "/api/v1/fees/assignments"]) {
			(await as("noPermissions").get(path, { query: { studentEnrollmentId: seed.studentEnrollmentId } })).expectStatus(403);
		}
	});

	test("fee reads require authentication", async ({ anon, seed }) => {
		(await anon.get("/api/v1/fees/invoices", { query: { studentEnrollmentId: seed.studentEnrollmentId } })).expectStatus(401);
	});
});
