// Sanity phase 04 - staff management, UI only. Continues on the business from phases 01-03: the
// owner checks the roles the school template created, adds a teacher and an accountant through HR
// "Add staff member" (login role + HR profile + invite in one form), the teacher accepts the invite
// in their own browser window, and the owner makes them Grade 1 A's class teacher and Mathematics
// teacher. The accountant's invite is kept for the fee phase.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, sanityStaff } from "../../src/sanity/business";
import { claimStaffInvite } from "../../src/sanity/claimInvite";
import { FIXED_PASSWORD } from "../../src/setup/roles";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-03",
	roles: "Roles › the template's roles are ready: Teacher, Principal, Accountant",
	addTeacher: "Staff › add a teacher with the Teacher role and an HR profile; an invite is issued",
	teacherProfile: "Staff › the teacher's HR profile shows employee code, designation and department",
	addAccountant: "Staff › add an accountant with the Accountant role; an invite is issued",
	staffList: "Staff › HR lists both staff members as ACTIVE",
	invited: "Members › both appear as Invited with their roles",
	claim: "Teacher › opens the invite link in their own window, enters the school and sets a password",
	active: "Members › the teacher is now Active",
	openSection: "Teacher assignment › open Grade 1, section A at Main Campus",
	homeroom: "Teacher assignment › make the teacher the class teacher (HOMEROOM)",
	subject: "Teacher assignment › assign the teacher to Mathematics",
	dashboard: "Dashboard › Roles and Members setup tasks are done",
	handoff: "Hand-off › staff logins are saved for later phases",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 04: staff management - roles, staff with HR profiles, invite claimed, teacher assigned", async ({
	page, browser, diagnostics, loginPage, roles, staffCreate, staffDetail, members, academics, classOfferings, sectionTeachers,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(3);
	const staff = sanityStaff(business.slug);
	const teacherName = `${staff.teacher.firstName} ${staff.teacher.lastName}`;
	const accountantName = `${staff.accountant.firstName} ${staff.accountant.lastName}`;
	let teacherClaimLink = "";
	let accountantClaimLink = "";

	await j.step(S.ownerLogin, async () => {
		// Already signed in from the previous phase; the login form is only used if this phase runs on its own.
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.roles, async () => {
		await roles.open();
		for (const role of ["Teacher", "Principal", "Accountant"]) {
			await expect(roles.row(new RegExp(`^${role}`))).toBeVisible();
		}
	});

	await j.step(S.addTeacher, async () => {
		await staffCreate.open();
		await staffCreate.fill(staff.teacher);
		await staffCreate.submit();
		await expect(staffCreate.inviteDialog()).toBeVisible();
		teacherClaimLink = await staffCreate.claimLink();
		expect(teacherClaimLink).toContain("/claim-staff-invite?token=");
		await staffCreate.closeInvite();
	});

	await j.step(S.teacherProfile, async () => {
		await expect(page).toHaveURL(/\/hr\/staff\/\d+$/);
		await expect(staffDetail.name(teacherName)).toBeVisible();
		await expect(staffDetail.summary(staff.teacher.employeeCode)).toContainText(`${staff.teacher.designation} (${staff.teacher.department})`);
	});

	await j.step(S.addAccountant, async () => {
		await staffCreate.open();
		await staffCreate.fill(staff.accountant);
		await staffCreate.submit();
		await expect(staffCreate.inviteDialog()).toBeVisible();
		accountantClaimLink = await staffCreate.claimLink();
		await staffCreate.closeInvite();
		await expect(staffDetail.name(accountantName)).toBeVisible();
	});

	await j.step(S.staffList, async () => {
		await page.goto("/hr");
		for (const person of [staff.teacher, staff.accountant]) {
			const row = page.getByRole("row").filter({ hasText: person.employeeCode });
			await expect(row).toContainText(`${person.firstName} ${person.lastName}`);
			await expect(row).toContainText(person.designation);
			await expect(row).toContainText("ACTIVE");
		}
	});

	await j.step(S.invited, async () => {
		await members.open();
		for (const [name, role] of [[teacherName, "Teacher"], [accountantName, "Accountant"]]) {
			await expect(members.row(name)).toContainText(role);
			await expect(members.row(name)).toContainText("Invited");
		}
	});

	await j.step(S.claim, async () => {
		await claimStaffInvite(browser, teacherClaimLink, business.slug, FIXED_PASSWORD);
	});

	await j.step(S.active, async () => {
		await members.open();
		await expect(members.row(teacherName)).toContainText("Active");
		await expect(members.row(accountantName)).toContainText("Invited");
	});

	await j.step(S.openSection, async () => {
		const { className, section } = staff.assignment;
		await academics.open("Class offerings");
		// The Classes list shows only the campus picked in the top bar (Main Campus in a fresh session), so rows carry no campus name.
		await classOfferings.row(business.academicYearName ?? "2026-27").filter({ has: page.getByRole("cell", { name: className, exact: true }) }).getByRole("cell", { name: className, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+$/);
		await page.getByRole("cell", { name: section, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+\/sections\/\d+$/);
		await expect(page.getByText("No teacher assignments yet.")).toBeVisible();
	});

	await j.step(S.homeroom, async () => {
		await sectionTeachers.assign({ type: "HOMEROOM", teacher: teacherName, startDate: staff.assignment.startDate });
		await expect(sectionTeachers.row("HOMEROOM", teacherName)).toContainText("ACTIVE");
	});

	await j.step(S.subject, async () => {
		await sectionTeachers.assign({ type: "SUBJECT", subject: staff.assignment.subject, teacher: teacherName, startDate: staff.assignment.startDate });
		await expect(sectionTeachers.row("SUBJECT", teacherName)).toContainText(staff.assignment.subject);
		await page.reload();
		await expect(sectionTeachers.row("HOMEROOM", teacherName)).toBeVisible();
		await expect(sectionTeachers.row("SUBJECT", teacherName)).toContainText(staff.assignment.subject);
	});

	await j.step(S.dashboard, async () => {
		await page.goto("/dashboard");
		await expect(page.getByText("Next setup step")).toBeVisible();
		await expect(page.getByRole("button", { name: "Manage roles" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Invite members" })).toHaveCount(0);
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 4,
			staff: { teacherEmail: staff.teacher.email, teacherPassword: FIXED_PASSWORD, accountantEmail: staff.accountant.email, accountantClaimLink },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
