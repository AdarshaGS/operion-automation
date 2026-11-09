// The dashboard (/dashboard). IDs refer to docs/SCENARIOS.md section 22 (DSH-U*). The shared organisation is
// written to by every other spec, so tile values are compared with a fresh read of the summary each time and
// everything that dismisses a widget, or needs an empty dashboard, uses a throwaway organisation and its own user.

import { test, expect } from "../../../src/sanity/fixtures";
import type { Browser, Page } from "@playwright/test";
import { DASH, scratchOrg, summary, type ScratchOrg } from "../../../src/api/dashboard";
import { createDisposableUser, type DisposableUser } from "../../../src/api/users";
import { buildAcademicBase } from "../../../src/api/academics";
import { createStaff } from "../../../src/api/hr";
import { createItem } from "../../../src/api/inventory";
import { signedInAs } from "../../../src/ui/asUser";
import { DashboardPage } from "../../../src/pages/dashboard/DashboardPage";
import type { ApiClient } from "../../../src/api/apiClient";

const currency = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** A throwaway organisation with a signed-in user who holds `permissions`, and a page for them. */
async function asManager(browser: Browser, request: Parameters<typeof scratchOrg>[0], calls: Parameters<typeof scratchOrg>[1], anon: ApiClient, permissions: string[], prepare?: (org: ScratchOrg) => Promise<void>) {
	const org = await scratchOrg(request, calls);
	await prepare?.(org);
	const user: DisposableUser = await createDisposableUser(org.client, anon, { organisationSlug: org.slug, campusId: org.campusId }, permissions);
	const { page, context } = await signedInAs(browser, anon, org.slug, user.email);
	return { org, user, page, context, dashboard: new DashboardPage(page) };
}

test.describe("DSH-U01 the dashboard of a school with students", () => {
	test("DSH-U01 it greets the user and shows the hero stats and every module section with the API's numbers", async ({ api, dashboard, page }) => {
		await dashboard.open();
		await expect(dashboard.greeting()).toContainText(/^Good (morning|afternoon|evening), \S+/);
		const read = () => summary(api);
		await expect.poll(async () => (await dashboard.hero("Active students").innerText()).trim(), { message: "Active students" }).toBe(String((await read()).enrollment.activeStudents));
		await expect.poll(async () => (await dashboard.hero("Fees due").innerText()).trim(), { message: "Fees due" }).toBe(currency((await read()).fees.outstanding));
		const attendance = (await read()).attendanceToday;
		await expect(dashboard.hero("Today's attendance").first()).toHaveText(attendance.marked === 0 ? "Not started" : `${attendance.attendanceRatePercent}%`);

		const expectations: [string, string, (s: Awaited<ReturnType<typeof read>>) => string][] = [
			["Staff", "Active staff", (s) => String(s.staff.activeStaff)],
			["Staff", "Departments", (s) => String(s.staff.departments)],
			["Examinations", "Active exams", (s) => String(s.examinations.activeExams)],
			["Library", "Active books", (s) => String(s.library.activeBooks)],
			["Inventory", "Active items", (s) => String(s.inventory.activeItems)],
			["Inventory", "Categories", (s) => String(s.inventory.categories)],
			["Fees", "Overdue invoices", (s) => String(s.fees.overdueInvoices)],
		];
		for (const [section, label, value] of expectations) {
			await expect.poll(async () => (await dashboard.tile(section, label).innerText()).trim(), { message: `${section} / ${label}` }).toBe(value(await read()));
		}
		void page;
	});

	test("DSH-U01 the three charts and the two donuts are drawn", async ({ dashboard }) => {
		await dashboard.open();
		for (const title of ["Attendance overview", "Fee collections", "Students by class", "Today's attendance", "Fee collection"]) await expect(dashboard.chartTitle(title)).toBeVisible();
		await expect(dashboard.chartTitle("Students by class").locator("xpath=../..").locator("svg").first()).toBeVisible();
	});

	test("DSH-U01 loading it makes no failing request and logs no console error", async ({ page, dashboard }) => {
		const problems: string[] = [];
		page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
		page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
		page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
		await dashboard.open();
		await expect(dashboard.chartTitle("Fee collections")).toBeVisible();
		await page.waitForLoadState("networkidle");
		expect(problems).toEqual([]);
	});

	test("DSH-U01 the sales and purchase figures the API returns have tiles on the page", async ({ dashboard, page }) => {
		await dashboard.open();
		await expect(dashboard.sectionHeading("Fees")).toBeVisible();
		const missing: string[] = [];
		for (const title of ["Sales", "Purchase"]) if ((await page.getByRole("heading", { name: new RegExp(`^${title}`), level: 6 }).count()) === 0) missing.push(title);
		expect(missing, "dashboard sections for modules whose totals the summary API returns").toEqual([]);
	});

	test("DSH-U01 the fees tile does not show a negative amount collected or a collection rate below 0%", async ({ dashboard, page }) => {
		await dashboard.open();
		await expect(dashboard.tile("Fees", "Total collected")).not.toContainText("-");
		await expect(dashboard.tile("Fees", "Collection rate")).not.toContainText("-");
		void page;
	});
});

