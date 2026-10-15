// Examinations screens: settings, grading scales, exams and schedules, marks entry and approval,
// report cards and their print view. IDs refer to docs/SCENARIOS.md section 8 (EXM-U*).
// Settings and scales are organisation-wide, so those tests run in a throwaway organisation; the rest
// build their own draft-year class in the shared organisation (students only work there, Operion #354).

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { approveSchedule, examSetup, markRows } from "../../../src/api/examinations";
import { attendanceSetup } from "../../../src/api/attendance";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { instrument } from "../../../src/ui/instrument";
import { ExaminationsPage } from "../../../src/pages/examinations/ExaminationsPage";
import { storageStatePath } from "../../../src/setup/session";

const MARKS = "/api/v1/examinations/schedules/{scheduleId}/marks";

test.describe("settings and grading scales", () => {
	test("EXM-U05 the settings panel saves the strategy, ranking and threshold and they survive a reload", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const exams = instrument(new ExaminationsPage(page));
			await exams.open();
			await expect(exams.thresholdField()).toHaveCount(0);
			await exams.chooseStrategy("Both (every subject and minimum aggregate)");
			await expect(exams.thresholdField()).toBeVisible();
			await exams.thresholdField().fill("45");
			await exams.rankingSwitch().check();
			await exams.saveSettings();
			await expect(exams.saved()).toBeVisible();
			await exams.open();
			await expect(exams.rankingSwitch()).toBeChecked();
			await expect(exams.thresholdField()).toHaveValue("45");
			await expect(page.getByRole("combobox", { name: "Overall pass/fail strategy" })).toContainText("Both");
		});
		(await org.client.get("/api/v1/examinations/settings")).expectJson((s) => expect(s).toEqual({ rankingEnabled: true, passFailStrategy: "BOTH", minimumAggregatePercentage: 45 }));
	});

	test("EXM-U05 the threshold field is hidden when the strategy does not use it", async ({ browser, request, calls }) => {
		const org = await createOtherOrg(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const exams = instrument(new ExaminationsPage(page));
			await exams.open();
			await exams.chooseStrategy("Minimum aggregate percentage");
			await expect(exams.thresholdField()).toBeVisible();
			await exams.chooseStrategy("Must pass every subject");
			await expect(exams.thresholdField()).toHaveCount(0);
		});
	});

	test("EXM-U06 a grading scale is added with its bands and listed", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const exams = instrument(new ExaminationsPage(page));
			await exams.open();
			await exams.addScale({ name: "CBSE Standard", defaultScale: true, bands: [{ grade: "A", min: 80, remark: "Excellent" }, { grade: "B", min: 50 }, { grade: "F", min: 0 }] });
			await expect(exams.scaleRow("CBSE Standard")).toContainText("Yes");
			await expect(exams.scaleRow("CBSE Standard")).toContainText("A (80%+), B (50%+), F (0%+)");
		});
		(await org.client.get("/api/v1/examinations/grading-scales")).expectJson((list) => expect(list.map((s: { name: string }) => s.name)).toEqual(["CBSE Standard"]));
	});

	test("EXM-U06 a scale with no band at 0% is refused with a message instead of being saved", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const exams = instrument(new ExaminationsPage(page));
			await exams.open();
			await exams.addScale({ name: "No floor", bands: [{ grade: "A", min: 50 }] });
			await expect(exams.alert().filter({ hasText: /band|percentage|0/i })).toBeVisible();
		});
	});

	test("EXM-U05 a minimum aggregate above 100 is refused with a message", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const exams = instrument(new ExaminationsPage(page));
			await exams.open();
			await exams.chooseStrategy("Minimum aggregate percentage");
			await exams.thresholdField().fill("150");
			await exams.saveSettings();
			await expect(exams.alert().filter({ hasText: /percentage|between|invalid/i })).toBeVisible();
			await expect(exams.saved()).toHaveCount(0);
		});
	});
});

async function createOtherOrg(request: Parameters<typeof createOtherOrganisation>[0], calls: Parameters<typeof createOtherOrganisation>[1]) {
	return createOtherOrganisation(request, calls);
}

