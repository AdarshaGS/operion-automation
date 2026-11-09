// Timetable workflow on top of the rules: draft/publish, auto-generated drafts, substitutions, alternative school
// days (period templates), CSV export and the teacher / guardian portal views. IDs refer to docs/SCENARIOS.md
// section 4 (ACA-34 to ACA-39). Everything that changes data runs in throwaway organisations, except the guardian
// portal view, which needs a student and so runs in the shared organisation (Operion #354).

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { createPerson } from "../../../src/api/academics";
import { attendanceSetup } from "../../../src/api/attendance";
import { allocateLeave, createLeaveType, createStaff, HR, raiseLeave } from "../../../src/api/hr";
import { guardianInPortalRole, portalUser } from "../../../src/api/portal";
import { expectShape } from "../../../src/api/shapes";
import { classSubjectIds, firstWeekdayOnOrAfter, putEntry, scratchPeriod, SUMMARY, setQuota, timetableBase, type TimetableBase } from "../../../src/api/timetable";
import type { ApiClient } from "../../../src/api/apiClient";

const BAD = [400, 422];
const PUBLISH = "/api/v1/sections/{sectionId}/timetable/publish";
const UNPUBLISH = "/api/v1/sections/{sectionId}/timetable/unpublish";
const GENERATE = "/api/v1/sections/{sectionId}/timetable/generate";
const SUBSTITUTIONS = "/api/v1/timetable/substitutions";
const UNAVAILABILITY = "/api/v1/teachers/{personId}/unavailability";
const ME_TIMETABLE = "/api/v1/me/timetable";

async function quotas(client: ApiClient, base: TimetableBase, perSubject: [number, number]) {
	const ids = await classSubjectIds(client, base.classId);
	(await setQuota(client, base.classId, ids.get(base.subjectId)!, perSubject[0])).expectStatus(200);
	(await setQuota(client, base.classId, ids.get(base.secondSubjectId)!, perSubject[1])).expectStatus(200);
}

test.describe("ACA-34 draft and publish", () => {
	test("ACA-34 a section with no slots cannot be published; with slots it can, and unpublish returns it to draft", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await org.client.post(PUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("nothing to publish"));
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await org.client.post(PUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(200).expectJson((summary) => {
			expectShape(summary, { sectionId: "number", published: "boolean", publishedAt: "string" });
			expect(summary.published).toBe(true);
		});
		(await org.client.get(SUMMARY, { params: { sectionId: base.sectionId } })).expectJson((summary) => expect(summary.published).toBe(true));
		(await org.client.post(UNPUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(200).expectJson((summary) => expect(summary).toMatchObject({ published: false, publishedAt: null }));
		(await org.client.post(PUBLISH, { params: { sectionId: 99999999 } })).expectStatus(404);
	});

	test("ACA-34 publishing the year publishes only sections that have slots and are still drafts", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await org.client.post("/api/v1/academic-years/{academicYearId}/timetable/publish", { params: { academicYearId: base.yearId } })).expectStatus(200).expectJson((r) => expect(r).toEqual({ published: 1 }));
		(await org.client.post("/api/v1/academic-years/{academicYearId}/timetable/publish", { params: { academicYearId: base.yearId } })).expectStatus(200).expectJson((r) => expect(r).toEqual({ published: 0 }));
	});

	test("ACA-34 edits to a published timetable go live at once, but generating over it is refused", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await org.client.post(PUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.secondSubjectId, base.teacherPersonId, "TUESDAY", base.p1)).expectStatus(200);
		(await org.client.get(SUMMARY, { params: { sectionId: base.sectionId } })).expectJson((summary) => expect(summary).toMatchObject({ published: true, placedSlots: 2 }));
		(await org.client.post(GENERATE, { params: { sectionId: base.sectionId }, body: {} })).expectStatus(409).expectJson((b) => expect(b.error).toContain("published"));
	});
});

