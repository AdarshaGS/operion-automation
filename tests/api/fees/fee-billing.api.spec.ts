// Assignments, discounts, invoices, payments, bounces, refunds, waivers and adjustments.
// IDs refer to docs/SCENARIOS.md section 9 (FEE-*). Everything runs in the shared organisation against a
// draft-year class built per scenario (Operion #354 keeps students out of throwaway organisations).

import { test, expect } from "../../../src/api/fixtures";
import { feeSetup, assign, assigned, invoiced, invoiceFor, pay, getInvoice, createCategory, createStructure, createGroup, installments, FEES } from "../../../src/api/fees";
import { attendanceSetup } from "../../../src/api/attendance";
import { createDisposableUser } from "../../../src/api/users";
import { expectShape } from "../../../src/api/shapes";
import { createGuardian, guardianLink } from "../../../src/api/students";

const REVISE = `${FEES}/assignments/{assignmentId}/revise`;

test.describe("assigning a structure", () => {
	test("FEE-16 an assignment carries the base amount, no discount and ACTIVE status", async ({ api }) => {
		const s = await feeSetup(api, { count: 2, each: 1500 });
		const a = await assigned(api, s);
		expectShape(a, { id: "number", studentEnrollmentId: "number", feeStructureId: "number", baseAmount: "number", discountAmount: "number", effectiveAmount: "number", status: "string" });
		expect(a).toMatchObject({ baseAmount: 3000, discountAmount: 0, effectiveAmount: 3000, status: "ACTIVE", studentEnrollmentId: s.enrollmentIds[0] });
	});

	test("FEE-17 assigning the same structure to the same enrolment twice is rejected", async ({ api }) => {
		const s = await feeSetup(api);
		await assigned(api, s);
		(await assign(api, s)).expectStatus(409);
	});

	test("FEE-17 two students can each hold the same structure", async ({ api }) => {
		const s = await feeSetup(api, { students: 2 });
		await assigned(api, s, 0);
		await assigned(api, s, 1);
	});

	test("FEE-17 a structure for another class is rejected for the enrolment", async ({ api }) => {
		const s = await feeSetup(api);
		const other = await feeSetup(api);
		(await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: other.structure.id } })).expectStatus(400);
	});

	test("FEE-17 an unknown enrolment or structure returns 404", async ({ api }) => {
		const s = await feeSetup(api);
		(await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: 99999999, feeStructureId: s.structure.id } })).expectStatus(404);
		(await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: 99999999 } })).expectStatus(404);
	});

	test("FEE-17 the list for an enrolment shows only that student's assignments", async ({ api }) => {
		const s = await feeSetup(api, { students: 2 });
		const mine = await assigned(api, s, 0);
		const theirs = await assigned(api, s, 1);
		const list = (await api.get(`${FEES}/assignments`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).expectStatus(200).body as { id: number }[];
		expect(list.map((a) => a.id)).toContain(mine.id);
		expect(list.map((a) => a.id)).not.toContain(theirs.id);
	});
});

test.describe("discounts", () => {
	test("FEE-18 an approved discount lowers the effective amount and the invoice total in proportion", async ({ api, }) => {
		const s = await feeSetup(api, { count: 2, each: 1000 });
		const a = await assigned(api, s, 0, { discountAmount: 200, discountReason: "Sibling", approvedBy: s.approverId });
		expect(a).toMatchObject({ baseAmount: 2000, discountAmount: 200, effectiveAmount: 1800 });
		const invoice = (await invoiceFor(api, a.id, s.structure.installments[0].id)).expectStatus([200, 201]).body;
		expect(invoice.totalAmount).toBe(900);
	});

	test("FEE-18 a discount without a reason returns 400", async ({ api }) => {
		const s = await feeSetup(api);
		(await assign(api, s, 0, { discountAmount: 100, approvedBy: s.approverId })).expectStatus(400);
	});

	test("FEE-18 a discount without an approver returns 400", async ({ api }) => {
		const s = await feeSetup(api);
		(await assign(api, s, 0, { discountAmount: 100, discountReason: "Sibling" })).expectStatus(400);
	});

	test("FEE-18 a discount larger than the structure amount returns 400", async ({ api }) => {
		const s = await feeSetup(api);
		(await assign(api, s, 0, { discountAmount: 99999, discountReason: "x", approvedBy: s.approverId })).expectStatus(400);
	});

	test("FEE-18 a negative discount returns 400", async ({ api }) => {
		const s = await feeSetup(api);
		(await assign(api, s, 0, { discountAmount: -10 })).expectStatus(400);
	});

	test("FEE-31 a discount approved by someone who is not an eligible approver is rejected", async ({ api }) => {
		const s = await feeSetup(api);
		const res = await assign(api, s, 0, { discountAmount: 100, discountReason: "x", approvedBy: 99999999 });
		res.expectStatus([400, 403, 422]);
	});

	test("FEE-31 granting a discount needs the discount-approval permission, not just assignment rights", async ({ api, as }) => {
		const s = await feeSetup(api);
		// feesCollector can assign fees (FEE_ASSIGNMENT_MANAGE) but holds no FEE_DISCOUNT_APPROVE.
		const res = await as("feesCollector").post(`${FEES}/assignments`, {
			body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: s.structure.id, discountAmount: 500, discountReason: "Friend of the principal", approvedBy: s.approverId },
		});
		res.expectStatus(403);
	});

	test("FEE-31 the approvers list names the owner and everyone else holding structure-management rights", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["FEE_VIEW", "FEE_STRUCTURE_MANAGE"]);
		const bystander = await createDisposableUser(api, anon, seed, ["FEE_VIEW", "FEE_WAIVER_APPROVE", "FEE_REFUND_APPROVE"]);
		const approvers = (await api.get(`${FEES}/approvers`)).expectStatus(200).body as { userId: number; name: string }[];
		const ids = approvers.map((a) => a.userId);
		expect(ids).toContain(manager.userId);
		expect(ids).not.toContain(bystander.userId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const approver of approvers) expectShape(approver, { userId: "number", name: "string" });
	});

	test("FEE-31 a user who holds waiver rights but is not an approver cannot be named as the approver", async ({ api, anon, seed }) => {
		const bystander = await createDisposableUser(api, anon, seed, ["FEE_VIEW", "FEE_WAIVER_APPROVE"]);
		const i = await invoiced(api);
		const res = await api.post(`${FEES}/waivers`, { body: { invoiceId: i.invoice.id, amount: 10, reason: "x", approvedBy: bystander.userId, waiverDate: i.day(13) } });
		res.expectStatus([400, 403, 422]);
	});

	test("FEE-31 a member who holds structure rights can be named as the approver", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["FEE_VIEW", "FEE_STRUCTURE_MANAGE"]);
		const s = await feeSetup(api);
		const a = await assigned(api, s, 0, { discountAmount: 50, discountReason: "Staff child", approvedBy: manager.userId });
		expect(a.effectiveAmount).toBe(1950);
	});
});

