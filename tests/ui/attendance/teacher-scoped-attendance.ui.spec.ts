// Teacher-scoped attendance (go-live must-fix), seen through the real screens as a class teacher.
// The teacher is a disposable user with plain ATTENDANCE_MARK who is the HOMEROOM teacher of one section only.
// IDs refer to docs/SCENARIOS.md section 7 (ATT-U30..ATT-U33).

import type { Browser } from "@playwright/test";
import { test, expect } from "../../../src/sanity/fixtures";
import { attendanceSetup, CLASS_TEACHER_CODES, makeClassTeacher } from "../../../src/api/attendance";
import { createDisposableUser } from "../../../src/api/users";
import { UI_BASE_URL } from "../../../src/config/env";
import { storageStateFor } from "../../../src/ui/session";
import { AttendancePage, classOption } from "../../../src/pages/attendance/AttendancePage";
import { MarkAttendanceQuickPage } from "../../../src/pages/attendance/MarkAttendanceQuickPage";

type Api = Parameters<typeof attendanceSetup>[0];

async function signInAs(browser: Browser, anon: Api, slug: string, user: { email: string; password: string }) {
	const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: slug, email: user.email, password: user.password } })).expectStatus(200);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
	return { context, page: await context.newPage() };
}

test.describe("class teacher", () => {
	test("ATT-U30 the quick screen offers only the teacher's own class and section, and marking it works", async ({ api, anon, seed, browser }) => {
		const own = await attendanceSetup(api, 2, 1, { coverToday: true });
		const other = await attendanceSetup(api, 1, 1, { coverToday: true });
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, own.sectionId, teacher.personId, own.day(1));

		const { context, page } = await signInAs(browser, anon, seed.organisationSlug, teacher);
		const quick = new MarkAttendanceQuickPage(page);
		await quick.open();
		await page.getByRole("combobox", { name: "Class" }).click();
		await expect(page.getByRole("option")).toHaveCount(1);
		await expect(page.getByRole("option", { name: classOption(own.className) })).toBeVisible();
		await expect(page.getByRole("option", { name: classOption(other.className) }), "another class must not be offered").toHaveCount(0);
		await page.keyboard.press("Escape");

		await quick.choose(own.className, own.sectionName);
		for (const name of own.studentNames) await expect(quick.row(name)).toBeVisible();
		await quick.markAllPresent();
		await quick.submit();
		await expect(quick.success()).toBeVisible();
		await context.close();
	});

	test("ATT-U31 a teacher who is class teacher of nothing is told so on the quick screen", async ({ api, anon, seed, browser }) => {
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		const { context, page } = await signInAs(browser, anon, seed.organisationSlug, teacher);
		await new MarkAttendanceQuickPage(page).open();
		await expect(page.getByText("You are not the class teacher of any section")).toBeVisible();
		await context.close();
	});

	test("ATT-U32 opening another section's register shows it read-only with a class-teacher notice", async ({ api, anon, seed, browser }) => {
		const own = await attendanceSetup(api, 1);
		const other = await attendanceSetup(api, 2);
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, own.sectionId, teacher.personId, own.day(1));

		const { context, page } = await signInAs(browser, anon, seed.organisationSlug, teacher);
		const register = new AttendancePage(page);
		await register.open();
		await register.chooseAndLoad(other.className, other.sectionName, other.day(10));
		await expect(page.getByText("Only this section's class teacher can mark its attendance.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Mark all present" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Submit marks" })).toHaveCount(0);

		await register.chooseAndLoad(own.className, own.sectionName, own.day(10));
		await expect(page.getByRole("button", { name: "Mark all present" })).toBeVisible();
		await register.markAllPresent();
		await register.submitMarks();
		await expect(register.registerStatus("DRAFT")).toBeVisible();
		await context.close();
	});

	test("ATT-U33 an office user with ATTENDANCE_MARK_ANY_SECTION can mark any section", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const office = await createDisposableUser(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_MARK_ANY_SECTION", "CLASS_VIEW", "STUDENT_VIEW"]);
		const { context, page } = await signInAs(browser, anon, seed.organisationSlug, office);
		const register = new AttendancePage(page);
		await register.open();
		await register.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await register.markAllPresent();
		await register.submitMarks();
		await expect(register.registerStatus("DRAFT")).toBeVisible();
		await context.close();
	});
});
