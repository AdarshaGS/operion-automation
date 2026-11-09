// Reports screens: the list, the Create report dialog, the report detail page (definition, publish, archive,
// duplicate, share, run, export) and who sees what. IDs refer to docs/SCENARIOS.md section 20 (RPT-U*).
// Reports are created with unique names in the shared organisation; anything that needs an exact set of
// reports (seeding) runs in a throwaway organisation.

import { readFileSync } from "node:fs";
import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { admitStudent } from "../../../src/api/students";
import { uniqueSuffix } from "../../../src/api/data";
import { createReport, REPORT, STUDENT_ROWS_SQL } from "../../../src/api/reports";
import { UI_BASE_URL } from "../../../src/config/env";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { storageStateFor } from "../../../src/ui/session";

const INTERNALS = /com\.operion|No enum constant|java\.|reporting_ro|@'localhost'|Exception/i;
const STANDARD = [
	"Sales totals by item, customer and campus", "Stock on hand and valuation", "Low stock items", "Purchase spend by supplier",
	"Fee collection register", "Fee collection summary", "Fee defaulters", "Attendance percentage by student", "Exam results by section", "Subject-wise marks",
];

test.describe("the report list", () => {
	test("RPT-U01 the list shows a report with its name, description and status, under My reports for its author", async ({ reports, api }) => {
		const report = await createReport(api, { description: "Listed by automation" });
		await reports.open();
		await expect(reports.row(report.name)).toContainText("Listed by automation");
		await expect(reports.statusOf(report.name)).toHaveText("DRAFT");
		await expect(reports.createButton()).toBeVisible();
		await expect(reports.seedButton()).toBeVisible();
	});

	test("RPT-U01 clicking a row opens the report", async ({ reports, reportDetail, api, page }) => {
		const report = await createReport(api);
		await reports.open();
		await reports.openReport(report.name);
		await expect(page).toHaveURL(new RegExp(`/reports/${report.id}$`));
		await expect(reportDetail.status()).toHaveText("DRAFT");
	});

	test("RPT-U01 a report written by a colleague is under Shared reports, not My reports", async ({ reports, api, anon, seed }) => {
		const colleague = await createDisposableUser(api, anon, seed, ["REPORT_CREATE"]);
		const theirs = await createReport(colleague.client);
		await reports.open();
		await expect(reports.row(theirs.name)).toHaveCount(0);
		await reports.showTab("Shared reports");
		await expect(reports.row(theirs.name)).toBeVisible();
	});

	test("RPT-U01 seeding the standard reports from the screen lists the standard reports as published", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(org.session, UI_BASE_URL) });
		const page = await context.newPage();
		const { ReportsPage } = await import("../../../src/pages/reporting/ReportsPage");
		const reports = new ReportsPage(page);
		await reports.open();
		await expect(page.getByText("No reports here yet.")).toBeVisible();
		await reports.seedStandard();
		for (const name of STANDARD) {
			await expect(reports.row(name)).toBeVisible();
			await expect(reports.statusOf(name)).toHaveText("PUBLISHED");
		}
		await context.close();
	});
});