test.describe("revising an assignment", () => {
	test("FEE-18 before any invoice, the revision updates the same assignment in place", async ({ api }) => {
		const s = await feeSetup(api);
		const a = await assigned(api, s);
		const revised = await api.post(REVISE, { params: { assignmentId: a.id }, body: { discountAmount: 300, discountReason: "Merit", approvedBy: s.approverId, paymentFrequency: "QUARTERLY" } });
		revised.expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ id: a.id, discountAmount: 300, effectiveAmount: 1700, paymentFrequency: "QUARTERLY", status: "ACTIVE" });
		});
		const list = (await api.get(`${FEES}/assignments`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body as unknown[];
		expect(list).toHaveLength(1);
	});

	test("FEE-18 after an invoice exists, the old assignment is superseded and a new one takes over", async ({ api }) => {
		const i = await invoiced(api);
		const revised = await api.post(REVISE, { params: { assignmentId: i.assignment.id }, body: { discountAmount: 500, discountReason: "Hardship", approvedBy: i.approverId } });
		revised.expectStatus(200);
		expect(revised.body.id).not.toBe(i.assignment.id);
		expect(revised.body).toMatchObject({ discountAmount: 500, effectiveAmount: 1500, status: "ACTIVE" });
		const list = (await api.get(`${FEES}/assignments`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as { id: number; status: string }[];
		expect(list.find((a) => a.id === i.assignment.id)?.status).toBe("SUPERSEDED");
		expect(list.filter((a) => a.status === "ACTIVE")).toHaveLength(1);
		(await getInvoice(api, i.invoice.id)).totalAmount; // the issued invoice is untouched
		expect((await getInvoice(api, i.invoice.id)).totalAmount).toBe(1000);
	});

	test("FEE-18 a superseded assignment can no longer be invoiced", async ({ api }) => {
		const i = await invoiced(api);
		(await api.post(REVISE, { params: { assignmentId: i.assignment.id }, body: { discountAmount: 0 } })).expectStatus(200);
		(await invoiceFor(api, i.assignment.id, i.structure.installments[1].id)).expectStatus(409);
	});

	test("FEE-18 a revision without a frequency keeps the existing one", async ({ api }) => {
		const s = await feeSetup(api);
		const a = await assigned(api, s, 0, { paymentFrequency: "HALF_YEARLY" });
		(await api.post(REVISE, { params: { assignmentId: a.id }, body: { discountAmount: 0 } })).expectStatus(200).expectJson((body) => expect(body.paymentFrequency).toBe("HALF_YEARLY"));
	});

	test("FEE-18 a revision that adds a discount without a reason returns 400", async ({ api }) => {
		const s = await feeSetup(api);
		const a = await assigned(api, s);
		(await api.post(REVISE, { params: { assignmentId: a.id }, body: { discountAmount: 100, approvedBy: s.approverId } })).expectStatus(400);
	});

	test("FEE-18 revising an unknown assignment returns 404; revising needs FEE_ASSIGNMENT_MANAGE", async ({ api, as }) => {
		(await api.post(REVISE, { params: { assignmentId: 99999999 }, body: { discountAmount: 0 } })).expectStatus(404);
		(await as("readOnlyStaff").post(REVISE, { params: { assignmentId: 1 }, body: { discountAmount: 0 } })).expectStatus(403);
	});
});

