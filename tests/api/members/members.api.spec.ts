// Members, roles and permissions. IDs refer to docs/SCENARIOS.md section 3 (MEM-*).
// Ordinary role/user creation runs in the shared fixture organisation (everything created is
// uniquely named). Anything that touches the Owner role or owner user - which would lock the
// fixture out - runs in a throwaway organisation.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { organisationContext } from "../../../src/api/organisations";
import { createDisposableUser, inviteStaffMember } from "../../../src/api/users";
import { expectShape } from "../../../src/api/shapes";
import { uniqueSuffix } from "../../../src/api/data";
import type { ApiClient } from "../../../src/api/apiClient";
import { FIXED_PASSWORD } from "../../../src/setup/roles";

const roleBody = (overrides: Record<string, unknown> = {}) => ({ name: `Role ${uniqueSuffix()}`, description: "Created by automation", permissionCodes: ["STUDENT_VIEW"], portal: false, ...overrides });

async function createRole(client: ApiClient, overrides: Record<string, unknown> = {}) {
	const created = await client.post("/api/v1/roles", { body: roleBody(overrides) });
	created.expectStatus([200, 201]);
	return created.body as { id: number; name: string; permissionCodes: string[]; status: string; portal: boolean; systemDefault: boolean };
}

async function loginAs(anon: ApiClient, slug: string, email: string, password = FIXED_PASSWORD) {
	return anon.post("/api/v1/auth/login", { body: { organisationSlug: slug, email, password } });
}

async function permissionsOf(anon: ApiClient, slug: string, email: string): Promise<string[]> {
	const login = await loginAs(anon, slug, email);
	login.expectStatus(200);
	const me = await anon.withToken(login.body.token, "member").get("/api/v1/auth/me");
	me.expectStatus(200);
	return me.body.permissions;
}

async function ownerOfOwnOrganisation(request: Parameters<typeof createOtherOrganisation>[0], calls: Parameters<typeof createOtherOrganisation>[1]) {
	const org = await createOtherOrganisation(request, calls);
	const context = await organisationContext(org);
	const roles = await org.client.get("/api/v1/roles");
	const ownerRole = roles.body.find((role: { name: string }) => role.name === "Owner");
	const memberships = await org.client.get("/api/v1/memberships");
	const ownerMembership = memberships.body.find((m: { roleName: string }) => m.roleName === "Owner");
	return { org, context, ownerRole, ownerMembership };
}

test.describe("GET /api/v1/permissions", () => {
	test("MEM-01 returns the catalogue with unique codes grouped by module", async ({ api }) => {
		const result = await api.get("/api/v1/permissions");
		result.expectStatus(200).expectJson((list) => {
			expect(list.length).toBeGreaterThan(20);
			for (const permission of list) expectShape(permission, { id: "number", code: "string", module: "string", description: "string" });
			expect(new Set(list.map((p: { code: string }) => p.code)).size).toBe(list.length);
			expect(list.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(["STUDENT_VIEW", "ROLE_MANAGE", "MEMBERSHIP_MANAGE", "ORGANISATION_MANAGE"]));
		});
	});

	test("MEM-01 every permission the Owner role holds exists in the catalogue", async ({ api }) => {
		const catalogue = (await api.get("/api/v1/permissions")).body.map((p: { code: string }) => p.code);
		const owner = (await api.get("/api/v1/roles")).body.find((role: { name: string }) => role.name === "Owner");
		for (const code of owner.permissionCodes) expect(catalogue, code).toContain(code);
	});

	test("MEM-01 requires a signed-in user", async ({ anon }) => {
		(await anon.get("/api/v1/permissions")).expectStatus(401);
	});
});

