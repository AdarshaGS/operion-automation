// Sanity phase 14 - promotion and campus transfer, UI only. Continues on the business from phases 01-13. The owner
// adds next year, 2027-28, and sets it up from 2026-27 with Copy forward (preview first, then copy), which gives it
// the template's classes and sections. Year-end promotion then moves Aarav from Grade 1 A to Grade 2 A of 2027-28 on
// roll 1 - nothing is applied until every student has a target - and Grade 1 A is left with no active students. His
// family asks for a move to the second campus: the request is raised from his profile and approved from the pending
// transfers on the Students page. Recording a withdrawal is not covered: Operion has no screen for a student exit
// (5gb), only the API.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_YEAR_END as Y } from "../../src/sanity/business";
import type { Page } from "@playwright/test";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-13",
	addYear: "Academic years › 2027-28 is added as a draft next to the current 2026-27",
	preview: "Copy forward › the preview from 2026-27 lists the classes, assignments, timetable and fees it will copy",
	copy: "Copy forward › copying sets 2027-28 up and says what was copied",
	promotionPage: "Promotion › Grade 1 A of 2026-27 lists Aarav; nothing can be applied until he has a target section",
	promote: "Promotion › Aarav is promoted to Grade 2 A of 2027-28 on roll 1",
	emptied: "Promotion › Grade 1 A of 2026-27 now has no active students",
	requestTransfer: "Transfer › a move to the second campus is requested from Aarav's profile",
	approveTransfer: "Transfer › the request is approved from the pending transfers on the Students page",
	handoff: "Hand-off › next year, the promotion and the transfer are saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

async function openPromotion(page: Page) {
	await page.goto("/students");
	await page.getByRole("button", { name: "Year-end promotion" }).click();
	await expect(page).toHaveURL(/\/students\/promotion$/);
	await expect(page.getByRole("heading", { name: "Year-end promotion" })).toBeVisible();
}