test.describe("invoices", () => {
	test("FEE-19 an invoice is issued for the installment with its amount and due date", async ({ api }) => {
		const i = await invoiced(api, { count: 3, each: 500 });
		expectShape(i.invoice, { id: "number", invoiceNumber: "string", totalAmount: "number", amountPaid: "number", outstanding: "number", dueDate: "string", status: "string" });
		expect(i.invoice).toMatchObject({ totalAmount: 500, amountPaid: 0, outstanding: 500, status: "ISSUED", dueDate: i.structure.installments[0].dueDate });
	});

	test("FEE-20 invoicing the same installment twice is rejected and creates no second invoice", async ({ api }) => {
		const i = await invoiced(api);
		(await invoiceFor(api, i.assignment.id, i.structure.installments[0].id)).expectStatus(409);
		const list = (await api.get(`${FEES}/invoices`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as unknown[];
		expect(list).toHaveLength(1);
	});

	test("FEE-20 different installments of one assignment each get an invoice", async ({ api }) => {
		const i = await invoiced(api, { count: 3, each: 400 });
		(await invoiceFor(api, i.assignment.id, i.structure.installments[1].id)).expectStatus([200, 201]);
		(await invoiceFor(api, i.assignment.id, i.structure.installments[2].id)).expectStatus([200, 201]);
		const list = (await api.get(`${FEES}/invoices`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as unknown[];
		expect(list).toHaveLength(3);
	});

	test("FEE-20 an installment from another structure is rejected", async ({ api }) => {
		const i = await invoiced(api);
		const other = await feeSetup(api);
		(await invoiceFor(api, i.assignment.id, other.structure.installments[0].id)).expectStatus([400, 409]);
	});

	test("FEE-20 an unknown installment or assignment returns 404", async ({ api }) => {
		const i = await invoiced(api);
		(await invoiceFor(api, i.assignment.id, 99999999)).expectStatus(404);
		(await invoiceFor(api, 99999999, i.structure.installments[1].id)).expectStatus(404);
	});

	test("FEE-20 an invoice body without the installment id returns 400", async ({ api }) => {
		const i = await invoiced(api);
		(await api.post(`${FEES}/assignments/{assignmentId}/invoices`, { params: { assignmentId: i.assignment.id }, body: {} })).expectStatus(400);
	});

	test("FEE-20 invoicing needs FEE_INVOICE_MANAGE", async ({ api, as }) => {
		const s = await feeSetup(api);
		const a = await assigned(api, s);
		(await invoiceFor(as("readOnlyStaff"), a.id, s.structure.installments[0].id)).expectStatus(403);
		(await invoiceFor(as("noPermissions"), a.id, s.structure.installments[0].id)).expectStatus(403);
	});

	test("FEE-21 invoices generated at the same moment for a year's very first numbers all succeed with distinct numbers", async ({ api }) => {
		const s = await feeSetup(api, { students: 4, count: 1, each: 100 });
		const assignments = [];
		for (let n = 0; n < 4; n++) assignments.push(await assigned(api, s, n));
		const results = await Promise.all(assignments.map((a) => invoiceFor(api, a.id, s.structure.installments[0].id)));
		for (const res of results) res.expectStatus([200, 201]);
		const numbers = results.map((r) => r.body.invoiceNumber as string);
		expect(new Set(numbers).size).toBe(4);
	});

	test("FEE-22 invoice numbers within a year run in sequence, follow the template and never repeat", async ({ api }) => {
		const s = await feeSetup(api, { students: 3, count: 1, each: 100 });
		const numbers: string[] = [];
		for (let n = 0; n < 3; n++) {
			const a = await assigned(api, s, n);
			numbers.push((await invoiceFor(api, a.id, s.structure.installments[0].id)).expectStatus([200, 201]).body.invoiceNumber);
		}
		expect(new Set(numbers).size).toBe(3);
		const serials = numbers.map((n) => Number(n.split("-").pop()));
		expect(serials).toEqual([serials[0], serials[0] + 1, serials[0] + 2]);
		for (const number of numbers) expect(number).toMatch(/^INV-.+-\d{6}$/);
		expect(numbers.every((n) => n.includes(s.yearName))).toBe(true);
	});

	test("FEE-22 a new academic year starts its own invoice series", async ({ api }) => {
		const first = await invoiced(api, { count: 1, each: 100 });
		const second = await invoiced(api, { count: 1, each: 100 });
		expect(first.invoice.invoiceNumber.split("-").pop()).toBe("000001");
		expect(second.invoice.invoiceNumber.split("-").pop()).toBe("000001");
		expect(first.invoice.invoiceNumber).not.toBe(second.invoice.invoiceNumber);
	});

	test("FEE-22 receipt numbers run in their own sequence", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 300 });
		const one = (await pay(api, i, i.invoice.id, 100)).expectStatus([200, 201]).body.receiptNumber as string;
		const two = (await pay(api, i, i.invoice.id, 100)).expectStatus([200, 201]).body.receiptNumber as string;
		expect(one).toMatch(/^RCT-.+-000001$/);
		expect(two).toMatch(/^RCT-.+-000002$/);
	});

	test("FEE-33 the invoice list for an enrolment is ordered and scoped to that student", async ({ api }) => {
		const i = await invoiced(api, { students: 2, count: 2, each: 200 });
		const other = await assigned(api, i, 1);
		await invoiceFor(api, other.id, i.structure.installments[0].id);
		const list = (await api.get(`${FEES}/invoices`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as { id: number }[];
		expect(list.map((x) => x.id)).toEqual([i.invoice.id]);
	});
});

test.describe("payments", () => {
	test("FEE-24 a partial payment leaves the invoice PARTIALLY_PAID with the right balance", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await pay(api, i, i.invoice.id, 400)).expectStatus([200, 201]);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 400, outstanding: 600, status: "PARTIALLY_PAID" });
	});

	test("FEE-24 payments in parts add up until the invoice is PAID", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await pay(api, i, i.invoice.id, 400);
		await pay(api, i, i.invoice.id, 350);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 750, outstanding: 250, status: "PARTIALLY_PAID" });
		await pay(api, i, i.invoice.id, 250);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 1000, outstanding: 0, status: "PAID" });
	});

	test("FEE-24 one payment can be split across two invoices", async ({ api }) => {
		const i = await invoiced(api, { count: 2, each: 500 });
		const second = (await invoiceFor(api, i.assignment.id, i.structure.installments[1].id)).expectStatus([200, 201]).body;
		const res = await api.post(`${FEES}/payments`, {
			body: { academicYearId: i.yearId, amount: 800, paymentMethod: "CASH", paymentDate: i.day(12), allocations: [{ invoiceId: i.invoice.id, amount: 500 }, { invoiceId: second.id, amount: 300 }] },
		});
		res.expectStatus([200, 201]);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ status: "PAID" });
		expect(await getInvoice(api, second.id)).toMatchObject({ amountPaid: 300, outstanding: 200, status: "PARTIALLY_PAID" });
		const history = (await api.get(`${FEES}/payments`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as { id: number }[];
		expect(history.filter((p) => p.id === res.body.id)).toHaveLength(1);
	});

	test("FEE-25 a payment larger than the outstanding balance is rejected and changes nothing", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, 900)).expectStatus([400, 409, 422]);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 0, status: "ISSUED" });
	});

	test("FEE-25 two allocations to one invoice cannot together exceed its balance", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const res = await api.post(`${FEES}/payments`, {
			body: { academicYearId: i.yearId, amount: 800, paymentMethod: "CASH", paymentDate: i.day(12), allocations: [{ invoiceId: i.invoice.id, amount: 400 }, { invoiceId: i.invoice.id, amount: 400 }] },
		});
		res.expectStatus([400, 409, 422]);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 0 });
	});

	test("FEE-25 a zero payment returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, 0)).expectStatus(400);
	});

	test("FEE-25 a negative payment returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, -5)).expectStatus(400);
		expect((await getInvoice(api, i.invoice.id)).amountPaid).toBeGreaterThanOrEqual(0);
	});

	test("FEE-25 allocations that do not add up to the payment amount return 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const res = await api.post(`${FEES}/payments`, { body: { academicYearId: i.yearId, amount: 100, paymentMethod: "CASH", paymentDate: i.day(12), allocations: [{ invoiceId: i.invoice.id, amount: 50 }] } });
		res.expectStatus(400);
	});

	test("FEE-25 a payment without allocations returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, 100, { allocations: [] })).expectStatus(400);
		const missing = await api.post(`${FEES}/payments`, { body: { academicYearId: i.yearId, amount: 100, paymentMethod: "CASH", paymentDate: i.day(12) } });
		missing.expectStatus(400);
	});

	test("FEE-25 a payment against an unknown invoice or year returns 404", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, 99999999, 10)).expectStatus(404);
		(await pay(api, i, i.invoice.id, 10, { academicYearId: 99999999 })).expectStatus(404);
	});

	test("FEE-25 a receipt dated in the far future returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, 10, { paymentDate: "2999-01-01" })).expectStatus(400);
	});

	test("FEE-25 a payment missing its amount or date returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const noAmount = await api.post(`${FEES}/payments`, { body: { academicYearId: i.yearId, paymentMethod: "CASH", paymentDate: i.day(12), allocations: [{ invoiceId: i.invoice.id, amount: 10 }] } });
		noAmount.expectStatus(400);
		const noDate = await api.post(`${FEES}/payments`, { body: { academicYearId: i.yearId, amount: 10, paymentMethod: "CASH", allocations: [{ invoiceId: i.invoice.id, amount: 10 }] } });
		noDate.expectStatus(400);
	});

	test("FEE-26 recording a payment needs FEE_COLLECT, even for a fee viewer", async ({ api, as }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(as("readOnlyStaff"), i, i.invoice.id, 10)).expectStatus(403);
		(await pay(as("noPermissions"), i, i.invoice.id, 10)).expectStatus(403);
		(await pay(as("feesCollector"), i, i.invoice.id, 10)).expectStatus([200, 201]);
	});

	test("FEE-36 a payment can be read back by id with its receipt number", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const made = (await pay(api, i, i.invoice.id, 200, { remarks: "Term one" })).expectStatus([200, 201]).body;
		(await api.get(`${FEES}/payments/{paymentId}`, { params: { paymentId: made.id } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ id: made.id, receiptNumber: made.receiptNumber, amount: 200, status: "CLEARED", remarks: "Term one" });
		});
		(await api.get(`${FEES}/payments/{paymentId}`, { params: { paymentId: 99999999 } })).expectStatus(404);
	});

	test("FEE-36 the payment history is newest first", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		await pay(api, i, i.invoice.id, 100, { paymentDate: i.day(5) });
		await pay(api, i, i.invoice.id, 100, { paymentDate: i.day(20) });
		await pay(api, i, i.invoice.id, 100, { paymentDate: i.day(10) });
		const history = (await api.get(`${FEES}/payments`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as { paymentDate: string }[];
		expect(history.map((p) => p.paymentDate)).toEqual([i.day(20), i.day(10), i.day(5)]);
	});
});

