// Student attendance: register, mark, submit, lock, unlock, corrections, range and monthly summary,
// permissions and tenant isolation. IDs refer to docs/SCENARIOS.md section 7 (ATT-*).

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { attendanceSetup, markRegister, marks, REGISTER } from "../../../src/api/attendance";
import { expectShape } from "../../../src/api/shapes";

const BAD = [400, 422];
const ENTRY_SHAPE = { id: "number", studentEnrollmentId: "number", attendanceDate: "string", attendanceStatus: "string", excused: "boolean", markedBy: "number", markedAt: "string" } as const;
const ACTION = "/api/v1/attendance/register/{registerId}";

test.describe("register and marking", () => {
	test("ATT-01 a section with no marks yet answers 404 with a clear message", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		(await api.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectStatus(404).expectJson((body) => expect(body.error).toMatch(/no attendance register/i));
	});

	test("ATT-01 the register of a marked day lists one entry per marked student with the register status", async ({ api }) => {
		const s = await attendanceSetup(api, 3);
		await markRegister(api, s, s.day(10));
		(await api.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectStatus(200).expectJson((body) => {
			expect(body.register).toMatchObject({ sectionId: s.sectionId, academicYearId: s.yearId, attendanceDate: s.day(10), registerStatus: "DRAFT" });
			expect(body.entries).toHaveLength(3);
			for (const entry of body.entries) expectShape(entry, ENTRY_SHAPE);
			expect(body.entries.map((e: { studentEnrollmentId: number }) => e.studentEnrollmentId).sort()).toEqual([...s.enrollmentIds].sort());
		});
	});

	test("ATT-01 an unknown section returns 404", async ({ api }) => {
		(await api.get(REGISTER, { params: { sectionId: 99999999 }, query: { date: "2026-06-10" } })).expectStatus(404);
	});

	test("ATT-02 marks present, absent, late, half day and leave and returns every entry", async ({ api }) => {
		const s = await attendanceSetup(api, 5);
		const res = await markRegister(api, s, s.day(10), ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"]);
		expect(res.body.register.registerStatus).toBe("DRAFT");
		expect(res.body.entries.map((e: { attendanceStatus: string }) => e.attendanceStatus)).toEqual(["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"]);
		expect(res.body.entries.every((e: { markedBy: number | null; correctedBy: number | null }) => e.markedBy !== null && e.correctedBy === null)).toBe(true);
	});

	test("ATT-02 excused flag and remarks are kept", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const res = await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: s.enrollmentIds[0], status: "ABSENT", excused: true, remarks: "Fever" }] } });
		res.expectStatus(200).expectJson((body) => expect(body.entries[0]).toMatchObject({ attendanceStatus: "ABSENT", excused: true, remarks: "Fever" }));
	});

	test("ATT-02 marking a day that already has marks is rejected: changes go through corrections", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const first = await markRegister(api, s, s.day(10), ["PRESENT", "PRESENT"]);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["ABSENT", "PRESENT"]) } })).expectStatus(409).expectJson((body) => expect(body.error).toMatch(/already has attendance marked/i));
		(await api.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectJson((body) => {
			expect(body.register.id).toBe(first.body.register.id);
			expect(body.entries.map((e: { attendanceStatus: string }) => e.attendanceStatus)).toEqual(["PRESENT", "PRESENT"]);
		});
	});

	test("ATT-02 a later mark for students not yet marked that day is added to the same register", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const first = await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT"]) } });
		first.expectStatus(200);
		const second = await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: s.enrollmentIds[1], status: "ABSENT", excused: false }] } });
		second.expectStatus(200).expectJson((body) => {
			expect(body.register.id).toBe(first.body.register.id);
			expect(body.entries).toHaveLength(2);
		});
	});

	test("ATT-02 the excused flag is required: leaving it out is a 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: s.enrollmentIds[0], status: "PRESENT" }] } })).expectStatus(400);
	});

	test("ATT-02 an unknown status returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: s.enrollmentIds[0], status: "NOPE", excused: false }] } })).expectStatus(BAD);
	});

	test("ATT-02 an unknown enrolment returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: 99999999, status: "PRESENT", excused: false }] } })).expectStatus(404);
	});

	test("ATT-02 an enrolment of another section is rejected", async ({ api }) => {
		const a = await attendanceSetup(api, 1);
		const b = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: a.sectionId }, body: { attendanceDate: a.day(10), marks: [{ studentEnrollmentId: b.enrollmentIds[0], status: "PRESENT", excused: false }] } })).expectStatus([400, 404, 409, 422]);
	});

	test("ATT-02 the same student twice in one request is rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const entry = { studentEnrollmentId: s.enrollmentIds[0], status: "PRESENT", excused: false };
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [entry, entry] } })).expectStatus([400, 409, 422]);
	});

	test("ATT-02 a missing date returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { marks: marks(s, ["PRESENT"]) } })).expectStatus(BAD);
	});

	test("ATT-02 an unknown section returns 404", async ({ api }) => {
		(await api.post(REGISTER, { params: { sectionId: 99999999 }, body: { attendanceDate: "2026-06-10", marks: [] } })).expectStatus(404);
	});

	test("ATT-03 a register request without a date returns 400", async ({ api, seed }) => {
		(await api.get(REGISTER, { params: { sectionId: seed.sectionId } })).expectStatus(400);
	});

	test("ATT-03 a malformed date returns 400", async ({ api, seed }) => {
		(await api.get(REGISTER, { params: { sectionId: seed.sectionId }, query: { date: "yesterday" } })).expectStatus(400);
	});

	test("ATT-04 a date outside the section's academic year is rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: "2000-01-01", marks: marks(s, ["PRESENT"]) } })).expectStatus(BAD.concat(409));
	});

	test("ATT-04 a holiday in the working calendar cannot be marked", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.post("/api/v1/academic/working-calendar", { body: { academicYearId: s.yearId, date: s.day(12), label: "Holiday", type: "HOLIDAY" } })).expectStatus([200, 201]);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(12), marks: marks(s, ["PRESENT"]) } })).expectStatus([400, 409, 422]);
	});

	test("ATT-15 a student cannot be marked on a day before they were enrolled", async ({ api }) => {
		const s = await attendanceSetup(api, 1, 15);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT"]) } })).expectStatus([400, 409, 422]);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(16), marks: marks(s, ["PRESENT"]) } })).expectStatus(200);
	});

	test("ATT-17 an enrolment closed by an exit cannot be marked", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		await markRegister(api, s, s.day(10), ["PRESENT", "PRESENT"]);
		(await api.post("/api/v1/students/{studentId}/exits", { params: { studentId: s.studentIds[1] }, body: { exitType: "WITHDRAWAL", exitDate: s.day(11) } })).expectStatus(200);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(12), marks: marks(s, ["PRESENT", "PRESENT"]) } })).expectStatus([400, 409, 422]);
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(12), marks: marks(s, ["PRESENT"]) } })).expectStatus(200);
	});
});

