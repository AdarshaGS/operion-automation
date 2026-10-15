// Fee collection screens: assigning fees, invoicing, taking payments, bounces, refunds, waivers, the overdue
// list and what a fees collector can and cannot see. IDs refer to docs/SCENARIOS.md section 9 (FEE-U*).
// Every test builds its own draft-year class in the shared organisation, so students and invoices never collide.

import { test, expect } from "../../../src/sanity/fixtures";
import { feeSetup, assigned, invoiceFor, invoiced, pay, getInvoice, FEES } from "../../../src/api/fees";
import { storageStatePath } from "../../../src/setup/session";
import { storageStateFor } from "../../../src/ui/session";
import { createDisposableUser } from "../../../src/api/users";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { UI_BASE_URL } from "../../../src/config/env";
import { FeeCollectionPage } from "../../../src/pages/fees/FeeCollectionPage";
import type { ApiClient } from "../../../src/api/apiClient";
import type { OrgContext } from "../../../src/api/users";
import type { Browser } from "@playwright/test";

const OWNER = "Owner Automation";

test.describe("assigning fees and issuing invoices", () => {
	test("FEE-U02 assign a fee from the student's panel and see it with its amounts", async ({ api, feeCollection, page }) => {
		const s = await feeSetup(api, { count: 2, each: 1000 });
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.assign({ structureLabel: s.category.name, frequency: "Quarterly" });
		const row = feeCollection.assignmentRow(s.category.name);
		await expect(row).toBeVisible();
		await expect(row).toContainText("Quarterly");
		await expect(row).toContainText("2000");
		await expect(row).toContainText("Active");
		const list = (await api.get(`${FEES}/assignments`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body;
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ paymentFrequency: "QUARTERLY", effectiveAmount: 2000 });
		await expect(page.getByRole("alert").filter({ hasText: /failed/i })).toHaveCount(0);
	});

	test("FEE-U02 a discount with a reason and an approver lowers the effective amount", async ({ api, feeCollection }) => {
		const s = await feeSetup(api, { count: 2, each: 1000 });
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.assign({ structureLabel: s.category.name, discountAmount: 300, discountReason: "Sibling", approver: OWNER });
		const row = feeCollection.assignmentRow(s.category.name);
		await expect(row).toContainText("1700");
		await expect(row).toContainText("300");
	});

	test("FEE-U02 a discount without an approver is explained next to the form, not hidden behind it", async ({ api, feeCollection }) => {
		const s = await feeSetup(api);
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.assign({ structureLabel: s.category.name, discountAmount: 100, discountReason: "Sibling" });
		await expect(feeCollection.assignDialog().getByRole("alert")).toContainText(/approver/i);
	});

	test("FEE-U02 a student whose class has no fee structure is told so and cannot assign", async ({ api, attendance, feeCollection, page }) => {
		const { attendanceSetup } = await import("../../../src/api/attendance");
		const s = await attendanceSetup(api, 1);
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await expect(page.getByText(/No fee structures exist for this student's class/)).toBeVisible();
		await expect(page.getByRole("button", { name: "Assign fee" })).toBeDisabled();
	});

	test("FEE-U02 generate an invoice for an installment and see it in the invoice list", async ({ api, feeCollection, page }) => {
		const s = await feeSetup(api, { count: 2, each: 500 });
		await assigned(api, s);
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.generateInvoice(s.category.name, 2);
		await expect(page.getByText("No invoices generated yet.")).toHaveCount(0);
		const invoices = (await api.get(`${FEES}/invoices`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body;
		expect(invoices).toHaveLength(1);
		const row = feeCollection.invoiceRow(invoices[0].invoiceNumber);
		await expect(row).toContainText("₹500");
		await expect(row).toContainText("Issued");
	});

	test("FEE-U02 generating the same installment twice shows the server's message", async ({ api, feeCollection, page }) => {
		const s = await feeSetup(api, { count: 2, each: 500 });
		const a = await assigned(api, s);
		await invoiceFor(api, a.id, s.structure.installments[0].id);
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.generateInvoice(s.category.name, 1);
		await expect(page.getByRole("alert").filter({ hasText: /already generated/i }).first()).toBeVisible();
	});
});

test.describe("collecting payments", () => {
	test("FEE-U03 record a part payment, see the receipt, and the invoice and history update", async ({ api, feeCollection, page }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.recordPayment({ amount: 400, remarks: "Term one", allocate: [{ invoiceNumber: i.invoice.invoiceNumber, amount: 400 }] });
		await feeCollection.submitPayment();
		await expect(feeCollection.receiptDialog()).toBeVisible();
		await expect(feeCollection.receiptDialog()).toContainText(/RCT-.+-000001/);
		await expect(feeCollection.receiptDialog()).toContainText("₹400");
		await feeCollection.closeReceipt();
		const row = feeCollection.invoiceRow(i.invoice.invoiceNumber);
		await expect(row).toContainText("Partially paid");
		await expect(row).toContainText("₹600");
		const payments = (await api.get(`${FEES}/payments`, { query: { studentEnrollmentId: i.enrollmentIds[0] } })).body;
		expect(payments).toHaveLength(1);
		await expect(feeCollection.paymentRow(payments[0].receiptNumber)).toContainText("Cleared");
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 400, outstanding: 600 });
		await expect(page.getByRole("alert").filter({ hasText: /failed/i })).toHaveCount(0);
	});

	test("FEE-U03 paying the whole invoice marks it Paid", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.recordPayment({ amount: 700, method: "UPI", reference: "UTR123", allocate: [{ invoiceNumber: i.invoice.invoiceNumber }] });
		await feeCollection.submitPayment();
		await feeCollection.closeReceipt();
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("Paid");
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("₹0");
	});

	test("FEE-U03 the Record button stays disabled while the allocation does not match the amount", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.recordPayment({ amount: 300, allocate: [{ invoiceNumber: i.invoice.invoiceNumber, amount: 200 }] });
		const dialog = feeCollection.paymentDialog();
		await expect(dialog.getByRole("alert")).toContainText(/Allocated 200, must equal the payment amount \(300\)/);
		await expect(dialog.getByRole("button", { name: "Record", exact: true })).toBeDisabled();
		await dialog.getByLabel("Allocate").fill("300");
		await expect(dialog.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
	});

	test("FEE-U03 a cheque asks for the bank name and shows number and bank in the history", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.recordPayment({ amount: 700, method: "CHEQUE", reference: "778899", bankName: "State Bank", allocate: [{ invoiceNumber: i.invoice.invoiceNumber }] });
		await feeCollection.submitPayment();
		await feeCollection.closeReceipt();
		await expect(feeCollection.page_().getByRole("row").filter({ hasText: "778899 · State Bank" })).toBeVisible();
	});

	test("FEE-U03 marking a cheque bounced reopens the invoice and disables further bounce or refund", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		const cheque = (await pay(api, i, i.invoice.id, 700, { paymentMethod: "CHEQUE", paymentReference: "CHQ-1", paymentBankName: "HDFC" })).expectStatus([200, 201]).body;
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("Paid");
		await feeCollection.markBounced(cheque.receiptNumber);
		await expect(feeCollection.paymentRow(cheque.receiptNumber)).toContainText("Bounced");
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("Issued");
		await expect(feeCollection.paymentRow(cheque.receiptNumber).getByRole("button", { name: "Mark bounced" })).toBeDisabled();
		await expect(feeCollection.paymentRow(cheque.receiptNumber).getByRole("button", { name: "Refund" })).toBeDisabled();
	});

	test("FEE-U03 refund part of a payment from the history", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		const cash = (await pay(api, i, i.invoice.id, 700)).expectStatus([200, 201]).body;
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openRefund(cash.receiptNumber);
		const dialog = feeCollection.refundDialog();
		await dialog.getByRole("combobox", { name: "Invoice" }).click();
		await feeCollection.page_().getByRole("option", { name: new RegExp(i.invoice.invoiceNumber) }).click();
		await feeCollection.fillCorrection(dialog, { amount: 200, reason: "Duplicate payment", approver: OWNER });
		await dialog.getByRole("button", { name: "Refund", exact: true }).click();
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("Partially paid");
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ amountPaid: 500, outstanding: 200 });
	});

	test("FEE-U03 a server refusal is shown where the user is looking, not behind the dialog", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 700 });
		const cash = (await pay(api, i, i.invoice.id, 300)).expectStatus([200, 201]).body;
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openRefund(cash.receiptNumber);
		const dialog = feeCollection.refundDialog();
		await dialog.getByRole("combobox", { name: "Invoice" }).click();
		await feeCollection.page_().getByRole("option", { name: new RegExp(i.invoice.invoiceNumber) }).click();
		await feeCollection.fillCorrection(dialog, { amount: 99999, reason: "Typo", approver: OWNER });
		await dialog.getByRole("button", { name: "Refund", exact: true }).click();
		await expect(dialog.getByRole("alert")).toBeVisible();
	});
});

