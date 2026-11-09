// Report-card PDF downloads: from the exam's Report cards tab (one card and a whole section), from the
// print view, and from the parent portal's Exam results. IDs refer to docs/SCENARIOS.md (RCP-U*).

import { test, expect } from "../../../src/sanity/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { approveSchedule, examSetup, type ExamSetup } from "../../../src/api/examinations";
import { guardianInPortalRole } from "../../../src/api/portal";
import { signedInAs } from "../../../src/ui/asUser";
import { GuardianPortalPage } from "../../../src/pages/portal/GuardianPortalPage";

const PUBLISH = "/api/v1/examinations/exams/{examId}/report-cards";

async function approvedExam(api: ApiClient): Promise<ExamSetup> {
	const s = await examSetup(api, 2);
	await approveSchedule(api, s, 0, [90, 50]);
	await approveSchedule(api, s, 1, [45, 20]);
	return s;
}

const publish = async (api: ApiClient, s: ExamSetup, index: number) =>
	(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[index], gradingScaleId: s.scale.id } })).expectStatus([200, 201]).body as { id: number };

test.describe("RCP-U01 staff download report-card PDFs", () => {
	test("RCP-U01 publishing a card offers a Download PDF that saves the student's report card", async ({ api, examDetail, page }) => {
		const s = await approvedExam(api);
		await examDetail.open(s.exam.id);
		await examDetail.openReportCardsTab();
		await examDetail.publishReportCard(s.studentNames[0], s.scale.name);
		await expect(examDetail.publishedSummary()).toContainText("grade A");
		const download = page.waitForEvent("download");
		await examDetail.downloadPdfButton().click();
		expect((await download).suggestedFilename()).toMatch(/^report-card-.+\.pdf$/);
	});

	test("RCP-U01 a whole section downloads as one PDF", async ({ api, examDetail, page }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		await publish(api, s, 1);
		await examDetail.open(s.exam.id);
		await examDetail.openReportCardsTab();
		await examDetail.chooseSectionForPdf(s.className, s.sectionName);
		const download = page.waitForEvent("download");
		await examDetail.downloadSectionPdfButton().click();
		expect((await download).suggestedFilename()).toMatch(/^report-cards-.+\.pdf$/);
	});

	test("RCP-U01 a section with no published cards explains why nothing downloads", async ({ api, examDetail }) => {
		const s = await approvedExam(api);
		await examDetail.open(s.exam.id);
		await examDetail.openReportCardsTab();
		await examDetail.chooseSectionForPdf(s.className, s.sectionName);
		await examDetail.downloadSectionPdfButton().click();
		await expect(examDetail.alert().filter({ hasText: /No published report cards/i })).toBeVisible();
	});

	test("RCP-U02 the print view has a Download PDF next to Print", async ({ api, reportCardPrint, page }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		await reportCardPrint.open(card.id);
		await expect(reportCardPrint.printButton()).toBeVisible();
		const download = page.waitForEvent("download");
		await reportCardPrint.downloadPdfButton().click();
		expect((await download).suggestedFilename()).toMatch(/^report-card-.+\.pdf$/);
	});
});

test.describe("RCP-U03 parents download their child's report card", () => {
	test("RCP-U03 each exam result in the parent portal has a Download PDF", async ({ api, anon, seed, browser }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		const parent = await guardianInPortalRole(api, anon, seed, [s.studentIds[0]]);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			const row = guardian.resultRow(s.exam.name);
			await expect(row).toBeVisible();
			const download = page.waitForEvent("download");
			await row.getByRole("button", { name: "Download PDF" }).click();
			expect((await download).suggestedFilename()).toMatch(/^report-card-.+\.pdf$/);
		} finally {
			await context.close();
		}
	});
});