test.describe("ACA-35 auto-generated draft", () => {
	test("ACA-35 fills each subject's weekly quota, leaves what is already placed, and a second run places nothing more", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		await quotas(org.client, base, [3, 2]);
		const first = await org.client.post(GENERATE, { params: { sectionId: base.sectionId }, body: {} });
		first.expectStatus(200).expectJson((result) => {
			expectShape(result, { placed: "number", unplaced: "number", sections: "array" });
			expect(result).toMatchObject({ placed: 5, unplaced: 0 });
			expect(result.sections).toHaveLength(1);
			expect(result.sections[0].shortfalls).toEqual([]);
		});
		(await org.client.get(SUMMARY, { params: { sectionId: base.sectionId } })).expectJson((summary) => {
			expect(summary).toMatchObject({ placedSlots: 5, unplacedPeriods: 0, published: false });
			for (const subject of summary.subjects) expect(subject.remaining).toBe(0);
		});
		(await org.client.post(GENERATE, { params: { sectionId: base.sectionId }, body: {} })).expectStatus(200).expectJson((result) => expect(result.placed).toBe(0));
		(await org.client.post(GENERATE, { params: { sectionId: base.sectionId }, body: { clearExisting: true } })).expectStatus(200).expectJson((result) => expect(result.placed).toBe(5));
		// A subject is not repeated in the same period on the same day more than the quota needs: no teacher or section clash exists.
		const entries = (await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).expectStatus(200).body as { dayOfWeek: string; periodId: number }[];
		expect(new Set(entries.map((e) => `${e.dayOfWeek}|${e.periodId}`)).size).toBe(entries.length);
	});

	test("ACA-35 reports a shortfall with a reason when a quota is bigger than the week, and honours teacher unavailability", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		await quotas(org.client, base, [3, 40]);
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "MONDAY" } })).expectStatus([200, 201]);
		const result = (await org.client.post(GENERATE, { params: { sectionId: base.sectionId }, body: {} })).expectStatus(200).body;
		expect(result.unplaced).toBeGreaterThan(0);
		const shortfalls = result.sections[0].shortfalls as { subjectId: number; missing: number; reason: string }[];
		expect(shortfalls.length).toBeGreaterThan(0);
		expect(shortfalls.every((s) => s.missing > 0 && s.reason.length > 0)).toBe(true);
		const entries = (await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).body as { dayOfWeek: string }[];
		expect(entries.some((e) => e.dayOfWeek === "MONDAY")).toBe(false);
	});

	test("ACA-35 a subject with a quota but no assigned teacher is reported, not guessed", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		await quotas(org.client, base, [2, 2]);
		const assignments = (await org.client.get("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.secondSectionId } })).expectStatus(200).body as { id: number; subjectId: number; status: string }[];
		const toEnd = assignments.find((a) => a.subjectId === base.subjectId && a.status === "ACTIVE")!;
		(await org.client.post("/api/v1/teacher-assignments/{id}/end", { params: { id: toEnd.id }, body: { endDate: "2026-06-02" } })).expectStatus(200);
		const result = (await org.client.post(GENERATE, { params: { sectionId: base.secondSectionId }, body: {} })).expectStatus(200).body;
		expect(result.sections[0].shortfalls).toEqual(expect.arrayContaining([expect.objectContaining({ subjectId: base.subjectId, missing: 2, reason: expect.stringContaining("no teacher") })]));
		expect(result.placed).toBe(2);
	});

	test("ACA-35 generating for the whole year covers every active section and skips a published one with a note", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		await quotas(org.client, base, [2, 2]);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "FRIDAY", base.p3)).expectStatus(200);
		(await org.client.post(PUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(200);
		const result = (await org.client.post("/api/v1/academic-years/{academicYearId}/timetable/generate", { params: { academicYearId: base.yearId }, body: {} })).expectStatus(200).body;
		expect(result.sections).toHaveLength(2);
		const a = result.sections.find((s: { sectionId: number }) => s.sectionId === base.sectionId);
		const b = result.sections.find((s: { sectionId: number }) => s.sectionId === base.secondSectionId);
		expect(a.placed).toBe(0);
		expect(a.shortfalls[0].reason).toContain("published");
		expect(b.placed).toBe(4);
	});
});