test.describe("waivers and adjustments", () => {
	test("FEE-U05 the waiver form needs an amount, a reason and an approver before it can be sent", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openWaiver(i.invoice.invoiceNumber);
		const dialog = feeCollection.waiverDialog();
		const submit = dialog.getByRole("button", { name: "Waive", exact: true });
		await expect(submit).toBeDisabled();
		await feeCollection.fillCorrection(dialog, { reason: "Hardship" });
		await expect(submit).toBeDisabled();
		await feeCollection.fillCorrection(dialog, { approver: OWNER });
		await expect(submit).toBeEnabled();
		await dialog.getByLabel("Reason").fill("");
		await expect(submit).toBeDisabled();
	});

	test("FEE-U05 waiving part of the balance lowers the invoice and keeps it open", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 800 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openWaiver(i.invoice.invoiceNumber);
		await feeCollection.fillCorrection(feeCollection.waiverDialog(), { amount: 300, reason: "Hardship", approver: OWNER });
		await feeCollection.submitWaiver();
		await expect(feeCollection.waiverDialog()).toBeHidden();
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("₹500");
		expect(await getInvoice(api, i.invoice.id)).toMatchObject({ totalAmount: 500, status: "ISSUED" });
	});

	test("FEE-U05 the Waive button is disabled once nothing is owed", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 400 });
		await pay(api, i, i.invoice.id, 400);
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber).getByRole("button", { name: "Waive" })).toBeDisabled();
	});

	test("FEE-U05 waiving more than is owed shows the refusal inside the dialog", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 400 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openWaiver(i.invoice.invoiceNumber);
		await feeCollection.fillCorrection(feeCollection.waiverDialog(), { amount: 9999, reason: "Typo", approver: OWNER });
		await feeCollection.submitWaiver();
		await expect(feeCollection.waiverDialog().getByRole("alert")).toContainText(/exceeds/i);
	});

	test("FEE-U05 an adjustment raises the invoice total", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 400 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openAdjustment(i.invoice.invoiceNumber);
		await feeCollection.fillCorrection(feeCollection.adjustmentDialog(), { amount: 50, reason: "Late fee", approver: OWNER });
		await feeCollection.submitAdjustment();
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toContainText("₹450");
	});

	test("FEE-U06 a proof file chosen in the waiver dialog is stored with the waiver", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 600 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openWaiver(i.invoice.invoiceNumber);
		const dialog = feeCollection.waiverDialog();
		await feeCollection.fillCorrection(dialog, { amount: 100, reason: "Hardship", approver: OWNER, proof: { name: "approval-letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 approved by the principal") } });
		await expect(dialog.getByText("approval-letter.pdf")).toBeVisible();
		await feeCollection.submitWaiver();
		await expect(feeCollection.waiverDialog()).toBeHidden();
		(await api.get(`${FEES}/waivers`, { query: { invoiceId: i.invoice.id } })).expectStatus(200).expectJson((list) => {
			expect(list[0]).toMatchObject({ proofFileName: "approval-letter.pdf", proofFileReference: expect.any(String) });
		});
	});
});