test.describe("submit, lock, unlock", () => {
	test("ATT-05 submitting a draft register makes it SUBMITTED and read-only for marking", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT", "ABSENT"])).body.register;
		(await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } })).expectStatus(200).expectJson((body) => {
			expect(body.register.registerStatus).toBe("SUBMITTED");
			expect(body.entries).toHaveLength(2);
		});
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT", "PRESENT"]) } })).expectStatus(409);
		(await api.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectJson((body) => expect(body.entries.map((e: { attendanceStatus: string }) => e.attendanceStatus)).toEqual(["PRESENT", "ABSENT"]));
	});

	test("ATT-05 a register cannot be submitted twice, and an unknown register returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body.register;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		(await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } })).expectStatus(409);
		(await api.post(`${ACTION}/submit`, { params: { registerId: 99999999 } })).expectStatus(404);
	});

	test("ATT-06 only a submitted register can be locked; a draft cannot", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body.register;
		(await api.post(`${ACTION}/lock`, { params: { registerId: reg.id } })).expectStatus(409);
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		(await api.post(`${ACTION}/lock`, { params: { registerId: reg.id } })).expectStatus(200).expectJson((body) => expect(body.register.registerStatus).toBe("LOCKED"));
		(await api.post(`${ACTION}/lock`, { params: { registerId: reg.id } })).expectStatus(409);
	});

	test("ATT-06 a locked register cannot be marked or corrected", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } });
		await api.post(`${ACTION}/lock`, { params: { registerId: reg.register.id } });
		(await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["ABSENT"]) } })).expectStatus(409);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "late fix" } })).expectStatus(409);
	});

	test("ATT-06 an unknown register returns 404", async ({ api }) => {
		(await api.post(`${ACTION}/lock`, { params: { registerId: 99999999 } })).expectStatus(404);
	});

	test("ATT-07 unlocking a locked register returns it to SUBMITTED so it can be corrected again", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } });
		await api.post(`${ACTION}/lock`, { params: { registerId: reg.register.id } });
		(await api.post(`${ACTION}/unlock`, { params: { registerId: reg.register.id } })).expectStatus(200).expectJson((body) => expect(body.register.registerStatus).toBe("SUBMITTED"));
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "fixed after unlock" } })).expectStatus(200);
	});

	test("ATT-07 only a locked register can be unlocked", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body.register;
		(await api.post(`${ACTION}/unlock`, { params: { registerId: reg.id } })).expectStatus(409);
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		(await api.post(`${ACTION}/unlock`, { params: { registerId: reg.id } })).expectStatus(409);
		(await api.post(`${ACTION}/unlock`, { params: { registerId: 99999999 } })).expectStatus(404);
	});
});