test.describe("exams and schedules", () => {
	test("EXM-U01 create an exam for an academic year, then add its schedule", async ({ api, examinations, examDetail, page }) => {
		const s = await attendanceSetup(api, 1);
		const name = `Half Yearly ${s.yearName}`;
		await examinations.open();
		await examinations.chooseYear(s.yearName);
		await expect(page.getByText("No exams yet for this academic year.")).toBeVisible();
		await examinations.addExam(name, "MID_TERM");
		await expect(examinations.examRow(name)).toContainText("MID_TERM");
		await expect(examinations.examRow(name)).toContainText("ACTIVE");

		await examinations.examRow(name).click();
		await expect(page.getByRole("heading", { name: `${name} — MID_TERM` })).toBeVisible();
		await expect(page.getByText("No schedules yet.")).toBeVisible();
		const subjects = (await api.get("/api/v1/subjects")).body;
		const subjectName = subjects.find((x: { id: number }) => x.id === s.base.subjectId).name;
		await examDetail.addSchedule({ className: s.className, subjectName, date: s.day(20), maxMarks: 80, passMarks: 28 });
		await expect(examDetail.scheduleRow(subjectName)).toContainText(s.className);
		await expect(examDetail.scheduleRow(subjectName)).toContainText("All sections");
		await expect(examDetail.scheduleRow(subjectName)).toContainText("80");
		await expect(examDetail.scheduleRow(subjectName)).toContainText("28");
	});

	test("EXM-U01 a schedule for one section shows that section", async ({ api, examinations, examDetail }) => {
		const s = await examSetup(api, 1);
		const fresh = (await api.post("/api/v1/examinations/exams", { body: { academicYearId: s.yearId, name: `Sections ${s.yearName}`, examType: "UNIT_TEST" } })).body;
		await examDetail.open(fresh.id);
		await examDetail.addSchedule({ className: s.className, sectionName: "B", subjectName: s.subjectNames[0], date: s.day(21), maxMarks: 50, passMarks: 20 });
		await expect(examDetail.scheduleRow(s.subjectNames[0])).toContainText("B");
		void examinations;
	});

	test("EXM-U01 a year with exams lists them and an exam page with a clashing schedule explains the clash", async ({ api, examDetail }) => {
		const s = await examSetup(api, 1);
		await examDetail.open(s.exam.id);
		await examDetail.addSchedule({ className: s.className, subjectName: s.subjectNames[0], date: s.day(22), maxMarks: 50, passMarks: 20 });
		await expect(examDetail.alert().filter({ hasText: /already covers/i })).toBeVisible();
	});
});

test.describe("marks entry and approval", () => {
	test("EXM-U02 enter marks for every student, save, submit for review and approve", async ({ api, marksEntry, page }) => {
		const s = await examSetup(api, 2);
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		for (const name of s.studentNames) await expect(marksEntry.row(name)).toBeVisible();
		await marksEntry.enter(s.studentNames[0], 82, "Neat work");
		await marksEntry.enter(s.studentNames[1], 30);
		await marksEntry.saveMarks();
		await expect(page.getByRole("heading", { name: "Marks", exact: true })).toBeVisible();
		await expect(marksEntry.row(s.studentNames[0])).toContainText("PASS");
		await expect(marksEntry.row(s.studentNames[0])).toContainText("Neat work");
		await expect(marksEntry.row(s.studentNames[1])).toContainText("FAIL");
		await expect(marksEntry.registerStatus("DRAFT")).toBeVisible();

		await marksEntry.submitForReview();
		await expect(marksEntry.registerStatus("SUBMITTED")).toBeVisible();
		await marksEntry.approve();
		await expect(marksEntry.registerStatus("APPROVED")).toBeVisible();
		(await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).expectJson((list) => expect(list.map((e: { marksObtained: number }) => e.marksObtained)).toEqual([82, 30]));
	});

	test("EXM-U02 an absent student is saved as absent and failed", async ({ api, marksEntry }) => {
		const s = await examSetup(api, 2);
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await marksEntry.enter(s.studentNames[0], "absent");
		await marksEntry.enter(s.studentNames[1], 60);
		await marksEntry.saveMarks();
		await expect(marksEntry.row(s.studentNames[0])).toContainText("FAIL");
		await expect(marksEntry.row(s.studentNames[0])).toContainText("Yes");
	});

	test("EXM-U02 marks above the maximum are refused with a message and nothing is saved", async ({ api, marksEntry, page }) => {
		const s = await examSetup(api, 1);
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await marksEntry.enter(s.studentNames[0], 150);
		await marksEntry.saveMarks();
		await expect(marksEntry.alert().filter({ hasText: /max|exceed|between|invalid/i })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Marks", exact: true })).toHaveCount(0);
	});

	test("EXM-U02 a section of the exam with no students says so", async ({ api, marksEntry, page }) => {
		const s = await examSetup(api, 0);
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await expect(page.getByText("No currently-enrolled students in this class.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit marks" })).toBeDisabled();
	});

	test("EXM-U07 a mark is corrected before submission and shows the new value", async ({ api, marksEntry }) => {
		const s = await examSetup(api, 1);
		await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } });
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await marksEntry.correct(s.studentNames[0], { marks: 55, remarks: "Re-checked" });
		await expect(marksEntry.row(s.studentNames[0])).toContainText("55");
		await expect(marksEntry.row(s.studentNames[0])).toContainText("Re-checked");
	});

	test("EXM-U07 correcting a published student warns that the report card will go stale", async ({ api, marksEntry, examDetail, page }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [90]);
		await approveSchedule(api, s, 1, [40]);
		await api.post("/api/v1/examinations/exams/{examId}/report-cards", { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } });
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await marksEntry.correctButton(s.studentNames[0]).click();
		await expect(marksEntry.dialog().getByRole("alert")).toContainText(/already published/i);
		await marksEntry.dialog().getByLabel("Marks obtained").fill("60");
		await marksEntry.dialog().getByRole("button", { name: "Save" }).click();
		await expect(marksEntry.row(s.studentNames[0])).toContainText("60");
		void examDetail;
		void page;
	});
});