test.describe("ACA-36 substitutions", () => {
	async function slot(client: ApiClient) {
		const base = await timetableBase(client);
		const monday = firstWeekdayOnOrAfter(base.yearStart, "MONDAY");
		const entry = (await putEntry(client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200).body;
		return { base, monday, entryId: entry.id as number };
	}

	test("ACA-36 an absent teacher's slots are listed with free colleagues, cover can be assigned, changed and removed, and the weekly timetable is untouched", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const { base, monday, entryId } = await slot(org.client);
		const needs = (await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday, to: monday } })).expectStatus(200).body;
		expect(needs).toHaveLength(1);
		expectShape(needs[0], { date: "string", dayOfWeek: "string", entryId: "number", sectionId: "number", subjectName: "string", periodLabel: "string", substitution: "nullable", candidates: "array" });
		expect(needs[0]).toMatchObject({ date: monday, dayOfWeek: "MONDAY", entryId, substitution: null });
		const candidate = needs[0].candidates.find((c: { personId: number }) => c.personId === base.secondTeacherPersonId);
		expect(candidate, "the other teacher is free that period").toBeTruthy();
		expectShape(candidate, { personId: "number", name: "string", rank: "string" });

		const cover = await org.client.post(SUBSTITUTIONS, { body: { entryId, date: monday, substituteTeacherPersonId: base.secondTeacherPersonId, reason: "Sick leave" } });
		cover.expectStatus([200, 201]).expectJson((s) => {
			expectShape(s, { id: "number", date: "string", entryId: "number", absentTeacherPersonId: "number", substituteTeacherPersonId: "number", substituteTeacherName: "string", reason: "string" });
			expect(s).toMatchObject({ date: monday, entryId, absentTeacherPersonId: base.teacherPersonId, substituteTeacherPersonId: base.secondTeacherPersonId, reason: "Sick leave" });
		});
		(await org.client.get(SUBSTITUTIONS, { query: { date: monday } })).expectJson((list) => expect(list.map((s: { id: number }) => s.id)).toEqual([cover.body.id]));
		(await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday } })).expectJson((list) => expect(list[0].substitution).toMatchObject({ id: cover.body.id }));

		const third = await createPerson(org.client, "Tia");
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.secondSectionId }, body: { subjectId: base.subjectId, teacherPersonId: third, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
		(await org.client.post(SUBSTITUTIONS, { body: { entryId, date: monday, substituteTeacherPersonId: third } })).expectStatus([200, 201]).expectJson((s) => expect(s).toMatchObject({ id: cover.body.id, substituteTeacherPersonId: third }));
		(await org.client.get(SUBSTITUTIONS, { query: { date: monday } })).expectJson((list) => expect(list).toHaveLength(1));

		(await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).expectJson((entries) => expect(entries[0]).toMatchObject({ id: entryId, teacherPersonId: base.teacherPersonId }));
		(await org.client.delete(`${SUBSTITUTIONS}/{id}`, { params: { id: cover.body.id } })).expectStatus([200, 204]);
		(await org.client.get(SUBSTITUTIONS, { query: { date: monday } })).expectJson((list) => expect(list).toEqual([]));
		(await org.client.delete(`${SUBSTITUTIONS}/{id}`, { params: { id: cover.body.id } })).expectStatus(404);
	});

	test("ACA-36 cover is refused for the wrong weekday, a date outside the year, the slot's own teacher, a busy colleague and an unavailable colleague", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const { base, monday, entryId } = await slot(org.client);
		const tuesday = firstWeekdayOnOrAfter(base.yearStart, "TUESDAY");
		const cover = (date: string, who: number) => org.client.post(SUBSTITUTIONS, { body: { entryId, date, substituteTeacherPersonId: who } });
		(await cover(tuesday, base.secondTeacherPersonId)).expectStatus(409).expectJson((b) => expect(b.error).toContain("is a TUESDAY"));
		const beforeYear = new Date(`${monday}T00:00:00Z`); // a Monday, so only the year check can refuse it
		beforeYear.setUTCDate(beforeYear.getUTCDate() - 7);
		(await cover(beforeYear.toISOString().slice(0, 10), base.secondTeacherPersonId)).expectStatus(409).expectJson((b) => expect(b.error).toContain("outside"));
		(await cover(monday, base.teacherPersonId)).expectStatus(409).expectJson((b) => expect(b.error).toContain("own teacher"));
		// The colleague teaches section B in the same period, so they are busy.
		(await putEntry(org.client, base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await cover(monday, base.secondTeacherPersonId)).expectStatus(409).expectJson((b) => expect(b.error).toContain("is not free"));
		(await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday } })).expectJson((needs) => expect(needs[0].candidates).toEqual([]));
		(await org.client.post(SUBSTITUTIONS, { body: { entryId: 99999999, date: monday, substituteTeacherPersonId: base.secondTeacherPersonId } })).expectStatus(404);
		(await org.client.post(SUBSTITUTIONS, { body: { entryId, date: monday } })).expectStatus(BAD);
		(await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday, to: "2020-01-01" } })).expectStatus(404);
	});

	test("ACA-36 a colleague blocked for that period is not offered and cannot be assigned", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const { base, monday, entryId } = await slot(org.client);
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.secondTeacherPersonId }, body: { dayOfWeek: "MONDAY", periodId: base.p1 } })).expectStatus([200, 201]);
		(await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday } })).expectJson((needs) => expect(needs[0].candidates.map((c: { personId: number }) => c.personId)).not.toContain(base.secondTeacherPersonId));
		(await org.client.post(SUBSTITUTIONS, { body: { entryId, date: monday, substituteTeacherPersonId: base.secondTeacherPersonId } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("unavailable"));
	});
});

