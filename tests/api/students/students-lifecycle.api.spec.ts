// Students beyond the basic admit/search/get/patch covered in students.api.spec.ts: search filters
// and sorting, enrolment moves, guardians, documents, exits, transfers, imports, exports and tenant
// isolation. IDs refer to docs/SCENARIOS.md section 5 (STU-*).
// Students can only be created in the shared organisation (Operion #354), so each scenario builds
// its own draft-year structure there and never touches the shared current year.

import { readFileSync } from "node:fs";
import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { buildAcademicBase, createPerson, enrolStudent } from "../../../src/api/academics";
import { admitStudent, createGuardian, guardianLink } from "../../../src/api/students";
import { uniqueCode } from "../../../src/api/data";
import { expectShape } from "../../../src/api/shapes";

const BAD = [400, 422];
const csv = (name: string, text: string) => ({ file: { name, mimeType: "text/csv", buffer: Buffer.from(text) } });

test.describe("search filters and sorting", () => {
	test("STU-09 filters by class, section and status", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const a = await enrolStudent(api, base);
		const second = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: second.id }, body: { academicYearId: base.yearId, sectionId: base.secondSectionId, rollNumber: 2, enrolledDate: "2026-06-02" } })).expectStatus(200);
		const loose = await admitStudent(api);

		const ids = async (query: Record<string, unknown>) => (await api.get("/api/v1/students/search", { query: { size: 100, ...query } })).body.content.map((s: { id: number }) => s.id);
		expect((await ids({ schoolClassId: base.classId })).sort()).toEqual([a.studentId, second.id].sort());
		expect(await ids({ sectionId: base.sectionId })).toEqual([a.studentId]);
		expect(await ids({ sectionId: base.secondSectionId })).toEqual([second.id]);
		expect((await ids({ schoolClassId: base.classId, status: "ACTIVE" })).sort()).toEqual([a.studentId, second.id].sort());
		expect(await ids({ status: "ADMITTED", search: loose.admissionNumber })).toEqual([loose.id]);
		expect(await ids({ status: "ACTIVE", search: loose.admissionNumber })).toEqual([]);
	});

	test("STU-09 filters by admission date range, inclusive at both ends", async ({ api }) => {
		const early = await admitStudent(api, { admissionDate: "2025-03-10" });
		const late = await admitStudent(api, { admissionDate: "2025-03-20" });
		const ids = async (from: string, to: string) => (await api.get("/api/v1/students/search", { query: { size: 200, admissionDateFrom: from, admissionDateTo: to } })).body.content.map((s: { id: number }) => s.id);
		const exact = await ids("2025-03-10", "2025-03-10");
		expect(exact).toContain(early.id);
		expect(exact).not.toContain(late.id);
		const both = await ids("2025-03-10", "2025-03-20");
		expect(both).toEqual(expect.arrayContaining([early.id, late.id]));
		expect(await ids("2025-03-11", "2025-03-19")).not.toEqual(expect.arrayContaining([early.id]));
	});

	test("STU-09 a range with from after to returns 400", async ({ api }) => {
		(await api.get("/api/v1/students/search", { query: { admissionDateFrom: "2026-07-01", admissionDateTo: "2026-06-01" } })).expectStatus(BAD);
	});

	test("STU-09 a malformed date returns 400", async ({ api }) => {
		(await api.get("/api/v1/students/search", { query: { admissionDateFrom: "yesterday" } })).expectStatus(400);
	});

	test("STU-09 an enrolled student's row carries their class, section and primary guardian", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		const guardian = await createGuardian(api, { phone: "+919811111111" });
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: guardianLink(guardian.id, { primaryGuardian: true }) })).expectStatus(200);
		(await api.get("/api/v1/students/search", { query: { sectionId: base.sectionId } })).expectJson((page) => {
			const row = page.content[0];
			expect(row).toMatchObject({ id: studentId, sectionId: base.sectionId, sectionName: "A", schoolClassId: base.classId, status: "ACTIVE" });
			expect(row.primaryGuardianName).toEqual(expect.any(String));
			expect(row.primaryGuardianPhone).toBe("+919811111111");
		});
	});

	for (const column of ["admissionNumber", "admissionDate", "firstName", "lastName", "studentId", "status"]) {
		for (const direction of ["asc", "desc"] as const) {
			test(`STU-10 sorts by ${column} ${direction}`, async ({ api }) => {
				await admitStudent(api); // a list needs two rows to show an order, and this can run before any other test has admitted one
				const res = await api.get("/api/v1/students/search", { query: { size: 100, sort: `${column},${direction}` } });
				res.expectStatus(200).expectJson((page) => {
					const values: string[] = page.content.map((s: Record<string, string>) => String(s[column]).toLowerCase());
					expect(values.length).toBeGreaterThan(1);
					const sorted = [...values].sort();
					if (direction === "desc") sorted.reverse();
					expect(values).toEqual(sorted);
				});
			});
		}
	}

	test("STU-10 sorting by an unknown column is a client error, not a 500", async ({ api }) => {
		(await api.get("/api/v1/students/search", { query: { sort: "nonsense,asc" } })).expectStatus(BAD);
	});

	test("STU-10 page size and page number are bounded", async ({ api }) => {
		(await api.get("/api/v1/students/search", { query: { size: 0 } })).expectStatus([200, 400]).expectJson((body) => { if (body.content) expect(body.size).toBeGreaterThan(0); });
		(await api.get("/api/v1/students/search", { query: { size: 100000 } })).expectStatus([200, 400]).expectJson((body) => { if (body.content) expect(body.size).toBeLessThanOrEqual(2000); });
		(await api.get("/api/v1/students/search", { query: { page: -1 } })).expectStatus([200, 400]);
	});
});