test.describe("corrections", () => {
	async function submittedDay(api: Parameters<typeof attendanceSetup>[0]) {
		const s = await attendanceSetup(api, 2);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT", "PRESENT"])).body;
		return { s, reg, entryId: reg.entries[0].id as number };
	}

	test("ATT-08 a correction changes the status and records who and when", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "LATE", reason: "Arrived after the bell" } })).expectStatus(200).expectJson((entry) => {
			expect(entry).toMatchObject({ id: entryId, attendanceStatus: "LATE" });
			expect(entry.correctedBy).toEqual(expect.any(Number));
			expect(entry.correctedAt).toEqual(expect.any(String));
		});
	});

	test("ATT-08 a submitted register can still be corrected before it is locked", async ({ api }) => {
		const { reg, entryId } = await submittedDay(api);
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } });
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "ABSENT", reason: "Parent called" } })).expectStatus(200);
	});

	test("ATT-08 a correction without a reason returns 400", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "ABSENT" } })).expectStatus(BAD);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "ABSENT", reason: "  " } })).expectStatus(BAD);
	});

	test("ATT-08 an unknown status returns 400", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "NOPE", reason: "x" } })).expectStatus(BAD);
	});

	test("ATT-08 an unknown attendance id returns 404", async ({ api }) => {
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: 99999999 }, body: { newStatus: "ABSENT", reason: "x" } })).expectStatus(404);
	});

	test("ATT-08 correcting to the status it already has is rejected and leaves no trail", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		(await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "PRESENT", reason: "no change" } })).expectStatus([400, 409, 422]);
		(await api.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: entryId } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("ATT-09 the corrections list shows each change in order with previous, new, reason, who and when", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "LATE", reason: "First fix" } });
		await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: entryId }, body: { newStatus: "ABSENT", reason: "Second fix" } });
		(await api.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: entryId } })).expectStatus(200).expectJson((list) => {
			expect(list).toHaveLength(2);
			for (const row of list) expectShape(row, { id: "number", previousStatus: "string", newStatus: "string", reason: "string", correctedBy: "number", correctedAt: "string" });
			expect(list.map((r: { previousStatus: string; newStatus: string; reason: string }) => [r.previousStatus, r.newStatus, r.reason])).toEqual([["PRESENT", "LATE", "First fix"], ["LATE", "ABSENT", "Second fix"]]);
		});
	});

	test("ATT-09 an entry never corrected has an empty list, and an unknown entry returns 404", async ({ api }) => {
		const { entryId } = await submittedDay(api);
		(await api.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: entryId } })).expectJson((list) => expect(list).toEqual([]));
		(await api.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: 99999999 } })).expectStatus(404);
	});
});