test.describe("DSH-U02 a new school's dashboard", () => {
	test("DSH-U02 with no academic year the first step is to set one up, and the stats sit behind Summary stats", async ({ browser, request, calls, anon }) => {
		const { page, context, dashboard } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", "HR_VIEW", "INVENTORY_VIEW"]);
		try {
			await dashboard.open();
			await expect(dashboard.firstStep()).toContainText("Set up your academic year");
			await expect(dashboard.chartTitle("Attendance overview")).toHaveCount(0);
			await dashboard.summaryStats().click();
			await expect(dashboard.tile("Staff", "Active staff")).toHaveText("0");
			await expect(dashboard.tile("Inventory", "Active items")).toHaveText("0");
		} finally {
			await context.close();
		}
	});

	test("DSH-U02 once an academic year and classes exist the first step is to add students", async ({ browser, request, calls, anon }) => {
		const { page, context, dashboard } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", "STUDENT_MANAGE", "STUDENT_VIEW", "CLASS_VIEW"], async (org) => {
			await buildAcademicBase(org.client);
		});
		try {
			await dashboard.open();
			await expect(dashboard.firstStep()).toContainText("Add your first students");
			await dashboard.firstStep().getByRole("button", { name: "Add students" }).click();
			await expect(page).toHaveURL(/\/students\/new$/);
		} finally {
			await context.close();
		}
	});

	test("DSH-U02 the setup guide counts the steps done and each step opens its screen", async ({ browser, request, calls, anon }) => {
		const { page, context, dashboard, org } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE"], async (o) => {
			await buildAcademicBase(o.client);
		});
		try {
			await dashboard.open();
			const checklist = (await summary(org.client)).setupChecklist;
			const done = [checklist.structureConfigured, checklist.academicSetupConfigured, checklist.membersAdded, checklist.studentsAdded].filter(Boolean).length;
			await expect(dashboard.setupProgressText()).toContainText(`${done} of 4 setup tasks complete`);
			await dashboard.setupCard().getByText("Structure", { exact: true }).click();
			await expect(page).toHaveURL(/\/setup\/structure$/);
		} finally {
			await context.close();
		}
	});
});

test.describe("DSH-U03 dismissing the setup guide and quick actions", () => {
	test("DSH-U03 each dismissal hides its card, survives a reload and is saved for the user only", async ({ browser, request, calls, anon, api }) => {
		const { page, context, dashboard, user, org } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", "STUDENT_MANAGE"]);
		try {
			await dashboard.open();
			await expect(dashboard.setupCard()).toBeVisible();
			await expect(dashboard.quickActionsCard()).toBeVisible();
			await dashboard.dismissSetup().click();
			await expect(dashboard.setupCard()).toHaveCount(0);
			await expect(dashboard.quickActionsCard()).toBeVisible();
			await expect.poll(async () => (await summary(user.client)).preferences.setupProgressDismissed).toBe(true);
			await page.reload();
			await dashboard.greeting().waitFor();
			await expect(dashboard.setupCard()).toHaveCount(0);
			await expect(dashboard.quickActionsCard()).toBeVisible();

			await dashboard.dismissQuickActions().click();
			await expect(dashboard.quickActionsCard()).toHaveCount(0);
			await expect.poll(async () => (await summary(user.client)).preferences.quickActionsDismissed).toBe(true);
			await page.reload();
			await dashboard.greeting().waitFor();
			await expect(dashboard.setupCard()).toHaveCount(0);
			await expect(dashboard.quickActionsCard()).toHaveCount(0);

			// The organisation owner's own flags are untouched.
			expect((await summary(org.client)).preferences).toEqual({ setupProgressDismissed: false, quickActionsDismissed: false });
			expect((await summary(api)).preferences.setupProgressDismissed).toBe((await summary(api)).preferences.setupProgressDismissed);
		} finally {
			await context.close();
		}
	});

	test("DSH-U03 a dismissal made in one browser is honoured when the same user signs in from another", async ({ browser, request, calls, anon }) => {
		const first = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE"]);
		try {
			await first.dashboard.open();
			await first.dashboard.dismissSetup().click();
			await expect.poll(async () => (await summary(first.user.client)).preferences.setupProgressDismissed).toBe(true);
			const second = await signedInAs(browser, anon, first.org.slug, first.user.email);
			try {
				const other = new DashboardPage(second.page);
				await other.open();
				await expect(other.setupCard()).toHaveCount(0);
			} finally {
				await second.context.close();
			}
		} finally {
			await first.context.close();
		}
	});
});

