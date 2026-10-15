// Who may see and change learning content: a teacher sees and writes only the section and subject
// they are assigned to, LEARNING_VIEW reads everything and writes nothing, LESSON_PLAN_REVIEW approves.
// Also authentication and cross-organisation isolation. IDs refer to docs/SCENARIOS.md section 10.

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { buildAcademicBase } from "../../../src/api/academics";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { LEARNING, assignTeacher, createHomework, createLessonPlan, createQuiz, questionBody, today } from "../../../src/api/learning";

test.describe("LRN-01 scope", () => {
	test("LRN-01 an administrator is a manager and reviewer and sees every section", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get(`${LEARNING}/scope`)).expectStatus(200).expectJson((scope) => {
			expect(scope).toMatchObject({ manager: true, reviewer: true });
			const section = scope.sections.find((x: { sectionId: number }) => x.sectionId === s.sectionId);
			expect(section.writableSubjectIds).toEqual(expect.arrayContaining([s.base.subjectId, s.base.secondSubjectId]));
		});
	});

	test("LRN-01 a teacher sees only the section they teach and may write only their subject", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		(await teacher.client.get(`${LEARNING}/scope`)).expectStatus(200).expectJson((scope) => {
			expect(scope).toMatchObject({ manager: false, reviewer: false });
			expect(scope.sections).toEqual([expect.objectContaining({ sectionId: s.sectionId, writableSubjectIds: [s.base.subjectId] })]);
		});
	});

	test("LRN-01 a staff member who neither teaches nor holds LEARNING_VIEW has no learning access (403)", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		(await user.client.get(`${LEARNING}/scope`)).expectStatus(403);
		(await user.client.get(`${LEARNING}/homework`)).expectStatus(403);
	});

	test("LRN-01 LEARNING_VIEW sees every section but may write none", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const viewer = await createDisposableUser(api, anon, seed, ["LEARNING_VIEW"]);
		(await viewer.client.get(`${LEARNING}/scope`)).expectStatus(200).expectJson((scope) => {
			const section = scope.sections.find((x: { sectionId: number }) => x.sectionId === s.sectionId);
			expect(section.writableSubjectIds).toEqual([]);
			expect(scope.manager).toBe(false);
		});
		await createHomework(api, s);
		(await viewer.client.get(`${LEARNING}/homework`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((list) => expect(list.length).toBe(1));
		(await viewer.client.post(`${LEARNING}/homework`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: "x", dueDate: today() } })).expectStatus(403);
		(await viewer.client.post(`${LEARNING}/quizzes`, { body: { sectionId: s.sectionId, subjectId: s.base.subjectId, title: "x", opensAt: "2999-01-01T00:00:00Z", closesAt: "2999-01-02T00:00:00Z" } })).expectStatus(403);
		(await viewer.client.post(`${LEARNING}/rewards`, { body: { enrollmentId: s.enrollmentIds[0], title: "x", points: 1 } })).expectStatus(403);
	});

	test("LRN-01 LEARNING_MANAGE writes everywhere", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const manager = await createDisposableUser(api, anon, seed, ["LEARNING_MANAGE"]);
		(await manager.client.post(`${LEARNING}/homework`, { body: { sectionId: s.sectionId, subjectId: s.base.secondSubjectId, title: "Manager homework", dueDate: today() } })).expectStatus(200);
	});
});

