import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { uniqueCode } from "../../../src/api/data";
import { PAGE_SHAPE, expectShape } from "../../../src/api/shapes";

const STUDENT_SHAPE = { id: "number", personId: "number", admissionNumber: "string", admissionDate: "string", status: "string" } as const;

async function newPerson(api: ApiClient): Promise<number> {
	const res = await api.post("/api/v1/persons", { body: { firstName: "Api", lastName: uniqueCode("Stu"), dateOfBirth: "2014-03-02", gender: "MALE" } });
	res.expectStatus([200, 201]);
	return res.body.id;
}

async function admit(api: ApiClient, extra: Record<string, unknown> = {}) {
	const admissionNumber = uniqueCode("API");
	const res = await api.post("/api/v1/students", {
		body: { personId: await newPerson(api), admissionNumber, admissionDate: "2026-06-01", ...extra },
	});
	return { res, admissionNumber };
}

test.describe("POST /api/v1/students", () => {
	test("admits a student and returns the created record", async ({ api }) => {
		const { res, admissionNumber } = await admit(api, { previousSchool: "Old School" });
		res.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, STUDENT_SHAPE);
			expect(body.admissionNumber).toBe(admissionNumber);
			expect(body.status).toBe("ADMITTED");
		});
	});

	test("rejects a request without personId", async ({ api }) => {
		(await api.post("/api/v1/students", { body: { admissionNumber: uniqueCode("API"), admissionDate: "2026-06-01" } })).expectStatus(400);
	});

	test("rejects a request without admissionDate", async ({ api }) => {
		(await api.post("/api/v1/students", { body: { personId: await newPerson(api), admissionNumber: uniqueCode("API") } })).expectStatus(400);
	});

	test("rejects a personId that does not exist", async ({ api }) => {
		(await api.post("/api/v1/students", { body: { personId: 99999999, admissionNumber: uniqueCode("API"), admissionDate: "2026-06-01" } })).expectStatus([400, 404]);
	});

	test("rejects a duplicate admission number", async ({ api }) => {
		const { admissionNumber } = await admit(api);
		const second = await api.post("/api/v1/students", { body: { personId: await newPerson(api), admissionNumber, admissionDate: "2026-06-01" } });
		second.expectStatus([400, 409]);
	});

	test("requires authentication", async ({ anon }) => {
		(await anon.post("/api/v1/students", { body: { personId: 1, admissionNumber: "x", admissionDate: "2026-06-01" } })).expectStatus(401);
	});

	for (const role of ["readOnlyStaff", "noPermissions"] as const) {
		test(`is forbidden for ${role} (no STUDENT_MANAGE)`, async ({ as }) => {
			(await as(role).post("/api/v1/students", { body: { personId: 1, admissionNumber: "x", admissionDate: "2026-06-01" } })).expectStatus(403);
		});
	}
});

test.describe("GET /api/v1/students", () => {
	test("lists students including the seeded one", async ({ api, seed }) => {
		const res = await api.get("/api/v1/students");
		res.expectStatus(200).expectJson((body) => {
			expect(Array.isArray(body)).toBe(true);
			expect(body.map((s: { id: number }) => s.id)).toContain(seed.studentId);
		});
	});

	test("is allowed for read-only staff and forbidden without STUDENT_VIEW", async ({ as }) => {
		(await as("readOnlyStaff").get("/api/v1/students")).expectStatus(200);
		(await as("noPermissions").get("/api/v1/students")).expectStatus(403);
	});

	test("requires authentication", async ({ anon }) => {
		(await anon.get("/api/v1/students")).expectStatus(401);
	});
});

test.describe("GET /api/v1/students/search", () => {
	test("returns a page envelope with list-row fields", async ({ api }) => {
		const res = await api.get("/api/v1/students/search", { query: { size: 5 } });
		res.expectStatus(200).expectJson((body) => {
			expectShape(body, PAGE_SHAPE);
			expect(body.content.length).toBeGreaterThan(0);
			expectShape(body.content[0], { id: "number", firstName: "string", lastName: "string", admissionNumber: "string", status: "string" });
		});
	});

	test("filters by search text", async ({ api }) => {
		const { admissionNumber } = await admit(api);
		const res = await api.get("/api/v1/students/search", { query: { search: admissionNumber } });
		res.expectStatus(200).expectJson((body) => {
			expect(body.totalElements).toBe(1);
			expect(body.content[0].admissionNumber).toBe(admissionNumber);
		});
	});

	test("filters by section: the seeded enrolled student is found", async ({ api, seed }) => {
		const res = await api.get("/api/v1/students/search", { query: { sectionId: seed.sectionId } });
		res.expectStatus(200).expectJson((body) => expect(body.content.map((s: { id: number }) => s.id)).toContain(seed.studentId));
	});

	test("an invalid status filter is a client error, not a 500", async ({ api }) => {
		(await api.get("/api/v1/students/search", { query: { status: "NOT_A_STATUS" } })).expectStatus([400, 422]);
	});

	test("respects page size", async ({ api }) => {
		const res = await api.get("/api/v1/students/search", { query: { size: 1 } });
		res.expectStatus(200).expectJson((body) => expect(body.content.length).toBeLessThanOrEqual(1));
	});
});