async function choose(page: Page, label: string, option: string) {
	await page.getByRole("combobox", { name: label }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

test("sanity 14: promotion and transfer - next year is set up, Aarav is promoted and moved to the second campus", async ({
	page, diagnostics, loginPage, academicYears,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(13);
	const student = business.student!;
	const thisYear = business.academicYearName ?? "2026-27";
	const campus = "Main Campus";
	const otherCampus = business.details.campus.name;
	const fromSection = `${student.className} · ${campus} - ${student.sectionName}`;
	const toSection = `${Y.promotedTo.className} · ${campus} - ${Y.promotedTo.sectionName}`;
	const studentRow = () => page.getByRole("row").filter({ hasText: student.admissionNumber });

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.addYear, async () => {
		await academicYears.open();
		await academicYears.add(Y.nextYear);
		await expect(academicYears.row(Y.nextYear.name).getByRole("cell")).toHaveText([Y.nextYear.name, Y.nextYear.startDate, Y.nextYear.endDate, "—", "DRAFT", /Copy forward/]);
		await expect(academicYears.currentChip(thisYear)).toBeVisible();
	});

	const dialog = page.getByRole("dialog", { name: `Copy forward into ${Y.nextYear.name}` });

	await j.step(S.preview, async () => {
		await academicYears.row(Y.nextYear.name).getByRole("button", { name: "Copy forward" }).click();
		await expect(dialog.getByRole("combobox", { name: "Copy from" })).toHaveText(`${thisYear} (current)`);
		await expect(dialog.getByRole("button", { name: "Copy forward" }), "only after a preview").toBeDisabled();
		await dialog.getByRole("button", { name: "Preview" }).click();
		await expect(dialog.getByText("What will be copied")).toBeVisible();
		// Both campuses' template classes, phase 03's class subjects, phase 04's assignments, phase 08's timetable and
		// phase 05's fee structure.
		for (const line of ["Classes: 24 to copy", "Sections: 48 to copy", "Class subjects: 4 to copy", "Assignments: 4 to copy", "Timetable slots: 12 to copy", "Fee groups: 1 to copy", "Fee lines: 3 to copy"]) {
			await expect(dialog.getByRole("paragraph").filter({ hasText: line })).toHaveText(line);
		}
	});

	await j.step(S.copy, async () => {
		await dialog.getByRole("button", { name: "Copy forward" }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByRole("alert").filter({ hasText: `Copied ${thisYear} into ${Y.nextYear.name}:` })).toContainText("Classes, sections and subjects");
		await expect(academicYears.currentChip(thisYear), "copying does not change the current year").toBeVisible();
	});

	await j.step(S.promotionPage, async () => {
		await openPromotion(page);
		await expect(page.getByRole("combobox", { name: "From year" })).toHaveText(thisYear);
		await expect(page.getByRole("combobox", { name: "To year" }), "the next year is picked for you").toHaveText(Y.nextYear.name);
		await expect(page.getByLabel("Promotion date"), "the end of the school year").toHaveValue(Y.promotionDate);
		await choose(page, "From section", fromSection);
		await expect(page.getByText("1 active student in this section")).toBeVisible();
		await expect(studentRow()).toContainText(student.name);
		await expect(studentRow().getByRole("combobox").first()).toHaveText("Promote");
		await expect(page.getByText("Choose a target section for every student who is promoted or repeating.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Apply to 1 student" })).toBeDisabled();
	});

	await j.step(S.promote, async () => {
		await choose(page, "Move everyone to", toSection);
		await expect(studentRow().getByRole("combobox").nth(1)).toHaveText(toSection);
		await studentRow().getByRole("spinbutton").fill(String(Y.promotedTo.rollNumber));
		await page.getByRole("button", { name: "Apply to 1 student" }).click();
		await expect(page.getByRole("alert").filter({ hasText: "moved" })).toHaveText("1 student moved.");
		await expect(studentRow()).toContainText("Done");
		await expect(page.getByRole("button", { name: "Apply to 0 students" })).toBeDisabled();
	});

	await j.step(S.emptied, async () => {
		await openPromotion(page);
		await choose(page, "From section", fromSection);
		await expect(page.getByText("0 active students in this section")).toBeVisible();
		await expect(studentRow()).toHaveCount(0);
	});

	await j.step(S.requestTransfer, async () => {
		await page.goto(`/students/${student.id}`);
		const panel = page.getByRole("heading", { name: "Campus transfers" }).locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]");
		await expect(panel.getByText("No transfer requests yet.")).toBeVisible();
		await panel.getByRole("button", { name: "Request transfer" }).click();
		const request = page.getByRole("dialog", { name: "Request campus transfer" });
		await request.getByRole("combobox", { name: "Destination campus" }).click();
		await page.getByRole("option", { name: otherCampus, exact: true }).click();
		await request.getByLabel("Reason").fill(Y.transferReason);
		await request.getByRole("button", { name: "Submit" }).click();
		await expect(request).toBeHidden();
		await expect(panel.getByRole("row").nth(1).getByRole("cell")).toHaveText([campus, otherCampus, Y.transferReason, "PENDING"]);
	});

	await j.step(S.approveTransfer, async () => {
		await page.goto("/students");
		const inbox = page.getByRole("heading", { name: "Pending campus transfers" }).locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]");
		const row = inbox.getByRole("row").filter({ hasText: `${student.name} (${student.admissionNumber})` });
		await expect(row).toContainText(otherCampus);
		await expect(row).toContainText(Y.transferReason);
		await row.getByRole("button", { name: "Approve" }).click();
		await expect(inbox.getByText("No pending transfer requests.")).toBeVisible();
		await page.goto(`/students/${student.id}`);
		const panel = page.getByRole("heading", { name: "Campus transfers" }).locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]");
		await expect(panel.getByRole("row").nth(1)).toContainText("APPROVED");
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 14,
			nextYear: { name: Y.nextYear.name, promotedTo: `${Y.promotedTo.className} - ${Y.promotedTo.sectionName}`, transferTo: otherCampus },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
