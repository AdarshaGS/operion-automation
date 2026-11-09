// Timetable rules added on top of the basic grid: the gap between periods, special slots, teacher workload
// limits, weekly subject quotas and coverage, rooms, and teacher unavailability. IDs refer to docs/SCENARIOS.md
// section 4 (ACA-27 to ACA-33). Rules are organisation-wide, so everything runs in throwaway organisations.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createPeriod } from "../../../src/api/academics";
import { expectShape } from "../../../src/api/shapes";
import { classSubjectIds, createRoom, putEntry, ROOMS, SETTINGS, setQuota, setRules, SUMMARY, timetableBase } from "../../../src/api/timetable";

const BAD = [400, 422];
const PERIODS = "/api/v1/timetable/periods";
const UNAVAILABILITY = "/api/v1/teachers/{personId}/unavailability";

test.describe("ACA-27 timetable rules (settings)", () => {
	test("ACA-27 a new organisation has no gap and no workload limits, and the rules can be set and cleared", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get(SETTINGS)).expectStatus(200).expectJson((rules) => {
			expectShape(rules, { gapMinutes: "number", maxTeacherPeriodsPerDay: "nullable", maxTeacherPeriodsPerWeek: "nullable" });
			expect(rules).toMatchObject({ gapMinutes: 0, maxTeacherPeriodsPerDay: null, maxTeacherPeriodsPerWeek: null });
		});
		(await setRules(org.client, { gapMinutes: 5, maxTeacherPeriodsPerDay: 4, maxTeacherPeriodsPerWeek: 20 })).expectStatus(200).expectJson((rules) => expect(rules).toMatchObject({ gapMinutes: 5, maxTeacherPeriodsPerDay: 4, maxTeacherPeriodsPerWeek: 20 }));
		(await org.client.get(SETTINGS)).expectJson((rules) => expect(rules).toMatchObject({ gapMinutes: 5, maxTeacherPeriodsPerDay: 4, maxTeacherPeriodsPerWeek: 20 }));
		(await setRules(org.client, { gapMinutes: 0 })).expectStatus(200).expectJson((rules) => expect(rules).toMatchObject({ gapMinutes: 0, maxTeacherPeriodsPerDay: null, maxTeacherPeriodsPerWeek: null }));
	});

	test("ACA-27 a negative gap or a missing gap returns 400", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put(SETTINGS, { body: { gapMinutes: -1 } })).expectStatus(BAD);
		(await org.client.put(SETTINGS, { body: { maxTeacherPeriodsPerDay: 3 } })).expectStatus(BAD);
	});
});

test.describe("ACA-28 minimum gap between periods", () => {
	test("ACA-28 a class period must start at least the gap after the previous class period, and a break next to it is exempt", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await setRules(org.client, { gapMinutes: 10 })).expectStatus(200);
		await createPeriod(org.client, 1, "09:00", "09:45");
		const tooClose = await org.client.post(PERIODS, { body: { ordinal: 2, label: "P2", startTime: "09:50", endTime: "10:35", breakSlot: false } });
		tooClose.expectStatus(409).expectJson((body) => expect(body.error).toContain("at least 10 minutes"));
		(await org.client.post(PERIODS, { body: { ordinal: 2, label: "P2", startTime: "09:55", endTime: "10:40", breakSlot: false } })).expectStatus([200, 201]);
		// A break may sit flush against a class period, and a class period right after that break is measured from the break, not the period.
		(await org.client.post(PERIODS, { body: { ordinal: 3, label: "Break", startTime: "10:40", endTime: "10:55", slotType: "BREAK" } })).expectStatus([200, 201]);
		(await org.client.post(PERIODS, { body: { ordinal: 4, label: "P3", startTime: "10:55", endTime: "11:40", breakSlot: false } })).expectStatus([200, 201]);
	});

	test("ACA-28 raising the gap leaves existing periods alone, and editing one without changing its times is still allowed", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const first = await createPeriod(org.client, 1, "09:00", "09:45");
		await createPeriod(org.client, 2, "09:45", "10:30");
		(await setRules(org.client, { gapMinutes: 30 })).expectStatus(200);
		(await org.client.get(PERIODS)).expectJson((list) => expect(list).toHaveLength(2));
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: first.id }, body: { label: "Renamed", startTime: "09:00", endTime: "09:45", breakSlot: false } })).expectStatus(200).expectJson((p) => expect(p.label).toBe("Renamed"));
		// Moving it so it is closer than the gap to its neighbour is not.
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: first.id }, body: { label: "Renamed", startTime: "09:05", endTime: "09:40", breakSlot: false } })).expectStatus(409);
	});
});

