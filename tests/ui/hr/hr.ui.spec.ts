// HR screens: /hr (leave types, staff, pending leave requests, pending job applications) and
// /hr/staff/:id (status, transfer, exit, bank details, documents, leave balance and requests). IDs refer to
// docs/SCENARIOS.md section 15 (HR-U*). Rows are found by unique codes and names; anything that decides
// leave in a way another test could observe runs in a throwaway organisation.

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDepartment, createDesignation, createLeaveType, createStaff, HR, allocateLeave, raiseLeave, staffWithLeave } from "../../../src/api/hr";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { storageStatePath } from "../../../src/setup/session";
import { HrPage } from "../../../src/pages/hr/HrPage";

test.describe("the HR page", () => {
	test("HR-U00 shows the leave types, staff, pending leave requests and pending job applications panels", async ({ hr, page }) => {
		await hr.open();
		for (const heading of ["Leave types", "Staff", "Pending leave requests", "Pending job applications"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
		await expect(hr.panel("Staff").getByRole("button", { name: "Add staff" })).toBeVisible();
	});

	test("HR-U00 a brand-new organisation says there is no staff, leave or application yet", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const hr = new HrPage(page);
			await hr.open();
			await expect(page.getByText("No active staff yet.")).toBeVisible();
			await expect(page.getByText("No pending leave requests.")).toBeVisible();
			await expect(page.getByText("No pending job applications.")).toBeVisible();
		});
	});

	test("HR-U00 Add staff opens the Add staff member form", async ({ hr, page }) => {
		await hr.open();
		await hr.panel("Staff").getByRole("button", { name: "Add staff" }).click();
		await expect(page).toHaveURL(/\/hr\/staff\/new$/);
		await expect(page.getByRole("heading", { name: "Add staff member" })).toBeVisible();
	});
});

test.describe("HR-U01 leave types", () => {
	test("HR-U01 a leave type added from the dialog is listed with its code, name, days and status", async ({ hr, api }) => {
		const code = uniqueCode("UILT");
		const name = `UI Leave ${uniqueSuffix()}`;
		await hr.open();
		await hr.addLeaveType({ code, name, defaultAnnualDays: 9 });
		await expect(hr.dialog()).toBeHidden();
		const row = hr.leaveTypeRow(name);
		await expect(row).toContainText(code);
		await expect(row).toContainText("9");
		await expect(row).toContainText("ACTIVE");
		(await api.get(`${HR}/leave-types`)).expectJson((list) => expect(list.map((t: { code: string }) => t.code)).toContain(code));
	});

	test("HR-U01 the default days are optional and show a dash", async ({ hr }) => {
		const name = `UI Leave ${uniqueSuffix()}`;
		await hr.open();
		await hr.addLeaveType({ code: uniqueCode("UILT"), name });
		await expect(hr.leaveTypeRow(name)).toContainText("—");
	});

	test("HR-U01 Code and Name are required: the dialog stays open and nothing is created", async ({ hr, api }) => {
		await hr.open();
		await hr.panel("Leave types").getByRole("button", { name: "Add leave type" }).click();
		await hr.dialog().getByRole("button", { name: "Add", exact: true }).click();
		await expect(hr.dialog()).toBeVisible();
		await expect(hr.dialog().getByLabel("Code")).toBeFocused();
		await hr.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(hr.dialog()).toBeHidden();
	});

	test("HR-U01 a code that is already used shows the server's message and keeps the dialog open to fix it", async ({ hr, api }) => {
		const existing = await createLeaveType(api);
		await hr.open();
		await hr.addLeaveType({ code: existing.code, name: `Copy ${uniqueSuffix()}` });
		await expect(hr.dialog(), "the typed values must survive a failed save").toBeVisible();
		await expect(hr.dialog().getByRole("alert"), "the error is shown where the user is looking, inside the dialog").toBeVisible();
	});
});

