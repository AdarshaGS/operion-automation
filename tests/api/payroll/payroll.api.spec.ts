// Payroll: salary components, salary structures, monthly runs, payslips, adjustments, finalize and
// correction, and staff self-service payslips. IDs refer to docs/SCENARIOS.md section 16 (PAY-*) and
// HR-07 (salary structures). A run covers every staff member with a structure and there is one run a
// month, so scenarios that generate runs work in their own throwaway organisation.

import { test, expect } from "../../../src/api/fixtures";
import { createDisposableUser } from "../../../src/api/users";
import { createStaff, HR } from "../../../src/api/hr";
import { uniqueSuffix } from "../../../src/api/data";
import { expectShape } from "../../../src/api/shapes";
import { PAYROLL, STRUCTURES, createComponent, createStructure, generateRun, getPayslip, getRun, payrollOrg, slipOf, staffWithSalary } from "../../../src/api/payroll";

const BAD = 400;
const money = (n: unknown) => Number(n);

test.describe("PAY-01 and PAY-02 salary components", () => {
	test("PAY-01 an earning and a deduction, flat and percent-of-basic, are created ACTIVE and listed by name", async ({ api }) => {
		const stamp = uniqueSuffix();
		const made = [
			await createComponent(api, { name: `B ${stamp} Allowance`, type: "EARNING", calculationBasis: "FLAT" }),
			await createComponent(api, { name: `A ${stamp} PF`, type: "DEDUCTION", calculationBasis: "PERCENT_OF_BASIC" }),
		];
		expect(made.map((c) => c.status)).toEqual(["ACTIVE", "ACTIVE"]);
		expectShape(made[0], { id: "number", name: "string", type: "string", calculationBasis: "string", status: "string" });
		(await api.get(`${PAYROLL}/components`)).expectStatus(200).expectJson((list) => {
			const names = list.map((c: { name: string }) => c.name);
			expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
			expect(list.find((c: { id: number }) => c.id === made[1].id)).toMatchObject({ type: "DEDUCTION", calculationBasis: "PERCENT_OF_BASIC" });
		});
	});

	test("PAY-01 a missing or blank name, type or calculation basis returns 400", async ({ api }) => {
		for (const body of [{ type: "EARNING", calculationBasis: "FLAT" }, { name: " ", type: "EARNING", calculationBasis: "FLAT" }, { name: "No type", calculationBasis: "FLAT" }, { name: "No basis", type: "EARNING" }]) {
			(await api.post(`${PAYROLL}/components`, { body })).expectStatus(BAD);
		}
	});

	test("PAY-01 an unknown type or calculation basis returns 400", async ({ api }) => {
		(await api.post(`${PAYROLL}/components`, { body: { name: `X ${uniqueSuffix()}`, type: "BONUS", calculationBasis: "FLAT" } })).expectStatus(BAD);
		(await api.post(`${PAYROLL}/components`, { body: { name: `X ${uniqueSuffix()}`, type: "EARNING", calculationBasis: "HOURLY" } })).expectStatus(BAD);
	});

	test("PAY-01 a second component with the same name (any case) is a conflict", async ({ api }) => {
		const made = await createComponent(api);
		(await api.post(`${PAYROLL}/components`, { body: { name: made.name.toUpperCase(), type: "EARNING", calculationBasis: "FLAT" } })).expectStatus(409);
	});

	test("PAY-02 a component can be deactivated and activated again", async ({ api }) => {
		const made = await createComponent(api);
		(await api.post(`${PAYROLL}/components/{id}/status`, { params: { id: made.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((c) => expect(c.status).toBe("INACTIVE"));
		(await api.post(`${PAYROLL}/components/{id}/status`, { params: { id: made.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((c) => expect(c.status).toBe("ACTIVE"));
	});

	test("PAY-02 an unknown status returns 400 and an unknown component 404", async ({ api }) => {
		const made = await createComponent(api);
		(await api.post(`${PAYROLL}/components/{id}/status`, { params: { id: made.id }, body: { status: "RETIRED" } })).expectStatus(BAD);
		(await api.post(`${PAYROLL}/components/{id}/status`, { params: { id: made.id }, body: {} })).expectStatus(BAD);
		(await api.post(`${PAYROLL}/components/{id}/status`, { params: { id: 99999999 }, body: { status: "ACTIVE" } })).expectStatus(404);
	});

	test("PAY-01 components are managed with PAYROLL_MANAGE and read with PAYROLL_VIEW", async ({ api, anon, as, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await viewer.client.get(`${PAYROLL}/components`)).expectStatus(200);
		(await viewer.client.post(`${PAYROLL}/components`, { body: { name: `No ${uniqueSuffix()}`, type: "EARNING", calculationBasis: "FLAT" } })).expectStatus(403);
		(await as("readOnlyStaff").get(`${PAYROLL}/components`)).expectStatus(403);
		(await as("noPermissions").get(`${PAYROLL}/components`)).expectStatus(403);
		(await anon.get(`${PAYROLL}/components`)).expectStatus(401);
	});
});

test.describe("HR-07 salary structures", () => {
	test("HR-07 a structure is saved with its basic, date and component lines, and read back newest first", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const hra = await createComponent(client, { name: `HRA ${uniqueSuffix()}`, calculationBasis: "PERCENT_OF_BASIC" });
		const staff = await createStaff(client, campusId);
		const first = await createStructure(client, staff.id, { effectiveFrom: "2026-01-01", basicAmount: 40000 });
		const second = await createStructure(client, staff.id, { effectiveFrom: "2026-07-01", basicAmount: 45000, lines: [{ componentId: hra.id, value: 20 }] });
		expectShape(second, { id: "number", staffProfileId: "number", effectiveFrom: "string", basicAmount: "number", lines: "array" });
		expect(second.lines).toEqual([expect.objectContaining({ componentId: hra.id, componentName: hra.name, value: 20 })]);
		(await client.get(STRUCTURES, { params: { staffId: staff.id } })).expectStatus(200).expectJson((list) => expect(list.map((s: { id: number }) => s.id)).toEqual([second.id, first.id]));
	});

	test("HR-07 a new structure must take effect after the current one", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const staff = await createStaff(client, campusId);
		await createStructure(client, staff.id, { effectiveFrom: "2026-06-01" });
		for (const effectiveFrom of ["2026-06-01", "2026-01-01"]) {
			(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom, basicAmount: 1000, lines: [] } })).expectStatus(409);
		}
	});

	test("HR-07 an inactive or repeated component is refused", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const staff = await createStaff(client, campusId);
		const off = await createComponent(client);
		(await client.post(`${PAYROLL}/components/{id}/status`, { params: { id: off.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom: "2026-01-01", basicAmount: 1000, lines: [{ componentId: off.id, value: 5 }] } })).expectStatus(409);
		const on = await createComponent(client);
		(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom: "2026-01-01", basicAmount: 1000, lines: [{ componentId: on.id, value: 5 }, { componentId: on.id, value: 6 }] } })).expectStatus(409);
	});

	test("HR-07 a missing date or basic amount returns 400; an unknown staff member or component returns 404", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const staff = await createStaff(client, campusId);
		(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { basicAmount: 1000 } })).expectStatus(BAD);
		(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom: "2026-01-01" } })).expectStatus(BAD);
		(await client.post(STRUCTURES, { params: { staffId: 99999999 }, body: { effectiveFrom: "2026-01-01", basicAmount: 1000 } })).expectStatus(404);
		(await client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom: "2026-01-01", basicAmount: 1000, lines: [{ componentId: 99999999, value: 1 }] } })).expectStatus(404);
	});

	test("HR-07 a negative basic, a negative component value and a percentage over 100 return 400", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const staff = await createStaff(client, campusId);
		const percent = await createComponent(client, { calculationBasis: "PERCENT_OF_BASIC" });
		const flat = await createComponent(client);
		for (const [label, body] of [
			["negative basic", { effectiveFrom: "2026-01-01", basicAmount: -1, lines: [] }],
			["negative value", { effectiveFrom: "2026-01-01", basicAmount: 1000, lines: [{ componentId: flat.id, value: -5 }] }],
			["percentage over 100", { effectiveFrom: "2026-01-01", basicAmount: 1000, lines: [{ componentId: percent.id, value: 150 }] }],
		] as const) {
			const res = await client.post(STRUCTURES, { params: { staffId: staff.id }, body });
			expect.soft(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(BAD);
		}
	});

	test("HR-07 reading needs PAYROLL_VIEW and writing PAYROLL_MANAGE", async ({ api, anon, as, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await viewer.client.get(STRUCTURES, { params: { staffId: staff.id } })).expectStatus(200);
		(await viewer.client.post(STRUCTURES, { params: { staffId: staff.id }, body: { effectiveFrom: "2026-01-01", basicAmount: 1 } })).expectStatus(403);
		(await as("readOnlyStaff").get(STRUCTURES, { params: { staffId: staff.id } })).expectStatus(403);
	});
});

