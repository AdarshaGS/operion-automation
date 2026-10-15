// Applicant fixtures. Applicants can be created in any organisation; converting one creates a student,
// which only works in the shared organisation (Operion #354).

import type { ApiClient } from "./apiClient";
import { createPerson } from "./academics";

export interface Applicant {
	id: number;
	personId: number;
	body: Record<string, any>;
}

export async function createApplicant(api: ApiClient, extra: Record<string, unknown> = {}, label = "Appl"): Promise<Applicant> {
	const personId = await createPerson(api, label);
	const res = await api.post("/api/v1/applicants", { body: { personId, inquiryDate: "2026-06-01", source: "Walk-in", ...extra } });
	res.expectStatus(200);
	return { id: res.body.id, personId, body: res.body };
}

export const DOCUMENT_TYPES = ["BIRTH_CERTIFICATE", "PREVIOUS_MARKSHEET", "TRANSFER_CERTIFICATE", "ADDRESS_PROOF", "PHOTO"];
