// Sanity phase 13 - reports, UI only. Continues on the business from phases 01-12. Saved reports are optional for a
// new school (AppModule.defaultEnabled, and phase 02's starter pack leaves "saved custom reports" at its default no),
// so Reports is not in the menu until the platform operator switches it on. The standard reports Operion seeds
// are for shops (sales, stock, purchases), so the owner builds the school's own over the reporting views: a class
// register filtered by school year, attendance between two dates and the exam results. Each one runs on the data the
// earlier phases left - Aarav on roll 1 of Grade 1 A, his present day and his corrected half day, his republished
// report card - and a filter that matches nothing says so. The register is published and exported as CSV.

import { readFileSync } from "node:fs";
import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_ATTENDANCE as A, SANITY_EXAM as E, SANITY_REPORT_CARD as RC, SANITY_REPORTS as R } from "../../src/sanity/business";
import { PlatformLoginPage } from "../../src/pages/platform/PlatformLoginPage";
import { PlatformOrganisationsPage } from "../../src/pages/platform/PlatformOrganisationsPage";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../src/config/env";
import { EMPTY_STORAGE } from "../../src/ui/session";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-12",
	notYet: "Owner › Reports is not in the menu while the module is off",
	operatorOn: "Platform console › the operator switches Reports on for this school",
	empty: "Reports › the owner has no reports yet",
	register: "Class register › built with a school-year filter; 2026-27 lists Aarav on roll 1 of Grade 1 A",
	noMatch: "Class register › a year with no students returns no rows",
	publish: "Class register › published, and it stays in My reports as Published",
	exportCsv: "Class register › exported as CSV with the same columns and Aarav's row",
	attendance: "Attendance › between two dates it shows his present day and his corrected half day",
	results: "Exam results › his republished card is listed: 121 of 150, 80.7%, grade A",
	handoff: "Hand-off › the report names are saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 13: reports - the owner builds, runs, publishes and exports the school's reports", async ({
	page, browser, diagnostics, loginPage, reports, reportDetail,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(12);
	const student = business.student!;
	const year = business.academicYearName ?? "2026-27";
	const headers = () => reportDetail.resultTable().getByRole("columnheader");
	const rows = () => reportDetail.resultTable().locator("tbody tr");

	async function build(report: typeof R.register) {
		await reports.open();
		await reports.createReport(report);
		await expect(reports.dialog()).toBeHidden();
		await expect(reports.statusOf(report.name)).toHaveText("DRAFT");
		await reports.openReport(report.name);
		await expect(reportDetail.status()).toHaveText("DRAFT");
	}

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.notYet, async () => {
		await page.goto("/dashboard");
		await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
	});

	await j.step(S.operatorOn, async () => {
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
		const operator = await context.newPage();
		const platformLogin = new PlatformLoginPage(operator);
		const organisations = new PlatformOrganisationsPage(operator);
		await platformLogin.open();
		await platformLogin.login(PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
		await expect(operator).toHaveURL(/\/platform\/dashboard/);
		await organisations.open();
		await organisations.openDetail(business.slug);
		await expect(organisations.moduleSwitch("Reports")).not.toBeChecked();
		await organisations.moduleSwitch("Reports").click();
		await expect(organisations.moduleSwitch("Reports")).toBeChecked();
		await operator.reload();
		await expect(organisations.moduleSwitch("Reports")).toBeChecked();
		await platformLogin.signOut();
		await context.close();
	});

	await j.step(S.empty, async () => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "Reports", exact: true }).click();
		await expect(page).toHaveURL(/\/reports$/);
		await reports.listLoaded();
		await expect(page.getByText("No reports here yet.")).toBeVisible();
	});

	await j.step(S.register, async () => {
		await build(R.register);
		await reportDetail.paramInput("School year").fill(year);
		await reportDetail.run();
		await expect(headers()).toHaveText(R.register.headings);
		await expect(rows()).toHaveCount(1);
		await expect(rows().first().getByRole("cell")).toHaveText([student.admissionNumber, student.name, student.className, student.sectionName, "1", "ACTIVE"]);
	});

	await j.step(S.noMatch, async () => {
		await reportDetail.paramInput("School year").fill("2025-26");
		await reportDetail.run();
		await expect(reportDetail.noRows()).toBeVisible();
		await reportDetail.paramInput("School year").fill(year);
		await reportDetail.run();
		await expect(rows()).toHaveCount(1);
	});

	await j.step(S.publish, async () => {
		await reportDetail.publish();
		await expect(reportDetail.status()).toHaveText("PUBLISHED");
		await expect(reportDetail.button("Publish")).toHaveCount(0);
		await reportDetail.backToReports();
		await reports.listLoaded();
		await expect(reports.statusOf(R.register.name)).toHaveText("PUBLISHED");
		await expect(reports.row(R.register.name)).toContainText(R.register.description);
	});

	await j.step(S.exportCsv, async () => {
		await reports.openReport(R.register.name);
		await reportDetail.paramInput("School year").fill(year);
		const download = await reportDetail.exportCsv();
		expect(download.suggestedFilename()).toMatch(/\.csv$/);
		const lines = readFileSync((await download.path())!, "utf8").trim().split(/\r?\n/);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(R.register.headings.map((h) => `"${h}"`).join(","));
		expect(lines[1]).toContain(student.admissionNumber);
		expect(lines[1]).toContain(student.name);
	});

	await j.step(S.attendance, async () => {
		await build(R.attendance);
		await reportDetail.paramInput("From").fill(A.firstDay);
		await reportDetail.paramInput("To").fill(A.secondDay);
		await reportDetail.run();
		await expect(headers()).toHaveText(R.attendance.headings);
		await expect(rows()).toHaveCount(2);
		await expect(rows().nth(0).getByRole("cell")).toHaveText([A.firstDay, student.name, student.className, student.sectionName, "PRESENT", /^(false|0)$/]);
		await expect(rows().nth(1).getByRole("cell")).toHaveText([A.secondDay, student.name, student.className, student.sectionName, A.correction.to, /^(true|1)$/]);
		await reportDetail.paramInput("To").fill(A.firstDay);
		await reportDetail.run();
		await expect(rows(), "one day only").toHaveCount(1);
	});

	await j.step(S.results, async () => {
		await build(R.results);
		await reportDetail.run();
		await expect(headers()).toHaveText(R.results.headings);
		// The view also lists the superseded first card (117/150), with no status column to filter it out (5fy).
		const current = rows().filter({ has: page.getByRole("cell", { name: RC.republished.grade, exact: true }) });
		await expect(current).toHaveCount(1);
		await expect(current.getByRole("cell")).toHaveText([E.name, student.name, student.className, String(RC.republished.total), String(RC.republished.max), RC.republished.percentage, RC.republished.grade]);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, completedPhase: 13, reports: [R.register.name, R.attendance.name, R.results.name] });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
