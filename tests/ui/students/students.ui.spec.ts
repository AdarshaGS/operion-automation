import { test, expect } from "../../../src/ui/fixtures";
import { uniqueCode } from "../../../src/api/data";

test("admitting a student through the form creates and enrols it, and shows it in the list", async ({ page, studentList, studentCreate, studentDetail, seed }) => {
	const admissionNumber = uniqueCode("UI");

	await studentList.open();
	await studentList.admitStudent();
	await expect(page).toHaveURL(/\/students\/new/);

	await studentCreate.fill({
		firstName: "Ada",
		lastName: "Lovelace",
		admissionNumber,
		admissionDate: "2026-06-01",
		enrolment: { academicYearName: seed.academicYearName, className: seed.className, sectionName: seed.sectionName, rollNumber: 20 + Math.floor(Math.random() * 70) },
	});
	await studentCreate.submit();

	await studentDetail.expectStudentIdInUrl();
	await expect(studentDetail.studentName("Ada Lovelace")).toBeVisible();
	await expect(studentDetail.admissionNumber(admissionNumber)).toBeVisible();

	await studentList.open();
	await studentList.search(admissionNumber);
	const row = studentList.row(admissionNumber);
	await expect(row).toContainText("Ada Lovelace");
	await expect(row).toContainText(seed.className);
});

test("the seeded student appears in the list and opens its detail page", async ({ page, studentList, studentDetail, seed }) => {
	await studentList.open();
	await studentList.search(seed.studentAdmissionNumber);
	await expect(studentList.row(seed.studentAdmissionNumber)).toBeVisible();
	await studentList.openStudent(seed.studentAdmissionNumber);
	await studentDetail.expectStudentIdInUrl();
	await expect(page).toHaveURL(new RegExp(`/students/${seed.studentId}$`));
	await expect(studentDetail.studentName("Auto Student")).toBeVisible();
});