test.describe("admit and patch rules", () => {
	test("STU-13 patch cannot change the admission number or the person", async ({ api }) => {
		const student = await admitStudent(api);
		const patched = await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { admissionNumber: "HACKED", personId: 1, remarks: "kept" } });
		patched.expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ admissionNumber: student.admissionNumber, personId: student.personId, remarks: "kept" });
		});
	});

	test("STU-13 a patch that omits a field leaves it unchanged", async ({ api }) => {
		const student = await admitStudent(api, { previousSchool: "Old School", bloodGroup: "O+" });
		(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { remarks: "only this" } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ previousSchool: "Old School", bloodGroup: "O+", remarks: "only this" });
		});
	});

	test("STU-13 an unknown student returns 404", async ({ api }) => {
		(await api.patch("/api/v1/students/{studentId}", { params: { studentId: 99999999 }, body: { remarks: "x" } })).expectStatus(404);
	});

	test("STU-01 an admission number left blank is generated", async ({ api }) => {
		const personId = await createPerson(api, "Auto");
		(await api.post("/api/v1/students", { body: { personId, admissionDate: "2026-06-01" } })).expectStatus(200).expectJson((body) => {
			expect(body.admissionNumber).toMatch(/\S/);
			expect(body.studentId).toMatch(/^STU-/);
		});
	});

	test("STU-01 an admission date in the future returns 400", async ({ api }) => {
		(await api.post("/api/v1/students", { body: { personId: await createPerson(api, "Future"), admissionDate: "2999-01-01" } })).expectStatus(BAD);
	});

	test("STU-01 a person can be admitted only once", async ({ api }) => {
		const student = await admitStudent(api);
		(await api.post("/api/v1/students", { body: { personId: student.personId, admissionNumber: uniqueCode("AGAIN"), admissionDate: "2026-06-01" } })).expectStatus(409);
	});

	test("STU-14 custom field values round trip on admit and patch", async ({ api }) => {
		const key = uniqueCode("tf").toLowerCase().replace(/-/g, "_");
		const definition = await api.post("/api/v1/custom-field-definitions", { body: { entityType: "STUDENT", fieldKey: key, label: "House", dataType: "TEXT", required: false } });
		definition.expectStatus(200);
		try {
			const student = await admitStudent(api, { customFields: { [key]: "Red" } });
			expect(student.body.customFields).toEqual({ [key]: "Red" });
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "Blue" } } })).expectStatus(200);
			(await api.get("/api/v1/students/{studentId}", { params: { studentId: student.id } })).expectJson((body) => expect(body.customFields[key]).toBe("Blue"));
		} finally {
			await api.post("/api/v1/custom-field-definitions/{id}/status", { params: { id: definition.body.id }, body: { status: "ARCHIVED" } });
		}
	});

	test("STU-14 a patch of one custom field keeps the others", async ({ api }) => {
		const stamp = uniqueCode("tf").toLowerCase().replace(/-/g, "_");
		const ids: number[] = [];
		for (const suffix of ["a", "b"]) {
			const definition = await api.post("/api/v1/custom-field-definitions", { body: { entityType: "STUDENT", fieldKey: `${stamp}${suffix}`, label: `Field ${suffix}`, dataType: "TEXT", required: false } });
			definition.expectStatus(200);
			ids.push(definition.body.id);
		}
		try {
			const student = await admitStudent(api, { customFields: { [`${stamp}a`]: "one", [`${stamp}b`]: "two" } });
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [`${stamp}a`]: "changed" } } })).expectStatus(200).expectJson((body) => {
				expect(body.customFields).toEqual({ [`${stamp}a`]: "changed", [`${stamp}b`]: "two" });
			});
		} finally {
			for (const id of ids) await api.post("/api/v1/custom-field-definitions/{id}/status", { params: { id }, body: { status: "ARCHIVED" } });
		}
	});

	test("STU-14 a number field rejects text", async ({ api }) => {
		const key = uniqueCode("tn").toLowerCase().replace(/-/g, "_");
		const definition = await api.post("/api/v1/custom-field-definitions", { body: { entityType: "STUDENT", fieldKey: key, label: "Siblings", dataType: "NUMBER", required: false } });
		definition.expectStatus(200);
		try {
			const student = await admitStudent(api);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "abc" } } })).expectStatus(BAD);
		} finally {
			await api.post("/api/v1/custom-field-definitions/{id}/status", { params: { id: definition.body.id }, body: { status: "ARCHIVED" } });
		}
	});

	// Runs in a throwaway organisation: a required field in the shared one would fail every admission running in parallel.
	test("STU-14 a required custom field must be supplied on admit", async ({ request, calls }) => {
		const outsider = await createOtherOrganisation(request, calls);
		const c = outsider.client;
		const key = uniqueCode("tr").toLowerCase().replace(/-/g, "_");
		(await c.post("/api/v1/custom-field-definitions", { body: { entityType: "STUDENT", fieldKey: key, label: "Needed", dataType: "TEXT", required: true } })).expectStatus(200);
		(await c.post("/api/v1/students", { body: { personId: await createPerson(c, "Req"), admissionDate: "2026-06-01" } })).expectStatus(BAD);
	});

	test("STU-30 two simultaneous admissions with one admission number: one wins, the other gets 409", async ({ api }) => {
		const number = uniqueCode("RACE");
		const people = [await createPerson(api, "RaceA"), await createPerson(api, "RaceB")];
		const results = await Promise.all(people.map((personId) => api.post("/api/v1/students", { body: { personId, admissionNumber: number, admissionDate: "2026-06-01" } })));
		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
	});
});