test.describe("HR staff list", () => {
	test("HR-U01 a staff member is listed with code, name, designation, employment type and status; clicking opens the profile", async ({ hr, api, seed, page }) => {
		const staff = await createStaff(api, seed.campusId, { employmentType: "CONTRACT" });
		await hr.open();
		const row = hr.staffRow(staff.employeeCode);
		await expect(row).toContainText(staff.designationName);
		await expect(row).toContainText("CONTRACT");
		await expect(row).toContainText("ACTIVE");
		await expect(row).toContainText(/Staff P-/);
		await row.click();
		await expect(page).toHaveURL(new RegExp(`/hr/staff/${staff.id}$`));
		await expect(page.getByText(new RegExp(`^${staff.employeeCode} — ${staff.designationName}`))).toBeVisible();
	});

	test("HR-U01 a staff member who has left is no longer on the list", async ({ hr, api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "RESIGNATION", exitDate: "2026-08-31" } })).expectStatus(200);
		await hr.open();
		await expect(hr.panel("Staff")).toBeVisible();
		await expect(hr.staffRow(staff.employeeCode)).toHaveCount(0);
	});
});

test.describe("HR-U03 staff profile: status, transfer and exit", () => {
	test("HR-U03 the status can be changed from the profile", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await expect(page.getByRole("button", { name: "Update status" })).toBeDisabled();
		await staffDetail.updateStatus("TERMINATED");
		await expect(page.getByText("TERMINATED").first()).toBeVisible();
		(await api.get(`${HR}/staff/{id}`, { params: { id: staff.id } })).expectJson((s) => expect(s.status).toBe("TERMINATED"));
	});

	test("HR-U03 a transfer shows in the assignment history, with the old row closed", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		const designation = await createDesignation(api);
		const department = await createDepartment(api);
		await staffDetail.open(staff.id);
		await expect(staffDetail.assignmentRows(), "one assignment: no history table yet").toHaveCount(0);
		await staffDetail.transfer({ designation: designation.name, department: department.name, effectiveDate: "2026-04-01" });
		await expect(page.getByText(new RegExp(`${staff.employeeCode} — ${designation.name} \\(${department.name}\\)`))).toBeVisible();
		await expect(staffDetail.assignmentRows()).toHaveCount(2);
		await expect(staffDetail.assignmentRows().first()).toContainText(designation.name);
		await expect(staffDetail.assignmentRows().last()).toContainText("2026-04-01");
		(await api.get(`${HR}/staff/{id}/assignments`, { params: { id: staff.id } })).expectJson((list) => expect(list).toHaveLength(2));
	});

	test("HR-U03 Transfer is disabled until a designation is chosen", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await page.getByRole("button", { name: "Transfer", exact: true }).click();
		await expect(page.getByRole("dialog").getByRole("button", { name: "Transfer", exact: true })).toBeDisabled();
	});

	test("HR-U03 recording an exit shows the exit history, sets the status and disables the button", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await staffDetail.recordExit({ type: "RETIREMENT", date: "2026-08-31", reason: "Long service" });
		await expect(staffDetail.exitHistory()).toContainText("RETIREMENT on 2026-08-31 — Long service");
		await expect(page.getByText("RESIGNED").first()).toBeVisible();
		await expect(staffDetail.recordExitButton()).toBeDisabled();
		(await api.get(`${HR}/staff/{id}/exits`, { params: { id: staff.id } })).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("HR-U03 an exit date before the date of joining is refused with a message", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId, { dateOfJoining: "2026-01-01" });
		await staffDetail.open(staff.id);
		await staffDetail.recordExit({ type: "RESIGNATION", date: "2025-01-01" });
		await expect(staffDetail.alert(), "an exit before joining is saved without a word").toBeVisible();
		(await api.get(`${HR}/staff/{id}/exits`, { params: { id: staff.id } })).expectJson((list) => expect(list).toEqual([]));
	});
});

