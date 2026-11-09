// PDF fee receipts: the office copy and its duplicates, the receipt from the Payment recorded dialog,
// a bounced payment's receipt, the receipt page size in Settings > Letter formats, and the parent
// portal's own copy. Every test reads the downloaded PDF's text, not just its file name.
// IDs refer to docs/SCENARIOS.md section 9 (FEE-U08..FEE-U12).
//
// Serial: FEE-U11 switches the organisation's receipt page size, which every other receipt here renders with.

import { test, expect } from "../../../src/sanity/fixtures";
import { invoiced, assigned, invoiceFor, pay, FEES } from "../../../src/api/fees";
import { guardianInPortalRole } from "../../../src/api/portal";
import { signedInAs } from "../../../src/ui/asUser";
import { GuardianPortalPage } from "../../../src/pages/portal/GuardianPortalPage";
import { downloadedPdf } from "../../../src/support/pdf";

test.describe.configure({ mode: "serial" });

const RECEIPT_TEMPLATE = "/api/v1/document-templates/RECEIPT";

/** Puts the receipt layout back to the default so other tests (and other runs) see A4. */
async function resetReceiptLayout(api: Parameters<typeof invoiced>[0]) {
	(await api.put(RECEIPT_TEMPLATE, { body: { templateStyle: "CLASSIC", pageSize: "A4", fontStyle: "Sans-serif", fontSize: 12, headerSubtext: null } })).expectStatus(200);
}

test.describe("office receipts", () => {
	test.beforeAll(async ({ api }) => resetReceiptLayout(api));

	test("FEE-U08 the first receipt printed is the original; the next one says DUPLICATE COPY 2", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 1250 });
		const payment = (await pay(api, i, i.invoice.id, 1250, { paymentMethod: "UPI", paymentReference: "UTR-RCPT-1" })).expectStatus([200, 201]).body;
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);

		const original = await downloadedPdf(feeCollection.downloadReceipt(payment.receiptNumber));
		expect(original.fileName).toBe(`receipt-${payment.receiptNumber}.pdf`);
		expect(original.pageSizeMm).toEqual({ width: 210, height: 297 });
		expect(original.text).toContain("FEE RECEIPT");
		expect(original.text).toContain(payment.receiptNumber);
		expect(original.text).toContain(i.studentNames[0]);
		expect(original.text).toContain(i.invoice.invoiceNumber);
		expect(original.text).toContain(`${i.category.name} - Installment 1`);
		expect(original.text).toContain("₹ 1,250.00");
		expect(original.text).toContain("Rupees One Thousand Two Hundred Fifty Only");
		expect(original.text).toContain("UTR-RCPT-1");
		expect(original.text).toContain("Balance due ₹ 0.00");
		expect(original.text).not.toContain("DUPLICATE");
		expect(original.text).not.toContain("CANCELLED");

		const reprint = await downloadedPdf(feeCollection.downloadReceipt(payment.receiptNumber));
		expect(reprint.text).toContain("DUPLICATE COPY 2");
		expect(reprint.text).toContain(payment.receiptNumber);
		expect(reprint.text).toContain("₹ 1,250.00");
	});

	test("FEE-U09 Download receipt in the Payment recorded dialog gives the receipt just recorded", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 1000 });
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		await feeCollection.recordPayment({ amount: 400, allocate: [{ invoiceNumber: i.invoice.invoiceNumber, amount: 400 }] });
		await feeCollection.submitPayment();
		await expect(feeCollection.receiptDialog()).toBeVisible();
		const receiptNumber = ((await feeCollection.receiptDialog().textContent()) ?? "").match(/RCT-[\w-]+/)?.[0];
		expect(receiptNumber).toBeTruthy();

		const pdf = await downloadedPdf(feeCollection.downloadReceiptFromDialog());
		expect(pdf.text).toContain(receiptNumber!);
		expect(pdf.text).toContain("₹ 400.00");
		expect(pdf.text).toContain("Rupees Four Hundred Only");
		expect(pdf.text).toContain("Balance due ₹ 600.00");
		expect(pdf.text).toContain("CASH");
		expect(pdf.text).not.toContain("DUPLICATE");
		await feeCollection.closeReceipt();
	});

	test("FEE-U10 a bounced cheque's receipt still downloads, marked CANCELLED", async ({ api, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 900 });
		const cheque = (await pay(api, i, i.invoice.id, 900, { paymentMethod: "CHEQUE", paymentReference: "CHQ-RCPT", paymentBankName: "Canara Bank" }))
			.expectStatus([200, 201]).body;
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } })).expectStatus(200);
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);

		const pdf = await downloadedPdf(feeCollection.downloadReceipt(cheque.receiptNumber));
		expect(pdf.text).toContain("CANCELLED - PAYMENT BOUNCED");
		expect(pdf.text).toContain("CHQ-RCPT");
		expect(pdf.text).toContain("Canara Bank");
		expect(pdf.text).toContain("CHEQUE");
	});
});