test.describe("ACA-29 special slots", () => {
	test("ACA-29 an assembly slot is stored as SPECIAL, appears in the list with its type, and cannot hold a lesson", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const assembly = await org.client.post(PERIODS, { body: { ordinal: 0, label: "Assembly", startTime: "08:30", endTime: "09:00", slotType: "SPECIAL" } });
		assembly.expectStatus([200, 201]).expectJson((p) => {
			expectShape(p, { id: "number", slotType: "string", breakSlot: "boolean", templateId: "nullable" });
			expect(p).toMatchObject({ slotType: "SPECIAL", breakSlot: true, templateId: null });
		});
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", assembly.body.id)).expectStatus(409).expectJson((b) => expect(b.error).toContain("special"));
		(await org.client.get(PERIODS)).expectJson((list) => expect(list.map((p: { slotType: string }) => p.slotType)).toEqual(["SPECIAL", "TEACHING", "TEACHING", "BREAK", "TEACHING"]));
	});

	test("ACA-29 an unknown slot type returns 400, and a period that holds lessons cannot become special", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await org.client.post(PERIODS, { body: { ordinal: 9, label: "X", startTime: "13:00", endTime: "13:30", slotType: "LUNCHISH" } })).expectStatus(BAD);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await org.client.put("/api/v1/timetable/periods/{id}", { params: { id: base.p1 }, body: { label: "P1", startTime: "09:00", endTime: "09:45", slotType: "SPECIAL" } })).expectStatus(409);
	});
});

test.describe("ACA-30 teacher workload limits", () => {
	test("ACA-30 a teacher cannot be given more periods than the per-day limit, but another day is fine", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await setRules(org.client, { maxTeacherPeriodsPerDay: 1 })).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p2)).expectStatus(409).expectJson((b) => expect(b.error).toContain("would exceed the limit of 1 period"));
		(await putEntry(org.client, base.secondSectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p2)).expectStatus(200);
	});

	test("ACA-30 the per-week limit counts every day, and replacing a slot does not count it twice", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		(await setRules(org.client, { maxTeacherPeriodsPerWeek: 2 })).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.secondSubjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200); // replace, still two
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "WEDNESDAY", base.p1)).expectStatus(409).expectJson((b) => expect(b.error).toContain("would exceed the limit of 2 period"));
	});
});

test.describe("ACA-31 weekly subject quotas and coverage", () => {
	test("ACA-31 a quota can be set, kept when a later update omits it, and cleared with 0", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const ids = await classSubjectIds(org.client, base.classId);
		const id = ids.get(base.subjectId)!;
		(await setQuota(org.client, base.classId, id, 3)).expectStatus(200).expectJson((row) => expect(row.weeklyPeriods).toBe(3));
		(await setQuota(org.client, base.classId, id)).expectStatus(200).expectJson((row) => expect(row.weeklyPeriods).toBe(3));
		(await org.client.get("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId } })).expectJson((rows) => expect(rows.find((r: { id: number }) => r.id === id).weeklyPeriods).toBe(3));
		(await setQuota(org.client, base.classId, id, 0)).expectStatus(200).expectJson((row) => expect(row.weeklyPeriods).toBeNull());
	});

	test("ACA-31 a subject cannot be placed more often than its weekly quota, and the summary shows placed, remaining and the unplaced total", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const ids = await classSubjectIds(org.client, base.classId);
		(await setQuota(org.client, base.classId, ids.get(base.subjectId)!, 2)).expectStatus(200);
		(await setQuota(org.client, base.classId, ids.get(base.secondSubjectId)!, 3)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p1)).expectStatus(200);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "WEDNESDAY", base.p1)).expectStatus(409).expectJson((b) => expect(b.error).toContain("already has its 2 weekly periods"));
		(await putEntry(org.client, base.sectionId, base.secondSubjectId, base.teacherPersonId, "WEDNESDAY", base.p1)).expectStatus(200);
		(await org.client.get(SUMMARY, { params: { sectionId: base.sectionId } })).expectStatus(200).expectJson((summary) => {
			expectShape(summary, { sectionId: "number", placedSlots: "number", unplacedPeriods: "number", subjects: "array", published: "boolean", publishedAt: "nullable" });
			expect(summary).toMatchObject({ placedSlots: 3, unplacedPeriods: 2, published: false, publishedAt: null });
			expect(summary.subjects.find((s: { subjectId: number }) => s.subjectId === base.subjectId)).toMatchObject({ requiredPerWeek: 2, placed: 2, remaining: 0 });
			expect(summary.subjects.find((s: { subjectId: number }) => s.subjectId === base.secondSubjectId)).toMatchObject({ requiredPerWeek: 3, placed: 1, remaining: 2 });
		});
	});

	test("ACA-31 the summary of an unknown section returns 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get(SUMMARY, { params: { sectionId: 99999999 } })).expectStatus(404);
	});
});

