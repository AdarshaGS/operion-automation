// Admissions page: status chips with counts, review, approve (creates the student), reject with a
// reason, document checklist, public link. IDs refer to docs/SCENARIOS.md section 6 (ADM-U*).
// Most tests use a throwaway organisation so counts are exact; approving creates a student, which only
// works in the shared organisation (Operion #354), so those tests use the shared one and look their row up by name.

import { test, expect } from "../../../src/sanity/fixtures";
import { createApplicant } from "../../../src/api/admissions";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { UI_BASE_URL } from "../../../src/config/env";
import { storageStateFor } from "../../../src/ui/session";
import { storageStatePath } from "../../../src/setup/session";
import { uniqueCode } from "../../../src/api/data";
import { AdmissionsPage } from "../../../src/pages/admissions/AdmissionsPage";
import { instrument } from "../../../src/ui/instrument";

async function inThrowawayOrg<T>(browser: import("@playwright/test").Browser, session: import("../../../src/ui/session").BrowserSession, run: (page: import("@playwright/test").Page, admissions: AdmissionsPage) => Promise<T>) {
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(session, UI_BASE_URL) });
	const page = await context.newPage();
	try {
		return await run(page, instrument(new AdmissionsPage(page)));
	} finally {
		await context.close();
	}
}

test.describe("pipeline board", () => {
	test("ADM-U01 the chips show the counts and each filters the table to its stage", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const [open, reviewing, rejected] = [await createApplicant(org.client), await createApplicant(org.client), await createApplicant(org.client)];
		await org.client.post("/api/v1/applicants/{id}/start-review", { params: { id: reviewing.id } });
		await org.client.post("/api/v1/applicants/{id}/reject", { params: { id: rejected.id }, body: { reason: "No seat" } });

		await inThrowawayOrg(browser, org.session, async (page, admissions) => {
			await admissions.open();
			await expect(admissions.chip("All")).toHaveText("All: 3");
			await expect(admissions.chip("Pending")).toHaveText("Pending: 1");
			await expect(admissions.chip("Under Review")).toHaveText("Under Review: 1");
			await expect(admissions.chip("Approved")).toHaveText("Approved: 0");
			await expect(admissions.chip("Rejected")).toHaveText("Rejected: 1");
			await expect(page.getByRole("row")).toHaveCount(4);

			await admissions.filterBy("Pending");
			await expect(admissions.row(open.body.lastName)).toBeVisible();
			await expect(page.getByRole("row")).toHaveCount(2);
			await admissions.filterBy("Under Review");
			await expect(admissions.row(reviewing.body.lastName)).toBeVisible();
			await admissions.filterBy("Rejected");
			await expect(admissions.row(rejected.body.lastName)).toContainText("No seat");
			await admissions.filterBy("Approved");
			await expect(admissions.emptyState("No applicants marked Approved.")).toBeVisible();
		});
	});

	test("ADM-U01 an organisation with no applicants says so", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			await expect(admissions.emptyState("No applicants yet.")).toBeVisible();
			await expect(admissions.chip("All")).toHaveText("All: 0");
		});
	});

	test("ADM-U01 each row shows the applicant, date of birth, class, guardian and inquiry date", async ({ browser, request, anon, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const options = await anon.get("/api/v1/public/orgs/{slug}/admission-inquiries/form-options", { params: { slug: org.slug } });
		const lastName = `Row${uniqueCode("L")}`;
		await anon.post("/api/v1/public/orgs/{slug}/admission-inquiries", { params: { slug: org.slug }, body: { firstName: "Rani", lastName, dateOfBirth: "2018-05-10", gender: "FEMALE", desiredGradeId: options.body.grades[0].id, guardianName: "Ravi Parent", guardianPhone: "+919876543210", guardianEmail: "parent@example.test" } });
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			const row = admissions.row(lastName);
			await expect(row).toContainText("Rani");
			await expect(row).toContainText("2018-05-10");
			await expect(row).toContainText(options.body.grades[0].name);
			await expect(row).toContainText("Ravi Parent");
			await expect(row).toContainText("+919876543210");
			await expect(row).toContainText("Pending");
		});
	});

	test("ADM-U01 paging: more than 20 applicants spread over pages", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (let n = 0; n < 22; n++) await createApplicant(org.client);
		await inThrowawayOrg(browser, org.session, async (page, admissions) => {
			await admissions.open();
			await expect(page.getByRole("row")).toHaveCount(21);
			await page.getByRole("button", { name: /next page/i }).click();
			await expect(page.getByRole("row")).toHaveCount(3);
			await expect(page.getByText(/21–22 of 22/)).toBeVisible();
		});
	});
});