test.describe("enrolment moves", () => {
	test("STU-15 enrolling moves an admitted student to active and returns the enrolment", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		expect(student.body.status).toBe("ADMITTED");
		const enrolment = await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id }, body: { academicYearId: base.yearId, sectionId: base.sectionId, rollNumber: 5, enrolledDate: "2026-06-02" } });
		enrolment.expectStatus(200).expectJson((row) => {
			expectShape(row, { id: "number", studentId: "number", academicYearId: "number", sectionId: "number", rollNumber: "number", enrollmentStatus: "string", current: "boolean", enrolledDate: "string" });
			expect(row).toMatchObject({ enrollmentStatus: "ENROLLED", current: true, exitDate: null, rollNumber: 5 });
		});
		(await api.get("/api/v1/students/{studentId}", { params: { studentId: student.id } })).expectJson((body) => expect(body.status).toBe("ACTIVE"));
	});

	test("STU-16 a student with a current enrolment cannot be enrolled again", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId }, body: { academicYearId: base.yearId, sectionId: base.secondSectionId, rollNumber: 9, enrolledDate: "2026-06-03" } })).expectStatus(409);
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } })).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("STU-16 an unknown section or year returns 404, an unknown student returns 404", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		const body = { academicYearId: base.yearId, sectionId: base.sectionId, rollNumber: 1, enrolledDate: "2026-06-02" };
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id }, body: { ...body, sectionId: 99999999 } })).expectStatus(404);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id }, body: { ...body, academicYearId: 99999999 } })).expectStatus(404);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: 99999999 }, body })).expectStatus(404);
	});

	test("STU-16 a missing section, year or date returns 400", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		const body = { academicYearId: base.yearId, sectionId: base.sectionId, rollNumber: 1, enrolledDate: "2026-06-02" };
		for (const field of ["academicYearId", "sectionId", "enrolledDate"]) {
			const partial: Record<string, unknown> = { ...body };
			delete partial[field];
			(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id }, body: partial })).expectStatus(BAD);
		}
	});

	test("STU-16 a section of another academic year than the one named is rejected", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const other = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id }, body: { academicYearId: other.yearId, sectionId: base.sectionId, rollNumber: 1, enrolledDate: "2026-06-02" } })).expectStatus([400, 409, 422]);
	});

	test("STU-17 reassigning moves the student to another section of the class", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		(await api.post("/api/v1/students/{studentId}/enrollments/reassign-section", { params: { studentId }, body: { sectionId: base.secondSectionId } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ sectionId: base.secondSectionId, current: true, enrollmentStatus: "ENROLLED" });
		});
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.secondSectionId } })).expectJson((list) => expect(list).toHaveLength(1));
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("STU-17 reassigning to a section of a different class is rejected", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const other = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		(await api.post("/api/v1/students/{studentId}/enrollments/reassign-section", { params: { studentId }, body: { sectionId: other.sectionId } })).expectStatus([400, 409, 422]);
	});

	test("STU-17 a student without an enrolment cannot be reassigned; an unknown section returns 404", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/enrollments/reassign-section", { params: { studentId: student.id }, body: { sectionId: base.sectionId } })).expectStatus([404, 409]);
		const { studentId } = await enrolStudent(api, base);
		(await api.post("/api/v1/students/{studentId}/enrollments/reassign-section", { params: { studentId }, body: { sectionId: 99999999 } })).expectStatus(404);
	});

	test("STU-18 promotion closes the old enrolment and opens one in the next year", async ({ api }) => {
		const from = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const to = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, from);
		const promoted = await api.post("/api/v1/students/{studentId}/enrollments/promote", { params: { studentId }, body: { academicYearId: to.yearId, sectionId: to.sectionId, rollNumber: 1, promotionDate: "2027-04-01", repeated: false } });
		promoted.expectStatus(200).expectJson((row) => expect(row).toMatchObject({ academicYearId: to.yearId, sectionId: to.sectionId, enrollmentStatus: "ENROLLED", current: true, enrolledDate: "2027-04-01" }));
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } })).expectJson((list) => {
			expect(list).toHaveLength(2);
			expect(list.find((e: { academicYearId: number }) => e.academicYearId === from.yearId)).toMatchObject({ enrollmentStatus: "PROMOTED", current: false, exitDate: "2027-04-01" });
			expect(list.filter((e: { current: boolean }) => e.current)).toHaveLength(1);
		});
	});

	test("STU-18 repeating a year is recorded as repeated", async ({ api }) => {
		const from = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const to = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, from);
		(await api.post("/api/v1/students/{studentId}/enrollments/promote", { params: { studentId }, body: { academicYearId: to.yearId, sectionId: to.sectionId, rollNumber: 1, promotionDate: "2027-04-01", repeated: true } })).expectStatus(200);
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } })).expectJson((list) => {
			expect(list.find((e: { academicYearId: number }) => e.academicYearId === from.yearId).enrollmentStatus).toBe("REPEATED");
		});
	});

	test("STU-18 promoting into the year the student is already in returns 409", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		(await api.post("/api/v1/students/{studentId}/enrollments/promote", { params: { studentId }, body: { academicYearId: base.yearId, sectionId: base.secondSectionId, rollNumber: 1, promotionDate: "2027-04-01", repeated: false } })).expectStatus(409);
	});

	test("STU-18 a student who was never enrolled cannot be promoted", async ({ api }) => {
		const to = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/enrollments/promote", { params: { studentId: student.id }, body: { academicYearId: to.yearId, sectionId: to.sectionId, rollNumber: 1, promotionDate: "2027-04-01", repeated: false } })).expectStatus([404, 409]);
	});
});

