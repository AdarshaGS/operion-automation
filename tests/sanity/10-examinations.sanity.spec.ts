// Sanity phase 10 - examinations, UI only. Continues on the business from phases 01-09. The owner checks the
// school template's grading scale, sets the pass rule (every subject must be passed) with ranks switched on,
// creates the term's unit test and schedules its three papers for Grade 1 A (a second paper for the same subject
// is refused). The class teacher signs in on her own computer and enters Aarav's marks paper by paper - a mark
// above the maximum is refused - and submits each paper for review; she cannot approve. The owner approves all
// three, and the exam's Results tab says report cards can now be published (phase 11 publishes them).

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { signInAsStaff } from "../../src/sanity/staffSession";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_EXAM as E } from "../../src/sanity/business";
import type { Page } from "@playwright/test";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-09",
	empty: "Overview › no examinations yet this academic year",
	gradingScale: "Grading scales › the template's Standard Grading Scale is the default, A+ (90%+) down to F (0%+)",
	settings: "Settings › every subject must be passed, and subject and class ranks are computed; kept after a reload",
	create: "Create › the unit test is listed as a Unit Test in Draft, with no papers yet",
	schedule: "Schedule › Mathematics, English and Science papers for Grade 1 · Main Campus, section A",
	duplicate: "Schedule › a second Mathematics paper for the same section is refused",
	notStarted: "Marks entry › all three papers are Not started and the exam is Not Started",
	outOfRange: "Teacher › the class teacher opens Mathematics on her own computer; a mark above the maximum is refused",
	enter: "Teacher › she enters Aarav's marks for every paper and submits each for review; she is not offered Approve",
	approve: "Approval › the owner approves all three papers",
	results: "Results › every register is approved, report cards can be published, and the exam shows 100% entered",
	handoff: "Hand-off › the exam and the marks are saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

/** Opens the exam from the Examinations overview list. */
async function openExam(page: Page) {
	await page.goto("/examinations");
	await page.getByRole("row").filter({ hasText: E.name }).click();
	await expect(page.getByRole("heading", { name: `${E.name} — ${E.type}`, level: 1 })).toBeVisible();
}

/** Opens one paper's marks entry from the exam's "Marks entry" tab. */
async function openPaper(page: Page, subject: string) {
	await openExam(page);
	await page.getByRole("tab", { name: "Marks entry" }).click();
	await page.getByRole("row").filter({ hasText: subject }).getByRole("button", { name: "Open" }).click();
	await expect(page.getByRole("heading", { name: subject, level: 1 })).toBeVisible();
}

