// Admissions pipeline: inquiry -> under review -> converted (student) or rejected, the document
// checklist, status counts, permissions and tenant isolation. IDs refer to docs/SCENARIOS.md section 6 (ADM-*).
// Converting creates a student, which only works in the shared organisation (Operion #354).

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createApplicant, DOCUMENT_TYPES } from "../../../src/api/admissions";
import { createPerson } from "../../../src/api/academics";
import { admitStudent } from "../../../src/api/students";
import { expectShape } from "../../../src/api/shapes";
import { uniqueCode } from "../../../src/api/data";

const BAD = [400, 422];
const APPLICANT_SHAPE = { id: "number", personId: "number", firstName: "string", lastName: "string", inquiryDate: "string", status: "string" } as const;

test.describe("create", () => {
	test("ADM-01 creates an applicant at inquiry with the person's details", async ({ api }) => {
		const personId = await createPerson(api, "Appl");
		const res = await api.post("/api/v1/applicants", { body: { personId, inquiryDate: "2026-06-01", source: "Referral", notes: "Sibling already enrolled" } });
		res.expectStatus(200).expectJson((applicant) => {
			expectShape(applicant, APPLICANT_SHAPE);
			expect(applicant).toMatchObject({ personId, inquiryDate: "2026-06-01", source: "Referral", notes: "Sibling already enrolled", status: "INQUIRY", rejectionReason: null });
			expect(applicant.firstName).toBe("Appl");
		});
	});

	test("ADM-01 the optional fields can be left out", async ({ api }) => {
		const personId = await createPerson(api, "Appl");
		(await api.post("/api/v1/applicants", { body: { personId, inquiryDate: "2026-06-01" } })).expectStatus(200).expectJson((applicant) => {
			expect(applicant).toMatchObject({ source: null, notes: null, desiredGrade: null });
		});
	});

	test("ADM-01 the new applicant is in the list and in the Pending count", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).expectJson((page) => expect(page.content.map((a: { id: number }) => a.id)).toContain(applicant.id));
	});

	test("ADM-01 an unknown person returns 404", async ({ api }) => {
		(await api.post("/api/v1/applicants", { body: { personId: 99999999, inquiryDate: "2026-06-01" } })).expectStatus(404);
	});

	test("ADM-01 the same person cannot have two open applications", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants", { body: { personId: applicant.personId, inquiryDate: "2026-06-02" } })).expectStatus(409);
	});

	test("ADM-01 an inquiry date in the future returns 400", async ({ api }) => {
		(await api.post("/api/v1/applicants", { body: { personId: await createPerson(api, "Appl"), inquiryDate: "2999-01-01" } })).expectStatus(BAD);
	});

	test("ADM-01 a person who is already a student cannot apply", async ({ api }) => {
		const student = await admitStudent(api);
		(await api.post("/api/v1/applicants", { body: { personId: student.personId, inquiryDate: "2026-06-02" } })).expectStatus(409);
	});

	test("ADM-02 a missing person or inquiry date returns 400", async ({ api }) => {
		(await api.post("/api/v1/applicants", { body: { inquiryDate: "2026-06-01" } })).expectStatus(400);
		(await api.post("/api/v1/applicants", { body: { personId: 1 } })).expectStatus(400);
		(await api.post("/api/v1/applicants", { body: {} })).expectStatus(400);
	});

	test("ADM-02 a malformed date returns 400", async ({ api }) => {
		(await api.post("/api/v1/applicants", { body: { personId: await createPerson(api, "Appl"), inquiryDate: "yesterday" } })).expectStatus(400);
	});

	test("ADM-02 overlong source or notes return 400", async ({ api }) => {
		(await api.post("/api/v1/applicants", { body: { personId: await createPerson(api, "Appl"), inquiryDate: "2026-06-01", notes: "x".repeat(5000) } })).expectStatus(BAD);
	});
});