test.describe("range and monthly summary", () => {
	test("ATT-10 the range returns the student's entries between from and to, inclusive", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		for (const d of [10, 11, 12, 14]) await markRegister(api, s, s.day(d), ["PRESENT"]);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(11), to: s.day(12) } })).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { attendanceDate: string }) => r.attendanceDate)).toEqual([s.day(11), s.day(12)]);
		});
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(1), to: s.day(28) } })).expectJson((rows) => expect(rows).toHaveLength(4));
	});

	test("ATT-10 a range with nothing in it is an empty list", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(1), to: s.day(5) } })).expectStatus(200).expectJson((rows) => expect(rows).toEqual([]));
	});

	test("ATT-10 missing from or to returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(1) } })).expectStatus(400);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { to: s.day(1) } })).expectStatus(400);
	});

	test("ATT-10 a range with from after to returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(12), to: s.day(10) } })).expectStatus(BAD);
	});

	test("ATT-10 an unknown enrolment returns 404", async ({ api }) => {
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: 99999999 }, query: { from: "2026-06-01", to: "2026-06-30" } })).expectStatus(404);
	});

	async function summaryFor(api: Parameters<typeof attendanceSetup>[0], statuses: string[]) {
		const s = await attendanceSetup(api, 1);
		for (let i = 0; i < statuses.length; i++) await markRegister(api, s, s.day(10 + i), [statuses[i]]);
		return (await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectStatus(200).body;
	}

	test("ATT-11 present and late count as attended, half day as half, absent as zero, leave is left out of the denominator", async ({ api }) => {
		const summary = await summaryFor(api, ["PRESENT", "PRESENT", "LATE", "HALF_DAY", "ABSENT", "LEAVE"]);
		expect(summary).toMatchObject({ totalMarkedDays: 6, presentCount: 2, lateCount: 1, halfDayCount: 1, absentCount: 1, leaveCount: 1 });
		expect(summary.percentage).toBeCloseTo(70, 1);
	});

	test("ATT-11 every day present is 100 and every day absent is 0", async ({ api }) => {
		expect((await summaryFor(api, ["PRESENT", "PRESENT"])).percentage).toBe(100);
		expect((await summaryFor(api, ["ABSENT", "ABSENT"])).percentage).toBe(0);
	});

	test("ATT-11 excused and unexcused absences count the same", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await api.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: [{ studentEnrollmentId: s.enrollmentIds[0], status: "ABSENT", excused: true }] } });
		await markRegister(api, s, s.day(11), ["PRESENT"]);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectJson((summary) => expect(summary.percentage).toBeCloseTo(50, 1));
	});

	test("ATT-11 a correction changes the summary", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["ABSENT"])).body;
		await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "PRESENT", reason: "Wrongly marked" } });
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectJson((summary) => expect(summary).toMatchObject({ presentCount: 1, absentCount: 0, percentage: 100 }));
	});

	test("ATT-12 a month with no marks is all zeros, and marks of another month are not counted", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await markRegister(api, s, s.day(10), ["PRESENT"]);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month === 12 ? 1 : s.month + 1 } })).expectStatus(200).expectJson((summary) => {
			expect(summary).toEqual({ totalMarkedDays: 0, presentCount: 0, absentCount: 0, lateCount: 0, halfDayCount: 0, leaveCount: 0, percentage: 0 });
		});
	});

	test("ATT-12 a month outside 1 to 12 returns 400", async ({ api, seed }) => {
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: seed.studentEnrollmentId }, query: { year: 2026, month: 13 } })).expectStatus(400);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: seed.studentEnrollmentId }, query: { year: 2026, month: 0 } })).expectStatus(400);
	});

	test("ATT-12 a missing year or month returns 400", async ({ api, seed }) => {
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: seed.studentEnrollmentId }, query: { year: 2026 } })).expectStatus(400);
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: seed.studentEnrollmentId }, query: { month: 6 } })).expectStatus(400);
	});

	test("ATT-12 an unknown enrolment returns 404", async ({ api }) => {
		(await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: 99999999 }, query: { year: 2026, month: 6 } })).expectStatus(404);
	});
});