test.describe("payment methods", () => {
	for (const method of ["CASH", "UPI", "CARD", "BANK_TRANSFER", "ONLINE", "CHEQUE"]) {
		test(`FEE-27 ${method} is accepted and recorded`, async ({ api }) => {
			const i = await invoiced(api, { count: 1, each: 500 });
			const extra = method === "CHEQUE" ? { paymentReference: "CHQ-1", paymentBankName: "HDFC" } : {};
			(await pay(api, i, i.invoice.id, 50, { paymentMethod: method, ...extra })).expectStatus([200, 201]).expectJson((body) => expect(body.paymentMethod).toBe(method));
		});
	}

	test("FEE-27 a cheque keeps its number and bank name", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const made = (await pay(api, i, i.invoice.id, 50, { paymentMethod: "CHEQUE", paymentReference: "CHQ-778899", paymentBankName: "State Bank" })).expectStatus([200, 201]).body;
		(await api.get(`${FEES}/payments/{paymentId}`, { params: { paymentId: made.id } })).expectStatus(200).expectJson((body) => {
			expect(body).toMatchObject({ paymentReference: "CHQ-778899", paymentBankName: "State Bank" });
		});
	});

	test("FEE-27 a cheque without a bank name or number returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		(await pay(api, i, i.invoice.id, 50, { paymentMethod: "CHEQUE" })).expectStatus(400);
		(await pay(api, i, i.invoice.id, 50, { paymentMethod: "CHEQUE", paymentReference: "CHQ-1" })).expectStatus(400);
	});

	test("FEE-27 an unknown payment method returns 400 without naming a Java class", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const res = await pay(api, i, i.invoice.id, 50, { paymentMethod: "BARTER" });
		res.expectStatus(400);
		expect(JSON.stringify(res.body)).not.toMatch(/com\.operion|enum constant/i);
	});
});

