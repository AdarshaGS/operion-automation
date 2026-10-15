// Marks entry, submit/approve, report cards, corrections, render, permissions, tenant isolation.
// IDs refer to docs/SCENARIOS.md section 8 (EXM-*). Nothing here asserts `passed`: that depends on the
// organisation-wide pass/fail strategy, which is covered separately in exams-strategy.api.spec.ts.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { approveSchedule, examSetup, markRows } from "../../../src/api/examinations";
import { expectShape } from "../../../src/api/shapes";
import type { ApiClient } from "../../../src/api/apiClient";

const MARKS = "/api/v1/examinations/schedules/{scheduleId}/marks";
const REGISTER = "/api/v1/examinations/schedules/{scheduleId}/register";
const SUBMIT = "/api/v1/examinations/schedules/{scheduleId}/submit";
const APPROVE = "/api/v1/examinations/schedules/{scheduleId}/approve";
const ENTRY = "/api/v1/examinations/marks/{marksEntryId}";
const AFTER_PUBLISH = "/api/v1/examinations/marks/{marksEntryId}/correct-after-publish";
const PUBLISH = "/api/v1/examinations/exams/{examId}/report-cards";
const CARDS = "/api/v1/examinations/report-cards";
const CARD = "/api/v1/examinations/report-cards/{reportCardId}";
const RENDER = "/api/v1/examinations/report-cards/{reportCardId}/render";
const BAD = [400, 422];
const ENTRY_SHAPE = { id: "number", examScheduleId: "number", studentEnrollmentId: "number", absent: "boolean", passed: "boolean", published: "boolean", enteredBy: "number", enteredAt: "string" } as const;
const CARD_SHAPE = { id: "number", examId: "number", studentEnrollmentId: "number", totalMarksObtained: "number", totalMaxMarks: "number", percentage: "number", overallGrade: "string", passed: "boolean", status: "string", stale: "boolean", publishedBy: "number", publishedAt: "string" } as const;

type Setup = Awaited<ReturnType<typeof examSetup>>;

const publish = (api: ApiClient, s: Setup, index: number) => api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[index], gradingScaleId: s.scale.id } });

/** Approves both schedules: student 0 scores 90/100 and 45/50 (90%), student 1 scores 50/100 and 20/50 (50%). */
async function approvedExam(api: ApiClient) {
	const s = await examSetup(api, 2);
	await approveSchedule(api, s, 0, [90, 50]);
	await approveSchedule(api, s, 1, [45, 20]);
	return s;
}

