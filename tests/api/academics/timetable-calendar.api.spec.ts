// Timetable, teacher assignments, working calendar, school events, academic settings, plus access
// control and tenant isolation for the whole Academics module. IDs refer to docs/SCENARIOS.md
// section 4 (ACA-*). Everything that changes data runs in throwaway organisations.

import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { buildAcademicBase, createPeriod, createYear, type AcademicBase } from "../../../src/api/academics";
import { expectShape } from "../../../src/api/shapes";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";

const BAD = [400, 422];
const TIMETABLE = "/api/v1/sections/{sectionId}/timetable";

function put(client: ApiClient, sectionId: number, subjectId: number, teacherPersonId: number, dayOfWeek: string, periodId: number) {
	return client.put(TIMETABLE, { params: { sectionId }, body: { subjectId, teacherPersonId, dayOfWeek, periodId } });
}

function assign(client: ApiClient, sectionId: number, subjectId: number | null, teacherPersonId: number, extra: Record<string, unknown> = {}) {
	return client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId }, body: { subjectId, teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01", ...extra } });
}

async function withBase(client: ApiClient): Promise<AcademicBase & { period1: number; period2: number; breakPeriod: number }> {
	const base = await buildAcademicBase(client);
	const period1 = await createPeriod(client, 1, "09:00", "09:45");
	const period2 = await createPeriod(client, 2, "09:45", "10:30");
	const breakPeriod = await createPeriod(client, 3, "10:30", "10:45", { breakSlot: true });
	return { ...base, period1: period1.id, period2: period2.id, breakPeriod: breakPeriod.id };
}

test.describe("timetable periods", () => {
	test("ACA-17 creates, lists in ordinal order, updates and deletes a period", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const second = await createPeriod(org.client, 2, "09:45", "10:30");
		const first = await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "First", startTime: "09:00", endTime: "09:45", breakSlot: false } });
		first.expectStatus([200, 201]).expectJson((period) => {
			expectShape(period, { id: "number", ordinal: "number", label: "string", startTime: "string", endTime: "string", breakSlot: "boolean" });
			expect(period).toMatchObject({ ordinal: 1, label: "First", breakSlot: false });
			expect(period.startTime).toMatch(/^09:00/);
		});
		(await org.client.get("/api/v1/timetable/periods")).expectJson((list) => expect(list.map((p: { id: number }) => p.id)).toEqual([first.body.id, second.id]));
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: first.body.id }, body: { label: "Assembly", startTime: "08:30", endTime: "09:00", breakSlot: true } })).expectStatus(200).expectJson((period) => {
			expect(period).toMatchObject({ label: "Assembly", breakSlot: true });
			expect(period.startTime).toMatch(/^08:30/);
		});
		(await org.client.delete("/api/v1/timetable/periods/{id}", { params: { id: first.body.id } })).expectStatus([200, 204]);
		(await org.client.get("/api/v1/timetable/periods")).expectJson((list) => expect(list.map((p: { id: number }) => p.id)).toEqual([second.id]));
	});

	test("ACA-17 an end time at or before the start time returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 1, startTime: "10:00", endTime: "09:00" } })).expectStatus(BAD);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 2, startTime: "10:00", endTime: "10:00" } })).expectStatus(BAD);
	});

	test("ACA-17 updating a period to end before it starts returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const period = await createPeriod(org.client, 1, "09:00", "09:45");
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: period.id }, body: { label: "L", startTime: "10:00", endTime: "09:00" } })).expectStatus(BAD);
	});

	test("ACA-17 a duplicate ordinal returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await createPeriod(org.client, 1, "09:00", "09:45");
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 1, startTime: "11:00", endTime: "11:45" } })).expectStatus(409);
	});

	test("ACA-17 a missing ordinal, start or end time returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", startTime: "09:00", endTime: "09:45" } })).expectStatus(BAD);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 1, endTime: "09:45" } })).expectStatus(BAD);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 1, startTime: "09:00" } })).expectStatus(BAD);
	});

	test("ACA-17 a negative ordinal returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: -1, startTime: "09:00", endTime: "09:45" } })).expectStatus(BAD);
	});

	test("ACA-17 periods whose times overlap are rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await createPeriod(org.client, 1, "09:00", "09:45");
		(await org.client.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 2, startTime: "09:30", endTime: "10:15" } })).expectStatus([400, 409, 422]);
	});

	test("ACA-17 updating or deleting an unknown period returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: 99999999 }, body: { label: "L", startTime: "09:00", endTime: "09:45" } })).expectStatus(404);
		(await org.client.delete("/api/v1/timetable/periods/{id}", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("ACA-17 a period that holds timetable entries cannot be deleted", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await org.client.delete("/api/v1/timetable/periods/{id}", { params: { id: base.period1 } })).expectStatus(409);
	});
});

