// Academic structure: years, campuses, grade levels, classes, sections, subjects and their imports.
// IDs refer to docs/SCENARIOS.md section 4 (ACA-*). Years can be marked current or closed and
// classes can be deactivated, which would disturb the shared fixture organisation, so every
// scenario builds its own throwaway organisation.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { buildAcademicBase, createGrade, createPerson, createYear, enrolStudent } from "../../../src/api/academics";
import { expectShape } from "../../../src/api/shapes";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";

const BAD = [400, 422];

test.describe("academic years", () => {
	test("ACA-01 creates a draft year that is listed", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const name = `Year ${uniqueSuffix()}`;
		const created = await org.client.post("/api/v1/academic-years", { body: { name, startDate: "2026-04-01", endDate: "2027-03-31" } });
		created.expectStatus([200, 201]).expectJson((year) => {
			expectShape(year, { id: "number", name: "string", startDate: "string", endDate: "string", current: "boolean", status: "string" });
			expect(year).toMatchObject({ name, startDate: "2026-04-01", endDate: "2027-03-31", current: false, status: "DRAFT" });
		});
		(await org.client.get("/api/v1/academic-years")).expectJson((years) => expect(years.map((y: { id: number }) => y.id)).toContain(created.body.id));
	});

	test("ACA-01 a duplicate year name returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const year = await createYear(org.client);
		(await org.client.post("/api/v1/academic-years", { body: { name: year.name, startDate: "2030-04-01", endDate: "2031-03-31" } })).expectStatus(409);
	});

	test("ACA-01 a missing name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic-years", { body: { startDate: "2026-04-01", endDate: "2027-03-31" } })).expectStatus(BAD);
	});

	test("ACA-01 a missing date returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic-years", { body: { name: "No dates" } })).expectStatus(BAD);
	});

	test("ACA-02 an end date before the start date returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic-years", { body: { name: "Inverted", startDate: "2027-04-01", endDate: "2026-03-31" } })).expectStatus(BAD);
	});

	test("ACA-02 a range overlapping an existing year is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await createYear(org.client, { startDate: "2026-04-01", endDate: "2027-03-31" });
		(await org.client.post("/api/v1/academic-years", { body: { name: "Overlap", startDate: "2026-09-01", endDate: "2027-08-31" } })).expectStatus([400, 409, 422]);
	});

	test("ACA-02 a year starting the day after another ends is accepted", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await createYear(org.client, { startDate: "2026-04-01", endDate: "2027-03-31" });
		(await org.client.post("/api/v1/academic-years", { body: { name: "Next", startDate: "2027-04-01", endDate: "2028-03-31" } })).expectStatus([200, 201]);
	});

	test("ACA-03 marking a year current activates it and leaves exactly one current year", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const first = await createYear(org.client, { startDate: "2026-04-01", endDate: "2027-03-31" });
		const second = await createYear(org.client, { startDate: "2027-04-01", endDate: "2028-03-31" });
		(await org.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: first.id } })).expectStatus(200).expectJson((year) => expect(year).toMatchObject({ current: true, status: "ACTIVE" }));
		(await org.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: second.id } })).expectStatus(200);
		(await org.client.get("/api/v1/academic-years")).expectJson((years) => {
			expect(years.filter((y: { current: boolean }) => y.current).map((y: { id: number }) => y.id)).toEqual([second.id]);
			expect(years.find((y: { id: number }) => y.id === first.id).status).toBe("ACTIVE");
		});
	});

	test("ACA-03 marking an unknown year current returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("ACA-04 closing a year marks it closed and not current", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const year = await createYear(org.client);
		await org.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: year.id } });
		(await org.client.post("/api/v1/academic-years/{id}/close", { params: { id: year.id } })).expectStatus(200).expectJson((closed) => expect(closed).toMatchObject({ status: "CLOSED", current: false }));
	});

	test("ACA-04 a closed year cannot be made current again", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const year = await createYear(org.client);
		await org.client.post("/api/v1/academic-years/{id}/close", { params: { id: year.id } });
		(await org.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: year.id } })).expectStatus([400, 409, 422]);
	});

	test("ACA-04 a closed year accepts no new classes", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const freshGrade = await createGrade(org.client);
		await org.client.post("/api/v1/academic-years/{id}/close", { params: { id: base.yearId } });
		(await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: freshGrade, displayName: "Late class" } })).expectStatus([400, 409, 422]);
	});

	// Students cannot be created in a throwaway organisation: students.uq_students_student_id is unique
	// across organisations (Operion #354), so enrolment scenarios use the shared organisation with a
	// year of their own that is never made current.
	test("ACA-04 a closed year accepts no new enrolments", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		await api.post("/api/v1/academic-years/{id}/close", { params: { id: base.yearId } });
		const personId = await createPerson(api, "Late");
		const student = await api.post("/api/v1/students", { body: { personId, admissionNumber: uniqueCode("ADM"), admissionDate: "2026-06-01" } });
		student.expectStatus([200, 201]);
		(await api.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.body.id }, body: { academicYearId: base.yearId, sectionId: base.sectionId, rollNumber: 1, enrolledDate: "2026-06-01" } })).expectStatus([400, 409, 422]);
	});

	test("ACA-04 closing an unknown year returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic-years/{id}/close", { params: { id: 99999999 } })).expectStatus(404);
	});
});

