// Examination fixtures: a draft-year class with students (shared organisation only, Operion #354),
// an exam with one schedule per subject, and a grading scale.

import type { ApiClient } from "./apiClient";
import { attendanceSetup, type AttendanceSetup } from "./attendance";
import { uniqueSuffix } from "./data";

export const BANDS = [
	{ grade: "A", minPercentage: 90, remark: "Outstanding" },
	{ grade: "B", minPercentage: 75, remark: "Very good" },
	{ grade: "C", minPercentage: 50, remark: "Good" },
	{ grade: "F", minPercentage: 0, remark: "Fail" },
];

export async function createGradingScale(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post("/api/v1/examinations/grading-scales", { body: { name: `Scale ${uniqueSuffix()}`, defaultScale: false, bands: BANDS, ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; name: string; defaultScale: boolean; bands: typeof BANDS };
}

export async function createExam(api: ApiClient, yearId: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post("/api/v1/examinations/exams", { body: { academicYearId: yearId, name: `Exam ${uniqueSuffix()}`, examType: "MID_TERM", ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; academicYearId: number; name: string; examType: string; status: string };
}

export interface ExamSetup extends AttendanceSetup {
	exam: { id: number; name: string };
	scale: { id: number; name: string };
	subjectNames: [string, string];
	/** One schedule per subject: maths-like (max 100, pass 35) and science-like (max 50, pass 20). */
	schedules: { id: number; subjectId: number; maxMarks: number; passMarks: number }[];
}

export async function examSetup(api: ApiClient, students = 2): Promise<ExamSetup> {
	const s = await attendanceSetup(api, students);
	const exam = await createExam(api, s.yearId);
	const scale = await createGradingScale(api);
	const schedules = [];
	for (const [subjectId, maxMarks, passMarks] of [[s.base.subjectId, 100, 35], [s.base.secondSubjectId, 50, 20]] as const) {
		const res = await api.post("/api/v1/examinations/exams/{examId}/schedules", { params: { examId: exam.id }, body: { schoolClassId: s.base.classId, sectionId: null, subjectId, examDate: s.day(20), maxMarks, passMarks } });
		res.expectStatus([200, 201]);
		schedules.push({ id: res.body.id, subjectId, maxMarks, passMarks });
	}
	const subjects = (await api.get("/api/v1/subjects")).expectStatus(200).body;
	const nameOf = (id: number): string => subjects.find((x: { id: number }) => x.id === id).name;
	return { ...s, exam, scale, schedules, subjectNames: [nameOf(s.base.subjectId), nameOf(s.base.secondSubjectId)] };
}

export function markRows(setup: AttendanceSetup, marksObtained: (number | null)[], extra: { absent?: boolean[] } = {}) {
	return marksObtained.map((m, i) => ({ studentEnrollmentId: setup.enrollmentIds[i], marksObtained: m, absent: extra.absent?.[i] ?? false, remarks: null }));
}

/** Enters marks for one schedule, submits and approves it (the three steps before a report card can be published). */
export async function approveSchedule(api: ApiClient, setup: ExamSetup, scheduleIndex: number, marksObtained: number[]) {
	const id = setup.schedules[scheduleIndex].id;
	(await api.post("/api/v1/examinations/schedules/{scheduleId}/marks", { params: { scheduleId: id }, body: { marks: markRows(setup, marksObtained) } })).expectStatus([200, 201]);
	(await api.post("/api/v1/examinations/schedules/{scheduleId}/submit", { params: { scheduleId: id } })).expectStatus(200);
	(await api.post("/api/v1/examinations/schedules/{scheduleId}/approve", { params: { scheduleId: id } })).expectStatus(200);
}