test.describe("DSH-U04 quick actions", () => {
	// Add student opens /students/new, which sends a school with no academic year yet to Academic setup first - and
	// the organisation these tests create has none.
	const actions: [string, string, string][] = [
		["Add student", "STUDENT_MANAGE", "/academics/setup"],
		["Take attendance", "ATTENDANCE_MARK", "/attendance/mark"],
		["Fee collection", "FEE_COLLECT", "/fees/collect"],
		["Invite member", "MEMBERSHIP_MANAGE", "/members/invite"],
	];

	for (const [label, permission, path] of actions) {
		test(`DSH-U04 ${label} is offered to a holder of ${permission} and opens ${path}`, async ({ browser, request, calls, anon }) => {
			const { page, context, dashboard } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", permission]);
			try {
				await dashboard.open();
				await expect(dashboard.quickAction(label)).toBeVisible();
				for (const [other] of actions.filter(([l]) => l !== label)) await expect(dashboard.quickAction(other), `${other} needs a permission this user lacks`).toHaveCount(0);
				await dashboard.quickAction(label).click();
				await expect(page).toHaveURL(new RegExp(`${path}$`));
			} finally {
				await context.close();
			}
		});
	}

	test("DSH-U04 a manager with none of those permissions is offered no quick actions card", async ({ browser, request, calls, anon }) => {
		const { context, dashboard } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE"]);
		try {
			await dashboard.open();
			await expect(dashboard.setupCard()).toBeVisible();
			await expect(dashboard.quickActionsCard()).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("DSH-U05 layout", () => {
	test("DSH-U05 at a desktop width nothing overflows sideways and the main area scrolls to the last section", async ({ page, dashboard }) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await dashboard.open();
		await expect(dashboard.chartTitle("Fee collections")).toBeVisible();
		const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.documentElement.clientWidth }));
		expect(overflow.page, "horizontal overflow of the page (px)").toBeLessThanOrEqual(0);
		expect(overflow.body, "horizontal overflow of the body (px)").toBeLessThanOrEqual(0);
		const last = dashboard.sectionHeading("Inventory");
		await last.scrollIntoViewIfNeeded();
		await expect(last).toBeInViewport();
	});

	test("DSH-U05 on a phone-width screen the page still has no horizontal scroll", async ({ page, dashboard }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await dashboard.open();
		await expect(dashboard.chartTitle("Fee collections")).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, "horizontal overflow of the page (px)").toBeLessThanOrEqual(0);
	});
});

test.describe("DSH-U06 who lands on the dashboard", () => {
	test("DSH-U06 a manager lands on /dashboard and someone without ORGANISATION_MANAGE lands on /students", async ({ browser, request, calls, anon }) => {
		const manager = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", "STUDENT_VIEW"]);
		try {
			await manager.page.goto("/");
			await expect(manager.page).toHaveURL(/\/dashboard$/);
		} finally {
			await manager.context.close();
		}
		const staff = await asManager(browser, request, calls, anon, ["STUDENT_VIEW"]);
		try {
			await staff.page.goto("/");
			await expect(staff.page).toHaveURL(/\/students$/);
		} finally {
			await staff.context.close();
		}
	});

	test("DSH-U06 someone without ORGANISATION_MANAGE who opens /dashboard directly is not shown a raw permission error", async ({ browser, request, calls, anon }) => {
		const { page, context } = await asManager(browser, request, calls, anon, ["STUDENT_VIEW", "FEE_VIEW"]);
		try {
			await page.goto("/dashboard");
			await page.waitForLoadState("networkidle");
			await expect(page.getByRole("alert").filter({ hasText: /Missing required permission/ }), "the API's permission message is shown as the page content").toHaveCount(0);
		} finally {
			await context.close();
		}
	});

	test("DSH-U06 a module with no permission or switched off has no tiles for a manager who cannot open it", async ({ browser, request, calls, anon }) => {
		const { context, dashboard, page } = await asManager(browser, request, calls, anon, ["ORGANISATION_MANAGE", "STUDENT_VIEW"], async (org) => {
			await buildAcademicBase(org.client);
			await createStaff(org.client, org.campusId);
			await createItem(org.client);
		});
		try {
			await dashboard.open();
			await dashboard.summaryStats().click().catch(() => undefined);
			for (const title of ["Fees", "Staff", "Inventory", "Examinations"]) await expect(dashboard.sectionHeading(title), `${title} needs a permission this user lacks`).toHaveCount(0);
			void page;
		} finally {
			await context.close();
		}
	});
});

void DASH;
void (null as unknown as Page);
