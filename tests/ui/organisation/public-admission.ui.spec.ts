// The public admission inquiry form (/apply/:slug) - no sign-in. IDs: docs/SCENARIOS.md PUB-U*.

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { EMPTY_STORAGE } from "../../../src/ui/session";
import { uniqueSuffix } from "../../../src/api/data";

test.use({ storageState: EMPTY_STORAGE });

function child() {
	return { firstName: "Asha", lastName: `Form${uniqueSuffix()}`, dateOfBirth: "2018-05-10", guardianName: "Ravi Parent", guardianPhone: "+919876543210" };
}

test.describe("public admission form", () => {
	test("PUB-U01 the form names the organisation and needs no sign-in", async ({ page, request, calls, publicAdmission }) => {
		const org = await createOtherOrganisation(request, calls);
		await publicAdmission.open(org.slug);
		await expect(publicAdmission.heading()).toContainText("Other Org");
		await expect(page).toHaveURL(new RegExp(`/apply/${org.slug}`));
	});

	test("PUB-U02 a completed form is submitted and reaches the applicants list", async ({ request, calls, publicAdmission }) => {
		const org = await createOtherOrganisation(request, calls);
		const fields = child();
		await publicAdmission.open(org.slug);
		await publicAdmission.fill({ ...fields, guardianEmail: "parent@example.test", notes: "Keen on music" });
		await publicAdmission.submit();
		await expect(publicAdmission.successMessage()).toBeVisible();
		(await org.client.get("/api/v1/applicants")).expectStatus(200).expectJson((list) => expect(JSON.stringify(list)).toContain(fields.lastName));
	});

	test("PUB-U02 the class can be chosen once the school has classes", async ({ request, calls, publicAdmission }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const grades = (await org.client.get("/api/v1/grade-levels")).body;
		await publicAdmission.open(org.slug);
		await publicAdmission.fill({ ...child(), desiredClass: grades[0].name });
		await publicAdmission.submit();
		await expect(publicAdmission.successMessage()).toBeVisible();
	});

	test("PUB-U03 submitting an empty form shows field errors and sends nothing", async ({ page, request, calls, publicAdmission }) => {
		const org = await createOtherOrganisation(request, calls);
		let posted = false;
		page.on("request", (req) => {
			if (req.method() === "POST" && req.url().includes("/admission-inquiries")) posted = true;
		});
		await publicAdmission.open(org.slug);
		await expect(publicAdmission.heading()).toBeVisible();
		await publicAdmission.submit();
		await expect(publicAdmission.successMessage()).toHaveCount(0);
		await expect(page.locator(".Mui-error").first()).toBeVisible();
		expect(posted).toBe(false);
	});

	test("PUB-U03 an invalid guardian email is flagged", async ({ page, request, calls, publicAdmission }) => {
		const org = await createOtherOrganisation(request, calls);
		await publicAdmission.open(org.slug);
		await publicAdmission.fill({ ...child(), guardianEmail: "not-an-email" });
		await publicAdmission.submit();
		await expect(publicAdmission.successMessage()).toHaveCount(0);
		await expect(page.locator(".Mui-error").first()).toBeVisible();
	});

	test("PUB-U04 an unknown link shows a clear message and no form", async ({ page, publicAdmission, diagnostics }) => {
		// The 404 that drives the message is expected traffic.
		await publicAdmission.open("no-such-school");
		await expect(publicAdmission.invalidLinkMessage()).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit inquiry" })).toHaveCount(0);
		expect(diagnostics.failedRequests).toEqual([]);
	});
});