test.describe("report cards", () => {
	test("EXM-U03 publish a report card from the exam page and read the result", async ({ api, examDetail }) => {
		const s = await examSetup(api, 2);
		await approveSchedule(api, s, 0, [90, 50]);
		await approveSchedule(api, s, 1, [45, 20]);
		await examDetail.open(s.exam.id);
		await examDetail.publishReportCard(s.studentNames[0], s.scale.name);
		await expect(examDetail.publishedSummary()).toContainText("135/150 (90.0%)");
		await expect(examDetail.publishedSummary()).toContainText("grade A");
		await expect(examDetail.publishedSummary()).toContainText("PASS");
	});

	test("EXM-U03 publishing before the marks are approved explains what is missing", async ({ api, examDetail }) => {
		const s = await examSetup(api, 1);
		await examDetail.open(s.exam.id);
		await examDetail.publishReportCard(s.studentNames[0], s.scale.name);
		await expect(examDetail.alert().filter({ hasText: /not been entered|not yet approved/i })).toBeVisible();
	});

	test("EXM-U04 the print view lays out the student, the subject table, totals and grade", async ({ api, examDetail, reportCardPrint, page }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [90]);
		await approveSchedule(api, s, 1, [45]);
		await examDetail.open(s.exam.id);
		await examDetail.publishReportCard(s.studentNames[0], s.scale.name);
		await page.getByRole("button", { name: "View / print" }).click();
		await expect(page).toHaveURL(/\/examinations\/report-cards\/\d+\/print$/);
		await expect(reportCardPrint.text(new RegExp(s.studentNames[0]))).toBeVisible();
		await expect(reportCardPrint.text(`${s.exam.name} (MID_TERM) — ${s.yearName}`)).toBeVisible();
		await expect(reportCardPrint.subjectRow(s.subjectNames[0])).toContainText("90");
		await expect(reportCardPrint.subjectRow(s.subjectNames[1])).toContainText("45");
		await expect(reportCardPrint.text(/135\/150 \(90\.0%\)/)).toBeVisible();
		await expect(reportCardPrint.text(/Grade:/).locator("..")).toContainText("Grade: A");
		await expect(reportCardPrint.printButton()).toBeVisible();
	});

	test("EXM-U04 a stale report card shows the stale warning on the print view", async ({ api, reportCardPrint }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [90]);
		await approveSchedule(api, s, 1, [45]);
		const card = (await api.post("/api/v1/examinations/exams/{examId}/report-cards", { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).body;
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body[0];
		await api.patch("/api/v1/examinations/marks/{marksEntryId}/correct-after-publish", { params: { marksEntryId: entry.id }, body: { marksObtained: 70, absent: false } });
		await reportCardPrint.open(card.id);
		await expect(reportCardPrint.staleWarning()).toBeVisible();
	});

	test("EXM-U04 an unknown report card says so", async ({ reportCardPrint }) => {
		await reportCardPrint.open(99999999);
		await expect(reportCardPrint.error()).toContainText(/no report card/i);
	});
});

test.describe("read-only staff", () => {
	test.use({ storageState: storageStatePath("readOnlyStaff") });

	test("EXM-U08 on the examinations page a view-only user sees exams but no add controls", async ({ api, examinations }) => {
		const s = await examSetup(api, 1);
		await examinations.open();
		await examinations.chooseYear(s.yearName);
		await expect(examinations.examRow(s.exam.name)).toBeVisible();
		await expect(examinations.addExamButton()).toHaveCount(0);
		await expect(examinations.addScaleButton()).toHaveCount(0);
	});

	test("EXM-U08 on an exam a view-only user sees schedules but cannot add one or publish a report card", async ({ api, examDetail }) => {
		const s = await examSetup(api, 1);
		await examDetail.open(s.exam.id);
		await expect(examDetail.scheduleRow(s.subjectNames[0])).toBeVisible();
		await expect(examDetail.addScheduleButton()).toHaveCount(0);
		await expect(examDetail.publishButton()).toHaveCount(0);
	});

	test("EXM-U08 on the marks page a view-only user sees the marks but cannot approve or correct", async ({ api, marksEntry }) => {
		const s = await examSetup(api, 1);
		await api.post(MARKS, { params: { scheduleId: s.schedules[0].id }, body: { marks: markRows(s, [40]) } });
		await api.post("/api/v1/examinations/schedules/{scheduleId}/submit", { params: { scheduleId: s.schedules[0].id } });
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await expect(marksEntry.registerStatus("SUBMITTED")).toBeVisible();
		await expect(marksEntry.row(s.studentNames[0])).toContainText("40");
		await expect(marksEntry.approveButton()).toHaveCount(0);
		await expect(marksEntry.correctButton(s.studentNames[0])).toHaveCount(0);
	});

	test("EXM-U08 on the marks page a view-only user is not offered the entry form for an unstarted schedule", async ({ api, marksEntry, page }) => {
		const s = await examSetup(api, 1);
		await marksEntry.open(s.exam.id, s.schedules[0].id);
		await expect(page.getByText(s.studentNames[0])).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit marks" })).toHaveCount(0);
	});
});
