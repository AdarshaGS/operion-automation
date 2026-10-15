// Student fixtures. Students can only be created in the shared organisation: students.student_id is
// unique across organisations (Operion #354), so a second organisation fails with 409 on admit.

import type { ApiClient } from "./apiClient";
import { createPerson } from "./academics";
import { uniqueCode } from "./data";

export interface AdmittedStudent {
	id: number;
	personId: number;
	admissionNumber: string;
	body: Record<string, any>;
}

export async function admitStudent(api: ApiClient, extra: Record<string, unknown> = {}, personExtra: Record<string, unknown> = {}): Promise<AdmittedStudent> {
	const personId = await createPerson(api, "Stu", personExtra);
	const admissionNumber = uniqueCode("STU");
	const res = await api.post("/api/v1/students", { body: { personId, admissionNumber, admissionDate: "2026-06-01", ...extra } });
	res.expectStatus([200, 201]);
	return { id: res.body.id, personId, admissionNumber, body: res.body };
}

export async function createGuardian(api: ApiClient, personExtra: Record<string, unknown> = {}): Promise<{ id: number; personId: number }> {
	const personId = await createPerson(api, "Guardian", { dateOfBirth: "1985-01-01", gender: "FEMALE", ...personExtra });
	const res = await api.post("/api/v1/guardians", { body: { personId, occupation: "Engineer" } });
	res.expectStatus([200, 201]);
	return { id: res.body.id, personId };
}

/** Every flag is sent: the endpoint answers 400 "Malformed or invalid request body" when any is missing. */
export function guardianLink(guardianId: number, overrides: Record<string, unknown> = {}) {
	return { guardianId, relationshipType: "FATHER", primaryGuardian: false, emergencyContact: false, canPickup: true, canReceiveCommunication: true, contactPriority: 1, ...overrides };
}
