// Teacher performance API (/api/v1/performance). IDs refer to docs/SCENARIOS.md section 30 (PERF-*).
// Every test uses its own throwaway organisation, so metric and self-view settings never collide with other specs.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation, type OtherOrganisation } from "../../../src/api/organisations";
import { PERFORMANCE, createCycle, markStaff, poolIn, setSelfView, teacher, trackMetric } from "../../../src/api/performance";
import { createDisposableUser } from "../../../src/api/users";
import { enableModule } from "../../../src/setup/provisioning";
import type { ApiClient, RecordedCall } from "../../../src/api/apiClient";
import type { APIRequestContext } from "@playwright/test";

async function org(request: APIRequestContext, calls: RecordedCall[], moduleOn = true): Promise<OtherOrganisation> {
	const o = await createOtherOrganisation(request, calls);
	if (moduleOn) await enableModule(o.session.organisationId, "PERFORMANCE");
	return o;
}

/** A teacher in the organisation's own academic structure. */
const teacherIn = (o: OtherOrganisation) => teacher(o.client);

test.describe("PERF-01 module gate", () => {
	test("PERF-01 every performance endpoint is refused while the module is off, even for the owner", async ({ request, calls }) => {
		const o = await org(request, calls, false);
		(await o.client.get(`${PERFORMANCE}/metrics`)).expectStatus(403);
		(await o.client.get(`${PERFORMANCE}/cycles`)).expectStatus(403);
		(await o.client.get(`${PERFORMANCE}/settings`)).expectStatus(403);
	});

	test("PERF-01 once the platform owner switches it on, the catalogue lists 13 metrics and none is tracked", async ({ request, calls }) => {
		const o = await org(request, calls);
		const list = (await o.client.get(`${PERFORMANCE}/metrics`)).expectStatus(200).body;
		expect(list).toHaveLength(13);
		expect(list.every((m: { enabled: boolean }) => !m.enabled)).toBe(true);
		expect(list.find((m: { metric: string }) => m.metric === "MARKS_ENTRY_ON_TIME")).toMatchObject({ usesDays: true });
		expect(list.find((m: { metric: string }) => m.metric === "OUTCOME_PASS_RATE")).toMatchObject({ kind: "OUTCOME" });
	});
});

test.describe("PERF-02 metric configuration", () => {
	test("PERF-02 weight, target and days are validated", async ({ request, calls }) => {
		const o = await org(request, calls);
		const put = (metric: string, body: object) => o.client.put(`${PERFORMANCE}/metrics/{metric}`, { params: { metric }, body });
		(await put("STAFF_PRESENCE", { enabled: true, weight: 0, target: 100 })).expectStatus(400);
		(await put("STAFF_PRESENCE", { enabled: true, weight: 101, target: 100 })).expectStatus(400);
		(await put("STAFF_PRESENCE", { enabled: true, weight: 1, target: 0 })).expectStatus(400);
		(await put("STAFF_PRESENCE", { enabled: true, weight: 1, target: 101 })).expectStatus(400);
		(await put("MARKS_ENTRY_ON_TIME", { enabled: true, weight: 1, target: 100, days: 91 })).expectStatus(400);
		(await put("MARKS_ENTRY_ON_TIME", { enabled: true, weight: 1, target: 100, days: 5 })).expectStatus(200);
		(await put("STAFF_PRESENCE", { enabled: true, weight: 2, target: 90 })).expectStatus(200);
	});

	test("PERF-02 a user with KPI_VIEW reads the metrics but cannot change them", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		const campusId = (await o.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const viewer = await createDisposableUser(o.client, anon, { organisationSlug: o.slug, campusId }, ["KPI_VIEW"]);
		(await viewer.client.get(`${PERFORMANCE}/metrics`)).expectStatus(200);
		(await viewer.client.put(`${PERFORMANCE}/metrics/{metric}`, { params: { metric: "STAFF_PRESENCE" }, body: { enabled: true, weight: 1, target: 100 } })).expectStatus(403);
		(await viewer.client.put(`${PERFORMANCE}/settings`, { body: { teacherSelfView: true } })).expectStatus(403);
	});

	test("PERF-02 a user with no performance permission is refused", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		const campusId = (await o.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const nobody = await createDisposableUser(o.client, anon, { organisationSlug: o.slug, campusId }, []);
		(await nobody.client.get(`${PERFORMANCE}/metrics`)).expectStatus(403);
		(await nobody.client.get(`${PERFORMANCE}/scorecard`, { query: { from: "2026-01-01", to: "2026-01-31" } })).expectStatus(403);
	});
});