test.describe("section timetable", () => {
	test("ACA-18 puts an entry and reads it back, with names resolved", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		const entry = await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.period1);
		entry.expectStatus([200, 201]).expectJson((row) => {
			expectShape(row, { id: "number", sectionId: "number", sectionName: "string", className: "string", subjectId: "number", subjectName: "string", teacherPersonId: "number", teacherName: "string", dayOfWeek: "string", periodId: "number" });
			expect(row).toMatchObject({ sectionId: base.sectionId, subjectId: base.subjectId, teacherPersonId: base.secondTeacherPersonId, dayOfWeek: "MONDAY", periodId: base.period1 });
		});
		(await org.client.get(TIMETABLE, { params: { sectionId: base.sectionId } })).expectStatus(200).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).toEqual([entry.body.id]));
		(await org.client.get(TIMETABLE, { params: { sectionId: base.secondSectionId } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("ACA-18 a teacher who is not assigned to the section and subject returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(409);
	});

	test("ACA-18 a break period cannot hold a lesson", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.breakPeriod)).expectStatus([400, 409, 422]);
	});

	test("ACA-18 an invalid day name returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "FUNDAY", base.period1)).expectStatus(400);
	});

	test("ACA-18 a missing subject, teacher, day or period returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		const full = { subjectId: base.subjectId, teacherPersonId: base.secondTeacherPersonId, dayOfWeek: "MONDAY", periodId: base.period1 };
		for (const field of Object.keys(full)) {
			const body: Record<string, unknown> = { ...full };
			delete body[field];
			const result = await org.client.put(TIMETABLE, { params: { sectionId: base.sectionId }, body });
			result.expectStatus(BAD);
		}
	});

	test("ACA-18 an unknown section, period, subject or teacher returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, 99999999, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.period1)).expectStatus(404);
		(await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", 99999999)).expectStatus(404);
		(await put(org.client, base.sectionId, 99999999, base.secondTeacherPersonId, "MONDAY", base.period1)).expectStatus(404);
		(await put(org.client, base.sectionId, base.subjectId, 99999999, "MONDAY", base.period1)).expectStatus(404);
	});

	test("ACA-19 the same teacher cannot take two sections in the same period", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId)).expectStatus([200, 201]);
		(await put(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await put(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(409);
		(await org.client.get(TIMETABLE, { params: { sectionId: base.secondSectionId } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("ACA-19 the same teacher can take two sections in different periods or on different days", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId)).expectStatus([200, 201]);
		(await put(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await put(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period2)).expectStatus(200);
		(await put(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.period1)).expectStatus(200);
	});

	test("ACA-20 a second entry for the same section, day and period replaces the first", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await put(org.client, base.sectionId, base.secondSubjectId, base.secondTeacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await org.client.get(TIMETABLE, { params: { sectionId: base.sectionId } })).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(list[0].subjectId).toBe(base.secondSubjectId);
		});
	});

	test("ACA-21 deleting an entry frees the slot; deleting it again returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		(await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId)).expectStatus([200, 201]);
		const entry = await put(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1);
		(await org.client.delete("/api/v1/timetable-entries/{id}", { params: { id: entry.body.id } })).expectStatus([200, 204]);
		(await org.client.get(TIMETABLE, { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toEqual([]));
		(await put(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(200);
		(await org.client.delete("/api/v1/timetable-entries/{id}", { params: { id: entry.body.id } })).expectStatus(404);
	});

	test("ACA-22 the teacher's timetable lists only that teacher's entries and can be filtered by year", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await withBase(org.client);
		const entry = await put(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "WEDNESDAY", base.period2);
		(await org.client.get("/api/v1/teachers/{personId}/timetable", { params: { personId: base.secondTeacherPersonId } })).expectStatus(200).expectJson((list) => {
			expect(list.map((e: { id: number }) => e.id)).toEqual([entry.body.id]);
		});
		(await org.client.get("/api/v1/teachers/{personId}/timetable", { params: { personId: base.secondTeacherPersonId }, query: { academicYearId: base.yearId } })).expectJson((list) => expect(list).toHaveLength(1));
		const otherYear = await createYear(org.client, { startDate: "2040-04-01", endDate: "2041-03-31" });
		(await org.client.get("/api/v1/teachers/{personId}/timetable", { params: { personId: base.secondTeacherPersonId }, query: { academicYearId: otherYear.id } })).expectJson((list) => expect(list).toEqual([]));
		(await org.client.get("/api/v1/teachers/{personId}/timetable", { params: { personId: base.teacherPersonId } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("ACA-22 the timetable of an unknown teacher or section returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/teachers/{personId}/timetable", { params: { personId: 99999999 } })).expectStatus([200, 404]).expectJson((body) => expect(Array.isArray(body) ? body : []).toEqual([]));
		(await org.client.get(TIMETABLE, { params: { sectionId: 99999999 } })).expectStatus(404);
	});
});

test.describe("teacher assignments", () => {
	test("ACA-23 assigns a teacher to a section and subject; both views list it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const created = await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId);
		created.expectStatus([200, 201]).expectJson((row) => {
			expectShape(row, { id: "number", sectionId: "number", teacherPersonId: "number", assignmentType: "string", startDate: "string", status: "string" });
			expect(row).toMatchObject({ sectionId: base.sectionId, subjectId: base.subjectId, teacherPersonId: base.teacherPersonId, assignmentType: "SUBJECT", status: "ACTIVE", endDate: null });
		});
		(await org.client.get("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list.map((a: { id: number }) => a.id)).toContain(created.body.id));
		(await org.client.get("/api/v1/teachers/{personId}/assignments", { params: { personId: base.teacherPersonId } })).expectJson((list) => expect(list.map((a: { id: number }) => a.id)).toContain(created.body.id));
	});

	test("ACA-23 supports homeroom and co-teacher assignments", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await assign(org.client, base.sectionId, null, base.teacherPersonId, { assignmentType: "HOMEROOM" })).expectStatus([200, 201]).expectJson((row) => expect(row.assignmentType).toBe("HOMEROOM"));
		(await assign(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, { assignmentType: "CO_TEACHER" })).expectStatus([200, 201]).expectJson((row) => expect(row.assignmentType).toBe("CO_TEACHER"));
	});

	test("ACA-23 a new subject assignment ends the previous teacher's assignment for that section and subject", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const first = await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId);
		const second = await assign(org.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, { startDate: "2026-07-01" });
		second.expectStatus([200, 201]);
		(await org.client.get("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId } })).expectJson((list) => {
			expect(list.find((a: { id: number }) => a.id === first.body.id)).toMatchObject({ status: "ENDED" });
			expect(list.find((a: { id: number }) => a.id === second.body.id)).toMatchObject({ status: "ACTIVE" });
		});
	});

	test("ACA-23 ends an assignment, and ending it again returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const created = await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId);
		(await org.client.post("/api/v1/teacher-assignments/{id}/end", { params: { id: created.body.id }, body: { endDate: "2026-12-01" } })).expectStatus(200).expectJson((row) => expect(row).toMatchObject({ status: "ENDED", endDate: "2026-12-01" }));
		(await org.client.post("/api/v1/teacher-assignments/{id}/end", { params: { id: created.body.id }, body: { endDate: "2026-12-02" } })).expectStatus(409);
	});

	test("ACA-23 an assignment cannot end before it starts", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const created = await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId);
		(await org.client.post("/api/v1/teacher-assignments/{id}/end", { params: { id: created.body.id }, body: { endDate: "2026-01-01" } })).expectStatus(BAD);
	});

	test("ACA-23 a subject assignment without a subject returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await assign(org.client, base.sectionId, null, base.teacherPersonId)).expectStatus(BAD);
	});

	test("ACA-23 a missing start date or teacher returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId }, body: { subjectId: base.subjectId, teacherPersonId: base.teacherPersonId, assignmentType: "SUBJECT" } })).expectStatus(BAD);
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId }, body: { subjectId: base.subjectId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus(BAD);
	});

	test("ACA-23 an unknown assignment type returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await assign(org.client, base.sectionId, base.subjectId, base.teacherPersonId, { assignmentType: "WIZARD" })).expectStatus(400);
	});

	test("ACA-23 an unknown section, subject, teacher or assignment returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await assign(org.client, 99999999, base.subjectId, base.teacherPersonId)).expectStatus(404);
		(await assign(org.client, base.sectionId, 99999999, base.teacherPersonId)).expectStatus(404);
		(await assign(org.client, base.sectionId, base.subjectId, 99999999)).expectStatus(404);
		(await org.client.post("/api/v1/teacher-assignments/{id}/end", { params: { id: 99999999 }, body: { endDate: "2026-12-01" } })).expectStatus(404);
	});
});

