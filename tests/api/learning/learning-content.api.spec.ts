// Learning content the staff side creates: homework, quizzes, the question bank, materials, lesson plans,
// rewards and leaderboards. IDs refer to docs/SCENARIOS.md section 10 (LRN-*). Every learning endpoint
// is scoped by LearningAccessService (managers and LEARNING_VIEW holders see everything, teachers only
// what they teach); the owner used here is a manager.

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { LEARNING, addQuestion, createHomework, createLessonPlan, createQuiz, inMinutes, publishQuiz, questionBody, today } from "../../../src/api/learning";

test.describe("LRN-02 section students", () => {
	test("LRN-02 lists the section's enrolled students with roll numbers", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		(await api.get(`${LEARNING}/sections/students`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { enrollmentId: number }) => r.enrollmentId).sort()).toEqual([...s.enrollmentIds].sort());
			expect(rows.map((r: { studentName: string }) => r.studentName).sort()).toEqual([...s.studentNames].sort());
			expect(rows.map((r: { rollNumber: number }) => r.rollNumber).sort()).toEqual([1, 2]);
		});
	});

	test("LRN-02 the section id is required (400)", async ({ api }) => {
		(await api.get(`${LEARNING}/sections/students`)).expectStatus(400);
	});
});

test.describe("LRN-03 homework", () => {
	test("LRN-03 created homework is ACTIVE and listed for its section with the enrolled count", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const hw = await createHomework(api, s);
		expect(hw.status).toBe("ACTIVE");
		(await api.get(`${LEARNING}/homework`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((list) => {
			const row = list.find((h: { id: number }) => h.id === hw.id);
			expect(row).toMatchObject({ title: hw.title, status: "ACTIVE", enrolled: 2, submitted: 0, reviewed: 0 });
		});
	});

	test("LRN-03 the create response reports the section's enrolled count", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const hw = await createHomework(api, s);
		expect((hw as unknown as { enrolled: number }).enrolled).toBe(2);
	});

	test("LRN-03 homework of another section is not in this section's list", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const other = await createHomework(api, s, { sectionId: s.base.secondSectionId });
		(await api.get(`${LEARNING}/homework`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((list) => {
			expect(list.map((h: { id: number }) => h.id)).not.toContain(other.id);
		});
	});

	test("LRN-03 cancelling moves the homework to CANCELLED", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const hw = await createHomework(api, s);
		(await api.post(`${LEARNING}/homework/{id}/cancel`, { params: { id: hw.id } })).expectStatus(200).expectJson((body) => expect(body.status).toBe("CANCELLED"));
	});

	test("LRN-03 the submissions tracker lists every enrolled student as NOT_SUBMITTED at first", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const hw = await createHomework(api, s);
		(await api.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.id } })).expectStatus(200).expectJson((rows) => {
			expect(rows).toHaveLength(2);
			for (const row of rows) expect(row).toMatchObject({ submissionId: null, status: "NOT_SUBMITTED", late: false });
		});
	});

	for (const [title, overrides] of [
		["a blank title", { title: " " }],
		["no due date", { dueDate: null }],
		["no section", { sectionId: null }],
		["no subject", { subjectId: null }],
	] as const) {
		test(`LRN-03 homework with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.post(`${LEARNING}/homework`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: "Valid", dueDate: today(), ...overrides } })).expectStatus(400);
		});
	}

	test("LRN-03 homework for a subject the class does not take is rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const subject = await api.post("/api/v1/subjects", { body: { name: `Unrelated ${Date.now()}`, code: `U${Date.now()}` } });
		subject.expectStatus([200, 201]);
		const res = await api.post(`${LEARNING}/homework`, { body: { sectionId: s.sectionId, subjectId: subject.body.id, title: "Wrong subject", dueDate: today() } });
		expect(res.status, "a subject not on the class is accepted").toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	test("LRN-03 an unknown section returns 404; cancelling unknown homework returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(`${LEARNING}/homework`, { body: { sectionId: 99999999, subjectId: s.base.subjectId, title: "x", dueDate: today() } })).expectStatus(404);
		(await api.post(`${LEARNING}/homework/{id}/cancel`, { params: { id: 99999999 } })).expectStatus(404);
	});
});

test.describe("LRN-06 and LRN-07 quizzes", () => {
	test("LRN-06 a new quiz is a DRAFT; questions can be added and read back in order", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		expect(quiz.status).toBe("DRAFT");
		const first = await addQuestion(api, s, quiz.id, { text: "2 + 2?", marks: 2 });
		const second = await addQuestion(api, s, quiz.id, { text: "3 + 3?", marks: 3 });
		(await api.get(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.id } })).expectStatus(200).expectJson((questions) => {
			expect(questions.map((q: { id: number }) => q.id)).toEqual([first.id, second.id]);
			expect(questions.map((q: { ordinal: number }) => q.ordinal)).toEqual([1, 2]);
			expect(questions[0].options.filter((o: { correct: boolean }) => o.correct)).toHaveLength(1);
		});
	});

	test("LRN-06 publishing makes the quiz PUBLISHED and the list shows its question count and total marks", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const quiz = await createQuiz(api, s);
		await addQuestion(api, s, quiz.id, { marks: 2 });
		await addQuestion(api, s, quiz.id, { marks: 3 });
		await publishQuiz(api, quiz.id);
		(await api.get(`${LEARNING}/quizzes`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((list) => {
			expect(list.find((q: { id: number }) => q.id === quiz.id)).toMatchObject({ status: "PUBLISHED", availability: "OPEN", questionCount: 2, totalMarks: 5, attempts: 0, enrolled: 2 });
		});
	});

	test("LRN-06 the publish response reports the quiz's question count and total marks", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		await addQuestion(api, s, quiz.id, { marks: 4 });
		(await api.post(`${LEARNING}/quizzes/{id}/publish`, { params: { id: quiz.id } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ status: "PUBLISHED", questionCount: 1, totalMarks: 4 });
		});
	});

	test("LRN-06 a published quiz cannot be changed: no new question, no removal, no second publish (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		const q = await addQuestion(api, s, quiz.id);
		await publishQuiz(api, quiz.id);
		(await api.post(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.id }, body: questionBody(s) })).expectStatus(409);
		(await api.delete(`${LEARNING}/quizzes/{id}/questions/{questionId}`, { params: { id: quiz.id, questionId: q.id } })).expectStatus(409);
		(await api.post(`${LEARNING}/quizzes/{id}/publish`, { params: { id: quiz.id } })).expectStatus(409);
	});

	test("LRN-06 a quiz without questions cannot be published (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		(await api.post(`${LEARNING}/quizzes/{id}/publish`, { params: { id: quiz.id } })).expectStatus(409);
	});

	test("LRN-06 a quiz whose closing time has passed cannot be published (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s, { opensAt: inMinutes(-120), closesAt: inMinutes(-60) });
		await addQuestion(api, s, quiz.id);
		(await api.post(`${LEARNING}/quizzes/{id}/publish`, { params: { id: quiz.id } })).expectStatus(409);
	});

	test("LRN-06 a quiz that opens later is UPCOMING", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s, { opensAt: inMinutes(60), closesAt: inMinutes(120) });
		expect(quiz.availability).toBe("UPCOMING");
	});

	for (const [title, overrides] of [
		["a closing time before the opening time", { opensAt: inMinutes(120), closesAt: inMinutes(60) }],
		["a blank title", { title: "" }],
	] as const) {
		test(`LRN-06 a quiz with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.post(`${LEARNING}/quizzes`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: "Q", opensAt: inMinutes(-60), closesAt: inMinutes(60), ...overrides } })).expectStatus(400);
		});
	}

	for (const [title, overrides] of [
		["no correct option", { options: [{ text: "a", correct: false }, { text: "b", correct: false }] }],
		["two correct options", { options: [{ text: "a", correct: true }, { text: "b", correct: true }] }],
		["a single option", { options: [{ text: "a", correct: true }] }],
		["seven options", { options: [{ text: "a", correct: true }, ...["b", "c", "d", "e", "f", "g"].map((text) => ({ text, correct: false }))] }],
		["a blank option", { options: [{ text: "a", correct: true }, { text: " ", correct: false }] }],
		["zero marks", { marks: 0 }],
		["blank text", { text: "" }],
	] as const) {
		test(`LRN-06 a question with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			const quiz = await createQuiz(api, s);
			(await api.post(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.id }, body: questionBody(s, overrides) })).expectStatus(400);
		});
	}

	test("LRN-07 a bank question can be copied into a quiz; later bank edits do not touch the copy", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		const bank = await api.post(`${LEARNING}/question-bank`, { body: questionBody(s, { text: "Capital of France?" }) });
		bank.expectStatus(200);
		const copy = await api.post(`${LEARNING}/quizzes/{id}/questions/from-bank/{bankQuestionId}`, { params: { id: quiz.id, bankQuestionId: bank.body.id } });
		copy.expectStatus(200).expectJson((q) => {
			expect(q.id).not.toBe(bank.body.id);
			expect(q.text).toBe("Capital of France?");
		});
		(await api.delete(`${LEARNING}/question-bank/{id}`, { params: { id: bank.body.id } })).expectStatus([200, 204]);
		(await api.get(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.id } })).expectJson((questions) => expect(questions.map((q: { id: number }) => q.id)).toContain(copy.body.id));
	});

	test("LRN-07 a question can be removed from a draft quiz", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		const keep = await addQuestion(api, s, quiz.id);
		const drop = await addQuestion(api, s, quiz.id);
		(await api.delete(`${LEARNING}/quizzes/{id}/questions/{questionId}`, { params: { id: quiz.id, questionId: drop.id } })).expectStatus([200, 204]);
		(await api.get(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.id } })).expectJson((questions) => expect(questions.map((q: { id: number }) => q.id)).toEqual([keep.id]));
	});

	test("LRN-07 an unknown bank question returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const quiz = await createQuiz(api, s);
		(await api.post(`${LEARNING}/quizzes/{id}/questions/from-bank/{bankQuestionId}`, { params: { id: quiz.id, bankQuestionId: 99999999 } })).expectStatus(404);
	});

	test("LRN-09 quiz results list every enrolled student, attempted or not", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const quiz = await createQuiz(api, s);
		await addQuestion(api, s, quiz.id);
		await publishQuiz(api, quiz.id);
		(await api.get(`${LEARNING}/quizzes/{id}/results`, { params: { id: quiz.id } })).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { studentId: number }) => r.studentId).sort()).toEqual([...s.studentIds].sort());
			for (const row of rows) expect(row).toMatchObject({ attempted: false, score: null });
		});
	});
});

test.describe("LRN-10 question bank", () => {
	test("LRN-10 add, list by subject, delete", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const created = await api.post(`${LEARNING}/question-bank`, { body: questionBody(s, { text: "Bank question" }) });
		created.expectStatus(200);
		(await api.get(`${LEARNING}/question-bank`, { query: { subjectId: s.base.subjectId } })).expectJson((list) => expect(list.map((q: { id: number }) => q.id)).toContain(created.body.id));
		(await api.get(`${LEARNING}/question-bank`, { query: { subjectId: s.base.secondSubjectId } })).expectJson((list) => expect(list.map((q: { id: number }) => q.id)).not.toContain(created.body.id));
		(await api.delete(`${LEARNING}/question-bank/{id}`, { params: { id: created.body.id } })).expectStatus([200, 204]);
		(await api.get(`${LEARNING}/question-bank`, { query: { subjectId: s.base.subjectId } })).expectJson((list) => expect(list.map((q: { id: number }) => q.id)).not.toContain(created.body.id));
	});

	test("LRN-10 an invalid bank question (no correct option) returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(`${LEARNING}/question-bank`, { body: questionBody(s, { options: [{ text: "a", correct: false }, { text: "b", correct: false }] }) })).expectStatus(400);
	});

	test("LRN-10 deleting an unknown bank question returns 404", async ({ api }) => {
		(await api.delete(`${LEARNING}/question-bank/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});
});

