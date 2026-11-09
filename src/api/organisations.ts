// A second, independent organisation - the "other tenant" for isolation scenarios.

import type { APIRequestContext } from "@playwright/test";
import { ApiClient, type RecordedCall } from "./apiClient";
import { uniqueSuffix } from "./data";
import { FIXED_PASSWORD } from "../setup/roles";
import { enableSuiteModules } from "../setup/provisioning";

export interface OtherOrganisation {
	id: number;
	slug: string;
	ownerEmail: string;
	ownerPassword: string;
	client: ApiClient;
	/** Raw login response (token, expiresAt, userId, organisationId) - what the browser stores as its session. */
	session: { token: string; expiresAt: string; userId: number; organisationId: number };
}

/** Provisions a fresh organisation through the public endpoint and signs its owner in. */
export async function createOtherOrganisation(request: APIRequestContext, calls: RecordedCall[], extra: Record<string, unknown> = {}): Promise<OtherOrganisation> {
	const anon = new ApiClient(request, calls, "anonymous");
	const id = uniqueSuffix().toLowerCase();
	const slug = `other-${id}`;
	const ownerEmail = `owner@${slug}.test`;
	const created = await anon.post("/api/v1/organisations", {
			body: {
				name: `Other Org ${id}`,
				legalName: `Other Org ${id} Pvt Ltd`,
				slug,
				adminEmail: ownerEmail,
				adminPassword: FIXED_PASSWORD,
				adminFirstName: "Other",
				adminLastName: "Owner",
				...extra,
			},
		});
	created.expectStatus([200, 201]);
	// Transport ships switched off; the other tenant gets it on so it behaves like the main fixture organisation.
	await enableSuiteModules(created.body.id);
	const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: slug, email: ownerEmail, password: FIXED_PASSWORD } });
	login.expectStatus(200);
	return { id: created.body.id, slug, ownerEmail, ownerPassword: FIXED_PASSWORD, client: anon.withToken(login.body.token, "other-org-owner"), session: login.body };
}

/** Context for the user helpers in ./users.ts, for a throwaway organisation (its first campus is created with it). */
export async function organisationContext(org: OtherOrganisation): Promise<{ organisationSlug: string; campusId: number }> {
	const campuses = await org.client.get("/api/v1/campuses");
	campuses.expectStatus(200);
	return { organisationSlug: org.slug, campusId: campuses.body[0].id };
}