test.describe("receipt layout in Settings > Letter formats", () => {
	test.afterAll(async ({ api }) => resetReceiptLayout(api));

	test("FEE-U11 only the fee receipt offers the 80 mm thermal roll, and receipts then print 80 mm wide", async ({ api, settings, feeCollection, page }) => {
		await settings.openSection("letter-formats");
		await page.getByRole("tab", { name: "Report card" }).click();
		await page.getByRole("combobox", { name: "Page size" }).click();
		await expect(page.getByRole("option", { name: "A5" })).toBeVisible();
		await expect(page.getByRole("option", { name: "80 mm thermal roll" })).toHaveCount(0);
		await page.keyboard.press("Escape");

		await page.getByRole("tab", { name: "Fee receipt" }).click();
		await page.getByRole("combobox", { name: "Page size" }).click();
		await page.getByRole("option", { name: "80 mm thermal roll" }).click();
		const saved = page.waitForResponse((r) => r.url().includes(RECEIPT_TEMPLATE) && r.request().method() === "PUT");
		await page.getByRole("button", { name: "Save" }).click();
		expect((await saved).status()).toBe(200);
		expect((await api.get(RECEIPT_TEMPLATE)).expectStatus(200).body).toMatchObject({ pageSize: "THERMAL_80MM", configured: true });

		const i = await invoiced(api, { count: 1, each: 300 });
		const payment = (await pay(api, i, i.invoice.id, 300)).expectStatus([200, 201]).body;
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		const pdf = await downloadedPdf(feeCollection.downloadReceipt(payment.receiptNumber));
		expect(pdf.pageSizeMm.width).toBe(80);
		expect(pdf.text).toContain(payment.receiptNumber);
		expect(pdf.text).toContain("₹ 300.00");
	});

	test("FEE-U11 the server refuses the thermal size for anything but receipts", async ({ api }) => {
		const res = await api.put("/api/v1/document-templates/REPORT_CARD", {
			body: { templateStyle: "CLASSIC", pageSize: "THERMAL_80MM", fontStyle: "Sans-serif", fontSize: 12, headerSubtext: null },
		});
		res.expectStatus(400);
	});
});

test.describe("receipts in the parent portal", () => {
	test("FEE-U12 a parent sees their child's payment and downloads a receipt that never says DUPLICATE", async ({ api, anon, seed, browser, feeCollection }) => {
		const i = await invoiced(api, { count: 1, each: 2000 });
		const payment = (await pay(api, i, i.invoice.id, 2000)).expectStatus([200, 201]).body;
		const parent = await guardianInPortalRole(api, anon, seed, [i.studentIds[0]]);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			const row = guardian.paymentRow(payment.receiptNumber);
			await expect(row).toContainText("₹2,000");
			await expect(row).toContainText("CLEARED");

			for (const attempt of [1, 2]) {
				const pdf = await downloadedPdf(guardian.downloadReceipt(payment.receiptNumber));
				expect(pdf.text, `parent download ${attempt}`).toContain(payment.receiptNumber);
				expect(pdf.text).toContain(i.studentNames[0]);
				expect(pdf.text).toContain("₹ 2,000.00");
				expect(pdf.text).not.toContain("DUPLICATE");
			}
		} finally {
			await context.close();
		}

		// The parent's downloads did not use up the office original.
		await feeCollection.open();
		await feeCollection.chooseStudent(i.studentNames[0]);
		const office = await downloadedPdf(feeCollection.downloadReceipt(payment.receiptNumber));
		expect(office.text).not.toContain("DUPLICATE");
	});

	test("FEE-U12 a payment that also covers another family's child is hidden from the parent and its receipt is refused", async ({ api, anon, seed, browser }) => {
		const i = await invoiced(api, { students: 2, count: 1, each: 800 });
		const other = await assigned(api, i, 1);
		const otherInvoice = (await invoiceFor(api, other.id, i.structure.installments[0].id)).expectStatus([200, 201]).body;
		const own = (await pay(api, i, i.invoice.id, 300)).expectStatus([200, 201]).body;
		const shared = (await pay(api, i, i.invoice.id, 500, {
			amount: 1300,
			allocations: [{ invoiceId: i.invoice.id, amount: 500 }, { invoiceId: otherInvoice.id, amount: 800 }],
		})).expectStatus([200, 201]).body;

		const parent = await guardianInPortalRole(api, anon, seed, [i.studentIds[0]]);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			await expect(guardian.paymentRow(own.receiptNumber)).toBeVisible();
			await expect(guardian.paymentRow(shared.receiptNumber)).toHaveCount(0);

			// Asking for it directly, as this parent, is refused too.
			(await parent.client.get("/api/v1/me/children/{studentId}/payments/{paymentId}/receipt.pdf", {
				params: { studentId: i.studentIds[0], paymentId: shared.id },
			})).expectStatus(403);
			(await parent.client.get("/api/v1/me/children/{studentId}/payments", { params: { studentId: i.studentIds[1] } })).expectStatus(403);
		} finally {
			await context.close();
		}
	});
});