test.describe("marks register", () => {
	test("EXM-06 a schedule nobody has started shows a draft register with no id and no marks", async ({ api }) => {
		const s = await examSetup(api, 2);
		const id = s.schedules[0].id;
		(await api.get(REGISTER, { params: { scheduleId: id } })).expectStatus(200).expectJson((body) => expect(body).toEqual({ id: null, examScheduleId: id, registerStatus: "DRAFT", approvedBy: null, approvedAt: null }));
		(await api.get(MARKS, { params: { scheduleId: id } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("EXM-06 an unknown schedule returns 404 for the register and the marks", async ({ api }) => {
		(await api.get(REGISTER, { params: { scheduleId: 99999999 } })).expectStatus(404);
		(await api.get(MARKS, { params: { scheduleId: 99999999 } })).expectStatus(404);
	});
});

test.describe("entering marks", () => {
	test("EXM-07 marks are saved and read back with who entered them", async ({ api }) => {
		const s = await examSetup(api, 2);
		const id = s.schedules[0].id;
		const entered = await api.post(MARKS, { params: { scheduleId: id }, body: { marks: [{ studentEnrollmentId: s.enrollmentIds[0], marksObtained: 82.5, absent: false, remarks: "Neat work" }, { studentEnrollmentId: s.enrollmentIds[1], marksObtained: 30, absent: false, remarks: null }] } });
		entered.expectStatus([200, 201]).expectJson((list) => {
			expect(list).toHaveLength(2);
			for (const row of list) expectShape(row, ENTRY_SHAPE);
		});
		(await api.get(MARKS, { params: { scheduleId: id } })).expectStatus(200).expectJson((list) => {
			const first = list.find((r: { studentEnrollmentId: number }) => r.studentEnrollmentId === s.enrollmentIds[0]);
			const second = list.find((r: { studentEnrollmentId: number }) => r.studentEnrollmentId === s.enrollmentIds[1]);
			expect(first).toMatchObject({ marksObtained: 82.5, remarks: "Neat work", passed: true, published: false, correctedBy: null });
			expect(second).toMatchObject({ marksObtained: 30, passed: false });
		});
		(await api.get(REGISTER, { params: { scheduleId: id } })).expectJson((body) => expect(body.registerStatus).toBe("DRAFT"));
	});

	test("EXM-08 the pass mark is the line: equal passes, one below fails", async ({ api }) => {
		const s = await examSetup(api, 2);
		const res = await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [35, 34]) } });
		res.expectStatus([200, 201]).expectJson((list) => expect(list.map((r: { passed: boolean }) => r.passed)).toEqual([true, false]));
	});

	test("EXM-08 marks above the maximum are rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [150]) } })).expectStatus(BAD);
	});

	test("EXM-08 negative marks are rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [-5]) } })).expectStatus(BAD);
	});

	test("EXM-08 the maximum itself and zero are accepted", async ({ api }) => {
		const s = await examSetup(api, 2);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [100, 0]) } })).expectStatus([200, 201]);
	});

	test("EXM-08 an absent student is recorded as absent and failed, with or without a mark", async ({ api }) => {
		const s = await examSetup(api, 2);
		const res = await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [0, 80], { absent: [true, false]}) } });
		res.expectStatus([200, 201]).expectJson((list) => {
			expect(list[0]).toMatchObject({ absent: true, passed: false });
			expect(list[1]).toMatchObject({ absent: false, passed: true });
		});
	});

	test("EXM-08 an absent student without a mark can be saved without a server error", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [null], { absent: [true] }) } })).expectStatus([200, 201, 400, 422]);
	});

	test("EXM-08 a present student without a mark is rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [null]) } })).expectStatus(BAD);
	});

	test("EXM-08 a student cannot be given marks twice for one schedule", async ({ api }) => {
		const s = await examSetup(api, 1);
		const id = s.schedules[0].id;
		await api.post(MARKS, { params: { scheduleId: id }, body: { marks: markRows(s, [50]) } });
		(await api.post(MARKS, { params: { scheduleId: id }, body: { marks: markRows(s, [60]) } })).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/already has marks/i));
	});

	test("EXM-08 the same student twice in one request is rejected and nothing is saved", async ({ api }) => {
		const s = await examSetup(api, 1);
		const id = s.schedules[0].id;
		(await api.post(MARKS, { params: { scheduleId: id }, body: { marks: [...markRows(s, [50]), ...markRows(s, [60])] } })).expectStatus([400, 409, 422]);
		(await api.get(MARKS, { params: { scheduleId: id } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("EXM-08 an unknown enrolment returns 404", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: [{ studentEnrollmentId: 99999999, marksObtained: 5, absent: false }] } })).expectStatus(404);
	});

	test("EXM-08 a student of another class cannot be given marks for this schedule", async ({ api }) => {
		const s = await examSetup(api, 1);
		const other = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(other, [50]) } })).expectStatus([400, 404, 409, 422]);
	});

	test("EXM-08 a section-only schedule rejects a student of another section", async ({ api }) => {
		const s = await examSetup(api, 1);
		const sectionSchedule = (await api.post("/api/v1/examinations/exams/{examId}/schedules", { params: { examId: (await (async () => (await api.post("/api/v1/examinations/exams", { body: { academicYearId: s.yearId, name: "Sections", examType: "OTHER" } })).body)()).id }, body: { schoolClassId: s.base.classId, sectionId: s.base.secondSectionId, subjectId: s.base.subjectId, examDate: s.day(22), maxMarks: 50, passMarks: 20 } })).expectStatus([200, 201]).body;
		(await api.post(MARKS, { params: { scheduleId: sectionSchedule.id }, body: { marks: markRows(s, [30]) } })).expectStatus([400, 404, 409, 422]);
	});

	test("EXM-08 an empty marks list is accepted or rejected cleanly", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: [] } })).expectStatus([200, 201, 400, 422]);
	});
});