test.describe("working calendar", () => {
	test("ACA-15 adds a holiday, lists it for the year and deletes it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const created = await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, date: "2026-08-15", label: "Independence Day", type: "HOLIDAY" } });
		created.expectStatus([200, 201]).expectJson((entry) => {
			expectShape(entry, { id: "number", academicYearId: "number", date: "string", label: "string", type: "string" });
			expect(entry).toMatchObject({ academicYearId: base.yearId, date: "2026-08-15", label: "Independence Day", type: "HOLIDAY" });
		});
		(await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, date: "2026-11-14", label: "Saturday class", type: "SPECIAL_WORKING_DAY" } })).expectStatus([200, 201]);
		(await org.client.get("/api/v1/academic/working-calendar", { query: { academicYearId: base.yearId } })).expectJson((list) => expect(list.map((e: { date: string }) => e.date).sort()).toEqual(["2026-08-15", "2026-11-14"]));
		(await org.client.delete("/api/v1/academic/working-calendar/{id}", { params: { id: created.body.id } })).expectStatus([200, 204]);
		(await org.client.get("/api/v1/academic/working-calendar", { query: { academicYearId: base.yearId } })).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).not.toContain(created.body.id));
	});

	test("ACA-15 listing needs an academic year", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/academic/working-calendar")).expectStatus(400);
	});

	test("ACA-15 an unknown year returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: 99999999, date: "2026-08-15", label: "x", type: "HOLIDAY" } })).expectStatus(404);
	});

	test("ACA-15 an unknown type returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, date: "2026-08-15", label: "x", type: "PARTY" } })).expectStatus(400);
	});

	test("ACA-15 a missing date returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, label: "x", type: "HOLIDAY" } })).expectStatus(BAD);
	});

	test("ACA-15 a date outside the academic year returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		(await org.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, date: "2035-01-01", label: "Far away", type: "HOLIDAY" } })).expectStatus(BAD);
	});

	test("ACA-15 a second rule for the same date returns 409", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const body = { academicYearId: base.yearId, date: "2026-10-02", label: "Gandhi Jayanti", type: "HOLIDAY" };
		(await org.client.post("/api/v1/academic/working-calendar", { body })).expectStatus([200, 201]);
		(await org.client.post("/api/v1/academic/working-calendar", { body })).expectStatus(409);
	});

	test("ACA-15 deleting an unknown rule is a no-op or 404, never an error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.delete("/api/v1/academic/working-calendar/{id}", { params: { id: 99999999 } })).expectStatus([200, 204, 404]);
	});
});

