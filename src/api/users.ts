// Disposable login identities, so specs can change passwords / log out without touching the
// shared role fixtures other tests (and the UI project) are authenticated with.

import type { ApiClient } from "./apiClient";
import { uniqueSuffix } from "./data";
import { FIXED_PASSWORD } from "../setup/roles";
import type { SeedData } from "../setup/session";

/** What the helpers need to know about an organisation - satisfied by the seed and by a throwaway organisation. */
export type OrgContext = Pick<SeedData, "organisationSlug" | "campusId">;

export interface DisposableUser {
	userId: number;
	membershipId: number;
	roleId: number;
	personId: number;
	email: string;
	password: string;
	token: string;
	refreshToken: string;
	client: ApiClient;
}

/** Owner invites a user, who claims the invite - the same path a real staff member takes - and
 * is then granted a no-permission membership. Without a membership the claimed user cannot log
 * in again with their password, which the password/refresh specs need to do. */
export async function createDisposableUser(owner: ApiClient, anon: ApiClient, seed: OrgContext, permissionCodes: string[] = [], options: { portal?: boolean } = {}): Promise<DisposableUser> {
	const email = `tmp-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
	const invite = await owner.post("/api/v1/users/invite", { body: { email, phone: null } });
	invite.expectStatus(200);

	const claim = await anon.post("/api/v1/auth/claim-staff-invite", {
		body: { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: FIXED_PASSWORD },
	});
	claim.expectStatus(200);

	const suffix = uniqueSuffix();
	const role = await owner.post("/api/v1/roles", { body: { name: `Disposable ${suffix}`, description: "Created by automation", permissionCodes, portal: options.portal ?? false } });
	role.expectStatus([200, 201]);
	const person = await owner.post("/api/v1/persons", { body: { firstName: "Disposable", lastName: suffix, gender: "MALE" } });
	person.expectStatus([200, 201]);
	const membership = await owner.post("/api/v1/memberships", {
		body: {
			userId: invite.body.userId,
			personId: person.body.id,
			roleId: role.body.id,
			campusId: seed.campusId,
			departmentId: null,
			memberId: null,
			joiningDate: new Date().toISOString().slice(0, 10),
		},
	});
	membership.expectStatus([200, 201]);

	return {
		userId: invite.body.userId,
		membershipId: membership.body.id,
		roleId: role.body.id,
		personId: person.body.id,
		email,
		password: FIXED_PASSWORD,
		token: claim.body.token,
		refreshToken: claim.body.refreshToken,
		client: owner.withToken(claim.body.token, "disposable-user"),
	};
}

export interface PendingInvite {
	userId: number;
	email: string;
	claimToken: string;
}

/** An invited staff member who has NOT claimed yet, with a role and membership already granted,
 * so the claim itself can be driven through the UI. */
export async function inviteStaffMember(owner: ApiClient, seed: OrgContext, permissionCodes: string[] = []): Promise<PendingInvite> {
	const suffix = uniqueSuffix();
	const email = `invitee-${suffix.toLowerCase()}@${seed.organisationSlug}.test`;
	const invite = await owner.post("/api/v1/users/invite", { body: { email, phone: null } });
	invite.expectStatus(200);
	const role = await owner.post("/api/v1/roles", { body: { name: `Invitee ${suffix}`, description: "Created by automation", permissionCodes, portal: false } });
	role.expectStatus([200, 201]);
	const person = await owner.post("/api/v1/persons", { body: { firstName: "Invitee", lastName: suffix, gender: "MALE" } });
	person.expectStatus([200, 201]);
	(
		await owner.post("/api/v1/memberships", {
			body: { userId: invite.body.userId, personId: person.body.id, roleId: role.body.id, campusId: seed.campusId, departmentId: null, memberId: null, joiningDate: new Date().toISOString().slice(0, 10) },
		})
	).expectStatus([200, 201]);
	return { userId: invite.body.userId, email, claimToken: invite.body.claimToken };
}