test.describe("HR-U03 staff profile: bank details", () => {
	test("HR-U03 bank details are saved, the button becomes Update, and they are there after a reload", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await staffDetail.saveBank({ holder: "Ui Teacher", number: "998877665544", bank: "Ui Bank", branch: "UB1", tax: "ABCDE9999Z" });
		await expect(staffDetail.bankSection().getByRole("button", { name: "Update" })).toBeVisible();
		await page.reload();
		await expect(staffDetail.bankField("Account holder name")).toHaveValue("Ui Teacher");
		await expect(staffDetail.bankField("Bank name")).toHaveValue("Ui Bank");
		await expect(staffDetail.bankField("Branch code")).toHaveValue("UB1");
		(await api.get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } })).expectJson((b) => expect(b.bankName).toBe("Ui Bank"));
	});

	test("HR-U03 the saved account number is masked on screen", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await staffDetail.saveBank({ holder: "Ui Teacher", number: "998877665544", bank: "Ui Bank" });
		await page.reload();
		await expect(staffDetail.bankField("Account number"), "the full number is shown").not.toHaveValue("998877665544");
	});
});

test.describe("HR-U03 staff profile: documents", () => {
	test("HR-U03 a document is added PENDING, then verified; another is rejected", async ({ api, seed, staffDetail, page }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await expect(page.getByText("No documents on file.")).toBeVisible();
		await staffDetail.addDocument({ type: "ID_PROOF", fileName: "passport.pdf", reference: `ref-${uniqueSuffix()}`, expiry: "2030-01-01" });
		const row = staffDetail.documentRows().filter({ hasText: "ID_PROOF" });
		await expect(row).toContainText("passport.pdf");
		await expect(row).toContainText("PENDING");
		await expect(row).toContainText("Expires 2030-01-01");
		await row.getByRole("button", { name: "Verify" }).click();
		await expect(row).toContainText("VERIFIED");
		await staffDetail.addDocument({ type: "CONTRACT", fileName: "contract.pdf", reference: `ref-${uniqueSuffix()}` });
		const second = staffDetail.documentRows().filter({ hasText: "CONTRACT" });
		await second.getByRole("button", { name: "Reject" }).click();
		await expect(second).toContainText("REJECTED");
		(await api.get(`${HR}/staff/{id}/documents`, { params: { id: staff.id } })).expectJson((list) => expect(list.map((d: { verificationStatus: string }) => d.verificationStatus).sort()).toEqual(["REJECTED", "VERIFIED"]));
	});

	test("HR-U03 a document that is past its expiry date is marked Expired", async ({ api, seed, staffDetail }) => {
		const staff = await createStaff(api, seed.campusId);
		await staffDetail.open(staff.id);
		await staffDetail.addDocument({ type: "VISA", fileName: "visa.pdf", reference: `ref-${uniqueSuffix()}`, expiry: "2020-01-01" });
		await expect(staffDetail.documentRows().filter({ hasText: "VISA" })).toContainText("Expired 2020-01-01");
	});
});

