// Holiday-aware HR leave: the calendar-days endpoint and leave counting working days only. IDs refer to
// docs/SCENARIOS.md section 15 (HR-19..HR-21). Holidays and the weekly off are organisation-wide settings,
// so every test builds its own throwaway organisation (default weekly off: Sunday) and never touches the shared one.

import { test, expect } from "../../../src/api/fixtures";
import { HR, raiseLeave } from "../../../src/api/hr";
import { CALENDAR_DAYS, WEEK, addCalendarEntry, calendarDays, holidayLeaveOrg } from "../../../src/api/calendar";

const BAD = 400;

test.describe("HR-19 calendar days", () => {
	test("HR-19 a Monday-to-Sunday range lists Sunday as the weekly off and counts six working days", async ({ request, calls }) => {
		const { org } = await holidayLeaveOrg(request, calls);
		const days = await calendarDays(org.client, WEEK.mon, WEEK.sun);
		expect(days).toMatchObject({ from: WEEK.mon, to: WEEK.sun, workingDayCount: 6 });
		expect(days.nonWorkingDays).toEqual([{ date: WEEK.sun, kind: "WEEKLY_OFF", label: "Weekly off" }]);
	});

	test("HR-19 a declared holiday is listed with its label and is not a working day", async ({ request, calls }) => {
		const { org, yearId } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.wed, "Founders Day");
		const days = await calendarDays(org.client, WEEK.mon, WEEK.sun);
		expect(days.workingDayCount).toBe(5);
		expect(days.nonWorkingDays).toEqual([
			{ date: WEEK.wed, kind: "HOLIDAY", label: "Founders Day" },
			{ date: WEEK.sun, kind: "WEEKLY_OFF", label: "Weekly off" },
		]);
	});

	test("HR-19 a campus-only holiday shows for that campus but not in the organisation-wide view", async ({ request, calls }) => {
		const { org, yearId, campusId } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.thu, "Campus sports day", "HOLIDAY", campusId);
		const forCampus = await calendarDays(org.client, WEEK.mon, WEEK.sun, campusId);
		expect(forCampus.nonWorkingDays.map((d) => d.date)).toContain(WEEK.thu);
		expect(forCampus.workingDayCount).toBe(5);
		const orgWide = await calendarDays(org.client, WEEK.mon, WEEK.sun);
		expect(orgWide.nonWorkingDays.map((d) => d.date)).not.toContain(WEEK.thu);
		expect(orgWide.workingDayCount).toBe(6);
	});

	test("HR-19 a special working day turns the weekly-off Sunday back into a working day", async ({ request, calls }) => {
		const { org, yearId } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.sun, "Make-up class day", "SPECIAL_WORKING_DAY");
		const days = await calendarDays(org.client, WEEK.mon, WEEK.sun);
		expect(days.workingDayCount).toBe(7);
		expect(days.nonWorkingDays).toEqual([]);
	});

	test("HR-19 an end date before the start date returns 400", async ({ api }) => {
		expect((await api.get(CALENDAR_DAYS, { query: { from: WEEK.wed, to: WEEK.mon } })).status).toBe(BAD);
	});

	test("HR-19 a range longer than 400 days returns 400", async ({ api }) => {
		expect((await api.get(CALENDAR_DAYS, { query: { from: "2026-01-01", to: "2027-03-01" } })).status).toBe(BAD);
	});

	test("HR-19 reading needs a signed-in user but no particular permission", async ({ anon, as }) => {
		const query = { from: WEEK.mon, to: WEEK.sun };
		(await anon.get(CALENDAR_DAYS, { query })).expectStatus(401);
		(await as("readOnlyStaff").get(CALENDAR_DAYS, { query })).expectStatus(200);
		(await as("noPermissions").get(CALENDAR_DAYS, { query })).expectStatus(200);
	});
});

test.describe("HR-20 leave counts working days", () => {
	// Mon 7 - Wed 9 Sep with Wednesday a holiday: three calendar days, two working days.
	test("HR-20 a Monday-to-Wednesday request with Wednesday a holiday is refused at 3 days and accepted at 2", async ({ request, calls }) => {
		const { org, yearId, ids } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.wed, "Founders Day");
		const tooMany = await org.client.post(`${HR}/leave-requests`, { body: { ...ids, startDate: WEEK.mon, endDate: WEEK.wed, numberOfDays: 3, reason: "Trip" } });
		expect(tooMany.status, "3 days over 2 working days").toBe(BAD);
		expect(JSON.stringify(tooMany.body)).toContain("working day");
		const ok = await raiseLeave(org.client, ids, { startDate: WEEK.mon, endDate: WEEK.wed, numberOfDays: 2 });
		expect(ok).toMatchObject({ status: "PENDING", numberOfDays: 2, startDate: WEEK.mon, endDate: WEEK.wed });
	});

	test("HR-20 a Friday-to-Monday request spans the Sunday weekly off: 4 days refused, 3 accepted", async ({ request, calls }) => {
		const { org, ids } = await holidayLeaveOrg(request, calls);
		const tooMany = await org.client.post(`${HR}/leave-requests`, { body: { ...ids, startDate: WEEK.fri, endDate: WEEK.nextMon, numberOfDays: 4, reason: "Long weekend" } });
		expect(tooMany.status, "4 days over 3 working days").toBe(BAD);
		const ok = await raiseLeave(org.client, ids, { startDate: WEEK.fri, endDate: WEEK.nextMon, numberOfDays: 3 });
		expect(ok.numberOfDays).toBe(3);
	});

	test("HR-20 a request for a day that is only a weekly off or holiday is refused", async ({ request, calls }) => {
		const { org, ids } = await holidayLeaveOrg(request, calls);
		const res = await org.client.post(`${HR}/leave-requests`, { body: { ...ids, startDate: WEEK.sun, endDate: WEEK.sun, numberOfDays: 1, reason: "Rest" } });
		expect(res.status).toBe(BAD);
		expect(JSON.stringify(res.body)).toContain("holiday or weekly off");
	});

	test("HR-20 a special working day on the Sunday makes a Sunday-only request valid", async ({ request, calls }) => {
		const { org, yearId, ids } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.sun, "Make-up class day", "SPECIAL_WORKING_DAY");
		const ok = await raiseLeave(org.client, ids, { startDate: WEEK.sun, endDate: WEEK.sun, numberOfDays: 1 });
		expect(ok.numberOfDays).toBe(1);
	});
});

test.describe("HR-21 approval", () => {
	test("HR-21 approving a Monday-to-Wednesday request with Wednesday a holiday marks LEAVE on Monday and Tuesday only", async ({ request, calls }) => {
		const { org, yearId, ids, staff, campusId } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.wed, "Founders Day");
		const leave = await raiseLeave(org.client, ids, { startDate: WEEK.mon, endDate: WEEK.wed, numberOfDays: 2 });
		(await org.client.post(`${HR}/leave-requests/{id}/approve`, { params: { id: leave.id }, body: { decidedBy: null } })).expectStatus(200);
		const onDay = async (date: string) => (await org.client.get("/api/v1/attendance/staff", { query: { campusId, date } })).expectStatus(200).body as { personId: number; attendanceStatus: string }[];
		for (const date of [WEEK.mon, WEEK.tue]) {
			expect(await onDay(date), date).toContainEqual(expect.objectContaining({ personId: staff.personId, attendanceStatus: "LEAVE" }));
		}
		expect((await onDay(WEEK.wed)).filter((r) => r.personId === staff.personId), "the holiday gets no LEAVE row").toEqual([]);
	});
});