test.describe("PAY-03 to PAY-05 generating a run", () => {
	test("PAY-03 a run is created DRAFT for the month with a payslip for each staff member who has a structure", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const a = await staffWithSalary(client, campusId, { basic: 40000 });
		const b = await staffWithSalary(client, campusId, { basic: 60000 });
		await createStaff(client, campusId); // no structure: absent from the run
		const run = await generateRun(client, 2026, 6);
		expect(run).toMatchObject({ payYear: 2026, payMonth: 6, status: "DRAFT", supersedesRunId: null, finalizedAt: null, payslipCount: 2 });
		expect(run.payslips.map((p) => p.staffProfileId).sort()).toEqual([a.id, b.id].sort());
		expectShape(run, { id: "number", payYear: "number", payMonth: "number", status: "string", payslipCount: "number", teacherTotals: "object", staffTotals: "object", payslips: "array" });
		(await client.get(`${PAYROLL}/runs`)).expectStatus(200).expectJson((list) => {
			expect(list.map((r: { id: number }) => r.id)).toEqual([run.id]);
			expect(list[0].payslips, "the list view carries no payslips").toEqual([]);
		});
		expect((await getRun(client, run.id)).payslipCount).toBe(2);
	});

	test("PAY-03 only one run per month; a different month is fine", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		await staffWithSalary(client, campusId);
		await generateRun(client, 2026, 6);
		(await client.post(`${PAYROLL}/runs`, { body: { year: 2026, month: 6 } })).expectStatus(409);
		await generateRun(client, 2026, 7);
	});

	test("PAY-03 a run with nobody to pay is still created, with no payslips", async ({ request, calls }) => {
		const { client } = await payrollOrg(request, calls);
		expect((await generateRun(client, 2026, 6)).payslipCount).toBe(0);
	});

	test("PAY-03 a staff member who joined after the month, whose structure starts later, or who has left is left out", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const late = await staffWithSalary(client, campusId, { staff: { dateOfJoining: "2026-07-15" }, effectiveFrom: "2026-01-01" });
		const future = await staffWithSalary(client, campusId, { effectiveFrom: "2026-07-01" });
		const gone = await staffWithSalary(client, campusId);
		(await client.post(`${HR}/staff/{id}/exit`, { params: { id: gone.id }, body: { exitType: "RESIGNATION", exitDate: "2026-05-31" } })).expectStatus(200);
		const kept = await staffWithSalary(client, campusId);
		const run = await generateRun(client, 2026, 6);
		const present = run.payslips.map((p) => p.staffProfileId);
		expect(present).toEqual([kept.id]);
		expect(present).not.toContain(late.id);
		expect(present).not.toContain(future.id);
		expect(present).not.toContain(gone.id);
	});

	test("PAY-03 the structure in force on the last day of the month is the one used", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const staff = await staffWithSalary(client, campusId, { basic: 30000, effectiveFrom: "2026-01-01" });
		await createStructure(client, staff.id, { effectiveFrom: "2026-06-30", basicAmount: 35000 });
		await createStructure(client, staff.id, { effectiveFrom: "2026-07-01", basicAmount: 99000 });
		expect(money(slipOf(await generateRun(client, 2026, 6), staff)!.basicAmount)).toBe(35000);
	});

	test("PAY-04 a payslip has a Basic line, a line per structure component, and the right gross, deductions and net", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const allowance = await createComponent(client, { name: `Allowance ${uniqueSuffix()}`, type: "EARNING", calculationBasis: "FLAT" });
		const tax = await createComponent(client, { name: `Tax ${uniqueSuffix()}`, type: "DEDUCTION", calculationBasis: "FLAT" });
		const staff = await staffWithSalary(client, campusId, { basic: 50000, lines: [[allowance, 2500], [tax, 1200]] });
		const slip = await getPayslip(client, slipOf(await generateRun(client, 2026, 6), staff)!.id);
		expectShape(slip, { id: "number", payrollRunId: "number", employeeCode: "string", staffName: "string", designationName: "string", basicAmount: "number", grossEarnings: "number", totalDeductions: "number", netPay: "number", lines: "array" });
		expect(slip).toMatchObject({ employeeCode: staff.employeeCode, designationName: staff.designationName, payYear: 2026, payMonth: 6, runStatus: "DRAFT", teacher: false });
		expect(slip.lines.map((l) => [l.label, l.type, l.source, money(l.amount)])).toEqual([
			["Basic", "EARNING", "BASIC", 50000],
			[allowance.name, "EARNING", "STRUCTURE", 2500],
			[tax.name, "DEDUCTION", "STRUCTURE", 1200],
		]);
		expect([money(slip.grossEarnings), money(slip.totalDeductions), money(slip.netPay)]).toEqual([52500, 1200, 51300]);
	});

	test("PAY-04 the run's totals add up its payslips, split between teachers and other staff", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		await staffWithSalary(client, campusId, { basic: 10000 });
		await staffWithSalary(client, campusId, { basic: 20000 });
		const run = await generateRun(client, 2026, 6);
		expect(run.staffTotals).toMatchObject({ count: 2 });
		expect([money(run.staffTotals.gross), money(run.staffTotals.net)]).toEqual([30000, 30000]);
		expect(run.teacherTotals).toMatchObject({ count: 0 });
	});

	test("PAY-05 a percent-of-basic component is that percentage of basic, rounded half-up to 2 places", async ({ request, calls }) => {
		const { client, campusId } = await payrollOrg(request, calls);
		const ten = await createComponent(client, { name: `Ten ${uniqueSuffix()}`, calculationBasis: "PERCENT_OF_BASIC" });
		const odd = await createComponent(client, { name: `Odd ${uniqueSuffix()}`, calculationBasis: "PERCENT_OF_BASIC" });
		const staff = await staffWithSalary(client, campusId, { basic: 33333, lines: [[ten, 10], [odd, 12.5]] });
		const slip = await getPayslip(client, slipOf(await generateRun(client, 2026, 6), staff)!.id);
		const amountOf = (label: string) => money(slip.lines.find((l) => l.label === label)!.amount);
		expect(amountOf(ten.name)).toBe(3333.3);
		expect(amountOf(odd.name)).toBe(4166.63);
	});

	test("PAY-06 there is no leave proration: an approved leave in the month does not change the payslip", async ({ request, calls }) => {
		const { client, campusId, org } = await payrollOrg(request, calls);
		const staff = await staffWithSalary(client, campusId, { basic: 50000 });
		const years = (await client.get("/api/v1/academic-years")).body as { id: number }[];
		const type = (await client.post(`${HR}/leave-types`, { body: { code: `L${uniqueSuffix()}`, name: `Unpaid ${uniqueSuffix()}`, defaultAnnualDays: 5 } })).expectStatus(200).body;
		if (years.length) {
			(await client.post(`${HR}/leave-balances`, { body: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: years[0].id, allocatedDays: 5 } })).expectStatus(200);
			const leave = (await client.post(`${HR}/leave-requests`, { body: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: years[0].id, startDate: "2026-06-08", endDate: "2026-06-12", numberOfDays: 5, reason: "Unpaid" } })).expectStatus(200).body;
			(await client.post(`${HR}/leave-requests/{id}/approve`, { params: { id: leave.id }, body: { decidedBy: org.session.userId } })).expectStatus(200);
		}
		const slip = slipOf(await generateRun(client, 2026, 6), staff)!;
		expect([money(slip.basicAmount), money(slip.netPay)]).toEqual([50000, 50000]);
	});

	test("PAY-12 a month outside 1 to 12, a year outside 2000 to 2100, or a missing value returns 400", async ({ api }) => {
		for (const body of [{ year: 2026, month: 0 }, { year: 2026, month: 13 }, { year: 1999, month: 5 }, { year: 2101, month: 5 }, { year: 2026 }, { month: 5 }, {}]) {
			(await api.post(`${PAYROLL}/runs`, { body })).expectStatus(BAD);
		}
	});

	test("PAY-03 reading runs needs PAYROLL_VIEW and generating needs PAYROLL_MANAGE", async ({ api, anon, as, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await viewer.client.get(`${PAYROLL}/runs`)).expectStatus(200);
		(await viewer.client.post(`${PAYROLL}/runs`, { body: { year: 2090, month: 1 } })).expectStatus(403);
		(await as("readOnlyStaff").get(`${PAYROLL}/runs`)).expectStatus(403);
		(await anon.get(`${PAYROLL}/runs`)).expectStatus(401);
		(await api.get(`${PAYROLL}/runs/{id}`, { params: { id: 99999999 } })).expectStatus(404);
		(await api.get(`${PAYROLL}/payslips/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});
});

test.describe("PAY-07 and PAY-08 adjustments", () => {
	async function draft(request: Parameters<typeof payrollOrg>[0], calls: Parameters<typeof payrollOrg>[1]) {
		const o = await payrollOrg(request, calls);
		const staff = await staffWithSalary(o.client, o.campusId, { basic: 10000 });
		const slip = slipOf(await generateRun(o.client, 2026, 6), staff)!;
		return { ...o, staff, slip };
	}
	const add = (client: Awaited<ReturnType<typeof draft>>["client"], id: number, body: Record<string, unknown>) => client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id }, body });

	test("PAY-07 an earning adjustment raises net pay and a deduction lowers it; both are listed as ADJUSTMENT lines", async ({ request, calls }) => {
		const { client, slip } = await draft(request, calls);
		const afterBonus = (await add(client, slip.id, { label: "Bonus", type: "EARNING", amount: 1500 })).expectStatus(200).body;
		expect([money(afterBonus.grossEarnings), money(afterBonus.netPay)]).toEqual([11500, 11500]);
		const afterFine = (await add(client, slip.id, { label: "Fine", type: "DEDUCTION", amount: 400 })).expectStatus(200).body;
		expect([money(afterFine.totalDeductions), money(afterFine.netPay)]).toEqual([400, 11100]);
		expect(afterFine.lines.filter((l: { source: string }) => l.source === "ADJUSTMENT").map((l: { label: string }) => l.label)).toEqual(["Bonus", "Fine"]);
	});

	test("PAY-07 an adjustment needs a label, a type and an amount", async ({ request, calls }) => {
		const { client, slip } = await draft(request, calls);
		for (const body of [{ type: "EARNING", amount: 1 }, { label: " ", type: "EARNING", amount: 1 }, { label: "x", amount: 1 }, { label: "x", type: "EARNING" }, { label: "x", type: "BONUS", amount: 1 }]) {
			(await add(client, slip.id, body)).expectStatus(BAD);
		}
	});

	test("PAY-07 a negative amount returns 400", async ({ request, calls }) => {
		const { client, slip } = await draft(request, calls);
		const res = await add(client, slip.id, { label: "Negative", type: "EARNING", amount: -50 });
		expect(res.status, JSON.stringify(res.body)).toBe(BAD);
	});

	test("PAY-07 an unknown payslip returns 404; adjusting needs PAYROLL_MANAGE", async ({ request, calls, api, anon, seed }) => {
		const { client, slip } = await draft(request, calls);
		(await add(client, 99999999, { label: "x", type: "EARNING", amount: 1 })).expectStatus(404);
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await add(viewer.client, slip.id, { label: "x", type: "EARNING", amount: 1 })).expectStatus(403);
	});

	test("PAY-08 an adjustment line can be deleted from a draft and the totals recalculate", async ({ request, calls }) => {
		const { client, slip } = await draft(request, calls);
		const withBonus = (await add(client, slip.id, { label: "Bonus", type: "EARNING", amount: 700 })).body;
		const line = withBonus.lines.find((l: { source: string }) => l.source === "ADJUSTMENT");
		const after = (await client.delete(`${PAYROLL}/payslip-lines/{id}`, { params: { id: line.id } })).expectStatus(200).body;
		expect([money(after.grossEarnings), money(after.netPay)]).toEqual([10000, 10000]);
		expect(after.lines.map((l: { source: string }) => l.source)).toEqual(["BASIC"]);
	});

	test("PAY-08 the Basic and structure lines cannot be deleted; an unknown line returns 404", async ({ request, calls }) => {
		const { client, slip } = await draft(request, calls);
		const basic = (await getPayslip(client, slip.id)).lines[0];
		(await client.delete(`${PAYROLL}/payslip-lines/{id}`, { params: { id: basic.id } })).expectStatus(409);
		(await client.delete(`${PAYROLL}/payslip-lines/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});
});

