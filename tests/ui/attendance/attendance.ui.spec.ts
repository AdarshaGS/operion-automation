// Attendance screens: class register (/attendance), quick "mark today" (/attendance/mark) and the
// per-student monthly summary on the student page. IDs refer to docs/SCENARIOS.md section 7 (ATT-U*).
// Every test builds its own draft-year section in the shared organisation, so registers never collide.

import { test, expect } from "../../../src/sanity/fixtures";
import { attendanceSetup, markRegister } from "../../../src/api/attendance";
import { storageStatePath } from "../../../src/setup/session";

const ACTION = "/api/v1/attendance/register/{registerId}";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

test.describe("class register", () => {
	test("ATT-U01 mark everyone present, save, submit and lock", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 3);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText(`Mark attendance — ${s.day(10)}`)).toBeVisible();
		for (const name of s.studentNames) await expect(attendance.row(name)).toBeVisible();
		await attendance.markAllPresent();
		await attendance.submitMarks();

		await expect(page.getByText(`Register — ${s.day(10)}`)).toBeVisible();
		await expect(attendance.registerStatus("DRAFT")).toBeVisible();
		await expect(attendance.countChip("PRESENT: 3")).toBeVisible();
		await expect(attendance.countChip("Total: 3")).toBeVisible();
		(await api.get("/api/v1/attendance/sections/{sectionId}/register", { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).expectJson((body) => {
			expect(body.entries.map((e: { attendanceStatus: string }) => e.attendanceStatus)).toEqual(["PRESENT", "PRESENT", "PRESENT"]);
		});

		await attendance.submitRegister();
		await expect(attendance.registerStatus("SUBMITTED")).toBeVisible();
		await attendance.lockRegister();
		await expect(attendance.registerStatus("LOCKED")).toBeVisible();
	});

	test("ATT-U02 an absent student with an excuse and a remark is counted and shown", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 3);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		const [present, absent] = s.studentNames;
		await attendance.setStatus(absent, "ABSENT");
		await attendance.setExcused(absent);
		await attendance.setRemarks(absent, "Doctor appointment");
		await attendance.submitMarks();

		await expect(attendance.countChip("PRESENT: 2")).toBeVisible();
		await expect(attendance.countChip("ABSENT: 1")).toBeVisible();
		await expect(attendance.row(absent)).toContainText("Yes");
		await expect(attendance.row(absent)).toContainText("Doctor appointment");
		await expect(attendance.row(present)).toContainText("No");
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	test("ATT-U02 late, half day and leave are all offered and counted", async ({ api, attendance }) => {
		const s = await attendanceSetup(api, 3);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await attendance.setStatus(s.studentNames[0], "LATE");
		await attendance.setStatus(s.studentNames[1], "HALF_DAY");
		await attendance.setStatus(s.studentNames[2], "LEAVE");
		await attendance.submitMarks();
		for (const chip of ["LATE: 1", "HALF_DAY: 1", "LEAVE: 1"]) await expect(attendance.countChip(chip)).toBeVisible();
	});

	test("ATT-U07 loading a day that is already marked shows the register, not an empty form", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await markRegister(api, s, s.day(10), ["PRESENT", "ABSENT"]);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText(`Register — ${s.day(10)}`)).toBeVisible();
		await expect(attendance.countChip("ABSENT: 1")).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit marks" })).toHaveCount(0);
	});

	test("ATT-U08 the arrows move one day back and forward and load that day", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await markRegister(api, s, s.day(11), ["ABSENT", "ABSENT"]);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText(`Mark attendance — ${s.day(10)}`)).toBeVisible();
		await page.getByRole("button", { name: "▶" }).click();
		await expect(page.getByText(`Register — ${s.day(11)}`)).toBeVisible();
		await expect(attendance.countChip("ABSENT: 2")).toBeVisible();
		await page.getByRole("button", { name: "◀" }).click();
		await expect(page.getByText(`Mark attendance — ${s.day(10)}`)).toBeVisible();
	});

	test("ATT-U09 a section with no students says so", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 0);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText("No currently-enrolled students in this section.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit marks" })).toBeDisabled();
	});

	test("ATT-U10 a mark that the server rejects is explained on the page and nothing is lost", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText(`Mark attendance — ${s.day(10)}`)).toBeVisible();
		await markRegister(api, s, s.day(10), ["PRESENT", "PRESENT"]);
		await attendance.setStatus(s.studentNames[0], "ABSENT");
		await attendance.submitMarks();
		await expect(attendance.alert().filter({ hasText: /already has attendance marked/i })).toBeVisible();
		await expect(page.getByText(`Mark attendance — ${s.day(10)}`)).toBeVisible();
		await expect(attendance.row(s.studentNames[0]).getByRole("combobox")).toContainText("ABSENT");
	});
});