test.describe("permissions", () => {
	async function userWith(api: Parameters<typeof attendanceSetup>[0], anon: Parameters<typeof createDisposableUser>[1], seed: Parameters<typeof createDisposableUser>[2], codes: string[]) {
		return (await createDisposableUser(api, anon, seed, codes)).client;
	}

	test("ATT-16 view-only staff can read a register and summary but not mark, submit, lock, unlock or correct", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		const viewer = await userWith(api, anon, seed, ["ATTENDANCE_VIEW"]);
		(await viewer.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectStatus(200);
		(await viewer.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectStatus(200);
		(await viewer.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(11), marks: marks(s, ["PRESENT"]) } })).expectStatus(403);
		(await viewer.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } })).expectStatus(403);
		(await viewer.post(`${ACTION}/lock`, { params: { registerId: reg.register.id } })).expectStatus(403);
		(await viewer.post(`${ACTION}/unlock`, { params: { registerId: reg.register.id } })).expectStatus(403);
		(await viewer.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "x" } })).expectStatus(403);
	});

	test("ATT-16 marking permission allows mark and submit but not lock or correct", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const marker = await userWith(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_MARK"]);
		const reg = (await marker.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT"]) } })).expectStatus(200).body;
		(await marker.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } })).expectStatus(200);
		(await marker.post(`${ACTION}/lock`, { params: { registerId: reg.register.id } })).expectStatus(403);
		(await marker.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "x" } })).expectStatus(403);
	});

	test("ATT-07 lock and unlock are separate permissions", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body.register;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		const locker = await userWith(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_LOCK"]);
		const unlocker = await userWith(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_UNLOCK"]);
		(await unlocker.post(`${ACTION}/lock`, { params: { registerId: reg.id } })).expectStatus(403);
		(await locker.post(`${ACTION}/lock`, { params: { registerId: reg.id } })).expectStatus(200);
		(await locker.post(`${ACTION}/unlock`, { params: { registerId: reg.id } })).expectStatus(403);
		(await unlocker.post(`${ACTION}/unlock`, { params: { registerId: reg.id } })).expectStatus(200);
	});

	test("ATT-08 correction permission allows correcting but not marking", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		const corrector = await userWith(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_CORRECT"]);
		(await corrector.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "LATE", reason: "Arrived late" } })).expectStatus(200);
		(await corrector.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(11), marks: marks(s, ["PRESENT"]) } })).expectStatus(403);
	});

	test("ATT-16 a user with no attendance permission cannot read or write anything", async ({ as, seed }) => {
		const nobody = as("noPermissions");
		(await nobody.get(REGISTER, { params: { sectionId: seed.sectionId }, query: { date: "2026-06-10" } })).expectStatus(403);
		(await nobody.post(REGISTER, { params: { sectionId: seed.sectionId }, body: { attendanceDate: "2026-06-10", marks: [] } })).expectStatus(403);
		(await nobody.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: seed.studentEnrollmentId }, query: { from: "2026-06-01", to: "2026-06-30" } })).expectStatus(403);
		(await nobody.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: seed.studentEnrollmentId }, query: { year: 2026, month: 6 } })).expectStatus(403);
	});

	test("ATT-16 every attendance endpoint needs a sign-in", async ({ anon, seed }) => {
		(await anon.get(REGISTER, { params: { sectionId: seed.sectionId }, query: { date: "2026-06-10" } })).expectStatus(401);
		(await anon.post(`${ACTION}/lock`, { params: { registerId: 1 } })).expectStatus(401);
		(await anon.get("/api/v1/attendance/staff", { query: { campusId: seed.campusId, date: "2026-06-10" } })).expectStatus(401);
	});
});

test.describe("tenant isolation", () => {
	test("ATT-18 another organisation cannot read, mark, submit, lock, unlock, correct or summarise these registers", async ({ request, calls, api }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		const outsider = await createOtherOrganisation(request, calls);
		const c = outsider.client;
		(await c.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectStatus(404);
		(await c.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(11), marks: marks(s, ["PRESENT"]) } })).expectStatus(404);
		(await c.post(`${ACTION}/submit`, { params: { registerId: reg.register.id } })).expectStatus(404);
		(await c.post(`${ACTION}/lock`, { params: { registerId: reg.register.id } })).expectStatus(404);
		(await c.post(`${ACTION}/unlock`, { params: { registerId: reg.register.id } })).expectStatus(404);
		(await c.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "x" } })).expectStatus(404);
		(await c.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: reg.entries[0].id } })).expectStatus([200, 404]).expectJson((list) => { if (Array.isArray(list)) expect(list).toEqual([]); });
		(await c.get("/api/v1/attendance/enrollments/{enrollmentId}", { params: { enrollmentId: s.enrollmentIds[0] }, query: { from: s.day(1), to: s.day(28) } })).expectStatus([200, 404]).expectJson((rows) => { if (Array.isArray(rows)) expect(rows).toEqual([]); });
		(await c.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectStatus([200, 404]).expectJson((summary) => { if (summary.totalMarkedDays !== undefined) expect(summary.totalMarkedDays).toBe(0); });
		(await api.get(REGISTER, { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectJson((body) => expect(body.register.registerStatus).toBe("DRAFT"));
	});
});