test.describe("campuses", () => {
	test("ACA-05 a new organisation has one active campus and more can be added", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/campuses")).expectStatus(200).expectJson((list) => {
			expect(list).toHaveLength(1);
			expectShape(list[0], { id: "number", name: "string", code: "string", status: "string" });
		});
		const code = uniqueCode("C");
		(await org.client.post("/api/v1/campuses", { body: { name: `North ${code}`, code, city: "Pune", state: "MH", pincode: "411001", timezone: "Asia/Kolkata" } })).expectStatus([200, 201]).expectJson((campus) => {
			expect(campus).toMatchObject({ code, city: "Pune", state: "MH", pincode: "411001", timezone: "Asia/Kolkata", status: "ACTIVE" });
		});
		(await org.client.get("/api/v1/campuses")).expectJson((list) => expect(list).toHaveLength(2));
	});

	test("ACA-05 a duplicate campus code returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("C");
		(await org.client.post("/api/v1/campuses", { body: { name: `A ${code}`, code } })).expectStatus([200, 201]);
		(await org.client.post("/api/v1/campuses", { body: { name: `B ${code}`, code } })).expectStatus(409);
	});

	test("ACA-05 a duplicate campus name returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const name = `Campus ${uniqueSuffix()}`;
		(await org.client.post("/api/v1/campuses", { body: { name, code: uniqueCode("C") } })).expectStatus([200, 201]);
		(await org.client.post("/api/v1/campuses", { body: { name, code: uniqueCode("C") } })).expectStatus(409);
	});

	test("ACA-05 a missing campus name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/campuses", { body: { code: uniqueCode("C") } })).expectStatus(BAD);
	});

	test("ACA-05 a blank campus name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/campuses", { body: { name: "   ", code: uniqueCode("C") } })).expectStatus(BAD);
	});

	test("ACA-05 an unknown timezone returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/campuses", { body: { name: `TZ ${uniqueSuffix()}`, code: uniqueCode("C"), timezone: "Mars/Base" } })).expectStatus(BAD);
	});
});