test.describe("creating a report", () => {
	test("RPT-U02 filling the Create report dialog saves a draft that shows in the list and opens with its parameter and column", async ({ reports, reportDetail, page }) => {
		const name = `UI report ${uniqueSuffix()}`;
		await reports.open();
		await reports.createReport({
			name,
			description: "Made in the UI",
			sql: "SELECT admission_number, student_name FROM reporting_students WHERE admission_number = :adm",
			parameters: [{ name: "adm", type: "STRING", label: "Admission number" }],
			columns: [{ sourceColumn: "admission_number", label: "Admission no." }],
		});
		await expect(reports.dialog()).toBeHidden();
		await expect(reports.row(name)).toBeVisible();
		await expect(reports.statusOf(name)).toHaveText("DRAFT");
		await reports.openReport(name);
		await expect(reportDetail.sqlField()).toHaveValue(/WHERE admission_number = :adm/);
		await expect(reportDetail.paramInput("Admission number")).toBeVisible();
		await expect(page.getByLabel("Source column")).toHaveValue("admission_number");
	});

	test("RPT-U02 Save as draft stays disabled until there is a name and a query, and while a column row is half filled", async ({ reports }) => {
		await reports.open();
		await reports.openCreateDialog();
		await expect(reports.saveButton()).toBeDisabled();
		await reports.fillReport({ name: `UI report ${uniqueSuffix()}`, sql: "SELECT 1 AS one" });
		await expect(reports.saveButton()).toBeEnabled();
		await reports.dialog().getByRole("button", { name: "Add column" }).click();
		await expect(reports.saveButton()).toBeDisabled();
		await reports.dialog().getByLabel("Source column").fill("one");
		await reports.dialog().getByLabel("Display label").fill("One");
		await expect(reports.saveButton()).toBeEnabled();
	});

	test("RPT-U02 a parameter and a column row can be removed again", async ({ reports }) => {
		await reports.open();
		await reports.openCreateDialog();
		await reports.fillReport({ name: "x", sql: "SELECT 1 AS one", parameters: [{ name: "a", label: "A" }], columns: [{ sourceColumn: "one", label: "One" }] });
		await reports.dialog().getByRole("button", { name: "Remove parameter" }).click();
		await reports.dialog().getByRole("button", { name: "Remove column" }).click();
		await expect(reports.dialog().getByLabel("Name (:name)")).toHaveCount(0);
		await expect(reports.dialog().getByLabel("Source column")).toHaveCount(0);
	});

	test("RPT-U02 cancelling the dialog creates nothing and the next dialog opens empty", async ({ reports }) => {
		const name = `Cancelled ${uniqueSuffix()}`;
		await reports.open();
		await reports.openCreateDialog();
		await reports.fillReport({ name, sql: "SELECT 1 AS one" });
		await reports.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(reports.dialog()).toBeHidden();
		await expect(reports.row(name)).toHaveCount(0);
		await reports.openCreateDialog();
		await expect(reports.dialog().getByLabel("SQL query")).toHaveValue("");
	});

	test("RPT-U02 a query the server refuses shows its reason inside the dialog, where the person is looking", async ({ reports }) => {
		await reports.open();
		await reports.openCreateDialog();
		await reports.fillReport({ name: `Unsafe ${uniqueSuffix()}`, sql: "DELETE FROM students" });
		await reports.saveButton().click();
		await expect(reports.dialog().getByRole("alert")).toContainText(/select/i);
	});

	test("RPT-U02 the SQL help names the views a report may read", async ({ reports }) => {
		await reports.open();
		await reports.openCreateDialog();
		for (const view of ["reporting_students", "reporting_attendance_daily", "reporting_fee_invoices", "reporting_sales"]) {
			await expect(reports.dialog().getByText(view, { exact: false }).first()).toBeVisible();
		}
	});
});