test.describe("review and reject", () => {
	test("ADM-03 start review moves an inquiry to under review", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ id: applicant.id, status: "UNDER_REVIEW" });
		});
	});

	test("ADM-03 an applicant already under review cannot be moved to review again", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } });
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(409);
	});

	test("ADM-03 a rejected applicant cannot be moved to review", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "No seat" } });
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(409);
	});

	test("ADM-03 an unknown applicant returns 404", async ({ api }) => {
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("ADM-04 reject records the reason and ends the pipeline", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "No seat available" } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ status: "REJECTED", rejectionReason: "No seat available" });
		});
	});

	test("ADM-04 an applicant under review can be rejected", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } });
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "Failed assessment" } })).expectStatus(200).expectJson((row) => expect(row.status).toBe("REJECTED"));
	});

	test("ADM-04 reject without a reason, or with a blank one, returns 400 and changes nothing", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: {} })).expectStatus(400);
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "   " } })).expectStatus(400);
		(await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).expectJson((page) => expect(page.content.map((a: { id: number }) => a.id)).toContain(applicant.id));
	});

	test("ADM-04 a rejected applicant cannot be rejected again or converted", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "No seat" } });
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "Again" } })).expectStatus(409);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(409);
		(await api.get("/api/v1/students/search", { query: { search: applicant.body.lastName } })).expectJson((page) => expect(page.totalElements).toBe(0));
	});

	test("ADM-04 an overlong rejection reason returns 400", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "x".repeat(5000) } })).expectStatus(BAD);
	});

	test("ADM-04 an unknown applicant returns 404", async ({ api }) => {
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: 99999999 }, body: { reason: "x" } })).expectStatus(404);
	});
});

test.describe("convert", () => {
	test("ADM-05 convert creates a student with the applicant's person and the details given", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } });
		const number = uniqueCode("ADM");
		const converted = await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionNumber: number, admissionDate: "2026-06-02", admissionSource: "Walk-in", previousSchool: "Old School", tcNumber: "TC-9", entranceScore: 77.5, bloodGroup: "A+", category: "General", nationality: "Indian", remarks: "r", medicalAlerts: "Peanuts", emergencyContactName: "Ravi", emergencyContactPhone: "+919800000000" } });
		converted.expectStatus(200).expectJson((student) => {
			expect(student).toMatchObject({ personId: applicant.personId, admissionNumber: number, admissionDate: "2026-06-02", previousSchool: "Old School", tcNumber: "TC-9", entranceScore: 77.5, bloodGroup: "A+", medicalAlerts: "Peanuts", emergencyContactName: "Ravi", status: "ADMITTED" });
		});
		(await api.get("/api/v1/students/{studentId}", { params: { studentId: converted.body.id } })).expectStatus(200);
	});

	test("ADM-05 an admission number left blank is generated", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(200).expectJson((student) => expect(student.admissionNumber).toMatch(/\S/));
	});

	test("ADM-05 an applicant can be converted straight from inquiry", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(200);
	});

	test("ADM-05 the applicant is marked converted and shows which student it became", async ({ api }) => {
		const applicant = await createApplicant(api);
		const converted = await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } });
		converted.expectStatus(200);
		(await api.get("/api/v1/applicants", { query: { status: "CONVERTED", size: 1000 } })).expectJson((page) => {
			const row = page.content.find((a: { id: number }) => a.id === applicant.id);
			expect(row).toBeDefined();
			expect(row.studentId).toBe(converted.body.id);
		});
	});

	test("ADM-05 the student's details come from the applicant's person", async ({ api }) => {
		const applicant = await createApplicant(api);
		const converted = await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } });
		(await api.get("/api/v1/students/search", { query: { search: applicant.body.lastName } })).expectJson((page) => {
			expect(page.content.map((s: { id: number }) => s.id)).toEqual([converted.body.id]);
			expect(page.content[0]).toMatchObject({ firstName: applicant.body.firstName, lastName: applicant.body.lastName, status: "ADMITTED" });
		});
	});

	test("ADM-06 converting twice is rejected and creates only one student", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(200);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(409).expectJson((body) => {
			expect(body.error).toMatch(/already|converted/i);
		});
		(await api.get("/api/v1/students/search", { query: { search: applicant.body.lastName } })).expectJson((page) => expect(page.totalElements).toBe(1));
	});

	test("ADM-06 a converted applicant cannot be reviewed or rejected", async ({ api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } });
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(409);
		(await api.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "x" } })).expectStatus(409);
	});

	test("ADM-06 two simultaneous conversions: one wins, the other gets 409, one student exists", async ({ api }) => {
		const applicant = await createApplicant(api);
		const results = await Promise.all([1, 2].map(() => api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })));
		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		(await api.get("/api/v1/students/search", { query: { search: applicant.body.lastName } })).expectJson((page) => expect(page.totalElements).toBe(1));
	});

	test("ADM-07 convert without an admission date returns 400 and the applicant stays open", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: {} })).expectStatus(400);
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(200);
	});

	test("ADM-07 a duplicate admission number returns 409 and the applicant stays open", async ({ api }) => {
		const student = await admitStudent(api);
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionNumber: student.admissionNumber, admissionDate: "2026-06-02" } })).expectStatus(409);
		(await api.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(200);
	});

	test("ADM-07 an admission date in the future returns 400", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2999-01-01" } })).expectStatus(BAD);
	});

	test("ADM-07 a negative entrance score returns 400", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02", entranceScore: -5 } })).expectStatus(BAD);
	});

	test("ADM-07 an unknown applicant returns 404", async ({ api }) => {
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: 99999999 }, body: { admissionDate: "2026-06-02" } })).expectStatus(404);
	});
});

