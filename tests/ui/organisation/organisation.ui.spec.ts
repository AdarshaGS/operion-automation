// Organisation set-up screens. IDs refer to docs/SCENARIOS.md section 2 (ORG-U*).
// Every scenario provisions its own throwaway organisation through the API and seeds the
// browser session for its owner, so editing the profile or applying the template never
// touches the shared fixture organisation (and the dashboard, which the owner would land on
// after a form sign-in, is never loaded).

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation, type OtherOrganisation } from "../../../src/api/organisations";
import { EMPTY_STORAGE, signInWithSession } from "../../../src/ui/session";

test.use({ storageState: EMPTY_STORAGE });

async function freshOrganisation(request: Parameters<typeof createOtherOrganisation>[0], calls: Parameters<typeof createOtherOrganisation>[1], page: Parameters<typeof signInWithSession>[0]): Promise<OtherOrganisation> {
	const org = await createOtherOrganisation(request, calls);
	await signInWithSession(page, org.session);
	return org;
}

test.describe("organisation profile", () => {
	test("ORG-U03 the form shows the current values and saves changes that survive a reload", async ({ page, request, calls, organisationProfile }) => {
		const org = await freshOrganisation(request, calls, page);
		await organisationProfile.open();
		await expect(organisationProfile.nameField()).toHaveValue(/Other Org/);

		await organisationProfile.fill({ name: `Renamed ${org.slug}`, contactName: "Priya Principal", contactEmail: "principal@example.test", city: "Pune" });
		await organisationProfile.save();
		await expect(organisationProfile.successAlert()).toBeVisible();

		await page.reload();
		await expect(organisationProfile.nameField()).toHaveValue(`Renamed ${org.slug}`);
		await expect(page.getByLabel(/^City/)).toHaveValue("Pune");
		(await org.client.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => {
			expect(profile.name).toBe(`Renamed ${org.slug}`);
			expect(profile.primaryContactEmail ?? profile.contactEmail).toBe("principal@example.test");
		});
	});

	test("ORG-U03 the organisation name is required", async ({ page, request, calls, organisationProfile }) => {
		await freshOrganisation(request, calls, page);
		await organisationProfile.open();
		await organisationProfile.fill({ name: "" });
		await organisationProfile.save();
		await expect(organisationProfile.successAlert()).toHaveCount(0);
		await expect(page).toHaveURL(/\/settings\/profile/);
	});

	test("ORG-U03 an invalid contact email is not saved", async ({ page, request, calls, organisationProfile }) => {
		const org = await freshOrganisation(request, calls, page);
		await organisationProfile.open();
		await organisationProfile.fill({ contactEmail: "not-an-email" });
		await organisationProfile.save();
		await expect(organisationProfile.successAlert()).toHaveCount(0);
		(await org.client.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => {
			expect(profile.primaryContactEmail ?? profile.contactEmail ?? null).not.toBe("not-an-email");
		});
	});
});

test.describe("business settings", () => {
	test("ORG-U05 currency and date format save and persist across a reload", async ({ page, request, calls, businessSettings }) => {
		const org = await freshOrganisation(request, calls, page);
		await businessSettings.open();
		await businessSettings.setCurrency("USD");
		await businessSettings.setDateFormat("yyyy-MM-dd");
		await businessSettings.save();
		await expect(businessSettings.successAlert()).toBeVisible();

		await page.reload();
		await expect(businessSettings.currencyField()).toHaveValue("USD");
		await expect(businessSettings.dateFormatField()).toHaveValue("yyyy-MM-dd");
		(await org.client.get("/api/v1/organisations/settings")).expectStatus(200).expectJson((settings) => {
			expect(settings.defaultCurrency).toBe("USD");
			expect(settings.dateFormat).toBe("yyyy-MM-dd");
		});
	});

	test("ORG-U05 a timezone can be chosen from the list", async ({ page, request, calls, businessSettings }) => {
		const org = await freshOrganisation(request, calls, page);
		await businessSettings.open();
		await businessSettings.setTimezone("Asia/Kolkata");
		await businessSettings.save();
		await expect(businessSettings.successAlert()).toBeVisible();
		(await org.client.get("/api/v1/organisations/settings")).expectStatus(200).expectJson((settings) => expect(settings.timezone).toBe("Asia/Kolkata"));
	});

	test("ORG-U05 an invalid primary colour is rejected rather than saved", async ({ page, request, calls, businessSettings }) => {
		const org = await freshOrganisation(request, calls, page);
		await businessSettings.open();
		await businessSettings.primaryColourField().fill("not-a-colour");
		await businessSettings.save();
		await expect(businessSettings.successAlert()).toHaveCount(0);
		(await org.client.get("/api/v1/organisations/settings")).expectJson((settings) => expect(settings.primaryColor ?? null).not.toBe("not-a-colour"));
	});
});

