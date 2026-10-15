// Sanity phase 03 - academic setup, UI only. Continues on the phase 01/02 business: the owner walks
// the guided Academic setup wizard, which shows what the school template created (current year,
// the applied School setup template, grade levels, subjects, classes) and finishes with every
// review item ticked. Nothing is typed in by hand - the template already brought the subjects.
// Then the subjects are assigned to a class, mandatory or elective.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_SCHOOL_TEMPLATE as T, SANITY_SUBJECTS as SUB } from "../../src/sanity/business";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-02",
	openWizard: "Wizard › Academic setup opens at the Academic year step",
	year: "Wizard › Academic year: 2026-27 is listed as current",
	template: "Wizard › School setup template: applied in phase 02, so it offers a re-apply",
	grades: "Wizard › Grade levels: the template's grades are listed",
	subjects: "Wizard › Subjects: the template created Mathematics, English, Science and Computer Science",
	classes: "Wizard › Classes / sections: the template's classes are listed for 2026-27",
	review: "Wizard › Review: year, grade levels and classes with sections are all ticked",
	finish: "Wizard › 'Finish setup' returns to the dashboard",
	openClass: "Class › open Grade 1 at Main Campus",
	assign: "Class › assign the core subjects as mandatory and Computer Science as elective",
	saved: "Class › the subject list is the same after a fresh load",
	handoff: "Hand-off › phase 03 is recorded as complete for the next phase",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 03: academic setup wizard - subjects added and assigned to a class", async ({
	page, diagnostics, loginPage, academicSetup, academicYears, subjects, academics, classOfferings, classSubjects,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(2);
	const yearName = business.academicYearName ?? T.academicYear.name;
	// The Classes list shows only the campus picked in the top bar (Main Campus in a fresh session), so rows carry no campus name.
	const classRow = () => classOfferings.row(yearName).filter({ has: page.getByRole("cell", { name: SUB.className, exact: true }) });

	await j.step(S.ownerLogin, async () => {
		// Already signed in from the previous phase; the login form is only used if this phase runs on its own.
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.openWizard, async () => {
		await academicSetup.open();
		await expect(academicSetup.step("Academic year")).toHaveAttribute("aria-selected", "true");
	});

	await j.step(S.year, async () => {
		await expect(academicYears.currentChip(yearName)).toBeVisible();
		await academicSetup.next();
	});

	await j.step(S.template, async () => {
		await expect(academicSetup.step("School setup template")).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("button", { name: "Apply school template" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Set up with starter pack" })).toHaveCount(0);
		await academicSetup.next();
	});

	await j.step(S.grades, async () => {
		await expect(page.getByRole("heading", { name: "Grade levels", exact: true })).toBeVisible();
		for (const grade of [T.defaultGrades[0], T.defaultGrades[T.defaultGrades.length - 1]]) {
			await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: grade, exact: true }) })).toBeVisible();
		}
		await academicSetup.next();
	});

	await j.step(S.subjects, async () => {
		await expect(subjects.heading()).toBeVisible();
		for (const subject of SUB.subjects) {
			await expect(subjects.row(subject.name), "created by the template, not typed in").toHaveCount(1);
			await expect(subjects.row(subject.name)).toContainText(subject.code);
			await expect(subjects.row(subject.name)).toContainText("ACTIVE");
		}
		await academicSetup.next();
	});

	await j.step(S.classes, async () => {
		await expect(page.getByRole("heading", { name: "Classes - Main Campus", exact: true })).toBeVisible();
		await expect(classRow()).toContainText(yearName);
		await academicSetup.next();
	});

	await j.step(S.review, async () => {
		await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
		for (const label of ["Academic year marked current", "At least one grade level", "At least one class with a section"]) {
			await expect(academicSetup.reviewRowDoneIcon(label), `"${label}" is ticked`).toBeVisible();
		}
	});

	await j.step(S.finish, async () => {
		await academicSetup.finish();
		await expect(page).toHaveURL(/\/dashboard/);
	});

	await j.step(S.openClass, async () => {
		await academics.open("Class offerings");
		await classRow().getByRole("cell", { name: SUB.className, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+$/);
		await expect(classSubjects.heading()).toBeVisible();
		await expect(page.getByText("No subjects assigned to this class yet.")).toBeVisible();
	});

	await j.step(S.assign, async () => {
		for (const subject of SUB.subjects) {
			await classSubjects.assign(subject.name, subject.mandatory);
			await expect(classSubjects.row(subject.name)).toContainText(subject.mandatory ? "Yes" : "No");
		}
	});

	await j.step(S.saved, async () => {
		await page.reload();
		await expect(classSubjects.heading()).toBeVisible();
		for (const subject of SUB.subjects) {
			await expect(classSubjects.row(subject.name)).toContainText(subject.mandatory ? "Yes" : "No");
			await expect(classSubjects.row(subject.name)).toContainText("ACTIVE");
		}
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, completedPhase: 3 });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