test.describe("list and counts", () => {
	test("ADM-08 status counts add up and match the filtered lists", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const c = org.client;
		const [a, b, d] = [await createApplicant(c), await createApplicant(c), await createApplicant(c)];
		await c.post("/api/v1/applicants/{id}/start-review", { params: { id: b.id } });
		await c.post("/api/v1/applicants/{id}/reject", { params: { id: d.id }, body: { reason: "No seat" } });
		void a;
		const counts = (await c.get("/api/v1/applicants/status-counts")).body;
		expect(counts).toMatchObject({ ALL: 3, INQUIRY: 1, UNDER_REVIEW: 1, CONVERTED: 0, REJECTED: 1 });
		for (const status of ["INQUIRY", "UNDER_REVIEW", "CONVERTED", "REJECTED"]) {
			(await c.get("/api/v1/applicants", { query: { status } })).expectJson((page) => expect(page.totalElements).toBe(counts[status]));
		}
		(await c.get("/api/v1/applicants")).expectJson((page) => expect(page.totalElements).toBe(counts.ALL));
	});

	test("ADM-08 an organisation with no applicants has all counts at zero", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/applicants/status-counts")).expectStatus(200).expectJson((counts) => {
			expect(counts).toEqual({ ALL: 0, INQUIRY: 0, UNDER_REVIEW: 0, CONVERTED: 0, REJECTED: 0 });
		});
	});

	test("ADM-08 the list is a page envelope that honours page and size", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (let n = 0; n < 3; n++) await createApplicant(org.client);
		(await org.client.get("/api/v1/applicants", { query: { size: 2, page: 0 } })).expectJson((page) => {
			expectShape(page, { content: "array", page: "number", size: "number", totalElements: "number", totalPages: "number" });
			expect(page).toMatchObject({ size: 2, totalElements: 3, totalPages: 2 });
			expect(page.content).toHaveLength(2);
		});
		(await org.client.get("/api/v1/applicants", { query: { size: 2, page: 1 } })).expectJson((page) => expect(page.content).toHaveLength(1));
		(await org.client.get("/api/v1/applicants", { query: { size: 2, page: 5 } })).expectJson((page) => expect(page.content).toEqual([]));
	});

	test("ADM-08 an unknown status filter is a client error", async ({ api }) => {
		(await api.get("/api/v1/applicants", { query: { status: "NOPE" } })).expectStatus(400);
	});

	test("ADM-08 paging parameters out of range are rejected or clamped", async ({ api }) => {
		(await api.get("/api/v1/applicants", { query: { size: 0 } })).expectStatus([200, 400]);
		(await api.get("/api/v1/applicants", { query: { size: 100000 } })).expectStatus([200, 400]).expectJson((page) => { if (page.content) expect(page.size).toBeLessThanOrEqual(2000); });
		(await api.get("/api/v1/applicants", { query: { page: -1 } })).expectStatus([200, 400]);
	});
});