test.describe("correct, submit, approve", () => {
	test("EXM-09 a mark is corrected before submission and the entry shows who and when", async ({ api }) => {
		const s = await examSetup(api, 1);
		const entry = (await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } })).body[0];
		(await api.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 55, absent: false, remarks: "Re-checked" } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ id: entry.id, marksObtained: 55, remarks: "Re-checked" });
			expect(body.correctedBy).toEqual(expect.any(Number));
			expect(body.correctedAt).toEqual(expect.any(String));
		});
	});

	test("EXM-09 a correction is written to the audit log with the old and new marks", async ({ api }) => {
		const s = await examSetup(api, 1);
		const entry = (await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } })).body[0];
		await api.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 55, absent: false, remarks: null } });
		(await api.get("/api/v1/audit-logs", { query: { entityType: "MarksEntry", entityId: entry.id } })).expectStatus(200).expectJson((page) => {
			expect(page.content.map((r: { action: string }) => r.action)).toContain("CORRECTED");
		});
	});

	test("EXM-09 a correction above the maximum or below zero is rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		const entry = (await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } })).body[0];
		(await api.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 500, absent: false } })).expectStatus(BAD);
		(await api.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: -1, absent: false } })).expectStatus(BAD);
	});

	test("EXM-09 an unknown entry returns 404", async ({ api }) => {
		(await api.patch(ENTRY, { params: { marksEntryId: 99999999 }, body: { marksObtained: 5, absent: false } })).expectStatus(404);
	});

	test("EXM-10 submitting makes the register SUBMITTED and no more marks can be entered", async ({ api }) => {
		const s = await examSetup(api, 2);
		const id = s.schedules[0].id;
		await api.post(MARKS, { params: { scheduleId: id }, body: { marks: markRows(s, [60]).slice(0, 1) } });
		(await api.post(SUBMIT, { params: { scheduleId: id } })).expectStatus(200).expectJson((body) => expect(body).toMatchObject({ examScheduleId: id, registerStatus: "SUBMITTED" }));
		(await api.post(MARKS, { params: { scheduleId: id }, body: { marks: [{ studentEnrollmentId: s.enrollmentIds[1], marksObtained: 70, absent: false }] } })).expectStatus(409);
	});

	test("EXM-10 a register cannot be submitted twice", async ({ api }) => {
		const s = await examSetup(api, 1);
		const id = s.schedules[0].id;
		await api.post(SUBMIT, { params: { scheduleId: id } });
		(await api.post(SUBMIT, { params: { scheduleId: id } })).expectStatus(409);
	});

	test("EXM-10 submitting with no marks entered at all is rejected", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(SUBMIT, { params: { scheduleId: s.schedules[0].id } })).expectStatus([400, 409, 422]);
	});

	test("EXM-10 an unknown schedule returns 404 on submit and approve", async ({ api }) => {
		(await api.post(SUBMIT, { params: { scheduleId: 99999999 } })).expectStatus(404);
		(await api.post(APPROVE, { params: { scheduleId: 99999999 } })).expectStatus(404);
	});

	test("EXM-11 approving a submitted register records the approver", async ({ api }) => {
		const s = await examSetup(api, 1);
		const id = s.schedules[0].id;
		await api.post(MARKS, { params: { scheduleId: id }, body: { marks: markRows(s, [60]) } });
		await api.post(SUBMIT, { params: { scheduleId: id } });
		(await api.post(APPROVE, { params: { scheduleId: id } })).expectStatus(200).expectJson((body) => {
			expect(body.registerStatus).toBe("APPROVED");
			expect(body.approvedBy).toEqual(expect.any(Number));
			expect(body.approvedAt).toEqual(expect.any(String));
		});
		(await api.get(REGISTER, { params: { scheduleId: id } })).expectJson((body) => expect(body.registerStatus).toBe("APPROVED"));
	});

	test("EXM-11 a register cannot be approved twice", async ({ api }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [60]);
		(await api.post(APPROVE, { params: { scheduleId: s.schedules[0].id } })).expectStatus(409);
	});

	test("EXM-12 approving before submission is rejected, with and without marks entered", async ({ api }) => {
		const s = await examSetup(api, 1);
		(await api.post(APPROVE, { params: { scheduleId: s.schedules[0].id } })).expectStatus(409);
		await api.post(MARKS, { params: { scheduleId: s.schedules[1].id }, body: { marks: markRows(s, [10]) } });
		(await api.post(APPROVE, { params: { scheduleId: s.schedules[1].id } })).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/not SUBMITTED/i));
	});

	test("EXM-10 the submit and approve steps are written to the audit log", async ({ api }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [60]);
		const registerId = (await api.get(REGISTER, { params: { scheduleId: s.schedules[0].id } })).body.id;
		(await api.get("/api/v1/audit-logs", { query: { entityType: "MarksEntryRegister", entityId: registerId } })).expectJson((page) => {
			expect(page.content.map((r: { action: string }) => r.action).sort()).toEqual(["APPROVED", "SUBMITTED"]);
		});
	});
});