test.describe("roles", () => {
	test("MEM-02 creates a role with permissions and reads it back by id and in the list", async ({ api }) => {
		const body = roleBody({ permissionCodes: ["STUDENT_VIEW", "ATTENDANCE_VIEW"] });
		const created = await api.post("/api/v1/roles", { body });
		created.expectStatus([200, 201]).expectJson((role) => {
			expectShape(role, { id: "number", name: "string", description: "string", systemDefault: "boolean", portal: "boolean", status: "string", permissionCodes: "array" });
			expect(role).toMatchObject({ name: body.name, status: "ACTIVE", portal: false, systemDefault: false });
			expect([...role.permissionCodes].sort()).toEqual(["ATTENDANCE_VIEW", "STUDENT_VIEW"]);
		});
		(await api.get("/api/v1/roles/{id}", { params: { id: created.body.id } })).expectStatus(200).expectJson((role) => expect(role.name).toBe(body.name));
		(await api.get("/api/v1/roles")).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(created.body.id));
	});

	test("MEM-02 a role may be created with no permissions", async ({ api }) => {
		const role = await createRole(api, { permissionCodes: [] });
		expect(role.permissionCodes).toEqual([]);
	});

	test("MEM-02 a missing name returns 400", async ({ api }) => {
		(await api.post("/api/v1/roles", { body: { description: "no name", permissionCodes: [] } })).expectStatus(400);
	});

	test("MEM-02 a blank name returns 400", async ({ api }) => {
		(await api.post("/api/v1/roles", { body: roleBody({ name: "   " }) })).expectStatus(400);
	});

	test("MEM-02 an unknown role id returns 404", async ({ api }) => {
		(await api.get("/api/v1/roles/{id}", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("MEM-03 replacing a role's permissions is read back exactly", async ({ api }) => {
		const role = await createRole(api, { permissionCodes: ["STUDENT_VIEW"] });
		const updated = await api.post("/api/v1/roles/{id}/permissions", { params: { id: role.id }, body: { permissionCodes: ["FEE_VIEW", "ATTENDANCE_VIEW"] } });
		updated.expectStatus(200).expectJson((result) => expect([...result.permissionCodes].sort()).toEqual(["ATTENDANCE_VIEW", "FEE_VIEW"]));
		(await api.get("/api/v1/roles/{id}", { params: { id: role.id } })).expectJson((result) => expect([...result.permissionCodes].sort()).toEqual(["ATTENDANCE_VIEW", "FEE_VIEW"]));
	});

	test("MEM-03 a permission change reaches the role's members on their next sign-in", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		expect(await permissionsOf(anon, seed.organisationSlug, user.email)).toEqual(["STUDENT_VIEW"]);
		(await api.post("/api/v1/roles/{id}/permissions", { params: { id: user.roleId }, body: { permissionCodes: ["STUDENT_VIEW", "FEE_VIEW"] } })).expectStatus(200);
		expect((await permissionsOf(anon, seed.organisationSlug, user.email)).sort()).toEqual(["FEE_VIEW", "STUDENT_VIEW"]);
		(await api.post("/api/v1/roles/{id}/permissions", { params: { id: user.roleId }, body: { permissionCodes: [] } })).expectStatus(200);
		expect(await permissionsOf(anon, seed.organisationSlug, user.email)).toEqual([]);
	});

	test("MEM-03 updating an unknown role returns 404", async ({ api }) => {
		(await api.post("/api/v1/roles/{id}/permissions", { params: { id: 99999999 }, body: { permissionCodes: [] } })).expectStatus(404);
	});

	test("MEM-04 a duplicate role name returns 409", async ({ api }) => {
		const role = await createRole(api);
		(await api.post("/api/v1/roles", { body: roleBody({ name: role.name }) })).expectStatus(409);
	});

	test("MEM-04 role names are unique regardless of letter case", async ({ api }) => {
		const role = await createRole(api);
		(await api.post("/api/v1/roles", { body: roleBody({ name: role.name.toUpperCase() }) })).expectStatus(409);
	});

	test("MEM-05 an unknown permission code on create returns 400", async ({ api }) => {
		(await api.post("/api/v1/roles", { body: roleBody({ permissionCodes: ["NOT_A_REAL_PERMISSION"] }) })).expectStatus(400);
	});

	test("MEM-05 an unknown permission code on update returns 400 and leaves the role unchanged", async ({ api }) => {
		const role = await createRole(api, { permissionCodes: ["STUDENT_VIEW"] });
		(await api.post("/api/v1/roles/{id}/permissions", { params: { id: role.id }, body: { permissionCodes: ["NOT_A_REAL_PERMISSION"] } })).expectStatus(400);
		(await api.get("/api/v1/roles/{id}", { params: { id: role.id } })).expectJson((result) => expect(result.permissionCodes).toEqual(["STUDENT_VIEW"]));
	});

	test("MEM-06 a role can be deactivated and reactivated", async ({ api }) => {
		const role = await createRole(api);
		(await api.post("/api/v1/roles/{id}/status", { params: { id: role.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((result) => expect(result.status).toBe("INACTIVE"));
		(await api.get("/api/v1/roles/{id}", { params: { id: role.id } })).expectJson((result) => expect(result.status).toBe("INACTIVE"));
		(await api.post("/api/v1/roles/{id}/status", { params: { id: role.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((result) => expect(result.status).toBe("ACTIVE"));
	});

	test("MEM-06 an inactive role cannot be assigned to a member", async ({ api, seed }) => {
		const role = await createRole(api);
		(await api.post("/api/v1/roles/{id}/status", { params: { id: role.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		const invite = await inviteStaffMember(api, seed);
		const person = await api.post("/api/v1/persons", { body: { firstName: "Inactive", lastName: uniqueSuffix() } });
		const membership = await api.post("/api/v1/memberships", {
			body: { userId: invite.userId, personId: person.body.id, roleId: role.id, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: "2026-01-01" },
		});
		expect(membership.status).toBeGreaterThanOrEqual(400);
		expect(membership.status).toBeLessThan(500);
	});

	test("MEM-06 an invalid status value is a client error", async ({ api }) => {
		const role = await createRole(api);
		const result = await api.post("/api/v1/roles/{id}/status", { params: { id: role.id }, body: { status: "SIDEWAYS" } });
		result.expectStatus(400);
	});

	test("MEM-07 a custom role can be marked as a portal role and back", async ({ api }) => {
		const role = await createRole(api);
		(await api.post("/api/v1/roles/{id}/portal", { params: { id: role.id }, body: { portal: true } })).expectStatus(200).expectJson((result) => expect(result.portal).toBe(true));
		(await api.get("/api/v1/roles/{id}", { params: { id: role.id } })).expectJson((result) => expect(result.portal).toBe(true));
		(await api.post("/api/v1/roles/{id}/portal", { params: { id: role.id }, body: { portal: false } })).expectStatus(200).expectJson((result) => expect(result.portal).toBe(false));
	});

	test("MEM-07 a role can be created as a portal role", async ({ api }) => {
		expect((await createRole(api, { portal: true })).portal).toBe(true);
	});
});

test.describe("the Owner role is protected", () => {
	test("MEM-08 cannot be deactivated", async ({ request, calls }) => {
		const { org, ownerRole } = await ownerOfOwnOrganisation(request, calls);
		(await org.client.post("/api/v1/roles/{id}/status", { params: { id: ownerRole.id }, body: { status: "INACTIVE" } })).expectStatus(409);
		(await org.client.get("/api/v1/roles/{id}", { params: { id: ownerRole.id } })).expectJson((role) => expect(role.status).toBe("ACTIVE"));
	});

	test("MEM-08 cannot have all of its permissions removed", async ({ request, calls }) => {
		const { org, ownerRole } = await ownerOfOwnOrganisation(request, calls);
		(await org.client.post("/api/v1/roles/{id}/permissions", { params: { id: ownerRole.id }, body: { permissionCodes: [] } })).expectStatus(409);
		(await org.client.get("/api/v1/roles/{id}", { params: { id: ownerRole.id } })).expectJson((role) => expect(role.permissionCodes).toContain("ROLE_MANAGE"));
	});

	test("MEM-08 cannot lose the permission to manage roles", async ({ request, calls }) => {
		const { org, ownerRole } = await ownerOfOwnOrganisation(request, calls);
		const without = ownerRole.permissionCodes.filter((code: string) => code !== "ROLE_MANAGE");
		(await org.client.post("/api/v1/roles/{id}/permissions", { params: { id: ownerRole.id }, body: { permissionCodes: without } })).expectStatus(409);
	});

	test("MEM-08 cannot be turned into a portal role (the owner would be routed to the portal)", async ({ request, calls }) => {
		const { org, ownerRole } = await ownerOfOwnOrganisation(request, calls);
		(await org.client.post("/api/v1/roles/{id}/portal", { params: { id: ownerRole.id }, body: { portal: true } })).expectStatus(409);
	});
});

test.describe("inviting and creating users", () => {
	test("MEM-09 an invite returns a one-time claim token and the invitee appears as invited", async ({ api, seed }) => {
		const invite = await inviteStaffMember(api, seed);
		expect(invite.claimToken.length).toBeGreaterThan(20);
		const memberships = await api.get("/api/v1/memberships");
		memberships.expectStatus(200).expectJson((rows) => {
			const row = rows.find((m: { userId: number }) => m.userId === invite.userId);
			expect(row, "the invited member is listed").toBeTruthy();
			expect(row.memberStatus).toBe("INVITED");
			expect(row.email).toBe(invite.email);
		});
	});

	test("MEM-09 the invite response describes the expiry and email delivery", async ({ api, seed }) => {
		const email = `shape-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
		(await api.post("/api/v1/users/invite", { body: { email, phone: null } })).expectStatus(200).expectJson((invite) => {
			expectShape(invite, { userId: "number", inviteId: "number", claimToken: "string", expiresAt: "string", emailSent: "boolean" });
			expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
		});
	});

	test("MEM-09 an invite with no email returns 400", async ({ api }) => {
		(await api.post("/api/v1/users/invite", { body: { phone: "+911234567890" } })).expectStatus(400);
	});

	test("MEM-09 an invite with an invalid email returns 400", async ({ api }) => {
		(await api.post("/api/v1/users/invite", { body: { email: "not-an-email" } })).expectStatus(400);
	});

	test("MEM-10 resending an invite issues a fresh token for a pending invitee", async ({ api, seed }) => {
		const invite = await inviteStaffMember(api, seed);
		const resent = await api.post("/api/v1/users/{id}/resend-invite", { params: { id: invite.userId } });
		resent.expectStatus(200).expectJson((result) => {
			expect(result.claimToken).toEqual(expect.any(String));
			expect(result.claimToken).not.toBe(invite.claimToken);
		});
	});

	test("MEM-10 resending for a user who already joined returns 409", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/users/{id}/resend-invite", { params: { id: user.userId } })).expectStatus(409);
	});

	test("MEM-10 resending for an unknown user returns 404", async ({ api }) => {
		(await api.post("/api/v1/users/{id}/resend-invite", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("MEM-11 inviting an email that already exists returns 409", async ({ api, seed }) => {
		(await api.post("/api/v1/users/invite", { body: { email: seed.ownerEmail } })).expectStatus(409);
	});

	test("MEM-11 the duplicate check ignores letter case", async ({ api, seed }) => {
		(await api.post("/api/v1/users/invite", { body: { email: seed.ownerEmail.toUpperCase() } })).expectStatus(409);
	});

	test("MEM-12 a created user is returned with its details", async ({ api, seed }) => {
		const email = `created-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
		(await api.post("/api/v1/users", { body: { email, phone: "+919800000001", password: FIXED_PASSWORD } })).expectStatus([200, 201]).expectJson((user) => {
			expectShape(user, { id: "number", email: "string", status: "string" });
			expect(user).toMatchObject({ email, phone: "+919800000001", status: "ACTIVE" });
			expect(JSON.stringify(user)).not.toMatch(/password|hash/i);
		});
	});

	test("MEM-12 a duplicate email returns 409", async ({ api, seed }) => {
		(await api.post("/api/v1/users", { body: { email: seed.ownerEmail, phone: null, password: FIXED_PASSWORD } })).expectStatus(409);
	});

	test("MEM-12 an invalid email returns 400", async ({ api }) => {
		(await api.post("/api/v1/users", { body: { email: "not-an-email", phone: null, password: FIXED_PASSWORD } })).expectStatus(400);
	});

	test("MEM-12 a one-character password returns 400", async ({ api, seed }) => {
		const email = `weak-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
		(await api.post("/api/v1/users", { body: { email, phone: null, password: "1" } })).expectStatus(400);
	});

	test("MEM-12 a member's email and phone can be updated with PUT", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const email = `renamed-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
		(await api.put("/api/v1/users/{id}", { params: { id: user.userId }, body: { email, phone: "+919800000002" } })).expectStatus(200).expectJson((updated) => expect(updated).toMatchObject({ email, phone: "+919800000002" }));
		(await api.get("/api/v1/users/{id}", { params: { id: user.userId } })).expectJson((read) => expect(read.email).toBe(email));
		(await loginAs(anon, seed.organisationSlug, email)).expectStatus(200);
	});

	test("MEM-12 updating to an email another member uses returns 409", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.put("/api/v1/users/{id}", { params: { id: user.userId }, body: { email: seed.ownerEmail, phone: null } })).expectStatus(409);
	});

	test("MEM-12 updating to an invalid email returns 400", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.put("/api/v1/users/{id}", { params: { id: user.userId }, body: { email: "not-an-email", phone: null } })).expectStatus(400);
	});

	test("MEM-12 an unknown user returns 404", async ({ api }) => {
		(await api.get("/api/v1/users/{id}", { params: { id: 99999999 } })).expectStatus(404);
		(await api.put("/api/v1/users/{id}", { params: { id: 99999999 }, body: { email: "x@example.test", phone: null } })).expectStatus(404);
	});
});

test.describe("user status", () => {
	test("MEM-13 a user can be deactivated and reactivated, and cannot sign in while deactivated", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } })).expectStatus(200).expectJson((result) => expect(result.status).toBe("DISABLED"));
		(await loginAs(anon, seed.organisationSlug, user.email)).expectStatus([400, 401, 403]);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((result) => expect(result.status).toBe("ACTIVE"));
		(await loginAs(anon, seed.organisationSlug, user.email)).expectStatus(200);
	});

	test("MEM-13 the user list reflects the status", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } });
		(await api.get("/api/v1/users")).expectJson((rows) => expect(rows.find((row: { id: number }) => row.id === user.userId).status).toBe("DISABLED"));
	});

	test("MEM-13 an unknown status value is a client error", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "SIDEWAYS" } })).expectStatus(400);
	});

	test("MEM-13 an unknown user returns 404", async ({ api }) => {
		(await api.post("/api/v1/users/{id}/status", { params: { id: 99999999 }, body: { status: "DISABLED" } })).expectStatus(404);
	});

	test("MEM-14 the organisation's only Owner cannot be deactivated", async ({ request, calls }) => {
		const { org } = await ownerOfOwnOrganisation(request, calls);
		const me = await org.client.get("/api/v1/auth/me");
		const result = await org.client.post("/api/v1/users/{id}/status", { params: { id: me.body.userId }, body: { status: "DISABLED" } });
		result.expectStatus(409);
		(await org.client.get("/api/v1/users/{id}", { params: { id: me.body.userId } })).expectJson((user) => expect(user.status).toBe("ACTIVE"));
	});

	test("MEM-14 the Owner's membership cannot be revoked", async ({ request, calls }) => {
		const { org, ownerMembership } = await ownerOfOwnOrganisation(request, calls);
		(await org.client.post("/api/v1/memberships/{id}/revoke", { params: { id: ownerMembership.id } })).expectStatus(409);
		(await org.client.get("/api/v1/memberships")).expectJson((rows) => expect(rows.find((m: { id: number }) => m.id === ownerMembership.id).status).toBe("ACTIVE"));
	});
});