test.describe("PERF-03 scorecard", () => {
	test("PERF-03 punctuality is the share of attended days that were not late; a teacher with no records has no score", async ({ request, calls }) => {
		const o = await org(request, calls);
		const busy = await teacherIn(o);
		const idle = await teacher(o.client, busy.pool);
		await markStaff(o.client, busy, [[1, "PRESENT"], [2, "LATE"], [3, "PRESENT"], [4, "PRESENT"]]);
		await trackMetric(o.client, "STAFF_PUNCTUALITY");

		const today = new Date().toISOString().slice(0, 10);
		const card = (await o.client.get(`${PERFORMANCE}/scorecard`, { query: { from: "2020-01-01", to: today } })).expectStatus(200).body;
		const rowFor = (id: number) => card.teachers.find((t: { personId: number }) => t.personId === id);
		expect(rowFor(busy.personId).cells[0]).toMatchObject({ metric: "STAFF_PUNCTUALITY", value: 75, sample: 4, score: 75 });
		expect(rowFor(busy.personId).overallScore).toBe(75);
		expect(rowFor(idle.personId).cells[0].value).toBeNull();
		expect(rowFor(idle.personId).overallScore).toBeNull();
	});

	test("PERF-03 teachers are listed alphabetically, not ranked by score", async ({ request, calls }) => {
		const o = await org(request, calls);
		const a = await teacherIn(o);
		const b = await teacher(o.client, a.pool);
		await markStaff(o.client, b, [[1, "PRESENT"]]);
		await trackMetric(o.client, "STAFF_PRESENCE");
		const card = (await o.client.get(`${PERFORMANCE}/scorecard`, { query: { from: "2020-01-01", to: new Date().toISOString().slice(0, 10) } })).expectStatus(200).body;
		const names: string[] = card.teachers.map((t: { name: string }) => t.name);
		const lastNames = names.map((n) => n.split(" ").slice(-1)[0]);
		expect(lastNames).toEqual([...lastNames].sort((x, y) => x.localeCompare(y)));
	});
});

test.describe("PERF-04 appraisal cycles", () => {
	test("PERF-04 a cycle is created, listed, closed, and a closed cycle takes no more ratings or goals", async ({ request, calls }) => {
		const o = await org(request, calls);
		const t = await teacherIn(o);
		const cycle = await createCycle(o.client);
		expect((await o.client.get(`${PERFORMANCE}/cycles`)).expectStatus(200).body.map((c: { name: string }) => c.name)).toContain(cycle.name);

		const feedback = (id: number, body: object) => o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId: id, personId: t.personId }, body });
		(await feedback(cycle.id, { source: "MANAGER", rating: 4, comment: "Good" })).expectStatus([200, 201]);
		(await o.client.post(`${PERFORMANCE}/cycles/{id}/close`, { params: { id: cycle.id } })).expectStatus(200);
		(await feedback(cycle.id, { source: "MANAGER", rating: 3 })).expectStatus(400);
		(await o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/goals`, { params: { cycleId: cycle.id, personId: t.personId }, body: { title: "Late goal" } })).expectStatus(400);
	});

	test("PERF-04 ratings outside 1 to 5, an unknown source, and rating someone who is not a teacher are refused", async ({ request, calls }) => {
		const o = await org(request, calls);
		const t = await teacherIn(o);
		const cycle = await createCycle(o.client);
		const feedback = (personId: number, body: object) => o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId: cycle.id, personId }, body });
		(await feedback(t.personId, { source: "MANAGER", rating: 0 })).expectStatus(400);
		(await feedback(t.personId, { source: "MANAGER", rating: 6 })).expectStatus(400);
		(await feedback(t.personId, { source: "SELF", rating: 3 })).expectStatus(400);

		const notTeacher = (await o.client.post("/api/v1/persons", { body: { firstName: "Plain", lastName: "Person", gender: "MALE" } })).expectStatus([200, 201]).body.id;
		(await feedback(notTeacher, { source: "MANAGER", rating: 3 })).expectStatus(400);
	});

	test("PERF-04 rating the same teacher twice keeps one rating per reviewer", async ({ request, calls }) => {
		const o = await org(request, calls);
		const t = await teacherIn(o);
		const cycle = await createCycle(o.client);
		const feedback = (body: object) => o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId: cycle.id, personId: t.personId }, body });
		(await feedback({ source: "MANAGER", rating: 5, comment: "First" })).expectStatus([200, 201]);
		(await feedback({ source: "MANAGER", rating: 2, comment: "Second" })).expectStatus([200, 201]);
		const appraisal = (await o.client.get(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}`, { params: { cycleId: cycle.id, personId: t.personId } })).expectStatus(200).body;
		expect(appraisal.feedback).toHaveLength(1);
		expect(appraisal.feedback[0]).toMatchObject({ rating: 2, comment: "Second" });
	});

	test("PERF-04 a goal is added and its status moved on", async ({ request, calls }) => {
		const o = await org(request, calls);
		const t = await teacherIn(o);
		const cycle = await createCycle(o.client);
		const goal = (await o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/goals`, { params: { cycleId: cycle.id, personId: t.personId }, body: { title: "Remedial class", description: "Fridays" } })).expectStatus([200, 201]).body;
		(await o.client.put(`${PERFORMANCE}/goals/{goalId}`, { params: { goalId: goal.id }, body: { title: "Remedial class", description: "Fridays", status: "PARTLY_ACHIEVED" } })).expectStatus(200);
		const appraisal = (await o.client.get(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}`, { params: { cycleId: cycle.id, personId: t.personId } })).expectStatus(200).body;
		expect(appraisal.goals[0]).toMatchObject({ title: "Remedial class", status: "PARTLY_ACHIEVED" });
	});
});