test.describe("ACA-32 rooms", () => {
	test("ACA-32 creates, lists, renames and deletes a room, and rejects a duplicate or blank name", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const room = await org.client.post(ROOMS, { body: { name: "Lab 1", roomType: "Lab", capacity: 24 } });
		room.expectStatus([200, 201]).expectJson((r) => {
			expectShape(r, { id: "number", name: "string", roomType: "string", capacity: "number", active: "boolean" });
			expect(r).toMatchObject({ name: "Lab 1", roomType: "Lab", capacity: 24, active: true });
		});
		(await org.client.post(ROOMS, { body: { name: "Lab 1" } })).expectStatus(409);
		(await org.client.post(ROOMS, { body: { name: "  " } })).expectStatus(BAD);
		(await org.client.put("/api/v1/timetable/rooms/{id}", { params: { id: room.body.id }, body: { name: "Lab One", roomType: "Lab", capacity: 20 } })).expectStatus(200).expectJson((r) => expect(r).toMatchObject({ name: "Lab One", capacity: 20, active: true }));
		(await org.client.get(ROOMS)).expectJson((list) => expect(list.map((r: { name: string }) => r.name)).toEqual(["Lab One"]));
		(await org.client.delete("/api/v1/timetable/rooms/{id}", { params: { id: room.body.id } })).expectStatus([200, 204]);
		(await org.client.delete("/api/v1/timetable/rooms/{id}", { params: { id: room.body.id } })).expectStatus(404);
	});

	test("ACA-32 a slot carries its room, and a room cannot host two sections at the same time", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const room = await createRoom(org.client, "Hall");
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1, room.id)).expectStatus(200).expectJson((e) => expect(e).toMatchObject({ roomId: room.id, roomName: "Hall" }));
		(await putEntry(org.client, base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId, "MONDAY", base.p1, room.id)).expectStatus(409).expectJson((b) => expect(b.error).toContain("already booked"));
		(await putEntry(org.client, base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId, "MONDAY", base.p2, room.id)).expectStatus(200);
		(await putEntry(org.client, base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId, "TUESDAY", base.p1, 99999999)).expectStatus(404);
		(await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list[0]).toMatchObject({ roomName: "Hall" }));
	});

	test("ACA-32 a room in use can be made inactive but not deleted, and an inactive room takes no new slots", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const room = await createRoom(org.client, "Room 7");
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1, room.id)).expectStatus(200);
		(await org.client.delete("/api/v1/timetable/rooms/{id}", { params: { id: room.id } })).expectStatus(409);
		(await org.client.put("/api/v1/timetable/rooms/{id}", { params: { id: room.id }, body: { name: "Room 7", active: false } })).expectStatus(200).expectJson((r) => expect(r.active).toBe(false));
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p1, room.id)).expectStatus(409).expectJson((b) => expect(b.error).toContain("inactive"));
	});
});

test.describe("ACA-33 teacher unavailability", () => {
	test("ACA-33 a blocked period refuses that teacher, a blocked day refuses every period, and removing the block frees them", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const block = await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "MONDAY", periodId: base.p1, reason: "Union meeting" } });
		block.expectStatus([200, 201]).expectJson((b) => {
			expectShape(b, { id: "number", teacherPersonId: "number", dayOfWeek: "string", periodId: "number", reason: "string" });
			expect(b).toMatchObject({ dayOfWeek: "MONDAY", periodId: base.p1, reason: "Union meeting" });
		});
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(409).expectJson((b) => expect(b.error).toContain("unavailable"));
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p2)).expectStatus(200);
		const wholeDay = await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "TUESDAY" } });
		wholeDay.expectStatus([200, 201]).expectJson((b) => expect(b.periodId).toBeNull());
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p3)).expectStatus(409);
		(await org.client.get(UNAVAILABILITY, { params: { personId: base.teacherPersonId } })).expectJson((list) => expect(list).toHaveLength(2));
		(await org.client.delete("/api/v1/timetable/unavailability/{id}", { params: { id: block.body.id } })).expectStatus([200, 204]);
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
	});

	test("ACA-33 a duplicate block, a break period, an unknown day and an unknown id are rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const body = { dayOfWeek: "MONDAY", periodId: base.p1 };
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body })).expectStatus([200, 201]);
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body })).expectStatus(409);
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "MONDAY", periodId: base.brk } })).expectStatus(409);
		(await org.client.post(UNAVAILABILITY, { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "FUNDAY" } })).expectStatus(BAD);
		(await org.client.delete("/api/v1/timetable/unavailability/{id}", { params: { id: 99999999 } })).expectStatus(404);
	});
});
