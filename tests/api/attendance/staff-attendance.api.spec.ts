// Staff attendance: check-in, check-out, list by campus and day. IDs refer to docs/SCENARIOS.md section 7.
// Runs in throwaway organisations (people and campuses need no student ids, so #354 does not apply).

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { createPerson } from "../../../src/api/academics";
import { expectShape } from "../../../src/api/shapes";
import type { ApiClient, RecordedCall } from "../../../src/api/apiClient";
import type { APIRequestContext } from "@playwright/test";

const STAFF = "/api/v1/attendance/staff";
const CHECK_OUT = "/api/v1/attendance/staff/{attendanceId}/check-out";
const DAY = "2026-06-10";
const STAFF_SHAPE = { id: "number", personId: "number", campusId: "number", attendanceDate: "string", attendanceStatus: "string" } as const;

async function staffOrg(request: APIRequestContext, calls: RecordedCall[]) {
	const org = await createOtherOrganisation(request, calls);
	const { campusId } = await organisationContext(org);
	const personId = await createPerson(org.client, "Staff", { dateOfBirth: "1985-01-01", gender: "FEMALE" });
	return { org, campusId, personId, client: org.client as ApiClient };
}

const checkIn = (campusId: number, personId: number, extra: Record<string, unknown> = {}) => ({
	personId, campusId, attendanceDate: DAY, status: "PRESENT", checkInTime: `${DAY}T09:00:00Z`, remarks: "On time", ...extra,
});

test.describe("mark and list", () => {
	test("ATT-13 marking a person present records the check-in and appears in the campus list", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const created = await client.post(STAFF, { body: checkIn(campusId, personId) });
		created.expectStatus([200, 201]).expectJson((row) => {
			expectShape(row, STAFF_SHAPE);
			expect(row).toMatchObject({ personId, campusId, attendanceDate: DAY, attendanceStatus: "PRESENT", remarks: "On time" });
			expect(row.checkInTime).toContain("09:00");
		});
		(await client.get(STAFF, { query: { campusId, date: DAY } })).expectStatus(200).expectJson((rows) => {
			expect(rows.map((r: { id: number }) => r.id)).toEqual([created.body.id]);
		});
	});

	test("ATT-13 the list is filtered by campus and by date", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		await client.post(STAFF, { body: checkIn(campusId, personId) });
		(await client.get(STAFF, { query: { campusId, date: "2026-06-11" } })).expectJson((rows) => expect(rows).toEqual([]));
		(await client.get(STAFF, { query: { campusId: campusId + 99999, date: DAY } })).expectJson((rows) => expect(rows).toEqual([]));
	});

	test("ATT-13 every attendance status can be recorded for staff", async ({ request, calls }) => {
		const { client, campusId } = await staffOrg(request, calls);
		for (const status of ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"]) {
			const personId = await createPerson(client, "Staff", { dateOfBirth: "1985-01-01", gender: "MALE" });
			(await client.post(STAFF, { body: checkIn(campusId, personId, { status }) })).expectStatus([200, 201]).expectJson((row) => expect(row.attendanceStatus).toBe(status));
		}
	});

	test("ATT-13 the same person cannot be marked twice on one day", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		await client.post(STAFF, { body: checkIn(campusId, personId) });
		(await client.post(STAFF, { body: checkIn(campusId, personId, { status: "ABSENT" }) })).expectStatus(409).expectJson((body) => expect(body.error).toMatch(/already has staff attendance/i));
	});

	test("ATT-13 an unknown person or campus returns 404", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		(await client.post(STAFF, { body: checkIn(campusId, 99999999) })).expectStatus(404);
		(await client.post(STAFF, { body: checkIn(99999999, personId) })).expectStatus(404);
	});

	test("ATT-13 an unknown status returns 400", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		(await client.post(STAFF, { body: checkIn(campusId, personId, { status: "NOPE" }) })).expectStatus([400, 422]);
	});

	test("ATT-13 a missing date returns 400", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		(await client.post(STAFF, { body: checkIn(campusId, personId, { attendanceDate: null }) })).expectStatus([400, 422]);
	});

	test("ATT-13 the list needs both campus and date", async ({ request, calls }) => {
		const { client, campusId } = await staffOrg(request, calls);
		(await client.get(STAFF, { query: { campusId } })).expectStatus(400);
		(await client.get(STAFF, { query: { date: DAY } })).expectStatus(400);
	});
});

test.describe("check out", () => {
	test("ATT-13 checking out records the time", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId) })).body;
		(await client.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus(200).expectJson((updated) => {
			expect(updated.id).toBe(row.id);
			expect(updated.checkOutTime).toContain("17:00");
		});
	});

	test("ATT-14 a check-out earlier than the check-in is rejected", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId) })).body;
		(await client.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T08:00:00Z` } })).expectStatus([400, 409, 422]);
	});

	test("ATT-14 a check-out for a person who never checked in (no check-in time) is rejected", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId, { status: "ABSENT", checkInTime: null }) })).body;
		(await client.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus([400, 409, 422]);
	});

	test("ATT-14 a missing check-out time returns 400", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId) })).body;
		(await client.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: {} })).expectStatus([400, 422]);
	});

	test("ATT-14 an unknown attendance id returns 404", async ({ request, calls }) => {
		const { client } = await staffOrg(request, calls);
		(await client.patch(CHECK_OUT, { params: { attendanceId: 99999999 }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus(404);
	});
});

test.describe("permissions and tenant isolation", () => {
	test("ATT-16 viewing needs STAFF_ATTENDANCE_VIEW; marking and checking out need STAFF_ATTENDANCE_MARK", async ({ request, calls, anon }) => {
		const { org, client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId) })).body;
		const context = await organisationContext(org);
		const viewer = (await createDisposableUser(client, anon, context as never, ["STAFF_ATTENDANCE_VIEW"])).client;
		(await viewer.get(STAFF, { query: { campusId, date: DAY } })).expectStatus(200);
		(await viewer.post(STAFF, { body: checkIn(campusId, personId, { attendanceDate: "2026-06-12" }) })).expectStatus(403);
		(await viewer.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus(403);
		const marker = (await createDisposableUser(client, anon, context as never, ["STAFF_ATTENDANCE_VIEW", "STAFF_ATTENDANCE_MARK"])).client;
		(await marker.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus(200);
	});

	test("ATT-16 without any attendance permission the list is 403", async ({ request, calls, anon }) => {
		const { org, client, campusId } = await staffOrg(request, calls);
		const nobody = (await createDisposableUser(client, anon, (await organisationContext(org)) as never, [])).client;
		(await nobody.get(STAFF, { query: { campusId, date: DAY } })).expectStatus(403);
	});

	test("ATT-18 another organisation sees nothing of these staff records and cannot check them out", async ({ request, calls }) => {
		const { client, campusId, personId } = await staffOrg(request, calls);
		const row = (await client.post(STAFF, { body: checkIn(campusId, personId) })).body;
		const outsider = await createOtherOrganisation(request, calls);
		(await outsider.client.get(STAFF, { query: { campusId, date: DAY } })).expectStatus([200, 404]).expectJson((rows) => { if (Array.isArray(rows)) expect(rows).toEqual([]); });
		(await outsider.client.patch(CHECK_OUT, { params: { attendanceId: row.id }, body: { checkOutTime: `${DAY}T17:00:00Z` } })).expectStatus(404);
		(await outsider.client.post(STAFF, { body: checkIn(campusId, personId, { attendanceDate: "2026-06-13" }) })).expectStatus(404);
	});
});
