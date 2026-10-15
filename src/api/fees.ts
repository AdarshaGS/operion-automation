// Fee fixtures. Students (and so enrolments) only exist in the shared organisation (Operion #354), so
// every scenario builds its own draft-year class, fee group and structure there: a (year, class) pair holds
// one active structure group, and a fresh class per scenario keeps reruns independent.

import type { ApiClient } from "./apiClient";
import { attendanceSetup, type AttendanceSetup } from "./attendance";
import { uniqueCode } from "./data";

export const FEES = "/api/v1/fees";

export async function createCategory(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const code = uniqueCode("CAT");
	const res = await api.post(`${FEES}/categories`, { body: { code, name: `Category ${code}`, description: "automation", categoryType: "GENERAL", ...overrides } });
	return { res, code, name: `Category ${code}` };
}

export async function createGroup(api: ApiClient, yearId: number, classId: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${FEES}/structure-groups`, { body: { name: uniqueCode("Group"), academicYearId: yearId, schoolClassId: classId, ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; name: string; academicYearId: number; schoolClassId: number; status: string };
}

export interface InstallmentInput {
	installmentNumber: number;
	dueDate: string;
	amount: number;
}

/** Equal installments, due on the 10th of consecutive months of the draft year. */
export function installments(setup: AttendanceSetup, count: number, each: number): InstallmentInput[] {
	return Array.from({ length: count }, (_, i) => ({
		installmentNumber: i + 1,
		dueDate: `${String(setup.year)}-${String(setup.month + i).padStart(2, "0")}-10`,
		amount: each,
	}));
}

export async function createStructure(api: ApiClient, groupId: number, categoryId: number, parts: InstallmentInput[], overrides: Record<string, unknown> = {}) {
	const amount = parts.reduce((sum, part) => sum + part.amount, 0);
	return api.post(`${FEES}/structures`, { body: { feeStructureGroupId: groupId, feeCategoryId: categoryId, amount, installments: parts, paymentFrequency: "MONTHLY", ...overrides } });
}

export interface FeeSetup extends AttendanceSetup {
	group: { id: number };
	category: { id: number; code: string; name: string };
	structure: { id: number; amount: number; installments: { id: number; installmentNumber: number; dueDate: string; amount: number }[] };
	approverId: number;
}

/** A class with `students` enrolled and one structure of `count` installments of `each`. */
export async function feeSetup(api: ApiClient, opts: { students?: number; count?: number; each?: number } = {}): Promise<FeeSetup> {
	const { students = 1, count = 2, each = 1000 } = opts;
	const s = await attendanceSetup(api, students);
	const group = await createGroup(api, s.yearId, s.base.classId);
	const made = await createCategory(api);
	made.res.expectStatus([200, 201]);
	const structure = await createStructure(api, group.id, made.res.body.id, installments(s, count, each));
	structure.expectStatus([200, 201]);
	const approvers = (await api.get(`${FEES}/approvers`)).expectStatus(200).body;
	return { ...s, group, category: { id: made.res.body.id, code: made.code, name: made.name }, structure: structure.body, approverId: approvers[0].userId };
}

export async function assign(api: ApiClient, setup: FeeSetup, index = 0, overrides: Record<string, unknown> = {}) {
	return api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: setup.enrollmentIds[index], feeStructureId: setup.structure.id, paymentFrequency: "MONTHLY", ...overrides } });
}

export async function assigned(api: ApiClient, setup: FeeSetup, index = 0, overrides: Record<string, unknown> = {}) {
	const res = await assign(api, setup, index, overrides);
	res.expectStatus([200, 201]);
	return res.body as { id: number; baseAmount: number; discountAmount: number; effectiveAmount: number; status: string };
}

export async function invoiceFor(api: ApiClient, assignmentId: number, installmentId: number) {
	return api.post(`${FEES}/assignments/{assignmentId}/invoices`, { params: { assignmentId }, body: { feeStructureInstallmentId: installmentId } });
}

export interface Invoiced extends FeeSetup {
	assignment: { id: number; baseAmount: number; effectiveAmount: number };
	invoice: { id: number; invoiceNumber: string; totalAmount: number; amountPaid: number; outstanding: number; status: string };
}

/** Assigns the structure to the first student and invoices installment 1. */
export async function invoiced(api: ApiClient, opts: { students?: number; count?: number; each?: number; assignment?: Record<string, unknown> } = {}): Promise<Invoiced> {
	const setup = await feeSetup(api, opts);
	const assignment = await assigned(api, setup, 0, opts.assignment ?? {});
	const invoice = await invoiceFor(api, assignment.id, setup.structure.installments[0].id);
	invoice.expectStatus([200, 201]);
	return { ...setup, assignment, invoice: invoice.body };
}

export async function pay(api: ApiClient, setup: Pick<FeeSetup, "yearId" | "day">, invoiceId: number, amount: number, overrides: Record<string, unknown> = {}) {
	return api.post(`${FEES}/payments`, {
		body: { academicYearId: setup.yearId, amount, paymentMethod: "CASH", paymentDate: setup.day(12), allocations: [{ invoiceId, amount }], ...overrides },
	});
}

export async function getInvoice(api: ApiClient, invoiceId: number) {
	return (await api.get(`${FEES}/invoices/{invoiceId}`, { params: { invoiceId } })).expectStatus(200).body as Invoiced["invoice"];
}
