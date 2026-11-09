// Teacher performance screens (/performance, and "My performance" on /learning). IDs refer to docs/SCENARIOS.md
// section 26 (PERF-U*). Teachers are created with unique names, so their rows are found in the shared scorecard.
// The metric and self-view settings are organisation-wide, so the file runs serially and every test starts by
// stopping all tracked metrics.

import { test, expect } from "../../../src/sanity/fixtures";
import { PERFORMANCE, createCycle, daysAgo, markStaff, performanceOn, poolIn, resetMetrics, setSelfView, teacher, trackMetric } from "../../../src/api/performance";
import { uniqueSuffix } from "../../../src/api/data";
import { assignTeacher } from "../../../src/api/learning";
import { storageStateFor } from "../../../src/ui/session";
import { createDisposableUser, type OrgContext } from "../../../src/api/users";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { enableModule, login } from "../../../src/setup/provisioning";
import { UI_BASE_URL } from "../../../src/config/env";
import { LearningPage } from "../../../src/pages/learning/LearningPage";
import { MyPerformancePanel, PerformancePage } from "../../../src/pages/performance/PerformancePage";
import type { ApiClient } from "../../../src/api/apiClient";
import type { Browser } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ api, seed }) => {
	await performanceOn(seed);
	await resetMetrics(api);
	await setSelfView(api, false);
});

async function signedInAs(api: ApiClient, anon: ApiClient, seed: OrgContext, browser: Browser, permissions: string[], teaches?: { sectionId: number; subjectId: number }) {
	const user = await createDisposableUser(api, anon, seed, permissions);
	if (teaches) await assignTeacher(api, teaches.sectionId, teaches.subjectId, user.personId);
	const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } })).expectStatus(200);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
	const page = await context.newPage();
	return { user, page, context, performance: new PerformancePage(page), mine: new MyPerformancePanel(page), learning: new LearningPage(page) };
}

test.describe("PERF-U01 metrics", () => {
	test("PERF-U01 nothing is tracked until the Metrics tab switches a metric on, and the choice is kept after a reload", async ({ api, performance, page }) => {
		await performance.open("Scorecard");
		await expect(page.getByText("No metrics are being tracked yet")).toBeVisible();

		await performance.tab("Metrics");
		await performance.configureMetric("Punctuality", { enabled: true, weight: 3, target: 90 });
		await expect(page.getByText("Punctuality saved")).toBeVisible();

		await page.reload();
		await performance.tab("Metrics");
		const row = performance.row("Punctuality").first();
		await expect(row.getByRole("switch")).toBeChecked();
		await expect(row.getByRole("spinbutton").nth(0)).toHaveValue("3");
		await expect(row.getByRole("spinbutton").nth(1)).toHaveValue("90");
		(await api.get(`${PERFORMANCE}/metrics`)).expectJson((list) => expect(list.find((m: { metric: string }) => m.metric === "STAFF_PUNCTUALITY")).toMatchObject({ enabled: true, weight: 3, target: 90 }));
	});

	test("PERF-U01 a weight of 0 is refused with a message on the screen", async ({ performance, page }) => {
		await performance.open();
		await performance.tab("Metrics");
		await performance.configureMetric("Presence", { enabled: true, weight: 0 });
		await expect(page.getByRole("alert").filter({ hasText: /weight/i })).toBeVisible();
		await expect(page.getByText("Presence saved")).toHaveCount(0);
	});

	test("PERF-U01 only the metrics that need it offer a days field, and an outcome metric has no target", async ({ performance, page }) => {
		await performance.open();
		await performance.tab("Metrics");
		await expect(performance.row("Marks entered on time").first().getByRole("spinbutton")).toHaveCount(3);
		await expect(performance.row("Punctuality").first().getByRole("spinbutton")).toHaveCount(2);
		const outcome = performance.row("Pass rate").first();
		await expect(outcome.getByRole("spinbutton")).toHaveCount(1);
		await expect(outcome).toContainText("vs previous period");
		await expect(page.getByRole("switch", { name: "Teachers can see their own scorecard and appraisal" })).toBeVisible();
	});
});

