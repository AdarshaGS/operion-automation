// Working-day fixtures: the calendar endpoint, holidays/special days, the weekly-off mask, and a
// throwaway organisation with one staff member who has leave to spend. Holiday-aware leave and
// announcements change org-wide settings (the weekly off, holidays), so everything that does runs in
// a throwaway organisation, never the shared fixture one.

import type { APIRequestContext } from "@playwright/test";
import type { ApiClient, RecordedCall } from "./apiClient";
import { createOtherOrganisation, type OtherOrganisation } from "./organisations";
import { allocateLeave, createLeaveType, createStaff, type Staff } from "./hr";
import { enableModule } from "../setup/provisioning";

export const CALENDAR_DAYS = "/api/v1/calendar/days";

export interface CalendarDays {
	from: string;
	to: string;
	workingDayCount: number;
	nonWorkingDays: { date: string; kind: "HOLIDAY" | "WEEKLY_OFF"; label: string }[];
}

/** Every day of the week 2026-09-07 (a Monday) to 2026-09-13 (a Sunday). The academic year below covers it. */
export const WEEK = { mon: "2026-09-07", tue: "2026-09-08", wed: "2026-09-09", thu: "2026-09-10", fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13", nextMon: "2026-09-14" };

export async function calendarDays(api: ApiClient, from: string, to: string, campusId?: number) {
	const res = await api.get(CALENDAR_DAYS, { query: { from, to, ...(campusId ? { campusId } : {}) } });
	res.expectStatus(200);
	return res.body as CalendarDays;
}

export async function addCalendarEntry(api: ApiClient, academicYearId: number, date: string, label: string, type: "HOLIDAY" | "SPECIAL_WORKING_DAY" = "HOLIDAY", campusId: number | null = null) {
	const res = await api.post("/api/v1/academic/working-calendar", { body: { academicYearId, campusId, date, label, type } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; date: string; label: string; type: string };
}

/** Replaces the organisation's weekly working-days mask (bit 0 = Monday ... bit 6 = Sunday), keeping its other settings. */
export async function setWorkingDaysMask(api: ApiClient, workingDaysMask: number) {
	const current = (await api.get("/api/v1/organisations/settings")).expectStatus(200).body;
	const res = await api.patch("/api/v1/organisations/settings", {
		body: { timezone: current.timezone, defaultCurrency: current.defaultCurrency, dateFormat: current.dateFormat, logoUrl: current.logoUrl, primaryColor: current.primaryColor, workingDaysMask },
	});
	res.expectStatus(200);
	return { ...current, workingDaysMask } as { timezone: string; workingDaysMask: number };
}

/** 0 = Monday ... 6 = Sunday for "today" in the given IANA time zone (what the server's own clock reads for that organisation). */
export function todayWeekday(timeZone: string): number {
	const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date());
	return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(short);
}

export interface HolidayLeaveOrg {
	org: OtherOrganisation;
	campusId: number;
	yearId: number;
	yearName: string;
	staff: Staff;
	leaveType: { id: number; name: string };
	/** Ids in the shape raiseLeave() takes. */
	ids: { staffProfileId: number; leaveTypeId: number; academicYearId: number };
}

/** A new organisation with an academic year covering WEEK, one staff member and 20 days of a leave type. */
export async function holidayLeaveOrg(request: APIRequestContext, calls: RecordedCall[], options: { communication?: boolean } = {}): Promise<HolidayLeaveOrg> {
	const org = await createOtherOrganisation(request, calls);
	if (options.communication) await enableModule(org.id, "COMMUNICATION");
	const campusId = ((await org.client.get("/api/v1/campuses")).expectStatus(200).body as { id: number }[])[0].id;
	const yearName = `Holiday year ${org.slug.slice(-6)}`;
	const year = (await org.client.post("/api/v1/academic-years", { body: { name: yearName, startDate: "2026-04-01", endDate: "2027-03-31" } })).expectStatus([200, 201]).body as { id: number };
	const staff = await createStaff(org.client, campusId);
	const leaveType = await createLeaveType(org.client);
	await allocateLeave(org.client, staff.id, leaveType.id, year.id, 20);
	return { org, campusId, yearId: year.id, yearName, staff, leaveType, ids: { staffProfileId: staff.id, leaveTypeId: leaveType.id, academicYearId: year.id } };
}

/** "YYYY-MM-DD" for today plus `offsetDays` in this machine's local time - the same clock the browser's hints use. */
export function localDate(offsetDays = 0): string {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The academic year holidayLeaveOrg creates covers up to here; a date past it cannot take a calendar entry. */
export const HOLIDAY_YEAR_END = "2027-03-31";