test.describe("school events", () => {
	test("ACA-16 adds an event, lists it by date range and deletes it", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const created = await org.client.post("/api/v1/academic/school-events", { body: { date: "2026-09-05", title: "Teachers Day", description: "Assembly at 9" } });
		created.expectStatus([200, 201]).expectJson((event) => {
			expectShape(event, { id: "number", date: "string", title: "string" });
			expect(event).toMatchObject({ date: "2026-09-05", title: "Teachers Day", description: "Assembly at 9", campusId: null });
		});
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-09-01", to: "2026-09-30" } })).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).toContain(created.body.id));
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-10-01", to: "2026-10-31" } })).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).not.toContain(created.body.id));
		(await org.client.delete("/api/v1/academic/school-events/{id}", { params: { id: created.body.id } })).expectStatus([200, 204]);
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-09-01", to: "2026-09-30" } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("ACA-16 the range is inclusive at both ends", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/academic/school-events", { body: { date: "2026-09-01", title: "First" } });
		await org.client.post("/api/v1/academic/school-events", { body: { date: "2026-09-30", title: "Last" } });
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-09-01", to: "2026-09-30" } })).expectJson((list) => expect(list.map((e: { title: string }) => e.title).sort()).toEqual(["First", "Last"]));
	});

	test("ACA-16 a range with from after to returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-10-01", to: "2026-09-01" } })).expectStatus(400);
	});

	test("ACA-16 a missing or malformed range returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/academic/school-events")).expectStatus(400);
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "2026-09-01" } })).expectStatus(400);
		(await org.client.get("/api/v1/academic/school-events", { query: { from: "soon", to: "later" } })).expectStatus(400);
	});

	test("ACA-16 a missing title or date returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/academic/school-events", { body: { date: "2026-09-05" } })).expectStatus(BAD);
		(await org.client.post("/api/v1/academic/school-events", { body: { title: "No date" } })).expectStatus(BAD);
	});

	test("ACA-16 an event can belong to one campus; an unknown campus returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campus = (await org.client.get("/api/v1/campuses")).body[0].id;
		(await org.client.post("/api/v1/academic/school-events", { body: { campusId: campus, date: "2026-09-05", title: "Campus day" } })).expectStatus([200, 201]).expectJson((event) => expect(event.campusId).toBe(campus));
		(await org.client.post("/api/v1/academic/school-events", { body: { campusId: 99999999, date: "2026-09-05", title: "Nowhere" } })).expectStatus(404);
	});
});

