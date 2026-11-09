// The self-service screens: portal routing (/portal), the parent portal, the teacher portal (sections and
// leave), My payslips and My profile (change requests), plus the admin inbox for those requests. IDs refer to
// docs/SCENARIOS.md section 21 (ME-U*, ME-10). Each test signs in as its own throwaway user.

import { test, expect } from "../../../src/sanity/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { invoiced } from "../../../src/api/fees";
import { createLeaveType, allocateLeave } from "../../../src/api/hr";
import { portalGuardian } from "../../../src/api/learning";
import { CHANGES, ME, OWN_CHANGES, guardianInPortalRole, portalTeacher, portalUser, uniqueEmail, uniquePhone } from "../../../src/api/portal";
import { generateRun, payrollOrg, staffWithSalary, PAYROLL } from "../../../src/api/payroll";
import { createDisposableUser } from "../../../src/api/users";
import { signedInAs } from "../../../src/ui/asUser";
import { GuardianPortalPage } from "../../../src/pages/portal/GuardianPortalPage";
import { TeacherPortalPage } from "../../../src/pages/portal/TeacherPortalPage";
import { ProfilePage } from "../../../src/pages/portal/ProfilePage";
import { MyPayslipsPage } from "../../../src/pages/portal/MyPayslipsPage";
import { uniqueSuffix } from "../../../src/api/data";

test.describe("ME-10 portal routing", () => {
	test("ME-10 a teacher who opens the app is sent to the Teacher portal", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			await page.goto("/");
			await expect(page).toHaveURL(/\/portal\/teacher$/);
			await expect(page.getByRole("heading", { name: "Teacher portal" })).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-10 a portal user is kept out of the admin screens", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			for (const path of ["/dashboard", "/students", "/hr", "/payroll"]) {
				await page.goto(path);
				await expect(page, path).toHaveURL(/\/portal\//);
			}
		} finally {
			await context.close();
		}
	});

	test("ME-10 an administrator who opens the portal is sent back to the app", async ({ page }) => {
		await page.goto("/portal/teacher");
		await expect(page).not.toHaveURL(/\/portal/);
	});

	test("ME-10 a parent who claims an invite lands in the Parent portal", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, g.email);
		try {
			await page.goto("/");
			await expect(page, "the claimed Guardian role is not a portal role, so the parent lands in the admin app").toHaveURL(/\/portal\/guardian$/);
		} finally {
			await context.close();
		}
	});

	test("ME-10 a portal user linked to nothing is told to contact the administrator", async ({ api, anon, seed, browser }) => {
		const user = await portalUser(api, anon, seed);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, user.email);
		try {
			await page.goto("/");
			await expect(page.getByText("Your account doesn't have any portal access configured yet.")).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-10 someone who is both teacher and parent chooses which portal to open", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const guardian = (await api.post("/api/v1/guardians", { body: { personId: teacher.personId, occupation: "Teacher" } })).expectStatus([200, 201]).body;
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: s.studentIds[0] }, body: { guardianId: guardian.id, relationshipType: "MOTHER", primaryGuardian: false, emergencyContact: false, canPickup: true, canReceiveCommunication: true, contactPriority: 1 } })).expectStatus(200);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			await page.goto("/");
			await expect(page.getByText("Choose what you'd like to view")).toBeVisible();
			await expect(page.getByText("1 linked child")).toBeVisible();
			await page.getByRole("button", { name: /Teacher portal/ }).click();
			await expect(page).toHaveURL(/\/portal\/teacher$/);
		} finally {
			await context.close();
		}
	});

	test("ME-10 the portal header shows the person's name and signing out returns to the login page", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			await page.goto("/portal");
			await expect(page.getByRole("banner").getByText(/Disposable/)).toBeVisible();
			await page.getByRole("button", { name: "Sign out" }).click();
			await expect(page).toHaveURL(/\/login/);
		} finally {
			await context.close();
		}
	});
});