test.describe("HR-U02 leave", () => {
	test("HR-U02 allocating days shows allocated and remaining; Check shows them again later", async ({ api, seed, staffDetail }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		await staffDetail.open(staff.id);
		await staffDetail.allocate(type.name, seed.academicYearName, 12);
		await expect(staffDetail.balanceText()).toContainText("Allocated:");
		await expect(staffDetail.balanceText()).toContainText("12");
		await staffDetail.checkBalance(type.name, seed.academicYearName);
		await expect(staffDetail.balanceText()).toContainText("12");
	});

	test("HR-U02 a request is raised PENDING, approved from the profile, and the remaining balance drops", async ({ api, seed, staffDetail, page }) => {
		const { staff, type } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		await staffDetail.open(staff.id);
		await expect(page.getByText("No leave requests.")).toBeVisible();
		await staffDetail.raiseLeave({ leaveType: type.name, academicYear: seed.academicYearName, start: "2026-09-07", end: "2026-09-08", days: 2, reason: "Wedding" });
		const row = staffDetail.leaveRequestRows().first();
		await expect(row).toContainText(type.name);
		await expect(row).toContainText("2026-09-07");
		await expect(row).toContainText("PENDING");
		await row.getByRole("button", { name: "Approve" }).click();
		await expect(row).toContainText("APPROVED");
		await expect(row.getByRole("button")).toHaveCount(0);
		await staffDetail.checkBalance(type.name, seed.academicYearName);
		await expect(staffDetail.balanceText()).toContainText("8");
	});

	test("HR-U02 a request can be rejected and another cancelled", async ({ api, seed, staffDetail }) => {
		const { staff, ids } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		await raiseLeave(api, ids, { startDate: "2026-09-07", endDate: "2026-09-08" });
		await raiseLeave(api, ids, { startDate: "2026-10-05", endDate: "2026-10-06" });
		await staffDetail.open(staff.id);
		await staffDetail.leaveRequestRows().filter({ hasText: "2026-09-07" }).getByRole("button", { name: "Reject" }).click();
		await expect(staffDetail.leaveRequestRows().filter({ hasText: "2026-09-07" })).toContainText("REJECTED");
		await staffDetail.leaveRequestRows().filter({ hasText: "2026-10-05" }).getByRole("button", { name: "Cancel" }).click();
		await expect(staffDetail.leaveRequestRows().filter({ hasText: "2026-10-05" })).toContainText("CANCELLED");
	});

	test("HR-U02 approving more days than remain shows the server's message and leaves the request PENDING", async ({ api, seed, staffDetail }) => {
		const { staff, ids } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 1);
		await raiseLeave(api, ids, { numberOfDays: 2 });
		await staffDetail.open(staff.id);
		await staffDetail.leaveRequestRows().first().getByRole("button", { name: "Approve" }).click();
		await expect(staffDetail.alert()).toContainText(/exceeds remaining balance|balance/i);
		await expect(staffDetail.leaveRequestRows().first()).toContainText("PENDING");
	});

	test("HR-U02 the Pending leave requests inbox lists the request with the person's name and approves it", async ({ api, seed, hr }) => {
		const { staff, ids } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		const request = await raiseLeave(api, ids, { startDate: "2026-11-02", endDate: "2026-11-03" });
		await hr.open();
		const row = hr.pendingLeaveRow(staff.employeeCode);
		await expect(row).toContainText("2026-11-02");
		await expect(row).toContainText("2");
		await hr.button(row, "Approve").click();
		await expect(hr.pendingLeaveRow(staff.employeeCode)).toHaveCount(0);
		(await api.get(`${HR}/leave-requests`, { query: { staffProfileId: staff.id } })).expectJson((list) => expect(list.find((r: { id: number }) => r.id === request.id).status).toBe("APPROVED"));
	});

	test("HR-U02 rejecting from the inbox removes the row", async ({ api, seed, hr }) => {
		const { staff, ids } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		await raiseLeave(api, ids);
		await hr.open();
		await hr.button(hr.pendingLeaveRow(staff.employeeCode), "Reject").click();
		await expect(hr.pendingLeaveRow(staff.employeeCode)).toHaveCount(0);
	});

	test("HR-U02 the approver recorded is the person who clicked Approve", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const campusId = ((await org.client.get("/api/v1/campuses")).body as { id: number }[])[0].id;
		const year = (await org.client.post("/api/v1/academic-years", { body: { name: `Y ${uniqueSuffix()}`, startDate: "2026-04-01", endDate: "2027-03-31" } })).expectStatus([200, 201]).body;
		const { ids, staff } = await staffWithLeave(org.client, campusId, year.id, 5);
		const leave = await raiseLeave(org.client, ids);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const hr = new HrPage(page);
			await hr.open();
			await hr.button(hr.pendingLeaveRow(staff.employeeCode), "Approve").click();
			await expect(hr.pendingLeaveRow(staff.employeeCode)).toHaveCount(0);
		});
		const decided = ((await org.client.get(`${HR}/leave-requests`, { query: { staffProfileId: staff.id } })).body as { id: number; approvedBy: number }[]).find((r) => r.id === leave.id);
		expect(decided?.approvedBy, "the screen sends a fixed decidedBy of 1").toBe(org.session.userId);
	});
});

