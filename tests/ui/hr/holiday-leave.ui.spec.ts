// Holiday-aware leave in the browser: the working-day hint in the "Raise request" dialog and the upcoming-holidays
// strip on /hr. IDs refer to docs/SCENARIOS.md section 15 (HR-U08, HR-U09). The weekly off and holidays are
// organisation-wide settings, so both tests run in a throwaway organisation (default weekly off: Sunday).

import { test, expect } from "../../../src/sanity/fixtures";
import { HOLIDAY_YEAR_END, WEEK, addCalendarEntry, holidayLeaveOrg, localDate } from "../../../src/api/calendar";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { StaffDetailPage } from "../../../src/pages/hr/StaffDetailPage";
import { HrPage } from "../../../src/pages/hr/HrPage";

test.describe("HR-U08 the leave dialog tells staff which days are leave", () => {
	test("HR-U08 lists the holiday it will not count, pre-fills the working days, keeps a number the person typed, and warns when the whole range is off", async ({ browser, request, calls }) => {
		const { org, yearId, staff } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, WEEK.wed, "Founders Day");
		await inThrowawayOrg(browser, org.session, async (page) => {
			const staffPage = new StaffDetailPage(page);
			await staffPage.open(staff.id);
			await staffPage.openRaiseLeave();

			// Mon-Wed, Wednesday a holiday: two working days, with the holiday named.
			await staffPage.fillLeaveDates(WEEK.mon, WEEK.wed);
			await expect(staffPage.leaveDaysHint()).toContainText("2 working days in this range");
			await expect(staffPage.leaveDaysHint()).toContainText("Founders Day");
			await expect(staffPage.leaveDaysField()).toHaveValue("2");

			// A number the person types (a half day) is not overwritten by the count.
			await staffPage.leaveDaysField().fill("1.5");
			await page.waitForTimeout(500);
			await expect(staffPage.leaveDaysField()).toHaveValue("1.5");

			// Changing the dates pre-fills again: Mon-Fri less the Wednesday holiday is four working days.
			await staffPage.fillLeaveDates(WEEK.mon, WEEK.fri);
			await expect(staffPage.leaveDaysHint()).toContainText("4 working days in this range");
			await expect(staffPage.leaveDaysField()).toHaveValue("4");

			// A Sunday-only range is entirely a day off.
			await staffPage.fillLeaveDates(WEEK.sun, WEEK.sun);
			await expect(staffPage.leaveDaysHint()).toContainText("Every day in this range is a holiday or weekly off, so no leave is needed.");
		});
	});
});

test.describe("HR-U09 upcoming holidays on the HR page", () => {
	test("HR-U09 shows a holiday ten days out as a chip with its name and leaves the weekly off out", async ({ browser, request, calls }) => {
		const day = localDate(10);
		test.skip(day > HOLIDAY_YEAR_END, `${day} is past the academic year the fixture creates (${HOLIDAY_YEAR_END})`);
		const { org, yearId } = await holidayLeaveOrg(request, calls);
		await addCalendarEntry(org.client, yearId, day, "Founders Day");
		await inThrowawayOrg(browser, org.session, async (page) => {
			const hr = new HrPage(page);
			await hr.open();
			await expect(hr.upcomingHolidaysHeading()).toBeVisible();
			await expect(hr.holidayChip(/· Founders Day$/)).toHaveCount(1);
			await expect(hr.holidayChip(/Weekly off/i)).toHaveCount(0);
		});
	});

	test("HR-U09 says so when no holiday is declared in the next 60 days", async ({ browser, request, calls }) => {
		const { org } = await holidayLeaveOrg(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const hr = new HrPage(page);
			await hr.open();
			await expect(hr.upcomingHolidaysHeading()).toBeVisible();
			await expect(page.getByText("No holidays declared in this period.")).toBeVisible();
		});
	});
});
