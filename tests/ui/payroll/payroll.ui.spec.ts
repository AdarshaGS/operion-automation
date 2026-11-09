// Payroll screens: /payroll (runs and salary components), /payroll/runs/:id, /payroll/payslips/:id and the
// Salary structure panel on a staff member's HR profile. IDs refer to docs/SCENARIOS.md section 16 (PAY-U*).
// A run covers the whole organisation and there is one a month, so anything that generates a run works in a
// throwaway organisation.

import { test, expect } from "../../../src/sanity/fixtures";
import type { Browser } from "@playwright/test";
import { createComponent, generateRun, payrollOrg, slipOf, staffWithSalary, PAYROLL } from "../../../src/api/payroll";
import { createStaff } from "../../../src/api/hr";
import { uniqueSuffix } from "../../../src/api/data";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { storageStatePath } from "../../../src/setup/session";
import { PayrollPage } from "../../../src/pages/payroll/PayrollPage";
import { PayrollRunPage } from "../../../src/pages/payroll/PayrollRunPage";
import { PayslipPage } from "../../../src/pages/payroll/PayslipPage";
import { StaffDetailPage } from "../../../src/pages/hr/StaffDetailPage";

const pages = (page: import("@playwright/test").Page) => ({ payroll: new PayrollPage(page), run: new PayrollRunPage(page), slip: new PayslipPage(page), staff: new StaffDetailPage(page) });

/** A throwaway organisation with one salaried staff member, shared by a run/payslip scenario. */
async function inPayrollOrg(
	browser: Browser,
	request: Parameters<typeof payrollOrg>[0],
	calls: Parameters<typeof payrollOrg>[1],
	body: (ctx: Awaited<ReturnType<typeof payrollOrg>>, page: import("@playwright/test").Page) => Promise<void>,
) {
	const ctx = await payrollOrg(request, calls);
	await inThrowawayOrg(browser, ctx.org.session, (page) => body(ctx, page));
}