test.describe("ACA-36 substitutions and leave", () => {
	test("ACA-36 a colleague on approved leave that day is not offered and cannot be assigned, while a pending request does not block them", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const monday = firstWeekdayOnOrAfter(base.yearStart, "MONDAY");
		const entry = (await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200).body;
		const { campusId } = await organisationContext(org);
		const staff = await createStaff(org.client, campusId, { personId: base.secondTeacherPersonId });
		const type = await createLeaveType(org.client);
		await allocateLeave(org.client, staff.id, type.id, base.yearId, 10);
		const leave = await raiseLeave(org.client, { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: base.yearId }, { startDate: monday, endDate: monday, numberOfDays: 1 });
		const offered = async () => ((await org.client.get(`${SUBSTITUTIONS}/needs`, { query: { teacherPersonId: base.teacherPersonId, from: monday } })).body[0].candidates as { personId: number }[]).map((c) => c.personId);

		expect(await offered(), "a pending request does not take them out").toContain(base.secondTeacherPersonId);
		(await org.client.post(`${HR}/leave-requests/{id}/approve`, { params: { id: leave.id }, body: { decidedBy: null } })).expectStatus(200);
		expect(await offered()).not.toContain(base.secondTeacherPersonId);
		(await org.client.post(SUBSTITUTIONS, { body: { entryId: entry.id, date: monday, substituteTeacherPersonId: base.secondTeacherPersonId } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("on leave"));
	});
});

test.describe("ACA-37 portal views", () => {
	test("ACA-37 a teacher sees only their own published slots for the week, and the cover they give or receive", async ({ request, calls, anon }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const teacher = await portalUser(org.client, anon, await organisationContext(org));
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId }, body: { subjectId: base.subjectId, teacherPersonId: teacher.personId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
		const monday = firstWeekdayOnOrAfter(base.yearStart, "MONDAY");
		(await putEntry(org.client, base.sectionId, base.subjectId, teacher.personId, "MONDAY", base.p2)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.secondSubjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);

		const draft = (await teacher.client.get(ME_TIMETABLE, { query: { date: monday } })).expectStatus(200).body;
		expectShape(draft, { weekStart: "string", weekEnd: "string", published: "boolean", periods: "array", entries: "array", covers: "array" });
		expect(draft.entries, "a draft section is not shown to its teacher").toEqual([]);

		(await org.client.post(PUBLISH, { params: { sectionId: base.sectionId } })).expectStatus(200);
		const week = (await teacher.client.get(ME_TIMETABLE, { query: { date: monday } })).expectStatus(200).body;
		expect(week.weekStart).toBe(monday);
		expect(week.entries).toHaveLength(1);
		expect(week.entries[0]).toMatchObject({ dayOfWeek: "MONDAY", periodId: base.p2, teacherPersonId: teacher.personId });
		expect(week.periods.length).toBeGreaterThanOrEqual(3);

		// Tara is away on Monday and the portal teacher covers her first period.
		(await org.client.post(SUBSTITUTIONS, { body: { entryId: (await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).body.find((e: { periodId: number }) => e.periodId === base.p1).id, date: monday, substituteTeacherPersonId: teacher.personId } })).expectStatus([200, 201]);
		const covering = (await teacher.client.get(ME_TIMETABLE, { query: { date: monday } })).body;
		expect(covering.covers.map((c: { role: string }) => c.role)).toEqual(["COVERING"]);
		const nextWeek = new Date(`${monday}T00:00:00Z`);
		nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
		(await teacher.client.get(ME_TIMETABLE, { query: { date: nextWeek.toISOString().slice(0, 10) } })).expectJson((w) => expect(w.covers).toEqual([]));
	});

	test("ACA-37 a guardian sees a published class timetable for their own child only, and a draft returns the periods without the slots", async ({ api, anon, seed }) => {
		const setup = await attendanceSetup(api);
		const a = setup.base;
		const period = await scratchPeriod(api, [setup.sectionId]);
		try {
			(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: setup.sectionId }, body: { subjectId: a.subjectId, teacherPersonId: a.teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
			(await putEntry(api, setup.sectionId, a.subjectId, a.teacherPersonId, "MONDAY", period.id)).expectStatus(200);
			const guardian = await guardianInPortalRole(api, anon, seed, [setup.studentIds[0]]);
			const date = setup.day(10);
			const CHILD = "/api/v1/me/children/{studentId}/timetable";
			const draft = (await guardian.client.get(CHILD, { params: { studentId: setup.studentIds[0] }, query: { date } })).expectStatus(200).body;
			expect(draft).toMatchObject({ published: false, entries: [] });
			expect(draft.periods.length).toBeGreaterThan(0);
			(await api.post(PUBLISH, { params: { sectionId: setup.sectionId } })).expectStatus(200);
			const live = (await guardian.client.get(CHILD, { params: { studentId: setup.studentIds[0] }, query: { date } })).expectStatus(200).body;
			expect(live.published).toBe(true);
			expect(live.entries.map((e: { periodId: number }) => e.periodId)).toEqual([period.id]);
			// Another pupil of the same class is not this guardian's child.
			(await guardian.client.get(CHILD, { params: { studentId: setup.studentIds[1] }, query: { date } })).expectStatus([403, 404]);
			(await anon.get(CHILD, { params: { studentId: setup.studentIds[0] } })).expectStatus([401, 403]);
			(await anon.get(ME_TIMETABLE)).expectStatus([401, 403]);
		} finally {
			await period.cleanup();
		}
	});
});

test.describe("ACA-38 CSV export", () => {
	test("ACA-38 the section export is a CSV grid with the periods as rows and escapes formula-looking cells", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		const csv = (await org.client.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: base.sectionId } })).expectStatus(200);
		expect(csv.headers["content-type"]).toContain("text/csv");
		expect(csv.headers["content-disposition"]).toContain("attachment");
		expect(csv.headers["content-disposition"]).toContain(".csv");
		const lines = (csv.body as string).trim().split(/\r?\n/);
		expect(lines[0]).toContain("Monday");
		expect(lines.length).toBeGreaterThanOrEqual(4);
		expect(lines.some((l) => l.includes("P1") && l.includes("Tara"))).toBe(true);
		expect(lines.some((l) => /Break|P3/.test(l))).toBe(true);
		(await org.client.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: 99999999 } })).expectStatus(404);
	});

	test("ACA-38 the teacher export lists their slots across sections, and a user without timetable access gets 403", async ({ request, calls, anon }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p2)).expectStatus(200);
		const csv = (await org.client.get("/api/v1/teachers/{personId}/timetable/export", { params: { personId: base.teacherPersonId } })).expectStatus(200);
		expect(csv.headers["content-type"]).toContain("text/csv");
		expect((csv.body as string).match(/Section [AB]|\bA\b|\bB\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
		const portal = await portalUser(org.client, anon, await organisationContext(org));
		(await portal.client.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: base.sectionId } })).expectStatus(403);
	});
});