test.describe("ME-U01 the parent portal", () => {
	test("ME-U01 shows the child's fees, outstanding total and invoice, and no results or announcements yet", async ({ api, anon, seed, browser }) => {
		const f = await invoiced(api, { count: 2, each: 1500 });
		const parent = await guardianInPortalRole(api, anon, seed, [f.studentIds[0]]);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			await expect(page.getByText("Fees outstanding")).toBeVisible();
			await expect(page.getByText("₹1,500").first()).toBeVisible();
			await expect(guardian.invoiceRow(f.invoice.invoiceNumber)).toContainText("₹1,500");
			await expect(guardian.invoiceRow(f.invoice.invoiceNumber)).toContainText(f.invoice.status);
			await expect(page.getByText("No published results yet.")).toBeVisible();
			await expect(guardian.learningLink()).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-U01 a child with no invoices says so", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const parent = await guardianInPortalRole(api, anon, seed, s.studentIds);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			await expect(page.getByText("No invoices yet.")).toBeVisible();
			await expect(page.getByText("Not marked")).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-U01 with two children, a toggle switches whose fees are shown", async ({ api, anon, seed, browser }) => {
		const f = await invoiced(api, { students: 2, count: 1, each: 900 });
		const parent = await guardianInPortalRole(api, anon, seed, f.studentIds);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			for (const name of f.studentNames) await expect(guardian.childButton(name)).toBeVisible();
			await expect(guardian.invoiceRow(f.invoice.invoiceNumber)).toBeVisible();
			await guardian.childButton(f.studentNames[1]).click();
			await expect(page.getByText("No invoices yet.")).toBeVisible();
			await expect(guardian.invoiceRow(f.invoice.invoiceNumber)).toHaveCount(0);
		} finally {
			await context.close();
		}
	});

	test("ME-U01 a published announcement shows its title and body", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const { enableModule } = await import("../../../src/setup/provisioning");
		await enableModule((await api.get("/api/v1/auth/me")).expectStatus(200).body.organisationId, "COMMUNICATION");
		const title = `Sports day ${uniqueSuffix()}`;
		const created = (await api.post("/api/v1/announcements", { body: { campusId: null, title, body: "Bring your kit", audienceType: "ORG", audienceRefId: null } })).expectStatus([200, 201]).body;
		(await api.post("/api/v1/announcements/{id}/publish", { params: { id: created.id } })).expectStatus(200);
		const parent = await guardianInPortalRole(api, anon, seed, s.studentIds);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			const guardian = new GuardianPortalPage(page);
			await guardian.open();
			await expect(guardian.section("Announcements")).toContainText(title);
			await expect(guardian.section("Announcements")).toContainText("Bring your kit");
		} finally {
			await context.close();
		}
	});

	test("ME-U01 a parent with no linked child is told to contact the administrator", async ({ api, anon, seed, browser }) => {
		const parent = await guardianInPortalRole(api, anon, seed, []);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, parent.email);
		try {
			await page.goto("/portal/guardian");
			await expect(page.getByText("No children are linked to your account yet.")).toBeVisible();
		} finally {
			await context.close();
		}
	});
});

test.describe("ME-U02 the teacher portal and leave", () => {
	test("ME-U02 lists the teacher's sections and the leave balance for the current academic year", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		const years = (await api.get("/api/v1/academic-years")).expectStatus(200).body as { id: number; current: boolean }[];
		const year = years.find((y) => y.current) ?? years[0];
		await allocateLeave(api, teacher.staffProfileId, type.id, year.id, 7);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			const portal = new TeacherPortalPage(page);
			await portal.open();
			await expect(page.getByText(`${s.className} - ${s.sectionName}`)).toBeVisible();
			await expect(page.getByText(type.name).first()).toBeVisible();
			await expect(page.getByText("7").first()).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-U02 a leave request raised from the dialog appears as PENDING and HR sees it", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		const years = (await api.get("/api/v1/academic-years")).expectStatus(200).body as { id: number; current: boolean }[];
		const year = years.find((y) => y.current) ?? years[0];
		await allocateLeave(api, teacher.staffProfileId, type.id, year.id, 5);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			const portal = new TeacherPortalPage(page);
			await portal.open();
			await portal.requestLeave({ leaveType: type.name, start: "2026-09-07", end: "2026-09-08", days: 2, reason: "Family event" });
			await expect(portal.dialog()).toHaveCount(0);
			const row = portal.leaveRow(type.name).filter({ hasText: "2026-09-07" });
			await expect(row).toContainText("PENDING");
			await expect(row).toContainText("2026-09-08");
			(await api.get("/api/v1/hr/leave-requests", { query: { staffProfileId: teacher.staffProfileId } })).expectJson((list) => expect(list).toEqual([expect.objectContaining({ status: "PENDING", numberOfDays: 2, reason: "Family event" })]));
		} finally {
			await context.close();
		}
	});

	test("ME-U02 a request whose end date is before the start shows an error and raises nothing", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		const years = (await api.get("/api/v1/academic-years")).expectStatus(200).body as { id: number; current: boolean }[];
		await allocateLeave(api, teacher.staffProfileId, type.id, (years.find((y) => y.current) ?? years[0]).id, 5);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, teacher.email);
		try {
			const portal = new TeacherPortalPage(page);
			await portal.open();
			await portal.requestLeave({ leaveType: type.name, start: "2026-09-09", end: "2026-09-07", days: 1 });
			await expect(portal.dialog().getByRole("alert").or(portal.alert()).first()).toBeVisible();
			(await api.get("/api/v1/hr/leave-requests", { query: { staffProfileId: teacher.staffProfileId } })).expectJson((list) => expect(list).toEqual([]));
		} finally {
			await context.close();
		}
	});
});