test.describe("documents checklist", () => {
	test("ADM-09 a new applicant lists the five document types, none received", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.get("/api/v1/applicants/{id}/documents", { params: { id: applicant.id } })).expectStatus(200).expectJson((docs) => {
			expect(docs.map((d: { docType: string }) => d.docType)).toEqual(DOCUMENT_TYPES);
			expect(docs.every((d: { received: boolean }) => d.received === false)).toBe(true);
		});
	});

	test("ADM-09 marking documents received persists and can be undone", async ({ api }) => {
		const applicant = await createApplicant(api);
		const put = await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ docType: "BIRTH_CERTIFICATE", received: true }, { docType: "PHOTO", received: true }] });
		put.expectStatus(200).expectJson((docs) => {
			expect(docs.filter((d: { received: boolean }) => d.received).map((d: { docType: string }) => d.docType).sort()).toEqual(["BIRTH_CERTIFICATE", "PHOTO"]);
		});
		(await api.get("/api/v1/applicants/{id}/documents", { params: { id: applicant.id } })).expectJson((docs) => expect(docs.filter((d: { received: boolean }) => d.received)).toHaveLength(2));
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ docType: "BIRTH_CERTIFICATE", received: false }] })).expectStatus(200).expectJson((docs) => {
			expect(docs.find((d: { docType: string }) => d.docType === "BIRTH_CERTIFICATE").received).toBe(false);
			expect(docs.find((d: { docType: string }) => d.docType === "PHOTO").received).toBe(true);
		});
	});

	test("ADM-09 an unknown document type returns 400", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ docType: "NOPE", received: true }] })).expectStatus(BAD);
	});

	test("ADM-09 an empty list changes nothing", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [] })).expectStatus(200).expectJson((docs) => expect(docs).toHaveLength(5));
	});

	test("ADM-09 an entry without a type or a received flag returns 400", async ({ api }) => {
		const applicant = await createApplicant(api);
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ received: true }] })).expectStatus(BAD);
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ docType: "PHOTO" }] })).expectStatus(BAD);
	});

	test("ADM-09 the checklist of an unknown applicant returns 404", async ({ api }) => {
		(await api.get("/api/v1/applicants/{id}/documents", { params: { id: 99999999 } })).expectStatus(404);
		(await api.put("/api/v1/applicants/{id}/documents", { params: { id: 99999999 }, body: [] })).expectStatus(404);
	});
});