test.describe("memberships", () => {
	test("MEM-15 a membership links a user, a person and a role and is listed", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await api.get("/api/v1/memberships")).expectStatus(200).expectJson((rows) => {
			const row = rows.find((m: { id: number }) => m.id === user.membershipId);
			expectShape(row, { id: "number", userId: "number", personId: "number", personName: "string", email: "string", roleId: "number", roleName: "string", status: "string", memberStatus: "string" });
			expect(row).toMatchObject({ userId: user.userId, personId: user.personId, roleId: user.roleId, campusId: seed.campusId, status: "ACTIVE", memberStatus: "ACTIVE" });
		});
	});

	test("MEM-15 revoking a membership removes access: the member can no longer sign in", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await loginAs(anon, seed.organisationSlug, user.email)).expectStatus(200);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: user.membershipId } })).expectStatus(200).expectJson((result) => expect(result.status).not.toBe("ACTIVE"));
		(await loginAs(anon, seed.organisationSlug, user.email)).expectStatus([400, 401, 403]);
		(await api.get("/api/v1/memberships")).expectJson((rows) => expect(rows.find((m: { id: number }) => m.id === user.membershipId).status).not.toBe("ACTIVE"));
	});

	test("MEM-15 revoking an unknown membership returns 404", async ({ api }) => {
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: 99999999 } })).expectStatus(404);
	});

	test("MEM-15 creating a membership with unknown user, person or role returns 404", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const base = { userId: user.userId, personId: user.personId, roleId: user.roleId, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: "2026-01-01" };
		(await api.post("/api/v1/memberships", { body: { ...base, userId: 99999999 } })).expectStatus(404);
		(await api.post("/api/v1/memberships", { body: { ...base, personId: 99999999 } })).expectStatus(404);
		(await api.post("/api/v1/memberships", { body: { ...base, roleId: 99999999 } })).expectStatus(404);
	});

	test("MEM-15 creating a membership with no fields returns 400", async ({ api }) => {
		(await api.post("/api/v1/memberships", { body: {} })).expectStatus(400);
	});

	test("MEM-16 a member with two memberships holds the union of both roles' permissions", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		const second = await createRole(api, { permissionCodes: ["FEE_VIEW"] });
		(
			await api.post("/api/v1/memberships", {
				body: { userId: user.userId, personId: user.personId, roleId: second.id, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: "2026-01-01" },
			})
		).expectStatus([200, 201]);
		expect((await permissionsOf(anon, seed.organisationSlug, user.email)).sort()).toEqual(["FEE_VIEW", "STUDENT_VIEW"]);
	});

	test("MEM-16 revoking one of two memberships keeps the other's permissions", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		const second = await createRole(api, { permissionCodes: ["FEE_VIEW"] });
		const added = await api.post("/api/v1/memberships", {
			body: { userId: user.userId, personId: user.personId, roleId: second.id, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: "2026-01-01" },
		});
		added.expectStatus([200, 201]);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: added.body.id } })).expectStatus(200);
		expect(await permissionsOf(anon, seed.organisationSlug, user.email)).toEqual(["STUDENT_VIEW"]);
	});
});

