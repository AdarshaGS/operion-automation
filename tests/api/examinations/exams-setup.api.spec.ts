// Examination setup: grading scales, exams, schedules. IDs refer to docs/SCENARIOS.md section 8 (EXM-*).
// Exam settings are organisation-wide, so their scenarios run in a throwaway organisation and never
// touch the shared one that every other test publishes report cards in.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { BANDS, createExam, createGradingScale } from "../../../src/api/examinations";
import { attendanceSetup } from "../../../src/api/attendance";
import { expectShape } from "../../../src/api/shapes";

const SCALES = "/api/v1/examinations/grading-scales";
const EXAMS = "/api/v1/examinations/exams";
const SCHEDULES = "/api/v1/examinations/exams/{examId}/schedules";
const SETTINGS = "/api/v1/examinations/settings";
const BAD = [400, 422];

test.describe("grading scales", () => {
	test("EXM-01 a scale is created with its bands, highest first, and is returned whole", async ({ api }) => {
		const scale = await createGradingScale(api, { bands: [BANDS[3], BANDS[0], BANDS[2], BANDS[1]] });
		expectShape(scale, { id: "number", name: "string", defaultScale: "boolean", bands: "array" });
		expect(scale.bands.map((b) => b.grade).sort()).toEqual(["A", "B", "C", "F"]);
		(await api.get(`${SCALES}/{scaleId}`, { params: { scaleId: scale.id } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ id: scale.id, name: scale.name, defaultScale: false });
			expect(body.bands.map((b: { minPercentage: number }) => b.minPercentage)).toEqual([90, 75, 50, 0]);
			expect(body.bands[0]).toEqual({ grade: "A", minPercentage: 90, remark: "Outstanding" });
		});
	});

	test("EXM-01 a scale needs a name", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "", defaultScale: false, bands: BANDS } })).expectStatus(BAD);
		(await api.post(SCALES, { body: { defaultScale: false, bands: BANDS } })).expectStatus(BAD);
	});

	test("EXM-01 a scale needs at least one band", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "Empty", defaultScale: false, bands: [] } })).expectStatus(BAD);
	});

	test("EXM-01 a scale must have a band that starts at 0 so every percentage gets a grade", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "No floor", defaultScale: false, bands: [{ grade: "A", minPercentage: 50 }] } })).expectStatus(BAD);
	});

	test("EXM-01 band minimums must be between 0 and 100", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "Out of range", defaultScale: false, bands: [{ grade: "A", minPercentage: 150 }, { grade: "F", minPercentage: 0 }] } })).expectStatus(BAD);
		(await api.post(SCALES, { body: { name: "Negative", defaultScale: false, bands: [{ grade: "F", minPercentage: -5 }] } })).expectStatus(BAD);
	});

	test("EXM-01 two bands cannot start at the same percentage", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "Overlap", defaultScale: false, bands: [{ grade: "A", minPercentage: 50 }, { grade: "B", minPercentage: 50 }, { grade: "F", minPercentage: 0 }] } })).expectStatus(BAD);
	});

	test("EXM-01 a band needs a grade", async ({ api }) => {
		(await api.post(SCALES, { body: { name: "No grade", defaultScale: false, bands: [{ minPercentage: 0 }] } })).expectStatus(BAD);
	});

	test("EXM-02 the list contains new scales with their bands", async ({ api }) => {
		const scale = await createGradingScale(api);
		(await api.get(SCALES)).expectStatus(200).expectJson((list) => {
			const found = list.find((s: { id: number }) => s.id === scale.id);
			expect(found.bands).toHaveLength(4);
		});
	});

	test("EXM-02 an unknown scale returns 404", async ({ api }) => {
		(await api.get(`${SCALES}/{scaleId}`, { params: { scaleId: 99999999 } })).expectStatus(404);
	});

	test("EXM-02 only one scale can be the default", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const first = await createGradingScale(org.client, { defaultScale: true });
		const second = await createGradingScale(org.client, { defaultScale: true });
		(await org.client.get(SCALES)).expectJson((list) => {
			const defaults = list.filter((s: { defaultScale: boolean }) => s.defaultScale).map((s: { id: number }) => s.id);
			expect(defaults).toEqual([second.id]);
			expect(defaults).not.toContain(first.id);
		});
	});
});