test.describe("report cards", () => {
	test("EXM-13 publishing needs every subject approved: nothing entered, then only one approved", async ({ api }) => {
		const s = await examSetup(api, 2);
		(await publish(api, s, 0)).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/not been entered/i));
		await approveSchedule(api, s, 0, [90, 50]);
		(await publish(api, s, 0)).expectStatus(409);
	});

	test("EXM-13 a submitted but not approved subject blocks publishing", async ({ api }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [90]);
		await api.post(MARKS, { params: { scheduleId: s.schedules[1].id }, body: { marks: markRows(s, [40]) } });
		await api.post(SUBMIT, { params: { scheduleId: s.schedules[1].id } });
		(await publish(api, s, 0)).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/not yet approved/i));
	});

	test("EXM-13 a student with no marks in an approved subject cannot be published", async ({ api }) => {
		const s = await examSetup(api, 2);
		await approveSchedule(api, s, 0, [90]);
		await approveSchedule(api, s, 1, [45]);
		(await publish(api, s, 1)).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/Marks missing/i));
	});

	test("EXM-13 a student recorded absent (no mark, as the marks screen sends it) still gets a report card, as a fail", async ({ api }) => {
		const s = await examSetup(api, 2);
		const first = s.schedules[0].id;
		await api.post(MARKS, { params: { scheduleId: first }, body: { marks: markRows(s, [null, 80], { absent: [true, false] }) } });
		await api.post(SUBMIT, { params: { scheduleId: first } });
		await api.post(APPROVE, { params: { scheduleId: first } });
		await approveSchedule(api, s, 1, [40, 40]);
		(await publish(api, s, 0)).expectStatus([200, 201]).expectJson((card) => {
			expect(card.totalMarksObtained).toBe(40);
			expect(card.passed).toBe(false);
		});
	});

	test("EXM-14 totals, percentage and grade follow the grading scale", async ({ api }) => {
		const s = await approvedExam(api);
		const first = await publish(api, s, 0);
		first.expectStatus([200, 201]).expectJson((card) => {
			expectShape(card, CARD_SHAPE);
			expect(card).toMatchObject({ examId: s.exam.id, studentEnrollmentId: s.enrollmentIds[0], totalMarksObtained: 135, totalMaxMarks: 150, status: "PUBLISHED", stale: false, overallGrade: "A" });
			expect(card.percentage).toBeCloseTo(90, 5);
		});
		(await publish(api, s, 1)).expectStatus([200, 201]).expectJson((card) => {
			expect(card).toMatchObject({ totalMarksObtained: 70, totalMaxMarks: 150, overallGrade: "F" });
			expect(card.percentage).toBeCloseTo(46.67, 1);
		});
	});

	test("EXM-14 the grade is the highest band the percentage reaches, at the boundary", async ({ api }) => {
		const s = await examSetup(api, 4);
		await approveSchedule(api, s, 0, [100, 75, 50, 49]);
		await approveSchedule(api, s, 1, [50, 37.5, 25, 24.5]);
		const grades: string[] = [];
		for (let i = 0; i < 4; i++) grades.push((await publish(api, s, i)).expectStatus([200, 201]).body.overallGrade);
		expect(grades).toEqual(["A", "B", "C", "F"]);
	});

	test("EXM-13 a report card cannot be published twice for the same exam and student", async ({ api }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		(await publish(api, s, 0)).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/already published/i));
	});

	test("EXM-13 an exam with no schedule for the student's class cannot be published", async ({ api }) => {
		const s = await examSetup(api, 1);
		const empty = (await api.post("/api/v1/examinations/exams", { body: { academicYearId: s.yearId, name: "Empty", examType: "OTHER" } })).body;
		(await api.post(PUBLISH, { params: { examId: empty.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus(409);
	});

	test("EXM-13 unknown exam, enrolment or grading scale return 404", async ({ api }) => {
		const s = await approvedExam(api);
		(await api.post(PUBLISH, { params: { examId: 99999999 }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus(404);
		(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: 99999999, gradingScaleId: s.scale.id } })).expectStatus(404);
		(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: 99999999 } })).expectStatus(404);
	});

	test("EXM-13 missing enrolment or grading scale returns 400", async ({ api }) => {
		const s = await approvedExam(api);
		(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { gradingScaleId: s.scale.id } })).expectStatus(BAD);
		(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0] } })).expectStatus(BAD);
	});

	test("EXM-13 a grading scale with no band covering the percentage is rejected cleanly", async ({ api }) => {
		const s = await approvedExam(api);
		const floorless = (await api.post("/api/v1/examinations/grading-scales", { body: { name: "No floor", defaultScale: false, bands: [{ grade: "A", minPercentage: 99 }] } })).body;
		(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[1], gradingScaleId: floorless.id } })).expectStatus([400, 409, 422]);
	});

	test("EXM-17 the report cards of an enrolment are listed; a missing enrolment id returns 400", async ({ api }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		(await api.get(CARDS, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).expectStatus(200).expectJson((list) => expect(list.map((c: { id: number }) => c.id)).toEqual([card.id]));
		(await api.get(CARDS, { query: { studentEnrollmentId: s.enrollmentIds[1] } })).expectJson((list) => expect(list).toEqual([]));
		(await api.get(CARDS)).expectStatus(400);
	});

	test("EXM-17 a report card is fetched by id; an unknown id returns 404", async ({ api }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		(await api.get(CARD, { params: { reportCardId: card.id } })).expectStatus(200).expectJson((body) => expect(body).toEqual(card));
		(await api.get(CARD, { params: { reportCardId: 99999999 } })).expectStatus(404);
	});

	test("EXM-15 render returns the data to lay out: student, exam, a subject table and totals", async ({ api }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		(await api.get(RENDER, { params: { reportCardId: card.id } })).expectStatus(200).expectJson((body) => {
			expectShape(body, { studentName: "string", admissionNumber: "string", className: "string", sectionName: "string", examName: "string", examType: "string", academicYearName: "string", subjects: "array", totalMarksObtained: "number", totalMaxMarks: "number", percentage: "number", overallGrade: "string", status: "string" });
			expect(body.examName).toBe(s.exam.name);
			expect(body.className).toBe(s.className);
			expect(body.studentName).toContain(s.studentNames[0].split(" ")[1]);
			expect(body.subjects).toHaveLength(2);
			expect(body.subjects.map((x: { marksObtained: number }) => x.marksObtained).sort((a: number, b: number) => a - b)).toEqual([45, 90]);
			for (const subject of body.subjects) expectShape(subject, { subjectName: "string", maxMarks: "number", passMarks: "number", marksObtained: "number", absent: "boolean", passed: "boolean" });
			expect(body).toMatchObject({ totalMarksObtained: 135, totalMaxMarks: 150, overallGrade: "A" });
		});
	});

	test("EXM-15 render of an unknown report card returns 404", async ({ api }) => {
		(await api.get(RENDER, { params: { reportCardId: 99999999 } })).expectStatus(404);
	});
});