test.describe("LRN-11 materials", () => {
	const material = (s: { base: { classId: number; subjectId: number } }, overrides: Record<string, unknown>) => ({ classId: s.base.classId, subjectId: s.base.subjectId, title: `Material ${Date.now()}`, ...overrides });

	for (const [kind, extra] of [
		["LINK", { url: "https://example.com/fractions" }],
		["NOTE", { description: "Read chapter 1" }],
		["FILE", { attachmentRef: "worksheet.pdf" }],
	] as const) {
		test(`LRN-11 a ${kind} material is created ACTIVE and listed for its class`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			const created = await api.post(`${LEARNING}/materials`, { body: material(s, { kind, ...extra }) });
			created.expectStatus(200).expectJson((m) => expect(m).toMatchObject({ kind, status: "ACTIVE" }));
			(await api.get(`${LEARNING}/materials`, { query: { classId: s.base.classId } })).expectJson((list) => expect(list.map((m: { id: number }) => m.id)).toContain(created.body.id));
		});
	}

	test("LRN-11 archiving marks the material ARCHIVED", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const created = await api.post(`${LEARNING}/materials`, { body: material(s, { kind: "NOTE", description: "x" }) });
		(await api.post(`${LEARNING}/materials/{id}/archive`, { params: { id: created.body.id } })).expectStatus(200).expectJson((m) => expect(m.status).toBe("ARCHIVED"));
	});

	test("LRN-11 an invalid kind returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(`${LEARNING}/materials`, { body: material(s, { kind: "VIDEO" }) })).expectStatus(400);
	});

	for (const [title, overrides] of [
		["a FILE without an attachment", { kind: "FILE" }],
		["a LINK without a url", { kind: "LINK" }],
		["a LINK with a javascript: url", { kind: "LINK", url: "javascript:alert(1)" }],
		["a NOTE without text", { kind: "NOTE" }],
		["a blank title", { kind: "NOTE", description: "x", title: "" }],
	] as const) {
		test(`LRN-11 ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.post(`${LEARNING}/materials`, { body: material(s, overrides) })).expectStatus(400);
		});
	}
});

test.describe("LRN-12 to LRN-14 lesson plans", () => {
	test("LRN-12 draft, submit, approve records the reviewer and note", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		expect(plan.status).toBe("DRAFT");
		(await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } })).expectStatus(200).expectJson((p) => {
			expect(p.status).toBe("SUBMITTED");
			expect(p.submittedAt).toEqual(expect.any(String));
		});
		(await api.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: plan.id }, body: { feedback: "Looks good" } })).expectStatus(200).expectJson((p) => {
			expect(p).toMatchObject({ status: "APPROVED", reviewNote: "Looks good", reviewedByName: expect.any(String) });
		});
	});

	test("LRN-12 a rejected plan can be edited and submitted again", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		(await api.post(`${LEARNING}/lesson-plans/{id}/reject`, { params: { id: plan.id }, body: { feedback: "Add an activity" } })).expectStatus(200).expectJson((p) => expect(p).toMatchObject({ status: "REJECTED", reviewNote: "Add an activity" }));
		(await api.put(`${LEARNING}/lesson-plans/{id}`, { params: { id: plan.id }, body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(13), title: "Plan v2", activities: "Quiz" } })).expectStatus(200).expectJson((p) => expect(p.title).toBe("Plan v2"));
		(await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } })).expectStatus(200).expectJson((p) => expect(p.status).toBe("SUBMITTED"));
	});

	test("LRN-12 a draft cannot be approved or rejected (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		(await api.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: plan.id }, body: { feedback: "x" } })).expectStatus(409);
		(await api.post(`${LEARNING}/lesson-plans/{id}/reject`, { params: { id: plan.id }, body: { feedback: "x" } })).expectStatus(409);
	});

	test("LRN-12 a submitted plan cannot be edited or submitted again (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		(await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } })).expectStatus(409);
		(await api.put(`${LEARNING}/lesson-plans/{id}`, { params: { id: plan.id }, body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(12), title: "x" } })).expectStatus(409);
	});

	test("LRN-12 an approved plan cannot be edited (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		await api.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: plan.id }, body: {} });
		(await api.put(`${LEARNING}/lesson-plans/{id}`, { params: { id: plan.id }, body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(12), title: "x" } })).expectStatus(409);
	});

	test("LRN-12 rejecting without a note returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		(await api.post(`${LEARNING}/lesson-plans/{id}/reject`, { params: { id: plan.id }, body: {} })).expectStatus(400);
	});

	for (const [title, overrides] of [
		["a blank title", { title: "" }],
		["no date", { planDate: null }],
	] as const) {
		test(`LRN-12 a plan with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.post(`${LEARNING}/lesson-plans`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(12), title: "x", ...overrides } })).expectStatus(400);
		});
	}

	test("LRN-13 the calendar shows approved plans in the range only", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const approved = await createLessonPlan(api, s, { planDate: s.day(12) });
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: approved.id } });
		await api.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: approved.id }, body: {} });
		const draft = await createLessonPlan(api, s, { planDate: s.day(12) });
		const outside = await createLessonPlan(api, s, { planDate: s.day(25) });
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: outside.id } });
		await api.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: outside.id }, body: {} });
		(await api.get(`${LEARNING}/lesson-plans/calendar`, { query: { from: s.day(1), to: s.day(20) } })).expectStatus(200).expectJson((list) => {
			const ids = list.map((p: { id: number }) => p.id);
			expect(ids).toContain(approved.id);
			expect(ids).not.toContain(draft.id);
			expect(ids).not.toContain(outside.id);
		});
	});

	test("LRN-13 the calendar needs from and to (400)", async ({ api }) => {
		(await api.get(`${LEARNING}/lesson-plans/calendar`)).expectStatus(400);
		(await api.get(`${LEARNING}/lesson-plans/calendar`, { query: { from: "2026-01-01" } })).expectStatus(400);
	});

	test("LRN-13 a range that ends before it starts returns 400", async ({ api }) => {
		(await api.get(`${LEARNING}/lesson-plans/calendar`, { query: { from: "2026-12-01", to: "2026-01-01" } })).expectStatus(400);
	});

	test("LRN-14 the status filter returns only plans in that status", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const draft = await createLessonPlan(api, s);
		const submitted = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: submitted.id } });
		(await api.get(`${LEARNING}/lesson-plans`, { query: { sectionId: s.sectionId, status: "SUBMITTED" } })).expectStatus(200).expectJson((list) => {
			expect(list.map((p: { id: number }) => p.id)).toEqual([submitted.id]);
		});
		(await api.get(`${LEARNING}/lesson-plans`, { query: { sectionId: s.sectionId, status: "DRAFT" } })).expectJson((list) => expect(list.map((p: { id: number }) => p.id)).toEqual([draft.id]));
	});

	test("LRN-14 an unknown status returns 400", async ({ api }) => {
		(await api.get(`${LEARNING}/lesson-plans`, { query: { status: "PUBLISHED" } })).expectStatus(400);
	});
});