test.describe("exams", () => {
	test("EXM-03 an exam is created active for an academic year and listed for it", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const exam = await createExam(api, s.yearId, { name: "Half yearly", examType: "MID_TERM" });
		expectShape(exam, { id: "number", academicYearId: "number", name: "string", examType: "string", status: "string" });
		expect(exam).toMatchObject({ academicYearId: s.yearId, name: "Half yearly", examType: "MID_TERM", status: "ACTIVE" });
		(await api.get(EXAMS, { query: { academicYearId: s.yearId } })).expectStatus(200).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).toEqual([exam.id]));
		(await api.get(`${EXAMS}/{examId}`, { params: { examId: exam.id } })).expectStatus(200).expectJson((body) => expect(body).toEqual(exam));
	});

	test("EXM-03 all four exam types are accepted", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		for (const examType of ["UNIT_TEST", "MID_TERM", "FINAL", "OTHER"]) {
			expect((await createExam(api, s.yearId, { examType })).examType).toBe(examType);
		}
	});

	test("EXM-03 the list is limited to the academic year asked for", async ({ api }) => {
		const a = await attendanceSetup(api, 0);
		const b = await attendanceSetup(api, 0);
		const inA = await createExam(api, a.yearId);
		await createExam(api, b.yearId);
		(await api.get(EXAMS, { query: { academicYearId: a.yearId } })).expectJson((list) => expect(list.map((e: { id: number }) => e.id)).toEqual([inA.id]));
	});

	test("EXM-03 listing without an academic year returns 400", async ({ api }) => {
		(await api.get(EXAMS)).expectStatus(400);
	});

	test("EXM-03 an exam needs a name", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		(await api.post(EXAMS, { body: { academicYearId: s.yearId, name: "", examType: "FINAL" } })).expectStatus(BAD);
		(await api.post(EXAMS, { body: { academicYearId: s.yearId, name: "   ", examType: "FINAL" } })).expectStatus(BAD);
	});

	test("EXM-03 an unknown exam type returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		(await api.post(EXAMS, { body: { academicYearId: s.yearId, name: "Bad type", examType: "NOPE" } })).expectStatus(BAD);
	});

	test("EXM-03 a missing academic year returns 400", async ({ api }) => {
		(await api.post(EXAMS, { body: { name: "No year", examType: "FINAL" } })).expectStatus(BAD);
	});

	test("EXM-03 an unknown academic year returns 404", async ({ api }) => {
		(await api.post(EXAMS, { body: { academicYearId: 99999999, name: "Ghost", examType: "FINAL" } })).expectStatus(404);
	});

	test("EXM-03 an unknown exam returns 404", async ({ api }) => {
		(await api.get(`${EXAMS}/{examId}`, { params: { examId: 99999999 } })).expectStatus(404);
	});
});

test.describe("schedules", () => {
	test("EXM-04 a schedule for a whole class is added and listed", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		const res = await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, sectionId: null, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 100, passMarks: 35 } });
		res.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", examId: "number", schoolClassId: "number", subjectId: "number", examDate: "string", maxMarks: "number", passMarks: "number" });
			expect(body).toMatchObject({ examId: created.id, sectionId: null, maxMarks: 100, passMarks: 35, examDate: s.day(20) });
		});
		(await api.get(SCHEDULES, { params: { examId: created.id } })).expectStatus(200).expectJson((list) => expect(list.map((x: { id: number }) => x.id)).toEqual([res.body.id]));
	});

	test("EXM-04 a schedule may be for one section only", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, sectionId: s.sectionId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 20 } })).expectStatus([200, 201]).expectJson((body) => expect(body.sectionId).toBe(s.sectionId));
	});

	test("EXM-04 a subject cannot be scheduled twice for the same class, or for a section already covered by a whole-class schedule", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		const body = (extra: Record<string, unknown> = {}) => ({ schoolClassId: s.base.classId, sectionId: null, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 20, ...extra });
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body() })).expectStatus([200, 201]);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body() })).expectStatus(409).expectJson((e) => expect(e.error).toMatch(/already covers/i));
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body({ sectionId: s.sectionId }) })).expectStatus(409);
	});

	test("EXM-04 a section schedule blocks a whole-class one but not another section's", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		const body = (sectionId: number | null) => ({ schoolClassId: s.base.classId, sectionId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 20 });
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body(s.sectionId) })).expectStatus([200, 201]);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body(s.base.secondSectionId) })).expectStatus([200, 201]);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body(null) })).expectStatus(409);
	});

	test("EXM-05 pass marks above the maximum are rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 60 } })).expectStatus(BAD);
	});

	test("EXM-05 zero or negative maximum, and negative pass marks, are rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		const body = (extra: Record<string, unknown>) => ({ schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 20, ...extra });
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body({ maxMarks: 0, passMarks: 0 }) })).expectStatus(BAD);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body({ maxMarks: -5, passMarks: 0 }) })).expectStatus(BAD);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: body({ passMarks: -1 }) })).expectStatus(BAD);
	});

	test("EXM-05 a missing exam date returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, subjectId: s.base.subjectId, maxMarks: 50, passMarks: 20 } })).expectStatus(BAD);
	});

	test("EXM-05 missing marks fields return 400", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: s.day(20) } })).expectStatus(BAD);
	});

	test("EXM-04 an exam date outside the exam's academic year is rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: "2000-01-01", maxMarks: 50, passMarks: 20 } })).expectStatus(BAD.concat(409));
	});

	test("EXM-04 a class from a different academic year than the exam is rejected", async ({ api }) => {
		const a = await attendanceSetup(api, 0);
		const b = await attendanceSetup(api, 0);
		const created = await createExam(api, a.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: b.base.classId, subjectId: a.base.subjectId, examDate: a.day(20), maxMarks: 50, passMarks: 20 } })).expectStatus([400, 404, 409, 422]);
	});

	test("EXM-04 a section that belongs to another class is rejected", async ({ api }) => {
		const a = await attendanceSetup(api, 0);
		const b = await attendanceSetup(api, 0);
		const created = await createExam(api, a.yearId);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { schoolClassId: a.base.classId, sectionId: b.sectionId, subjectId: a.base.subjectId, examDate: a.day(20), maxMarks: 50, passMarks: 20 } })).expectStatus([400, 404, 409, 422]);
	});

	test("EXM-04 unknown class, subject or exam return 404", async ({ api }) => {
		const s = await attendanceSetup(api, 0);
		const created = await createExam(api, s.yearId);
		const ok = { schoolClassId: s.base.classId, subjectId: s.base.subjectId, examDate: s.day(20), maxMarks: 50, passMarks: 20 };
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { ...ok, schoolClassId: 99999999 } })).expectStatus(404);
		(await api.post(SCHEDULES, { params: { examId: created.id }, body: { ...ok, subjectId: 99999999 } })).expectStatus(404);
		(await api.post(SCHEDULES, { params: { examId: 99999999 }, body: ok })).expectStatus(404);
		(await api.get(SCHEDULES, { params: { examId: 99999999 } })).expectStatus(404);
	});
});