test.describe("listing users", () => {
	test("MEM-18 the user list has the documented shape and includes created members", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.get("/api/v1/users")).expectStatus(200).expectJson((rows) => {
			for (const row of rows) expectShape(row, { id: "number", email: "string", status: "string" });
			expect(rows.map((r: { id: number }) => r.id)).toContain(user.userId);
			expect(JSON.stringify(rows)).not.toMatch(/password|hash/i);
		});
	});

	test("MEM-18 the list never returns another organisation's users", async ({ api, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		(await api.get("/api/v1/users")).expectJson((rows) => expect(JSON.stringify(rows)).not.toContain(other.ownerEmail));
		(await other.client.get("/api/v1/users")).expectJson((rows) => expect(rows).toHaveLength(1));
	});
});

test.describe("permissions to manage members", () => {
	const mutations: { title: string; call: (client: ApiClient) => Promise<{ status: number }> }[] = [
		{ title: "create a role", call: (c) => c.post("/api/v1/roles", { body: roleBody() }) },
		{ title: "change a role's permissions", call: (c) => c.post("/api/v1/roles/{id}/permissions", { params: { id: 1 }, body: { permissionCodes: ["STUDENT_VIEW"] } }) },
		{ title: "change a role's status", call: (c) => c.post("/api/v1/roles/{id}/status", { params: { id: 1 }, body: { status: "ACTIVE" } }) },
		{ title: "change a role's portal flag", call: (c) => c.post("/api/v1/roles/{id}/portal", { params: { id: 1 }, body: { portal: false } }) },
		{ title: "invite a user", call: (c) => c.post("/api/v1/users/invite", { body: { email: `rbac-${uniqueSuffix().toLowerCase()}@example.test` } }) },
		{ title: "create a user", call: (c) => c.post("/api/v1/users", { body: { email: `rbac-${uniqueSuffix().toLowerCase()}@example.test`, password: FIXED_PASSWORD } }) },
		{ title: "update a user", call: (c) => c.put("/api/v1/users/{id}", { params: { id: 1 }, body: { email: "x@example.test", phone: null } }) },
		{ title: "change a user's status", call: (c) => c.post("/api/v1/users/{id}/status", { params: { id: 2 }, body: { status: "ACTIVE" } }) },
		{ title: "resend an invite", call: (c) => c.post("/api/v1/users/{id}/resend-invite", { params: { id: 2 } }) },
		{ title: "create a membership", call: (c) => c.post("/api/v1/memberships", { body: { userId: 2, personId: 2, roleId: 2, campusId: 1 } }) },
		{ title: "revoke a membership", call: (c) => c.post("/api/v1/memberships/{id}/revoke", { params: { id: 2 } }) },
	];
	for (const role of ["noPermissions", "readOnlyStaff"] as const) {
		for (const mutation of mutations) {
			test(`MEM-17 ${role} cannot ${mutation.title}`, async ({ as }) => {
				expect((await mutation.call(as(role))).status).toBe(403);
			});
		}
	}

	test("MEM-17 listing users needs a member-management permission", async ({ as }) => {
		(await as("noPermissions").get("/api/v1/users")).expectStatus(403);
		(await as("readOnlyStaff").get("/api/v1/users")).expectStatus(403);
	});

	test("MEM-17 listing memberships needs a member-management permission", async ({ as }) => {
		(await as("noPermissions").get("/api/v1/memberships")).expectStatus(403);
	});

	test("MEM-17 any signed-in member may read the roles and permission catalogue", async ({ as }) => {
		(await as("noPermissions").get("/api/v1/roles")).expectStatus(200);
		(await as("noPermissions").get("/api/v1/permissions")).expectStatus(200);
	});

	test("MEM-17 every endpoint rejects a request with no token", async ({ anon }) => {
		for (const path of ["/api/v1/users", "/api/v1/roles", "/api/v1/memberships", "/api/v1/permissions"]) (await anon.get(path)).expectStatus(401);
		(await anon.post("/api/v1/roles", { body: roleBody() })).expectStatus(401);
		(await anon.post("/api/v1/users/invite", { body: { email: "x@example.test" } })).expectStatus(401);
	});

	test("MEM-17 a member granted only ROLE_MANAGE can manage roles but not users", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["ROLE_MANAGE"]);
		(await user.client.post("/api/v1/roles", { body: roleBody() })).expectStatus([200, 201]);
		(await user.client.post("/api/v1/users/invite", { body: { email: `x-${uniqueSuffix().toLowerCase()}@example.test` } })).expectStatus(403);
	});
});