test.describe("academic settings", () => {
	test("ACA-14 reads and updates the school day, keeping untouched fields", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/academic/settings")).expectStatus(200).expectJson((settings) => expect(settings).toEqual({ schoolStartTime: null, schoolEndTime: null }));
		(await org.client.patch("/api/v1/academic/settings", { body: { schoolStartTime: "08:30", schoolEndTime: "15:00" } })).expectStatus(200).expectJson((settings) => {
			expect(settings.schoolStartTime).toMatch(/^08:30/);
			expect(settings.schoolEndTime).toMatch(/^15:00/);
		});
		(await org.client.patch("/api/v1/academic/settings", { body: { schoolStartTime: "09:00" } })).expectStatus(200).expectJson((settings) => {
			expect(settings.schoolStartTime).toMatch(/^09:00/);
			expect(settings.schoolEndTime).toMatch(/^15:00/);
		});
		(await org.client.get("/api/v1/academic/settings")).expectJson((settings) => expect(settings.schoolStartTime).toMatch(/^09:00/));
	});

	test("ACA-14 an end time before the start time returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/academic/settings", { body: { schoolStartTime: "15:00", schoolEndTime: "08:00" } })).expectStatus(BAD);
	});

	test("ACA-14 a malformed time returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/academic/settings", { body: { schoolStartTime: "breakfast" } })).expectStatus(BAD);
	});

	test("ACA-14 settings are per organisation", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);
		await a.client.patch("/api/v1/academic/settings", { body: { schoolStartTime: "07:15", schoolEndTime: "13:00" } });
		(await b.client.get("/api/v1/academic/settings")).expectJson((settings) => expect(settings.schoolStartTime).toBeNull());
	});
});