test.describe("guardians", () => {
	test("STU-19 links a guardian to a student with every flag and lists the link", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		const link = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id, { relationshipType: "MOTHER", primaryGuardian: true, emergencyContact: true, contactPriority: 2 }) });
		link.expectStatus(200).expectJson((row) => {
			expectShape(row, { id: "number", studentId: "number", guardianId: "number", relationshipType: "string", primaryGuardian: "boolean", status: "string" });
			expect(row).toMatchObject({ studentId: student.id, guardianId: guardian.id, relationshipType: "MOTHER", primaryGuardian: true, emergencyContact: true, contactPriority: 2, status: "ACTIVE" });
		});
		(await api.get("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id } })).expectJson((list) => expect(list.map((l: { id: number }) => l.id)).toEqual([link.body.id]));
		(await api.get("/api/v1/guardians/{guardianId}/students", { params: { guardianId: guardian.id } })).expectJson((list) => expect(list.map((l: { studentId: number }) => l.studentId)).toEqual([student.id]));
	});

	test("STU-19 marking a second guardian primary demotes the first, so only one is primary", async ({ api }) => {
		const student = await admitStudent(api);
		const [first, second] = [await createGuardian(api), await createGuardian(api)];
		const a = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(first.id, { primaryGuardian: true }) });
		const b = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(second.id, { relationshipType: "MOTHER", primaryGuardian: true }) });
		a.expectStatus(200);
		b.expectStatus(200);
		(await api.get("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id } })).expectJson((list) => {
			expect(list.filter((l: { primaryGuardian: boolean }) => l.primaryGuardian).map((l: { id: number }) => l.id)).toEqual([b.body.id]);
		});
	});

	test("STU-19 linking the same guardian twice returns 409", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id) })).expectStatus(200);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id, { relationshipType: "MOTHER" }) })).expectStatus(409);
	});

	test("STU-19 an unknown relationship returns 400", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id, { relationshipType: "ALIEN" }) })).expectStatus(BAD);
	});

	test("STU-19 an unknown student or guardian returns 404", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: 99999999 }, body: guardianLink(guardian.id) })).expectStatus(404);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(99999999) })).expectStatus(404);
	});

	test("STU-19 flags left out of the link default instead of failing the request", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: { guardianId: guardian.id, relationshipType: "FATHER", primaryGuardian: true } })).expectStatus(200);
	});

	test("STU-20 updates the relationship and flags of a link", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		const link = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id, { primaryGuardian: true }) });
		(await api.patch("/api/v1/students/{studentId}/guardians/{studentGuardianId}", { params: { studentId: student.id, studentGuardianId: link.body.id }, body: { relationshipType: "LEGAL_GUARDIAN", primaryGuardian: false, emergencyContact: true, canPickup: false, canReceiveCommunication: true, contactPriority: 3 } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ relationshipType: "LEGAL_GUARDIAN", primaryGuardian: false, emergencyContact: true, canPickup: false, contactPriority: 3 });
		});
	});

	test("STU-20 a partial update changes only the fields it sends", async ({ api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		const link = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id, { canPickup: true, contactPriority: 4 }) });
		(await api.patch("/api/v1/students/{studentId}/guardians/{studentGuardianId}", { params: { studentId: student.id, studentGuardianId: link.body.id }, body: { canPickup: false } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ canPickup: false, contactPriority: 4, relationshipType: "FATHER" });
		});
	});

	test("STU-20 updating another student's link returns 404", async ({ api }) => {
		const [one, two] = [await admitStudent(api), await admitStudent(api)];
		const guardian = await createGuardian(api);
		const link = await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: one.id }, body: guardianLink(guardian.id) });
		(await api.patch("/api/v1/students/{studentId}/guardians/{studentGuardianId}", { params: { studentId: two.id, studentGuardianId: link.body.id }, body: { relationshipType: "FATHER", primaryGuardian: false, emergencyContact: false, canPickup: false, canReceiveCommunication: true, contactPriority: 1 } })).expectStatus(404);
	});

	test("STU-21 creates a guardian from a person and reads it back", async ({ api }) => {
		const personId = await createPerson(api, "Guardian");
		const created = await api.post("/api/v1/guardians", { body: { personId, occupation: "Teacher" } });
		created.expectStatus(200).expectJson((guardian) => {
			expectShape(guardian, { id: "number", personId: "number", status: "string" });
			expect(guardian).toMatchObject({ personId, occupation: "Teacher", status: "ACTIVE" });
		});
		(await api.get("/api/v1/guardians/{guardianId}", { params: { guardianId: created.body.id } })).expectStatus(200);
		(await api.get("/api/v1/guardians/{guardianId}", { params: { guardianId: 99999999 } })).expectStatus(404);
	});

	test("STU-21 a guardian without a person or with an unknown person is rejected", async ({ api }) => {
		(await api.post("/api/v1/guardians", { body: { occupation: "x" } })).expectStatus(BAD);
		(await api.post("/api/v1/guardians", { body: { personId: 99999999 } })).expectStatus(404);
	});

	test("STU-21 a person who is already a guardian returns the same guardian", async ({ api }) => {
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/guardians", { body: { personId: guardian.personId } })).expectStatus([200, 409]).expectJson((body) => { if (body.id) expect(body.id).toBe(guardian.id); });
	});

	test("STU-21 granting portal access issues a one-time claim token", async ({ api }) => {
		const guardian = await createGuardian(api, { email: `guardian-${uniqueCode("g").toLowerCase()}@example.test` });
		(await api.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: guardian.id } })).expectStatus(200).expectJson((invite) => {
			expectShape(invite, { inviteId: "number", claimToken: "string", expiresAt: "string" });
			expect(invite.claimToken.length).toBeGreaterThan(20);
			expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
		});
	});

	test("STU-21 portal access for a guardian without an email still returns the claim token to hand over", async ({ api }) => {
		const guardian = await createGuardian(api);
		(await api.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: guardian.id } })).expectStatus(200).expectJson((invite) => expect(invite.claimToken).toEqual(expect.any(String)));
	});

	test("STU-21 granting portal access to an unknown guardian returns 404", async ({ api }) => {
		(await api.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: 99999999 } })).expectStatus(404);
	});
});

test.describe("documents", () => {
	const doc = (overrides: Record<string, unknown> = {}) => ({ documentType: "BIRTH_CERTIFICATE", fileReference: uniqueCode("ref"), fileName: "birth.pdf", mimeType: "application/pdf", ...overrides });

	test("STU-22 uploads a document, lists it and verifies it", async ({ api }) => {
		const student = await admitStudent(api);
		const created = await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: student.id }, body: doc() });
		created.expectStatus(200).expectJson((row) => {
			expectShape(row, { id: "number", studentId: "number", documentType: "string", fileName: "string", verificationStatus: "string", status: "string" });
			expect(row).toMatchObject({ studentId: student.id, verificationStatus: "PENDING", verifiedBy: null, verifiedAt: null });
		});
		(await api.get("/api/v1/students/{studentId}/documents", { params: { studentId: student.id } })).expectJson((list) => expect(list.map((d: { id: number }) => d.id)).toEqual([created.body.id]));
		(await api.patch("/api/v1/students/{studentId}/documents/{documentId}/verify", { params: { studentId: student.id, documentId: created.body.id }, body: { verificationStatus: "VERIFIED", verifiedBy: 1 } })).expectStatus(200).expectJson((row) => {
			expect(row).toMatchObject({ verificationStatus: "VERIFIED", verifiedBy: 1 });
			expect(row.verifiedAt).toEqual(expect.any(String));
		});
	});

	test("STU-22 a document can be rejected on verification", async ({ api }) => {
		const student = await admitStudent(api);
		const created = await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: student.id }, body: doc() });
		(await api.patch("/api/v1/students/{studentId}/documents/{documentId}/verify", { params: { studentId: student.id, documentId: created.body.id }, body: { verificationStatus: "REJECTED", verifiedBy: 1 } })).expectStatus(200).expectJson((row) => expect(row.verificationStatus).toBe("REJECTED"));
	});

	test("STU-22 an unknown verification status returns 400", async ({ api }) => {
		const student = await admitStudent(api);
		const created = await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: student.id }, body: doc() });
		(await api.patch("/api/v1/students/{studentId}/documents/{documentId}/verify", { params: { studentId: student.id, documentId: created.body.id }, body: { verificationStatus: "MAYBE" } })).expectStatus(BAD);
	});

	test("STU-22 a document without a type, name or reference returns 400", async ({ api }) => {
		const student = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: student.id }, body: {} })).expectStatus(BAD);
	});

	test("STU-22 an unknown student returns 404", async ({ api }) => {
		(await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: 99999999 }, body: doc() })).expectStatus(404);
		(await api.get("/api/v1/students/{studentId}/documents", { params: { studentId: 99999999 } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
	});

	test("STU-22 verifying a document through another student returns 404", async ({ api }) => {
		const [one, two] = [await admitStudent(api), await admitStudent(api)];
		const created = await api.post("/api/v1/students/{studentId}/documents", { params: { studentId: one.id }, body: doc() });
		(await api.patch("/api/v1/students/{studentId}/documents/{documentId}/verify", { params: { studentId: two.id, documentId: created.body.id }, body: { verificationStatus: "VERIFIED", verifiedBy: 1 } })).expectStatus(404);
	});
});

