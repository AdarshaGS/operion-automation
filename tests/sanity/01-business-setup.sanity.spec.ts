// Sanity phase 01 - onboarding a new business, UI only. Everything happens in the browser the way
// people do it: the platform operator provisions the business in the platform console, the new
// owner signs in, follows the dashboard's setup guide into the structure wizard and fills every
// step, then Settings shows what was saved. No API calls - every check is something on screen.
//
// The business it creates is saved for the next phase (see src/sanity/business.ts).

import { test, expect } from "../../src/sanity/phaseFixtures";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { clearSanityBusiness, sanityBusinessDetails, saveSanityBusiness, SANITY_SCHOOL_TEMPLATE as T } from "../../src/sanity/business";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../../src/config/env";

const S = {
	platformLogin: "Platform console › operator signs in",
	provision: "Platform console › add the new business with its owner login",
	listed: "Platform console › the business is listed on a TRIAL and its detail page opens",
	platformLogout: "Platform console › operator signs out",
	ownerLogin: "Owner › signs in through the login form",
	guide: "Dashboard › the setup guide shows Structure as the first open task",
	openWizard: "Dashboard › 'Go to structure' opens the structure setup wizard",
	profile: "Organisation profile › fill identity, contact and address and save",
	settings: "Business settings › set timezone, currency, date format and working days and save",
	year: "Academic year › add 2026-27 and mark it current",
	campus: "Campuses (optional) › the default campus is listed and a second campus is added",
	review: "Review › every required item shows as done, with 2 active campuses",
	finish: "Finish › 'Finish setup' returns to the dashboard with Structure complete",
	profileSaved: "Settings › organisation profile shows the saved details after a fresh load",
	settingsSaved: "Settings › business settings show the saved values after a fresh load",
	structureSaved: "Settings › the campus is listed after a fresh load",
	handoff: "Hand-off › the business is saved for the next sanity phase",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 01: onboard a new business through the UI, from platform console to Structure complete", async ({
	page, diagnostics, platformLogin, platformOrganisations, loginPage, structureSetup, organisationProfile, businessSettings, academicYears, campuses,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	clearSanityBusiness();
	const business = sanityBusinessDetails();
	let organisationId = 0;

	await j.step(S.platformLogin, async () => {
		await platformLogin.open();
		await platformLogin.login(PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
		await expect(page).toHaveURL(/\/platform\/dashboard/);
	});

	await j.step(S.provision, async () => {
		await platformOrganisations.open();
		await platformOrganisations.add({
			name: business.profile.name,
			legalName: business.profile.legalName,
			slug: business.slug,
			adminFirstName: business.owner.firstName,
			adminLastName: business.owner.lastName,
			adminEmail: business.owner.email,
			adminPassword: business.owner.password,
		});
	});

	await j.step(S.listed, async () => {
		const row = platformOrganisations.row(business.slug);
		await expect(row).toContainText(business.profile.name);
		await expect(row, "a newly provisioned business starts on a trial").toContainText("TRIAL");
		organisationId = await platformOrganisations.openDetail(business.slug);
		await expect(page.getByRole("heading", { name: business.profile.name })).toBeVisible();
	});

	await j.step(S.platformLogout, async () => {
		await platformLogin.signOut();
		await expect(page).toHaveURL(/\/platform\/login/);
	});

	await j.step(S.ownerLogin, async () => {
		await loginPage.open();
		await loginPage.login(business.slug, business.owner.email, business.owner.password);
		await expect(page).toHaveURL(/\/dashboard/);
	});

	await j.step(S.guide, async () => {
		await expect(page.getByText("Next setup step")).toBeVisible();
		await expect(page.getByText(/^0 of \d+ setup tasks complete$/)).toBeVisible();
		await expect(page.getByRole("button", { name: "Go to structure" })).toBeVisible();
	});

	await j.step(S.openWizard, async () => {
		await page.getByRole("button", { name: "Go to structure" }).click();
		await expect(page).toHaveURL(/\/setup\/structure$/);
		await expect(page.getByRole("heading", { name: "Structure setup" })).toBeVisible();
	});

	await j.step(S.profile, async () => {
		// The name typed in the platform console must be loaded before we overwrite anything.
		await expect(organisationProfile.nameField()).toHaveValue(business.profile.name);
		await organisationProfile.fill(business.profile);
		await organisationProfile.save();
		// A successful save moves the wizard on by itself.
		await expect(structureSetup.step("Business settings")).toHaveAttribute("aria-selected", "true");
	});

	await j.step(S.settings, async () => {
		await expect(businessSettings.currencyField()).toBeVisible();
		await businessSettings.setTimezone(business.settings.timezone);
		await businessSettings.setCurrency(business.settings.currency);
		await businessSettings.setDateFormat(business.settings.dateFormat);
		await businessSettings.setWorkingDays(business.settings.workingDays);
		await businessSettings.save();
		await expect(structureSetup.step("Academic year")).toHaveAttribute("aria-selected", "true");
	});

	await j.step(S.year, async () => {
		await expect(academicYears.heading()).toBeVisible();
		await academicYears.add(T.academicYear);
		await academicYears.markCurrent(T.academicYear.name);
		await expect(academicYears.currentChip(T.academicYear.name)).toBeVisible();
		await structureSetup.next();
		await expect(structureSetup.step("Campuses")).toHaveAttribute("aria-selected", "true");
	});

	await j.step(S.campus, async () => {
		await expect(campuses.heading()).toBeVisible();
		await expect(campuses.row("Main Campus"), "provisioning creates a default campus").toBeVisible();
		await campuses.add(business.campus);
		await expect(campuses.row(business.campus.name)).toContainText(business.campus.code);
		await expect(campuses.row(business.campus.name)).toContainText("ACTIVE");
		await structureSetup.next();
	});

	await j.step(S.review, async () => {
		await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
		for (const label of ["Organisation profile (primary contact name and email)", "Business settings (timezone)", "A current academic year"]) {
			await expect(structureSetup.reviewRowDoneIcon(label), `"${label}" is ticked`).toBeVisible();
		}
		await expect(page.getByText(/Optional: 2 active campus \/ locations/)).toBeVisible();
	});

	await j.step(S.finish, async () => {
		await structureSetup.finish();
		await expect(page).toHaveURL(/\/dashboard/);
		await expect(page.getByText(/^[1-9]\d* of \d+ setup tasks complete$/)).toBeVisible();
		await expect(page.getByRole("button", { name: "Go to structure" })).toHaveCount(0);
	});

	await j.step(S.profileSaved, async () => {
		const p = business.profile;
		await organisationProfile.open();
		const expected: [RegExp, string][] = [
			[/^Organisation name/, p.name], [/^Legal name/, p.legalName], [/^Contact name/, p.contactName], [/^Contact email/, p.contactEmail],
			[/^Contact phone/, p.contactPhone], [/^Address line 1/, p.addressLine1], [/^City/, p.city], [/^State/, p.state],
			[/^Country/, p.country], [/^Pincode/, p.pincode], [/^Legal \/ tax identifier/, p.taxIdentifier],
		];
		for (const [label, value] of expected) await expect(page.getByLabel(label)).toHaveValue(value);
	});

	await j.step(S.settingsSaved, async () => {
		const s = business.settings;
		await businessSettings.open();
		await expect(businessSettings.timezoneField()).toContainText(s.timezone);
		await expect(businessSettings.currencyField()).toHaveValue(s.currency);
		await expect(businessSettings.dateFormatField()).toHaveValue(s.dateFormat);
		for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
			if (s.workingDays.includes(day)) await expect(businessSettings.workingDay(day)).toBeChecked();
			else await expect(businessSettings.workingDay(day)).not.toBeChecked();
		}
	});

	await j.step(S.structureSaved, async () => {
		await page.goto("/settings/campuses");
		await expect(campuses.row(business.campus.name)).toContainText(business.campus.city);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ organisationId, slug: business.slug, ownerEmail: business.owner.email, ownerPassword: business.owner.password, details: business, academicYearName: T.academicYear.name, completedPhase: 1 });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
