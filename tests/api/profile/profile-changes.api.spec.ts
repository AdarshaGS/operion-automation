// Self-service profile changes: anyone submits a request to change their own phone, email or photo; a manager
// approves (the fields are applied to the person) or rejects (nothing changes). IDs refer to
// docs/SCENARIOS.md section 21 (ME-04, ME-05).

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { portalGuardian } from "../../../src/api/learning";
import { CHANGES, OWN_CHANGES, uniqueEmail, uniquePhone } from "../../../src/api/portal";
import { createDisposableUser } from "../../../src/api/users";
import { expectShape } from "../../../src/api/shapes";

const person = async (api: Parameters<typeof createDisposableUser>[0], id: number) => (await api.get("/api/v1/persons/{id}", { params: { id } })).expectStatus(200).body;

test.describe("ME-04 submitting a request", () => {
	test("ME-04 a request is PENDING, names the caller's person and the caller as requester, and shows in their own list", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const phone = uniquePhone();
		const res = await user.client.post(OWN_CHANGES, { body: { phone } });
		res.expectStatus(200);
		expectShape(res.body, { id: "number", personId: "number", status: "string", requestedBy: "number" });
		expect(res.body).toMatchObject({ personId: user.personId, phone, email: null, photoUrl: null, status: "PENDING", requestedBy: user.userId, reviewedBy: null, reviewedAt: null });
		(await user.client.get(OWN_CHANGES)).expectStatus(200).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toEqual([res.body.id]));
	});

	test("ME-04 phone, email and photo can be requested together", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const body = { phone: uniquePhone(), email: uniqueEmail(), photoUrl: "https://example.test/photo.png" };
		(await user.client.post(OWN_CHANGES, { body })).expectStatus(200).expectJson((r) => expect(r).toMatchObject(body));
	});

	test("ME-04 a request with nothing to change returns 400", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		for (const body of [{}, { phone: null, email: null, photoUrl: null }]) (await user.client.post(OWN_CHANGES, { body })).expectStatus(400);
	});

	test("ME-04 an email that is not an email address returns 400", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const res = await user.client.post(OWN_CHANGES, { body: { email: "not-an-email" } });
		expect(res.status, JSON.stringify(res.body)).toBe(400);
	});

	test("ME-04 a phone number that is not a phone number returns 400", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const res = await user.client.post(OWN_CHANGES, { body: { phone: "call me maybe" } });
		expect(res.status, JSON.stringify(res.body)).toBe(400);
	});

	test("ME-04 a user's own list holds only their requests", async ({ api, anon, seed }) => {
		const [one, two] = [await createDisposableUser(api, anon, seed, []), await createDisposableUser(api, anon, seed, [])];
		const mine = (await one.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		await two.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } });
		(await one.client.get(OWN_CHANGES)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toEqual([mine.id]));
		(await (await createDisposableUser(api, anon, seed, [])).client.get(OWN_CHANGES)).expectJson((list) => expect(list).toEqual([]));
	});

	test("ME-04 a guardian can request a change to their own details too", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const phone = uniquePhone();
		(await g.client.post(OWN_CHANGES, { body: { phone } })).expectStatus(200).expectJson((r) => expect(r.phone).toBe(phone));
		(await g.client.get(OWN_CHANGES)).expectJson((list) => expect(list).toHaveLength(1));
	});

	test("ME-04 an anonymous caller gets 401", async ({ anon }) => {
		(await anon.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).expectStatus(401);
		(await anon.get(OWN_CHANGES)).expectStatus(401);
	});
});

