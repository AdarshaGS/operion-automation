// Sanity phase 02 - school template, UI only. Continues on the business phase 01 set up: the owner
// opens Academic setup, checks the academic year phase 01 made current (the template only creates
// classes in it) and moves to the wizard's School setup template step, checks the default catalog
// Operion ships (grades, classes, sections, departments, designations), tailors it, answers the
// starter pack questions and applies. Then Settings lists the departments and designations the
// template created (the structure wizard no longer sets those up), Academics shows the grades,
// classes and sections the school will actually use, on every campus, and the dashboard marks
// Academic setup done.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_SCHOOL_TEMPLATE as T } from "../../src/sanity/business";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phase 01",
	year: "Academic setup › the Academic year step lists 2026-27, added in the structure wizard, as current",
	template: "Academic setup › 'School setup template' is the next step",
	grades: "Template › the default catalog lists 12 grades, LKG to Grade 10",
	classes: "Template › there is a class for every grade",
	sections: "Template › the default section is A; add section B",
	staffStructure: "Template › the default catalog lists departments and designations",
	questions: "Starter pack › answer the questions and see which modules switch on",
	apply: "Starter pack › apply creates the records with no warnings",
	review: "Starter pack › 'Review school setup' opens the setup review",
	departments: "Settings › the template's departments exist; Library (module on) is in, Transport (module off) is not",
	designations: "Settings › the template's designations exist; Librarian (module on) is in, Transport Manager and Driver are not",
	gradeLevels: "Academics › every template grade is a grade level",
	classOfferings: "Academics › a class per grade exists on every campus in 2026-27",
	classSections: "Academics › a class has both sections, A and B",
	modules: "Modules › the navigation shows the module switched on and hides one answered no",
	dashboard: "Dashboard › Academic setup is done and the next step is adding students",
	handoff: "Hand-off › the academic year is saved for the next sanity phase",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 02: apply the school template - grades, classes and sections ready on every campus", async ({
	page, diagnostics, loginPage, academicSetup, academicYears, schoolTemplate, departments, designations, academics, classOfferings, topBar,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(1);
	const campusNames = ["Main Campus", business.details.campus.name];
	const cell = (name: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });

	await j.step(S.ownerLogin, async () => {
		// Already signed in from the previous phase; the login form is only used if this phase runs on its own.
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.year, async () => {
		await academicSetup.open();
		await expect(academicSetup.step("Academic year")).toHaveAttribute("aria-selected", "true");
		await expect(academicYears.row(T.academicYear.name), "added once, in phase 01").toHaveCount(1);
		await expect(academicYears.currentChip(T.academicYear.name)).toBeVisible();
	});

	await j.step(S.template, async () => {
		await academicSetup.next();
		await expect(academicSetup.step("School setup template")).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("heading", { name: "School setup template" }).first()).toBeVisible();
	});

	await j.step(S.grades, async () => {
		const grades = schoolTemplate.category("Grades");
		await expect(grades.count()).toHaveText(String(T.defaultGrades.length));
		await grades.expand();
		for (const grade of T.defaultGrades) await expect(grades.item(grade)).toBeVisible();
	});

	await j.step(S.classes, async () => {
		const classes = schoolTemplate.category("Classes");
		await expect(classes.count()).toHaveText(String(T.defaultGrades.length));
		await classes.expand();
		for (const grade of T.defaultGrades) await expect(classes.item(grade)).toBeVisible();
	});

	await j.step(S.sections, async () => {
		const sectionsCategory = schoolTemplate.category("Sections");
		await expect(sectionsCategory.count()).toHaveText("1");
		await sectionsCategory.expand();
		await expect(sectionsCategory.item(T.defaultSection)).toBeVisible();
		await sectionsCategory.add(T.addedSection);
		await expect(sectionsCategory.item(T.addedSection)).toBeVisible();
		await expect(sectionsCategory.count()).toHaveText("2");
	});

	await j.step(S.staffStructure, async () => {
		const departmentsCategory = schoolTemplate.category("Departments");
		await expect(departmentsCategory.count()).toBeVisible();
		await departmentsCategory.expand();
		for (const name of T.departments) await expect(departmentsCategory.item(name)).toBeVisible();
		const designationsCategory = schoolTemplate.category("Designations");
		await expect(designationsCategory.count()).toBeVisible();
		await designationsCategory.expand();
		for (const name of T.designations) await expect(designationsCategory.item(name)).toBeVisible();
	});

	await j.step(S.questions, async () => {
		await schoolTemplate.openStarterPack();
		const pack = schoolTemplate.starterPack();
		await expect(pack.dialog).toBeVisible();
		await expect(pack.enabledModules()).toBeVisible();
		const { question, module } = T.starterPack.switchOn;
		await expect(pack.question(question)).not.toBeChecked();
		await pack.answer(question, true);
		await expect(pack.question(question)).toBeChecked();
		await expect(pack.module(module), `"${module}" moves into the switched-on list`).toBeVisible();
		await expect(pack.module("Academics"), "core modules are always on").toBeVisible();
	});

	await j.step(S.apply, async () => {
		await schoolTemplate.applyStarterPack();
		await expect(schoolTemplate.starterPack().dialog).toBeHidden();
		await expect(schoolTemplate.appliedMessage()).toContainText(/Added \d+ new items/);
		await expect(schoolTemplate.classesNote(), "classes were created, not skipped").toHaveCount(0);
		// Once applied, the module choice is locked - the primary action becomes a plain re-apply.
		await expect(page.getByRole("button", { name: "Apply school template" })).toBeVisible();
	});

	await j.step(S.review, async () => {
		await schoolTemplate.reviewSetup();
		await expect(page).toHaveURL(/\/setup\/review$/);
		await expect(page.getByRole("heading", { name: "Review school setup" })).toBeVisible();
	});

	await j.step(S.departments, async () => {
		const on = T.starterPack.switchOn.department;
		await page.goto("/settings/departments");
		await expect(departments.heading()).toBeVisible();
		for (const name of [...T.departments, on]) await expect(cell(name), `department "${name}" created by the template`).toBeVisible();
		await expect(cell(T.starterPack.leftOff.department), "a module answered no adds none of its departments").toHaveCount(0);
	});

	await j.step(S.designations, async () => {
		await page.goto("/settings/designations");
		await expect(designations.heading()).toBeVisible();
		for (const name of [...T.designations, T.starterPack.switchOn.designation]) await expect(cell(name), `designation "${name}" created by the template`).toBeVisible();
		for (const name of T.starterPack.leftOff.designations) await expect(cell(name)).toHaveCount(0);
	});

	await j.step(S.gradeLevels, async () => {
		await academics.open("Grade levels");
		for (const grade of T.defaultGrades) await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: grade, exact: true }) })).toBeVisible();
	});

	await j.step(S.classOfferings, async () => {
		await academics.openTab("Class offerings");
		// The list shows only the campus picked in the top bar, so check each campus in turn.
		for (const campus of campusNames) {
			await topBar.selectCampus(campus);
			await expect(page.getByRole("heading", { name: `Classes - ${campus}` })).toBeVisible();
			await expect(classOfferings.row(T.academicYear.name), `${campus}: a class per grade in ${T.academicYear.name}`).toHaveCount(T.defaultGrades.length);
			for (const grade of ["LKG", "Grade 10"]) {
				await expect(classOfferings.row(T.academicYear.name).filter({ has: page.getByRole("cell", { name: grade, exact: true }) })).toHaveCount(1);
			}
		}
	});

	await j.step(S.classSections, async () => {
		// The picker is still on the second campus from the step above.
		await classOfferings.row(T.academicYear.name).filter({ has: page.getByRole("cell", { name: "Grade 1", exact: true }) }).getByRole("cell", { name: "Grade 1", exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+$/);
		for (const section of [T.defaultSection, T.addedSection]) {
			await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: section, exact: true }) })).toBeVisible();
		}
	});

	await j.step(S.modules, async () => {
		await expect(page.getByRole("button", { name: T.starterPack.switchOn.module, exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: T.starterPack.leftOff.module, exact: true }), "a module answered no stays hidden").toHaveCount(0);
	});

	await j.step(S.dashboard, async () => {
		await page.goto("/dashboard");
		await expect(page.getByText("Add your first students")).toBeVisible();
		await expect(page.getByRole("button", { name: "Set up academic year" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Go to structure" })).toHaveCount(0);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, academicYearName: T.academicYear.name, completedPhase: 2 });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