test.describe("ME-U03 my profile and change requests", () => {
	test("ME-U03 shows the person's details and role, and no change requests yet", async ({ api, anon, seed, browser }) => {
		const user = await createDisposableUser(api, anon, seed, [], { portal: true });
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, user.email);
		try {
			const profile = new ProfilePage(page);
			await profile.open();
			await expect(profile.field("Primary email")).toContainText(user.email);
			await expect(profile.field("First name")).toContainText("Disposable");
			await expect(profile.field("User ID")).toContainText(String(user.userId));
			await expect(page.getByText("No change requests yet.")).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("ME-U03 a submitted change is listed as PENDING with the requested phone", async ({ api, anon, seed, browser }) => {
		const user = await createDisposableUser(api, anon, seed, [], { portal: true });
		const phone = uniquePhone();
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, user.email);
		try {
			const profile = new ProfilePage(page);
			await profile.open();
			await profile.requestChange({ phone });
			await expect(profile.dialog()).toHaveCount(0);
			await expect(profile.requestRow(phone)).toContainText("PENDING");
			(await user.client.get(OWN_CHANGES)).expectJson((list) => expect(list).toEqual([expect.objectContaining({ phone, status: "PENDING" })]));
		} finally {
			await context.close();
		}
	});

	test("ME-U03 submitting with every field empty asks for at least one and sends nothing", async ({ api, anon, seed, browser }) => {
		const user = await createDisposableUser(api, anon, seed, [], { portal: true });
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, user.email);
		try {
			const profile = new ProfilePage(page);
			await profile.open();
			await profile.requestChange({});
			await expect(profile.dialog().getByText("Fill in at least one field to request a change")).toBeVisible();
			(await user.client.get(OWN_CHANGES)).expectJson((list) => expect(list).toEqual([]));
		} finally {
			await context.close();
		}
	});

	test("ME-U03 once a manager approves, the request shows APPROVED", async ({ api, anon, seed, browser }) => {
		const user = await createDisposableUser(api, anon, seed, [], { portal: true });
		const phone = uniquePhone();
		const request = (await user.client.post(OWN_CHANGES, { body: { phone } })).body;
		(await api.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } })).expectStatus(200);
		const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, user.email);
		try {
			const profile = new ProfilePage(page);
			await profile.open();
			await expect(profile.requestRow(phone)).toContainText("APPROVED");
		} finally {
			await context.close();
		}
	});

	test("ME-U03 the admin inbox lists pending requests; Approve applies the change and Reject drops it", async ({ api, anon, seed, page }) => {
		const [one, two] = [await createDisposableUser(api, anon, seed, []), await createDisposableUser(api, anon, seed, [])];
		const [phoneOne, phoneTwo] = [uniquePhone(), uniquePhone().replace("+9198", "+9197")];
		await one.client.post(OWN_CHANGES, { body: { phone: phoneOne } });
		await two.client.post(OWN_CHANGES, { body: { phone: phoneTwo } });
		await page.goto("/settings/profile-change-requests");
		await expect(page.getByRole("heading", { name: "Pending profile change requests" })).toBeVisible();
		const rowOne = page.getByRole("row").filter({ hasText: phoneOne });
		const rowTwo = page.getByRole("row").filter({ hasText: phoneTwo });
		await expect(rowOne).toContainText(`Person #${one.personId}`);
		await rowOne.getByRole("button", { name: "Approve" }).click();
		await expect(rowOne).toHaveCount(0);
		await rowTwo.getByRole("button", { name: "Reject" }).click();
		await expect(rowTwo).toHaveCount(0);
		expect((await api.get("/api/v1/persons/{id}", { params: { id: one.personId } })).body.phone).toBe(phoneOne);
		expect((await api.get("/api/v1/persons/{id}", { params: { id: two.personId } })).body.phone).not.toBe(phoneTwo);
	});
});

test.describe("ME-U04 my payslips", () => {
	test("ME-U04 a staff member sees only their finalized payslip, opens it, and cannot see a colleague's", async ({ browser, request, calls, anon }) => {
		const org = await payrollOrg(request, calls);
		const ctx = { organisationSlug: org.slug, campusId: org.campusId };
		const me = await createDisposableUser(org.client, anon, ctx, [], { portal: true });
		await staffWithSalary(org.client, org.campusId, { basic: 20000, staff: { personId: me.personId } });
		await staffWithSalary(org.client, org.campusId, { basic: 77777 });
		const run = await generateRun(org.client, 2026, 6);
		const { page, context } = await signedInAs(browser, anon, org.slug, me.email);
		try {
			const payslips = new MyPayslipsPage(page);
			await payslips.open();
			await expect(page.getByText("No payslips have been published for you yet.")).toBeVisible();
			(await org.client.post(`${PAYROLL}/runs/{id}/finalize`, { params: { id: run.id } })).expectStatus(200);
			await payslips.open();
			await expect(payslips.row("June 2026")).toContainText("20,000.00");
			await expect(page.getByText("77,777.00")).toHaveCount(0);
			await payslips.row("June 2026").getByRole("link", { name: "June 2026" }).click();
			await expect(page.getByRole("heading", { name: "Payslip - June 2026" })).toBeVisible();
			await expect(page.getByText("20,000.00").first()).toBeVisible();
			await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
			await page.getByRole("link", { name: "Back to payslips" }).click();
			await expect(page).toHaveURL(/\/portal\/payslips$/);
		} finally {
			await context.close();
		}
	});
});