test.describe("grade levels", () => {
	test("ACA-06 creates a grade level, lists it and updates it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const created = await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 1", sequenceOrder: 1, stage: "PRIMARY" } });
		created.expectStatus([200, 201]).expectJson((grade) => {
			expectShape(grade, { id: "number", name: "string", sequenceOrder: "number", stage: "string", status: "string" });
			expect(grade).toMatchObject({ name: "Grade 1", sequenceOrder: 1, stage: "PRIMARY", status: "ACTIVE" });
		});
		(await org.client.patch("/api/v1/grade-levels/{id}", { params: { id: created.body.id }, body: { name: "Grade One", sequenceOrder: 1, stage: "PRIMARY" } })).expectStatus(200).expectJson((grade) => expect(grade.name).toBe("Grade One"));
		(await org.client.get("/api/v1/grade-levels")).expectJson((list) => expect(list.find((g: { id: number }) => g.id === created.body.id).name).toBe("Grade One"));
	});

	test("ACA-06 a partial PATCH changes only the fields it sends", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const created = await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 2", sequenceOrder: 2, stage: "PRIMARY" } });
		(await org.client.patch("/api/v1/grade-levels/{id}", { params: { id: created.body.id }, body: { name: "Grade Two" } })).expectStatus(200).expectJson((grade) => expect(grade).toMatchObject({ name: "Grade Two", sequenceOrder: 2, stage: "PRIMARY" }));
	});

	test("ACA-06 a duplicate name returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 3", sequenceOrder: 3, stage: "PRIMARY" } });
		(await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 3", sequenceOrder: 4, stage: "PRIMARY" } })).expectStatus(409);
	});

	test("ACA-06 a duplicate sequence order returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 4", sequenceOrder: 4, stage: "PRIMARY" } });
		(await org.client.post("/api/v1/grade-levels", { body: { name: "Grade 5", sequenceOrder: 4, stage: "PRIMARY" } })).expectStatus(409);
	});

	test("ACA-06 an unknown stage returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/grade-levels", { body: { name: "Odd", sequenceOrder: 9, stage: "GALACTIC" } })).expectStatus(BAD);
	});

	test("ACA-06 a negative sequence order returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/grade-levels", { body: { name: "Neg", sequenceOrder: -5, stage: "PRIMARY" } })).expectStatus(BAD);
	});

	test("ACA-06 a missing name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/grade-levels", { body: { sequenceOrder: 7, stage: "PRIMARY" } })).expectStatus(BAD);
	});

	test("ACA-06 a grade level can be deactivated and reactivated", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const grade = await org.client.post("/api/v1/grade-levels", { body: { name: "Toggle", sequenceOrder: 8, stage: "PRIMARY" } });
		(await org.client.post("/api/v1/grade-levels/{id}/status", { params: { id: grade.body.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((g) => expect(g.status).toBe("INACTIVE"));
		(await org.client.post("/api/v1/grade-levels/{id}/status", { params: { id: grade.body.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((g) => expect(g.status).toBe("ACTIVE"));
	});

	test("ACA-06 an invalid status is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const grade = await org.client.post("/api/v1/grade-levels", { body: { name: "Bad status", sequenceOrder: 10, stage: "PRIMARY" } });
		(await org.client.post("/api/v1/grade-levels/{id}/status", { params: { id: grade.body.id }, body: { status: "SIDEWAYS" } })).expectStatus(400);
	});

	test("ACA-06 an inactive grade level cannot be used for a new class", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const idle = await createGrade(org.client);
		await org.client.post("/api/v1/grade-levels/{id}/status", { params: { id: idle }, body: { status: "INACTIVE" } });
		(await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: idle, displayName: "Inactive grade" } })).expectStatus([400, 409, 422]);
	});

	test("ACA-06 updating an unknown grade level returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/grade-levels/{id}", { params: { id: 99999999 }, body: { name: "x", sequenceOrder: 1, stage: "PRIMARY" } })).expectStatus(404);
	});
});