test.describe("PERF-U02 scorecard", () => {
	test("PERF-U02 punctuality is scored from staff attendance, and a teacher with no records shows a dash", async ({ api, performance }) => {
		const busy = await teacher(api);
		const idle = await teacher(api, busy.pool);
		await markStaff(api, busy, [[1, "PRESENT"], [2, "LATE"], [3, "PRESENT"], [4, "PRESENT"]]);
		await trackMetric(api, "STAFF_PUNCTUALITY");

		await performance.open("Scorecard");
		await expect(performance.row(busy.name)).toContainText("75.0%");
		await expect(performance.row(busy.name)).toContainText("75");
		await expect(performance.row(idle.name)).not.toContainText("%");
		await expect(performance.row(idle.name)).toContainText("—");
	});

	test("PERF-U02 changing the period changes the numbers", async ({ api, performance }) => {
		const t = await teacher(api);
		await markStaff(api, t, [[2, "LATE"], [3, "PRESENT"]]);
		await trackMetric(api, "STAFF_PUNCTUALITY");

		await performance.open("Scorecard");
		await expect(performance.row(t.name)).toContainText("50.0%");
		await performance.setPeriod(daysAgo(1), daysAgo(0));
		await expect(performance.row(t.name)).not.toContainText("50.0%");
	});
});

test.describe("PERF-U03 appraisal cycles", () => {
	test("PERF-U03 a cycle is created from the form, listed as Open, and closed", async ({ performance }) => {
		const name = `UI Cycle ${uniqueSuffix()}`;
		await performance.open("Appraisal cycles");
		await performance.createCycle({ name, startDate: daysAgo(30), endDate: daysAgo(0) });
		await expect(performance.row(name)).toContainText("Open");

		await performance.closeCycle(name);
		await expect(performance.row(name)).toContainText("Closed");
		await expect(performance.row(name).getByRole("button", { name: "Close cycle" })).toHaveCount(0);
	});

	test("PERF-U03 a second cycle with the same name is refused", async ({ api, performance, page }) => {
		const cycle = await createCycle(api);
		await performance.open("Appraisal cycles");
		await performance.createCycle({ name: cycle.name, startDate: daysAgo(30), endDate: daysAgo(0) });
		await expect(performance.dialog().getByRole("alert").filter({ hasText: /already|exists|duplicate/i })).toBeVisible();
		await performance.cancelDialog();
		await expect(performance.row(cycle.name)).toHaveCount(1);
	});
});