test.describe("moving an applicant through", () => {
	test("ADM-U02 start review then approve creates the student and links to the record", async ({ admissions, page, api }) => {
		const applicant = await createApplicant(api);
		const number = uniqueCode("UIADM");
		await admissions.open();
		await admissions.revealRow(applicant.body.lastName);
		await admissions.startReview(applicant.body.lastName);
		await expect(admissions.row(applicant.body.lastName)).toContainText("Under Review");
		await admissions.openApprove(applicant.body.lastName);
		await admissions.approve({ admissionNumber: number, admissionDate: "2026-06-02", previousSchool: "Old School" });
		await expect(admissions.dialog().getByText("Admitted as a student.")).toBeVisible();
		await admissions.dialog().getByRole("link", { name: "Open student record" }).click();
		await expect(page).toHaveURL(/\/students\/\d+$/);
		await expect(page.getByText(number, { exact: true })).toBeVisible();
		await expect(page.getByText("Old School")).toBeVisible();
		(await api.get("/api/v1/applicants", { query: { status: "CONVERTED", size: 1000 } })).expectJson((list) => expect(list.content.map((a: { id: number }) => a.id)).toContain(applicant.id));
	});

	test("ADM-U02 an approved applicant shows as Approved and loses its action buttons", async ({ admissions, api }) => {
		const applicant = await createApplicant(api);
		await api.post("/api/v1/applicants/{id}/convert", { params: { id: applicant.id }, body: { admissionDate: "2026-06-02" } });
		await admissions.open();
		await admissions.filterBy("Approved");
		await admissions.revealRow(applicant.body.lastName);
		const row = admissions.row(applicant.body.lastName);
		await expect(row).toContainText("Approved");
		for (const name of ["Start review", "Approve", "Reject"]) await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
		await expect(row.getByRole("button", { name: "Documents" })).toBeVisible();
	});

	test("ADM-U02 approve cannot be submitted without an admission date", async ({ admissions, api }) => {
		const applicant = await createApplicant(api);
		await admissions.open();
		await admissions.revealRow(applicant.body.lastName);
		await admissions.openApprove(applicant.body.lastName);
		await expect(admissions.dialog().getByRole("button", { name: "Approve and admit" })).toBeDisabled();
	});

	test("ADM-U02 a duplicate admission number is reported and the applicant stays open", async ({ admissions, api, seed }) => {
		const applicant = await createApplicant(api);
		await admissions.open();
		await admissions.revealRow(applicant.body.lastName);
		await admissions.openApprove(applicant.body.lastName);
		await admissions.approve({ admissionNumber: seed.studentAdmissionNumber, admissionDate: "2026-06-02" });
		await expect(admissions.dialog().getByRole("alert")).toBeVisible();
		await expect(admissions.dialog().getByText("Admitted as a student.")).toHaveCount(0);
		(await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).expectJson((list) => expect(list.content.map((a: { id: number }) => a.id)).toContain(applicant.id));
	});

	test("ADM-U02 the counts update after a change", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const applicant = await createApplicant(org.client);
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			await expect(admissions.chip("Pending")).toHaveText("Pending: 1");
			await admissions.startReview(applicant.body.lastName);
			await expect(admissions.chip("Pending")).toHaveText("Pending: 0");
			await expect(admissions.chip("Under Review")).toHaveText("Under Review: 1");
		});
	});
});

test.describe("rejecting", () => {
	test("ADM-U03 the reject dialog needs a reason before it can be submitted", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const applicant = await createApplicant(org.client);
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			await admissions.openReject(applicant.body.lastName);
			const submit = admissions.dialog().getByRole("button", { name: "Reject", exact: true });
			await expect(submit).toBeDisabled();
			await admissions.dialog().getByLabel("Reason").fill("   ");
			await expect(submit).toBeDisabled();
		});
		(await org.client.get("/api/v1/applicants/status-counts")).expectJson((counts) => expect(counts.INQUIRY).toBe(1));
	});

	test("ADM-U03 rejecting with a reason moves the applicant to Rejected and shows the reason", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const applicant = await createApplicant(org.client);
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			await admissions.openReject(applicant.body.lastName);
			await admissions.dialog().getByLabel("Reason").fill("No seat available");
			await admissions.dialog().getByRole("button", { name: "Reject", exact: true }).click();
			await expect(admissions.row(applicant.body.lastName)).toContainText("Rejected");
			await expect(admissions.row(applicant.body.lastName)).toContainText("No seat available");
			await expect(admissions.chip("Rejected")).toHaveText("Rejected: 1");
			for (const name of ["Start review", "Approve", "Reject"]) await expect(admissions.row(applicant.body.lastName).getByRole("button", { name, exact: true })).toHaveCount(0);
		});
	});
});