test.describe("tenant isolation", () => {
	test("MEM-19 another organisation's roles, users and memberships are invisible", async ({ api, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		const mine = await createRole(api);
		const theirs = await createRole(other.client);
		(await api.get("/api/v1/roles/{id}", { params: { id: theirs.id } })).expectStatus(404);
		(await other.client.get("/api/v1/roles/{id}", { params: { id: mine.id } })).expectStatus(404);
		(await api.get("/api/v1/roles")).expectJson((roles) => expect(roles.map((r: { id: number }) => r.id)).not.toContain(theirs.id));
		const theirUsers = await other.client.get("/api/v1/users");
		(await api.get("/api/v1/users/{id}", { params: { id: theirUsers.body[0].id } })).expectStatus(404);
	});

	test("MEM-19 another organisation's role, user or membership cannot be changed", async ({ api, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		const theirs = await createRole(other.client);
		const theirUser = (await other.client.get("/api/v1/users")).body[0];
		const theirMembership = (await other.client.get("/api/v1/memberships")).body[0];
		(await api.post("/api/v1/roles/{id}/permissions", { params: { id: theirs.id }, body: { permissionCodes: [] } })).expectStatus(404);
		(await api.post("/api/v1/roles/{id}/status", { params: { id: theirs.id }, body: { status: "INACTIVE" } })).expectStatus(404);
		(await api.post("/api/v1/roles/{id}/portal", { params: { id: theirs.id }, body: { portal: true } })).expectStatus(404);
		(await api.post("/api/v1/users/{id}/status", { params: { id: theirUser.id }, body: { status: "DISABLED" } })).expectStatus(404);
		(await api.put("/api/v1/users/{id}", { params: { id: theirUser.id }, body: { email: "taken@example.test", phone: null } })).expectStatus(404);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: theirMembership.id } })).expectStatus(404);
		(await other.client.get("/api/v1/users/{id}", { params: { id: theirUser.id } })).expectJson((user) => expect(user.status).toBe("ACTIVE"));
	});

	test("MEM-19 a membership cannot be given another organisation's role", async ({ api, anon, seed, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		const theirs = await createRole(other.client);
		const user = await createDisposableUser(api, anon, seed);
		(
			await api.post("/api/v1/memberships", {
				body: { userId: user.userId, personId: user.personId, roleId: theirs.id, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: "2026-01-01" },
			})
		).expectStatus(404);
	});

	test("MEM-19 the same email can belong to a member of two organisations", async ({ api, request, calls, seed }) => {
		const other = await createOtherOrganisation(request, calls);
		const email = `shared-${uniqueSuffix().toLowerCase()}@example.test`;
		(await api.post("/api/v1/users/invite", { body: { email } })).expectStatus(200);
		(await other.client.post("/api/v1/users/invite", { body: { email } })).expectStatus(200);
		expect(seed.organisationSlug).not.toBe(other.slug);
	});
});