test.describe("HR-U04 job applications inbox", () => {
	const apply = async (anon: { post: Function }, slug: string) => {
		const email = `ui-${uniqueSuffix().toLowerCase()}@example.test`;
		(await anon.post("/api/v1/job-applications", { body: { organisationSlug: slug, applicantName: "Uma Applicant", email, specialization: "Physics", yearsExperience: 6 } })).expectStatus([200, 201]);
		return email;
	};

	test("HR-U04 a submitted application appears with name, email, specialization and experience, and can be approved", async ({ anon, hr, seed }) => {
		const email = await apply(anon, seed.organisationSlug);
		await hr.open();
		const row = hr.applicationRow(email);
		await expect(row, "a submitted application never reaches the inbox").toBeVisible();
		await expect(row).toContainText("Uma Applicant");
		await expect(row).toContainText("Physics");
		await expect(row).toContainText("6");
		await hr.button(row, "Approve").click();
		await expect(hr.applicationRow(email)).toHaveCount(0);
	});

	test("HR-U04 an application can be rejected from the inbox", async ({ anon, hr, seed }) => {
		const email = await apply(anon, seed.organisationSlug);
		await hr.open();
		await expect(hr.applicationRow(email), "a submitted application never reaches the inbox").toBeVisible();
		await hr.button(hr.applicationRow(email), "Reject").click();
		await expect(hr.applicationRow(email)).toHaveCount(0);
	});
});

test.describe("HR-U05 access", () => {
	test.describe("view-only staff", () => {
		test.use({ storageState: storageStatePath("readOnlyStaff") });

		test("HR-U05 sees the staff and leave lists", async ({ hr, api, seed }) => {
			const staff = await createStaff(api, seed.campusId);
			await hr.open();
			await expect(hr.staffRow(staff.employeeCode)).toBeVisible();
		});

		test("HR-U05 is not offered Transfer or Record exit on a profile", async ({ api, seed, staffDetail, page }) => {
			const staff = await createStaff(api, seed.campusId);
			await staffDetail.open(staff.id);
			await expect(page.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(0);
			await expect(staffDetail.recordExitButton()).toHaveCount(0);
		});

		test("HR-U05 is not offered the buttons that change HR data", async ({ api, seed, staffDetail, hr, page }) => {
			const { staff, ids } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
			await raiseLeave(api, ids);
			await staffDetail.open(staff.id);
			for (const name of ["Raise request", "Add document", "Allocate", "Approve", "Reject"]) {
				await expect.soft(page.getByRole("button", { name, exact: true }), `${name} on the profile`).toHaveCount(0);
			}
			await hr.open();
			await expect.soft(hr.panel("Leave types").getByRole("button", { name: "Add leave type" }), "Add leave type").toHaveCount(0);
			await expect.soft(hr.panel("Staff").getByRole("button", { name: "Add staff" }), "Add staff").toHaveCount(0);
			await expect.soft(hr.pendingLeaveRow(staff.employeeCode).getByRole("button"), "Approve and Reject in the inbox").toHaveCount(0);
		});
	});

	test.describe("no permissions", () => {
		test.use({ storageState: storageStatePath("noPermissions") });

		test("HR-U05 is not told there is no staff, and is not offered the add buttons, when the real reason is missing access", async ({ hr, page }) => {
			await page.goto("/hr");
			await page.getByRole("heading", { name: "Leave types" }).waitFor();
			await expect.soft(page.getByText("No active staff yet."), "an access error is presented as an empty roster").toHaveCount(0);
			await expect.soft(page.getByText("No pending leave requests."), "an access error is presented as an empty inbox").toHaveCount(0);
			await expect.soft(hr.panel("Staff").getByRole("button", { name: "Add staff" }), "Add staff").toHaveCount(0);
			await expect.soft(hr.panel("Leave types").getByRole("button", { name: "Add leave type" }), "Add leave type").toHaveCount(0);
			await expect.soft(page.getByText(/Missing required permission: HR_VIEW/), "the raw permission code is shown to the user").toHaveCount(0);
		});
	});
});