test.describe("access control", () => {
	const writes: { title: string; call: (c: ApiClient, ids: { yearId: number; classId: number; sectionId: number }) => Promise<{ status: number }> }[] = [
		{ title: "create an academic year", call: (c) => c.post("/api/v1/academic-years", { body: { name: `Denied ${uniqueSuffix()}`, startDate: "2090-04-01", endDate: "2091-03-31" } }) },
		{ title: "mark a year current", call: (c, i) => c.post("/api/v1/academic-years/{id}/mark-current", { params: { id: i.yearId } }) },
		{ title: "close a year", call: (c, i) => c.post("/api/v1/academic-years/{id}/close", { params: { id: i.yearId } }) },
		{ title: "create a campus", call: (c) => c.post("/api/v1/campuses", { body: { name: `Denied ${uniqueSuffix()}`, code: uniqueCode("D") } }) },
		{ title: "create a grade level", call: (c) => c.post("/api/v1/grade-levels", { body: { name: `Denied ${uniqueSuffix()}`, sequenceOrder: 90001, stage: "PRIMARY" } }) },
		{ title: "create a class", call: (c, i) => c.post("/api/v1/school-classes", { body: { academicYearId: i.yearId, campusId: 1, gradeLevelId: 1, displayName: "Denied" } }) },
		{ title: "rename a class", call: (c, i) => c.patch("/api/v1/school-classes/{id}", { params: { id: i.classId }, body: { displayName: "Denied" } }) },
		{ title: "create a section", call: (c, i) => c.post("/api/v1/school-classes/{classId}/sections", { params: { classId: i.classId }, body: { name: "Denied", capacity: 10 } }) },
		{ title: "create a subject", call: (c) => c.post("/api/v1/subjects", { body: { name: `Denied ${uniqueSuffix()}`, code: uniqueCode("D") } }) },
		{ title: "add a subject to a class", call: (c, i) => c.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: i.classId }, body: { subjectId: 1, mandatory: true } }) },
		{ title: "create a timetable period", call: (c) => c.post("/api/v1/timetable/periods", { body: { label: "L", ordinal: 91, startTime: "20:00", endTime: "20:45" } }) },
		{ title: "put a timetable entry", call: (c, i) => put(c, i.sectionId, 1, 1, "MONDAY", 1) },
		{ title: "assign a teacher", call: (c, i) => assign(c, i.sectionId, 1, 1) },
		{ title: "add a working-calendar rule", call: (c, i) => c.post("/api/v1/academic/working-calendar", { body: { academicYearId: i.yearId, date: "2026-12-25", label: "Denied", type: "HOLIDAY" } }) },
		{ title: "add a school event", call: (c) => c.post("/api/v1/academic/school-events", { body: { date: "2026-12-25", title: "Denied" } }) },
		{ title: "change academic settings", call: (c) => c.patch("/api/v1/academic/settings", { body: { schoolStartTime: "06:00" } }) },
		{ title: "import subjects", call: (c) => c.post("/api/v1/subjects/import", { multipart: { file: { name: "s.csv", mimeType: "text/csv", buffer: Buffer.from("name,code\nDenied,DEN\n") } } }) },
	];
	for (const role of ["noPermissions", "readOnlyStaff"] as const) {
		for (const write of writes) {
			test(`ACA-25 ${role} cannot ${write.title}`, async ({ as, seed }) => {
				const result = await write.call(as(role), { yearId: seed.academicYearId, classId: seed.classId, sectionId: seed.sectionId });
				expect(result.status).toBe(403);
			});
		}
	}

	test("ACA-25 view permissions allow reading classes, grade levels, subjects and teacher assignments", async ({ as, seed }) => {
		const viewer = as("readOnlyStaff");
		(await viewer.get("/api/v1/school-classes")).expectStatus(200);
		(await viewer.get("/api/v1/grade-levels")).expectStatus(200);
		(await viewer.get("/api/v1/subjects")).expectStatus(200);
		(await viewer.get("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: seed.sectionId } })).expectStatus(200);
	});

	test("ACA-25 a user without permissions cannot read classes, grade levels or subjects", async ({ as }) => {
		const nobody = as("noPermissions");
		(await nobody.get("/api/v1/school-classes")).expectStatus(403);
		(await nobody.get("/api/v1/grade-levels")).expectStatus(403);
		(await nobody.get("/api/v1/subjects")).expectStatus(403);
	});

	test("ACA-25 anonymous requests are rejected with 401", async ({ anon }) => {
		(await anon.get("/api/v1/academic-years")).expectStatus(401);
		(await anon.get("/api/v1/school-classes")).expectStatus(401);
		(await anon.post("/api/v1/academic-years", { body: { name: "x", startDate: "2026-04-01", endDate: "2027-03-31" } })).expectStatus(401);
	});
});