test.describe("classes", () => {
	test("ACA-07 creates a class, lists it by year and updates its name", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).expectStatus(200).expectJson((list) => {
			const row = list.find((c: { id: number }) => c.id === base.classId);
			expectShape(row, { id: "number", academicYearId: "number", campusId: "number", gradeLevelId: "number", displayName: "string", status: "string" });
			expect(row).toMatchObject({ academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: base.gradeId, status: "ACTIVE" });
		});
		(await org.client.patch("/api/v1/school-classes/{id}", { params: { id: base.classId }, body: { displayName: "Renamed class" } })).expectStatus(200).expectJson((c) => expect(c.displayName).toBe("Renamed class"));
	});

	test("ACA-07 the class list can be filtered to one year", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const other = await createYear(org.client, { startDate: "2028-04-01", endDate: "2029-03-31" });
		(await org.client.get("/api/v1/school-classes", { query: { academicYearId: other.id } })).expectJson((list) => expect(list).toEqual([]));
		(await org.client.get("/api/v1/school-classes")).expectJson((list) => expect(list.map((c: { id: number }) => c.id)).toContain(base.classId));
	});

	test("ACA-07 a second class for the same year, campus and grade returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: base.gradeId, displayName: `Twin ${uniqueSuffix()}` } })).expectStatus(409);
	});

	test("ACA-07 the same class name is allowed under a different grade level", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const list = await org.client.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } });
		const name = list.body.find((c: { id: number }) => c.id === base.classId).displayName;
		(await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: await createGrade(org.client), displayName: name } })).expectStatus([200, 201]);
	});

	test("ACA-07 a missing class name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: base.gradeId } })).expectStatus(BAD);
	});

	test("ACA-07 a blank class name is rejected on create and on update", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.patch("/api/v1/school-classes/{id}", { params: { id: base.classId }, body: { displayName: "" } })).expectStatus(BAD);
	});

	test("ACA-07 an unknown year, campus or grade level returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const body = { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: base.gradeId, displayName: `X ${uniqueSuffix()}` };
		(await org.client.post("/api/v1/school-classes", { body: { ...body, academicYearId: 99999999 } })).expectStatus(404);
		(await org.client.post("/api/v1/school-classes", { body: { ...body, campusId: 99999999 } })).expectStatus(404);
		(await org.client.post("/api/v1/school-classes", { body: { ...body, gradeLevelId: 99999999 } })).expectStatus(404);
	});

	test("ACA-07 a class can be deactivated and reactivated", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{id}/status", { params: { id: base.classId }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((c) => expect(c.status).toBe("INACTIVE"));
		(await org.client.post("/api/v1/school-classes/{id}/status", { params: { id: base.classId }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((c) => expect(c.status).toBe("ACTIVE"));
	});

	test("ACA-07 an invalid class status is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{id}/status", { params: { id: base.classId }, body: { status: "SIDEWAYS" } })).expectStatus(400);
	});

	test("ACA-07 updating or deactivating an unknown class returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/school-classes/{id}", { params: { id: 99999999 }, body: { displayName: "x" } })).expectStatus(404);
		(await org.client.post("/api/v1/school-classes/{id}/status", { params: { id: 99999999 }, body: { status: "INACTIVE" } })).expectStatus(404);
	});

	test("ACA-09 a class with enrolled students cannot be deactivated", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		await enrolStudent(api, base);
		(await api.post("/api/v1/school-classes/{id}/status", { params: { id: base.classId }, body: { status: "INACTIVE" } })).expectStatus(409);
		(await api.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).expectJson((list) => expect(list.find((c: { id: number }) => c.id === base.classId).status).toBe("ACTIVE"));
	});

	test("ACA-09 a section with enrolled students cannot be deactivated", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		await enrolStudent(api, base);
		(await api.post("/api/v1/school-classes/{classId}/sections/{sectionId}/status", { params: { classId: base.classId, sectionId: base.sectionId }, body: { status: "INACTIVE" } })).expectStatus(409);
	});
});

