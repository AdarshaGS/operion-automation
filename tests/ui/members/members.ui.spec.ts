// Members and roles screens. IDs refer to docs/SCENARIOS.md section 3 (MEM-U*).
// Members/roles created here are uniquely named in the shared organisation. Nothing touches the
// Owner role or the fixture users, so the other UI specs keep their sessions.

import { test, expect } from "../../../src/sanity/fixtures";
import { createDisposableUser } from "../../../src/api/users";
import { uniqueSuffix } from "../../../src/api/data";
import { UI_BASE_URL } from "../../../src/config/env";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { EMPTY_STORAGE, storageStateFor } from "../../../src/ui/session";

function person() {
	const suffix = uniqueSuffix();
	return { firstName: "Mina", lastName: `Member${suffix}`, email: `mina-${suffix.toLowerCase()}@example.test`, suffix };
}

test.describe("inviting a member", () => {
	test("MEM-U01 the members page shows the totals and the member table", async ({ page, members, seed }) => {
		await members.open();
		await expect(members.tile("Total members")).toBeVisible();
		await expect(members.tile("Active")).toBeVisible();
		await expect(members.tile("Pending")).toBeVisible();
		await expect(page.getByRole("columnheader", { name: "Person" })).toBeVisible();
		await expect(members.row(seed.ownerEmail)).toBeVisible();
	});

	test("MEM-U01 inviting a member shows the one-time claim link and lists them as invited", async ({ page, members, api }) => {
		const { firstName, lastName, email } = person();
		const role = (await api.get("/api/v1/roles")).body.find((r: { name: string }) => r.name === "Auto Read Only Staff");
		await members.open();
		await members.openAddMember();
		await members.fillMember({ firstName, lastName, email, roles: [role.name] });
		await members.submitInvite();

		await expect(members.inviteIssuedDialog()).toBeVisible();
		await expect(members.inviteIssuedDialog().getByLabel("Claim link")).toHaveValue(/\/claim-staff-invite\?token=/);
		expect((await members.inviteToken()).length).toBeGreaterThan(20);
		await members.closeInviteIssued();

		await expect(members.row(lastName)).toBeVisible();
		await expect(members.row(lastName)).toContainText("Invited");
		await expect(members.row(lastName)).toContainText(email);
		(await api.get("/api/v1/memberships")).expectJson((rows) => expect(rows.find((m: { email: string }) => m.email === email).memberStatus).toBe("INVITED"));
		expect(page.url()).toContain("/members");
	});

	test("MEM-U01 the /members/invite link opens the Add member dialog straight away", async ({ members }) => {
		await members.openInviteLink();
		await expect(members.dialog()).toBeVisible();
	});

	test("MEM-U01 the dialog cannot be submitted without a name or a role", async ({ page, members }) => {
		let posted = false;
		page.on("request", (request) => {
			if (request.method() === "POST" && /\/(persons|users\/invite|memberships)$/.test(request.url())) posted = true;
		});
		await members.open();
		await members.openAddMember();
		await members.submitInvite();
		await expect(members.dialog()).toBeVisible();
		expect(posted).toBe(false);
	});

	test("MEM-U01 cancelling the dialog adds nobody", async ({ members, api }) => {
		const { firstName, lastName, email } = person();
		await members.open();
		await members.openAddMember();
		await members.fillMember({ firstName, lastName, email });
		await members.cancelAddMember();
		await expect(members.dialog()).toBeHidden();
		(await api.get("/api/v1/memberships")).expectJson((rows) => expect(rows.map((m: { email: string }) => m.email)).not.toContain(email));
	});

	test("MEM-U01 inviting an email that already exists shows an error and keeps the dialog open", async ({ members, seed }) => {
		// The duplicate is rejected with a 409, which is expected traffic here.
		await members.open();
		await members.openAddMember();
		await members.fillMember({ firstName: "Dupe", lastName: "Owner", email: seed.ownerEmail, roles: ["Auto Read Only Staff"] });
		await members.submitInvite();
		// The dialog stays open, so the user must be told why inside it - the page-level alert sits behind the modal backdrop.
		await expect(members.dialog()).toBeVisible();
		await expect(members.dialog().getByText(/conflicts with an existing|already exists|already in use/i)).toBeVisible();
	});

	test("MEM-U01 a pending member can be sent a fresh invite from the row menu", async ({ members, api, seed }) => {
		const { firstName, lastName, email } = person();
		await members.open();
		await members.openAddMember();
		await members.fillMember({ firstName, lastName, email, roles: ["Auto Read Only Staff"] });
		await members.submitInvite();
		const first = await members.inviteToken();
		await members.closeInviteIssued();
		await members.chooseRowAction(lastName, "Resend invitation");
		await expect(members.inviteIssuedDialog()).toBeVisible();
		expect(await members.inviteToken()).not.toBe(first);
		expect(seed.organisationSlug).toBeTruthy();
		expect(api).toBeTruthy();
	});
});