test.describe("PAY-09 to PAY-11 finalize, correct and discard", () => {
	async function run(request: Parameters<typeof payrollOrg>[0], calls: Parameters<typeof payrollOrg>[1], basic = 10000) {
		const o = await payrollOrg(request, calls);
		const staff = await staffWithSalary(o.client, o.campusId, { basic });
		const generated = await generateRun(o.client, 2026, 6);
		return { ...o, staff, run: generated, slip: slipOf(generated, staff)! };
	}
	const finalize = (client: Awaited<ReturnType<typeof run>>["client"], id: number) => client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id } });

	test("PAY-09 finalizing locks the run: FINALIZED with a time, payslips report it, and adjustments and deletions are refused", async ({ request, calls }) => {
		const { client, run: r, slip } = await run(request, calls);
		const adjusted = (await client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id: slip.id }, body: { label: "Bonus", type: "EARNING", amount: 5 } })).body;
		(await finalize(client, r.id)).expectStatus(200).expectJson((b) => {
			expect(b.status).toBe("FINALIZED");
			expect(b.finalizedAt).toBeTruthy();
		});
		expect((await getPayslip(client, slip.id)).runStatus).toBe("FINALIZED");
		(await client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id: slip.id }, body: { label: "Late", type: "EARNING", amount: 5 } })).expectStatus(409);
		const line = adjusted.lines.find((l: { source: string }) => l.source === "ADJUSTMENT");
		(await client.delete(`${PAYROLL}/payslip-lines/{id}`, { params: { id: line.id } })).expectStatus(409);
	});

	test("PAY-09 a run already finalized cannot be finalized again", async ({ request, calls }) => {
		const { client, run: r } = await run(request, calls);
		(await finalize(client, r.id)).expectStatus(200);
		(await finalize(client, r.id)).expectStatus(409);
	});

	test("PAY-09 a run with no payslips cannot be finalized", async ({ request, calls }) => {
		const { client } = await payrollOrg(request, calls);
		const empty = await generateRun(client, 2026, 6);
		(await finalize(client, empty.id)).expectStatus(409);
	});

	test("PAY-09 a negative net pay blocks finalizing until it is adjusted", async ({ request, calls }) => {
		const { client, run: r, slip } = await run(request, calls, 1000);
		(await client.post(`${PAYROLL}/payslips/{id}/adjustments`, { params: { id: slip.id }, body: { label: "Recovery", type: "DEDUCTION", amount: 5000 } })).expectStatus(200);
		(await finalize(client, r.id)).expectStatus(409);
		const withDeduction = await getPayslip(client, slip.id);
		const line = withDeduction.lines.find((l) => l.source === "ADJUSTMENT")!;
		(await client.delete(`${PAYROLL}/payslip-lines/{id}`, { params: { id: line.id } })).expectStatus(200);
		(await finalize(client, r.id)).expectStatus(200);
	});

	test("PAY-09 finalizing needs PAYROLL_MANAGE; an unknown run returns 404", async ({ request, calls, api, anon, seed }) => {
		const { client, run: r } = await run(request, calls);
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: 99999999 } })).expectStatus(404);
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await viewer.client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: r.id } })).expectStatus(403);
	});

	test("PAY-10 a finalized run can be corrected: a new DRAFT for the same month that points at the original", async ({ request, calls }) => {
		const { client, run: r, staff } = await run(request, calls);
		(await finalize(client, r.id)).expectStatus(200);
		const correction = (await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).expectStatus(200).body;
		expect(correction).toMatchObject({ status: "DRAFT", supersedesRunId: r.id, payYear: 2026, payMonth: 6 });
		expect(correction.id).not.toBe(r.id);
		expect(slipOf(correction, staff)).toBeTruthy();
		expect((await getRun(client, r.id)).status, "the original stays FINALIZED until the correction is finalized").toBe("FINALIZED");
	});

	test("PAY-10 finalizing the correction supersedes the original, and the correction picks up changes made since", async ({ request, calls }) => {
		const { client, run: r, staff } = await run(request, calls, 10000);
		(await finalize(client, r.id)).expectStatus(200);
		await createStructure(client, staff.id, { effectiveFrom: "2026-06-15", basicAmount: 12000 });
		const correction = (await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).body;
		expect(money(slipOf(correction, staff)!.basicAmount)).toBe(12000);
		(await finalize(client, correction.id)).expectStatus(200);
		expect((await getRun(client, r.id)).status).toBe("SUPERSEDED");
		expect((await getRun(client, correction.id)).status).toBe("FINALIZED");
		(await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).expectStatus(409);
	});

	test("PAY-10 only a finalized run can be corrected, and only one correction can be open", async ({ request, calls }) => {
		const { client, run: r } = await run(request, calls);
		(await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).expectStatus(409);
		(await finalize(client, r.id)).expectStatus(200);
		(await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).expectStatus(200);
		(await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: r.id } })).expectStatus(409);
	});

	test("PAY-10 a new run for a month with a finalized run is refused", async ({ request, calls }) => {
		const { client, run: r } = await run(request, calls);
		(await finalize(client, r.id)).expectStatus(200);
		(await client.post(`${PAYROLL}/runs`, { body: { year: 2026, month: 6 } })).expectStatus(409);
	});

	test("PAY-11 a draft run can be discarded with its payslips, and the month can be generated again", async ({ request, calls }) => {
		const { client, run: r, slip } = await run(request, calls);
		(await client.delete(`${PAYROLL}/runs/{id}`, { params: { id: r.id } })).expectStatus(200);
		(await client.get(`${PAYROLL}/runs/{id}`, { params: { id: r.id } })).expectStatus(404);
		(await client.get(`${PAYROLL}/payslips/{id}`, { params: { id: slip.id } })).expectStatus(404);
		expect((await generateRun(client, 2026, 6)).status).toBe("DRAFT");
	});

	test("PAY-11 a finalized or superseded run cannot be deleted; an unknown run returns 404", async ({ request, calls }) => {
		const { client, run: r } = await run(request, calls);
		(await finalize(client, r.id)).expectStatus(200);
		(await client.delete(`${PAYROLL}/runs/{id}`, { params: { id: r.id } })).expectStatus(409);
		(await client.delete(`${PAYROLL}/runs/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});

	test("PAY-11 deleting needs PAYROLL_MANAGE", async ({ request, calls, api, anon, seed }) => {
		const { client, run: r } = await run(request, calls);
		const viewer = await createDisposableUser(api, anon, seed, ["PAYROLL_VIEW"]);
		(await viewer.client.delete(`${PAYROLL}/runs/{id}`, { params: { id: r.id } })).expectStatus(403);
		(await client.get(`${PAYROLL}/runs/{id}`, { params: { id: r.id } })).expectStatus(200);
	});
});

test.describe("PAY-13 staff see only their own finalized payslips", () => {
	async function payroll(request: Parameters<typeof payrollOrg>[0], calls: Parameters<typeof payrollOrg>[1], anon: Parameters<typeof createDisposableUser>[1]) {
		const o = await payrollOrg(request, calls);
		const ctx = { organisationSlug: o.slug, campusId: o.campusId };
		const me = await createDisposableUser(o.client, anon, ctx, []);
		const mine = await staffWithSalary(o.client, o.campusId, { basic: 20000, staff: { personId: me.personId } });
		const colleague = await staffWithSalary(o.client, o.campusId, { basic: 30000 });
		const run = await generateRun(o.client, 2026, 6);
		return { ...o, me, mine, colleague, run };
	}
	const slips = (me: { client: { get: Function } }) => me.client.get("/api/v1/me/payslips");

	test("PAY-13 a draft run's payslips are not visible; once finalized, only the caller's own appears", async ({ request, calls, anon }) => {
		const { client, me, mine, run } = await payroll(request, calls, anon);
		(await slips(me)).expectStatus(200).expectJson((list: unknown[]) => expect(list).toEqual([]));
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: run.id } })).expectStatus(200);
		(await slips(me)).expectStatus(200).expectJson((list: { staffProfileId: number; netPay: number }[]) => {
			expect(list.map((s) => s.staffProfileId)).toEqual([mine.id]);
			expect(money(list[0].netPay)).toBe(20000);
		});
	});

	test("PAY-13 a payslip can be opened by id with its lines, but not someone else's, nor a draft", async ({ request, calls, anon }) => {
		const { client, me, mine, colleague, run } = await payroll(request, calls, anon);
		const ownId = slipOf(run, mine)!.id;
		const theirId = slipOf(run, colleague)!.id;
		(await me.client.get("/api/v1/me/payslips/{id}", { params: { id: ownId } })).expectStatus(403);
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: run.id } })).expectStatus(200);
		(await me.client.get("/api/v1/me/payslips/{id}", { params: { id: ownId } })).expectStatus(200).expectJson((s) => {
			expect(s.lines.length).toBeGreaterThan(0);
			expect(s.staffProfileId).toBe(mine.id);
		});
		(await me.client.get("/api/v1/me/payslips/{id}", { params: { id: theirId } })).expectStatus(403);
		(await me.client.get("/api/v1/me/payslips/{id}", { params: { id: 99999999 } })).expectStatus(403);
	});

	test("PAY-13 a superseded payslip is not shown; the correction's is", async ({ request, calls, anon }) => {
		const { client, me, run } = await payroll(request, calls, anon);
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: run.id } })).expectStatus(200);
		const correction = (await client.post(`${PAYROLL}/runs/{id}/correct`, { params: { id: run.id } })).body;
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: correction.id } })).expectStatus(200);
		(await slips(me)).expectJson((list: { payrollRunId: number }[]) => expect(list.map((s) => s.payrollRunId)).toEqual([correction.id]));
	});

	test("PAY-13 a user with no staff profile, and an anonymous caller, are refused", async ({ request, calls, anon }) => {
		const o = await payrollOrg(request, calls);
		const other = await createDisposableUser(o.client, anon, { organisationSlug: o.slug, campusId: o.campusId }, []);
		(await other.client.get("/api/v1/me/payslips")).expectStatus(403);
		(await anon.get("/api/v1/me/payslips")).expectStatus(401);
	});

	test("PAY-13 a payslip's net pay does not change when the staff member's structure is later edited", async ({ request, calls, anon }) => {
		const { client, me, mine, run } = await payroll(request, calls, anon);
		(await client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: run.id } })).expectStatus(200);
		await createStructure(client, mine.id, { effectiveFrom: "2026-09-01", basicAmount: 99999 });
		(await slips(me)).expectJson((list: { netPay: number }[]) => expect(money(list[0].netPay)).toBe(20000));
	});
});