test.describe("bounced payments", () => {
	test("FEE-28 bouncing a cheque takes its amount back off the invoice and reopens it", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const cheque = (await pay(api, i, i.invoice.id, 1000, { paymentMethod: "CHEQUE", paymentReference: "C-1", paymentBankName: "HDFC" })).expectStatus([200, 201]).body;
		expect((await getInvoice(api, i.invoice.id)).status).toBe("PAID");
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } })).expectStatus(200).expectJson((body) => expect(body.status).toBe("BOUNCED"));
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 0, outstanding: 1000, status: "ISSUED" });
	});

	test("FEE-28 a bounce reverses only the bounced payment", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await pay(api, i, i.invoice.id, 300);
		const cheque = (await pay(api, i, i.invoice.id, 200, { paymentMethod: "CHEQUE", paymentReference: "C-2", paymentBankName: "HDFC" })).expectStatus([200, 201]).body;
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } })).expectStatus(200);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 300, outstanding: 700, status: "PARTIALLY_PAID" });
	});

	test("FEE-28 the bounced payment stays in the history as BOUNCED, and the invoice can be paid again", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const cheque = (await pay(api, i, i.invoice.id, 500, { paymentMethod: "CHEQUE", paymentReference: "C-3", paymentBankName: "HDFC" })).body;
		await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } });
		const history = (await api.get(`${FEES}/payments`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body as { id: number; status: string }[];
		expect(history.find((p) => p.id === cheque.id)?.status).toBe("BOUNCED");
		(await pay(api, i, i.invoice.id, 500)).expectStatus([200, 201]);
		expect((await getInvoice(api, i.invoice.id)).status).toBe("PAID");
	});

	test("FEE-28 bouncing the same payment twice returns 409 and reverses it only once", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await pay(api, i, i.invoice.id, 400);
		const cheque = (await pay(api, i, i.invoice.id, 100, { paymentMethod: "CHEQUE", paymentReference: "C-4", paymentBankName: "HDFC" })).body;
		await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } });
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } })).expectStatus(409);
		expect((await getInvoice(api, i.invoice.id)).amountPaid).toBe(400);
	});

	test("FEE-28 bouncing an unknown payment returns 404; bouncing needs FEE_COLLECT", async ({ api, as }) => {
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: 99999999 } })).expectStatus(404);
		(await as("readOnlyStaff").post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: 1 } })).expectStatus(403);
	});

	test("FEE-28 a payment that was partly refunded cannot push the invoice's paid amount below zero when bounced", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const cheque = (await pay(api, i, i.invoice.id, 1000, { paymentMethod: "CHEQUE", paymentReference: "C-5", paymentBankName: "HDFC" })).body;
		await api.post(`${FEES}/refunds`, { body: { paymentId: cheque.id, invoiceId: i.invoice.id, amount: 400, reason: "Overcharged", approvedBy: i.approverId, refundDate: i.day(14) } });
		await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } });
		expect((await getInvoice(api, i.invoice.id)).amountPaid).toBeGreaterThanOrEqual(0);
	});
});

test.describe("refunds", () => {
	const refund = (api: Parameters<typeof pay>[0], paymentId: number, invoiceId: number, day: string, approverId: number, amount: number, extra: Record<string, unknown> = {}) =>
		api.post(`${FEES}/refunds`, { body: { paymentId, invoiceId, amount, reason: "Duplicate payment", approvedBy: approverId, refundDate: day, ...extra } });

	test("FEE-29 a refund gives money back and reopens part of the invoice", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 1000)).body;
		const made = await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 250);
		made.expectStatus([200, 201]).expectJson((body) => expect(body).toMatchObject({ paymentId: payment.id, invoiceId: i.invoice.id, amount: 250, reason: "Duplicate payment" }));
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 750, outstanding: 250, status: "PARTIALLY_PAID" });
	});

	test("FEE-29 a refund larger than what was paid is rejected and changes nothing", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 300)).body;
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 99999)).expectStatus([400, 409, 422]);
		expect((await getInvoice(api, i.invoice.id)).amountPaid).toBe(300);
	});

	test("FEE-29 refunds together cannot exceed the payment they refund", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 500)).body;
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 400)).expectStatus([200, 201]);
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 400)).expectStatus([400, 409, 422]);
	});

	test("FEE-29 a negative or zero refund returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 500)).body;
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, -10)).expectStatus(400);
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 0)).expectStatus(400);
		expect((await getInvoice(api, i.invoice.id)).amountPaid).toBe(500);
	});

	test("FEE-29 a refund must name an invoice the payment actually paid", async ({ api }) => {
		const i = await invoiced(api, { count: 2, each: 500 });
		const other = (await invoiceFor(api, i.assignment.id, i.structure.installments[1].id)).body;
		await pay(api, i, other.id, 500);
		const payment = (await pay(api, i, i.invoice.id, 200)).body;
		(await refund(api, payment.id, other.id, i.day(14), i.approverId, 100)).expectStatus([400, 409, 422]);
	});

	test("FEE-29 a payment that has bounced cannot be refunded", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const cheque = (await pay(api, i, i.invoice.id, 500, { paymentMethod: "CHEQUE", paymentReference: "C-9", paymentBankName: "HDFC" })).body;
		await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } });
		(await refund(api, cheque.id, i.invoice.id, i.day(14), i.approverId, 100)).expectStatus([400, 409, 422]);
	});

	test("FEE-29 a refund needs a reason", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 500)).body;
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 50, { reason: undefined })).expectStatus(400);
		(await refund(api, payment.id, i.invoice.id, i.day(14), i.approverId, 50, { reason: "  " })).expectStatus(400);
	});

	test("FEE-29 a refund needs an approver who is eligible", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 500)).body;
		(await refund(api, payment.id, i.invoice.id, i.day(14), 99999999, 50)).expectStatus([400, 403, 422]);
		(await refund(api, payment.id, i.invoice.id, i.day(14), undefined as unknown as number, 50)).expectStatus(400);
	});

	test("FEE-29 an unknown payment or invoice returns 404", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await refund(api, 99999999, i.invoice.id, i.day(14), i.approverId, 10)).expectStatus(404);
		(await refund(api, 1, 99999999, i.day(14), i.approverId, 10)).expectStatus(404);
	});

	test("FEE-29 refunds need FEE_REFUND_APPROVE: a collector or viewer gets 403", async ({ api, as }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const payment = (await pay(api, i, i.invoice.id, 500)).body;
		for (const role of ["feesCollector", "readOnlyStaff", "noPermissions"] as const) {
			(await refund(as(role), payment.id, i.invoice.id, i.day(14), i.approverId, 10)).expectStatus(403);
		}
	});
});