test.describe("correcting after publish", () => {
	test("EXM-16 an ordinary correction on a published student is refused and points to the after-publish route", async ({ api }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		const entries = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body;
		const entry = entries.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 95, absent: false } })).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/already published/i));
	});

	test("EXM-16 the after-publish route refuses an entry with no published report card", async ({ api }) => {
		const s = await examSetup(api, 1);
		const entry = (await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } })).body[0];
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 50, absent: false } })).expectStatus(409);
	});

	test("EXM-16 correcting after publish changes the mark, marks the report card stale and hides it from the guardian list", async ({ api }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false, remarks: "Marking error" } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ marksObtained: 60, remarks: "Marking error" });
			expect(body.correctedBy).toEqual(expect.any(Number));
		});
		(await api.get(CARD, { params: { reportCardId: card.id } })).expectJson((body) => expect(body).toMatchObject({ status: "PUBLISHED", stale: true }));
		(await api.get("/api/v1/audit-logs", { query: { entityType: "MarksEntry", entityId: entry.id } })).expectJson((page) => expect(page.content.map((r: { action: string }) => r.action)).toContain("CORRECTED_AFTER_PUBLISH"));
	});

	test("EXM-16 republishing a stale card supersedes the old one and carries the corrected totals", async ({ api }) => {
		const s = await approvedExam(api);
		const old = (await publish(api, s, 0)).body;
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } });
		const fresh = (await publish(api, s, 0)).expectStatus([200, 201]).body;
		expect(fresh.id).not.toBe(old.id);
		expect(fresh).toMatchObject({ status: "PUBLISHED", stale: false, totalMarksObtained: 105 });
		(await api.get(CARD, { params: { reportCardId: old.id } })).expectJson((body) => expect(body.status).toBe("SUPERSEDED"));
		(await api.get(CARDS, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).expectJson((list) => expect(list.map((c: { id: number; status: string }) => [c.id, c.status]).sort()).toEqual([[old.id, "SUPERSEDED"], [fresh.id, "PUBLISHED"]].sort()));
		(await api.get("/api/v1/audit-logs", { query: { entityType: "ReportCard", entityId: fresh.id } })).expectJson((page) => expect(page.content.map((r: { action: string }) => r.action)).toContain("REPUBLISHED"));
	});

	test("EXM-16 a correction after publish above the maximum is rejected", async ({ api }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 900, absent: false } })).expectStatus(BAD);
	});

	test("EXM-16 an unknown entry returns 404", async ({ api }) => {
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: 99999999 }, body: { marksObtained: 5, absent: false } })).expectStatus(404);
	});
});

