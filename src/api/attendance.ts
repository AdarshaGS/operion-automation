// Attendance fixtures. Students (and so enrolments) can only be created in the shared organisation
// (Operion #354), so every scenario builds its own draft-year structure there; the register is unique per
// section and date, so a fresh section keeps reruns independent.

import type { ApiClient } from "./apiClient";
import { buildAcademicBase, enrolStudent, type AcademicBase } from "./academics";

export interface AttendanceSetup {
	base: AcademicBase;
	sectionId: number;
	yearId: number;
	enrollmentIds: number[];
	studentIds: number[];
	/** What the class dropdown, section dropdown and student rows show on screen. */
	className: string;
	sectionName: string;
	studentNames: string[];
	/** `day(10)` is the 10th of the draft year's first month. */
	day: (dayOfMonth: number) => string;
	year: number;
	month: number;
	yearName: string;
}

/** `coverToday` puts the section in a year that includes today, for screens that only mark today; the default is a
 * year of its own, so registers never collide. */
export async function attendanceSetup(api: ApiClient, students = 3, enrolledDay = 1, options: { coverToday?: boolean } = {}): Promise<AttendanceSetup> {
	const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false, coverToday: options.coverToday });
	const years = (await api.get("/api/v1/academic-years")).body;
	const thisYear = years.find((y: { id: number }) => y.id === base.yearId);
	const start: string = thisYear.startDate;
	const prefix = start.slice(0, 8);
	const day = (n: number) => `${prefix}${String(n).padStart(2, "0")}`;
	const enrollmentIds: number[] = [];
	const studentIds: number[] = [];
	const studentNames: string[] = [];
	for (let i = 1; i <= students; i++) {
		const enrolled = await enrolStudent(api, base, { rollNumber: i, enrolledDate: day(enrolledDay) });
		enrollmentIds.push(enrolled.enrollmentId);
		studentIds.push(enrolled.studentId);
		const person = (await api.get("/api/v1/persons/{id}", { params: { id: enrolled.personId } })).expectStatus(200).body;
		studentNames.push(`${person.firstName} ${person.lastName}`);
	}
	const classes = (await api.get("/api/v1/school-classes")).expectStatus(200).body;
	const className: string = classes.find((c: { id: number }) => c.id === base.classId).displayName;
	return { base, className, sectionName: "A", studentNames, sectionId: base.sectionId, yearId: base.yearId, enrollmentIds, studentIds, day, yearName: thisYear.name, year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) };
}

export type Mark = { studentEnrollmentId: number; status: string; excused?: boolean; remarks?: string };

export const REGISTER = "/api/v1/attendance/sections/{sectionId}/register";

/** `excused` is sent on every mark: the endpoint answers 400 "Malformed or invalid request body" when it is left out. */
export function marks(setup: AttendanceSetup, statuses: string[]): Mark[] {
	return statuses.map((status, i) => ({ studentEnrollmentId: setup.enrollmentIds[i], status, excused: false }));
}

export async function markRegister(api: ApiClient, setup: AttendanceSetup, date: string, statuses: string[] = ["PRESENT", "ABSENT", "LATE"]) {
	const res = await api.post(REGISTER, { params: { sectionId: setup.sectionId }, body: { attendanceDate: date, marks: marks(setup, statuses) } });
	res.expectStatus(200);
	return res;
}

/** Codes a class teacher's role needs to open the register screens and mark their own section. */
export const CLASS_TEACHER_CODES = ["ATTENDANCE_VIEW", "ATTENDANCE_MARK", "CLASS_VIEW", "STUDENT_VIEW"];

/** Makes a disposable user the ACTIVE homeroom (class) teacher of the section - the only kind of teacher plain ATTENDANCE_MARK lets mark. */
export async function makeClassTeacher(api: ApiClient, sectionId: number, personId: number, startDate: string) {
	(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", {
		params: { sectionId },
		body: { subjectId: null, teacherPersonId: personId, assignmentType: "HOMEROOM", startDate },
	})).expectStatus([200, 201]);
}