test.describe("sections", () => {
	test("ACA-08 adds sections, lists them and updates one", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.get("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId } })).expectStatus(200).expectJson((list) => {
			expect(list.map((s: { name: string }) => s.name).sort()).toEqual(["A", "B"]);
			expectShape(list[0], { id: "number", schoolClassId: "number", name: "string", capacity: "number", status: "string" });
		});
		(await org.client.patch("/api/v1/school-classes/{classId}/sections/{sectionId}", { params: { classId: base.classId, sectionId: base.sectionId }, body: { name: "A2", capacity: 35, room: "R9" } })).expectStatus(200).expectJson((section) => {
			expect(section).toMatchObject({ name: "A2", capacity: 35, room: "R9" });
		});
	});

	test("ACA-08 a duplicate section name in a class returns 409, ignoring letter case", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { name: "A", capacity: 20 } })).expectStatus(409);
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { name: "a", capacity: 20 } })).expectStatus(409);
	});

	test("ACA-08 the same section name is allowed in a different class", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const other = await org.client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId: await createGrade(org.client), displayName: `Other ${uniqueSuffix()}` } });
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: other.body.id }, body: { name: "A", capacity: 20 } })).expectStatus([200, 201]);
	});

	test("ACA-08 a negative or zero capacity returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { name: "Neg", capacity: -1 } })).expectStatus(BAD);
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { name: "Zero", capacity: 0 } })).expectStatus(BAD);
	});

	test("ACA-08 a missing section name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { capacity: 30 } })).expectStatus(BAD);
	});

	test("ACA-08 an unknown class or section returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: 99999999 }, body: { name: "Z", capacity: 30 } })).expectStatus(404);
		(await org.client.patch("/api/v1/school-classes/{classId}/sections/{sectionId}", { params: { classId: base.classId, sectionId: 99999999 }, body: { name: "Z", capacity: 30 } })).expectStatus(404);
	});

	test("ACA-08 a section can be deactivated and reactivated", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const path = "/api/v1/school-classes/{classId}/sections/{sectionId}/status";
		const params = { classId: base.classId, sectionId: base.secondSectionId };
		(await org.client.post(path, { params, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("INACTIVE"));
		(await org.client.post(path, { params, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("ACTIVE"));
	});

	test("ACA-24 the section's enrolments list shows the enrolled students", async ({ api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
		const student = await enrolStudent(api, base);
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(JSON.stringify(list)).toContain(String(student.enrollmentId));
		});
		(await api.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.secondSectionId } })).expectJson((list) => expect(list).toEqual([]));
	});
});