test.describe("LRN-16 and LRN-17 rewards and leaderboards", () => {
	test("LRN-16 a reward is listed for the section and leads the REWARD board", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		(await api.post(`${LEARNING}/rewards`, { body: { enrollmentId: s.enrollmentIds[1], title: "Helpful", points: 7, reason: "Helped a classmate" } })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ studentId: s.studentIds[1], points: 7, title: "Helpful" });
		});
		(await api.get(`${LEARNING}/rewards`, { query: { sectionId: s.sectionId } })).expectJson((list) => expect(list.map((r: { studentId: number }) => r.studentId)).toEqual([s.studentIds[1]]));
		(await api.get(`${LEARNING}/leaderboard/students`, { query: { sectionId: s.sectionId, track: "REWARD" } })).expectStatus(200).expectJson((board) => {
			expect(board[0]).toMatchObject({ rank: 1, studentId: s.studentIds[1], score: 7 });
		});
	});

	test("LRN-16 rewards need a section id (400)", async ({ api }) => {
		(await api.get(`${LEARNING}/rewards`)).expectStatus(400);
	});

	for (const [title, overrides] of [
		["zero points", { points: 0 }],
		["negative points", { points: -5 }],
		["more than 100 points", { points: 101 }],
		["no title", { title: null }],
	] as const) {
		test(`LRN-16 a reward with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.post(`${LEARNING}/rewards`, { body: { enrollmentId: s.enrollmentIds[0], title: "Star", points: 5, ...overrides } })).expectStatus(400);
		});
	}

	for (const track of ["QUIZ", "ACADEMIC", "REWARD"]) {
		test(`LRN-17 the ${track} board answers 200 for a section`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			(await api.get(`${LEARNING}/leaderboard/students`, { query: { sectionId: s.sectionId, track } })).expectStatus(200).expectJson((board) => expect(Array.isArray(board)).toBe(true));
		});
	}

	test("LRN-17 an unknown track returns 400; track and section are required", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get(`${LEARNING}/leaderboard/students`, { query: { sectionId: s.sectionId, track: "SPORTS" } })).expectStatus(400);
		(await api.get(`${LEARNING}/leaderboard/students`, { query: { sectionId: s.sectionId } })).expectStatus(400);
		(await api.get(`${LEARNING}/leaderboard/students`, { query: { track: "QUIZ" } })).expectStatus(400);
	});

	test("LRN-17 the teacher board ranks staff by activity with the documented weights", async ({ api }) => {
		(await api.get(`${LEARNING}/leaderboard/teachers`)).expectStatus(200).expectJson((board) => {
			expect(board.length).toBeGreaterThan(0);
			for (const row of board) {
				expect(row.points).toBe(row.homeworkAssigned * 2 + row.quizzesPublished * 3 + row.materialsShared + row.lessonPlansApproved * 3 + row.sheetsReleased * 2);
			}
			const points = board.map((r: { points: number }) => r.points);
			expect(points).toEqual([...points].sort((a, b) => b - a));
		});
	});
});
