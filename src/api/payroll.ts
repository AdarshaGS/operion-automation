// Payroll fixtures. A payroll run covers every staff member of the organisation who has a salary structure,
// and there is one run per month, so specs that generate runs work in a throwaway organisation.

import type { APIRequestContext } from "@playwright/test";
import type { ApiClient, RecordedCall } from "./apiClient";
import { createOtherOrganisation, organisationContext, type OtherOrganisation } from "./organisations";
import { createStaff, type Staff } from "./hr";
import { uniqueSuffix } from "./data";

export const PAYROLL = "/api/v1/payroll";
export const STRUCTURES = "/api/v1/hr/staff/{staffId}/salary-structures";

export interface Component {
	id: number;
	name: string;
	type: "EARNING" | "DEDUCTION";
	calculationBasis: "FLAT" | "PERCENT_OF_BASIC";
	status: string;
}

export interface PayslipLine {
	id: number;
	label: string;
	type: "EARNING" | "DEDUCTION";
	source: "BASIC" | "STRUCTURE" | "ADJUSTMENT";
	amount: number;
}

export interface Payslip {
	id: number;
	payrollRunId: number;
	payYear: number;
	payMonth: number;
	runStatus: string;
	staffProfileId: number;
	employeeCode: string;
	staffName: string;
	designationName: string;
	teacher: boolean;
	basicAmount: number;
	grossEarnings: number;
	totalDeductions: number;
	netPay: number;
	lines: PayslipLine[];
}

export interface Run {
	id: number;
	payYear: number;
	payMonth: number;
	status: string;
	supersedesRunId: number | null;
	finalizedAt: string | null;
	payslipCount: number;
	teacherTotals: { count: number; gross: number; deductions: number; net: number };
	staffTotals: { count: number; gross: number; deductions: number; net: number };
	payslips: Payslip[];
}

export interface PayrollOrg {
	org: OtherOrganisation;
	client: ApiClient;
	campusId: number;
	slug: string;
}

/** A throwaway organisation to run payroll in. */
export async function payrollOrg(request: APIRequestContext, calls: RecordedCall[]): Promise<PayrollOrg> {
	const org = await createOtherOrganisation(request, calls);
	const { campusId } = await organisationContext(org);
	return { org, client: org.client, campusId, slug: org.slug };
}

export async function createComponent(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${PAYROLL}/components`, { body: { name: `Comp ${uniqueSuffix()}`, type: "EARNING", calculationBasis: "FLAT", ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as Component;
}

export async function createStructure(api: ApiClient, staffId: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post(STRUCTURES, { params: { staffId }, body: { effectiveFrom: "2026-01-01", basicAmount: 50000, lines: [], ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; staffProfileId: number; effectiveFrom: string; basicAmount: number; lines: { componentId: number; componentName: string; value: number }[] };
}

/** A staff member with a salary structure: `basic` plus `lines` of [component, value]. */
export async function staffWithSalary(api: ApiClient, campusId: number, options: { basic?: number; lines?: [Component, number][]; effectiveFrom?: string; staff?: Record<string, unknown> } = {}): Promise<Staff & { structureId: number }> {
	const staff = await createStaff(api, campusId, options.staff ?? {});
	const structure = await createStructure(api, staff.id, {
		effectiveFrom: options.effectiveFrom ?? "2026-01-01",
		basicAmount: options.basic ?? 50000,
		lines: (options.lines ?? []).map(([component, value]) => ({ componentId: component.id, value })),
	});
	return { ...staff, structureId: structure.id };
}

export async function generateRun(api: ApiClient, year = 2026, month = 6) {
	const res = await api.post(`${PAYROLL}/runs`, { body: { year, month } });
	res.expectStatus([200, 201]);
	return res.body as Run;
}

export async function getRun(api: ApiClient, id: number) {
	return (await api.get(`${PAYROLL}/runs/{id}`, { params: { id } })).expectStatus(200).body as Run;
}

export async function getPayslip(api: ApiClient, id: number) {
	return (await api.get(`${PAYROLL}/payslips/{id}`, { params: { id } })).expectStatus(200).body as Payslip;
}

export const slipOf = (run: Run, staff: { id: number }) => run.payslips.find((p) => p.staffProfileId === staff.id);