test.describe("waivers", () => {
	const waive = (api: Parameters<typeof pay>[0], invoiceId: number, day: string, approverId: number | undefined, amount: number, extra: Record<string, unknown> = {}) =>
		api.post(`${FEES}/waivers`, { body: { invoiceId, amount, reason: "Hardship", approvedBy: approverId, waiverDate: day, ...extra } });

	test("FEE-30 a waiver lowers the invoice total and balance, and shows in the waiver list", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		const made = await waive(api, i.invoice.id, i.day(13), i.approverId, 300);
		made.expectStatus([200, 201]).expectJson((body) => expect(body).toMatchObject({ invoiceId: i.invoice.id, amount: 300, reason: "Hardship", approvedBy: i.approverId }));
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 700, outstanding: 700, status: "ISSUED" });
		(await api.get(`${FEES}/waivers`, { query: { invoiceId: i.invoice.id } })).expectStatus(200).expectJson((list) => expect(list.map((w: { id: number }) => w.id)).toEqual([made.body.id]));
	});

	test("FEE-30 waiving the whole balance marks the invoice PAID", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		await waive(api, i.invoice.id, i.day(13), i.approverId, 500);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 0, outstanding: 0, status: "PAID" });
	});

	test("FEE-30 a waiver cannot exceed what is still owed, after earlier payments", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await pay(api, i, i.invoice.id, 800);
		(await waive(api, i.invoice.id, i.day(13), i.approverId, 500)).expectStatus([400, 409, 422]);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 1000, outstanding: 200 });
	});

	test("FEE-30 a waiver without a reason returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await waive(api, i.invoice.id, i.day(13), i.approverId, 10, { reason: undefined })).expectStatus(400);
		(await waive(api, i.invoice.id, i.day(13), i.approverId, 10, { reason: " " })).expectStatus(400);
	});

	test("FEE-30 a waiver without an approver returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await waive(api, i.invoice.id, i.day(13), undefined, 10)).expectStatus(400);
	});

	test("FEE-30 a negative or zero waiver returns 400 and does not raise the total", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await waive(api, i.invoice.id, i.day(13), i.approverId, -100)).expectStatus(400);
		(await waive(api, i.invoice.id, i.day(13), i.approverId, 0)).expectStatus(400);
		expect((await getInvoice(api, i.invoice.id)).totalAmount).toBe(1000);
	});

	test("FEE-30 a waiver on an unknown invoice returns 404", async ({ api }) => {
		const s = await feeSetup(api);
		(await waive(api, 99999999, s.day(13), s.approverId, 10)).expectStatus(404);
	});

	test("FEE-31 waivers need FEE_WAIVER_APPROVE: a collector or viewer gets 403", async ({ api, as }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		for (const role of ["feesCollector", "readOnlyStaff", "noPermissions"] as const) {
			(await waive(as(role), i.invoice.id, i.day(13), i.approverId, 10)).expectStatus(403);
		}
		(await as("feesCollector").get(`${FEES}/waivers`, { query: { invoiceId: i.invoice.id } })).expectStatus(200);
		(await as("noPermissions").get(`${FEES}/waivers`, { query: { invoiceId: i.invoice.id } })).expectStatus(403);
	});

	test("FEE-31 an approver id that does not belong to an eligible member is rejected", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await waive(api, i.invoice.id, i.day(13), 99999999, 10)).expectStatus([400, 403, 422]);
	});
});