test.describe("proof files", () => {
	test("FEE-U06 a file type the school does not accept is refused with a message inside the dialog", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 600 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.openWaiver(i.invoice.invoiceNumber);
		const dialog = feeCollection.waiverDialog();
		await feeCollection.fillCorrection(dialog, { proof: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("not a proof") } });
		await expect(dialog.getByRole("alert")).toContainText(/PNG, JPG, or PDF/);
	});

	test("FEE-U06 a proof attached while assigning a discount is stored with the assignment", async ({ api, feeCollection }) => {
		const s = await feeSetup(api, { count: 1, each: 1000 });
		await feeCollection.open();
		await feeCollection.chooseStudent(s.studentNames[0]);
		await feeCollection.openAssignDialog();
		const dialog = feeCollection.assignDialog();
		await dialog.getByRole("combobox", { name: "Fee structure" }).click();
		await feeCollection.page_().getByRole("option", { name: s.category.name }).click();
		await dialog.getByLabel("Discount amount").fill("100");
		await dialog.getByLabel("Discount reason").fill("Scholarship");
		await dialog.getByRole("combobox", { name: "Approved by" }).click();
		await feeCollection.page_().getByRole("option", { name: OWNER }).click();
		await dialog.locator("input[type=file]").setInputFiles({ name: "scholarship.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 letter") });
		await expect(dialog.getByText("scholarship.pdf")).toBeVisible();
		await dialog.getByRole("button", { name: "Assign", exact: true }).click();
		await expect(feeCollection.assignmentRow(s.category.name)).toContainText("900");
		const list = (await api.get(`${FEES}/assignments`, { query: { studentEnrollmentId: s.enrollmentIds[0] } })).body;
		expect(list[0]).toMatchObject({ proofFileName: "scholarship.pdf", proofFileReference: expect.any(String) });
	});
});