test.describe("corrections and locking", () => {
	test("ATT-U06 a correction needs a reason, changes the status and keeps the register in place", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await markRegister(api, s, s.day(10), ["PRESENT", "PRESENT"]);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await attendance.correctButton(s.studentNames[0]).click();
		await expect(attendance.dialog().getByRole("button", { name: "Save" })).toBeDisabled();
		await attendance.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(attendance.dialog()).toBeHidden();

		await attendance.correct(s.studentNames[0], "LATE", "Arrived after the bell");
		await expect(attendance.dialog()).toBeHidden();
		await expect(attendance.row(s.studentNames[0])).toContainText("LATE");
		await expect(attendance.countChip("LATE: 1")).toBeVisible();
		await expect(page.getByText(`Register — ${s.day(10)}`)).toBeVisible();
		const entryId = (await api.get("/api/v1/attendance/sections/{sectionId}/register", { params: { sectionId: s.sectionId }, query: { date: s.day(10) } })).body.entries[0].id;
		(await api.get("/api/v1/attendance/students/{attendanceId}/corrections", { params: { attendanceId: entryId } })).expectJson((list) => expect(list.map((r: { reason: string }) => r.reason)).toEqual(["Arrived after the bell"]));
	});

	test("ATT-U03 a locked register offers no Correct buttons and no further Submit or Lock", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT", "ABSENT"])).body.register;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		await api.post(`${ACTION}/lock`, { params: { registerId: reg.id } });
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(attendance.registerStatus("LOCKED")).toBeVisible();
		await expect(page.getByRole("button", { name: "Correct" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
	});

	test("ATT-U03 a locked register offers an unlock action to someone who may unlock", async ({ api, attendance }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body.register;
		await api.post(`${ACTION}/submit`, { params: { registerId: reg.id } });
		await api.post(`${ACTION}/lock`, { params: { registerId: reg.id } });
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(attendance.registerStatus("LOCKED")).toBeVisible();
		await expect(attendance.unlockButton()).toBeVisible();
	});

	test("ATT-U11 the correction history of an entry can be seen on screen", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 1);
		const reg = (await markRegister(api, s, s.day(10), ["PRESENT"])).body;
		await api.patch("/api/v1/attendance/students/{attendanceId}", { params: { attendanceId: reg.entries[0].id }, body: { newStatus: "ABSENT", reason: "Parent called" } });
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText("Parent called")).toBeVisible();
	});
});

test.describe("quick mark (today)", () => {
	test("ATT-U12 mark a whole section from the quick screen, then it points to the full register", async ({ api, quickAttendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await quickAttendance.open();
		await quickAttendance.choose(s.className, s.sectionName);
		for (const name of s.studentNames) await expect(quickAttendance.row(name)).toBeVisible();
		await quickAttendance.markAllPresent();
		await quickAttendance.submit();
		await expect(quickAttendance.success()).toBeVisible();

		await quickAttendance.open();
		await quickAttendance.choose(s.className, s.sectionName);
		await expect(quickAttendance.alreadyMarked()).toBeVisible();
		await page.getByRole("button", { name: "Open the full register" }).click();
		await expect(page).toHaveURL(/\/attendance$/);
	});
});

test.describe("student monthly summary", () => {
	test("ATT-U04 the student page shows the month's percentage and counts", async ({ api, attendanceSummary, page }) => {
		const s = await attendanceSetup(api, 1);
		const statuses = ["PRESENT", "PRESENT", "LATE", "HALF_DAY", "ABSENT", "LEAVE"];
		for (let i = 0; i < statuses.length; i++) await markRegister(api, s, s.day(10 + i), [statuses[i]]);
		await attendanceSummary.open(s.studentIds[0]);
		await attendanceSummary.pick(s.year, MONTHS[s.month - 1]);
		await expect(attendanceSummary.percentage()).toHaveText("70% present");
		await expect(attendanceSummary.counts()).toContainText("Present 2 · Late 1 · Half-day 1 · Absent 1 · Leave 1 · 6 days marked");
		await expect(page.getByRole("alert").filter({ hasText: /failed/i })).toHaveCount(0);
	});

	test("ATT-U04 a month with no marks shows 0% and 0 days", async ({ api, attendanceSummary }) => {
		const s = await attendanceSetup(api, 1);
		await attendanceSummary.open(s.studentIds[0]);
		await attendanceSummary.pick(s.year, MONTHS[s.month % 12]);
		await expect(attendanceSummary.percentage()).toHaveText("0% present");
		await expect(attendanceSummary.counts()).toContainText("0 days marked");
	});
});

test.describe("staff attendance screen", () => {
	test("ATT-U05 there is a screen to mark staff attendance and check out", async ({ page }) => {
		await page.goto("/attendance");
		await expect(page.getByRole("link", { name: /staff attendance/i }).or(page.getByRole("tab", { name: /staff/i }))).toBeVisible();
	});
});

test.describe("read-only staff", () => {
	test.use({ storageState: storageStatePath("readOnlyStaff") });

	test("ATT-U13 someone who can only view attendance sees the register without marking, submit, lock or correct controls", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await markRegister(api, s, s.day(10), ["PRESENT", "ABSENT"]);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(attendance.countChip("ABSENT: 1")).toBeVisible();
		await expect(page.getByRole("button", { name: "Correct" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
	});

	test("ATT-U13 viewing a day with no register does not offer the marking form", async ({ api, attendance, page }) => {
		const s = await attendanceSetup(api, 2);
		await attendance.open();
		await attendance.chooseAndLoad(s.className, s.sectionName, s.day(10));
		await expect(page.getByText(`Register — ${s.day(10)}`).or(page.getByText(`Mark attendance — ${s.day(10)}`))).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit marks" })).toHaveCount(0);
	});
});