test.describe("examination settings", () => {
	test("EXM-18 a new organisation has the defaults, and a change is read back", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get(SETTINGS)).expectStatus(200).expectJson((body) => expect(body).toEqual({ rankingEnabled: false, passFailStrategy: "PASS_EVERY_SUBJECT", minimumAggregatePercentage: 33 }));
		(await org.client.put(SETTINGS, { body: { rankingEnabled: true, passFailStrategy: "BOTH", minimumAggregatePercentage: 40 } })).expectStatus(200).expectJson((body) => expect(body).toEqual({ rankingEnabled: true, passFailStrategy: "BOTH", minimumAggregatePercentage: 40 }));
		(await org.client.get(SETTINGS)).expectJson((body) => expect(body).toEqual({ rankingEnabled: true, passFailStrategy: "BOTH", minimumAggregatePercentage: 40 }));
	});

	test("EXM-18 all three pass/fail strategies are accepted", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (const passFailStrategy of ["PASS_EVERY_SUBJECT", "MINIMUM_AGGREGATE_PERCENTAGE", "BOTH"]) {
			(await org.client.put(SETTINGS, { body: { rankingEnabled: false, passFailStrategy, minimumAggregatePercentage: 35 } })).expectStatus(200).expectJson((body) => expect(body.passFailStrategy).toBe(passFailStrategy));
		}
	});

	test("EXM-18 an unknown strategy returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put(SETTINGS, { body: { rankingEnabled: false, passFailStrategy: "NOPE", minimumAggregatePercentage: 35 } })).expectStatus(BAD);
	});

	test("EXM-18 a minimum percentage outside 0 to 100 returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put(SETTINGS, { body: { rankingEnabled: false, passFailStrategy: "BOTH", minimumAggregatePercentage: 150 } })).expectStatus(BAD);
		(await org.client.put(SETTINGS, { body: { rankingEnabled: false, passFailStrategy: "BOTH", minimumAggregatePercentage: -1 } })).expectStatus(BAD);
	});

	test("EXM-18 a missing strategy returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put(SETTINGS, { body: { rankingEnabled: false, minimumAggregatePercentage: 35 } })).expectStatus(BAD);
	});

	test("EXM-18 one organisation's settings never change another's", async ({ request, calls }) => {
		const a = await createOtherOrganisation(request, calls);
		const b = await createOtherOrganisation(request, calls);
		await a.client.put(SETTINGS, { body: { rankingEnabled: true, passFailStrategy: "BOTH", minimumAggregatePercentage: 60 } });
		(await b.client.get(SETTINGS)).expectJson((body) => expect(body).toMatchObject({ rankingEnabled: false, passFailStrategy: "PASS_EVERY_SUBJECT", minimumAggregatePercentage: 33 }));
	});
});