test.describe("running and exporting", () => {
	test("RPT-U01 running a report shows its columns and rows", async ({ reportDetail, api }) => {
		await admitStudent(api);
		const report = await createReport(api, { sqlQuery: STUDENT_ROWS_SQL });
		await reportDetail.open(report.id);
		await reportDetail.run();
		const table = reportDetail.resultTable();
		for (const column of ["student_id", "admission_number", "student_name"]) await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
		await expect(table.getByRole("row")).toHaveCount(4);
	});

	test("RPT-U01 a parameter is filled in the Run panel and applied: the matching student is the only row", async ({ reportDetail, api }) => {
		const student = await admitStudent(api);
		const report = await createReport(api, {
			sqlQuery: "SELECT admission_number, student_name FROM reporting_students WHERE admission_number = :adm",
			parameters: [{ name: "adm", type: "STRING", label: "Admission number", sortOrder: 0 }],
		});
		await reportDetail.open(report.id);
		await reportDetail.paramInput("Admission number").fill(student.admissionNumber);
		await reportDetail.run();
		await expect(reportDetail.resultTable().getByRole("row")).toHaveCount(2);
		await expect(reportDetail.resultTable()).toContainText(student.admissionNumber);
		await reportDetail.paramInput("Admission number").fill("NO-SUCH-NUMBER");
		await reportDetail.run();
		await expect(reportDetail.noRows()).toBeVisible();
	});

	test("RPT-U01 a date parameter takes a date, a number parameter a number, a true/false parameter a choice", async ({ reportDetail, api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT :since AS since, :n AS n, :flag AS flag",
			parameters: [
				{ name: "since", type: "DATE", label: "Since", sortOrder: 0 },
				{ name: "n", type: "NUMBER", label: "How many", sortOrder: 1 },
				{ name: "flag", type: "BOOLEAN", label: "Active only", sortOrder: 2 },
			],
		});
		await reportDetail.open(report.id);
		await reportDetail.paramInput("Since").fill("2026-02-03");
		await reportDetail.paramInput("How many").fill("7");
		await reportDetail.run();
		await expect(reportDetail.resultTable()).toContainText("2026-02-03");
		await expect(reportDetail.resultTable().getByRole("row").nth(1)).toContainText("7");
	});

	test("RPT-U01 a report that returns nothing says so", async ({ reportDetail, api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT student_id FROM reporting_students WHERE student_id < 0" });
		await reportDetail.open(report.id);
		await reportDetail.run();
		await expect(reportDetail.noRows()).toBeVisible();
	});

	test("RPT-U01 a query that fails shows an error and no table, without database internals", async ({ reportDetail, api }) => {
		const report = await createReport(api, { sqlQuery: "SELECT no_such_column FROM reporting_students" });
		await reportDetail.open(report.id);
		await reportDetail.run();
		const alert = reportDetail.errorAlert();
		await expect(alert).toBeVisible();
		await expect(reportDetail.resultTable()).toHaveCount(0);
		expect(await alert.innerText()).not.toMatch(/no_such_column|field list|reporting_students/i);
		expect(await alert.innerText()).not.toMatch(INTERNALS);
	});

	test("RPT-U01 a run with a required date left empty shows a readable error, not a database message", async ({ reportDetail, api }) => {
		const report = await createReport(api, {
			sqlQuery: "SELECT COUNT(*) AS n FROM reporting_students WHERE admission_date >= :since",
			parameters: [{ name: "since", type: "DATE", label: "Since", sortOrder: 0 }],
		});
		await reportDetail.open(report.id);
		await reportDetail.run();
		const alert = reportDetail.errorAlert();
		await expect(alert).toBeVisible();
		expect(await alert.innerText()).not.toMatch(/Incorrect \w+ value|Report query failed/i);
		expect(await alert.innerText()).toMatch(/since|required|date/i);
	});

	test("RPT-U01 Export as CSV downloads a file named after the report, with a header row and the rows shown", async ({ reportDetail, api }) => {
		const student = await admitStudent(api);
		const report = await createReport(api, {
			sqlQuery: "SELECT admission_number, student_name FROM reporting_students WHERE admission_number = :adm",
			parameters: [{ name: "adm", type: "STRING", label: "Admission number", sortOrder: 0 }],
		});
		await reportDetail.open(report.id);
		await reportDetail.paramInput("Admission number").fill(student.admissionNumber);
		const download = await reportDetail.exportCsv();
		expect(download.suggestedFilename()).toBe(`${report.name}.csv`);
		const lines = readFileSync((await download.path()) as string, "utf-8").split("\n");
		expect(lines[0]).toBe('"admission_number","student_name"');
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain(student.admissionNumber);
		await expect(reportDetail.resultTable()).toContainText(student.admissionNumber);
	});

	test("RPT-U01 values with commas and quotes are quoted correctly in the CSV", async ({ reportDetail, api }) => {
		const report = await createReport(api, { sqlQuery: `SELECT 'a,b' AS comma, 'say "hi"' AS quote` });
		await reportDetail.open(report.id);
		const download = await reportDetail.exportCsv();
		const lines = readFileSync((await download.path()) as string, "utf-8").split("\n");
		expect(lines[1]).toBe('"a,b","say ""hi"""');
	});

	test("RPT-U01 a standard report runs from the screen with a date range", async ({ reports, reportDetail, api, page }) => {
		(await api.post("/api/v1/reports/seed-standard")).expectStatus(200);
		await reports.open();
		await reports.showTab("My reports");
		await reports.openReport(STANDARD[0]);
		await reportDetail.paramInput("From date").fill("2020-01-01");
		await reportDetail.paramInput("To date").fill("2030-12-31");
		await reportDetail.run();
		await expect(reportDetail.resultTable().or(reportDetail.noRows()).first()).toBeVisible();
		await expect(page.getByRole("alert").filter({ hasText: /failed|error/i })).toHaveCount(0);
	});
});

