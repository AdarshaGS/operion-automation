// The student side of learning, which a guardian drives from the portal (students have no login):
// homework submission and review, quiz attempts and scoring, answer sheets. IDs refer to
// docs/SCENARIOS.md section 10 (LRN-*).

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { examSetup } from "../../../src/api/examinations";
import { CHILD, LEARNING, addQuestion, createHomework, createQuiz, openQuiz, portalGuardian, publishQuiz, rightAnswer, today, wrongAnswer } from "../../../src/api/learning";

const SUBMIT = `${CHILD}/homework/{homeworkId}/submission`;
const ATTEMPT = `${CHILD}/quizzes/{quizId}/attempt`;

test.describe("LRN-04 homework submission", () => {
	test("LRN-04 a submission before the due date is SUBMITTED and not late", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s, { dueDate: today() });
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Done" } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ submissionStatus: "SUBMITTED", late: false, submissionText: "Done" });
		});
		(await api.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.id } })).expectJson((rows) => {
			expect(rows[0]).toMatchObject({ studentId: s.studentIds[0], status: "SUBMITTED", late: false, submissionText: "Done" });
		});
	});

	test("LRN-04 a submission after the due date is flagged late", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s, { dueDate: "2020-01-01" });
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Sorry" } })).expectStatus(200).expectJson((body) => expect(body.late).toBe(true));
	});

	test("LRN-04 the guardian sees the child's homework list with each status", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		(await g.client.get(`${CHILD}/homework`, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((list) => {
			expect(list.find((h: { id: number }) => h.id === hw.id)).toMatchObject({ submissionStatus: "NOT_SUBMITTED" });
		});
	});

	test("LRN-04 a resubmission before review replaces the answer", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "First" } });
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Second" } })).expectStatus(200).expectJson((b) => expect(b.submissionText).toBe("Second"));
		(await api.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.id } })).expectJson((rows) => expect(rows.filter((r: { submissionId: number | null }) => r.submissionId)).toHaveLength(1));
	});

	test("LRN-04 an empty submission returns 400", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: {} })).expectStatus(400);
	});

	test("LRN-04 cancelled homework cannot be submitted (409)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		await api.post(`${LEARNING}/homework/{id}/cancel`, { params: { id: hw.id } });
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "x" } })).expectStatus(409);
	});

	test("LRN-04 homework of another section cannot be submitted for the child", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const other = await createHomework(api, s, { sectionId: s.base.secondSectionId });
		const res = await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: other.id }, body: { text: "x" } });
		expect([403, 404]).toContain(res.status);
	});

	test("LRN-04 a guardian cannot read or submit for a child they are not linked to (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		(await g.client.get(`${CHILD}/homework`, { params: { studentId: s.studentIds[1] } })).expectStatus(403);
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[1], homeworkId: hw.id }, body: { text: "x" } })).expectStatus(403);
	});
});

test.describe("LRN-05 homework review", () => {
	test("LRN-05 review marks the submission REVIEWED with feedback the guardian then sees", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Answer" } });
		const sub = (await api.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.id } })).body[0];
		(await api.post(`${LEARNING}/homework/submissions/{submissionId}/review`, { params: { submissionId: sub.submissionId }, body: { feedback: "Well done" } })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ status: "REVIEWED", feedback: "Well done" });
		});
		(await g.client.get(`${CHILD}/homework`, { params: { studentId: s.studentIds[0] } })).expectJson((list) => {
			expect(list.find((h: { id: number }) => h.id === hw.id)).toMatchObject({ submissionStatus: "REVIEWED", feedback: "Well done" });
		});
		(await api.get(`${LEARNING}/homework`, { query: { sectionId: s.sectionId } })).expectJson((list) => expect(list.find((h: { id: number }) => h.id === hw.id)).toMatchObject({ submitted: 1, reviewed: 1 }));
	});

	test("LRN-05 a reviewed submission can no longer be changed by the guardian (409)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const hw = await createHomework(api, s);
		await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Answer" } });
		const sub = (await api.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.id } })).body[0];
		await api.post(`${LEARNING}/homework/submissions/{submissionId}/review`, { params: { submissionId: sub.submissionId }, body: { feedback: "ok" } });
		(await g.client.post(SUBMIT, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "Changed" } })).expectStatus(409);
	});

	test("LRN-05 reviewing an unknown submission returns 404", async ({ api }) => {
		(await api.post(`${LEARNING}/homework/submissions/{submissionId}/review`, { params: { submissionId: 99999999 }, body: { feedback: "x" } })).expectStatus(404);
	});
});

