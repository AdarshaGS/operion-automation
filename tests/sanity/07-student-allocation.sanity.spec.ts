// Sanity phase 07 - student allocation, UI only. Continues on the business from phases 01-06. Aarav
// was placed in 2026-27, Grade 1 · Main Campus, section A when he was admitted (Operion's admit form
// enrols in the same step), so this phase checks that allocation from the student list - the
// class and section filters find him, other classes do not - and then applies the fee structure
// phase 05 built for his class: each of its components is assigned to him on the Fees page, on the
// payment frequency the structure defines. Invoices are not generated here.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_ADMISSION as A, SANITY_FEES as F } from "../../src/sanity/business";

const FREQUENCY_LABEL = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", ONE_SHOT: "One-shot" };

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-06",
	classFilter: "Students › filtering by Grade 1 · Main Campus and section A finds the student",
	otherClass: "Students › another class has no students",
	profile: "Student › the profile confirms the enrolment, roll number 1 from the admission date",
	feesOpen: "Fees › the student has no fee assignments yet",
	offered: "Fees › the structure offers exactly Grade 1's components",
	apply: "Fees › assign Tuition, Admission and Computer Lab fees on the structure's payment frequencies",
	totals: "Fees › the assignments add up to the structure's total with no discount, and no invoice exists yet",
	saved: "Fees › the assignments are the same after a fresh load",
	handoff: "Hand-off › the allocation is saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 07: student allocation - class and section confirmed, class fee structure applied", async ({
	page, diagnostics, loginPage, studentList, studentDetail, feeCollection, appLayout,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(6);
	const student = business.student!;
	const classLabel = `${A.enrolment.className} · ${A.enrolment.campus}`;
	const studentLabel = `${student.name} (${student.studentId})`; // how the Collect fee student picker labels him

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.classFilter, async () => {
		await studentList.open();
		await studentList.chooseFilter("Class", classLabel);
		await studentList.chooseFilter("Section", A.enrolment.sectionName);
		await expect(studentList.row(student.admissionNumber)).toContainText(student.name);
		await expect(studentList.row(student.admissionNumber)).toContainText(`${classLabel} / ${A.enrolment.sectionName}`);
		await expect(studentList.count()).toHaveText("1 student");
	});

	await j.step(S.otherClass, async () => {
		await studentList.chooseFilter("Class", `Grade 2 · ${A.enrolment.campus}`);
		await expect(studentList.emptyState("No students match these filters.")).toBeVisible();
		await expect(studentList.row(student.admissionNumber)).toHaveCount(0);
		await studentList.clearFilters();
		await expect(studentList.row(student.admissionNumber)).toBeVisible();
	});

	await j.step(S.profile, async () => {
		await studentList.openStudent(student.admissionNumber);
		await studentDetail.expectStudentIdInUrl();
		await expect(studentDetail.statusChip("ACTIVE")).toBeVisible();
		await expect(studentDetail.enrolledBanner()).toContainText(`roll number ${A.student.rollNumber}, since ${A.student.admissionDate}`);
	});

	await j.step(S.feesOpen, async () => {
		await appLayout.navItem("Fees").click();
		await expect(page).toHaveURL(/\/fees$/);
		await feeCollection.chooseStudent(studentLabel);
		await expect(page.getByRole("heading", { name: "Fee assignments" })).toBeVisible();
		for (const component of F.components) {
			await expect(feeCollection.assignmentRow(component.category), `${component.category} is not assigned yet`).toHaveCount(0);
		}
		await expect(page.getByText("No invoices generated yet.")).toBeVisible();
	});

	await j.step(S.offered, async () => {
		await feeCollection.openAssignDialog();
		await feeCollection.assignDialog().getByRole("combobox", { name: "Fee structure" }).click();
		const options = page.getByRole("option");
		await expect(options, "only the components of Grade 1's structure").toHaveCount(F.components.length);
		for (const component of F.components) {
			await expect(options.filter({ hasText: new RegExp(`^${component.category} — ${component.amount}`) })).toHaveCount(1);
		}
		await page.keyboard.press("Escape"); // closes the option list
		await feeCollection.assignDialog().getByRole("button", { name: "Cancel" }).click();
		await expect(feeCollection.assignDialog()).toBeHidden();
	});

	await j.step(S.apply, async () => {
		for (const component of F.components) {
			await feeCollection.assign({ structureLabel: new RegExp(`^${component.category} — ${component.amount}`) });
			const row = feeCollection.assignmentRow(component.category);
			await expect(row).toContainText(FREQUENCY_LABEL[component.frequency]);
			await expect(row).toContainText("Active");
			await expect(row.getByRole("cell").nth(2), "base amount").toHaveText(String(component.amount));
			await expect(row.getByRole("cell").nth(4), "effective amount").toHaveText(String(component.amount));
		}
	});

	await j.step(S.totals, async () => {
		const total = F.components.reduce((sum, c) => sum + c.amount, 0);
		expect(total, "the structure's total").toBe(business.fees!.total);
		for (const component of F.components) {
			await expect(feeCollection.assignmentRow(component.category).getByRole("cell").nth(3), "no discount").toHaveText("0");
		}
		await expect(page.getByText("No invoices generated yet.")).toBeVisible();
	});

	await j.step(S.saved, async () => {
		await page.reload();
		await feeCollection.chooseStudent(studentLabel);
		for (const component of F.components) {
			const row = feeCollection.assignmentRow(component.category);
			await expect(row).toContainText(FREQUENCY_LABEL[component.frequency]);
			await expect(row).toContainText("Active");
		}
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 7,
			allocation: { categories: F.components.map((c) => c.category), total: business.fees!.total },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