test.describe("subjects and class subjects", () => {
	test("ACA-10 adds a subject to a class, lists it, changes mandatory and deactivates it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const extra = await org.client.post("/api/v1/subjects", { body: { name: `Extra ${uniqueSuffix()}`, code: uniqueCode("X") } });
		const added = await org.client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId }, body: { subjectId: extra.body.id, mandatory: false } });
		added.expectStatus([200, 201]).expectJson((row) => {
			expectShape(row, { id: "number", schoolClassId: "number", subjectId: "number", mandatory: "boolean", status: "string" });
			expect(row).toMatchObject({ subjectId: extra.body.id, mandatory: false, status: "ACTIVE" });
		});
		(await org.client.get("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId } })).expectJson((list) => expect(list.map((r: { subjectId: number }) => r.subjectId)).toContain(extra.body.id));
		(await org.client.patch("/api/v1/school-classes/{classId}/subjects/{id}", { params: { classId: base.classId, id: added.body.id }, body: { mandatory: true } })).expectStatus(200).expectJson((row) => expect(row.mandatory).toBe(true));
		(await org.client.post("/api/v1/school-classes/{classId}/subjects/{id}/status", { params: { classId: base.classId, id: added.body.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((row) => expect(row.status).toBe("INACTIVE"));
	});

	test("ACA-10 the same subject twice on a class returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId }, body: { subjectId: base.subjectId, mandatory: true } })).expectStatus(409);
	});

	test("ACA-10 an unknown subject or class returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId }, body: { subjectId: 99999999, mandatory: true } })).expectStatus(404);
		(await org.client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: 99999999 }, body: { subjectId: base.subjectId, mandatory: true } })).expectStatus(404);
	});

	test("ACA-10 an inactive subject cannot be added to a class", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const subject = await org.client.post("/api/v1/subjects", { body: { name: `Retired ${uniqueSuffix()}`, code: uniqueCode("R") } });
		await org.client.post("/api/v1/subjects/{id}/status", { params: { id: subject.body.id }, body: { status: "INACTIVE" } });
		(await org.client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId }, body: { subjectId: subject.body.id, mandatory: true } })).expectStatus([400, 409, 422]);
	});

	test("ACA-11 creates a subject and lists it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("SUB");
		const created = await org.client.post("/api/v1/subjects", { body: { name: `Subject ${code}`, code } });
		created.expectStatus([200, 201]).expectJson((subject) => {
			expectShape(subject, { id: "number", name: "string", code: "string", status: "string" });
			expect(subject).toMatchObject({ code, status: "ACTIVE" });
		});
		(await org.client.get("/api/v1/subjects")).expectJson((list) => expect(list.map((s: { id: number }) => s.id)).toContain(created.body.id));
	});

	test("ACA-11 a duplicate subject name returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const name = `Subject ${uniqueSuffix()}`;
		await org.client.post("/api/v1/subjects", { body: { name, code: uniqueCode("A") } });
		(await org.client.post("/api/v1/subjects", { body: { name, code: uniqueCode("B") } })).expectStatus(409);
	});

	test("ACA-11 a duplicate subject code returns 409 (as the import already enforces)", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("DUP");
		await org.client.post("/api/v1/subjects", { body: { name: `One ${uniqueSuffix()}`, code } });
		(await org.client.post("/api/v1/subjects", { body: { name: `Two ${uniqueSuffix()}`, code } })).expectStatus(409);
	});

	test("ACA-11 a missing subject name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/subjects", { body: { code: uniqueCode("N") } })).expectStatus(BAD);
	});

	test("ACA-11 a subject can be deactivated and reactivated; an invalid status is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const subject = await org.client.post("/api/v1/subjects", { body: { name: `Toggle ${uniqueSuffix()}`, code: uniqueCode("T") } });
		(await org.client.post("/api/v1/subjects/{id}/status", { params: { id: subject.body.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("INACTIVE"));
		(await org.client.post("/api/v1/subjects/{id}/status", { params: { id: subject.body.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("ACTIVE"));
		(await org.client.post("/api/v1/subjects/{id}/status", { params: { id: subject.body.id }, body: { status: "SIDEWAYS" } })).expectStatus(400);
	});

	test("ACA-11 export lists every subject", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const subject = await org.client.post("/api/v1/subjects", { body: { name: `Export ${uniqueSuffix()}`, code: uniqueCode("E") } });
		(await org.client.get("/api/v1/subjects/export")).expectStatus(200).expectJson((rows) => expect(rows.map((r: { id: number }) => r.id)).toContain(subject.body.id));
	});

	const csv = (rows: string) => ({ file: { name: "subjects.csv", mimeType: "text/csv", buffer: Buffer.from(`name,code\n${rows}`) } });

	test("ACA-11 importing a CSV creates the subjects and reports each row", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const a = uniqueCode("IMPA");
		const b = uniqueCode("IMPB");
		const result = await org.client.post("/api/v1/subjects/import", { multipart: csv(`Physics ${a},${a}\nChemistry ${b},${b}\n`) });
		result.expectStatus(200).expectJson((rows) => expect(rows.map((r: { status: string }) => r.status)).toEqual(["IMPORTED", "IMPORTED"]));
		(await org.client.get("/api/v1/subjects")).expectJson((list) => expect(list.map((s: { code: string }) => s.code)).toEqual(expect.arrayContaining([a, b])));
	});

	test("ACA-11 validate-only reports the rows without creating anything", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("VAL");
		(await org.client.post("/api/v1/subjects/import", { query: { validateOnly: true }, multipart: csv(`Validate ${code},${code}\n`) })).expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("VALID"));
		(await org.client.get("/api/v1/subjects")).expectJson((list) => expect(list.map((s: { code: string }) => s.code)).not.toContain(code));
	});

	test("ACA-11 importing the same file twice reports duplicates the second time", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("TWICE");
		const file = csv(`Twice ${code},${code}\n`);
		await org.client.post("/api/v1/subjects/import", { multipart: file });
		(await org.client.post("/api/v1/subjects/import", { multipart: file })).expectJson((rows) => expect(rows[0].status).toBe("DUPLICATE"));
	});

	test("ACA-11 a row without a name is reported as an error and the other rows still import", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("MIX");
		(await org.client.post("/api/v1/subjects/import", { multipart: csv(`,NOCODE\nMixed ${code},${code}\n`) })).expectJson((rows) => {
			expect(rows[0]).toMatchObject({ row: 2, status: "ERROR" });
			expect(rows[1].status).toBe("IMPORTED");
		});
	});

	test("ACA-11 an import appears in the import history", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const code = uniqueCode("HIST");
		await org.client.post("/api/v1/subjects/import", { multipart: csv(`Hist ${code},${code}\n`) });
		(await org.client.get("/api/v1/imports/history")).expectStatus(200).expectJson((history) => {
			expect(history[0]).toMatchObject({ entityType: "Subject", fileName: "subjects.csv", totalRows: 1, importedCount: 1, errorCount: 0, duplicateCount: 0 });
		});
	});

	test("ACA-11 an import with no file returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/subjects/import")).expectStatus(BAD);
	});
});

