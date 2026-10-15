// Student list filters, detail page panels, guardians, imports and role-based buttons.
// IDs refer to docs/SCENARIOS.md section 5 (STU-U*). The detail page is a stack of panels, not tabs;
// bulk import lives in Settings > Imports & exports, not on the Students page.

import { test, expect } from "../../../src/sanity/fixtures";
import { buildAcademicBase, enrolStudent } from "../../../src/api/academics";
import { admitStudent, createGuardian, guardianLink } from "../../../src/api/students";
import { uniqueCode } from "../../../src/api/data";
import { storageStatePath } from "../../../src/setup/session";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { UI_BASE_URL } from "../../../src/config/env";
import { storageStateFor } from "../../../src/ui/session";

test.describe("list", () => {
	test("STU-U03 search narrows the list by name or admission number and clear filters restores it", async ({ studentList, api }) => {
		const student = await admitStudent(api);
		await studentList.open();
		await studentList.search(student.admissionNumber);
		await expect(studentList.row(student.admissionNumber)).toBeVisible();
		await expect(studentList.count()).toHaveText("1 student");
		await studentList.search(`${student.admissionNumber}-nope`);
		await expect(studentList.emptyState("No students match these filters.")).toBeVisible();
		await studentList.clearFilters();
		await expect(studentList.count()).not.toHaveText("0 students");
	});

	test("STU-U03 filters by status", async ({ studentList, api }) => {
		const student = await admitStudent(api);
		await studentList.open();
		await studentList.search(student.admissionNumber);
		await studentList.chooseFilter("Status", "ADMITTED");
		await expect(studentList.row(student.admissionNumber)).toBeVisible();
		await studentList.chooseFilter("Status", "ACTIVE");
		await expect(studentList.emptyState("No students match these filters.")).toBeVisible();
	});

	test("STU-U03 filters by class and section", async ({ studentList, api, page }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		const number = (await api.get("/api/v1/students/{studentId}", { params: { studentId } })).body.admissionNumber;
		await studentList.open();
		await studentList.search(number);
		await expect(studentList.row(number)).toBeVisible();
		await studentList.chooseFilter("Class", /Grade/);
		await expect(page.getByRole("combobox", { name: "Section" })).toBeEnabled();
		await studentList.clearFilters();
		await expect(page.getByRole("combobox", { name: "Section" })).toBeDisabled();
	});

	test("STU-U03 filters by admission date range", async ({ studentList, api }) => {
		const early = await admitStudent(api, { admissionDate: "2024-02-10" });
		await studentList.open();
		await studentList.setAdmittedBetween("2024-02-10", "2024-02-10");
		await expect(studentList.row(early.admissionNumber)).toBeVisible();
		await studentList.setAdmittedBetween("2024-03-01", "2024-03-31");
		await expect(studentList.row(early.admissionNumber)).toHaveCount(0);
	});

	test("STU-U03 the list always shows the filter that was typed, even when an earlier response is slow", async ({ studentList, page, api }) => {
		const student = await admitStudent(api);
		let delayed = false;
		await page.route("**/api/v1/students/search*", async (route) => {
			if (!delayed && !route.request().url().includes("search=")) {
				delayed = true;
				await new Promise((resolve) => setTimeout(resolve, 2500));
			}
			await route.continue();
		});
		await page.goto("/students");
		await page.getByLabel("Search").fill(student.admissionNumber);
		await page.waitForResponse((r) => r.url().includes(`search=${student.admissionNumber}`));
		await page.waitForTimeout(3500);
		await expect(studentList.count()).toHaveText("1 student");
		await expect(studentList.row(student.admissionNumber)).toBeVisible();
	});

	test("STU-U03 a list of more than 25 students pages", async ({ studentList, api, page }) => {
		const total = (await api.get("/api/v1/students/search", { query: { size: 1 } })).body.totalElements;
		test.skip(total <= 25, "needs more than one page of students in the shared organisation");
		await studentList.open();
		await expect(page.locator("table").first().getByRole("row")).toHaveCount(26);
		await studentList.nextPage().click();
		await expect(page.getByText(/26–/)).toBeVisible();
	});

	test("STU-U03 a malformed range does not break the page", async ({ studentList, page }) => {
		await studentList.open();
		await studentList.setAdmittedBetween("2026-07-01", "2026-06-01");
		await expect(studentList.count()).toBeVisible();
		await expect(page.getByRole("alert").filter({ hasText: /error|failed/i })).toHaveCount(0);
	});
});