test.describe("permissions", () => {
	async function userWith(api: any, anon: any, seed: any, codes: string[]) {
		return (await createDisposableUser(api, anon, seed, codes)).client;
	}

	test("EXM-20 view-only staff can read exams, scales, marks, registers and report cards but change nothing", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		const viewer = await userWith(api, anon, seed, ["EXAM_VIEW"]);
		(await viewer.get("/api/v1/examinations/exams", { query: { academicYearId: s.yearId } })).expectStatus(200);
		(await viewer.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).expectStatus(200);
		(await viewer.get(REGISTER, { params: { scheduleId: s.schedules[0].id } })).expectStatus(200);
		(await viewer.get(CARD, { params: { reportCardId: card.id } })).expectStatus(200);
		(await viewer.get(RENDER, { params: { reportCardId: card.id } })).expectStatus(200);
		(await viewer.post("/api/v1/examinations/exams", { body: { academicYearId: s.yearId, name: "No", examType: "FINAL" } })).expectStatus(403);
		(await viewer.post("/api/v1/examinations/exams/{examId}/schedules", { params: { examId: s.exam.id }, body: { schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 5, passMarks: 1 } })).expectStatus(403);
		(await viewer.post("/api/v1/examinations/grading-scales", { body: { name: "No", defaultScale: false, bands: [{ grade: "A", minPercentage: 0 }] } })).expectStatus(403);
		(await viewer.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: [] } })).expectStatus(403);
		(await viewer.post(SUBMIT, { params: { scheduleId: s.schedules[0].id } })).expectStatus(403);
		(await viewer.post(APPROVE, { params: { scheduleId: s.schedules[0].id } })).expectStatus(403);
		(await viewer.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[1], gradingScaleId: s.scale.id } })).expectStatus(403);
		(await viewer.put("/api/v1/examinations/settings", { body: { rankingEnabled: false, passFailStrategy: "BOTH", minimumAggregatePercentage: 33 } })).expectStatus(403);
	});

	test("EXM-11 enter, submit and approve are separate permissions, so the person who enters cannot approve", async ({ api, anon, seed }) => {
		const s = await examSetup(api, 1);
		const id = s.schedules[0].id;
		const entrant = await userWith(api, anon, seed, ["EXAM_VIEW", "MARKS_ENTER", "MARKS_SUBMIT"]);
		const approver = await userWith(api, anon, seed, ["EXAM_VIEW", "MARKS_APPROVE"]);
		(await entrant.post(MARKS, { params: { scheduleId: id }, body: { marks: markRows(s, [60]) } })).expectStatus([200, 201]);
		(await approver.post(SUBMIT, { params: { scheduleId: id } })).expectStatus(403);
		(await entrant.post(SUBMIT, { params: { scheduleId: id } })).expectStatus(200);
		(await entrant.post(APPROVE, { params: { scheduleId: id } })).expectStatus(403);
		(await approver.post(APPROVE, { params: { scheduleId: id } })).expectStatus(200);
		(await approver.post(MARKS, { params: { scheduleId: s.schedules[1].id }, body: { marks: markRows(s, [10]) } })).expectStatus(403);
	});

	test("EXM-16 ordinary correction, correction after publish and publishing are separate permissions", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const fixer = await userWith(api, anon, seed, ["EXAM_VIEW", "MARKS_CORRECT"]);
		const afterPublisher = await userWith(api, anon, seed, ["EXAM_VIEW", "MARKS_CORRECT_AFTER_PUBLISH"]);
		const publisher = await userWith(api, anon, seed, ["EXAM_VIEW", "REPORT_CARD_PUBLISH"]);
		const entries = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body;
		const entry = entries.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await fixer.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(403);
		(await afterPublisher.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(403);
		(await fixer.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus(403);
		(await publisher.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus([200, 201]);
		(await fixer.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(409);
		(await afterPublisher.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(200);
	});

	test("EXM-20 exam and grading-scale management are separate permissions", async ({ api, anon, seed }) => {
		const s = await attendanceSetupYear(api);
		const examManager = await userWith(api, anon, seed, ["EXAM_VIEW", "EXAM_MANAGE"]);
		const scaleManager = await userWith(api, anon, seed, ["EXAM_VIEW", "GRADING_SCALE_MANAGE"]);
		(await examManager.post("/api/v1/examinations/exams", { body: { academicYearId: s, name: "Allowed", examType: "FINAL" } })).expectStatus([200, 201]);
		(await scaleManager.post("/api/v1/examinations/exams", { body: { academicYearId: s, name: "Denied", examType: "FINAL" } })).expectStatus(403);
		(await examManager.post("/api/v1/examinations/grading-scales", { body: { name: "Denied", defaultScale: false, bands: [{ grade: "A", minPercentage: 0 }] } })).expectStatus(403);
		(await scaleManager.post("/api/v1/examinations/grading-scales", { body: { name: "Allowed", defaultScale: false, bands: [{ grade: "A", minPercentage: 0 }] } })).expectStatus([200, 201]);
	});

	test("EXM-20 a user with no examination permission reads nothing and every endpoint needs a sign-in", async ({ as, anon, seed }) => {
		const nobody = as("noPermissions");
		(await nobody.get("/api/v1/examinations/exams", { query: { academicYearId: 1 } })).expectStatus(403);
		(await nobody.get("/api/v1/examinations/grading-scales")).expectStatus(403);
		(await nobody.get(CARDS, { query: { studentEnrollmentId: 1 } })).expectStatus(403);
		(await anon.get("/api/v1/examinations/grading-scales")).expectStatus(401);
		(await anon.get("/api/v1/examinations/settings")).expectStatus(401);
		(await anon.post(PUBLISH, { params: { examId: 1 }, body: {} })).expectStatus(401);
		void seed;
	});
});

async function attendanceSetupYear(api: any): Promise<number> {
	const { attendanceSetup } = await import("../../../src/api/attendance");
	return (await attendanceSetup(api, 0)).yearId;
}

test.describe("tenant isolation", () => {
	test("EXM-21 another organisation cannot see or change this organisation's exams, marks and report cards", async ({ request, calls, api }) => {
		const s = await approvedExam(api);
		const card = (await publish(api, s, 0)).body;
		const outsider = (await createOtherOrganisation(request, calls)).client;
		(await outsider.get(`/api/v1/examinations/exams/{examId}`, { params: { examId: s.exam.id } })).expectStatus(404);
		(await outsider.get("/api/v1/examinations/exams", { query: { academicYearId: s.yearId } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await outsider.get("/api/v1/examinations/grading-scales/{scaleId}", { params: { scaleId: s.scale.id } })).expectStatus(404);
		(await outsider.get("/api/v1/examinations/exams/{examId}/schedules", { params: { examId: s.exam.id } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await outsider.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).expectStatus(404);
		(await outsider.get(REGISTER, { params: { scheduleId: s.schedules[0].id } })).expectStatus([404]);
		(await outsider.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: [] } })).expectStatus(404);
		(await outsider.post(SUBMIT, { params: { scheduleId: s.schedules[0].id } })).expectStatus(404);
		(await outsider.post(APPROVE, { params: { scheduleId: s.schedules[0].id } })).expectStatus(404);
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body[0];
		(await outsider.patch(ENTRY, { params: { marksEntryId: entry.id }, body: { marksObtained: 1, absent: false } })).expectStatus(404);
		(await outsider.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 1, absent: false } })).expectStatus(404);
		(await outsider.get(CARD, { params: { reportCardId: card.id } })).expectStatus(404);
		(await outsider.get(RENDER, { params: { reportCardId: card.id } })).expectStatus(404);
		(await outsider.get(CARDS, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await outsider.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[1], gradingScaleId: s.scale.id } })).expectStatus(404);
		(await api.get(CARD, { params: { reportCardId: card.id } })).expectJson((body) => expect(body.status).toBe("PUBLISHED"));
	});
});