test.describe("overdue invoices and reminders", () => {
	async function overdue(api: Parameters<typeof feeSetup>[0]) {
		const { attendanceSetup } = await import("../../../src/api/attendance");
		const { createGroup, createCategory, createStructure } = await import("../../../src/api/fees");
		const s = await attendanceSetup(api, 2);
		const group = await createGroup(api, s.yearId, s.base.classId);
		const category = await createCategory(api);
		const structure = (await createStructure(api, group.id, category.res.body.id, [{ installmentNumber: 1, dueDate: "2020-01-10", amount: 500 }])).body;
		const numbers: string[] = [];
		for (let n = 0; n < 2; n++) {
			const a = (await api.post(`${FEES}/assignments`, { body: { studentEnrollmentId: s.enrollmentIds[n], feeStructureId: structure.id } })).body;
			numbers.push((await invoiceFor(api, a.id, structure.installments[0].id)).body.invoiceNumber);
		}
		return { ...s, numbers };
	}

	test("FEE-U04 the overdue list narrows to a class and shows student, due date and days overdue", async ({ api, feeDemand }) => {
		const o = await overdue(api);
		await feeDemand.open();
		await feeDemand.filterByClass(o.className);
		for (const number of o.numbers) await expect(feeDemand.row(number)).toBeVisible();
		await expect(feeDemand.row(o.numbers[0])).toContainText("2020-01-10");
		await expect(feeDemand.row(o.numbers[0])).toContainText(/\d+ days/);
		await expect(feeDemand.row(o.numbers[0])).toContainText("₹500");
	});

	test("FEE-U04 select all and send reminders reports how many went out", async ({ api, feeDemand }) => {
		const o = await overdue(api);
		await feeDemand.open();
		await feeDemand.filterByClass(o.className);
		await expect(feeDemand.row(o.numbers[0])).toBeVisible();
		await expect(feeDemand.sendButton()).toBeDisabled();
		await feeDemand.selectAll();
		await expect(feeDemand.sendButton()).toContainText("(2)");
		await feeDemand.sendReminders();
		await expect(feeDemand.notice()).toContainText("across 2 invoices");
	});

	test("FEE-U04 a class with nothing overdue says so", async ({ api, feeDemand }) => {
		const s = await feeSetup(api);
		await feeDemand.open();
		await feeDemand.filterByClass(s.className);
		await expect(feeDemand.empty()).toBeVisible();
		await expect(feeDemand.sendButton()).toHaveCount(0);
	});
});

