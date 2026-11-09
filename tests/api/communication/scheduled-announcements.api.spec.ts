// Scheduled announcements and days off. IDs refer to docs/SCENARIOS.md section 18 (COM-11, COM-12).
// A scheduled announcement is published by a background job that polls about once a minute and checks whether
// *today in the organisation's time zone* is a working day, so these tests make "today" a weekly off in a
// throwaway organisation (never the shared one) and then wait for the job.

import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { ANNOUNCEMENTS, announcementStatus, createAnnouncement } from "../../../src/api/communication";
import { holidayLeaveOrg, setWorkingDaysMask, todayWeekday } from "../../../src/api/calendar";

const ALL_DAYS = 0b1111111;

/** Turns today (in the organisation's time zone) into a weekly off, leaving the other six days working. */
async function makeTodayAWeeklyOff(client: ApiClient) {
	const settings = (await client.get("/api/v1/organisations/settings")).expectStatus(200).body as { timezone: string };
	await setWorkingDaysMask(client, ALL_DAYS & ~(1 << todayWeekday(settings.timezone)));
}

/** Waits for the scheduled-announcement job to publish `id`, polling the list; gives up after `ms`. */
async function waitUntilPublished(client: ApiClient, id: number, ms: number) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if ((await announcementStatus(client, id)) === "PUBLISHED") return true;
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}
	return false;
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

test.describe("COM-11 scheduled announcements on a day off", () => {
	test.setTimeout(420_000);

	test("COM-11 a scheduled announcement waits out a day off unless it is set to send anyway; once the day is a working day it goes", async ({ request, calls }) => {
		const { org } = await holidayLeaveOrg(request, calls, { communication: true });
		await makeTodayAWeeklyOff(org.client);
		const held = await createAnnouncement(org.client, { title: "Held over the day off", scheduledAt: inSeconds(3) });
		const anyway = await createAnnouncement(org.client, { title: "Sent anyway", scheduledAt: inSeconds(3), sendOnNonWorkingDays: true });
		expect(held.sendOnNonWorkingDays).toBe(false);
		expect(anyway.sendOnNonWorkingDays).toBe(true);

		// The "anyway" one proves the job has run at least once since both became due.
		expect(await waitUntilPublished(org.client, anyway.id, 150_000), "the send-anyway announcement is published").toBe(true);
		expect(await announcementStatus(org.client, held.id), "the other one is still a draft on the day off").toBe("DRAFT");

		await setWorkingDaysMask(org.client, ALL_DAYS);
		expect(await waitUntilPublished(org.client, held.id, 150_000), "the held announcement is published once today is a working day").toBe(true);
	});
});

test.describe("COM-12 flag and manual publish", () => {
	test("COM-12 sendOnNonWorkingDays defaults to false and is returned on create and in the draft list", async ({ request, calls }) => {
		const { org } = await holidayLeaveOrg(request, calls, { communication: true });
		const plain = await createAnnouncement(org.client, { title: "Plain" });
		expect(plain.sendOnNonWorkingDays).toBe(false);
		const flagged = await createAnnouncement(org.client, { title: "Flagged", scheduledAt: inSeconds(86_400), sendOnNonWorkingDays: true });
		expect(flagged.sendOnNonWorkingDays).toBe(true);
		(await org.client.get(ANNOUNCEMENTS, { query: { status: "DRAFT" } })).expectStatus(200).expectJson((list: { id: number; sendOnNonWorkingDays: boolean }[]) => {
			expect(list.find((a) => a.id === plain.id)?.sendOnNonWorkingDays).toBe(false);
			expect(list.find((a) => a.id === flagged.id)?.sendOnNonWorkingDays).toBe(true);
		});
	});

	test("COM-12 publishing by hand is never held back by a day off", async ({ request, calls }) => {
		const { org } = await holidayLeaveOrg(request, calls, { communication: true });
		await makeTodayAWeeklyOff(org.client);
		const notice = await createAnnouncement(org.client, { title: "School closed tomorrow" });
		(await org.client.post(`${ANNOUNCEMENTS}/{id}/publish`, { params: { id: notice.id } })).expectStatus(200);
		expect(await announcementStatus(org.client, notice.id)).toBe("PUBLISHED");
	});
});