test.describe("ME-04 deciding a request", () => {
	test("ME-04 approving applies only the requested fields to the person and records who decided and when", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const before = await person(api, user.personId);
		const phone = uniquePhone();
		const request = (await user.client.post(OWN_CHANGES, { body: { phone } })).body;
		(await api.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } })).expectStatus(200).expectJson((r) => {
			expect(r.status).toBe("APPROVED");
			expect(r.reviewedBy).toEqual(expect.any(Number));
			expect(r.reviewedBy).not.toBe(user.userId);
			expect(r.reviewedAt).toBeTruthy();
		});
		const after = await person(api, user.personId);
		expect(after.phone).toBe(phone);
		expect([after.email, after.photoUrl, after.firstName, after.lastName]).toEqual([before.email, before.photoUrl, before.firstName, before.lastName]);
	});

	test("ME-04 approving all three fields applies all three", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const body = { phone: uniquePhone(), email: uniqueEmail(), photoUrl: "https://example.test/new.png" };
		const request = (await user.client.post(OWN_CHANGES, { body })).body;
		(await api.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } })).expectStatus(200);
		expect(await person(api, user.personId)).toMatchObject(body);
	});

	test("ME-04 rejecting leaves the person unchanged", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const before = await person(api, user.personId);
		const request = (await user.client.post(OWN_CHANGES, { body: { phone: uniquePhone(), email: uniqueEmail() } })).body;
		(await api.post(`${CHANGES}/{id}/reject`, { params: { id: request.id } })).expectStatus(200).expectJson((r) => {
			expect(r.status).toBe("REJECTED");
			expect(r.reviewedAt).toBeTruthy();
		});
		const after = await person(api, user.personId);
		expect([after.phone, after.email]).toEqual([before.phone, before.email]);
		(await user.client.get(OWN_CHANGES)).expectJson((list) => expect(list[0].status).toBe("REJECTED"));
	});

	test("ME-04 a decided request cannot be decided again (409)", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, []);
		const approved = (await user.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		await api.post(`${CHANGES}/{id}/approve`, { params: { id: approved.id } });
		for (const action of ["approve", "reject"]) (await api.post(`${CHANGES}/{id}/${action}`, { params: { id: approved.id } })).expectStatus(409);
		const rejected = (await user.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		await api.post(`${CHANGES}/{id}/reject`, { params: { id: rejected.id } });
		for (const action of ["approve", "reject"]) (await api.post(`${CHANGES}/{id}/${action}`, { params: { id: rejected.id } })).expectStatus(409);
	});

	test("ME-04 an unknown request returns 404", async ({ api }) => {
		for (const action of ["approve", "reject"]) (await api.post(`${CHANGES}/{id}/${action}`, { params: { id: 99999999 } })).expectStatus(404);
	});

	test("ME-04 the inbox lists everyone's requests and filters by status", async ({ api, anon, seed }) => {
		const [one, two] = [await createDisposableUser(api, anon, seed, []), await createDisposableUser(api, anon, seed, [])];
		const approved = (await one.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		const pending = (await two.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		await api.post(`${CHANGES}/{id}/approve`, { params: { id: approved.id } });
		const ids = async (status?: string) => ((await api.get(CHANGES, { query: status ? { status } : {} })).expectStatus(200).body as { id: number }[]).map((r) => r.id);
		expect(await ids("PENDING")).toEqual(expect.arrayContaining([pending.id]));
		expect(await ids("PENDING")).not.toContain(approved.id);
		expect(await ids("APPROVED")).toContain(approved.id);
		expect(await ids("REJECTED")).not.toContain(approved.id);
		expect(await ids()).toEqual(expect.arrayContaining([approved.id, pending.id]));
	});

	test("ME-04 an unknown status filter returns 400", async ({ api }) => {
		const res = await api.get(CHANGES, { query: { status: "MAYBE" } });
		expect(res.status, JSON.stringify(res.body)).toBe(400);
	});

	test("ME-04 approving an email another person already uses is refused rather than a server error", async ({ api, anon, seed }) => {
		const [one, two] = [await createDisposableUser(api, anon, seed, []), await createDisposableUser(api, anon, seed, [])];
		const email = uniqueEmail();
		const first = (await one.client.post(OWN_CHANGES, { body: { email } })).body;
		const second = (await two.client.post(OWN_CHANGES, { body: { email } })).body;
		(await api.post(`${CHANGES}/{id}/approve`, { params: { id: first.id } })).expectStatus(200);
		const res = await api.post(`${CHANGES}/{id}/approve`, { params: { id: second.id } });
		expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
	});
});

test.describe("ME-05 who may decide", () => {
	test("ME-05 the inbox and both decisions need PROFILE_CHANGE_MANAGE (403 without it)", async ({ api, anon, seed, as }) => {
		const requester = await createDisposableUser(api, anon, seed, []);
		const request = (await requester.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		const viewer = await createDisposableUser(api, anon, seed, ["HR_VIEW", "STUDENT_VIEW"]);
		for (const client of [viewer.client, as("readOnlyStaff"), as("noPermissions"), requester.client]) {
			(await client.get(CHANGES)).expectStatus(403);
			(await client.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } })).expectStatus(403);
			(await client.post(`${CHANGES}/{id}/reject`, { params: { id: request.id } })).expectStatus(403);
		}
		(await api.get(`${CHANGES}`)).expectStatus(200);
		(await anon.get(CHANGES)).expectStatus(401);
	});

	test("ME-05 a manager can decide other people's requests", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["PROFILE_CHANGE_MANAGE"]);
		const requester = await createDisposableUser(api, anon, seed, []);
		const request = (await requester.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		(await manager.client.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } })).expectStatus(200).expectJson((r) => expect(r.reviewedBy).toBe(manager.userId));
	});

	test("ME-05 a manager cannot approve their own request", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["PROFILE_CHANGE_MANAGE"]);
		const request = (await manager.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		const res = await manager.client.post(`${CHANGES}/{id}/approve`, { params: { id: request.id } });
		expect([403, 409], `own request approved: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
	});

	test("ME-05 another organisation's manager cannot see or decide this organisation's requests", async ({ api, anon, seed, request, calls }) => {
		const { createOtherOrganisation } = await import("../../../src/api/organisations");
		const requester = await createDisposableUser(api, anon, seed, []);
		const pending = (await requester.client.post(OWN_CHANGES, { body: { phone: uniquePhone() } })).body;
		const other = await createOtherOrganisation(request, calls);
		(await other.client.get(CHANGES)).expectStatus(200).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).not.toContain(pending.id));
		const res = await other.client.post(`${CHANGES}/{id}/approve`, { params: { id: pending.id } });
		expect(res.status).toBe(404);
		expect((await person(api, requester.personId)).phone).not.toBe(pending.phone);
	});
});