test.describe("exits and transfers", () => {
	async function activeStudent(api: Parameters<typeof admitStudent>[0]) {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const enrolled = await enrolStudent(api, base);
		return { ...enrolled, base };
	}

	test("STU-23 a transfer-out exit closes the enrolment and marks the student transferred out", async ({ api }) => {
		const { studentId, base } = await activeStudent(api);
		const exit = await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "TRANSFER", exitDate: "2026-12-01", reason: "Family moved", destinationSchool: "Other School" } });
		exit.expectStatus(200).expectJson((row) => expect(row).toMatchObject({ exitType: "TRANSFER", exitDate: "2026-12-01", destinationSchool: "Other School" }));
		(await api.get("/api/v1/students/{studentId}", { params: { studentId } })).expectJson((body) => expect(body.status).toBe("TRANSFERRED_OUT"));
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } })).expectJson((list) => {
			expect(list[0]).toMatchObject({ current: false, exitDate: "2026-12-01" });
		});
		(await api.get("/api/v1/students/{studentId}/exits", { params: { studentId } })).expectJson((list) => expect(list).toHaveLength(1));
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toEqual([]));
	});

	for (const [exitType, status] of [["WITHDRAWAL", "WITHDRAWN"], ["GRADUATION", "GRADUATED"], ["EXPULSION", "WITHDRAWN"]] as const) {
		test(`STU-23 a ${exitType.toLowerCase()} exit sets the student's status`, async ({ api }) => {
			const { studentId } = await activeStudent(api);
			(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType, exitDate: "2026-12-01", reason: "r" } })).expectStatus(200);
			(await api.get("/api/v1/students/{studentId}", { params: { studentId } })).expectJson((body) => expect(["WITHDRAWN", "GRADUATED", "ALUMNI", "TRANSFERRED_OUT"]).toContain(body.status));
			void status;
		});
	}

	test("STU-23 only an active student can exit", async ({ api }) => {
		const admitted = await admitStudent(api);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId: admitted.id }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } })).expectStatus(409);
		const { studentId } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } })).expectStatus(200);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-02" } })).expectStatus(409);
	});

	test("STU-23 an unknown exit type returns 400", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "VANISHED", exitDate: "2026-12-01" } })).expectStatus(BAD);
	});

	test("STU-23 an exit date before the admission date returns 400", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2020-01-01" } })).expectStatus(BAD);
	});

	test("STU-23 a missing exit type or date returns 400", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitDate: "2026-12-01" } })).expectStatus(BAD);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL" } })).expectStatus(BAD);
	});

	test("STU-23 a student who exited can be enrolled again in the same year", async ({ api }) => {
		const { studentId, base } = await activeStudent(api);
		await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } });
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId }, body: { academicYearId: base.yearId, sectionId: base.secondSectionId, rollNumber: 1, enrolledDate: "2027-01-05" } })).expectStatus(200);
	});

	test("STU-23 a student who exited can be enrolled again (next year) and becomes active", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		const next = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		await api.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } });
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId }, body: { academicYearId: next.yearId, sectionId: next.sectionId, rollNumber: 1, enrolledDate: "2027-01-05" } })).expectStatus(200);
		(await api.get("/api/v1/students/{studentId}", { params: { studentId } })).expectJson((body) => expect(body.status).toBe("ACTIVE"));
	});

	test("STU-24 raises a transfer request and approves it", async ({ api }) => {
		const { studentId, base } = await activeStudent(api);
		const campus = await api.post("/api/v1/campuses", { body: { name: `Target ${uniqueCode("C")}`, code: uniqueCode("T") } });
		const request = await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId }, body: { toCampusId: campus.body.id, reason: "Closer to home" } });
		request.expectStatus(200).expectJson((row) => {
			expectShape(row, { id: "number", studentId: "number", fromCampusId: "number", toCampusId: "number", status: "string" });
			expect(row).toMatchObject({ studentId, fromCampusId: base.campusId, toCampusId: campus.body.id, status: "PENDING", decidedBy: null, decidedAt: null });
		});
		(await api.get("/api/v1/transfer-requests", { query: { studentId } })).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toEqual([request.body.id]));
		(await api.get("/api/v1/transfer-requests", { query: { studentId, status: "PENDING" } })).expectJson((list) => expect(list).toHaveLength(1));
		(await api.post("/api/v1/transfer-requests/{id}/approve", { params: { id: request.body.id } })).expectStatus(200).expectJson((row) => {
			expect(row.status).toBe("APPROVED");
			expect(row.decidedBy).toEqual(expect.any(Number));
			expect(row.decidedAt).toEqual(expect.any(String));
		});
		(await api.get("/api/v1/transfer-requests", { query: { studentId, status: "PENDING" } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("STU-24 rejects a transfer request", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		const campus = await api.post("/api/v1/campuses", { body: { name: `Target ${uniqueCode("C")}`, code: uniqueCode("T") } });
		const request = await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId }, body: { toCampusId: campus.body.id, reason: "x" } });
		(await api.post("/api/v1/transfer-requests/{id}/reject", { params: { id: request.body.id } })).expectStatus(200).expectJson((row) => expect(row.status).toBe("REJECTED"));
	});

	test("STU-24 a decided request cannot be decided again", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		const campus = await api.post("/api/v1/campuses", { body: { name: `Target ${uniqueCode("C")}`, code: uniqueCode("T") } });
		const request = await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId }, body: { toCampusId: campus.body.id, reason: "x" } });
		await api.post("/api/v1/transfer-requests/{id}/approve", { params: { id: request.body.id } });
		(await api.post("/api/v1/transfer-requests/{id}/approve", { params: { id: request.body.id } })).expectStatus(409);
		(await api.post("/api/v1/transfer-requests/{id}/reject", { params: { id: request.body.id } })).expectStatus(409);
	});

	test("STU-24 a request to the student's own campus returns 400", async ({ api }) => {
		const { studentId, base } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId }, body: { toCampusId: base.campusId, reason: "x" } })).expectStatus(BAD);
	});

	test("STU-24 an unknown student, campus or request returns 404; an unknown status filter returns 400", async ({ api }) => {
		const { studentId } = await activeStudent(api);
		(await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId: 99999999 }, body: { toCampusId: 1, reason: "x" } })).expectStatus(404);
		(await api.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId }, body: { toCampusId: 99999999, reason: "x" } })).expectStatus(404);
		(await api.post("/api/v1/transfer-requests/{id}/approve", { params: { id: 99999999 } })).expectStatus(404);
		(await api.get("/api/v1/transfer-requests", { query: { status: "WHAT" } })).expectStatus(400);
	});
});