test.describe("finding members", () => {
	test("MEM-U01 searching narrows the table and shows an empty state when nothing matches", async ({ members, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		await members.open();
		await members.search(user.email);
		await expect(members.row(user.email)).toBeVisible();
		await members.search(`nobody-${uniqueSuffix()}`);
		await expect(members.emptyState()).toBeVisible();
	});

	test("MEM-U01 the pending filter lists only invited members", async ({ members, api, seed }) => {
		const { firstName, lastName, email } = person();
		await members.open();
		await members.openAddMember();
		await members.fillMember({ firstName, lastName, email, roles: ["Auto Read Only Staff"] });
		await members.submitInvite();
		await members.closeInviteIssued();
		await members.filterByStatus("Invited");
		await expect(members.row(lastName)).toBeVisible();
		await expect(members.row(seed.ownerEmail)).toHaveCount(0);
		expect(api && seed).toBeTruthy();
	});
});

test.describe("roles", () => {
	test("MEM-U02 the roles table lists system and custom roles and protects the Owner role", async ({ page, roles }) => {
		await roles.open();
		await expect(roles.row("Owner")).toContainText("system");
		await roles.openRowMenu("Owner");
		await expect(roles.menuItem("Edit permissions")).toBeVisible();
		await expect(roles.menuItem("Deactivate")).toHaveCount(0);
		await expect(roles.menuItem("Mark as portal role")).toHaveCount(0);
		await page.keyboard.press("Escape");
	});

	test("MEM-U02 a role is created with chosen permissions and appears in the table", async ({ roles, api }) => {
		const name = `UI Role ${uniqueSuffix()}`;
		await roles.open();
		await roles.openAddRole();
		await roles.fillRole(name, "Made through the screen");
		await roles.tickPermission("Add role", "student", "STUDENT_VIEW");
		await roles.submitAdd();
		await expect(roles.row(name)).toBeVisible();
		await expect(roles.row(name)).toContainText("ACTIVE");
		(await api.get("/api/v1/roles")).expectJson((list) => expect(list.find((r: { name: string }) => r.name === name).permissionCodes).toEqual(["STUDENT_VIEW"]));
	});

	test("MEM-U02 a role cannot be created without a name", async ({ page, roles }) => {
		let posted = false;
		page.on("request", (request) => {
			if (request.method() === "POST" && request.url().endsWith("/api/v1/roles")) posted = true;
		});
		await roles.open();
		await roles.openAddRole();
		await roles.submitAdd();
		await expect(roles.addDialog()).toBeVisible();
		expect(posted).toBe(false);
	});

	test("MEM-U02 a duplicate role name is reported", async ({ roles, api }) => {
		const existing = (await api.get("/api/v1/roles")).body.find((r: { systemDefault: boolean }) => !r.systemDefault);
		await roles.open();
		await roles.openAddRole();
		await roles.fillRole(existing.name);
		await roles.submitAdd();
		await expect(roles.addDialog()).toBeVisible();
		await expect(roles.addDialog().getByText(/conflicts with an existing|already exists|already in use/i)).toBeVisible();
	});

	test("MEM-U02 permissions can be edited from the row menu and are saved", async ({ api, roles }) => {
		const created = (await api.post("/api/v1/roles", { body: { name: `Edit Role ${uniqueSuffix()}`, description: "d", permissionCodes: ["STUDENT_VIEW"], portal: false } })).body;
		await roles.open();
		await roles.chooseRowAction(created.name, "Edit permissions");
		await roles.tickPermission(`Edit permissions — ${created.name}`, "attendance", "ATTENDANCE_VIEW");
		await roles.saveEdit(created.name);
		await expect(roles.editDialog(created.name)).toBeHidden();
		(await api.get("/api/v1/roles/{id}", { params: { id: created.id } })).expectJson((role) => expect([...role.permissionCodes].sort()).toEqual(["ATTENDANCE_VIEW", "STUDENT_VIEW"]));
	});

	test("MEM-U02 a role can be marked as portal and deactivated, and an inactive role is not offered to new members", async ({ roles, members, api }) => {
		const created = (await api.post("/api/v1/roles", { body: { name: `Toggle Role ${uniqueSuffix()}`, description: "d", permissionCodes: [], portal: false } })).body;
		await roles.open();
		await roles.chooseRowAction(created.name, "Mark as portal role");
		await expect(roles.row(created.name)).toContainText("portal");
		await roles.chooseRowAction(created.name, "Deactivate");
		await expect(roles.row(created.name)).toContainText("INACTIVE");

		await members.open();
		await members.openAddMember();
		await members.dialog().getByRole("combobox", { name: /^Role\(s\)/ }).click();
		await expect(members.dialog().page().getByRole("option", { name: created.name })).toHaveCount(0);
	});

	test("MEM-U02 a member given the new role sees exactly the navigation it allows", async ({ browser, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } });
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		try {
			await page.goto("/students");
			await expect(page.getByRole("button", { name: "Students", exact: true })).toBeEnabled();
			await expect(page.getByRole("button", { name: "Fees", exact: true })).toBeDisabled();
			await expect(page.getByRole("button", { name: "Members", exact: true })).toBeDisabled();
		} finally {
			await context.close();
		}
	});
});