test.describe("GET /api/v1/students/{studentId}", () => {
	test("returns the student", async ({ api, seed }) => {
		const res = await api.get("/api/v1/students/{studentId}", { params: { studentId: seed.studentId } });
		res.expectStatus(200).expectJson((body) => {
			expectShape(body, STUDENT_SHAPE);
			expect(body.id).toBe(seed.studentId);
		});
	});

	test("an unknown id returns 404, not a 500", async ({ api }) => {
		(await api.get("/api/v1/students/{studentId}", { params: { studentId: 99999999 } })).expectStatus(404);
	});

	test("requires authentication", async ({ anon, seed }) => {
		(await anon.get("/api/v1/students/{studentId}", { params: { studentId: seed.studentId } })).expectStatus(401);
	});
});

test.describe("PATCH /api/v1/students/{studentId}", () => {
	test("updates mutable admission fields and persists them", async ({ api }) => {
		const { res: created } = await admit(api);
		const id = created.body.id;
		(await api.patch("/api/v1/students/{studentId}", { params: { studentId: id }, body: { remarks: "updated by automation", bloodGroup: "O+" } }))
			.expectStatus(200)
			.expectJson((body) => expect(body.remarks).toBe("updated by automation"));
		(await api.get("/api/v1/students/{studentId}", { params: { studentId: id } }))
			.expectStatus(200)
			.expectJson((body) => {
				expect(body.remarks).toBe("updated by automation");
				expect(body.bloodGroup).toBe("O+");
			});
	});

	test("an unknown id returns 404", async ({ api }) => {
		(await api.patch("/api/v1/students/{studentId}", { params: { studentId: 99999999 }, body: { remarks: "x" } })).expectStatus(404);
	});

	test("is forbidden for read-only staff", async ({ as, seed }) => {
		(await as("readOnlyStaff").patch("/api/v1/students/{studentId}", { params: { studentId: seed.studentId }, body: { remarks: "x" } })).expectStatus(403);
	});
});

test.describe("POST /api/v1/students/{studentId}/enrollments", () => {
	test("enrolls an admitted student into a section", async ({ api, seed }) => {
		const { res: created } = await admit(api);
		const res = await api.post("/api/v1/students/{studentId}/enrollments", {
			params: { studentId: created.body.id },
			body: { academicYearId: seed.academicYearId, sectionId: seed.sectionId, rollNumber: 100 + Math.floor(Math.random() * 800), enrolledDate: "2026-06-01" },
		});
		res.expectStatus([200, 201]).expectJson((body) => expect(body.sectionId).toBe(seed.sectionId));
	});

	test("is forbidden for read-only staff", async ({ as, seed }) => {
		const res = await as("readOnlyStaff").post("/api/v1/students/{studentId}/enrollments", {
			params: { studentId: seed.studentId },
			body: { academicYearId: seed.academicYearId, sectionId: seed.sectionId, rollNumber: 999, enrolledDate: "2026-06-01" },
		});
		res.expectStatus(403);
	});
});

test.describe("GET /api/v1/students/{studentId}/enrollments", () => {
	test("lists the seeded student's current enrollment", async ({ api, seed }) => {
		const res = await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId: seed.studentId } });
		res.expectStatus(200).expectJson((body) => {
			expect(body.map((e: { id: number }) => e.id)).toContain(seed.studentEnrollmentId);
		});
	});
});

test.describe("GET /api/v1/students/export", () => {
	test("returns every student for permitted roles only", async ({ api, as }) => {
		(await api.get("/api/v1/students/export")).expectStatus(200).expectJson((body) => expect(Array.isArray(body)).toBe(true));
		(await as("noPermissions").get("/api/v1/students/export")).expectStatus(403);
	});
});