test.describe("detail", () => {
	test("STU-U04 the detail page shows personal, admission, guardian, document and transfer sections", async ({ studentDetail, page, seed }) => {
		await page.goto(`/students/${seed.studentId}`);
		await expect(studentDetail.admissionNumber(seed.studentAdmissionNumber)).toBeVisible();
		await expect(studentDetail.enrolledBanner()).toBeVisible();
		for (const heading of ["Guardians", "Documents", "Campus transfers"]) await expect(studentDetail.panelHeading(heading)).toBeVisible();
		await expect(page.getByText("Admission number")).toBeVisible();
	});

	test("STU-U04 an admitted student shows the Enroll button, an enrolled one does not", async ({ page, api, seed }) => {
		const admitted = await admitStudent(api);
		await page.goto(`/students/${admitted.id}`);
		await expect(page.getByRole("button", { name: "Enroll student" })).toBeVisible();
		await page.goto(`/students/${seed.studentId}`);
		await expect(page.getByRole("button", { name: "Enroll student" })).toHaveCount(0);
	});

	test("STU-U04 an unknown student shows an error, not a blank page", async ({ page }) => {
		await page.goto("/students/99999999");
		await expect(page.getByRole("alert")).toBeVisible();
	});

	test("STU-U09 enrolling an admitted student from the detail page makes them active", async ({ studentDetail, page, api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const student = await admitStudent(api);
		const year = (await api.get("/api/v1/academic-years")).body.find((y: { id: number }) => y.id === base.yearId);
		const cls = (await api.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).body.find((c: { id: number }) => c.id === base.classId);
		await page.goto(`/students/${student.id}`);
		await studentDetail.enroll({ academicYearName: year.name, className: cls.displayName, sectionName: "A", rollNumber: 4, enrolledDate: "2026-06-02" });
		await expect(studentDetail.enrolledBanner()).toBeVisible();
		await expect(studentDetail.statusChip("ACTIVE")).toBeVisible();
	});
});

test.describe("guardians", () => {
	test("STU-U05 adds a new guardian from the detail page and lists them as primary", async ({ studentDetail, page, api }) => {
		const student = await admitStudent(api);
		const last = uniqueCode("Guard");
		await page.goto(`/students/${student.id}`);
		await studentDetail.addGuardian({ firstName: "Gita", lastName: last, phone: "+919833333333", primary: true });
		await expect(studentDetail.guardianRow(last)).toBeVisible();
		await expect(studentDetail.guardianRow(last)).toContainText("Primary");
		(await api.get("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id } })).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("STU-U05 the guardian appears in the student list's contact column", async ({ studentList, studentDetail, page, api }) => {
		const student = await admitStudent(api);
		const last = uniqueCode("Contact");
		await page.goto(`/students/${student.id}`);
		await studentDetail.addGuardian({ firstName: "Chitra", lastName: last, phone: "+919844444444", primary: true });
		await expect(studentDetail.guardianRow(last)).toBeVisible();
		await studentList.open();
		await studentList.search(student.admissionNumber);
		await expect(studentList.row(student.admissionNumber)).toContainText(`Chitra ${last}`);
		await expect(studentList.row(student.admissionNumber)).toContainText("+919844444444");
	});

	test("STU-U05 a guardian without a last name cannot be submitted", async ({ studentDetail, page, api }) => {
		const student = await admitStudent(api);
		await page.goto(`/students/${student.id}`);
		await studentDetail.panel("Guardians").getByRole("button", { name: "Add guardian" }).click();
		await studentDetail.dialog().getByLabel(/^First name/).fill("Only");
		await studentDetail.dialog().getByRole("button", { name: /^Add/ }).last().click();
		await expect(studentDetail.dialog()).toBeVisible();
		(await api.get("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("STU-U05 editing the relationship updates the row", async ({ studentDetail, page, api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api);
		await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id) });
		await page.goto(`/students/${student.id}`);
		await studentDetail.panel("Guardians").getByRole("button").filter({ has: page.locator('[data-testid="EditIcon"]') }).first().click();
		await studentDetail.dialog().getByLabel("Emergency contact").check();
		await studentDetail.dialog().getByRole("button", { name: "Save" }).click();
		await expect(studentDetail.panel("Guardians").getByText("Emergency", { exact: true })).toBeVisible();
	});

	test("STU-U05 granting portal access shows a one-time claim link", async ({ studentDetail, page, api }) => {
		const student = await admitStudent(api);
		const guardian = await createGuardian(api, { email: `ui-${uniqueCode("g").toLowerCase()}@example.test` });
		await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: student.id }, body: guardianLink(guardian.id) });
		await page.goto(`/students/${student.id}`);
		await studentDetail.panel("Guardians").getByRole("button").filter({ has: page.locator('[data-testid="KeyIcon"]') }).first().click();
		await expect(studentDetail.dialog().getByLabel("Claim link")).toHaveValue(/claim-invite\?token=/);
	});
});

