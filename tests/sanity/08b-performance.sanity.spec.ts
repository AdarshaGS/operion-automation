// Sanity phase 08b - the optional Performance feature, UI only. Continues on the business from phases 01-08.
// Performance is a feature the platform operator switches on per school (it is off until then), so the story
// starts in the platform console: the operator turns it on in a separate browser, then the owner finds it in the
// menu, chooses which metrics the school tracks, opens an appraisal cycle, and reviews the teacher from phase 04:
// a manager rating, a goal, the dashboard cards and charts, and finally closing the cycle so the appraisal is final.
// The school has no staff attendance yet (the Attendance phase comes later), so the teacher honestly has no score:
// the screens must show a dash and "no scored reviews yet", never a zero.
// Numbered 08b so it runs after Timetable and before Attendance without renumbering the planned phases.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, sanityStaff, SANITY_PERFORMANCE as P } from "../../src/sanity/business";
import { PlatformLoginPage } from "../../src/pages/platform/PlatformLoginPage";
import { PlatformOrganisationsPage } from "../../src/pages/platform/PlatformOrganisationsPage";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../src/config/env";
import { EMPTY_STORAGE } from "../../src/ui/session";

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-08",
	notYet: "Menu › Performance is not offered before the platform operator switches it on",
	operatorOn: "Platform console › the operator switches Performance on for this school",
	menu: "Menu › Performance now appears and opens with an invitation to create the first cycle",
	metrics: "Metrics › the school chooses what to measure: Punctuality and Presence, with weights",
	createCycle: "Cycle › create the appraisal cycle for the term",
	overview: "Overview › the teacher from phase 04 is listed as Pending and the cards say so",
	appraisal: "Appraisal › the teacher's page shows HR details and honestly says there is no attendance yet",
	rate: "Appraisal › the owner gives a manager rating with a comment",
	goal: "Appraisal › a goal is set and marked partly achieved",
	afterReview: "Overview › the cards move: Pending 0, Completed 1, and the average stays a dash",
	insights: "Insights › the rating and goal charts reflect what was entered; attendance says none recorded",
	cycles: "Cycles › progress reads 1 of 1; closing the cycle finalises the appraisal",
	finalized: "Appraisal › after closing, the review is Finalized and can no longer be edited",
	handoff: "Hand-off › the appraisal outcome is saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 08b: performance - the operator enables it, the owner reviews the teacher through one cycle", async ({
	page, browser, diagnostics, loginPage, performance,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(8);
	const { teacher } = sanityStaff(business.slug);
	const teacherName = `${teacher.firstName} ${teacher.lastName}`;

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.notYet, async () => {
		await expect(page.getByRole("button", { name: "Performance", exact: true })).toHaveCount(0);
		await page.goto("/performance");
		await expect(page.getByRole("table", { name: "Staff performance" })).toHaveCount(0);
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
		await expect(organisations.moduleSwitch("Performance")).not.toBeChecked();
		await organisations.moduleSwitch("Performance").click();
		await expect(organisations.moduleSwitch("Performance")).toBeChecked();
		await operator.reload();
		await expect(organisations.moduleSwitch("Performance")).toBeChecked();
		await platformLogin.signOut();
		await context.close();
	});

	await j.step(S.menu, async () => {
		await page.goto("/dashboard");
		await expect(page.getByRole("button", { name: "Performance", exact: true })).toBeVisible();
		await performance.open();
		await expect(page.getByText("Manage staff appraisals, review progress, and performance goals.")).toBeVisible();
		await expect(page.getByText("No appraisal cycles yet")).toBeVisible();
	});

	await j.step(S.metrics, async () => {
		await performance.tab("Metrics");
		for (const m of P.metrics) {
			await performance.configureMetric(m.label, { enabled: true, weight: m.weight, target: m.target });
			await expect(page.getByText(`${m.label} saved`)).toBeVisible();
		}
	});

	await j.step(S.createCycle, async () => {
		await performance.createCycle({ name: P.cycleName, startDate: isoDaysAgo(60), endDate: isoDaysAgo(0) });
		await expect(performance.dialog()).toHaveCount(0);
		await performance.tab("Appraisal cycles");
		await expect(performance.row(P.cycleName)).toContainText("Open");
	});

	await j.step(S.overview, async () => {
		await performance.tab("Overview");
		await expect(page.getByRole("combobox", { name: "Appraisal cycle" })).toContainText(P.cycleName);
		expect(await performance.cardValue("Total staff")).toBe("1");
		expect(await performance.cardValue("Pending reviews")).toBe("1");
		expect(await performance.cardValue("Completed reviews")).toBe("0");
		expect(await performance.cardValue("Average performance")).toBe("—");
		const row = performance.row(teacherName);
		await expect(row).toContainText(teacher.employeeCode);
		await expect(row).toContainText(teacher.designation);
		await expect(row).toContainText("Pending");
	});

	await j.step(S.appraisal, async () => {
		await performance.openAppraisal(teacherName, P.cycleName);
		await expect(page.getByText("Staff information")).toBeVisible();
		await expect(page.getByText(teacher.employeeCode).first()).toBeVisible();
		await expect(page.getByText(`No attendance has been recorded for ${teacherName}`)).toBeVisible();
		await expect(page.getByText("Provisional")).toBeVisible();
		await expect(page.getByRole("button", { name: "Rate now" })).toBeVisible();
	});

	await j.step(S.rate, async () => {
		await performance.rate({ as: "Manager", rating: P.rating.value, comment: P.rating.comment });
		await expect(page.getByText("Rating saved.")).toBeVisible();
		await expect(page.getByText(`${P.rating.value}/5`)).toBeVisible();
		await expect(page.getByText(`${P.rating.value}.0 / 5`)).toBeVisible();
		await expect(page.getByRole("button", { name: "Revise rating" })).toBeVisible();
	});

	await j.step(S.goal, async () => {
		await performance.addGoal(P.goal.title, P.goal.details);
		await expect(page.getByRole("group", { name: P.goal.title })).toBeVisible();
		await performance.markGoal(P.goal.title, "Partly achieved");
		await expect(page.getByRole("group", { name: P.goal.title })).toContainText("Partly achieved");
	});

	await j.step(S.afterReview, async () => {
		await performance.backToPerformance();
		expect(await performance.cardValue("Pending reviews")).toBe("0");
		expect(await performance.cardValue("Completed reviews")).toBe("1");
		expect(await performance.cardValue("Average performance")).toBe("—");
		await expect(page.getByText("no scored reviews yet")).toBeVisible();
		await expect(page.getByText("all caught up")).toBeVisible();
		await expect(performance.row(teacherName)).toContainText("Reviewed");
		await expect(performance.row(teacherName)).not.toContainText("0.0%");
	});

	await j.step(S.insights, async () => {
		await performance.tab("Insights");
		await expect(page.getByRole("img", { name: new RegExp(`^Manager ratings:.*1 rated ${P.rating.value}`) })).toBeVisible();
		await expect(page.getByRole("img", { name: /1 partly achieved/ })).toBeVisible();
		await expect(page.getByText("No staff attendance has been recorded within this cycle's dates.")).toBeVisible();
	});

	await j.step(S.cycles, async () => {
		await performance.tab("Appraisal cycles");
		await expect(performance.row(P.cycleName)).toContainText("1 of 1");
		await performance.closeCycle(P.cycleName);
		await expect(performance.row(P.cycleName)).toContainText("Closed");
		await expect(performance.row(P.cycleName).getByRole("button", { name: "Close cycle" })).toHaveCount(0);
	});

	await j.step(S.finalized, async () => {
		await performance.tab("Overview");
		await expect(performance.row(teacherName)).toContainText("Finalized");
		await performance.openAppraisal(teacherName, P.cycleName);
		await expect(page.getByText("Cycle closed", { exact: true }).first()).toBeVisible();
		await expect(page.getByRole("button", { name: /^(Save|Update) rating$/ })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Add goal" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			performance: { cycleName: P.cycleName, teacher: teacherName, managerRating: P.rating.value, goal: P.goal.title, closed: true },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