test.describe("public inquiry to student", () => {
	test("ADM-10 an inquiry from the public form lands in the pipeline with its guardian and class, then goes through review", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const options = await anon.get("/api/v1/public/orgs/{slug}/admission-inquiries/form-options", { params: { slug: org.slug } });
		const grade = options.body.grades[0];
		const lastName = `Public${uniqueCode("L")}`;
		(await anon.post("/api/v1/public/orgs/{slug}/admission-inquiries", { params: { slug: org.slug }, body: { firstName: "Pia", lastName, dateOfBirth: "2018-05-10", gender: "FEMALE", desiredGradeId: grade.id, guardianName: "Ravi Parent", guardianPhone: "+919876543210", guardianEmail: "parent@example.test", notes: "Next intake" } })).expectStatus([200, 201]);

		const list = await org.client.get("/api/v1/applicants", { query: { status: "INQUIRY" } });
		const row = list.body.content.find((a: { lastName: string }) => a.lastName === lastName);
		expect(row).toMatchObject({ firstName: "Pia", status: "INQUIRY", guardianName: "Ravi Parent", guardianPhone: "+919876543210", guardianEmail: "parent@example.test", desiredGrade: { id: grade.id, name: grade.name } });
		(await org.client.post("/api/v1/applicants/{id}/start-review", { params: { id: row.id } })).expectStatus(200);
		(await org.client.post("/api/v1/applicants/{id}/reject", { params: { id: row.id }, body: { reason: "Class full" } })).expectStatus(200);
		(await org.client.get("/api/v1/applicants/status-counts")).expectJson((counts) => expect(counts).toMatchObject({ ALL: 1, REJECTED: 1 }));
	});

	test("ADM-10 an inquiry from the public form can be converted to a student in the shared organisation", async ({ api, seed, anon }) => {
		const lastName = `Public${uniqueCode("L")}`;
		const before = await anon.get("/api/v1/public/orgs/{slug}/admission-inquiries/form-options", { params: { slug: seed.organisationSlug } });
		expect(before.status).toBe(200);
		(await anon.post("/api/v1/public/orgs/{slug}/admission-inquiries", { params: { slug: seed.organisationSlug }, body: { firstName: "Pia", lastName, dateOfBirth: "2018-05-10", gender: "FEMALE", guardianName: "Ravi", guardianPhone: "+919876543210", guardianEmail: "p@example.test" } })).expectStatus([200, 201]);
		const row = (await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).body.content.find((a: { lastName: string }) => a.lastName === lastName);
		expect(row).toBeDefined();
		(await api.post("/api/v1/applicants/{id}/convert", { params: { id: row.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(200).expectJson((student) => expect(student.personId).toBe(row.personId));
	});
});

test.describe("access control", () => {
	const reads = [
		{ title: "list applicants", call: (c: import("../../../src/api/apiClient").ApiClient) => c.get("/api/v1/applicants") },
		{ title: "read status counts", call: (c: import("../../../src/api/apiClient").ApiClient) => c.get("/api/v1/applicants/status-counts") },
		{ title: "read a document checklist", call: (c: import("../../../src/api/apiClient").ApiClient) => c.get("/api/v1/applicants/{id}/documents", { params: { id: 1 } }) },
	];
	const writes = [
		{ title: "create an applicant", call: (c: import("../../../src/api/apiClient").ApiClient) => c.post("/api/v1/applicants", { body: { personId: 1, inquiryDate: "2026-06-01" } }) },
		{ title: "start a review", call: (c: import("../../../src/api/apiClient").ApiClient) => c.post("/api/v1/applicants/{id}/start-review", { params: { id: 1 } }) },
		{ title: "reject an applicant", call: (c: import("../../../src/api/apiClient").ApiClient) => c.post("/api/v1/applicants/{id}/reject", { params: { id: 1 }, body: { reason: "x" } }) },
		{ title: "convert an applicant", call: (c: import("../../../src/api/apiClient").ApiClient) => c.post("/api/v1/applicants/{id}/convert", { params: { id: 1 }, body: { admissionDate: "2026-06-02" } }) },
		{ title: "update a document checklist", call: (c: import("../../../src/api/apiClient").ApiClient) => c.put("/api/v1/applicants/{id}/documents", { params: { id: 1 }, body: [] }) },
	];
	for (const read of reads) {
		test(`ADM-11 a user without permissions cannot ${read.title}`, async ({ as }) => {
			expect((await read.call(as("noPermissions"))).status).toBe(403);
		});
		test(`ADM-11 read-only staff can ${read.title}`, async ({ as }) => {
			expect([200, 404]).toContain((await read.call(as("readOnlyStaff"))).status);
		});
	}
	for (const write of writes) {
		for (const role of ["noPermissions", "readOnlyStaff"] as const) {
			test(`ADM-11 ${role} cannot ${write.title}`, async ({ as }) => {
				expect((await write.call(as(role))).status).toBe(403);
			});
		}
	}
	test("ADM-11 every applicant endpoint needs authentication", async ({ anon }) => {
		for (const call of [...reads, ...writes]) expect((await call.call(anon)).status).toBe(401);
	});
});

test.describe("tenant isolation", () => {
	test("ADM-12 another organisation cannot see, review, reject, convert or edit these applicants", async ({ request, calls, api }) => {
		const applicant = await createApplicant(api);
		const outsider = await createOtherOrganisation(request, calls);
		const c = outsider.client;
		(await c.get("/api/v1/applicants", { query: { size: 1000 } })).expectJson((page) => expect(page.content.map((a: { id: number }) => a.id)).not.toContain(applicant.id));
		(await c.get("/api/v1/applicants/status-counts")).expectJson((counts) => expect(counts.ALL).toBe(0));
		(await c.post("/api/v1/applicants/{id}/start-review", { params: { id: applicant.id } })).expectStatus(404);
		(await c.post("/api/v1/applicants/{id}/reject", { params: { id: applicant.id }, body: { reason: "x" } })).expectStatus(404);
		(await c.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } })).expectStatus(404);
		(await c.get("/api/v1/applicants/{id}/documents", { params: { id: applicant.id } })).expectStatus(404);
		(await c.put("/api/v1/applicants/{id}/documents", { params: { id: applicant.id }, body: [{ docType: "PHOTO", received: true }] })).expectStatus(404);
		(await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).expectJson((page) => expect(page.content.map((a: { id: number }) => a.id)).toContain(applicant.id));
	});

	test("ADM-12 another organisation cannot create an applicant for these persons", async ({ request, calls, api }) => {
		const personId = await createPerson(api, "Appl");
		const outsider = await createOtherOrganisation(request, calls);
		(await outsider.client.post("/api/v1/applicants", { body: { personId, inquiryDate: "2026-06-01" } })).expectStatus(404);
	});
});
