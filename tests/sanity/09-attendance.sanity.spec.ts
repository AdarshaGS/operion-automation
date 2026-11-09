// Sanity phase 09 - attendance, UI only. Continues on the business from phases 01-08b. The class teacher from
// phase 04 signs in on her own computer and takes Grade 1 A's register for two school days from the Overview's
// "Mark Now": Aarav is present on the first, absent (excused, with a remark) on the second, and she submits each
// register. The owner sees the Overview move from Pending to Recorded, locks the first day (no corrections after
// that), corrects the second day's absence to a half day with a reason - the correction trail is shown - and
// locks it too. Staff attendance records the teacher's own day, and Aarav's profile shows the month's summary.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { signInAsStaff } from "../../src/sanity/staffSession";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, sanityStaff, SANITY_ATTENDANCE as A } from "../../src/sanity/business";
import type { Page } from "@playwright/test";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-08b",
	pending: "Overview › on the first day, Grade 1 - A is pending, with its class teacher named",
	teacherFirst: "Teacher › the class teacher signs in on her own computer and marks Aarav present on the first day",
	teacherSubmits: "Teacher › she submits the register; she is not offered Lock",
	recorded: "Overview › the owner sees the first day recorded: 1 present, 100%",
	lock: "Register › the owner locks the first day; Correct is no longer offered and Unlock is",
	teacherSecond: "Teacher › on the second day she marks Aarav absent, excused, with a remark, and submits",
	correction: "Correction › a correction needs a reason; absent becomes half day and the trail says why",
	lockSecond: "Register › the owner locks the second day",
	staff: "Staff attendance › the teacher's own day is recorded with check-in and check-out",
	summary: "Student profile › October shows 75% present: one present day and one half day",
	handoff: "Hand-off › the register days and the month's percentage are saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

/** The Overview row of the one section with students, for the day typed into the Overview's Date. */
async function overviewRow(page: Page, date: string, label: string) {
	await page.goto("/attendance");
	await page.getByRole("tab", { name: "Overview" }).click();
	await page.getByLabel("Date").fill(date);
	const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });
	await expect(row).toBeVisible();
	return row;
}