test.describe("LRN-08 and LRN-09 quiz attempts", () => {
	test("LRN-08 the guardian sees published quizzes only, and questions without the answers", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const draft = await createQuiz(api, s);
		const { quiz } = await openQuiz(api, s);
		(await g.client.get(`${CHILD}/quizzes`, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((list) => {
			const ids = list.map((q: { id: number }) => q.id);
			expect(ids).toContain(quiz.id);
			expect(ids).not.toContain(draft.id);
		});
		(await g.client.get(`${CHILD}/quizzes/{quizId}/questions`, { params: { studentId: s.studentIds[0], quizId: quiz.id } })).expectStatus(200).expectJson((questions) => {
			expect(questions).toHaveLength(2);
			expect(JSON.stringify(questions)).not.toContain("correct");
		});
	});

	test("LRN-08 scoring awards full marks for right answers and nothing for wrong ones", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0]), wrongAnswer(questions[1])] } })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ quizId: quiz.id, score: 2, maxScore: 5, percentage: 40 });
		});
	});

	test("LRN-08 a skipped question scores zero", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[1])] } })).expectStatus(200).expectJson((r) => expect(r).toMatchObject({ score: 3, maxScore: 5, percentage: 60 }));
	});

	test("LRN-08 only one attempt is allowed (409)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0])] } });
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0]), rightAnswer(questions[1])] } })).expectStatus(409);
	});

	test("LRN-08 a quiz that has not opened yet cannot be seen or attempted (409)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const quiz = await createQuiz(api, s, { opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 7200e3).toISOString() });
		const q = await addQuestion(api, s, quiz.id);
		await publishQuiz(api, quiz.id);
		(await g.client.get(`${CHILD}/quizzes/{quizId}/questions`, { params: { studentId: s.studentIds[0], quizId: quiz.id } })).expectStatus(409);
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(q)] } })).expectStatus(409);
	});

	test("LRN-08 a quiz that has closed cannot be attempted (409)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const quiz = await createQuiz(api, s, { closesAt: new Date(Date.now() + 4000).toISOString() });
		const q = await addQuestion(api, s, quiz.id);
		await publishQuiz(api, quiz.id);
		await new Promise((resolve) => setTimeout(resolve, 5000));
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(q)] } })).expectStatus(409);
	});

	test("LRN-08 a draft quiz cannot be attempted", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const quiz = await createQuiz(api, s);
		const q = await addQuestion(api, s, quiz.id);
		const res = await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(q)] } });
		expect([404, 409]).toContain(res.status);
	});

	test("LRN-08 an option from a different question returns 400", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [{ questionId: questions[0].id, optionId: questions[1].options[0].id }] } })).expectStatus(400);
	});

	test("LRN-08 the same question answered twice in one attempt is rejected", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		const res = await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0]), wrongAnswer(questions[0])] } });
		expect(res.status).toBe(400);
	});

	test("LRN-08 a guardian cannot attempt for a child they are not linked to (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		(await g.client.post(ATTEMPT, { params: { studentId: s.studentIds[1], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0])] } })).expectStatus(403);
	});

	test("LRN-08 the result, history and staff results all show the attempt; answers stay hidden while the quiz is open", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { quiz, questions } = await openQuiz(api, s);
		const params = { studentId: s.studentIds[0], quizId: quiz.id };
		(await g.client.get(`${CHILD}/quizzes/{quizId}/result`, { params })).expectStatus(404);
		await g.client.post(ATTEMPT, { params, body: { answers: [rightAnswer(questions[0]), rightAnswer(questions[1])] } });
		(await g.client.get(`${CHILD}/quizzes/{quizId}/result`, { params })).expectStatus(200).expectJson((r) => {
			expect(r.summary).toMatchObject({ score: 5, maxScore: 5, percentage: 100 });
			expect(r.correctAnswersShown).toBe(false);
			for (const a of r.answers) expect(a.correctOptionId).toBeNull();
		});
		(await g.client.get(`${CHILD}/quiz-history`, { params: { studentId: s.studentIds[0] } })).expectJson((list) => expect(list[0]).toMatchObject({ quizId: quiz.id, score: 5 }));
		(await api.get(`${LEARNING}/quizzes/{id}/results`, { params: { id: quiz.id } })).expectJson((rows) => {
			expect(rows.find((r: { studentId: number }) => r.studentId === s.studentIds[0])).toMatchObject({ attempted: true, score: 5, percentage: 100 });
			expect(rows.find((r: { studentId: number }) => r.studentId === s.studentIds[1])).toMatchObject({ attempted: false });
		});
	});

	test("LRN-09 the QUIZ leaderboard ranks students by their quiz percentage", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const g0 = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const g1 = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[1]);
		const { quiz, questions } = await openQuiz(api, s);
		await g0.client.post(ATTEMPT, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0])] } });
		await g1.client.post(ATTEMPT, { params: { studentId: s.studentIds[1], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0]), rightAnswer(questions[1])] } });
		(await api.get(`${LEARNING}/leaderboard/students`, { query: { sectionId: s.sectionId, track: "QUIZ" } })).expectJson((board) => {
			expect(board.map((r: { studentId: number }) => r.studentId)).toEqual([s.studentIds[1], s.studentIds[0]]);
			expect(board.map((r: { score: number }) => r.score)).toEqual([100, 40]);
		});
		(await api.get(`${LEARNING}/quizzes`, { query: { sectionId: s.sectionId } })).expectJson((list) => expect(list.find((q: { id: number }) => q.id === quiz.id).attempts).toBe(2));
	});
});

