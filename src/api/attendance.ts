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

export async function attendanceSetup(api: ApiClient, students = 3, enrolledDay = 1): Promise<AttendanceSetup> {
	const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
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
