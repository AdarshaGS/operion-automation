// Sanity phase 06 - student admission, UI only. Continues on the business from phases 01-05: the
// owner follows the dashboard's "Add your first students" prompt into the Admit student form,
// registers one student with the primary guardian typed into the same form, then adds the second
// guardian from the student's Guardians panel. Operion's form also enrols the student (it asks for
// year, class and section), so the student lands in Grade 1 A, the class phase 05 built the fee
// structure for. Phase 07 builds on that: it checks the allocation and applies the fee structure.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_ADMISSION as A, SANITY_SCHOOL_TEMPLATE as T } from "../../src/sanity/business";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-05",
	openForm: "Dashboard › \"Add your first students\" opens the Admit student form",
	required: "Form › submitting an empty form is refused and nothing is created",
	admit: "Form › admit Aarav Nair into Grade 1 A with his father as primary guardian (admission number left blank)",
	detail: "Student › the profile shows the person, admission and enrolment details just entered",
	generated: "Student › the admission number and student ID were generated and the status is Active",
	primaryGuardian: "Guardians › the father is listed as the primary guardian",
	secondGuardian: "Guardians › add the mother as an emergency contact with contact priority 2",
	saved: "Student › everything is the same after a fresh load",
	list: "Students › the list shows the student in Grade 1 A",
	dashboard: "Dashboard › the first-students prompt is gone and Fees is available in the navigation",
	handoff: "Hand-off › the student is saved for student allocation",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 06: student admission - register a student and their guardians", async ({
	page, diagnostics, loginPage, studentCreate, studentDetail, studentList, appLayout,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(5);
	const yearName = business.academicYearName ?? T.academicYear.name;
	const s = A.student;
	const fullName = `${s.firstName} ${s.lastName}`;
	const field = (label: string) => page.getByText(label, { exact: true }).locator("xpath=..");
	let studentId = 0;
	let admissionNumber = "";
	let studentCode = "";

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.openForm, async () => {
		await page.goto("/dashboard");
		await expect(page.getByText("Add your first students")).toBeVisible();
		await page.getByRole("button", { name: "Add students" }).first().click();
		await expect(page).toHaveURL(/\/students\/new$/);
		await expect(studentCreate.heading()).toBeVisible();
	});

	await j.step(S.required, async () => {
		await studentCreate.submit();
		// The browser's own required-field check stops the submit: still on the form, no student made.
		await expect(page).toHaveURL(/\/students\/new$/);
		await expect(studentCreate.heading()).toBeVisible();
		await expect(page.getByLabel(/^First name/)).toBeFocused();
	});

	await j.step(S.admit, async () => {
		await studentCreate.fillAll({
			firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth, gender: s.gender, phone: s.phone,
			address: s.address, admissionDate: s.admissionDate, previousSchool: s.previousSchool, bloodGroup: s.bloodGroup,
			category: s.category, nationality: s.nationality, medicalAlerts: s.medicalAlerts,
			emergencyContactName: s.emergencyContactName, emergencyContactPhone: s.emergencyContactPhone,
			enrolment: { academicYearName: yearName, className: `${A.enrolment.className} · ${A.enrolment.campus}`, sectionName: A.enrolment.sectionName, rollNumber: s.rollNumber },
			guardian: A.primaryGuardian,
		});
		await studentCreate.submit();
		await studentDetail.expectStudentIdInUrl();
		studentId = Number(new URL(page.url()).pathname.split("/").pop());
	});

	await j.step(S.detail, async () => {
		await expect(page.getByRole("heading", { name: fullName, level: 1 })).toBeVisible();
		await expect(field("Date of birth")).toContainText(s.dateOfBirth);
		await expect(field("Gender")).toContainText(s.gender);
		await expect(field("Phone")).toContainText(s.phone);
		await expect(field("Home address")).toContainText(s.address);
		await expect(field("Admission date")).toContainText(s.admissionDate);
		await expect(field("Previous school")).toContainText(s.previousSchool);
		await expect(field("Blood group")).toContainText(s.bloodGroup);
		await expect(field("Nationality")).toContainText(s.nationality);
		await expect(field("Medical alerts / allergies")).toContainText(s.medicalAlerts);
		await expect(field("Emergency contact name")).toContainText(s.emergencyContactName);
		await expect(field("Emergency contact phone")).toContainText(s.emergencyContactPhone);
		await expect(studentDetail.enrolledBanner()).toContainText(`roll number ${s.rollNumber}`);
	});

	await j.step(S.generated, async () => {
		await expect(studentDetail.statusChip("ACTIVE"), "admitting with a class and section enrols the student").toBeVisible();
		studentCode = (await field("Student ID").innerText()).replace("Student ID", "").trim();
		admissionNumber = (await field("Admission number").innerText()).replace("Admission number", "").trim();
		expect(studentCode, "a student ID was generated").not.toMatch(/^(—)?$/);
		expect(admissionNumber, "an admission number was generated from the organisation's numbering format").not.toMatch(/^(—)?$/);
	});

	await j.step(S.primaryGuardian, async () => {
		const father = A.primaryGuardian;
		const row = studentDetail.guardianRow(`${father.firstName} ${father.lastName}`);
		await expect(row).toContainText(father.relationship);
		await expect(row).toContainText("Primary");
		await expect(row).toContainText("Pickup OK");
		await expect(row).toContainText("Comms");
	});

	await j.step(S.secondGuardian, async () => {
		const mother = A.secondGuardian;
		await studentDetail.addGuardian({ ...mother, primary: false });
		const row = studentDetail.guardianRow(`${mother.firstName} ${mother.lastName}`);
		await expect(row).toContainText(mother.relationship);
		await expect(row).toContainText("Emergency");
		await expect(row.getByRole("cell").nth(3), "contact priority").toHaveText(String(mother.contactPriority));
		await expect(row, "only one guardian is primary").not.toContainText("Primary");
	});

	await j.step(S.saved, async () => {
		await page.reload();
		await expect(page.getByRole("heading", { name: fullName, level: 1 })).toBeVisible();
		await expect(studentDetail.statusChip("ACTIVE")).toBeVisible();
		await expect(field("Admission number")).toContainText(admissionNumber);
		await expect(studentDetail.guardianRow(`${A.primaryGuardian.firstName} ${A.primaryGuardian.lastName}`)).toContainText("Primary");
		await expect(studentDetail.guardianRow(`${A.secondGuardian.firstName} ${A.secondGuardian.lastName}`)).toContainText("Emergency");
	});

	await j.step(S.list, async () => {
		await studentList.open();
		const row = studentList.row(admissionNumber);
		await expect(row).toContainText(fullName);
		await expect(row, "class and section").toContainText(`${A.enrolment.className} · ${A.enrolment.campus} / ${A.enrolment.sectionName}`);
		await expect(studentList.count()).toHaveText("1 student");
	});

	await j.step(S.dashboard, async () => {
		await page.goto("/dashboard");
		await expect(page.getByText("Active students")).toBeVisible();
		await expect(page.getByText("Add your first students")).toBeHidden();
		await expect(appLayout.navItem("Fees")).toBeEnabled();
		await expect(appLayout.navItem("Students")).toBeEnabled();
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 6,
			student: { id: studentId, name: fullName, admissionNumber, studentId: studentCode, className: A.enrolment.className, sectionName: A.enrolment.sectionName },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
