// Learning fixtures: homework, quizzes, lesson plans and the guardian who answers for a student in the
// portal. Students exist only in the shared organisation (Operion #354), so every scenario builds its own
// draft-year section there with attendanceSetup.

import { expect } from "@playwright/test";
import type { ApiClient } from "./apiClient";
import type { AttendanceSetup } from "./attendance";
import { uniqueCode, uniqueSuffix } from "./data";
import { createGuardian, guardianLink } from "./students";
import { FIXED_PASSWORD } from "../setup/roles";

export const LEARNING = "/api/v1/learning";
export const CHILD = "/api/v1/me/children/{studentId}";

export const today = () => new Date().toISOString().slice(0, 10);
/** An ISO instant `minutes` from now (negative for the past). */
export const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export async function createHomework(api: ApiClient, s: AttendanceSetup, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LEARNING}/homework`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: `Homework ${uniqueSuffix()}`, description: "Exercise 1 to 5", dueDate: s.day(15), ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; title: string; status: string; dueDate: string };
}

export function questionBody(s: AttendanceSetup, overrides: Record<string, unknown> = {}) {
	return { subjectId: s.base.subjectId, text: `Question ${uniqueSuffix()}`, marks: 2, options: [{ text: "Right", correct: true }, { text: "Wrong", correct: false }], ...overrides };
}

export interface Question {
	id: number;
	marks: number;
	options: { id: number; text: string; correct: boolean }[];
}

/** A draft quiz, open from an hour ago to an hour from now unless the window is overridden. */
export async function createQuiz(api: ApiClient, s: AttendanceSetup, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LEARNING}/quizzes`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: `Quiz ${uniqueSuffix()}`, instructions: "Pick one answer", opensAt: inMinutes(-60), closesAt: inMinutes(60), ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; title: string; status: string; availability: string };
}

export async function addQuestion(api: ApiClient, s: AttendanceSetup, quizId: number, overrides: Record<string, unknown> = {}): Promise<Question> {
	const res = await api.post(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quizId }, body: questionBody(s, overrides) });
	res.expectStatus(200);
	return res.body;
}

export async function publishQuiz(api: ApiClient, quizId: number) {
	(await api.post(`${LEARNING}/quizzes/{id}/publish`, { params: { id: quizId } })).expectStatus(200);
}

/** A published, currently open quiz with two questions worth 2 and 3 marks. */
export async function openQuiz(api: ApiClient, s: AttendanceSetup) {
	const quiz = await createQuiz(api, s);
	const questions = [await addQuestion(api, s, quiz.id, { marks: 2 }), await addQuestion(api, s, quiz.id, { marks: 3 })];
	await publishQuiz(api, quiz.id);
	return { quiz, questions };
}

export const rightAnswer = (q: Question) => ({ questionId: q.id, optionId: q.options.find((o) => o.correct)!.id });
export const wrongAnswer = (q: Question) => ({ questionId: q.id, optionId: q.options.find((o) => !o.correct)!.id });

export async function createLessonPlan(api: ApiClient, s: AttendanceSetup, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LEARNING}/lesson-plans`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(12), title: `Plan ${uniqueSuffix()}`, objectives: "Fractions", activities: "Group work", resources: "Workbook", ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; status: string; title: string };
}

export interface PortalGuardian {
	guardianId: number;
	email: string;
	client: ApiClient;
}

/** A guardian linked to `studentId`, granted portal access and signed in through the claim link. */
export async function portalGuardian(api: ApiClient, anon: ApiClient, organisationSlug: string, studentId: number): Promise<PortalGuardian> {
	const email = `guardian-${uniqueCode("g").toLowerCase()}@example.test`;
	const guardian = await createGuardian(api, { email });
	(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: guardianLink(guardian.id) })).expectStatus(200);
	const grant = await api.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: guardian.id } });
	grant.expectStatus(200);
	const claim = await anon.post("/api/v1/auth/claim-invite", { body: { organisationSlug, token: grant.body.claimToken, password: FIXED_PASSWORD } });
	claim.expectStatus(200);
	expect(claim.body.token).toEqual(expect.any(String));
	return { guardianId: guardian.id, email, client: api.withToken(claim.body.token, "guardian") };
}

/** Makes `personId` the teacher of one subject in one section. */
export async function assignTeacher(api: ApiClient, sectionId: number, subjectId: number, personId: number) {
	(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId }, body: { subjectId, teacherPersonId: personId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
}