test.describe("removing access", () => {
	test("MEM-U04 revoking a member's only role from the row menu stops them signing in", async ({ browser, members, api, anon, seed, loginPage }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await members.open();
		await members.search(user.email);
		await members.chooseRowAction(user.email, "Revoke role");
		await expect(members.row(user.email)).toContainText("Inactive");

		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
		const page = await context.newPage();
		try {
			await page.goto("/login");
			await page.getByLabel("Organisation slug").fill(seed.organisationSlug);
			await page.getByLabel("Email").fill(user.email);
			await page.getByLabel("Password").fill(user.password);
			await page.getByRole("button", { name: "Sign in" }).click();
			await expect(page.getByRole("alert")).toBeVisible();
			await expect(page).toHaveURL(/\/login/);
		} finally {
			await context.close();
		}
		expect(loginPage).toBeTruthy();
	});

	test("MEM-U04 disabling a member marks them inactive and the Disable action goes away", async ({ members, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await members.open();
		await members.search(user.email);
		await members.chooseRowAction(user.email, "Disable member");
		await expect(members.row(user.email)).toContainText("Inactive");
		await members.openRowMenu(user.email);
		await expect(members.rowAction("Disable member")).toHaveCount(0);
	});

	test("MEM-U04 a member without MEMBERSHIP_MANAGE sees the list but no row actions or Add button", async ({ browser, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["MEMBERSHIP_VIEW"]);
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } });
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
		const page = await context.newPage();
		try {
			await page.goto("/members");
			await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
			await expect(page.getByRole("button", { name: /Add member/ })).toHaveCount(0);
			await expect(page.getByRole("row").filter({ hasText: user.email }).getByRole("button")).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
