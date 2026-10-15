// Sanity phase 05 - fee management, UI only. Continues on the business from phases 01-04: the
// accountant accepts the invite phase 04 issued, then the owner follows the dashboard guide to fee
// setup, checks the fee categories the school template brought (only those of switched-on
// modules), adds one of the school's own and builds Grade 1's fee structure for 2026-27 - each
// component with the installment schedule it is paid by. Phase 07 applies this structure to the
// student allocated to the class.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { claimStaffInvite } from "../../src/sanity/claimInvite";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, sanityStaff, SANITY_FEES as F, SANITY_SCHOOL_TEMPLATE as T } from "../../src/sanity/business";
import { FIXED_PASSWORD } from "../../src/setup/roles";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-04",
	accountantClaim: "Accountant › opens the invite link in their own window, enters the school and sets a password",
	accountantActive: "Members › the accountant is now Active",
	openSetup: "Fees › fee setup opens",
	templateCategories: "Categories › the template's fee categories are listed; Transport Fee is not (module off)",
	addCategory: "Categories › add the school's own category, Computer Lab Fee",
	structure: "Structure › Grade 1 at Main Campus, 2026-27 has none yet; set one up with the suggested name",
	tuition: "Structure › Tuition Fee: 36000 in 4 quarterly installments, 1000 off if paid at once",
	schedule: "Structure › installments that don't add up to the amount are refused",
	others: "Structure › Admission Fee (one installment) and Computer Lab Fee (two half-yearly)",
	saved: "Structure › the structure and its components are the same after a fresh load",
	dashboard: "Dashboard › the setup guide is still shown and has no Fees step",
	handoff: "Hand-off › the fee structure is saved for student allocation",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 05: fee management - categories, a class fee structure and its payment schedules", async ({
	page, browser, diagnostics, loginPage, members, feeSetup,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(4);
	const staff = sanityStaff(business.slug);
	const accountantName = `${staff.accountant.firstName} ${staff.accountant.lastName}`;
	const yearName = business.academicYearName ?? T.academicYear.name;
	const classLabel = `${F.className} · ${F.campus}`;
	const tuition = F.components[0];
	const feesStep = () => page.getByText("Configure fee structure", { exact: true });
	let structureName = "";

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.accountantClaim, async () => {
		expect(business.staff?.accountantClaimLink, "phase 04 saved the accountant's invite link").toContain("/claim-staff-invite?token=");
		await claimStaffInvite(browser, business.staff!.accountantClaimLink, business.slug, FIXED_PASSWORD);
	});

	await j.step(S.accountantActive, async () => {
		await members.open();
		await expect(members.row(accountantName)).toContainText("Accountant");
		await expect(members.row(accountantName)).toContainText("Active");
	});

	await j.step(S.openSetup, async () => {
		// Fees is no longer a step in the dashboard's setup guide (it is reached from its own screen), so open it directly.
		await feeSetup.open();
		await expect(page).toHaveURL(/\/fees\/setup$/);
		await expect(feeSetup.categoriesHeading()).toBeVisible();
		await expect(feeSetup.structuresHeading()).toBeVisible();
	});

	await j.step(S.templateCategories, async () => {
		for (const category of F.templateCategories) {
			await expect(feeSetup.categoryRow(category.code)).toContainText(category.name);
			await expect(feeSetup.categoryRow(category.code)).toContainText("ACTIVE");
		}
		await expect(feeSetup.categoryRow(F.absentCategoryCode), "Transport is off, so its fee category is not created").toHaveCount(0);
	});

	await j.step(S.addCategory, async () => {
		await feeSetup.addCategory(F.addedCategory);
		const row = feeSetup.categoryRow(F.addedCategory.code);
		await expect(row).toContainText(F.addedCategory.name);
		await expect(row).toContainText(F.addedCategory.type);
		await expect(row).toContainText("ACTIVE");
	});

	await j.step(S.structure, async () => {
		await feeSetup.selectClass(yearName, classLabel);
		await expect(feeSetup.noStructureNotice()).toBeVisible();
		const { suggestedName } = await feeSetup.setUpStructure();
		expect(suggestedName, "the suggested name names the class and the year").toBe(`${classLabel} Fees ${yearName}`);
		structureName = suggestedName;
		await feeSetup.createStructure(structureName);
		await expect(feeSetup.structureName(structureName)).toBeVisible();
		await expect(feeSetup.noStructureNotice()).toBeHidden();
	});

	await j.step(S.tuition, async () => {
		await feeSetup.fillComponent(tuition);
		await expect(feeSetup.totalsWarning()).toBeHidden();
		// Keep the dialog open: the next step checks the schedule must add up before saving.
	});

	await j.step(S.schedule, async () => {
		const dialog = feeSetup.componentDialog();
		const lastAmount = dialog.getByLabel("Amount", { exact: true }).last();
		await lastAmount.fill("8000");
		await expect(feeSetup.totalsWarning()).toContainText(`must equal the structure amount (${tuition.amount})`);
		await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
		await lastAmount.fill(String(tuition.installments[tuition.installments.length - 1].amount));
		await expect(feeSetup.totalsWarning()).toBeHidden();
		await feeSetup.submitComponent();
		const row = feeSetup.componentRow(tuition.category);
		await expect(row).toContainText(String(tuition.amount));
		await expect(row).toContainText(tuition.frequency);
		await expect(row).toContainText(String(tuition.oneShotDiscount));
		await expect(row.getByRole("cell").nth(2), "installment count").toHaveText(String(tuition.installments.length));
	});

	await j.step(S.others, async () => {
		for (const component of F.components.slice(1)) {
			await feeSetup.fillComponent(component);
			await feeSetup.submitComponent();
			const row = feeSetup.componentRow(component.category);
			await expect(row).toContainText(String(component.amount));
			await expect(row).toContainText(component.frequency);
			await expect(row.getByRole("cell").nth(2), "installment count").toHaveText(String(component.installments.length));
			await expect(row).toContainText("ACTIVE");
		}
	});

	await j.step(S.saved, async () => {
		await page.reload();
		await expect(feeSetup.categoriesHeading()).toBeVisible();
		await expect(feeSetup.categoryRow(F.addedCategory.code)).toBeVisible();
		await feeSetup.selectClass(yearName, classLabel);
		await expect(feeSetup.structureName(structureName)).toBeVisible();
		for (const component of F.components) {
			await expect(feeSetup.componentRow(component.category)).toContainText(String(component.amount));
		}
	});

	await j.step(S.dashboard, async () => {
		await page.goto("/dashboard");
		await expect(page.getByText("Next setup step")).toBeVisible();
		await expect(feesStep(), "Fees is not a step in the setup guide any more").toHaveCount(0);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 5,
			staff: { ...business.staff!, accountantPassword: FIXED_PASSWORD },
			fees: { structureName, className: F.className, campus: F.campus, total: F.components.reduce((sum, c) => sum + c.amount, 0) },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