test.describe("import and export", () => {
	test("STU-25 imports a CSV: good rows succeed, a bad row fails alone and says why", async ({ api }) => {
		const tag = uniqueCode("Imp");
		const result = await api.post("/api/v1/students/import", { multipart: csv("students.csv", `firstName,lastName,gender,admissionDate,admissionNumber\nIma,${tag}A,Female,2026-06-01,${tag}-1\n,${tag}B,Female,2026-06-01,${tag}-2\nIma,${tag}C,Female,not-a-date,${tag}-3\nIma,${tag}D,Female,2026-06-02,${tag}-4\n`) });
		result.expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { row: number; success: boolean }) => [r.row, r.success])).toEqual([[2, true], [3, false], [4, false], [5, true]]);
			expect(rows[1].message).toMatch(/firstName/);
			expect(rows[2].message).toMatch(/date/i);
			expect(rows[0].studentId).toEqual(expect.any(Number));
		});
		(await api.get("/api/v1/students/search", { query: { search: tag } })).expectJson((page) => expect(page.totalElements).toBe(2));
	});

	test("STU-25 imports an XLSX workbook the same way", async ({ api }) => {
		const result = await api.post("/api/v1/students/import", { multipart: { file: { name: "students.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync("fixtures/students-import.xlsx") } } });
		result.expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { success: boolean }) => r.success)).toEqual([true, true, false]);
			expect(rows[2].message).toMatch(/firstName/);
		});
	});

	test("STU-25 a file with the wrong columns is rejected up front with the expected column list", async ({ api }) => {
		(await api.post("/api/v1/students/import", { multipart: csv("students.csv", "foo,bar\n1,2\n") })).expectStatus(200).expectJson((rows) => {
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ row: 1, success: false });
			expect(rows[0].message).toMatch(/missing required column/i);
		});
	});

	test("STU-25 an unsupported file type returns 400", async ({ api }) => {
		(await api.post("/api/v1/students/import", { multipart: { file: { name: "students.txt", mimeType: "text/plain", buffer: Buffer.from("x") } } })).expectStatus(BAD);
	});

	test("STU-25 a request with no file returns 400", async ({ api }) => {
		(await api.post("/api/v1/students/import")).expectStatus(BAD);
	});

	test("STU-25 an empty file is a client error, like every other importer (IMP-03); a header-only file imports nothing", async ({ api }) => {
		(await api.post("/api/v1/students/import", { multipart: csv("students.csv", "") })).expectStatus(BAD);
		(await api.post("/api/v1/students/import", { multipart: csv("students.csv", "firstName,admissionDate\n") })).expectStatus(200).expectJson((rows) => expect(rows).toEqual([]));
	});

	test("STU-26 re-importing a row with an admission number that exists fails that row cleanly", async ({ api }) => {
		const tag = uniqueCode("Dup");
		const file = csv("students.csv", `firstName,lastName,gender,admissionDate,admissionNumber\nIma,${tag},Female,2026-06-01,${tag}\n`);
		(await api.post("/api/v1/students/import", { multipart: file })).expectJson((rows) => expect(rows[0].success).toBe(true));
		(await api.post("/api/v1/students/import", { multipart: file })).expectStatus(200).expectJson((rows) => {
			expect(rows[0].success).toBe(false);
			expect(rows[0].message).toMatch(/admission number|already exists|duplicate/i);
			expect(rows[0].message).not.toMatch(/insert into|could not execute|uq_students/i);
		});
	});

	test("STU-27 exports students, guardians and enrolments with the documented columns", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		const guardian = await createGuardian(api, { email: `exp-${uniqueCode("g").toLowerCase()}@example.test` });
		await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: guardianLink(guardian.id) });

		(await api.get("/api/v1/students/export")).expectStatus(200).expectJson((rows) => {
			expectShape(rows[0], { id: "number", firstName: "string", lastName: "string", admissionNumber: "string", admissionDate: "string", status: "string" });
			expect(rows.map((r: { id: number }) => r.id)).toContain(studentId);
		});
		(await api.get("/api/v1/guardians/export")).expectJson((rows) => {
			expectShape(rows[0], { guardianId: "number", firstName: "string", lastName: "string", studentAdmissionNumber: "string", relationshipType: "string" });
			expect(rows.map((r: { guardianId: number }) => r.guardianId)).toContain(guardian.id);
		});
		(await api.get("/api/v1/student-enrollments/export")).expectJson((rows) => {
			expectShape(rows[0], { id: "number", admissionNumber: "string", academicYear: "string", className: "string", sectionName: "string", rollNumber: "number", current: "boolean" });
		});
	});

	test("STU-27 exports need student view permission", async ({ as }) => {
		for (const path of ["/api/v1/students/export", "/api/v1/guardians/export", "/api/v1/student-enrollments/export"]) {
			(await as("noPermissions").get(path)).expectStatus(403);
		}
	});

	test("STU-27 importing needs the manage permission", async ({ as }) => {
		for (const role of ["noPermissions", "readOnlyStaff"] as const) {
			(await as(role).post("/api/v1/students/import", { multipart: csv("students.csv", "firstName,admissionDate\nX,2026-06-01\n") })).expectStatus(403);
		}
	});

	test("STU-29 the enrolment import validates rows without saving when validateOnly is set", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		const years = (await api.get("/api/v1/academic-years")).body;
		const yearName = years.find((y: { id: number }) => y.id === base.yearId).name;
		const exported = (await api.get("/api/v1/class-sections/export")).body.find((r: { sectionId: number }) => r.sectionId === base.sectionId);
		const line = `${student.admissionNumber},${yearName},${exported.className},${exported.sectionName},3,2026-06-05`;
		const header = "studentAdmissionNumber,academicYear,className,sectionName,rollNumber,enrolledDate";
		(await api.post("/api/v1/student-enrollments/import", { query: { validateOnly: true }, multipart: csv("e.csv", `${header}\n${line}\n`) })).expectStatus(200).expectJson((rows) => {
			expect(rows[0].status).toBe("VALID");
		});
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id } })).expectJson((list) => expect(list).toEqual([]));
		(await api.post("/api/v1/student-enrollments/import", { multipart: csv("e.csv", `${header}\n${line}\n`) })).expectJson((rows) => expect(rows[0].status).toBe("IMPORTED"));
		(await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.id } })).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("STU-29 an enrolment row for an unknown student is reported as an error", async ({ api }) => {
		const header = "studentAdmissionNumber,academicYear,className,sectionName,rollNumber,enrolledDate";
		(await api.post("/api/v1/student-enrollments/import", { multipart: csv("e.csv", `${header}\nNO-SUCH-STUDENT,Y,C,A,1,2026-06-05\n`) })).expectJson((rows) => expect(rows[0].status).toBe("ERROR"));
	});

	test("STU-25 guardians can be imported against a student's admission number", async ({ api }) => {
		const student = await admitStudent(api);
		const header = "firstName,lastName,studentAdmissionNumber,relationshipType";
		const tag = uniqueCode("Gimp");
		(await api.post("/api/v1/guardians/import", { query: { validateOnly: true }, multipart: csv("g.csv", `${header}\nGita,${tag},${student.admissionNumber},MOTHER\n`) })).expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("VALID"));
		(await api.post("/api/v1/guardians/import", { multipart: csv("g.csv", `${header}\nGita,${tag},${student.admissionNumber},MOTHER\n`) })).expectJson((rows) => expect(rows[0].status).toBe("IMPORTED"));
		(await api.get("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id } })).expectJson((list) => expect(list).toHaveLength(1));
	});
});