test("sanity 10: examinations - a unit test scheduled, marks entered by the teacher and approved", async ({
	page, browser, diagnostics, loginPage,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(9);
	const student = business.student!;
	const classLabel = `${student.className} · ${business.fees!.campus}`;
	const statusChip = (p: Page, status: string) => p.getByText(status, { exact: true });

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.empty, async () => {
		await page.goto("/examinations");
		await expect(page.getByRole("combobox", { name: "Academic Year" })).toHaveText(business.academicYearName ?? "2026-27");
		await expect(page.getByText("No examinations yet for this academic year.")).toBeVisible();
	});

	await j.step(S.gradingScale, async () => {
		await page.getByRole("tab", { name: "Grading Scales" }).click();
		const row = page.getByRole("row").filter({ hasText: E.gradingScale.name });
		await expect(row.getByRole("cell").nth(1), "default scale").toHaveText("Yes");
		await expect(row.getByRole("cell").nth(2)).toHaveText(E.gradingScale.bands.join(", "));
	});

	await j.step(S.settings, async () => {
		await page.getByRole("tab", { name: "Settings" }).click();
		await expect(page.getByRole("heading", { name: "Examination settings" })).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Overall pass/fail strategy" })).toHaveText(E.strategy);
		const ranking = page.getByLabel("Compute subject-wise and class-wise rank");
		await ranking.check();
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByRole("alert").filter({ hasText: "Saved." })).toBeVisible();
		await page.reload();
		await page.getByRole("tab", { name: "Settings" }).click();
		await expect(page.getByLabel("Compute subject-wise and class-wise rank")).toBeChecked();
		await expect(page.getByRole("combobox", { name: "Overall pass/fail strategy" })).toHaveText(E.strategy);
	});

	await j.step(S.create, async () => {
		await page.getByRole("button", { name: "Create Examination" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name").fill(E.name);
		await dialog.getByRole("combobox", { name: "Type" }).click();
		await page.getByRole("option", { name: E.type, exact: true }).click();
		await dialog.getByRole("button", { name: "Create" }).click();
		await expect(dialog).toBeHidden();
		await page.getByRole("tab", { name: "Overview" }).click();
		const row = page.getByRole("row").filter({ hasText: E.name });
		await expect(row).toContainText(E.typeLabel);
		await expect(row).toContainText("Draft");
		await expect(row).toContainText("0%");
	});

	await j.step(S.schedule, async () => {
		await openExam(page);
		await expect(page.getByText("No schedules yet — add them under the Schedule tab.")).toBeVisible();
		await page.getByRole("tab", { name: "Schedule" }).click();
		for (const paper of E.papers) {
			await page.getByRole("button", { name: "Add schedule" }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByRole("combobox", { name: "Class" }).click();
			await page.getByRole("option", { name: classLabel, exact: true }).click();
			await dialog.getByRole("combobox", { name: /^Section/ }).click();
			await page.getByRole("option", { name: student.sectionName, exact: true }).click();
			await dialog.getByRole("combobox", { name: "Subject" }).click();
			await page.getByRole("option", { name: paper.subject, exact: true }).click();
			await dialog.getByLabel("Exam date").fill(paper.date);
			await dialog.getByLabel("Max marks").fill(String(paper.maxMarks));
			await dialog.getByLabel("Pass marks").fill(String(paper.passMarks));
			await dialog.getByRole("button", { name: "Add", exact: true }).click();
			await expect(dialog).toBeHidden();
			const row = page.getByRole("row").filter({ hasText: paper.subject });
			await expect(row.getByRole("cell")).toHaveText([classLabel, student.sectionName, paper.subject, paper.date, String(paper.maxMarks), String(paper.passMarks)]);
		}
	});

	await j.step(S.duplicate, async () => {
		const paper = E.papers[0];
		await page.getByRole("button", { name: "Add schedule" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Class" }).click();
		await page.getByRole("option", { name: classLabel, exact: true }).click();
		await dialog.getByRole("combobox", { name: /^Section/ }).click();
		await page.getByRole("option", { name: student.sectionName, exact: true }).click();
		await dialog.getByRole("combobox", { name: "Subject" }).click();
		await page.getByRole("option", { name: paper.subject, exact: true }).click();
		await dialog.getByLabel("Exam date").fill("2026-10-17");
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await expect(dialog.getByRole("alert")).toContainText("already covers");
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("row").filter({ hasText: paper.subject }), "still one Mathematics paper").toHaveCount(1);
	});

	await j.step(S.notStarted, async () => {
		await page.getByRole("tab", { name: "Marks entry" }).click();
		for (const paper of E.papers) {
			await expect(page.getByRole("row").filter({ hasText: paper.subject })).toContainText("Not started");
		}
		await page.goto("/examinations");
		const row = page.getByRole("row").filter({ hasText: E.name });
		await expect(row).toContainText("Not Started");
		await expect(row.getByRole("cell").nth(3), "the overview names the class without its campus").toHaveText(student.className);
	});

	const teacher = await signInAsStaff(browser, business, business.staff!.teacherEmail, business.staff!.teacherPassword, diagnostics);
	const tp = teacher.page;
	try {
		await j.step(S.outOfRange, async () => {
			const paper = E.papers[0];
			await openPaper(tp, paper.subject);
			await expect(tp.getByText(`${paper.date} — max ${paper.maxMarks}, pass ${paper.passMarks}`)).toBeVisible();
			const row = tp.getByRole("row").filter({ hasText: student.name });
			await row.getByRole("spinbutton").fill(String(E.outOfRange));
			await tp.getByRole("button", { name: "Submit marks" }).click();
			await expect(tp.getByRole("alert")).toContainText(new RegExp(`must be between 0 and the maximum of ${paper.maxMarks}(\\.0)?$`));
			await expect(tp.getByRole("heading", { name: "Enter marks" }), "the form stays open to fix the mark").toBeVisible();
		});

		await j.step(S.enter, async () => {
			for (const [i, paper] of E.papers.entries()) {
				if (i > 0) await openPaper(tp, paper.subject);
				const row = tp.getByRole("row").filter({ hasText: student.name });
				await row.getByRole("spinbutton").fill(String(paper.marks));
				if (paper.remarks) await row.getByRole("textbox").last().fill(paper.remarks);
				await tp.getByRole("button", { name: "Submit marks" }).click();
				await expect(tp.getByRole("heading", { name: "Marks", exact: true })).toBeVisible();
				const marked = tp.getByRole("row").filter({ hasText: student.name });
				await expect(marked.getByRole("cell").nth(1)).toHaveText(String(paper.marks));
				await expect(marked).toContainText("PASS");
				await expect(marked.getByRole("cell").nth(4), "subject rank").toHaveText("1");
				await expect(statusChip(tp, "DRAFT")).toBeVisible();
				await tp.getByRole("button", { name: "Submit for review" }).click();
				await expect(statusChip(tp, "SUBMITTED")).toBeVisible();
				await expect(tp.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
			}
		});
	} finally {
		await teacher.close();
	}

	await j.step(S.approve, async () => {
		for (const paper of E.papers) {
			await openPaper(page, paper.subject);
			await expect(page.getByRole("row").filter({ hasText: student.name }).getByRole("cell").nth(1)).toHaveText(String(paper.marks));
			await page.getByRole("button", { name: "Approve", exact: true }).click();
			await expect(statusChip(page, "APPROVED")).toBeVisible();
		}
		await openExam(page);
		await page.getByRole("tab", { name: "Marks entry" }).click();
		for (const paper of E.papers) await expect(page.getByRole("row").filter({ hasText: paper.subject })).toContainText("Approved");
	});

	await j.step(S.results, async () => {
		await page.getByRole("tab", { name: "Results" }).click();
		await expect(page.getByRole("alert")).toHaveText(`All ${E.papers.length} marks registers are approved — report cards can be published.`);
		await page.getByRole("tab", { name: "Overview" }).click();
		await expect(page.getByText(`Marks entry: ${E.papers.length} of ${E.papers.length} started, ${E.papers.length} approved.`)).toBeVisible();
		await page.goto("/examinations");
		const row = page.getByRole("row").filter({ hasText: E.name });
		await expect(row).toContainText("100%");
		await expect(row).toContainText("In Progress");
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 10,
			exam: { name: E.name, subjects: E.papers.map((p) => ({ subject: p.subject, maxMarks: p.maxMarks, passMarks: p.passMarks, marks: p.marks })) },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