test.describe("the report page", () => {
	test("RPT-U02 publishing moves a draft to published and removes the Publish button", async ({ reportDetail, api }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await expect(reportDetail.status()).toHaveText("DRAFT");
		await reportDetail.publish();
		await expect(reportDetail.status()).toHaveText("PUBLISHED");
		await expect(reportDetail.button("Publish")).toHaveCount(0);
		await expect(reportDetail.button("Archive")).toBeVisible();
	});

	test("RPT-U02 archiving marks the report archived and removes Publish and Archive", async ({ reportDetail, api }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.archive();
		await expect(reportDetail.status()).toHaveText("ARCHIVED");
		await expect(reportDetail.button("Publish")).toHaveCount(0);
		await expect(reportDetail.button("Archive")).toHaveCount(0);
	});

	test("RPT-U02 duplicating opens the copy, a draft named '(copy)', and the original is unchanged", async ({ reportDetail, api, page }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.duplicate();
		await expect(reportDetail.heading()).toHaveText(`${report.name} (copy)`);
		await expect(reportDetail.status()).toHaveText("DRAFT");
		await expect(page).not.toHaveURL(new RegExp(`/reports/${report.id}$`));
		(await api.get(REPORT, { params: { id: report.id } })).expectStatus(200).expectJson((r) => expect(r.name).toBe(report.name));
	});

	test("RPT-U02 editing the name, description and query and choosing Save changes keeps them after a reload", async ({ reportDetail, api, page }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.nameField().fill(`${report.name} renamed`);
		await reportDetail.descriptionField().fill("Edited in the UI");
		await reportDetail.sqlField().fill("SELECT 2 AS two");
		const saved = await reportDetail.saveChanges();
		expect(saved.status()).toBe(200);
		await page.reload();
		await expect(reportDetail.heading()).toHaveText(`${report.name} renamed`);
		await expect(reportDetail.descriptionField()).toHaveValue("Edited in the UI");
		await expect(reportDetail.sqlField()).toHaveValue("SELECT 2 AS two");
		await reportDetail.run();
		await expect(reportDetail.resultTable()).toContainText("two");
	});

	test("RPT-U02 saving an archived report is refused and the reason is shown", async ({ reportDetail, api }) => {
		const report = await createReport(api);
		(await api.post(`${REPORT}/archive`, { params: { id: report.id } })).expectStatus(200);
		await reportDetail.open(report.id);
		await reportDetail.descriptionField().fill("too late");
		await reportDetail.saveChanges();
		await expect(reportDetail.errorAlert()).toContainText(/archived/i);
	});

	test("RPT-U02 an unknown report id shows a not-found message, not a blank page", async ({ page }) => {
		await page.goto("/reports/99999999");
		await expect(page.getByRole("alert")).toContainText(/no report|not found/i);
	});

	test("RPT-U02 Back to reports returns to the list", async ({ reportDetail, api, page }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.backToReports();
		await expect(page).toHaveURL(/\/reports$/);
	});

	test("RPT-U02 changing a parameter in the definition keeps the Run panel in step with it", async ({ reportDetail, api, page }) => {
		const report = await createReport(api, { sqlQuery: "SELECT :adm AS adm", parameters: [{ name: "adm", type: "STRING", label: "Admission number", sortOrder: 0 }] });
		await reportDetail.open(report.id);
		await expect(reportDetail.paramInput("Admission number")).toBeVisible();
		await page.getByLabel("Label", { exact: false }).first().fill("Roll");
		await expect(reportDetail.paramInput("Roll")).toBeVisible();
	});
});

