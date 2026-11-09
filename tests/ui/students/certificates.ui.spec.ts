// Certificates: a transfer certificate's full life on the student page (request, a second person's approval,
// the dues-clearance gate, issue and print, reprint, cancel), the public QR verify page, and a parent asking
// for a bonafide certificate in the portal. Every test reads the downloaded PDF's text.
// IDs refer to docs/SCENARIOS.md section 31 (CERT-U01..CERT-U04).
//
// Serial: CERT-U01..U03 follow one transfer certificate from request to cancellation.

import { test, expect } from "../../../src/sanity/fixtures";
import { invoiced } from "../../../src/api/fees";
import { admitStudent } from "../../../src/api/students";
import { createDisposableUser } from "../../../src/api/users";
import { guardianInPortalRole } from "../../../src/api/portal";
import { signedInAs } from "../../../src/ui/asUser";
import { GuardianPortalPage } from "../../../src/pages/portal/GuardianPortalPage";
import { downloadedPdf } from "../../../src/support/pdf";
import type { ApiClient } from "../../../src/api/apiClient";
import type { Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const TYPES = "/api/v1/certificate-types";
const CERTS = "/api/v1/certificates";

/** The organisation's type with this code, created from the built-in preset when the School setup did not add it. */
async function certificateType(api: ApiClient, code: string, name: string): Promise<{ id: number; name: string }> {
	const existing = ((await api.get(TYPES)).expectStatus(200).body as any[]).find((t) => t.code === code);
	if (existing) return existing;
	return (await api.post(TYPES, { body: { code, name } })).expectStatus([200, 201]).body;
}

const panel = (page: Page) => page.getByTestId("student-certificates");

let tc: { requestId: number; studentId: number; studentName: string; number: string; verifyUrl: string };

test("CERT-U01 a TC requested on the student page waits for a second person's approval", async ({ api, anon, seed, page }) => {
	const type = await certificateType(api, "TC", "Transfer Certificate");
	// A student with an unpaid fee, so the clearance gate has something to report.
	const i = await invoiced(api, { count: 1, each: 500 });
	const studentId = i.studentIds[0];
	(await api.post("/api/v1/students/{studentId}/exits", {
		params: { studentId },
		body: { exitType: "TRANSFER", exitDate: "2026-10-15", reason: "Family relocating", destinationSchool: "Riverside Public School" },
	})).expectStatus([200, 201]);

	await page.goto(`/students/${studentId}`);
	await panel(page).getByRole("button", { name: "Request certificate" }).click();
	const dialog = page.getByRole("dialog", { name: "Request certificate" });
	await dialog.getByRole("combobox", { name: "Certificate" }).click();
	await page.getByRole("option", { name: type.name }).click();
	await dialog.getByLabel("Purpose").fill("Admission elsewhere");
	const raised = page.waitForResponse((r) => r.url().endsWith(CERTS) && r.request().method() === "POST");
	await dialog.getByRole("button", { name: "Request" }).click();
	const request = await (await raised).json();
	expect(request.status).toBe("PENDING_APPROVAL");

	const row = page.getByTestId(`certificate-row-${request.id}`);
	await expect(row).toContainText("Awaiting approval");
	await expect(row.getByRole("button", { name: "Issue" })).toHaveCount(0);

	// The person who asked cannot approve it.
	(await api.post(`${CERTS}/{id}/approve`, { params: { id: request.id } })).expectStatus(403);
	// Someone else with the approve permission can.
	const principal = await createDisposableUser(api, anon, seed, ["CERTIFICATE_VIEW", "CERTIFICATE_APPROVE"]);
	(await principal.client.post(`${CERTS}/{id}/approve`, { params: { id: request.id } })).expectStatus(200);
	// ...but cannot issue it.
	(await principal.client.post(`${CERTS}/{id}/issue`, { params: { id: request.id }, body: {} })).expectStatus(403);

	await page.reload();
	await expect(row).toContainText("Ready to issue");
	tc = { requestId: request.id, studentId, studentName: i.studentNames[0], number: "", verifyUrl: "" };
});

test("CERT-U02 issuing shows the pending fee, needs a reason to override, and prints the TC", async ({ api, page }) => {
	await page.goto(`/students/${tc.studentId}`);
	const row = page.getByTestId(`certificate-row-${tc.requestId}`);
	await row.getByRole("button", { name: "Issue" }).click();
	const dialog = page.getByRole("dialog");
	const clearance = dialog.getByTestId("certificate-clearance");
	await expect(clearance).toContainText("Pending");
	await expect(clearance).toContainText("500");
	const issue = dialog.getByRole("button", { name: "Issue and print" });
	await expect(issue).toBeDisabled();

	// Without the override the server refuses too.
	(await api.post(`${CERTS}/{id}/issue`, { params: { id: tc.requestId }, body: {} })).expectStatus(409);

	await dialog.getByLabel("Reason to issue despite pending dues").fill("Fee waived by principal");
	const pdf = await downloadedPdf((async () => {
		const download = page.waitForEvent("download");
		await issue.click();
		return download;
	})());
	expect(pdf.pageSizeMm).toEqual({ width: 210, height: 297 });
	// The title is letter-spaced, so the extracted text has a space between its letters.
	expect(pdf.text.replace(/\s+/g, "")).toContain("TRANSFERCERTIFICATE");
	expect(pdf.text).toContain(tc.studentName);
	expect(pdf.text).toContain("Riverside Public School");
	expect(pdf.text).toContain("Family relocating");
	expect(pdf.text).not.toContain("DUPLICATE");
	expect(pdf.text).not.toContain("CANCELLED");
	const number = pdf.text.match(/TC-\d{4}-\d{4}/)?.[0];
	expect(number, "certificate number in the PDF").toBeTruthy();
	const verifyUrl = pdf.text.replace(/\s+/g, "").match(/https?:\/\/[^\s]+?\/verify\/[\w-]+\/[\w-]{32}/)?.[0];
	expect(verifyUrl, "verify URL in the PDF").toBeTruthy();
	tc.number = number!;
	tc.verifyUrl = verifyUrl!;

	await expect(row).toContainText("Issued");
	await expect(row).toContainText(tc.number);
	const reprint = await downloadedPdf((async () => {
		const download = page.waitForEvent("download");
		await row.getByRole("button", { name: "Reprint" }).click();
		return download;
	})());
	expect(reprint.text).toContain("DUPLICATE COPY 2");
	expect(reprint.text).toContain(tc.number);

	// A transfer certificate is issued once per student.
	const type = await certificateType(api, "TC", "Transfer Certificate");
	(await api.post(CERTS, { body: { studentId: tc.studentId, certificateTypeId: type.id, purpose: "Again" } })).expectStatus(409);
});

test("CERT-U03 the QR link says genuine, then cancelled once the office cancels it", async ({ browser, page }) => {
	const visitor = await browser.newContext();
	try {
		const publicPage = await visitor.newPage();
		await publicPage.goto(tc.verifyUrl);
		const result = publicPage.getByTestId("verify-result");
		await expect(result).toContainText("genuine and valid");
		await expect(publicPage.getByText(tc.number)).toBeVisible();
		// Only the basics: no admission number on the public page.
		await expect(publicPage.locator("body")).not.toContainText("Admission");

		await page.goto(`/students/${tc.studentId}`);
		const row = page.getByTestId(`certificate-row-${tc.requestId}`);
		await row.getByRole("button", { name: "Cancel" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Reason").fill("Issued with a wrong date");
		await dialog.getByRole("button", { name: "Cancel certificate" }).click();
		await expect(row).toContainText("Cancelled");

		await publicPage.reload();
		await expect(result).toContainText("cancelled");

		const cancelled = await downloadedPdf((async () => {
			const download = page.waitForEvent("download");
			await row.getByRole("button", { name: "Reprint" }).click();
			return download;
		})());
		expect(cancelled.text).toContain("CANCELLED");

		const bogus = tc.verifyUrl.replace(/[\w-]{32}$/, "A".repeat(32));
		await publicPage.goto(bogus);
		await expect(publicPage.getByTestId("verify-result")).toContainText("No certificate matches this link");
	} finally {
		await visitor.close();
	}
});

test("CERT-U04 a parent requests a bonafide certificate in the portal and downloads it once issued", async ({ api, anon, seed, browser, page }) => {
	const bonafide = await certificateType(api, "BONAFIDE", "Bonafide Certificate");
	const tcType = await certificateType(api, "TC", "Transfer Certificate");
	const student = await admitStudent(api);
	const parent = await guardianInPortalRole(api, anon, seed, [student.id]);

	// The TC is not offered to parents.
	(await parent.client.post("/api/v1/me/children/{studentId}/certificates", {
		params: { studentId: student.id }, body: { certificateTypeId: tcType.id, purpose: "Transfer" },
	})).expectStatus(403);

	const { page: portal, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
	try {
		await new GuardianPortalPage(portal).open();
		const section = portal.getByTestId("guardian-certificates");
		await section.getByRole("button", { name: "Request a certificate" }).click();
		const dialog = portal.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Certificate" }).click();
		await expect(portal.getByRole("option", { name: tcType.name })).toHaveCount(0);
		await portal.getByRole("option", { name: bonafide.name }).click();
		await dialog.getByLabel("Purpose").fill("Bank account opening");
		await dialog.getByRole("button", { name: "Send request" }).click();
		await expect(section).toContainText(bonafide.name);
		await expect(section.getByRole("button", { name: "Download" })).toHaveCount(0);

		// The office sees it marked as a portal request and issues it.
		await page.goto(`/students/${student.id}`);
		const officeRow = panel(page).getByRole("row").filter({ hasText: bonafide.name });
		await expect(officeRow).toContainText("Portal");
		const issued = await downloadedPdf((async () => {
			await officeRow.getByRole("button", { name: "Issue" }).click();
			const download = page.waitForEvent("download");
			await page.getByRole("dialog").getByRole("button", { name: "Issue and print" }).click();
			return download;
		})());
		expect(issued.text).toContain("Bank account opening");

		await portal.reload();
		for (const attempt of [1, 2]) {
			const pdf = await downloadedPdf((async () => {
				const download = portal.waitForEvent("download");
				await section.getByRole("button", { name: "Download" }).click();
				return download;
			})());
			expect(pdf.text, `parent download ${attempt}`).toContain("Bank account opening");
			expect(pdf.text).not.toContain("DUPLICATE");
		}
	} finally {
		await context.close();
	}

	// Another family's child is refused.
	const other = await admitStudent(api);
	(await parent.client.get("/api/v1/me/children/{studentId}/certificates", { params: { studentId: other.id } })).expectStatus(403);
});