test.describe("PERF-05 teacher self-view", () => {
	async function signedInTeacher(o: OtherOrganisation, anon: ApiClient) {
		const pool = await poolIn(o.client);
		const pair = pool.pairs.shift()!;
		const user = await createDisposableUser(o.client, anon, { organisationSlug: o.slug, campusId: pool.campusId }, []);
		(await o.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: pair.sectionId }, body: { subjectId: pair.subjectId, teacherPersonId: user.personId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
		return user;
	}
	const range = { from: "2020-01-01", to: new Date().toISOString().slice(0, 10) };

	test("PERF-05 /me is refused until the organisation switches self-view on", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		const me = await signedInTeacher(o, anon);
		(await me.client.get(`${PERFORMANCE}/me/scorecard`, { query: range })).expectStatus(403);
		await setSelfView(o.client, true);
		(await me.client.get(`${PERFORMANCE}/me/scorecard`, { query: range })).expectStatus(200);
	});

	test("PERF-05 someone who is not a teacher is refused even with self-view on", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		await setSelfView(o.client, true);
		const campusId = (await o.client.get("/api/v1/campuses")).expectStatus(200).body[0].id;
		const plain = await createDisposableUser(o.client, anon, { organisationSlug: o.slug, campusId }, []);
		(await plain.client.get(`${PERFORMANCE}/me/scorecard`, { query: range })).expectStatus(403);
	});

	test("PERF-05 while a cycle is open the teacher sees only their own rating; after it closes, the manager's (named) but never a peer's", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		await setSelfView(o.client, true);
		const me = await signedInTeacher(o, anon);
		const cycle = await createCycle(o.client);
		const rate = (body: object) => o.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId: cycle.id, personId: me.personId }, body });
		(await rate({ source: "MANAGER", rating: 5, comment: "Manager view" })).expectStatus([200, 201]);
		(await me.client.post(`${PERFORMANCE}/me/cycles/{id}/self-appraisal`, { params: { id: cycle.id }, body: { rating: 4, comment: "My view" } })).expectStatus([200, 201]);

		const open = (await me.client.get(`${PERFORMANCE}/me/cycles/{id}`, { params: { id: cycle.id } })).expectStatus(200).body;
		expect(open.feedback.map((f: { source: string }) => f.source)).toEqual(["SELF"]);

		(await o.client.post(`${PERFORMANCE}/cycles/{id}/close`, { params: { id: cycle.id } })).expectStatus(200);
		const closed = (await me.client.get(`${PERFORMANCE}/me/cycles/{id}`, { params: { id: cycle.id } })).expectStatus(200).body;
		expect(closed.feedback.map((f: { source: string }) => f.source).sort()).toEqual(["MANAGER", "SELF"]);
		(await me.client.post(`${PERFORMANCE}/me/cycles/{id}/self-appraisal`, { params: { id: cycle.id }, body: { rating: 1, comment: "too late" } })).expectStatus(400);
	});

	test("PERF-05 a teacher cannot rate through the administrator endpoint", async ({ request, calls, anon }) => {
		const o = await org(request, calls);
		await setSelfView(o.client, true);
		const me = await signedInTeacher(o, anon);
		const cycle = await createCycle(o.client);
		(await me.client.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId: cycle.id, personId: me.personId }, body: { source: "MANAGER", rating: 5 } })).expectStatus(403);
	});
});
