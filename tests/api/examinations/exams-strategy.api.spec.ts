// Pass/fail strategy and ranking. These are organisation-wide settings and report cards can only be
// published in the shared organisation (students: Operion #354), so the tests run one after another
// and put the defaults back at the end. No other examination spec asserts `passed` or `rank`.

import { test, expect } from "../../../src/api/fixtures";
import { approveSchedule, examSetup } from "../../../src/api/examinations";
import type { ApiClient } from "../../../src/api/apiClient";

const SETTINGS = "/api/v1/examinations/settings";
const PUBLISH = "/api/v1/examinations/exams/{examId}/report-cards";
const MARKS = "/api/v1/examinations/schedules/{scheduleId}/marks";
const DEFAULTS = { rankingEnabled: false, passFailStrategy: "PASS_EVERY_SUBJECT", minimumAggregatePercentage: 33 };

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ api }) => {
	await api.put(SETTINGS, { body: DEFAULTS });
});

type Setup = Awaited<ReturnType<typeof examSetup>>;
const publish = async (api: ApiClient, s: Setup, index: number) =>
	(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[index], gradingScaleId: s.scale.id } })).expectStatus([200, 201]).body;

/** Maths (max 100, pass 35) and science (max 50, pass 20) marks for each student, approved. */
async function marked(api: ApiClient, maths: number[], science: number[]) {
	const s = await examSetup(api, maths.length);
	await approveSchedule(api, s, 0, maths);
	await approveSchedule(api, s, 1, science);
	return s;
}

test.describe("pass or fail", () => {
	test("EXM-14 pass-every-subject fails a student who is below the pass mark in any one subject", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, passFailStrategy: "PASS_EVERY_SUBJECT" } });
		const s = await marked(api, [90, 40], [15, 30]);
		expect((await publish(api, s, 0)).passed).toBe(false);
		expect((await publish(api, s, 1)).passed).toBe(true);
	});

	test("EXM-14 minimum-aggregate ignores single subjects and uses the overall percentage", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, passFailStrategy: "MINIMUM_AGGREGATE_PERCENTAGE", minimumAggregatePercentage: 40 } });
		const s = await marked(api, [90, 10], [15, 5]);
		expect((await publish(api, s, 0)).passed).toBe(true);
		expect((await publish(api, s, 1)).passed).toBe(false);
	});

	test("EXM-14 a student exactly on the minimum aggregate passes", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, passFailStrategy: "MINIMUM_AGGREGATE_PERCENTAGE", minimumAggregatePercentage: 60 } });
		const s = await marked(api, [60], [30]);
		expect((await publish(api, s, 0)).passed).toBe(true);
	});

	test("EXM-14 both needs every subject passed and the aggregate reached", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, passFailStrategy: "BOTH", minimumAggregatePercentage: 60 } });
		const s = await marked(api, [90, 70, 36], [15, 30, 20]);
		const passed = [];
		for (let i = 0; i < 3; i++) passed.push((await publish(api, s, i)).passed);
		expect(passed).toEqual([false, true, false]);
	});

	test("EXM-14 an absent student fails whatever the strategy", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, passFailStrategy: "PASS_EVERY_SUBJECT" } });
		const s = await examSetup(api, 1);
		await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: [{ studentEnrollmentId: s.enrollmentIds[0], marksObtained: 80, absent: true }] } });
		await api.post("/api/v1/examinations/schedules/{scheduleId}/submit", { params: { scheduleId: s.schedules[0].id } });
		await api.post("/api/v1/examinations/schedules/{scheduleId}/approve", { params: { scheduleId: s.schedules[0].id } });
		await approveSchedule(api, s, 1, [45]);
		expect((await publish(api, s, 0)).passed).toBe(false);
	});
});

test.describe("ranking", () => {
	test("EXM-22 with ranking off nobody is ranked", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, rankingEnabled: false } });
		const s = await marked(api, [90, 50], [40, 20]);
		const card = await publish(api, s, 0);
		expect(card.classRank).toBeNull();
		(await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).expectJson((list) => expect(list.every((e: { rank: number | null }) => e.rank === null)).toBe(true));
	});

	test("EXM-22 with ranking on, equal scores share a rank and the next rank is skipped (1, 1, 3)", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, rankingEnabled: true } });
		const s = await marked(api, [90, 90, 50], [40, 40, 20]);
		const cards = [await publish(api, s, 0), await publish(api, s, 1), await publish(api, s, 2)];
		const ranks = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.map((e: { studentEnrollmentId: number; rank: number }) => [e.studentEnrollmentId, e.rank]);
		expect(Object.fromEntries(ranks)).toEqual({ [s.enrollmentIds[0]]: 1, [s.enrollmentIds[1]]: 1, [s.enrollmentIds[2]]: 3 });
		const last = await Promise.all(cards.map(async (c) => (await api.get("/api/v1/examinations/report-cards/{reportCardId}", { params: { reportCardId: c.id } })).body.classRank));
		expect(last).toEqual([1, 1, 3]);
	});

	test("EXM-22 a correction after publish re-ranks the subject", async ({ api }) => {
		await api.put(SETTINGS, { body: { ...DEFAULTS, rankingEnabled: true } });
		const s = await marked(api, [90, 60], [40, 30]);
		await publish(api, s, 0);
		await publish(api, s, 1);
		const entries = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body;
		const second = entries.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[1]);
		(await api.patch("/api/v1/examinations/marks/{marksEntryId}/correct-after-publish", { params: { marksEntryId: second.id }, body: { marksObtained: 95, absent: false } })).expectStatus(200);
		(await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).expectJson((list) => {
			const rank = (i: number) => list.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[i]).rank;
			expect([rank(0), rank(1)]).toEqual([2, 1]);
		});
	});
});