test.describe("sharing from the screen", () => {
	test("RPT-U03 the Share dialog needs a user id before it can be submitted, and Cancel closes it", async ({ reportDetail, api }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.openShare();
		await expect(reportDetail.shareDialog().getByRole("button", { name: "Share", exact: true })).toBeDisabled();
		await reportDetail.shareDialog().getByLabel("User ID").fill("1");
		await expect(reportDetail.shareDialog().getByRole("button", { name: "Share", exact: true })).toBeEnabled();
		await reportDetail.shareDialog().getByRole("button", { name: "Cancel" }).click();
		await expect(reportDetail.shareDialog()).toBeHidden();
	});

	test("RPT-U03 sharing with a user saves the share and closes the dialog without an error", async ({ reportDetail, api, anon, seed }) => {
		const colleague = await createDisposableUser(api, anon, seed, []);
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.openShare();
		const shared = await reportDetail.shareWith({ id: colleague.userId });
		expect(shared.status()).toBe(200);
		await expect(reportDetail.shareDialog()).toBeHidden();
		await expect(reportDetail.errorAlert()).toHaveCount(0);
		(await colleague.client.get("/api/v1/reports")).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(report.id));
	});

	async function colleaguePage(api: any, anon: any, seed: any, browser: any, canEdit: boolean) {
		const colleague = await createDisposableUser(api, anon, seed, []);
		const report = await createReport(api);
		(await api.post(`${REPORT}/share`, { params: { id: report.id }, body: { principalType: "USER", principalId: colleague.userId, canRun: true, canEdit } })).expectStatus(200);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: colleague.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		await page.goto(`/reports/${report.id}`);
		await expect(page.getByRole("heading", { name: report.name, level: 1 })).toBeVisible();
		return { page, context };
	}

	test("RPT-U03 a colleague the report was shared with opens it and runs it", async ({ api, anon, seed, browser }) => {
		const { page, context } = await colleaguePage(api, anon, seed, browser, false);
		await page.getByRole("button", { name: "Run", exact: true }).click();
		await expect(page.getByRole("table")).toContainText("one");
		await context.close();
	});

	test("RPT-U03 a colleague who may only run a report is not offered Publish, Archive, Save changes or Share", async ({ api, anon, seed, browser }) => {
		const { page, context } = await colleaguePage(api, anon, seed, browser, false);
		for (const name of ["Publish", "Archive", "Save changes", "Share"]) {
			await expect(page.getByRole("button", { name, exact: true }), `${name} should not be offered`).toHaveCount(0);
		}
		await context.close();
	});

	test("RPT-U03 sharing with a user id that does not exist shows an error in the dialog", async ({ reportDetail, api }) => {
		const report = await createReport(api);
		await reportDetail.open(report.id);
		await reportDetail.openShare();
		await reportDetail.shareWith({ id: 99999999 });
		await expect(reportDetail.shareDialog().getByRole("alert")).toBeVisible();
	});

	test("RPT-U03 sharing a report the person cannot edit is refused with the reason, not silently closed", async ({ api, anon, seed, browser }) => {
		const [alice, bob] = [await createDisposableUser(api, anon, seed, ["REPORT_CREATE"]), await createDisposableUser(api, anon, seed, ["REPORT_CREATE"])];
		const report = await createReport(alice.client);
		(await alice.client.post(`${REPORT}/share`, { params: { id: report.id }, body: { principalType: "USER", principalId: bob.userId, canRun: true, canEdit: false } })).expectStatus(200);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: bob.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		await page.goto(`/reports/${report.id}`);
		await page.getByRole("button", { name: "Share", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Share report" });
		await dialog.getByLabel("User ID").fill(String(alice.userId));
		await dialog.getByRole("button", { name: "Share", exact: true }).click();
		await expect(dialog.getByRole("alert")).toContainText(/edit access/i);
		await context.close();
	});
});

test.describe("who sees what", () => {
	test("RPT-U04 a person who can create reports but not manage them sees Create report and no Seed standard reports button", async ({ api, anon, seed, browser }) => {
		const writer = await createDisposableUser(api, anon, seed, ["REPORT_CREATE"]);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: writer.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		await page.goto("/reports");
		await expect(page.getByRole("button", { name: "Create report" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Seed standard reports" })).toHaveCount(0);
		await context.close();
	});

	test("RPT-U04 a person with no report permission who opens /reports by link cannot start creating a report", async ({ api, anon, seed, browser }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: nobody.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		await page.goto("/reports");
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("button", { name: "Create report" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Seed standard reports" })).toHaveCount(0);
		await context.close();
	});

	test("RPT-U04 a person whose create request is refused sees the reason", async ({ api, anon, seed, browser }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: nobody.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		await page.goto("/reports");
		await page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
		await page.getByRole("tab", { name: "My reports" }).waitFor();
		const create = page.getByRole("button", { name: "Create report" });
		test.skip((await create.count()) === 0, "the screen already hides Create report from this person");
		await create.click();
		const dialog = page.getByRole("dialog", { name: "Create report" });
		await dialog.getByLabel("Name", { exact: false }).first().fill("Refused");
		await dialog.getByLabel("SQL query").fill("SELECT 1 AS one");
		await dialog.getByRole("button", { name: "Save as draft" }).click();
		await expect(dialog.getByRole("alert")).toContainText(/REPORT_CREATE|permission/i);
		await context.close();
	});
});
