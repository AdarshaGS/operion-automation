// Announcement fixtures. Communication ships switched off for a new organisation, so callers enable it
// (holidayLeaveOrg({ communication: true })).

import type { ApiClient } from "./apiClient";

export const ANNOUNCEMENTS = "/api/v1/announcements";

export interface Announcement {
	id: number;
	title: string;
	status: string;
	scheduledAt: string | null;
	sendOnNonWorkingDays: boolean;
}

export async function createAnnouncement(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(ANNOUNCEMENTS, { body: { title: "Notice", body: "Body", audienceType: "ORG", ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as Announcement;
}

/** The status the announcement is in right now, found through the status-filtered list. */
export async function announcementStatus(api: ApiClient, id: number): Promise<string | null> {
	for (const status of ["PUBLISHED", "DRAFT", "CANCELLED"]) {
		const list = (await api.get(ANNOUNCEMENTS, { query: { status } })).expectStatus(200).body as { id: number }[];
		if (list.some((a) => a.id === id)) return status;
	}
	return null;
}
