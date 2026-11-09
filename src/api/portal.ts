// Self-service fixtures: portal users (a portal role makes the session PORTAL, not ADMIN), teachers and the
// requests they raise. Students, sections and teaching assignments live in the shared organisation (Operion
// #354), so teachers are built there.

import type { ApiClient } from "./apiClient";
import type { AttendanceSetup } from "./attendance";
import { assignTeacher } from "./learning";
import { createStaff } from "./hr";
import { createDisposableUser, type DisposableUser, type OrgContext } from "./users";
import { uniqueSuffix } from "./data";

export const ME = "/api/v1/me";
export const CHANGES = "/api/v1/profile-change-requests";
export const OWN_CHANGES = "/api/v1/me/profile-change-requests";

/** A signed-in user whose role is a portal role. */
export const portalUser = (owner: ApiClient, anon: ApiClient, org: OrgContext) => createDisposableUser(owner, anon, org, [], { portal: true });

export interface Teacher extends DisposableUser {
	staffProfileId: number;
}

/** A portal teacher with a staff profile, teaching one subject of `s`'s section. */
export async function portalTeacher(owner: ApiClient, anon: ApiClient, org: OrgContext, s: AttendanceSetup): Promise<Teacher> {
	const user = await portalUser(owner, anon, org);
	await assignTeacher(owner, s.sectionId, s.base.subjectId, user.personId);
	const staff = await createStaff(owner, org.campusId, { personId: user.personId });
	return { ...user, staffProfileId: staff.id };
}

export const uniqueEmail = (label = "me") => `${label}-${uniqueSuffix().toLowerCase()}@example.test`;
export const uniquePhone = () => `+9198${String(Date.now()).slice(-8)}`;

/** A portal-role user who is a guardian of `studentIds` (the claim-invite flow does not produce a portal role). */
export async function guardianInPortalRole(owner: ApiClient, anon: ApiClient, org: OrgContext, studentIds: number[]) {
	const user = await portalUser(owner, anon, org);
	const guardian = (await owner.post("/api/v1/guardians", { body: { personId: user.personId, occupation: "Engineer" } })).expectStatus([200, 201]).body;
	for (const studentId of studentIds) {
		(await owner.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: { guardianId: guardian.id, relationshipType: "FATHER", primaryGuardian: false, emergencyContact: false, canPickup: true, canReceiveCommunication: true, contactPriority: 1 } })).expectStatus(200);
	}
	return { ...user, guardianId: guardian.id as number };
}