test.describe("LRN-18 teacher boundaries", () => {
	test("LRN-18 a teacher can create homework, quizzes and plans for their own section and subject", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		await createHomework(teacher.client, s);
		await createQuiz(teacher.client, s);
		await createLessonPlan(teacher.client, s);
	});

	test("LRN-18 a teacher cannot write to another subject or another section (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		for (const [sectionId, subjectId] of [[s.sectionId, s.base.secondSubjectId], [s.base.secondSectionId, s.base.subjectId]]) {
			(await teacher.client.post(`${LEARNING}/homework`, { body: { sectionId, subjectId, title: "x", dueDate: today() } })).expectStatus(403);
			(await teacher.client.post(`${LEARNING}/quizzes`, { body: { sectionId, subjectId, title: "x", opensAt: "2999-01-01T00:00:00Z", closesAt: "2999-01-02T00:00:00Z" } })).expectStatus(403);
			(await teacher.client.post(`${LEARNING}/lesson-plans`, { body: { sectionId, subjectId, planDate: s.day(12), title: "x" } })).expectStatus(403);
		}
		(await teacher.client.post(`${LEARNING}/materials`, { body: { classId: s.base.classId, subjectId: s.base.secondSubjectId, title: "x", kind: "NOTE", description: "x" } })).expectStatus(403);
	});

	test("LRN-18 a teacher cannot read another section's homework, students or submissions (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		const other = await createHomework(api, s, { sectionId: s.base.secondSectionId });
		(await teacher.client.get(`${LEARNING}/homework`, { query: { sectionId: s.base.secondSectionId } })).expectStatus(403);
		(await teacher.client.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: other.id } })).expectStatus(403);
		(await teacher.client.get(`${LEARNING}/sections/students`, { query: { sectionId: s.base.secondSectionId } })).expectStatus(403);
		(await teacher.client.post(`${LEARNING}/homework/{id}/cancel`, { params: { id: other.id } })).expectStatus(403);
		(await teacher.client.get(`${LEARNING}/homework`)).expectJson((list) => expect(list.map((h: { id: number }) => h.id)).not.toContain(other.id));
	});

	test("LRN-18 a teacher does not see a colleague's draft lesson plan in the same section", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const author = await createDisposableUser(api, anon, seed, []);
		const colleague = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, author.personId);
		// a second SUBJECT assignment for the same section and subject ends the first, so the colleague teaches the other subject
		await assignTeacher(api, s.sectionId, s.base.secondSubjectId, colleague.personId);
		const draft = await createLessonPlan(author.client, s);
		(await colleague.client.get(`${LEARNING}/lesson-plans`, { query: { sectionId: s.sectionId } })).expectStatus(200).expectJson((list) => {
			expect(list.map((p: { id: number }) => p.id)).not.toContain(draft.id);
		});
		(await colleague.client.put(`${LEARNING}/lesson-plans/{id}`, { params: { id: draft.id }, body: { sectionId: s.sectionId, subjectId: s.base.subjectId, planDate: s.day(12), title: "hijack" } })).expectStatus(403);
		(await colleague.client.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: draft.id } })).expectStatus(403);
	});

	test("LRN-18 a teacher cannot approve lesson plans without LESSON_PLAN_REVIEW, even their own (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		const plan = await createLessonPlan(teacher.client, s);
		await teacher.client.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		(await teacher.client.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: plan.id }, body: { feedback: "self" } })).expectStatus(403);
		(await teacher.client.post(`${LEARNING}/lesson-plans/{id}/reject`, { params: { id: plan.id }, body: { feedback: "self" } })).expectStatus(403);
	});

	test("LRN-18 LESSON_PLAN_REVIEW can approve a submitted plan", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		const reviewer = await createDisposableUser(api, anon, seed, ["LESSON_PLAN_REVIEW", "LEARNING_VIEW"]);
		(await reviewer.client.post(`${LEARNING}/lesson-plans/{id}/approve`, { params: { id: plan.id }, body: { feedback: "ok" } })).expectStatus(200);
	});

	test("LRN-18 the teacher leaderboard is for administrators only (403 for a teacher)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		(await teacher.client.get(`${LEARNING}/leaderboard/teachers`)).expectStatus(403);
	});

	test("LRN-18 a teacher cannot add bank questions for a subject they do not teach (403)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, []);
		await assignTeacher(api, s.sectionId, s.base.subjectId, teacher.personId);
		(await teacher.client.post(`${LEARNING}/question-bank`, { body: questionBody(s, { subjectId: s.base.secondSubjectId }) })).expectStatus(403);
	});
});

test.describe("authentication and tenancy", () => {
	const reads = ["/scope", "/homework", "/quizzes", "/lesson-plans", "/answer-sheets/schedules", "/leaderboard/teachers"];

	for (const path of reads) {
		test(`LRN-01 GET ${path} without a token returns 401`, async ({ anon }) => {
			(await anon.get(`${LEARNING}${path}`)).expectStatus(401);
		});
	}

	test("LRN-01 another organisation's homework, quizzes and plans are invisible and untouchable", async ({ api, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await buildAcademicBase(org.client, { assignTeachers: false });
		const hw = await org.client.post(`${LEARNING}/homework`, { body: { sectionId: base.sectionId, subjectId: base.subjectId, title: "Theirs", dueDate: today() } });
		hw.expectStatus(200);
		const quiz = await org.client.post(`${LEARNING}/quizzes`, { body: { sectionId: base.sectionId, subjectId: base.subjectId, title: "Theirs", opensAt: "2999-01-01T00:00:00Z", closesAt: "2999-01-02T00:00:00Z" } });
		quiz.expectStatus(200);
		const plan = await org.client.post(`${LEARNING}/lesson-plans`, { body: { sectionId: base.sectionId, subjectId: base.subjectId, planDate: "2026-11-02", title: "Theirs" } });
		plan.expectStatus(200);

		(await api.get(`${LEARNING}/homework`)).expectJson((list) => expect(list.map((h: { id: number }) => h.id)).not.toContain(hw.body.id));
		const foreignSection = await api.get(`${LEARNING}/homework`, { query: { sectionId: base.sectionId } });
		expect([200, 403, 404]).toContain(foreignSection.status);
		if (foreignSection.status === 200) expect(foreignSection.body.map((h: { id: number }) => h.id)).not.toContain(hw.body.id);
		expect([403, 404]).toContain((await api.post(`${LEARNING}/homework/{id}/cancel`, { params: { id: hw.body.id } })).status);
		expect([403, 404]).toContain((await api.get(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.body.id } })).status);
		expect([403, 404]).toContain((await api.post(`${LEARNING}/quizzes/{id}/questions`, { params: { id: quiz.body.id }, body: { text: "x", marks: 1, options: [{ text: "a", correct: true }, { text: "b", correct: false }] } })).status);
		expect([403, 404]).toContain((await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.body.id } })).status);
		(await api.get(`${LEARNING}/lesson-plans/calendar`, { query: { from: "2026-11-01", to: "2026-11-30" } })).expectJson((list) => expect(list.map((p: { id: number }) => p.id)).not.toContain(plan.body.id));
		(await org.client.get(`${LEARNING}/homework/{id}/submissions`, { params: { id: hw.body.id } })).expectStatus(200);
	});
});