test.describe("tenant isolation", () => {
	test("ACA-26 another organisation cannot see, change or use this organisation's academic data", async ({ request, calls }) => {
		const owner = await createOtherOrganisation(request, calls);
		const intruder = await createOtherOrganisation(request, calls);
		const base = await withBase(owner.client);

		const years = (await intruder.client.get("/api/v1/academic-years")).body.map((y: { id: number }) => y.id);
		expect(years).not.toContain(base.yearId);
		const classes = (await intruder.client.get("/api/v1/school-classes")).body.map((c: { id: number }) => c.id);
		expect(classes).not.toContain(base.classId);
		const subjects = (await intruder.client.get("/api/v1/subjects")).body.map((s: { id: number }) => s.id);
		expect(subjects).not.toContain(base.subjectId);
		const periods = (await intruder.client.get("/api/v1/timetable/periods")).body.map((p: { id: number }) => p.id);
		expect(periods).not.toContain(base.period1);

		(await intruder.client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: base.yearId } })).expectStatus(404);
		(await intruder.client.post("/api/v1/academic-years/{id}/close", { params: { id: base.yearId } })).expectStatus(404);
		(await intruder.client.patch("/api/v1/school-classes/{id}", { params: { id: base.classId }, body: { displayName: "Hijacked" } })).expectStatus(404);
		(await intruder.client.get("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId } })).expectStatus([200, 404]).expectJson((body) => expect(Array.isArray(body) ? body : []).toEqual([]));
		(await intruder.client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: base.classId }, body: { name: "Z", capacity: 10 } })).expectStatus(404);
		(await intruder.client.get(TIMETABLE, { params: { sectionId: base.sectionId } })).expectStatus([200, 404]).expectJson((body) => expect(Array.isArray(body) ? body : []).toEqual([]));
		(await put(intruder.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.period1)).expectStatus(404);
		(await intruder.client.get("/api/v1/sections/{sectionId}/enrollments", { params: { sectionId: base.sectionId } })).expectStatus([200, 404]).expectJson((body) => expect(Array.isArray(body) ? body : []).toEqual([]));
		(await intruder.client.post("/api/v1/academic/working-calendar", { body: { academicYearId: base.yearId, date: "2026-08-15", label: "x", type: "HOLIDAY" } })).expectStatus(404);
		(await owner.client.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).expectJson((list) => expect(list.find((c: { id: number }) => c.id === base.classId).displayName).not.toBe("Hijacked"));
	});

	test("ACA-26 another organisation cannot delete this organisation's timetable entry or period", async ({ request, calls }) => {
		const owner = await createOtherOrganisation(request, calls);
		const intruder = await createOtherOrganisation(request, calls);
		const base = await withBase(owner.client);
		const entry = await put(owner.client, base.sectionId, base.subjectId, base.secondTeacherPersonId, "MONDAY", base.period1);
		(await intruder.client.delete("/api/v1/timetable-entries/{id}", { params: { id: entry.body.id } })).expectStatus(404);
		(await intruder.client.delete("/api/v1/timetable/periods/{id}", { params: { id: base.period2 } })).expectStatus(404);
		(await owner.client.get(TIMETABLE, { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toHaveLength(1));
	});
});