test("sanity 09: attendance - the class teacher takes the register, the owner locks and corrects it", async ({
	page, browser, diagnostics, loginPage, attendance, attendanceSummary,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(8);
	const staff = sanityStaff(business.slug);
	const teacherName = `${staff.teacher.firstName} ${staff.teacher.lastName}`;
	const student = business.student!;
	const sectionLabel = `${student.className} - ${student.sectionName}`; // the Overview names a section "<class> - <section>"
	const register = (p: Page) => p.getByRole("heading", { name: /^Register — / });

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.pending, async () => {
		const row = await overviewRow(page, A.firstDay, sectionLabel);
		await expect(row).toContainText(teacherName);
		await expect(row).toContainText("Pending");
		await expect(row.getByRole("button", { name: "Mark Now" })).toBeVisible();
	});

	const teacher = await signInAsStaff(browser, business, business.staff!.teacherEmail, business.staff!.teacherPassword, diagnostics);
	const tp = teacher.page;
	try {
		await j.step(S.teacherFirst, async () => {
			const row = await overviewRow(tp, A.firstDay, sectionLabel);
			await row.getByRole("button", { name: "Mark Now" }).click();
			await expect(tp.getByRole("heading", { name: `Mark attendance — ${A.firstDay}` })).toBeVisible();
			const studentRow = tp.getByRole("row").filter({ hasText: student.name });
			await expect(studentRow, "roll number from the admission").toContainText(String(1));
			await expect(studentRow.getByRole("combobox"), "everyone starts present").toHaveText("PRESENT");
			await tp.getByRole("button", { name: "Submit marks" }).click();
			await expect(register(tp)).toHaveText(`Register — ${A.firstDay}`);
			await expect(tp.getByText("DRAFT", { exact: true })).toBeVisible();
			await expect(tp.getByText("PRESENT: 1", { exact: true })).toBeVisible();
			await expect(tp.getByText("Total: 1", { exact: true })).toBeVisible();
		});

		await j.step(S.teacherSubmits, async () => {
			await tp.getByRole("button", { name: "Submit", exact: true }).click();
			await expect(tp.getByText("SUBMITTED", { exact: true })).toBeVisible();
			await expect(tp.getByRole("button", { name: "Lock", exact: true }), "locking is for the office, not the teacher").toHaveCount(0);
		});

		await j.step(S.recorded, async () => {
			const row = await overviewRow(page, A.firstDay, sectionLabel);
			await expect(row).toContainText("Recorded");
			await expect(row).toContainText("100%");
			await expect(row.getByRole("cell").nth(2), "present").toHaveText("1");
			await expect(row.getByRole("cell").nth(3), "absent").toHaveText("0");
		});

		await j.step(S.lock, async () => {
			const row = await overviewRow(page, A.firstDay, sectionLabel);
			await row.getByRole("button", { name: "View" }).click();
			await expect(register(page)).toHaveText(`Register — ${A.firstDay}`);
			await expect(attendance.registerStatus("SUBMITTED")).toBeVisible();
			await attendance.lockRegister();
			await expect(attendance.registerStatus("LOCKED")).toBeVisible();
			await expect(page.getByRole("button", { name: "Correct" })).toHaveCount(0);
			await expect(attendance.unlockButton()).toBeVisible();
		});

		await j.step(S.teacherSecond, async () => {
			const row = await overviewRow(tp, A.secondDay, sectionLabel);
			await expect(row).toContainText("Pending");
			await row.getByRole("button", { name: "Mark Now" }).click();
			await expect(tp.getByRole("heading", { name: `Mark attendance — ${A.secondDay}` })).toBeVisible();
			const studentRow = tp.getByRole("row").filter({ hasText: student.name });
			await studentRow.getByRole("combobox").click();
			await tp.getByRole("option", { name: "ABSENT", exact: true }).click();
			await studentRow.getByRole("checkbox").check();
			await studentRow.getByRole("textbox").fill(A.absence.remarks);
			await tp.getByRole("button", { name: "Submit marks" }).click();
			await expect(register(tp)).toHaveText(`Register — ${A.secondDay}`);
			const marked = tp.getByRole("row").filter({ hasText: student.name });
			await expect(marked).toContainText("ABSENT");
			await expect(marked).toContainText("Yes");
			await expect(marked).toContainText(A.absence.remarks);
			await tp.getByRole("button", { name: "Submit", exact: true }).click();
			await expect(tp.getByText("SUBMITTED", { exact: true })).toBeVisible();
		});
	} finally {
		await teacher.close();
	}

	await j.step(S.correction, async () => {
		const row = await overviewRow(page, A.secondDay, sectionLabel);
		await expect(row).toContainText("Recorded");
		await expect(row.getByRole("cell").nth(3), "absent").toHaveText("1");
		await row.getByRole("button", { name: "View" }).click();
		await expect(register(page)).toHaveText(`Register — ${A.secondDay}`);
		await attendance.correctButton(student.name).click();
		await expect(attendance.dialog().getByRole("button", { name: "Save" }), "no reason, no correction").toBeDisabled();
		await attendance.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(attendance.dialog()).toBeHidden();
		await attendance.correct(student.name, A.correction.to, A.correction.reason);
		await expect(attendance.dialog()).toBeHidden();
		const marked = attendance.row(student.name);
		await expect(marked).toContainText(A.correction.to);
		await expect(marked).toContainText(`${A.correction.from} → ${A.correction.to}: ${A.correction.reason}`);
		await expect(attendance.countChip(`${A.correction.to}: 1`)).toBeVisible();
	});

	await j.step(S.lockSecond, async () => {
		await expect(attendance.registerStatus("SUBMITTED")).toBeVisible();
		await attendance.lockRegister();
		await expect(attendance.registerStatus("LOCKED")).toBeVisible();
		await expect(page.getByRole("button", { name: "Correct" })).toHaveCount(0);
	});

	await j.step(S.staff, async () => {
		await page.goto("/attendance");
		await page.getByRole("tab", { name: "Staff Attendance" }).click();
		await page.getByRole("combobox", { name: "Campus" }).click();
		await page.getByRole("option", { name: staff.teacher.campus, exact: true }).click();
		await page.getByLabel("Date").fill(A.firstDay);
		await page.getByRole("button", { name: "Load", exact: true }).click();
		await expect(page.getByText("No staff attendance recorded for this day.")).toBeVisible();
		await page.getByRole("button", { name: "Mark staff" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Staff member" }).click();
		await page.getByRole("option", { name: `${teacherName} (${staff.teacher.employeeCode})` }).click();
		await dialog.getByLabel("Check-in time").fill(A.staff.checkIn);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		const row = page.getByRole("row").filter({ hasText: teacherName });
		await expect(row).toContainText(A.staff.status);
		await row.getByRole("button", { name: "Check out" }).click();
		await page.getByRole("dialog").getByLabel("Check-out time").fill(A.staff.checkOut);
		await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(row.getByRole("button", { name: "Check out" }), "checked out once").toHaveCount(0);
		await expect(row.getByRole("cell").nth(3), "check-out time").not.toHaveText("—");
	});

	await j.step(S.summary, async () => {
		await attendanceSummary.open(student.id);
		await attendanceSummary.pick(A.month.year, A.month.name);
		await expect(attendanceSummary.percentage()).toHaveText(`${A.summary.percentage}% present`);
		await expect(attendanceSummary.counts()).toHaveText(A.summary.counts);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, completedPhase: 9, attendance: { days: [A.firstDay, A.secondDay], monthPercentage: A.summary.percentage } });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