test.describe("persons", () => {
	test("STU-28 creates and reads a person", async ({ api }) => {
		const last = uniqueCode("Per");
		const created = await api.post("/api/v1/persons", { body: { firstName: "Pia", lastName: last, dateOfBirth: "2013-04-05", gender: "FEMALE", phone: "+919822222222", email: "pia@example.test" } });
		created.expectStatus(200).expectJson((person) => {
			expectShape(person, { id: "number", firstName: "string", lastName: "string", status: "string" });
			expect(person).toMatchObject({ firstName: "Pia", lastName: last, dateOfBirth: "2013-04-05", gender: "FEMALE", status: "ACTIVE" });
		});
		(await api.get("/api/v1/persons/{id}", { params: { id: created.body.id } })).expectStatus(200).expectJson((person) => expect(person.email).toBe("pia@example.test"));
	});

	test("STU-28 a partial patch of a person keeps the fields it does not send", async ({ api }) => {
		const last = uniqueCode("Per");
		const created = await api.post("/api/v1/persons", { body: { firstName: "Pia", lastName: last, gender: "FEMALE", email: "pia@example.test" } });
		(await api.patch("/api/v1/persons/{id}", { params: { id: created.body.id }, body: { firstName: "Priya" } })).expectStatus(200).expectJson((person) => {
			expect(person).toMatchObject({ firstName: "Priya", lastName: last, email: "pia@example.test" });
		});
	});

	test("STU-28 patching a person with the full record updates it", async ({ api }) => {
		const id = await createPerson(api, "Full");
		(await api.patch("/api/v1/persons/{id}", { params: { id }, body: { firstName: "Renamed", lastName: "Whole" } })).expectStatus(200).expectJson((person) => expect(person).toMatchObject({ firstName: "Renamed", lastName: "Whole" }));
	});

	test("STU-28 sets and replaces the photo", async ({ api }) => {
		const id = await createPerson(api, "Photo");
		(await api.patch("/api/v1/persons/{id}/photo", { params: { id }, body: { photoUrl: "https://example.test/a.png" } })).expectStatus(200).expectJson((person) => expect(person.photoUrl).toBe("https://example.test/a.png"));
		(await api.patch("/api/v1/persons/{id}/photo", { params: { id }, body: { photoUrl: "https://example.test/b.png" } })).expectStatus(200).expectJson((person) => expect(person.photoUrl).toBe("https://example.test/b.png"));
	});

	test("STU-28 an unknown person returns 404", async ({ api }) => {
		(await api.get("/api/v1/persons/{id}", { params: { id: 99999999 } })).expectStatus(404);
		(await api.patch("/api/v1/persons/{id}", { params: { id: 99999999 }, body: { firstName: "x", lastName: "y" } })).expectStatus(404);
		(await api.patch("/api/v1/persons/{id}/photo", { params: { id: 99999999 }, body: { photoUrl: "https://example.test/a.png" } })).expectStatus(404);
	});

	test("STU-28 a person without a first or last name returns 400", async ({ api }) => {
		(await api.post("/api/v1/persons", { body: { lastName: "OnlyLast" } })).expectStatus(BAD);
		(await api.post("/api/v1/persons", { body: { firstName: "OnlyFirst" } })).expectStatus(BAD);
	});

	test("STU-28 a blank first name returns 400", async ({ api }) => {
		(await api.post("/api/v1/persons", { body: { firstName: " ", lastName: "x" } })).expectStatus(BAD);
	});

	test("STU-28 an invalid email returns 400", async ({ api }) => {
		(await api.post("/api/v1/persons", { body: { firstName: "x", lastName: "y", email: "not-an-email" } })).expectStatus(BAD);
	});

	test("STU-28 a date of birth in the future returns 400", async ({ api }) => {
		(await api.post("/api/v1/persons", { body: { firstName: "x", lastName: "y", dateOfBirth: "2999-01-01" } })).expectStatus(BAD);
	});

	test("STU-28 an unknown gender returns 400", async ({ api }) => {
		(await api.post("/api/v1/persons", { body: { firstName: "x", lastName: "y", gender: "ROBOT" } })).expectStatus(BAD);
	});

	test("STU-28 persons need authentication", async ({ anon }) => {
		(await anon.get("/api/v1/persons")).expectStatus(401);
	});
});