test.describe("PAY-U01 salary components", () => {
	test("PAY-U01 a component added from the form is listed with its type, basis and ACTIVE status, and the name is cleared", async ({ payroll, page, api }) => {
		const name = `UI Allowance ${uniqueSuffix()}`;
		await payroll.open();
		await payroll.showComponents();
		await payroll.addComponent({ name, type: "Earning", basis: "Flat amount" });
		const row = payroll.componentRow(name);
		await expect(row).toContainText("Earning");
		await expect(row).toContainText("Flat amount");
		await expect(row).toContainText("ACTIVE");
		await expect(page.getByLabel("Name")).toHaveValue("");
		(await api.get(`${PAYROLL}/components`)).expectJson((list) => expect(list.map((c: { name: string }) => c.name)).toContain(name));
	});

	test("PAY-U01 a percentage deduction shows as Deduction and % of basic", async ({ payroll }) => {
		const name = `UI PF ${uniqueSuffix()}`;
		await payroll.open();
		await payroll.showComponents();
		await payroll.addComponent({ name, type: "Deduction", basis: "Percentage of basic" });
		await expect(payroll.componentRow(name)).toContainText("Deduction");
		await expect(payroll.componentRow(name)).toContainText("% of basic");
	});

	test("PAY-U01 Deactivate turns a component INACTIVE and Activate brings it back", async ({ payroll }) => {
		const name = `UI Toggle ${uniqueSuffix()}`;
		await payroll.open();
		await payroll.showComponents();
		await payroll.addComponent({ name });
		const row = payroll.componentRow(name);
		await row.getByRole("button", { name: "Deactivate" }).click();
		await expect(row).toContainText("INACTIVE");
		await row.getByRole("button", { name: "Activate", exact: true }).click();
		await expect(row).toContainText("ACTIVE");
		await expect(row).not.toContainText("INACTIVE");
	});

	test("PAY-U01 a name already in use shows an error and adds no second row", async ({ payroll, api }) => {
		const existing = await createComponent(api);
		await payroll.open();
		await payroll.showComponents();
		await payroll.addComponent({ name: existing.name });
		await expect(payroll.alert()).toBeVisible();
		await expect(payroll.componentRow(existing.name)).toHaveCount(1);
	});

	test("PAY-U01 a brand-new organisation has no components and says so", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async (_ctx, page) => {
			const { payroll } = pages(page);
			await payroll.open();
			await payroll.showComponents();
			await expect(page.getByText("No components yet.")).toBeVisible();
		});
	});

	test("PAY-U01 a user without payroll permissions is not offered the payroll forms", async ({ browser }) => {
		const context = await browser.newContext({ storageState: storageStatePath("readOnlyStaff") });
		const page = await context.newPage();
		try {
			await page.goto("/payroll");
			await page.waitForLoadState("networkidle");
			await expect.soft(page.getByRole("button", { name: "Generate run" }), "no Generate run for a user who cannot manage payroll").toHaveCount(0);
			await expect.soft(page.getByRole("link", { name: "Payroll", exact: true }), "the sidebar hides Payroll").toHaveCount(0);
			await expect.soft(page.getByText("No payroll runs yet."), "an empty state would claim there are no runs when the user just cannot see them").toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("PAY-U02 payroll runs", () => {
	test("PAY-U02 a brand-new organisation has no runs and says so", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async (_ctx, page) => {
			await pages(page).payroll.open();
			await expect(page.getByText("No payroll runs yet.")).toBeVisible();
		});
	});

	test("PAY-U02 Generate run creates a DRAFT for the month and opens it with its totals and payslips", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 40000 });
			const { payroll, run } = pages(page);
			await payroll.open();
			await payroll.generate({ month: "June", year: 2026 });
			await expect(page).toHaveURL(/\/payroll\/runs\/\d+$/);
			await expect(run.heading()).toHaveText("Payroll - June 2026");
			await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
			await expect(page.getByText(/Draft - open a payslip to add an adjustment/)).toBeVisible();
			await expect(run.totalsRow("Other staff")).toContainText("40,000.00");
			await expect(run.payslipRow(staff.employeeCode)).toContainText("40,000.00");
			await expect(run.finalizeButton()).toBeVisible();
			await expect(run.discardButton()).toBeVisible();
		});
	});

	test("PAY-U02 the runs list shows the period, status, payslip count and total net", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			await staffWithSalary(client, campusId, { basic: 10000 });
			await staffWithSalary(client, campusId, { basic: 20000 });
			await generateRun(client, 2026, 6);
			const { payroll } = pages(page);
			await payroll.open();
			const row = payroll.runRow("June 2026");
			await expect(row).toContainText("DRAFT");
			await expect(row).toContainText("2");
			await expect(row).toContainText("30,000.00");
			await row.click();
			await expect(page).toHaveURL(/\/payroll\/runs\/\d+$/);
		});
	});

	test("PAY-U02 generating a month that already has a run shows an error and stays on the list", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			await staffWithSalary(client, campusId);
			await generateRun(client, 2026, 6);
			const { payroll } = pages(page);
			await payroll.open();
			await payroll.generate({ month: "June", year: 2026 });
			await expect(payroll.alert()).toBeVisible();
			await expect(page).toHaveURL(/\/payroll$/);
		});
	});

	test("PAY-U02 an out-of-range year shows an error and creates no run", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async (_ctx, page) => {
			const { payroll } = pages(page);
			await payroll.open();
			await payroll.generate({ month: "June", year: 1999 });
			await expect(payroll.alert()).toBeVisible();
			await expect(page).toHaveURL(/\/payroll$/);
		});
	});

	test("PAY-U02 a run with nobody on a salary structure says no staff had one", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async (_ctx, page) => {
			const { payroll } = pages(page);
			await payroll.open();
			await payroll.generate({ month: "June", year: 2026 });
			await expect(page.getByText("No staff had a salary structure in force for this month.")).toBeVisible();
		});
	});
});