test.describe("ACA-39 period templates (alternative school days)", () => {
	test("ACA-39 creates, renames and deletes a school day, rejecting blank or duplicate names", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const made = await org.client.post("/api/v1/timetable/templates", { body: { name: "Junior wing" } });
		made.expectStatus([200, 201]).expectJson((t) => {
			expectShape(t, { id: "number", name: "string", periodCount: "number", classCount: "number" });
			expect(t).toMatchObject({ name: "Junior wing", periodCount: 0, classCount: 0 });
		});
		(await org.client.post("/api/v1/timetable/templates", { body: { name: "Junior wing" } })).expectStatus(409);
		(await org.client.post("/api/v1/timetable/templates", { body: { name: " " } })).expectStatus(BAD);
		(await org.client.put("/api/v1/timetable/templates/{id}", { params: { id: made.body.id }, body: { name: "Junior block" } })).expectStatus(200).expectJson((t) => expect(t.name).toBe("Junior block"));
		(await org.client.get("/api/v1/timetable/templates")).expectJson((list) => expect(list.map((t: { name: string }) => t.name)).toEqual(["Junior block"]));
		(await org.client.delete("/api/v1/timetable/templates/{id}", { params: { id: made.body.id } })).expectStatus([200, 204]);
		(await org.client.delete("/api/v1/timetable/templates/{id}", { params: { id: made.body.id } })).expectStatus(404);
	});

	test("ACA-39 a class on its own school day uses only that day's periods, and the default day is unaffected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const template = (await org.client.post("/api/v1/timetable/templates", { body: { name: "Early start" } })).expectStatus([200, 201]).body;
		// Template periods overlap the default day's clock times and still do not clash with them.
		const early = (await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "E1", startTime: "09:00", endTime: "09:30", templateId: template.id } })).expectStatus([200, 201]);
		expect(early.body).toMatchObject({ templateId: template.id, templateName: "Early start" });
		(await org.client.get("/api/v1/timetable/periods")).expectJson((list) => expect(list.every((p: { templateId: number | null }) => p.templateId === null)).toBe(true));
		(await org.client.get("/api/v1/timetable/periods", { query: { templateId: template.id } })).expectJson((list) => expect(list.map((p: { label: string }) => p.label)).toEqual(["E1"]));
		(await org.client.get("/api/v1/sections/{sectionId}/timetable/periods", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toHaveLength(4));

		// The class follows the default day, so the template's period is not part of its school day.
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", early.body.id)).expectStatus(409).expectJson((b) => expect(b.error).toContain("not part of the school day"));
		(await org.client.get("/api/v1/school-classes/{classId}/period-template", { params: { classId: base.classId } })).expectJson((r) => expect(r).toMatchObject({ classId: base.classId, templateId: null, templateName: null }));
		(await org.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: base.classId }, body: { templateId: template.id } })).expectStatus(200).expectJson((r) => expect(r).toMatchObject({ templateId: template.id, templateName: "Early start" }));
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", early.body.id)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p2)).expectStatus(409).expectJson((b) => expect(b.error).toContain("not part of the school day"));
		(await org.client.get("/api/v1/sections/{sectionId}/timetable/periods", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list.map((p: { label: string }) => p.label)).toEqual(["E1"]));
		(await org.client.get("/api/v1/timetable/templates")).expectJson((list) => expect(list[0]).toMatchObject({ periodCount: 1, classCount: 1 }));
	});

	test("ACA-39 a teacher cannot be in two classes at overlapping clock times even when the classes follow different days", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const template = (await org.client.post("/api/v1/timetable/templates", { body: { name: "Offset" } })).expectStatus([200, 201]).body;
		const offset = (await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "O1", startTime: "09:30", endTime: "10:00", templateId: template.id } })).expectStatus([200, 201]);
		// Section B belongs to a second class on the offset day.
		const secondClass = await createSecondClass(org.client, base);
		(await org.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: secondClass.classId }, body: { templateId: template.id } })).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200); // 09:00-09:45
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: secondClass.sectionId }, body: { subjectId: base.subjectId, teacherPersonId: base.teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
		(await putEntry(org.client, secondClass.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", offset.body.id)).expectStatus(409).expectJson((b) => expect(b.error).toMatch(/already|clash|teaching/i));
	});

	test("ACA-39 a school day that is in use or still has periods cannot be deleted, and a class with slots cannot change day", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const template = (await org.client.post("/api/v1/timetable/templates", { body: { name: "Short day" } })).expectStatus([200, 201]).body;
		const period = (await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "S1", startTime: "13:00", endTime: "13:40", templateId: template.id } })).expectStatus([200, 201]).body;
		(await org.client.delete("/api/v1/timetable/templates/{id}", { params: { id: template.id } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("still has periods"));
		(await org.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: base.classId }, body: { templateId: template.id } })).expectStatus(200);
		(await org.client.delete("/api/v1/timetable/periods/{id}", { params: { id: period.id } })).expectStatus([200, 204]);
		(await org.client.delete("/api/v1/timetable/templates/{id}", { params: { id: template.id } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("used by a class"));
		const again = (await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "S1", startTime: "13:00", endTime: "13:40", templateId: template.id } })).expectStatus([200, 201]).body;
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", again.id)).expectStatus(200);
		(await org.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: base.classId }, body: { templateId: null } })).expectStatus(409).expectJson((b) => expect(b.error).toContain("already has timetable entries"));
		(await org.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: 99999999 }, body: { templateId: null } })).expectStatus(404);
	});
});

async function createSecondClass(client: ApiClient, base: TimetableBase): Promise<{ classId: number; sectionId: number }> {
	const { createGrade } = await import("../../../src/api/academics");
	const gradeLevelId = await createGrade(client);
	const created = (await client.post("/api/v1/school-classes", { body: { academicYearId: base.yearId, campusId: base.campusId, gradeLevelId, displayName: "Second class" } })).expectStatus([200, 201]).body;
	const section = (await client.post("/api/v1/school-classes/{classId}/sections", { params: { classId: created.id }, body: { name: "A", capacity: 30 } })).expectStatus([200, 201]).body;
	(await client.post("/api/v1/school-classes/{classId}/subjects", { params: { classId: created.id }, body: { subjectId: base.subjectId, mandatory: true } })).expectStatus([200, 201]);
	return { classId: created.id, sectionId: section.id };
}