test.describe("adjustments", () => {
	const adjust = (api: Parameters<typeof pay>[0], invoiceId: number, day: string, approverId: number | undefined, amount: number, extra: Record<string, unknown> = {}) =>
		api.post(`${FEES}/adjustments`, { body: { invoiceId, amount, reason: "Billing correction", approvedBy: approverId, adjustmentDate: day, ...extra } });

	test("FEE-32 a positive adjustment raises the invoice total", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await adjust(api, i.invoice.id, i.day(13), i.approverId, 150)).expectStatus([200, 201]).expectJson((body) => expect(body).toMatchObject({ invoiceId: i.invoice.id, amount: 150 }));
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 1150, outstanding: 1150 });
	});

	test("FEE-32 a negative adjustment lowers it, and both are listed for the invoice", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await adjust(api, i.invoice.id, i.day(13), i.approverId, 100);
		await adjust(api, i.invoice.id, i.day(14), i.approverId, -250);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 850 });
		(await api.get(`${FEES}/adjustments`, { query: { invoiceId: i.invoice.id } })).expectStatus(200).expectJson((list) => expect(list.map((a: { amount: number }) => a.amount).sort()).toEqual([-250, 100]));
	});

	test("FEE-32 raising a paid invoice reopens it as PARTIALLY_PAID", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		await pay(api, i, i.invoice.id, 500);
		await adjust(api, i.invoice.id, i.day(13), i.approverId, 100);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 600, amountPaid: 500, outstanding: 100, status: "PARTIALLY_PAID" });
	});

	test("FEE-32 an adjustment cannot take the total below what has been paid", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await pay(api, i, i.invoice.id, 600);
		(await adjust(api, i.invoice.id, i.day(13), i.approverId, -500)).expectStatus([400, 409, 422]);
		expect((await getInvoice(api, i.invoice.id)).totalAmount).toBe(1000);
	});

	test("FEE-32 an adjustment without a reason or approver returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await adjust(api, i.invoice.id, i.day(13), i.approverId, 10, { reason: undefined })).expectStatus(400);
		(await adjust(api, i.invoice.id, i.day(13), undefined, 10)).expectStatus(400);
		(await adjust(api, i.invoice.id, i.day(13), 99999999, 10)).expectStatus([400, 403, 422]);
	});

	test("FEE-32 an adjustment of zero returns 400", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		(await adjust(api, i.invoice.id, i.day(13), i.approverId, 0)).expectStatus(400);
	});

	test("FEE-32 adjustments need FEE_ADJUSTMENT_MANAGE; the list needs FEE_VIEW", async ({ api, as }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		for (const role of ["feesCollector", "readOnlyStaff", "noPermissions"] as const) {
			(await adjust(as(role), i.invoice.id, i.day(13), i.approverId, 10)).expectStatus(403);
		}
		(await as("feesCollector").get(`${FEES}/adjustments`, { query: { invoiceId: i.invoice.id } })).expectStatus(200);
		(await as("noPermissions").get(`${FEES}/adjustments`, { query: { invoiceId: i.invoice.id } })).expectStatus(403);
	});

	test("FEE-32 an adjustment on an unknown invoice returns 404", async ({ api }) => {
		const s = await feeSetup(api);
		(await adjust(api, 99999999, s.day(13), s.approverId, 10)).expectStatus(404);
	});
});

test.describe("overdue invoices and reminders", () => {
	async function overdueSetup(api: Parameters<typeof pay>[0], students = 1) {
		const s = await attendanceSetup(api, students);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const past = [{ installmentNumber: 1, dueDate: "2020-01-10", amount: 500 }, { installmentNumber: 2, dueDate: "2020-02-10", amount: 500 }];
		const structure = (await createStructure(api, group.id, category.res.body.id, past)).expectStatus([200, 201]).body;
		const approvers = (await api.get(`${FEES}/approvers`)).body;
		const assignment = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[0], feeStructureId: structure.id, paymentFrequency: "MONTHLY" } })).expectStatus([200, 201]).body;
		const first = (await invoiceFor(api, assignment.id, structure.installments[0].id)).body;
		const second = (await invoiceFor(api, assignment.id, structure.installments[1].id)).body;
		return { ...s, structure, assignment, first, second, approverId: approvers[0].userId };
	}

	test("FEE-34 unpaid past-due invoices are listed oldest first with days overdue", async ({ api }) => {
		const o = await overdueSetup(api);
		const list = (await api.get(`${FEES}/invoices/overdue`, { query: { studentEnrollmentId: o.enrollmentIds[0] } })).expectStatus(200).body as { id: number; daysOverdue: number; outstanding: number }[];
		expect(list.map((x) => x.id)).toEqual([o.first.id, o.second.id]);
		expect(list[0].daysOverdue).toBeGreaterThan(list[1].daysOverdue);
		expect(list[0].outstanding).toBe(500);
	});

	test("FEE-34 a paid invoice leaves the overdue list; a part-paid one stays", async ({ api }) => {
		const o = await overdueSetup(api);
		await pay(api, o, o.second.id, 500);
		await pay(api, o, o.first.id, 100);
		const list = (await api.get(`${FEES}/invoices/overdue`, { query: { studentEnrollmentId: o.enrollmentIds[0] } })).body as { id: number; outstanding: number }[];
		expect(list.map((x) => x.id)).toEqual([o.first.id]);
		expect(list[0].outstanding).toBe(400);
	});

	test("FEE-34 a not-yet-due invoice is not overdue", async ({ api }) => {
		const i = await invoiced(api);
		const list = (await api.get(`${FEES}/invoices/overdue`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).expectStatus(200).body as unknown[];
		expect(list).toHaveLength(0);
	});

	test("FEE-34 the overdue list can be narrowed by class", async ({ api }) => {
		const o = await overdueSetup(api);
		const other = await overdueSetup(api);
		const list = (await api.get(`${FEES}/invoices/overdue`, { query: { schoolClassId: o.base.classId } })).body as { id: number; schoolClassId: number }[];
		expect(list.map((x) => x.id)).toEqual(expect.arrayContaining([o.first.id, o.second.id]));
		expect(list.map((x) => x.id)).not.toContain(other.first.id);
		expect(new Set(list.map((x) => x.schoolClassId))).toEqual(new Set([o.base.classId]));
	});

	test("FEE-37 a reminder for an overdue invoice reaches the guardian who accepts communication", async ({ api }) => {
		const o = await overdueSetup(api);
		const guardian = await createGuardian(api, { email: `parent-${Date.now()}@example.test`, phone: "+919876543210" });
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: o.studentIds[0] }, body: guardianLink(guardian.id, { primaryGuardian: true }) })).expectStatus(200);
		const res = await api.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [o.first.id, o.second.id] } });
		res.expectStatus(200).expectJson((list) => {
			expect(list.map((r: { invoiceId: number }) => r.invoiceId)).toEqual([o.first.id, o.second.id]);
			for (const row of list) expectShape(row, { invoiceId: "number", recipientsNotified: "number" });
			expect(list[0].recipientsNotified).toBe(1);
		});
	});

	test("FEE-37 a student with no guardian on file is reported as zero recipients", async ({ api }) => {
		const o = await overdueSetup(api);
		const res = await api.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [o.first.id] } });
		res.expectStatus(200).expectJson((list) => expect(list).toEqual([{ invoiceId: o.first.id, recipientsNotified: 0 }]));
	});

	test("FEE-37 no reminder goes out for an invoice that is already paid", async ({ api }) => {
		const o = await overdueSetup(api);
		const guardian = await createGuardian(api, { email: `parent-${Date.now()}@example.test`, phone: "+919876543210" });
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: o.studentIds[0] }, body: guardianLink(guardian.id, { primaryGuardian: true }) })).expectStatus(200);
		await pay(api, o, o.second.id, 500);
		const res = await api.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [o.second.id] } });
		res.expectStatus(200).expectJson((list) => expect(list.reduce((n: number, r: { recipientsNotified: number }) => n + r.recipientsNotified, 0)).toBe(0));
	});

	test("FEE-37 an unknown invoice id returns 404 and an empty list returns an empty result", async ({ api }) => {
		const o = await overdueSetup(api);
		(await api.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [o.first.id, 99999999] } })).expectStatus(404);
		(await api.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [] } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("FEE-37 a request without invoiceIds returns 400, not 500", async ({ api }) => {
		(await api.post(`${FEES}/invoices/send-reminders`, { body: {} })).expectStatus(400);
	});

	test("FEE-37 reminders need FEE_REMINDER_SEND", async ({ api, as }) => {
		const o = await overdueSetup(api);
		for (const role of ["feesCollector", "readOnlyStaff", "noPermissions"] as const) {
			(await as(role).post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [o.first.id] } })).expectStatus(403);
		}
	});
});

