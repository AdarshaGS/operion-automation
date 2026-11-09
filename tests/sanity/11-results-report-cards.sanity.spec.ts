// Sanity phase 11 - results and report cards, UI only. Continues on the business from phases 01-10. With every
// paper of the unit test approved, the owner publishes Aarav's report card on the template's grading scale: 117 of
// 150, 78.0%, grade B+, a pass, class rank 1 (ranks were switched on in phase 10); publishing it twice is refused.
// The printable card shows the school year, the class and every paper. The English paper is then re-totalled after
// publishing - a correction that needs the higher "after publish" permission and flags the card stale - and the
// republished card reads 121 of 150, 80.7%, grade A. The examinations overview counts the published result.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_EXAM as E, SANITY_REPORT_CARD as R } from "../../src/sanity/business";
import type { Page } from "@playwright/test";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-10",
	nothingYet: "Report cards › nothing is published yet",
	publish: "Report cards › Aarav's card is published: 117/150, 78.0%, grade B+, PASS, class rank 1",
	print: "Print › the card shows the exam, year, student, class and every paper's marks and result",
	duplicate: "Report cards › publishing the same card again is refused",
	overview: "Overview › the exam is Published and the result summary counts one B+ at a 100% pass rate",
	correct: "Correction › the English paper is re-totalled after publishing; the dialog warns the card will go stale",
	stale: "Print › the published card now says it is stale",
	republish: "Report cards › republishing gives 121/150, 80.7%, grade A, and the new card is not stale",
	handoff: "Hand-off › the report card is saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

async function openExamTab(page: Page, tab: string) {
	await page.goto("/examinations");
	await page.getByRole("row").filter({ hasText: E.name }).click();
	await expect(page.getByRole("heading", { name: `${E.name} — ${E.type}`, level: 1 })).toBeVisible();
	await page.getByRole("tab", { name: tab }).click();
}

const summary = (r: { total: number; max: number; percentage: string; grade: string }) => `${r.total}/${r.max} (${r.percentage}%) — grade ${r.grade} —`;