test.describe("class-sections export and import", () => {
	test("ACA-12 the export lists every section with its year, campus, grade and class", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.get("/api/v1/class-sections/export")).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { sectionId: number }) => r.sectionId)).toEqual(expect.arrayContaining([base.sectionId, base.secondSectionId]));
			expectShape(rows[0], { sectionId: "number", academicYear: "string", campus: "string", gradeLevel: "string", className: "string", sectionName: "string", capacity: "number" });
		});
	});

	test("ACA-12 re-importing the export reports every row as already existing and changes nothing", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await buildAcademicBase(org.client, { assignTeachers: false });
		const rows = (await org.client.get("/api/v1/class-sections/export")).body as Record<string, string | number | null>[];
		const header = ["academicYear", "campus", "gradeLevel", "className", "sectionName", "capacity", "room"];
		const csv = [header.join(","), ...rows.map((r) => header.map((h) => r[h] ?? "").join(","))].join("\n");
		const result = await org.client.post("/api/v1/class-sections/import", { multipart: { file: { name: "class-sections.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } } });
		result.expectStatus(200).expectJson((report) => {
			expect(report).toHaveLength(rows.length);
			for (const row of report) expect(["DUPLICATE", "SKIPPED", "VALID"]).toContain(row.status);
		});
		expect((await org.client.get("/api/v1/class-sections/export")).body).toHaveLength(rows.length);
	});

	test("ACA-12 an export from one organisation imports into another that has the same year, campus and grade", async ({ request, calls }) => {
		const source = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(source.client, { assignTeachers: false });
		const rows = (await source.client.get("/api/v1/class-sections/export")).body as Record<string, string | number | null>[];
		const header = ["academicYear", "campus", "gradeLevel", "className", "sectionName", "capacity", "room"];
		const csv = [header.join(","), ...rows.map((r) => header.map((h) => r[h] ?? "").join(","))].join("\n");
		const target = await createOtherOrganisation(request, calls);
		await createYear(target.client, { name: String(rows[0].academicYear) });
		(await target.client.post("/api/v1/grade-levels", { body: { name: rows[0].gradeLevel, sequenceOrder: 1, stage: "PRIMARY" } })).expectStatus([200, 201]);
		const result = await target.client.post("/api/v1/class-sections/import", { multipart: { file: { name: "class-sections.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } } });
		result.expectStatus(200).expectJson((report) => expect(report.map((r: { status: string }) => r.status)).toEqual(rows.map(() => "IMPORTED")));
		(await target.client.get("/api/v1/class-sections/export")).expectJson((after) => expect(after.map((r: { sectionName: string }) => r.sectionName).sort()).toEqual(rows.map((r) => r.sectionName).sort()));
		expect(base.classId).toBeGreaterThan(0);
	});

	test("ACA-12 a row naming a year or grade that does not exist is reported as an error with a reason", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const csv = "academicYear,campus,gradeLevel,className,sectionName,capacity,room\nNo such year,Main Campus,No such grade,Nine,A,30,R1\n";
		(await org.client.post("/api/v1/class-sections/import", { multipart: { file: { name: "class-sections.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } } })).expectStatus(200).expectJson((report) => {
			expect(report[0]).toMatchObject({ row: 2, status: "ERROR" });
			expect(report[0].message).toEqual(expect.any(String));
		});
	});
});

test.describe("setup status", () => {
	test("ACA-13 a new organisation is not yet configured and becomes configured once classes and sections exist", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/academics/setup-status")).expectStatus(200).expectJson((status) => expect(status.configured).toBe(false));
		await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.get("/api/v1/academics/setup-status")).expectJson((status) => expect(status.configured).toBe(true));
	});
});
