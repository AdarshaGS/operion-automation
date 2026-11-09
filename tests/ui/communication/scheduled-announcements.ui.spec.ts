// Scheduling an announcement for a day off, in the browser. IDs refer to docs/SCENARIOS.md section 18 (COM-U04).
// Holidays are organisation-wide, so this runs in a throwaway organisation with Communication switched on.

import { test, expect } from "../../../src/sanity/fixtures";
import { ANNOUNCEMENTS } from "../../../src/api/communication";
import { HOLIDAY_YEAR_END, addCalendarEntry, holidayLeaveOrg, localDate } from "../../../src/api/calendar";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { AnnouncementsPage } from "../../../src/pages/communication/AnnouncementsPage";

/** A date from tomorrow on that is a Monday-Friday, so it is a working day in a new organisation (weekly off: Sunday). */
function nextWeekday(skip: string): string {
	for (let offset = 1; offset < 14; offset++) {
		const date = localDate(offset);
		const weekday = new Date(`${date}T00:00:00`).getDay(); // 0 = Sunday
		if (weekday >= 1 && weekday <= 5 && date !== skip) return date;
	}
	throw new Error("no weekday found");
}

test.describe("COM-U04 scheduling for a day off", () => {
	test("COM-U04 warns that a holiday holds the announcement, offers 'Send on that day anyway', and marks the saved draft", async ({ browser, request, calls }) => {
		const holiday = nextWeekday("");
		test.skip(holiday > HOLIDAY_YEAR_END, `${holiday} is past the academic year the fixture creates (${HOLIDAY_YEAR_END})`);
		const workingDay = nextWeekday(holiday);
		const { org, yearId } = await holidayLeaveOrg(request, calls, { communication: true });
		await addCalendarEntry(org.client, yearId, holiday, "Founders Day");

		await inThrowawayOrg(browser, org.session, async (page) => {
			const announcements = new AnnouncementsPage(page);
			await announcements.open();

			// A plain working day: no warning.
			await announcements.fillMessage("Working day notice", "Back to class");
			await announcements.scheduleFor(`${workingDay}T09:00`);
			await expect(page.getByLabel("Publish at")).toHaveValue(`${workingDay}T09:00`);
			await expect(announcements.dayOffNotice()).toHaveCount(0);

			// The holiday: the warning names it and the override is offered, unticked.
			await announcements.scheduleFor(`${holiday}T09:00`);
			await expect(announcements.dayOffNotice()).toContainText("a holiday (Founders Day)");
			await expect(announcements.dayOffNotice()).toContainText("held until the next working day");
			await expect(announcements.sendAnywayCheckbox()).not.toBeChecked();

			await announcements.fillMessage("Holiday notice", "Open house");
			await announcements.sendAnywayCheckbox().check();
			await announcements.saveDraft();
			await expect(announcements.draftRow("Holiday notice")).toBeVisible();
			await expect(announcements.dayOffChip("Holiday notice")).toBeVisible();
		});

		const drafts = (await org.client.get(ANNOUNCEMENTS, { query: { status: "DRAFT" } })).expectStatus(200).body as { title: string; sendOnNonWorkingDays: boolean }[];
		expect(drafts.find((a) => a.title === "Holiday notice")?.sendOnNonWorkingDays, "the override was saved").toBe(true);
	});
});