test("sanity 11: results and report cards - published, printed, corrected after publishing and republished", async ({
	page, diagnostics, loginPage,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(10);
	const student = business.student!;
	const exam = business.exam!;
	const year = business.academicYearName ?? "2026-27";
	const studentOption = `${student.name} (${student.admissionNumber})`; // how the publish dialog lists students
	let firstCardUrl = "";
	let reportCardId = 0;

	async function publish() {
		await page.getByRole("button", { name: "Publish report card" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Student" }).click();
		await page.getByRole("option", { name: studentOption, exact: true }).click();
		await dialog.getByRole("combobox", { name: "Grading scale" }).click();
		await page.getByRole("option", { name: E.gradingScale.name, exact: true }).click();
		await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	}

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.nothingYet, async () => {
		await openExamTab(page, "Report cards");
		await expect(page.getByText("Publish a report card for a student to see the result here.")).toBeVisible();
	});

	await j.step(S.publish, async () => {
		await publish();
		await expect(page.getByRole("dialog")).toBeHidden();
		const result = page.getByRole("alert").filter({ hasText: "grade" });
		await expect(result).toContainText(summary(R.first));
		await expect(result).toContainText("PASS");
		await expect(result).toContainText("Class rank #1");
		await expect(result).not.toContainText("stale");
	});

	await j.step(S.print, async () => {
		await page.getByRole("button", { name: "View / print" }).click();
		await expect(page).toHaveURL(/\/examinations\/report-cards\/\d+\/print$/);
		firstCardUrl = new URL(page.url()).pathname;
		await expect(page.getByText(`${E.name} (${E.type}) — ${year}`)).toBeVisible();
		await expect(page.getByText(`Student: ${student.name} (${student.admissionNumber})`)).toBeVisible();
		await expect(page.getByText(`Class: ${student.className} - ${student.sectionName}`)).toBeVisible();
		for (const paper of exam.subjects) {
			const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: paper.subject, exact: true }) });
			await expect(row.getByRole("cell")).toHaveText([paper.subject, String(paper.maxMarks), String(paper.passMarks), String(paper.marks), "Pass", "1"]);
		}
		await expect(page.getByText(`Total: ${R.first.total}/${R.first.max} (${R.first.percentage}%)`)).toBeVisible();
		await expect(page.getByText(`Grade: ${R.first.grade}`)).toBeVisible();
		await expect(page.getByText("Class rank: #1")).toBeVisible();
		await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
		await expect(page.getByRole("alert").filter({ hasText: /stale/ })).toHaveCount(0);
	});

	await j.step(S.duplicate, async () => {
		// A refused publish clears the result panel, so this comes after the card has been opened.
		await openExamTab(page, "Report cards");
		await publish();
		await expect(page.getByRole("dialog").getByRole("alert")).toContainText("already published");
		await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
	});

	await j.step(S.overview, async () => {
		await page.goto("/examinations");
		await expect(page.getByRole("row").filter({ hasText: E.name })).toContainText("Published");
		await expect(page.getByText("Pass Rate", { exact: true }).locator(".."), "the pass-rate dial").toHaveText("100%Pass Rate");
		await expect(page.getByText(R.first.grade, { exact: true }).locator(".."), "the grade legend").toHaveText(`${R.first.grade}1`);
		await expect(page.getByText("1 examination published this academic year")).toBeVisible();
	});

	await j.step(S.correct, async () => {
		const { subject, from, to, remarks } = R.correction;
		await openExamTab(page, "Marks entry");
		await page.getByRole("row").filter({ hasText: subject }).getByRole("button", { name: "Open" }).click();
		await expect(page.getByRole("heading", { name: subject, level: 1 })).toBeVisible();
		const row = page.getByRole("row").filter({ hasText: student.name });
		await expect(row.getByRole("cell").nth(1)).toHaveText(String(from));
		await row.getByRole("button", { name: "Correct (published)" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByRole("heading")).toHaveText("Correct marks (report card already published)");
		await expect(dialog.getByRole("alert")).toContainText("flag it stale until republished");
		await dialog.getByLabel("Marks obtained").fill(String(to));
		await dialog.getByLabel("Remarks").fill(remarks);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await expect(row.getByRole("cell").nth(1)).toHaveText(String(to));
		await expect(row).toContainText(remarks);
	});

	await j.step(S.stale, async () => {
		// Staff have no list of published report cards to go back to (5fv), so the card is reopened from its address.
		await page.goto(firstCardUrl);
		await expect(page.getByRole("alert").filter({ hasText: "This report card is stale - marks have been corrected since it was published." })).toBeVisible();
	});

	await j.step(S.republish, async () => {
		await openExamTab(page, "Report cards");
		await publish();
		await expect(page.getByRole("dialog")).toBeHidden();
		const result = page.getByRole("alert").filter({ hasText: "grade" });
		await expect(result).toContainText(summary(R.republished));
		await expect(result).toContainText("PASS");
		await expect(result).not.toContainText("stale");
		await page.getByRole("button", { name: "View / print" }).click();
		await expect(page).toHaveURL(/\/examinations\/report-cards\/\d+\/print$/);
		expect(new URL(page.url()).pathname, "a new card replaces the stale one").not.toBe(firstCardUrl);
		reportCardId = Number(page.url().match(/report-cards\/(\d+)\//)![1]);
		const english = page.getByRole("row").filter({ has: page.getByRole("cell", { name: R.correction.subject, exact: true }) });
		await expect(english.getByRole("cell").nth(3)).toHaveText(String(R.correction.to));
		await expect(page.getByText(`Total: ${R.republished.total}/${R.republished.max} (${R.republished.percentage}%)`)).toBeVisible();
		await expect(page.getByText(`Grade: ${R.republished.grade}`)).toBeVisible();
		await expect(page.getByRole("alert").filter({ hasText: /stale/ })).toHaveCount(0);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 11,
			reportCard: { id: reportCardId, total: R.republished.total, max: R.republished.max, percentage: Number(R.republished.percentage), grade: R.republished.grade, passed: true },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