test.describe("PAY-U03 finalize, discard and correct", () => {
	test("PAY-U03 Finalize run locks the run: FINALIZED, no Finalize/Discard, Start correction run offered", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			await staffWithSalary(client, campusId);
			const generated = await generateRun(client, 2026, 6);
			const { run } = pages(page);
			await run.open(generated.id);
			await run.finalizeButton().click();
			await expect(page.getByText("FINALIZED", { exact: true }).first()).toBeVisible();
			await expect(run.finalizeButton()).toHaveCount(0);
			await expect(run.discardButton()).toHaveCount(0);
			await expect(run.correctionButton()).toBeVisible();
			await expect(page.getByText(/Draft - open a payslip/)).toHaveCount(0);
			(await client.get(`${PAYROLL}/runs/{id}`, { params: { id: generated.id } })).expectJson((r) => expect(r.status).toBe("FINALIZED"));
		});
	});

	test("PAY-U03 Discard draft removes the run and returns to the list", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			await staffWithSalary(client, campusId);
			const generated = await generateRun(client, 2026, 6);
			const { run } = pages(page);
			await run.open(generated.id);
			await run.discardButton().click();
			await expect(page).toHaveURL(/\/payroll$/);
			await expect(page.getByText("No payroll runs yet.")).toBeVisible();
			(await client.get(`${PAYROLL}/runs/{id}`, { params: { id: generated.id } })).expectStatus(404);
		});
	});

	test("PAY-U03 Start correction run opens a new DRAFT marked as a correction", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			await staffWithSalary(client, campusId);
			const generated = await generateRun(client, 2026, 6);
			(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: generated.id } })).expectStatus(200);
			const { run, payroll } = pages(page);
			await run.open(generated.id);
			await run.correctionButton().click();
			await expect(page).not.toHaveURL(new RegExp(`/payroll/runs/${generated.id}$`));
			await expect(page.getByText("correction", { exact: true })).toBeVisible();
			await expect(run.finalizeButton()).toBeVisible();
			await payroll.open();
			await expect(payroll.runRow("June 2026")).toHaveCount(2);
		});
	});

	test("PAY-U03 a payslip with negative net pay is flagged on the run and blocks Finalize with an error", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 1000 });
			const generated = await generateRun(client, 2026, 6);
			(await client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id: slipOf(generated, staff)!.id }, body: { label: "Recovery", type: "DEDUCTION", amount: 5000 } })).expectStatus(200);
			const { run } = pages(page);
			await run.open(generated.id);
			await expect(run.payslipRow(staff.employeeCode)).toContainText("negative net");
			await run.finalizeButton().click();
			await expect(run.alert()).toBeVisible();
			await expect(run.finalizeButton()).toBeVisible();
		});
	});
});

test.describe("PAY-U04 the payslip", () => {
	test("PAY-U04 shows the earnings, deductions and net pay with amounts to 2 places", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const allowance = await createComponent(client, { name: `Allowance ${uniqueSuffix()}`, type: "EARNING" });
			const tax = await createComponent(client, { name: `Tax ${uniqueSuffix()}`, type: "DEDUCTION" });
			const staff = await staffWithSalary(client, campusId, { basic: 50000, lines: [[allowance, 2500], [tax, 1200]] });
			const generated = await generateRun(client, 2026, 6);
			const { slip } = pages(page);
			await slip.open(slipOf(generated, staff)!.id);
			await expect(slip.heading()).toHaveText("Payslip - June 2026");
			await expect(page.getByText(staff.employeeCode).first()).toBeVisible();
			await expect(slip.lineRow("Basic")).toContainText("50,000.00");
			await expect(slip.lineRow(allowance.name)).toContainText("2,500.00");
			await expect(slip.lineRow(tax.name)).toContainText("1,200.00");
			await expect(page.getByText("51,300.00").last()).toBeVisible();
		});
	});

	test("PAY-U04 an adjustment added to a draft shows as an adjustment line and changes net pay; Remove undoes it", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 10000 });
			const generated = await generateRun(client, 2026, 6);
			const { slip } = pages(page);
			await slip.open(slipOf(generated, staff)!.id);
			await slip.addAdjustment({ label: "Unpaid leave", type: "Deduction", amount: 750 });
			const row = slip.lineRow("Unpaid leave");
			await expect(row).toContainText("adjustment");
			await expect(row).toContainText("750.00");
			await expect(page.getByText("9,250.00").last()).toBeVisible();
			await row.getByRole("button", { name: "Remove" }).click();
			await expect(slip.lineRow("Unpaid leave")).toHaveCount(0);
			await expect(page.getByText("9,250.00")).toHaveCount(0);
		});
	});

	test("PAY-U04 a negative adjustment amount is not accepted", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 10000 });
			const generated = await generateRun(client, 2026, 6);
			const { slip } = pages(page);
			await slip.open(slipOf(generated, staff)!.id);
			await slip.addAdjustment({ label: "Negative", type: "Earning", amount: -500 });
			await expect(slip.lineRow("Negative")).toHaveCount(0);
			(await client.get(`${PAYROLL}/payslips/{id}`, { params: { id: slipOf(generated, staff)!.id } })).expectJson((s) => expect(s.lines).toHaveLength(1));
		});
	});

	test("PAY-U04 once the run is finalized the payslip is read-only: no adjustment form, no Remove, still printable", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 10000 });
			const generated = await generateRun(client, 2026, 6);
			const id = slipOf(generated, staff)!.id;
			(await client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id }, body: { label: "Bonus", type: "EARNING", amount: 100 } })).expectStatus(200);
			(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: generated.id } })).expectStatus(200);
			const { slip } = pages(page);
			await slip.open(id);
			await expect(slip.adjustmentForm()).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
			await expect(slip.lineRow("Bonus")).toContainText("100.00");
		});
	});

	test("PAY-U04 clicking a staff name on the run opens that payslip", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId);
			const generated = await generateRun(client, 2026, 6);
			const { run, slip } = pages(page);
			await run.open(generated.id);
			await run.payslipRow(staff.employeeCode).getByRole("link").click();
			await expect(page).toHaveURL(new RegExp(`/payroll/payslips/${slipOf(generated, staff)!.id}$`));
			await expect(slip.heading()).toBeVisible();
		});
	});
});