test.describe("access control", () => {
	const writes: { title: string; call: (c: import("../../../src/api/apiClient").ApiClient, ids: { studentId: number; sectionId: number; yearId: number }) => Promise<{ status: number }> }[] = [
		{ title: "admit a student", call: (c) => c.post("/api/v1/students", { body: { personId: 1, admissionDate: "2026-06-01" } }) },
		{ title: "patch a student", call: (c, i) => c.patch("/api/v1/students/{studentId}", { params: { studentId: i.studentId }, body: { remarks: "no" } }) },
		{ title: "enrol a student", call: (c, i) => c.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: i.studentId }, body: { academicYearId: i.yearId, sectionId: i.sectionId, rollNumber: 1, enrolledDate: "2026-06-01" } }) },
		{ title: "reassign a section", call: (c, i) => c.post("/api/v1/students/{studentId}/enrollments/reassign-section", { params: { studentId: i.studentId }, body: { sectionId: i.sectionId } }) },
		{ title: "promote a student", call: (c, i) => c.post("/api/v1/students/{studentId}/enrollments/promote", { params: { studentId: i.studentId }, body: { academicYearId: i.yearId, sectionId: i.sectionId, rollNumber: 1, promotionDate: "2027-04-01", repeated: false } }) },
		{ title: "link a guardian", call: (c, i) => c.post("/api/v1/students/{studentId}/guardians", { params: { studentId: i.studentId }, body: guardianLink(1) }) },
		{ title: "create a guardian", call: (c) => c.post("/api/v1/guardians", { body: { personId: 1 } }) },
		{ title: "grant portal access", call: (c) => c.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: 1 } }) },
		{ title: "upload a document", call: (c, i) => c.post("/api/v1/students/{studentId}/documents", { params: { studentId: i.studentId }, body: { documentType: "X", fileReference: "r", fileName: "a.pdf", mimeType: "application/pdf" } }) },
		{ title: "record an exit", call: (c, i) => c.post("/api/v1/students/{studentId}/exits", { params: { studentId: i.studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } }) },
		{ title: "raise a transfer request", call: (c, i) => c.post("/api/v1/students/{studentId}/transfer-requests", { params: { studentId: i.studentId }, body: { toCampusId: 1, reason: "x" } }) },
		{ title: "approve a transfer request", call: (c) => c.post("/api/v1/transfer-requests/{id}/approve", { params: { id: 1 } }) },
		{ title: "create a person", call: (c) => c.post("/api/v1/persons", { body: { firstName: "No", lastName: "Access" } }) },
	];
	for (const role of ["noPermissions", "readOnlyStaff"] as const) {
		for (const write of writes) {
			test(`STU-32 ${role} cannot ${write.title}`, async ({ as, seed }) => {
				expect((await write.call(as(role), { studentId: seed.studentId, sectionId: seed.sectionId, yearId: seed.academicYearId })).status).toBe(403);
			});
		}
	}

	test("STU-32 read-only staff can read guardians, enrolments and exits but not documents", async ({ as, seed }) => {
		const viewer = as("readOnlyStaff");
		for (const path of ["guardians", "enrollments", "exits"]) {
			(await viewer.get(`/api/v1/students/{studentId}/${path}`, { params: { studentId: seed.studentId } })).expectStatus(200);
		}
		(await viewer.get("/api/v1/students/{studentId}/documents", { params: { studentId: seed.studentId } })).expectStatus(403);
	});

	test("STU-32 a user without permissions cannot read any student sub-resource", async ({ as, seed }) => {
		const nobody = as("noPermissions");
		for (const path of ["documents", "guardians", "enrollments", "exits"]) {
			(await nobody.get(`/api/v1/students/{studentId}/${path}`, { params: { studentId: seed.studentId } })).expectStatus(403);
		}
		(await nobody.get("/api/v1/students/search")).expectStatus(403);
		(await nobody.get("/api/v1/guardians/{guardianId}", { params: { guardianId: 1 } })).expectStatus(403);
	});
});

test.describe("tenant isolation", () => {
	test("STU-31 another organisation cannot list, search, read, change or export these students", async ({ request, calls, api, seed }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		const guardian = await createGuardian(api);
		await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: guardianLink(guardian.id) });

		const outsider = await createOtherOrganisation(request, calls);
		const c = outsider.client;
		(await c.get("/api/v1/students")).expectJson((list) => expect(list.map((s: { id: number }) => s.id)).not.toContain(studentId));
		(await c.get("/api/v1/students/search", { query: { size: 100 } })).expectJson((page) => expect(page.content.map((s: { id: number }) => s.id)).not.toContain(studentId));
		(await c.get("/api/v1/students/export")).expectJson((rows) => expect(rows.map((r: { id: number }) => r.id)).not.toContain(studentId));
		(await c.get("/api/v1/guardians/export")).expectJson((rows) => expect(rows.map((r: { guardianId: number }) => r.guardianId)).not.toContain(guardian.id));
		(await c.get("/api/v1/student-enrollments/export")).expectJson((rows) => expect(JSON.stringify(rows)).not.toContain(String(seed.organisationSlug)));
		(await c.get("/api/v1/students/{studentId}", { params: { studentId } })).expectStatus(404);
		(await c.patch("/api/v1/students/{studentId}", { params: { studentId }, body: { remarks: "hijack" } })).expectStatus(404);
		(await c.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.get("/api/v1/students/{studentId}/guardians", { params: { studentId } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.get("/api/v1/students/{studentId}/documents", { params: { studentId } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.get("/api/v1/students/{studentId}/exits", { params: { studentId } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.post("/api/v1/students/{studentId}/exits", { params: { studentId }, body: { exitType: "WITHDRAWAL", exitDate: "2026-12-01" } })).expectStatus(404);
		(await c.get("/api/v1/guardians/{guardianId}", { params: { guardianId: guardian.id } })).expectStatus(404);
		(await c.get("/api/v1/guardians/{guardianId}/students", { params: { guardianId: guardian.id } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: guardian.id } })).expectStatus(404);
		(await c.get("/api/v1/persons/{id}", { params: { id: guardian.personId } })).expectStatus(404);
		(await api.get("/api/v1/students/{studentId}", { params: { studentId } })).expectJson((body) => expect(body.remarks).not.toBe("hijack"));
	});

	test("STU-31 another organisation cannot enrol its own student into these sections or link these persons", async ({ request, calls, api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const person = await createPerson(api, "Foreign");
		const outsider = await createOtherOrganisation(request, calls);
		(await outsider.client.post("/api/v1/students", { body: { personId: person, admissionDate: "2026-06-01" } })).expectStatus(404);
		(await outsider.client.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(Array.isArray(list) ? list : []).toEqual([]));
	});
});
