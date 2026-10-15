// Payment links (public pay page), opening balances, the fee permission matrix, and tenant isolation.
// IDs refer to docs/SCENARIOS.md section 9 (FEE-*). Fee data needs students, which only the shared organisation
// can hold (Operion #354); the "other organisation" is a throwaway one that probes it from outside.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { invoiced, pay, getInvoice, createCategory, FEES, feeSetup, assign } from "../../../src/api/fees";
import { expectShape } from "../../../src/api/shapes";

const LINK = `${FEES}/payment-links/{organisationSlug}/{linkToken}`;
const csv = (content: string) => ({ file: { name: "balances.csv", mimeType: "text/csv", buffer: Buffer.from(content) } });

async function linkFor(api: Parameters<typeof pay>[0], invoiceId: number) {
	const res = await api.post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId } });
	res.expectStatus([200, 201]);
	return { res, params: { organisationSlug: res.body.organisationSlug as string, linkToken: res.body.linkToken as string } };
}

test.describe("payment links", () => {
	test("FEE-38 staff create a link for an unpaid invoice: slug, token and a three-day expiry", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { res } = await linkFor(api, i.invoice.id);
		expectShape(res.body, { orderId: "number", organisationSlug: "string", linkToken: "string", expiresAt: "string" });
		expect(res.body.linkToken.length).toBeGreaterThanOrEqual(24);
		const hours = (new Date(res.body.expiresAt).getTime() - Date.now()) / 3_600_000;
		expect(hours).toBeGreaterThan(70);
		expect(hours).toBeLessThanOrEqual(73);
	});

	test("FEE-38 every link has its own token", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const a = await linkFor(api, i.invoice.id);
		const b = await linkFor(api, i.invoice.id);
		expect(a.params.linkToken).not.toBe(b.params.linkToken);
	});

	test("FEE-38 the pay page opens without a sign-in and shows only the invoice number, balance and expiry", async ({ api, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		(await anon.get(LINK, { params })).expectStatus(200).expectJson((body) => {
			expect(body).toEqual({ status: "PENDING", invoiceNumber: i.invoice.invoiceNumber, outstanding: 800, expiresAt: expect.any(String) });
		});
	});

	test("FEE-38 the pay page shows the current balance after a part payment", async ({ api, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		await pay(api, i, i.invoice.id, 300);
		(await anon.get(LINK, { params })).expectStatus(200).expectJson((body) => expect(body.outstanding).toBe(500));
	});

	test("FEE-38 a link for a fully paid invoice cannot be created", async ({ api }) => {
		const i = await invoiced(api, { count: 1, each: 300 });
		await pay(api, i, i.invoice.id, 300);
		(await api.post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus(409);
	});

	test("FEE-38 a link for an unknown invoice returns 404", async ({ api }) => {
		(await api.post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: 99999999 } })).expectStatus(404);
	});

	test("FEE-38 a wrong token or unknown school on the pay page returns 404 and gives nothing away", async ({ api, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		const wrongToken = await anon.get(LINK, { params: { ...params, linkToken: "not-a-real-token" } });
		wrongToken.expectStatus(404);
		const wrongSlug = await anon.get(LINK, { params: { ...params, organisationSlug: "no-such-school" } });
		wrongSlug.expectStatus(404);
		for (const res of [wrongToken, wrongSlug]) expect(JSON.stringify(res.body)).not.toMatch(/exception|com\.operion|invoice/i);
	});

	test("FEE-38 checkout without a configured payment gateway fails in a controlled way, not with a 500", async ({ api, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		const res = await anon.post(`${LINK}/checkout`, { params });
		expect(res.status).not.toBe(500);
		expect([200, 409, 502, 503]).toContain(res.status);
		if (res.status !== 200) expect(res.body.error).toEqual(expect.any(String));
	});

	test("FEE-38 checkout is refused once the invoice is paid, and unknown tokens return 404", async ({ api, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		await pay(api, i, i.invoice.id, 800);
		(await anon.post(`${LINK}/checkout`, { params })).expectStatus(409);
		(await anon.post(`${LINK}/checkout`, { params: { ...params, linkToken: "nope" } })).expectStatus(404);
	});

	test("FEE-38 creating a link needs FEE_COLLECT and a sign-in", async ({ api, as, anon }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		(await as("readOnlyStaff").post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus(403);
		(await as("noPermissions").post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus(403);
		(await anon.post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus(401);
		(await as("feesCollector").post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus([200, 201]);
	});

	test.fixme("FEE-38 an expired link is rejected (needs a way to age a link past three days)", async () => {});

	test("FEE-39 a token from one school does not open under another school's slug", async ({ api, anon, request, calls }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const { params } = await linkFor(api, i.invoice.id);
		const other = await createOtherOrganisation(request, calls);
		const res = await anon.get(LINK, { params: { organisationSlug: other.slug, linkToken: params.linkToken } });
		res.expectStatus(404);
		expect(JSON.stringify(res.body)).not.toContain(i.invoice.invoiceNumber);
		(await anon.post(`${LINK}/checkout`, { params: { organisationSlug: other.slug, linkToken: params.linkToken } })).expectStatus(404);
	});

	test("FEE-39 another school's owner cannot create a link for this school's invoice", async ({ api, request, calls }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		const other = await createOtherOrganisation(request, calls);
		(await other.client.post(`${FEES}/invoices/{invoiceId}/payment-link`, { params: { invoiceId: i.invoice.id } })).expectStatus(404);
	});
});

test.describe("opening balances", () => {
	async function student(api: Parameters<typeof pay>[0]) {
		const s = await feeSetup(api, { students: 1, count: 1, each: 100 });
		const record = (await api.get("/api/v1/students/{studentId}", { params: { studentId: s.studentIds[0] } })).expectStatus(200).body;
		return { ...s, admissionNumber: record.admissionNumber as string };
	}
	const header = "studentAdmissionNumber,amount,asOfDate\n";

	test("FEE-40 a validate-only run reports the row as valid and records nothing", async ({ api }) => {
		const s = await student(api);
		const res = await api.post(`${FEES}/opening-balances/import`, { query: { validateOnly: true }, multipart: csv(`${header}${s.admissionNumber},750,2020-04-01\n`) });
		res.expectStatus(200).expectJson((rows) => expect(rows[0]).toMatchObject({ row: 2, status: "VALID" }));
		const exported = (await api.get(`${FEES}/opening-balances/export`)).body as { studentAdmissionNumber: string }[];
		expect(exported.map((r) => r.studentAdmissionNumber)).not.toContain(s.admissionNumber);
	});

	test("FEE-40 an import creates a due invoice for the carried-over amount and the export lists it", async ({ api }) => {
		const s = await student(api);
		const res = await api.post(`${FEES}/opening-balances/import`, { multipart: csv(`${header}${s.admissionNumber},750,2020-04-01\n`) });
		res.expectStatus(200).expectJson((rows) => expect(rows[0]).toMatchObject({ status: "IMPORTED", id: expect.any(Number) }));
		const invoices = (await api.get(`${FEES}/invoices`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body as { totalAmount: number; dueDate: string; status: string }[];
		expect(invoices.find((x) => x.totalAmount === 750)).toMatchObject({ dueDate: "2020-04-01", status: "ISSUED" });
		const exported = (await api.get(`${FEES}/opening-balances/export`)).body as { studentAdmissionNumber: string; amount: number; status: string }[];
		expect(exported.find((r) => r.studentAdmissionNumber === s.admissionNumber)).toMatchObject({ amount: 750, status: "ACTIVE" });
	});

	test("FEE-40 the carried-over amount counts as overdue when its date has passed", async ({ api }) => {
		const s = await student(api);
		await api.post(`${FEES}/opening-balances/import`, { multipart: csv(`${header}${s.admissionNumber},750,2020-04-01\n`) });
		const overdue = (await api.get(`${FEES}/invoices/overdue`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body as { outstanding: number }[];
		expect(overdue.map((x) => x.outstanding)).toContain(750);
	});

	test("FEE-40 a second opening balance for the same student is reported as a duplicate", async ({ api }) => {
		const s = await student(api);
		await api.post(`${FEES}/opening-balances/import`, { multipart: csv(`${header}${s.admissionNumber},750,2020-04-01\n`) });
		const again = await api.post(`${FEES}/opening-balances/import`, { multipart: csv(`${header}${s.admissionNumber},100,2020-05-01\n`) });
		again.expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("DUPLICATE"));
	});

	test("FEE-40 bad rows are reported one by one: unknown student, bad amount, bad date, missing amount", async ({ api }) => {
		const s = await student(api);
		const rows = [`NO-SUCH-STUDENT,100,2020-04-01`, `${s.admissionNumber},abc,2020-04-01`, `${s.admissionNumber},100,not-a-date`, `${s.admissionNumber},,2020-04-01`].join("\n");
		const res = await api.post(`${FEES}/opening-balances/import`, { query: { validateOnly: true }, multipart: csv(header + rows + "\n") });
		res.expectStatus(200).expectJson((result) => {
			expect(result).toHaveLength(4);
			for (const row of result) expect(row.status).toBe("ERROR");
		});
	});

	test("FEE-40 a negative opening balance is rejected", async ({ api }) => {
		const s = await student(api);
		const res = await api.post(`${FEES}/opening-balances/import`, { query: { validateOnly: true }, multipart: csv(`${header}${s.admissionNumber},-50,2020-04-01\n`) });
		res.expectStatus(200).expectJson((rows) => expect(rows[0].status).toBe("ERROR"));
	});

	test("FEE-40 an import with no file returns 400, not 500", async ({ api }) => {
		(await api.post(`${FEES}/opening-balances/import`, {})).expectStatus(400);
	});

	test("FEE-40 importing needs FEE_STRUCTURE_MANAGE; exporting needs FEE_VIEW", async ({ as, anon }) => {
		(await as("feesCollector").post(`${FEES}/opening-balances/import`, { multipart: csv(`${header}X,1,2020-01-01\n`) })).expectStatus(403);
		(await as("feesCollector").get(`${FEES}/opening-balances/export`)).expectStatus(200);
		(await as("noPermissions").get(`${FEES}/opening-balances/export`)).expectStatus(403);
		(await anon.get(`${FEES}/opening-balances/export`)).expectStatus(401);
	});
});

test.describe("access matrix", () => {
	test("FEE-42 every fee read endpoint needs FEE_VIEW and a sign-in", async ({ api, as, anon }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const reads: [string, Record<string, unknown>?, Record<string, unknown>?][] = [
			[`${FEES}/categories`],
			[`${FEES}/structure-groups`, undefined, { academicYearId: i.yearId, schoolClassId: i.base.classId }],
			[`${FEES}/structures`, undefined, { feeStructureGroupId: i.group.id }],
			[`${FEES}/structures/export`],
			[`${FEES}/invoices`, undefined, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/invoices/overdue`],
			[`${FEES}/payments`, undefined, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/assignments`, undefined, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/waivers`, undefined, { invoiceId: i.invoice.id }],
			[`${FEES}/adjustments`, undefined, { invoiceId: i.invoice.id }],
			[`${FEES}/opening-balances/export`],
		];
		for (const [path, , query] of reads) {
			(await anon.get(path, { query: query as never })).expectStatus(401);
			(await as("noPermissions").get(path, { query: query as never })).expectStatus(403);
			(await as("readOnlyStaff").get(path, { query: query as never })).expectStatus(200);
		}
	});

	test("FEE-42 the approvers list is open to any signed-in member but not to the public", async ({ as, anon }) => {
		(await as("noPermissions").get(`${FEES}/approvers`)).expectStatus(200);
		(await anon.get(`${FEES}/approvers`)).expectStatus(401);
	});

	test("FEE-42 every fee write endpoint refuses a viewer with 403 and the public with 401", async ({ api, as, anon }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const writes: [string, Record<string, unknown>, Record<string, unknown>?][] = [
			[`${FEES}/categories`, { code: "X", name: "X", categoryType: "GENERAL" }],
			[`${FEES}/structure-groups`, { name: "X", academicYearId: i.yearId, schoolClassId: i.base.classId }],
			[`${FEES}/structures`, { feeStructureGroupId: i.group.id, feeCategoryId: i.category.id, amount: 1, installments: [] }],
			[`${FEES}/assignments`, { studentEnrollmentId: i.enrollmentIds[0], feeStructureId: i.structure.id }],
			[`${FEES}/payments`, { academicYearId: i.yearId, amount: 1, paymentMethod: "CASH", paymentDate: i.day(5), allocations: [] }],
			[`${FEES}/refunds`, { paymentId: 1, invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, refundDate: i.day(5) }],
			[`${FEES}/waivers`, { invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, waiverDate: i.day(5) }],
			[`${FEES}/adjustments`, { invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, adjustmentDate: i.day(5) }],
			[`${FEES}/invoices/send-reminders`, { invoiceIds: [i.invoice.id] }],
		];
		for (const [path, body] of writes) {
			(await anon.post(path, { body })).expectStatus(401);
			(await as("readOnlyStaff").post(path, { body })).expectStatus(403);
		}
	});

	test("FEE-42 a fees collector can collect and assign but not set up structures, waive, refund or adjust", async ({ api, as }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const collector = as("feesCollector");
		(await pay(collector, i, i.invoice.id, 50)).expectStatus([200, 201]);
		(await createCategory(collector)).res.expectStatus(403);
		(await collector.post(`${FEES}/waivers`, { body: { invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, waiverDate: i.day(5) } })).expectStatus(403);
		(await collector.post(`${FEES}/adjustments`, { body: { invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, adjustmentDate: i.day(5) } })).expectStatus(403);
		(await collector.post(`${FEES}/refunds`, { body: { paymentId: 1, invoiceId: i.invoice.id, amount: 1, reason: "x", approvedBy: i.approverId, refundDate: i.day(5) } })).expectStatus(403);
	});
});

test.describe("tenant isolation", () => {
	test("FEE-43 another school cannot read this school's categories, structures, invoices, payments or assignments", async ({ api, request, calls }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const made = (await pay(api, i, i.invoice.id, 100)).expectStatus([200, 201]).body;
		const other = (await createOtherOrganisation(request, calls)).client;
		(await other.get(`${FEES}/invoices/{invoiceId}`, { params: { invoiceId: i.invoice.id } })).expectStatus(404);
		(await other.get(`${FEES}/payments/{paymentId}`, { params: { paymentId: made.id } })).expectStatus(404);
		(await other.get(`${FEES}/assignments/{assignmentId}`, { params: { assignmentId: i.assignment.id } })).expectStatus(404);
		(await other.get(`${FEES}/structures/{structureId}`, { params: { structureId: i.structure.id } })).expectStatus(404);
		(await other.get(`${FEES}/structure-groups/{groupId}`, { params: { groupId: i.group.id } })).expectStatus(404);
		(await other.get(`${FEES}/categories`)).expectStatus(200).expectJson((list) => expect(list.map((c: { code: string }) => c.code)).not.toContain(i.category.code));
	});

	test("FEE-43 another school's lists for this school's ids are empty", async ({ api, request, calls }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const other = (await createOtherOrganisation(request, calls)).client;
		for (const [path, query] of [
			[`${FEES}/invoices`, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/payments`, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/assignments`, { studentEnrollmentId: i.enrollmentIds[0] }],
			[`${FEES}/structures`, { feeStructureGroupId: i.group.id }],
			[`${FEES}/waivers`, { invoiceId: i.invoice.id }],
			[`${FEES}/adjustments`, { invoiceId: i.invoice.id }],
			[`${FEES}/invoices/overdue`, { studentEnrollmentId: i.enrollmentIds[0] }],
		] as const) {
			const res = await other.get(path, { query: query as never });
			res.expectStatus(200).expectJson((list) => expect(list).toEqual([]));
		}
		(await other.get(`${FEES}/structure-groups`, { query: { academicYearId: i.yearId, schoolClassId: i.base.classId } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("FEE-43 another school's export lists none of this school's structures or opening balances", async ({ api, request, calls }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const other = (await createOtherOrganisation(request, calls)).client;
		(await other.get(`${FEES}/structures/export`)).expectStatus(200).expectJson((rows) => expect(rows.map((r: { id: number }) => r.id)).not.toContain(i.structure.id));
		(await other.get(`${FEES}/opening-balances/export`)).expectStatus(200).expectJson((rows) => expect(rows).toEqual([]));
	});

	test("FEE-43 another school cannot pay, refund, waive, adjust, bounce or invoice this school's records", async ({ api, request, calls }) => {
		const i = await invoiced(api, { count: 2, each: 500 });
		const made = (await pay(api, i, i.invoice.id, 100)).body;
		const other = (await createOtherOrganisation(request, calls)).client;
		const day = i.day(13);
		const approver = i.approverId;
		(await other.post(`${FEES}/payments`, { body: { academicYearId: i.yearId, amount: 10, paymentMethod: "CASH", paymentDate: day, allocations: [{ invoiceId: i.invoice.id, amount: 10 }] } })).expectStatus(404);
		(await other.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: made.id } })).expectStatus(404);
		(await other.post(`${FEES}/refunds`, { body: { paymentId: made.id, invoiceId: i.invoice.id, amount: 10, reason: "x", approvedBy: approver, refundDate: day } })).expectStatus(404);
		(await other.post(`${FEES}/waivers`, { body: { invoiceId: i.invoice.id, amount: 10, reason: "x", approvedBy: approver, waiverDate: day } })).expectStatus(404);
		(await other.post(`${FEES}/adjustments`, { body: { invoiceId: i.invoice.id, amount: 10, reason: "x", approvedBy: approver, adjustmentDate: day } })).expectStatus(404);
		(await other.post(`${FEES}/assignments/{assignmentId}/invoices`, { params: { assignmentId: i.assignment.id }, body: { feeStructureInstallmentId: i.structure.installments[1].id } })).expectStatus(404);
		(await other.post(`${FEES}/assignments/{assignmentId}/revise`, { params: { assignmentId: i.assignment.id }, body: { discountAmount: 0 } })).expectStatus(404);
		(await other.post(`${FEES}/invoices/send-reminders`, { body: { invoiceIds: [i.invoice.id] } })).expectStatus(404);
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 500, amountPaid: 100 });
	});

	test("FEE-43 another school cannot assign this school's structure to its own students", async ({ api, request, calls }) => {
		const s = await feeSetup(api);
		const other = (await createOtherOrganisation(request, calls)).client;
		(await assign(other, s, 0)).expectStatus(404);
	});

	test("FEE-43 the same category code can exist in two schools", async ({ api, request, calls }) => {
		const mine = await createCategory(api);
		mine.res.expectStatus([200, 201]);
		const other = (await createOtherOrganisation(request, calls)).client;
		const theirs = await createCategory(other, { code: mine.code });
		theirs.res.expectStatus([200, 201]);
		expect(theirs.res.body.id).not.toBe(mine.res.body.id);
	});
});