test.describe("PERF-U04 staff appraisal page", () => {
	test("PERF-U04 a manager rating and a goal are saved on the teacher's appraisal and survive reopening", async ({ api, performance }) => {
		const t = await teacher(api);
		const cycle = await createCycle(api);
		await trackMetric(api, "STAFF_PUNCTUALITY");
		await markStaff(api, t, [[1, "PRESENT"], [2, "PRESENT"]]);

		await performance.open();
		await performance.openAppraisal(t.name, cycle.name);
		await expect(performance.detail().getByText("No ratings have been recorded for this cycle yet.")).toBeVisible();
		await performance.rate({ as: "Manager", rating: 4, comment: "Great with parents" });
		await expect(performance.detail()).toContainText("4/5");
		await expect(performance.detail()).toContainText("Great with parents");

		await performance.addGoal("Run a remedial class", "Fridays after school");
		await expect(performance.detail()).toContainText("Run a remedial class");
		await performance.markGoal("Run a remedial class", "Achieved");
		await expect(performance.detail().getByRole("group", { name: "Run a remedial class" })).toContainText("Achieved");
		await performance.backToPerformance();

		await performance.openAppraisal(t.name, cycle.name);
		await expect(performance.detail()).toContainText("Great with parents");
		await expect(performance.detail().getByRole("group", { name: "Run a remedial class" })).toContainText("Achieved");
		(await api.get(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}`, { params: { cycleId: cycle.id, personId: t.personId } })).expectJson((a) => {
			expect(a.feedback).toHaveLength(1);
			expect(a.goals[0]).toMatchObject({ title: "Run a remedial class", status: "ACHIEVED" });
		});
	});

	test("PERF-U04 a scorecard row opens that teacher's appraisal page, and the staff list can be searched by name", async ({ api, performance, page }) => {
		const t = await teacher(api);
		const cycle = await createCycle(api);
		await trackMetric(api, "STAFF_PRESENCE");
		await markStaff(api, t, [[1, "PRESENT"], [2, "ABSENT"]]);

		await performance.open("Scorecard");
		await performance.openAppraisalFromScorecard(t.name);
		await expect(page).toHaveURL(new RegExp(`/performance/staff/${t.personId}`));
		await expect(performance.detail()).toContainText("Performance evaluation");
		await expect(performance.detail()).toContainText("Staff presence");
		await performance.backToPerformance();

		await performance.chooseCycle(cycle.name);
		await page.getByRole("textbox", { name: "Search staff" }).fill(t.name);
		await expect(performance.row(t.name)).toHaveCount(1);
		await expect(performance.row(t.name)).toContainText("50.0%");
	});

	test("PERF-U04 rating the same teacher again replaces the earlier rating instead of adding one", async ({ api, performance }) => {
		const t = await teacher(api);
		const cycle = await createCycle(api);
		await trackMetric(api, "STAFF_PRESENCE");
		await performance.open();
		await performance.openAppraisal(t.name, cycle.name);
		await performance.rate({ as: "Manager", rating: 5, comment: "First impression" });
		await expect(performance.detail()).toContainText("First impression");
		await performance.rate({ as: "Manager", rating: 2, comment: "After the term" });
		await expect(performance.detail()).toContainText("2/5");
		await expect(performance.detail()).not.toContainText("5/5");
		await expect(performance.detail().getByText("First impression")).toHaveCount(0);
	});

	test("PERF-U04 a closed cycle is read-only: no rating form and no goal form", async ({ api, performance }) => {
		const t = await teacher(api);
		const cycle = await createCycle(api);
		await trackMetric(api, "STAFF_PRESENCE");
		(await api.post(`${PERFORMANCE}/cycles/{id}/close`, { params: { id: cycle.id } })).expectStatus(200);
		await performance.open();
		await performance.openAppraisal(t.name, cycle.name);
		await expect(performance.detail().getByText("Cycle closed", { exact: true }).first()).toBeVisible();
		await expect(performance.detail().getByRole("button", { name: /^(Save|Update) rating$/ })).toHaveCount(0);
		await expect(performance.detail().getByRole("button", { name: "Add goal" })).toHaveCount(0);
	});
});

test.describe("PERF-U05 teacher self-view", () => {
	test("PERF-U05 the switch on the Metrics tab decides whether a teacher gets a My performance tab", async ({ api, anon, seed, browser, performance }) => {
		// "My performance" lives on the Learning page, which is off by default for an organisation.
		await enableModule((await login(seed.organisationSlug, seed.ownerEmail, seed.ownerPassword)).organisationId, "LEARNING");
		const pool = await poolIn(api);
		const me = await signedInAs(api, anon, seed, browser, [], pool.pairs.shift());

		// Off: the teacher's learning page offers no My performance tab.
		const refused = me.page.waitForResponse((r) => r.url().includes("/performance/me/scorecard"));
		await me.learning.open();
		expect((await refused).status()).toBe(403);
		await expect(me.mine.tab()).toHaveCount(0);

		// The administrator switches it on in the UI.
		await performance.open();
		await performance.tab("Metrics");
		await performance.selfViewSwitch().click();
		await expect(performance.selfViewSwitch()).toBeChecked();
		(await api.get(`${PERFORMANCE}/settings`)).expectJson((s) => expect(s.teacherSelfView).toBe(true));

		const allowed = me.page.waitForResponse((r) => r.url().includes("/performance/me/scorecard"));
		await me.page.reload();
		expect((await allowed).status()).toBe(200);
		await expect(me.mine.tab()).toBeVisible();
		await me.context.close();
	});

	test("PERF-U05 a teacher sees their own scorecard, writes a self-appraisal and a goal, and sees the manager's rating only after the cycle closes", async ({ api, anon, seed, browser, performance }) => {
		await setSelfView(api, true);
		await trackMetric(api, "STAFF_PRESENCE");
		const pool = await poolIn(api);
		const me = await signedInAs(api, anon, seed, browser, [], pool.pairs.shift());
		const person = (await api.get("/api/v1/persons/{id}", { params: { id: me.user.personId } })).expectStatus(200).body;
		const myName = `${person.firstName} ${person.lastName}`;
		await markStaff(api, { personId: me.user.personId, campusId: seed.campusId }, [[1, "PRESENT"], [2, "PRESENT"], [3, "ABSENT"], [4, "PRESENT"]]);
		const cycle = await createCycle(api);

		// The administrator rates this teacher (a manager rating) while the cycle is open.
		await performance.open();
		await performance.openAppraisal(myName, cycle.name);
		await performance.rate({ as: "Manager", rating: 5, comment: "Excellent term" });
		await expect(performance.detail()).toContainText("Excellent term");
		await performance.backToPerformance();

		// The teacher: own scorecard, then a self-appraisal and a goal. The manager's rating stays hidden while the cycle is open.
		await me.learning.open();
		await me.mine.open();
		await expect(me.page.getByRole("row").filter({ hasText: "75.0%" }).first()).toBeVisible();
		await me.mine.chooseCycle(cycle.name);
		await expect(me.page.getByText("Excellent term")).toHaveCount(0);
		await me.mine.selfAppraise(4, "Steady term");
		await expect(me.page.getByText("Steady term")).toBeVisible();
		await me.mine.addGoal("Improve homework turnaround");
		await expect(me.page.getByRole("group", { name: "Improve homework turnaround" })).toBeVisible();

		// The administrator sees the self-appraisal next to their own rating.
		await performance.openAppraisal(myName, cycle.name);
		await expect(performance.detail()).toContainText("Self-appraisal");
		await expect(performance.detail()).toContainText("Steady term");
		await expect(performance.detail()).toContainText("Improve homework turnaround");
		await performance.backToPerformance();

		// Once the cycle is closed the teacher sees the manager's rating too.
		(await api.post(`${PERFORMANCE}/cycles/{id}/close`, { params: { id: cycle.id } })).expectStatus(200);
		await me.page.reload();
		await me.mine.open();
		await me.mine.chooseCycle(cycle.name);
		await expect(me.page.getByText("Excellent term")).toBeVisible();
		await expect(me.page.getByRole("button", { name: "Save self-appraisal" })).toHaveCount(0);
		await me.context.close();
	});
});

test.describe("PERF-U06 view-only access", () => {
	test("PERF-U06 a user with only KPI_VIEW reads the scorecard and cycles but cannot manage metrics, create cycles or rate", async ({ api, anon, seed, browser }) => {
		const t = await teacher(api);
		const cycle = await createCycle(api);
		await trackMetric(api, "STAFF_PRESENCE");
		await markStaff(api, t, [[1, "PRESENT"]]);
		const viewer = await signedInAs(api, anon, seed, browser, ["KPI_VIEW"]);

		await viewer.performance.open("Scorecard");
		await expect(viewer.performance.row(t.name)).toBeVisible();
		await expect(viewer.page.getByRole("tab", { name: "Metrics" })).toHaveCount(0);
		await viewer.performance.tab("Appraisal cycles");
		await expect(viewer.performance.row(cycle.name)).toBeVisible();
		await expect(viewer.page.getByRole("button", { name: "Create appraisal cycle" })).toHaveCount(0);
		await expect(viewer.page.getByRole("button", { name: "Close cycle" })).toHaveCount(0);

		await viewer.performance.tab("Overview");
		await viewer.performance.openAppraisal(t.name, cycle.name);
		await expect(viewer.performance.detail().getByRole("button", { name: /^(Save|Update) rating$/ })).toHaveCount(0);
		await expect(viewer.performance.detail().getByRole("button", { name: "Add goal" })).toHaveCount(0);
		await viewer.context.close();
	});
});