test.describe("documents and public link", () => {
	test("ADM-U04 the documents dialog lists the five documents, saves received ones and remembers them", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const applicant = await createApplicant(org.client);
		await inThrowawayOrg(browser, org.session, async (_page, admissions) => {
			await admissions.open();
			await admissions.openDocuments(applicant.body.lastName);
			for (const label of ["Birth certificate", "Previous marksheet", "Transfer certificate", "Address proof", "Photo"]) await expect(admissions.documentCheckbox(label)).not.toBeChecked();
			await admissions.documentCheckbox("Birth certificate").check();
			await admissions.documentCheckbox("Photo").check();
			await admissions.dialog().getByRole("button", { name: "Save" }).click();
			await expect(admissions.dialog()).toHaveCount(0);
			await admissions.openDocuments(applicant.body.lastName);
			await expect(admissions.documentCheckbox("Birth certificate")).toBeChecked();
			await expect(admissions.documentCheckbox("Photo")).toBeChecked();
			await expect(admissions.documentCheckbox("Address proof")).not.toBeChecked();
		});
		(await org.client.get("/api/v1/applicants/{id}/documents", { params: { id: applicant.id } })).expectJson((docs) => expect(docs.filter((d: { received: boolean }) => d.received)).toHaveLength(2));
	});

	test("ADM-U05 the public form link dialog builds the link from the organisation slug", async ({ admissions, seed }) => {
		await admissions.open();
		await admissions.publicLinkButton().click();
		await admissions.dialog().getByLabel("Organisation slug").fill(seed.organisationSlug);
		await expect(admissions.dialog().getByLabel("Link")).toHaveValue(new RegExp(`/apply/${seed.organisationSlug}|${seed.organisationSlug}`));
		await expect(admissions.dialog().getByRole("button", { name: "Copy link" })).toBeEnabled();
	});
});

test.describe("read-only staff", () => {
	test.describe("signed in as read-only staff", () => {
		test.use({ storageState: storageStatePath("readOnlyStaff") });

		test("ADM-U06 sees the applicants and their documents but none of the action buttons", async ({ admissions, page }) => {
			await admissions.open();
			await expect(page.getByRole("row").nth(1)).toBeVisible();
			for (const name of ["Start review", "Approve", "Reject"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Documents" }).first()).toBeVisible();
		});

		test("ADM-U06 the documents dialog has no Save button", async ({ admissions, page }) => {
			await admissions.open();
			await page.getByRole("button", { name: "Documents" }).first().click();
			await expect(admissions.dialog().getByRole("button", { name: "Save" })).toHaveCount(0);
		});
	});
});

test.describe("record an inquiry on the students page", () => {
	test("ADM-U07 Record inquiry on the students page creates an applicant that appears under Pending", async ({ page, api }) => {
		const lastName = uniqueCode("Inq");
		await page.goto("/students");
		await page.getByRole("button", { name: "Record inquiry" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel(/^First name/).fill("Ila");
		await dialog.getByLabel(/^Last name/).fill(lastName);
		await dialog.getByLabel("Date of birth").fill("2018-05-10");
		// Gender is a required dropdown on the inquiry form (the person record requires it).
		await dialog.getByRole("combobox", { name: /^Gender/ }).click();
		await page.getByRole("option", { name: "Male", exact: true }).click();
		await dialog.getByLabel("Inquiry date").fill("2026-06-01");
		await dialog.getByLabel("Source").fill("Walk-in");
		await dialog.getByRole("button", { name: /^(Record|Save|Submit)/ }).last().click();
		await expect(page.getByRole("row").filter({ hasText: lastName })).toBeVisible();
		(await api.get("/api/v1/applicants", { query: { status: "INQUIRY", size: 1000 } })).expectJson((list) => expect(JSON.stringify(list.content)).toContain(lastName));
	});
});
