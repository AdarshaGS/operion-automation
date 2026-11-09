// Builds a minimal academic structure (year, grade, class, sections, subject, teacher) inside
// an organisation, so each spec starts from known ids instead of depending on the shared seed.

import type { ApiClient } from "./apiClient";
import { uniqueCode, uniqueSuffix } from "./data";

export interface AcademicBase {
	campusId: number;
	yearId: number;
	gradeId: number;
	classId: number;
	sectionId: number;
	secondSectionId: number;
	subjectId: number;
	secondSubjectId: number;
	teacherPersonId: number;
	secondTeacherPersonId: number;
}

export async function createPerson(client: ApiClient, firstName = "Auto", extra: Record<string, unknown> = {}): Promise<number> {
	const created = await client.post("/api/v1/persons", { body: { firstName, lastName: uniqueCode("P"), dateOfBirth: "2014-03-02", gender: "MALE", ...extra } });
	created.expectStatus([200, 201]);
	return created.body.id;
}

/**
 * Operion rejects an academic year whose dates overlap another one in the same organisation (ACA-02), so a
 * caller that does not care about the dates gets the 2026 default when it is free and otherwise a one-year
 * window in a random far-future year. Callers that pass startDate/endDate get exactly those dates.
 */
export async function createYear(client: ApiClient, overrides: Record<string, unknown> = {}): Promise<{ id: number; name: string }> {
	const explicit = "startDate" in overrides || "endDate" in overrides;
	let startDate = "2026-04-01";
	let endDate = "2027-03-31";
	for (let attempt = 0; ; attempt++) {
		const created = await client.post("/api/v1/academic-years", { body: { name: `Year ${uniqueSuffix()}`, startDate, endDate, ...overrides } });
		if (created.status === 409 && !explicit && attempt < 30) {
			const year = 2100 + Math.floor(Math.random() * 6900);
			startDate = `${year}-04-01`;
			endDate = `${year + 1}-03-31`;
			continue;
		}
		created.expectStatus([200, 201]);
		return created.body;
	}
}

/** An open year whose dates include today, reusing one the organisation already has (years may not overlap). For
 * screens that always work on today's date, such as quick attendance marking. */
export async function yearCoveringToday(client: ApiClient): Promise<{ id: number; name: string }> {
	const today = new Date().toISOString().slice(0, 10);
	const years = (await client.get("/api/v1/academic-years")).expectStatus(200).body as { id: number; name: string; startDate: string; endDate: string; status: string }[];
	const open = years.find((y) => y.status !== "CLOSED" && y.startDate <= today && today <= y.endDate);
	if (open) return open;
	const shift = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
	return createYear(client, { startDate: shift(-180), endDate: shift(180) });
}

/** Year (current unless markCurrent is false; covering today when coverToday is set), grade, class with two sections, two subjects on the class, and two teachers assigned to the first section. */
export async function buildAcademicBase(client: ApiClient, options: { assignTeachers?: boolean; markCurrent?: boolean; coverToday?: boolean } = {}): Promise<AcademicBase> {
	const campuses = await client.get("/api/v1/campuses");
	campuses.expectStatus(200);
	const campusId: number = campuses.body[0].id;
	const year = options.coverToday ? await yearCoveringToday(client) : await createYear(client);
	if (options.markCurrent ?? true) (await client.post("/api/v1/academic-years/{id}/mark-current", { params: { id: year.id } })).expectStatus(200);

	const grade = await client.post("/api/v1/grade-levels", { body: { name: `Grade ${uniqueSuffix()}`, sequenceOrder: Math.floor(Math.random() * 2000000000) + 1, stage: "PRIMARY" } });
	grade.expectStatus([200, 201]);
	const schoolClass = await client.post("/api/v1/school-classes", { body: { academicYearId: year.id, campusId, gradeLevelId: grade.body.id, displayName: `Class ${uniqueSuffix()}` } });
	schoolClass.expectStatus([200, 201]);
	const classId: number = schoolClass.body.id;
	const sectionA = await client.post("/api/v1/school-classes/{classId}/sections", { params: { classId }, body: { name: "A", capacity: 30, room: "R1" } });
	const sectionB = await client.post("/api/v1/school-classes/{classId}/sections", { params: { classId }, body: { name: "B", capacity: 30, room: "R2" } });
	sectionA.expectStatus([200, 201]);
	sectionB.expectStatus([200, 201]);

	const subject = await client.post("/api/v1/subjects", { body: { name: `Subject ${uniqueSuffix()}`, code: uniqueCode("S") } });
	const second = await client.post("/api/v1/subjects", { body: { name: `Subject ${uniqueSuffix()}`, code: uniqueCode("S") } });
	subject.expectStatus([200, 201]);
	second.expectStatus([200, 201]);
	for (const subjectId of [subject.body.id, second.body.id]) {
		(await client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId }, body: { subjectId, mandatory: true } })).expectStatus([200, 201]);
	}

	const teacherPersonId = await createPerson(client, "Tara");
	const secondTeacherPersonId = await createPerson(client, "Tej");
	if (options.assignTeachers ?? true) {
		for (const [sectionId, teacher] of [[sectionA.body.id, teacherPersonId], [sectionB.body.id, teacherPersonId], [sectionA.body.id, secondTeacherPersonId]] as const) {
			for (const subjectId of [subject.body.id, second.body.id]) {
				(await client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId }, body: { subjectId, teacherPersonId: teacher, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
			}
		}
	}
	return {
		campusId,
		yearId: year.id,
		gradeId: grade.body.id,
		classId,
		sectionId: sectionA.body.id,
		secondSectionId: sectionB.body.id,
		subjectId: subject.body.id,
		secondSubjectId: second.body.id,
		teacherPersonId,
		secondTeacherPersonId,
	};
}

/** Adds one more grade level; a class is unique per year, campus and grade, so extra classes need their own grade. */
export async function createGrade(client: ApiClient, stage = "PRIMARY"): Promise<number> {
	const grade = await client.post("/api/v1/grade-levels", { body: { name: `Grade ${uniqueSuffix()}`, sequenceOrder: Math.floor(Math.random() * 2000000000) + 1, stage } });
	grade.expectStatus([200, 201]);
	return grade.body.id;
}

export async function createPeriod(client: ApiClient, ordinal: number, start: string, end: string, extra: Record<string, unknown> = {}) {
	const created = await client.post("/api/v1/timetable/periods", { body: { ordinal, label: `P${ordinal}`, startTime: start, endTime: end, breakSlot: false, ...extra } });
	created.expectStatus([200, 201]);
	return created.body as { id: number; ordinal: number };
}

/** Admits a student (person + student) and enrols them in a section. */
export async function enrolStudent(client: ApiClient, base: Pick<AcademicBase, "yearId" | "sectionId">, options: { rollNumber?: number; enrolledDate?: string } = {}): Promise<{ studentId: number; enrollmentId: number; personId: number }> {
	const personId = await createPerson(client, "Pupil");
	const student = await client.post("/api/v1/students", { body: { personId, admissionNumber: uniqueCode("ADM"), admissionDate: "2026-06-01" } });
	student.expectStatus([200, 201]);
	const enrollment = await client.post("/api/v1/students/{studentId}/enrollments", { params: { studentId: student.body.id }, body: { academicYearId: base.yearId, sectionId: base.sectionId, rollNumber: options.rollNumber ?? 1, enrolledDate: options.enrolledDate ?? "2026-06-01" } });
	enrollment.expectStatus([200, 201]);
	return { studentId: student.body.id, enrollmentId: enrollment.body.id, personId };
}
