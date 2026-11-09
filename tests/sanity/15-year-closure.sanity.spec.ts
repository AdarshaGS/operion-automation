// Sanity phase 15 - academic-year closure, UI only. Continues on the business from phases 01-14 and ends the chain.
// With Aarav promoted into 2027-28, the owner makes 2027-28 the current year and closes 2026-27 - closing takes one
// click with no confirmation although it cannot be undone (5gc). The closed year offers no more actions and takes no
// new classes, the top bar works in 2027-28, Aarav is in Grade 2 A there, and his 2026-27 report card is still on
// record.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_EXAM as E, SANITY_REPORT_CARD as RC } from "../../src/sanity/business";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-14",
	markCurrent: "Academic years › 2027-28 is made the current year; 2026-27 stays open but is no longer current",
	close: "Academic years › 2026-27 is closed and offers no more actions",
	noNewClasses: "Classes › a closed year takes no new classes",
	topBar: "Top bar › the school now works in 2027-28",
	student: "Student › the Students list shows Aarav in Grade 2 A; his profile shows the new enrolment",
	history: "History › his 2026-27 report card still opens with the republished result",
	handoff: "Hand-off › the closed year is saved; the sanity chain is complete",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 15: year closure - 2027-28 becomes current and 2026-27 is closed", async ({
	page, diagnostics, loginPage, academicYears, academics, classOfferings, topBar,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(14);
	const student = business.student!;
	const oldYear = business.academicYearName ?? "2026-27";
	const next = business.nextYear!;

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.markCurrent, async () => {
		await academicYears.open();
		await expect(academicYears.row(next.name)).toContainText("DRAFT");
		await academicYears.markCurrent(next.name);
		await expect(academicYears.currentChip(next.name)).toBeVisible();
		await expect(academicYears.row(next.name)).toContainText("ACTIVE");
		await expect(academicYears.currentChip(oldYear)).toHaveCount(0);
		await expect(academicYears.row(oldYear)).toContainText("ACTIVE");
		await expect(academicYears.row(oldYear).getByRole("button", { name: "Mark current" })).toBeVisible();
	});

	await j.step(S.close, async () => {
		await academicYears.row(oldYear).getByRole("button", { name: "Close" }).click();
		await expect(academicYears.row(oldYear)).toContainText("CLOSED");
		await expect(academicYears.row(oldYear).getByRole("button"), "no copy forward, mark current or close").toHaveCount(0);
		await page.reload();
		await expect(academicYears.row(oldYear)).toContainText("CLOSED");
		await expect(academicYears.currentChip(next.name)).toBeVisible();
	});

	await j.step(S.noNewClasses, async () => {
		await academics.open("Class offerings");
		await classOfferings.openAdd();
		await classOfferings.fillClass({ year: oldYear, campus: "Main Campus", grade: "Grade 3", displayName: "Grade 3 Late Entry" });
		await classOfferings.submitAdd();
		await expect(classOfferings.errorBanner()).toContainText(`Academic year ${oldYear} is closed and accepts no new classes`);
		await classOfferings.addDialog().getByRole("button", { name: "Cancel" }).click();
		await expect(classOfferings.row("Grade 3 Late Entry")).toHaveCount(0);
	});

	await j.step(S.topBar, async () => {
		await page.goto("/dashboard");
		await expect(topBar.yearButton()).toContainText(next.name);
	});

	await j.step(S.student, async () => {
		await page.goto("/students");
		const row = page.getByRole("row").filter({ hasText: student.admissionNumber });
		await expect(row.getByRole("cell").nth(2), "the Class / section column").toContainText(next.promotedTo.split(" - ")[0]);
		await expect(row.getByRole("cell").nth(2)).toContainText(next.promotedTo.split(" - ")[1]);
		await row.click();
		// The profile names the roll number and date, not the class.
		await expect(page.getByRole("alert").filter({ hasText: "Enrolled" })).toHaveText("Enrolled - roll number 1, since 2027-03-31");
	});

	await j.step(S.history, async () => {
		await page.goto(`/examinations/report-cards/${business.reportCard!.id}/print`);
		await expect(page.getByText(`${E.name} (${E.type}) — ${oldYear}`)).toBeVisible();
		await expect(page.getByText(`Total: ${RC.republished.total}/${RC.republished.max} (${RC.republished.percentage}%)`)).toBeVisible();
		await expect(page.getByText(`Grade: ${RC.republished.grade}`)).toBeVisible();
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, completedPhase: 15, academicYearName: next.name, nextYear: { ...next, closed: oldYear } });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