test.describe("per-payer frequency and category type", () => {
	test("FEE-41 each student keeps the payment frequency chosen for them, and the structure is unchanged", async ({ api }) => {
		const s = await feeSetup(api, { students: 3, count: 4, each: 250 });
		const quarterly = await assigned(api, s, 0, { paymentFrequency: "QUARTERLY" });
		const yearly = await assigned(api, s, 1, { paymentFrequency: "ONE_SHOT" });
		const defaulted = await assigned(api, s, 2, { paymentFrequency: undefined });
		expect(quarterly.status).toBe("ACTIVE");
		const read = async (id: number) => (await api.get(`${FEES}/assignments/{assignmentId}`, { params: { assignmentId: id } })).expectStatus(200).body;
		expect((await read(quarterly.id)).paymentFrequency).toBe("QUARTERLY");
		expect((await read(yearly.id)).paymentFrequency).toBe("ONE_SHOT");
		expect((await read(defaulted.id)).paymentFrequency).toBeTruthy();
		(await api.get(`${FEES}/structures/{structureId}`, { params: { structureId: s.structure.id } })).expectStatus(200).expectJson((body) => expect(body.paymentFrequency).toBe("MONTHLY"));
	});

	test("FEE-41 a transport category and a tuition category bill separately for the same student", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const tuition = await createCategory(api, { categoryType: "GENERAL" });
		const transport = await createCategory(api, { categoryType: "TRANSPORT" });
		expect(transport.res.body.categoryType).toBe("TRANSPORT");
		const tuitionStructure = (await createStructure(api, group.id, tuition.res.body.id, installments(s, 1, 2000))).body;
		const transportStructure = (await createStructure(api, group.id, transport.res.body.id, installments(s, 1, 600), { paymentFrequency: "QUARTERLY" })).body;
		const enrolment = s.enrollmentIds[0];
		const a1 = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: enrolment, feeStructureId: tuitionStructure.id } })).expectStatus([200, 201]).body;
		const a2 = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: enrolment, feeStructureId: transportStructure.id } })).expectStatus([200, 201]).body;
		const inv1 = (await invoiceFor(api, a1.id, tuitionStructure.installments[0].id)).body;
		const inv2 = (await invoiceFor(api, a2.id, transportStructure.installments[0].id)).body;
		expect([inv1.totalAmount, inv2.totalAmount]).toEqual([2000, 600]);
		await pay(api, s as never, inv2.id, 600);
		expect((await getInvoice(api, inv2.id)).status).toBe("PAID");
		expect((await getInvoice(api, inv1.id)).status).toBe("ISSUED");
	});

	test("FEE-41 a discount on one category does not touch the student's other category", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const approvers = (await api.get(`${FEES}/approvers`)).body;
		const a = await createCategory(api);
		const b = await createCategory(api, { categoryType: "TRANSPORT" });
		const sa = (await createStructure(api, group.id, a.res.body.id, installments(s, 1, 1000))).body;
		const sb = (await createStructure(api, group.id, b.res.body.id, installments(s, 1, 400))).body;
		const enrolment = s.enrollmentIds[0];
		await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: enrolment, feeStructureId: sa.id, discountAmount: 100, discountReason: "Sibling", approvedBy: approvers[0].userId } });
		const second = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: enrolment, feeStructureId: sb.id } })).expectStatus([200, 201]).body;
		expect(second).toMatchObject({ discountAmount: 0, effectiveAmount: 400 });
	});
});
