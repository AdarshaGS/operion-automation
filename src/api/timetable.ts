// Timetable fixtures on top of the academic base: a school day of three teaching periods with a break between
// the second and the third, and small wrappers for the calls nearly every timetable scenario makes.

import type { ApiClient } from "./apiClient";
import { buildAcademicBase, createPeriod, type AcademicBase } from "./academics";

export const SETTINGS = "/api/v1/timetable/settings";
export const ENTRY = "/api/v1/sections/{sectionId}/timetable";
export const SUMMARY = "/api/v1/sections/{sectionId}/timetable/summary";
export const ROOMS = "/api/v1/timetable/rooms";
export const TEMPLATES = "/api/v1/timetable/templates";

export interface TimetableBase extends AcademicBase {
	/** Teaching periods 09:00-09:45, 09:45-10:30 and 10:45-11:30, with a break 10:30-10:45 between the last two. */
	p1: number;
	p2: number;
	brk: number;
	p3: number;
	yearStart: string;
	yearEnd: string;
}

export async function timetableBase(client: ApiClient): Promise<TimetableBase> {
	const base = await buildAcademicBase(client);
	// buildAcademicBase leaves the second teacher on section A (a newer assignment replaces the older one for the same section and subject).
	// Timetable scenarios want: Tara on both subjects of A and on B's first subject, Tej on B's second subject, so teacher and room clashes can be told apart.
	for (const [sectionId, subjectId, teacherPersonId] of [[base.sectionId, base.subjectId, base.teacherPersonId], [base.sectionId, base.secondSubjectId, base.teacherPersonId], [base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId]] as const) {
		(await client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId }, body: { subjectId, teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
	}
	const p1 = await createPeriod(client, 1, "09:00", "09:45");
	const p2 = await createPeriod(client, 2, "09:45", "10:30");
	const brk = await createPeriod(client, 3, "10:30", "10:45", { slotType: "BREAK" });
	const p3 = await createPeriod(client, 4, "10:45", "11:30");
	const years = (await client.get("/api/v1/academic-years")).expectStatus(200).body as { id: number; startDate: string; endDate: string }[];
	const year = years.find((y) => y.id === base.yearId)!;
	return { ...base, p1: p1.id, p2: p2.id, brk: brk.id, p3: p3.id, yearStart: year.startDate, yearEnd: year.endDate };
}

export function putEntry(client: ApiClient, sectionId: number, subjectId: number, teacherPersonId: number, dayOfWeek: string, periodId: number, roomId?: number) {
	return client.put(ENTRY, { params: { sectionId }, body: { subjectId, teacherPersonId, dayOfWeek, periodId, ...(roomId === undefined ? {} : { roomId }) } });
}

export async function createRoom(client: ApiClient, name: string, extra: Record<string, unknown> = {}): Promise<{ id: number; name: string }> {
	const room = await client.post(ROOMS, { body: { name, roomType: "Classroom", capacity: 30, ...extra } });
	room.expectStatus([200, 201]);
	return room.body;
}

/** Sets the org-wide timetable rules; anything left out is cleared. */
export function setRules(client: ApiClient, rules: { gapMinutes?: number; maxTeacherPeriodsPerDay?: number | null; maxTeacherPeriodsPerWeek?: number | null }) {
	return client.put(SETTINGS, { body: { gapMinutes: 0, maxTeacherPeriodsPerDay: null, maxTeacherPeriodsPerWeek: null, ...rules } });
}

/** The first date on or after `from` that falls on `weekday` (MONDAY..SUNDAY). */
export function firstWeekdayOnOrAfter(from: string, weekday: string): string {
	const names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
	const date = new Date(`${from}T00:00:00Z`);
	while (names[date.getUTCDay()] !== weekday) date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

export async function classSubjectIds(client: ApiClient, classId: number): Promise<Map<number, number>> {
	const rows = (await client.get("/api/v1/school-classes/{classId}/subjects", { params: { classId } })).expectStatus(200).body as { id: number; subjectId: number }[];
	return new Map(rows.map((row) => [row.subjectId, row.id]));
}

export function setQuota(client: ApiClient, classId: number, classSubjectId: number, weeklyPeriods?: number) {
	return client.patch("/api/v1/school-classes/{classId}/subjects/{id}", { params: { classId, id: classSubjectId }, body: { mandatory: true, ...(weeklyPeriods === undefined ? {} : { weeklyPeriods }) } });
}

/**
 * A period in a random 10-minute slot and random ordinal, for specs that must run in the shared organisation (periods may
 * not overlap there, and other specs run in parallel). Retries when the slot is taken; `cleanup` removes the section's
 * entries and the period again.
 */
export async function scratchPeriod(client: ApiClient, sectionIds: number[]): Promise<{ id: number; label: string; cleanup: () => Promise<void> }> {
	const label = `SP${Math.floor(Math.random() * 1e6)}`;
	const ordinal = 1000 + Math.floor(Math.random() * 100000);
	let created = await client.post("/api/v1/timetable/periods", { body: { ordinal, label, ...randomSlot(), breakSlot: false } });
	for (let attempt = 0; attempt < 30 && created.status === 409; attempt++) {
		created = await client.post("/api/v1/timetable/periods", { body: { ordinal, label, ...randomSlot(), breakSlot: false } });
	}
	created.expectStatus([200, 201]);
	const id: number = created.body.id;
	return {
		id,
		label,
		cleanup: async () => {
			for (const sectionId of sectionIds) {
				const entries = await client.get(ENTRY, { params: { sectionId } });
				for (const entry of entries.body ?? []) await client.delete("/api/v1/timetable-entries/{id}", { params: { id: entry.id } });
			}
			await client.delete("/api/v1/timetable/periods/{id}", { params: { id } });
		},
	};
}

function randomSlot(): { startTime: string; endTime: string } {
	const start = Math.floor(Math.random() * 140) * 10;
	const at = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
	return { startTime: at(start), endTime: at(start + 10) };
}