test.describe("a fees collector", () => {
	const COLLECTOR_PERMISSIONS = ["STUDENT_VIEW", "FEE_VIEW", "FEE_COLLECT", "FEE_INVOICE_MANAGE", "FEE_ASSIGNMENT_MANAGE"];

	async function signedInAs(api: ApiClient, anon: ApiClient, seed: OrgContext, browser: Browser, permissions: string[]) {
		const user = await createDisposableUser(api, anon, seed, permissions);
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } })).expectStatus(200);
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		return { page, context, fees: new FeeCollectionPage(page) };
	}

	async function admission(api: ApiClient, studentId: number) {
		return (await api.get("/api/v1/students/{studentId}", { params: { studentId } })).expectStatus(200).body.admissionNumber as string;
	}

	test("FEE-U07 a fees collector holding exactly the collector permissions can open the collection screen", async ({ api, anon, seed, browser }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const { page, context, fees } = await signedInAs(api, anon, seed, browser, COLLECTOR_PERMISSIONS);
		await fees.open();
		await fees.chooseStudent(await admission(api, i.studentIds[0]));
		await expect(fees.accessBanner()).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "Fee assignments" })).toBeVisible();
		await context.close();
	});

	test("FEE-U07 a collector sees assign and record-payment, but no setup or reminder shortcuts", async ({ api, anon, seed, browser }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const { page, context, fees } = await signedInAs(api, anon, seed, browser, [...COLLECTOR_PERMISSIONS, "CLASS_VIEW"]);
		await fees.open();
		await expect(page.getByRole("heading", { name: "Collect fee" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Fee structure setup" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: /Overdue/ })).toHaveCount(0);
		await fees.chooseStudent(await admission(api, i.studentIds[0]));
		await expect(page.getByRole("button", { name: "Assign fee" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible();
		await expect(fees.invoiceRow(i.invoice.invoiceNumber)).toBeVisible();
		await context.close();
	});

	test("FEE-U07 a collector has no waive, adjust or refund buttons, but can mark a payment bounced", async ({ api, anon, seed, browser }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const made = (await pay(api, i, i.invoice.id, 100)).expectStatus([200, 201]).body;
		const { context, fees } = await signedInAs(api, anon, seed, browser, [...COLLECTOR_PERMISSIONS, "CLASS_VIEW"]);
		await fees.open();
		await fees.chooseStudent(await admission(api, i.studentIds[0]));
		await expect(fees.paymentRow(made.receiptNumber)).toBeVisible();
		const row = fees.invoiceRow(i.invoice.invoiceNumber);
		await expect(row.getByRole("button", { name: "Waive" })).toHaveCount(0);
		await expect(row.getByRole("button", { name: "Adjust" })).toHaveCount(0);
		await expect(fees.paymentRow(made.receiptNumber).getByRole("button", { name: "Refund" })).toHaveCount(0);
		await expect(fees.paymentRow(made.receiptNumber).getByRole("button", { name: "Mark bounced" })).toBeVisible();
		await context.close();
	});

	test("FEE-U07 a collector can record a payment end to end", async ({ api, anon, seed, browser }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		const { context, fees } = await signedInAs(api, anon, seed, browser, [...COLLECTOR_PERMISSIONS, "CLASS_VIEW"]);
		await fees.open();
		await fees.chooseStudent(await admission(api, i.studentIds[0]));
		await fees.recordPayment({ amount: 500, allocate: [{ invoiceNumber: i.invoice.invoiceNumber }] });
		await fees.submitPayment();
		await expect(fees.receiptDialog()).toBeVisible();
		await fees.closeReceipt();
		await expect(fees.invoiceRow(i.invoice.invoiceNumber)).toContainText("Paid");
		await context.close();
	});

	test("FEE-U07 a collector cannot open fee structure setup by typing the address", async ({ anon, api, seed, browser }) => {
		const { page, context } = await signedInAs(api, anon, seed, browser, COLLECTOR_PERMISSIONS);
		await page.goto("/fees/setup");
		await expect(page.getByRole("link", { name: "Back to fee collection" }).or(page.getByRole("button", { name: "Back to fee collection" }))).toBeVisible();
		await expect(page.getByRole("button", { name: "Add category" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Add component" })).toHaveCount(0);
		await context.close();
	});
});

test.describe("a read-only viewer", () => {
	test.use({ storageState: storageStatePath("readOnlyStaff") });

	test("FEE-U07 can look at a student's fees but has no buttons to change anything", async ({ api, feeCollection, page }) => {
		const i = await invoiced(api, { count: 1, each: 500 });
		await pay(api, i, i.invoice.id, 100);
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await expect(feeCollection.invoiceRow(i.invoice.invoiceNumber)).toBeVisible();
		const offered: string[] = [];
		for (const name of ["Assign fee", "Record payment", "Generate invoice", "Waive", "Adjust", "Refund", "Mark bounced"]) {
			if ((await page.getByRole("button", { name, exact: true }).count()) > 0) offered.push(name);
		}
		expect(offered, "buttons a view-only user should not be offered").toEqual([]);
	});
});