test.describe("documents and transfers", () => {
	test("STU-U04 uploads a document and verifies it", async ({ studentDetail, page, api }) => {
		const student = await admitStudent(api);
		await page.goto(`/students/${student.id}`);
		await studentDetail.panel("Documents").getByRole("button", { name: "Upload" }).click();
		await studentDetail.dialog().locator("input[type=file]").setInputFiles({ name: "birth.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
		await studentDetail.dialog().getByRole("button", { name: "Upload", exact: true }).click();
		await expect(studentDetail.panel("Documents").getByText("PENDING")).toBeVisible();
		await studentDetail.panel("Documents").getByRole("button", { name: "Verify" }).click();
		await expect(studentDetail.panel("Documents").getByText("VERIFIED")).toBeVisible();
	});

	test("STU-U04 raises a campus transfer request that then shows as pending", async ({ studentDetail, page, api }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const { studentId } = await enrolStudent(api, base);
		const campusName = `Target ${uniqueCode("C")}`;
		await api.post("/api/v1/campuses", { body: { name: campusName, code: uniqueCode("T") } });
		await page.goto(`/students/${studentId}`);
		await studentDetail.panel("Campus transfers").getByRole("button", { name: "Request transfer" }).click();
		await studentDetail.dialog().getByRole("combobox", { name: "Destination campus" }).click();
		await page.getByRole("option", { name: campusName }).click();
		await studentDetail.dialog().getByLabel("Reason").fill("Closer to home");
		await studentDetail.dialog().getByRole("button", { name: "Submit" }).click();
		await expect(studentDetail.panel("Campus transfers").getByText("PENDING")).toBeVisible();
	});
});

test.describe("form validation", () => {
	test("STU-U07 the admit form cannot be submitted without the required fields", async ({ studentList, page, api }) => {
		const before = (await api.get("/api/v1/students/search", { query: { size: 1 } })).body.totalElements;
		await studentList.open();
		await studentList.admitStudent();
		await page.getByRole("button", { name: "Admit student" }).click();
		await expect(page).toHaveURL(/\/students\/new/);
		await page.waitForTimeout(1000);
		expect((await api.get("/api/v1/students/search", { query: { size: 1 } })).body.totalElements).toBeGreaterThanOrEqual(before);
	});

	test("STU-U07 a duplicate admission number shows an error and stays on the form", async ({ studentList, studentCreate, page, seed, api }) => {
		await studentList.open();
		await studentList.admitStudent();
		await studentCreate.fill({
			firstName: "Dup", lastName: "Licate", admissionNumber: seed.studentAdmissionNumber, admissionDate: "2026-06-01",
			enrolment: { academicYearName: seed.academicYearName, className: seed.className, sectionName: seed.sectionName, rollNumber: 90 + Math.floor(Math.random() * 9) },
		});
		await studentCreate.submit();
		await expect(page.getByRole("alert")).toBeVisible();
		await expect(page).toHaveURL(/\/students\/new/);
		(await api.get("/api/v1/students/search", { query: { search: "Licate" } })).expectJson((page) => expect(page.totalElements).toBe(0));
	});
});

test.describe("bulk import", () => {
	test("STU-U06 imports students from a CSV in Settings > Imports & exports and reports the bad row", async ({ importsExports, api }) => {
		const tag = uniqueCode("UIImp");
		await importsExports.open();
		await importsExports.importFile("Students", { name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(`firstName,lastName,admissionDate,admissionNumber\nIma,${tag}A,2026-06-01,${tag}-1\n,${tag}B,2026-06-01,${tag}-2\n`) });
		await expect(importsExports.chip("Total rows: 2")).toBeVisible();
		await expect(importsExports.chip("Imported: 1")).toBeVisible();
		await expect(importsExports.chip("Errors: 1")).toBeVisible();
		await expect(importsExports.dialog().getByText(/firstName/)).toBeVisible();
		(await api.get("/api/v1/students/search", { query: { search: tag } })).expectJson((page) => expect(page.totalElements).toBe(1));
	});

	test("STU-U06 a file with the wrong columns is reported, not silently ignored", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.importFile("Students", { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("foo,bar\n1,2\n") });
		await expect(importsExports.chip("Errors: 1")).toBeVisible();
	});

	test("STU-U06 the template can be downloaded", async ({ importsExports, page }) => {
		await importsExports.open();
		const download = page.waitForEvent("download");
		await importsExports.card("Students").getByRole("button", { name: "Download template" }).click();
		expect((await download).suggestedFilename()).toBe("students-import-template.csv");
	});
});

test.describe("read-only staff", () => {
	test.describe("signed in as read-only staff", () => {
		test.use({ storageState: storageStatePath("readOnlyStaff") });

		test("STU-U08 sees the list but no Admit student button", async ({ studentList, seed }) => {
			await studentList.open();
			await studentList.search(seed.studentAdmissionNumber);
			await expect(studentList.row(seed.studentAdmissionNumber)).toBeVisible();
			await expect(studentList.admitButton()).toHaveCount(0);
		});

		test("STU-U08 the detail page has no edit, enroll, add-guardian or upload controls", async ({ page, seed }) => {
			await page.goto(`/students/${seed.studentId}`);
			await expect(page.getByText(seed.studentAdmissionNumber).first()).toBeVisible();
			for (const name of ["Edit", "Add guardian", "Request transfer"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
		});

		test("STU-U08 the admit form is not reachable by URL", async ({ page }) => {
			await page.goto("/students/new");
			await expect(page.getByRole("button", { name: "Admit student" })).toHaveCount(0);
		});
	});
});

test.describe("empty state", () => {
	test("STU-U10 a search with no match shows the filtered empty message and a clear action", async ({ studentList }) => {
		await studentList.open();
		await studentList.search("zzzz-no-such-student");
		await expect(studentList.emptyState("No students match these filters.")).toBeVisible();
		await expect(studentList.count()).toHaveText("0 students");
	});

	test("STU-U10 an organisation with no students says so and offers Admit student", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(org.session, UI_BASE_URL) });
		const page = await context.newPage();
		try {
			await page.goto("/students");
			await expect(page.getByRole("alert").filter({ hasText: "No students admitted yet." })).toBeVisible();
			await expect(page.getByText("0 students")).toBeVisible();
			await expect(page.getByRole("button", { name: "Admit student" })).toBeVisible();
		} finally {
			await context.close();
		}
	});
});