test.describe("HR-U07 the salary structure panel on a staff profile", () => {
	test("HR-U07 a staff member with no structure is told they are left out of payroll runs", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await createStaff(client, campusId);
			const { staff: detail } = pages(page);
			await detail.open(staff.id);
			await expect(page.getByText("No salary structure yet")).toBeVisible();
		});
	});

	test("HR-U07 saving a structure lists it as the latest version with its basic and components", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await createStaff(client, campusId);
			const hra = await createComponent(client, { name: `HRA ${uniqueSuffix()}`, type: "EARNING", calculationBasis: "PERCENT_OF_BASIC" });
			const { staff: detail } = pages(page);
			await detail.open(staff.id);
			await detail.saveSalaryStructure({ effectiveFrom: "2026-01-01", basic: 45000, components: { [hra.name]: 20 } });
			const panel = detail.salaryPanelText();
			await expect(panel).toContainText("From 2026-01-01");
			await expect(panel).toContainText("latest");
			await expect(panel).toContainText("Basic: 45,000.00");
			await expect(panel).toContainText(`${hra.name}: 20% of basic`);
			await expect(page.getByText("No salary structure yet")).toHaveCount(0);
		});
	});

	test("HR-U07 a raise is a new version and the newest one carries the latest chip", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 30000, effectiveFrom: "2026-01-01" });
			const { staff: detail } = pages(page);
			await detail.open(staff.id);
			await detail.saveSalaryStructure({ effectiveFrom: "2026-07-01", basic: 35000 });
			await expect(detail.salaryHistory()).toHaveText(["From 2026-07-01", "From 2026-01-01"]);
			await expect(detail.salaryPanelText().getByText("latest", { exact: true })).toHaveCount(1);
		});
	});

	test("HR-U07 a version that does not take effect after the latest shows an error and is not added", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await staffWithSalary(client, campusId, { basic: 30000, effectiveFrom: "2026-06-01" });
			const { staff: detail } = pages(page);
			await detail.open(staff.id);
			await detail.saveSalaryStructure({ effectiveFrom: "2026-03-01", basic: 99000 });
			await expect(detail.alert()).toBeVisible();
			await expect(detail.salaryHistory()).toHaveCount(1);
		});
	});

	test("HR-U07 a salary structure puts the staff member on the next payroll run", async ({ browser, request, calls }) => {
		await inPayrollOrg(browser, request, calls, async ({ client, campusId }, page) => {
			const staff = await createStaff(client, campusId);
			const { staff: detail, payroll, run } = pages(page);
			await detail.open(staff.id);
			await detail.saveSalaryStructure({ effectiveFrom: "2026-01-01", basic: 25000 });
			await expect(detail.salaryHistory()).toHaveCount(1);
			await payroll.open();
			await payroll.generate({ month: "June", year: 2026 });
			await expect(run.payslipRow(staff.employeeCode)).toContainText("25,000.00");
		});
	});
});