test.describe("school setup template", () => {
	test("ORG-U04 applying the template reports what was added and offers the review", async ({ page, request, calls, schoolTemplate }) => {
		const org = await freshOrganisation(request, calls, page);
		await schoolTemplate.open();
		await schoolTemplate.apply();
		await expect(schoolTemplate.appliedMessage()).toBeVisible();
		await expect(page.getByText(/Added [1-9]\d* new items?/)).toBeVisible();
		(await org.client.get("/api/v1/grade-levels")).expectStatus(200).expectJson((grades) => expect(grades.length).toBeGreaterThan(0));
	});

	test("ORG-U04 applying twice says everything was already in place", async ({ page, request, calls, schoolTemplate }) => {
		await freshOrganisation(request, calls, page);
		await schoolTemplate.open();
		await schoolTemplate.apply();
		await expect(page.getByText(/Added [1-9]\d* new items?/)).toBeVisible();
		await schoolTemplate.apply();
		await expect(page.getByText("Everything was already in place - nothing new to add.")).toBeVisible();
	});

	test("ORG-U04 the review link opens the school setup review", async ({ page, request, calls, schoolTemplate, reviewSetup }) => {
		await freshOrganisation(request, calls, page);
		await schoolTemplate.open();
		await schoolTemplate.apply();
		await schoolTemplate.reviewSetup();
		await expect(page).toHaveURL(/\/setup\/review/);
		await expect(reviewSetup.heading()).toBeVisible();
	});
});

test.describe("review and go-live", () => {
	test("ORG-U06 the review page loads and links on to the go-live check", async ({ page, request, calls, reviewSetup, goLiveCheck }) => {
		await freshOrganisation(request, calls, page);
		await reviewSetup.open();
		await reviewSetup.runGoLiveCheck();
		await expect(page).toHaveURL(/\/setup\/go-live/);
		await expect(goLiveCheck.heading()).toBeVisible();
	});

	test("ORG-U06 a brand-new organisation is not ready to go live and offers fixes", async ({ page, request, calls, goLiveCheck }) => {
		await freshOrganisation(request, calls, page);
		await goLiveCheck.open();
		await expect(goLiveCheck.notReadyBanner()).toBeVisible();
		await expect(goLiveCheck.fixButtons().first()).toBeVisible();
	});

	test("ORG-U06 a Fix button takes the user to the screen that resolves the finding", async ({ page, request, calls, goLiveCheck }) => {
		await freshOrganisation(request, calls, page);
		await goLiveCheck.open();
		await goLiveCheck.fix(0);
		await expect(page).not.toHaveURL(/\/setup\/go-live/);
	});

	test("ORG-U06 back to review returns to the school setup review", async ({ page, request, calls, goLiveCheck }) => {
		await freshOrganisation(request, calls, page);
		await goLiveCheck.open();
		await goLiveCheck.backToReview();
		await expect(page).toHaveURL(/\/setup\/review/);
	});

	test("ORG-U06 applying the template reduces the blocking findings", async ({ page, request, calls, goLiveCheck }) => {
		const org = await freshOrganisation(request, calls, page);
		await goLiveCheck.open();
		const before = await goLiveCheck.fixButtons().count();
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		await goLiveCheck.open();
		expect(await goLiveCheck.fixButtons().count()).toBeLessThan(before);
	});
});

test.describe("structure setup wizard", () => {
	test("ORG-U01 the wizard walks profile, business settings and campuses, then finishes on the dashboard", async ({ page, request, calls, structureSetup, organisationProfile }) => {
		// Finishing lands on the dashboard, whose console errors are covered by the dashboard scenarios.
		test.info().annotations.push({ type: "diagnostics-handled" });
		const org = await freshOrganisation(request, calls, page);
		await structureSetup.open();
		await organisationProfile.fill({ contactName: "Priya Principal", contactEmail: "principal@example.test" });
		await structureSetup.next();
		await expect(page.getByRole("heading", { name: "Business settings" })).toBeVisible();
		await structureSetup.next();
		await expect(page.getByRole("heading", { name: /Campuses/ }).first()).toBeVisible();
		await structureSetup.goToStep("Review and finish");
		await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
		await structureSetup.finish();
		await expect(page).toHaveURL(/\/dashboard/);
		expect(org.id).toBeGreaterThan(0);
	});

	test("ORG-U01 the review step flags a missing campus", async ({ page, request, calls, structureSetup }) => {
		await freshOrganisation(request, calls, page);
		await structureSetup.open();
		await structureSetup.goToStep("Review and finish");
		await expect(structureSetup.reviewRow("At least one campus / location")).toBeVisible();
	});

	test("ORG-U01 Back is disabled on the first step and returns to it from the second", async ({ page, request, calls, structureSetup }) => {
		await freshOrganisation(request, calls, page);
		await structureSetup.open();
		await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
		await structureSetup.next();
		await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
		await structureSetup.back();
		await expect(page.getByRole("heading", { name: "Organisation profile" })).toBeVisible();
	});
});

test.describe("settings navigation", () => {
	test("ORG-U07 the organisation group links to its sections", async ({ page, request, calls, settings }) => {
		await freshOrganisation(request, calls, page);
		await settings.open();
		for (const section of ["Business settings", "Organisation profile", "School setup template"]) {
			await expect(page.getByText(section, { exact: true }).first()).toBeVisible();
		}
	});
});