test.describe("LRN-15 answer sheets", () => {
	const UPLOAD = `${LEARNING}/answer-sheets/schedules/{scheduleId}/upload`;
	const mark = (totalMarks: number, extra: Record<string, unknown> = {}) => ({ totalMarks, overallRemarks: "Good work", annotations: [{ pageNumber: 1, kind: "MARKS", x: 0.4, y: 0.3, label: "Q1", marks: 5 }], ...extra });

	test("LRN-15 the roster lists every student of the schedule as NOT_UPLOADED at first", async ({ api }) => {
		const s = await examSetup(api, 2);
		(await api.get(`${LEARNING}/answer-sheets/schedules/{scheduleId}/roster`, { params: { scheduleId: s.schedules[0].id } })).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { enrollmentId: number }) => r.enrollmentId).sort()).toEqual([...s.enrollmentIds].sort());
			for (const row of rows) expect(row).toMatchObject({ status: "NOT_UPLOADED", sheetId: null });
		});
	});

	test("LRN-15 upload, mark and release; the guardian sees the sheet only once released", async ({ api, anon, seed }) => {
		const s = await examSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const up = await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: ["sheet-1.png", "sheet-2.png"] } });
		up.expectStatus(200).expectJson((sheet) => {
			expect(sheet).toMatchObject({ status: "UPLOADED", maxMarks: 100 });
			expect(sheet.pages).toHaveLength(2);
		});
		const id = up.body.id;
		(await api.put(`${LEARNING}/answer-sheets/{id}/marking`, { params: { id }, body: mark(72) })).expectStatus(200).expectJson((sheet) => {
			expect(sheet).toMatchObject({ status: "MARKED", totalMarks: 72, overallRemarks: "Good work" });
			expect(sheet.annotations).toHaveLength(1);
		});
		(await g.client.get(`${CHILD}/answer-sheets`, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
		(await api.post(`${LEARNING}/answer-sheets/{id}/release`, { params: { id } })).expectStatus(200).expectJson((sheet) => {
			expect(sheet.status).toBe("RELEASED");
			expect(sheet.releasedAt).toEqual(expect.any(String));
		});
		(await g.client.get(`${CHILD}/answer-sheets`, { params: { studentId: s.studentIds[0] } })).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id, totalMarks: 72 });
		});
	});

	test("LRN-15 an unmarked sheet cannot be released (409)", async ({ api }) => {
		const s = await examSetup(api, 1);
		const up = await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: ["p.png"] } });
		(await api.post(`${LEARNING}/answer-sheets/{id}/release`, { params: { id: up.body.id } })).expectStatus(409);
	});

	test("LRN-15 a released sheet can no longer be re-marked or re-uploaded (409)", async ({ api }) => {
		const s = await examSetup(api, 1);
		const up = await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: ["p.png"] } });
		await api.put(`${LEARNING}/answer-sheets/{id}/marking`, { params: { id: up.body.id }, body: mark(50) });
		(await api.post(`${LEARNING}/answer-sheets/{id}/release`, { params: { id: up.body.id } })).expectStatus(200);
		(await api.put(`${LEARNING}/answer-sheets/{id}/marking`, { params: { id: up.body.id }, body: mark(60) })).expectStatus(409);
		(await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: ["new.png"] } })).expectStatus(409);
	});

	for (const [title, body] of [
		["marks above the schedule's maximum", mark(150)],
		["negative marks", mark(-1)],
		["an annotation off the page", mark(10, { annotations: [{ pageNumber: 1, kind: "MARKS", x: 1.5, y: 0.2, marks: 1 }] })],
		["an annotation on a page that does not exist", mark(10, { annotations: [{ pageNumber: 9, kind: "MARKS", x: 0.5, y: 0.2, marks: 1 }] })],
	] as const) {
		test(`LRN-15 marking with ${title} returns 400`, async ({ api }) => {
			const s = await examSetup(api, 1);
			const up = await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: ["p.png"] } });
			(await api.put(`${LEARNING}/answer-sheets/{id}/marking`, { params: { id: up.body.id }, body })).expectStatus(400);
		});
	}

	test("LRN-15 an upload without pages returns 400", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: s.enrollmentIds[0], pageRefs: [] } })).expectStatus(400);
	});

	test("LRN-15 an upload for a student outside the schedule's class is rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		const other = await attendanceSetup(api, 1);
		const res = await api.post(UPLOAD, { params: { scheduleId: s.schedules[0].id }, body: { enrollmentId: other.enrollmentIds[0], pageRefs: ["p.png"] } });
		expect(res.status).toBe(400);
	});

	test("LRN-15 an unknown sheet returns 404", async ({ api }) => {
		(await api.get(`${LEARNING}/answer-sheets/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});
});
