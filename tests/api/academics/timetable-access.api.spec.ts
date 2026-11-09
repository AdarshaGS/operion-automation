// Access control and tenant isolation for the timetable features added on top of the grid (rules, rooms, school days,
// publishing, generation, unavailability, substitutions, export and the portal weeks). IDs refer to docs/SCENARIOS.md
// section 4 (ACA-40, ACA-41).

import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { createRoom, putEntry, timetableBase } from "../../../src/api/timetable";

type Ids = { yearId: number; classId: number; sectionId: number; personId: number };

test.describe("ACA-40 access control", () => {
	const writes: { title: string; call: (c: ApiClient, i: Ids) => Promise<{ status: number }> }[] = [
		{ title: "change the timetable rules", call: (c) => c.put("/api/v1/timetable/settings", { body: { gapMinutes: 0 } }) },
		{ title: "create a room", call: (c) => c.post("/api/v1/timetable/rooms", { body: { name: "Denied room" } }) },
		{ title: "create a school day", call: (c) => c.post("/api/v1/timetable/templates", { body: { name: "Denied day" } }) },
		{ title: "move a class to another school day", call: (c, i) => c.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: i.classId }, body: { templateId: null } }) },
		{ title: "publish a section's timetable", call: (c, i) => c.post("/api/v1/sections/{sectionId}/timetable/publish", { params: { sectionId: i.sectionId } }) },
		{ title: "unpublish a section's timetable", call: (c, i) => c.post("/api/v1/sections/{sectionId}/timetable/unpublish", { params: { sectionId: i.sectionId } }) },
		{ title: "publish the year's timetables", call: (c, i) => c.post("/api/v1/academic-years/{academicYearId}/timetable/publish", { params: { academicYearId: i.yearId } }) },
		{ title: "generate a section's timetable", call: (c, i) => c.post("/api/v1/sections/{sectionId}/timetable/generate", { params: { sectionId: i.sectionId }, body: {} }) },
		{ title: "generate the year's timetables", call: (c, i) => c.post("/api/v1/academic-years/{academicYearId}/timetable/generate", { params: { academicYearId: i.yearId }, body: {} }) },
		{ title: "block a teacher's time", call: (c, i) => c.post("/api/v1/teachers/{personId}/unavailability", { params: { personId: i.personId }, body: { dayOfWeek: "MONDAY" } }) },
		{ title: "assign a substitute", call: (c) => c.post("/api/v1/timetable/substitutions", { body: { entryId: 1, date: "2026-12-07", substituteTeacherPersonId: 1 } }) },
	];
	for (const role of ["noPermissions", "readOnlyStaff"] as const) {
		for (const write of writes) {
			test(`ACA-40 ${role} cannot ${write.title}`, async ({ as, seed }) => {
				const result = await write.call(as(role), { yearId: seed.academicYearId, classId: seed.classId, sectionId: seed.sectionId, personId: 1 });
				expect(result.status).toBe(403);
			});
		}
	}

	test("ACA-40 a user holding only TIMETABLE_VIEW can read rules, rooms, school days, summaries, substitutions and exports but not change them", async ({ request, calls, anon }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const viewer = await createDisposableUser(org.client, anon, await organisationContext(org), ["TIMETABLE_VIEW"]);
		(await viewer.client.get("/api/v1/timetable/settings")).expectStatus(200);
		(await viewer.client.get("/api/v1/timetable/rooms")).expectStatus(200);
		(await viewer.client.get("/api/v1/timetable/templates")).expectStatus(200);
		(await viewer.client.get("/api/v1/sections/{sectionId}/timetable/summary", { params: { sectionId: base.sectionId } })).expectStatus(200);
		(await viewer.client.get("/api/v1/timetable/substitutions", { query: { date: "2026-12-07" } })).expectStatus(200);
		(await viewer.client.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: base.sectionId } })).expectStatus(200);
		(await viewer.client.put("/api/v1/timetable/settings", { body: { gapMinutes: 3 } })).expectStatus(403);
		(await viewer.client.post("/api/v1/timetable/rooms", { body: { name: "Nope" } })).expectStatus(403);
	});

	test("ACA-40 a user without permissions cannot read any of them", async ({ as, seed }) => {
		const nobody = as("noPermissions");
		(await nobody.get("/api/v1/timetable/settings")).expectStatus(403);
		(await nobody.get("/api/v1/timetable/rooms")).expectStatus(403);
		(await nobody.get("/api/v1/timetable/templates")).expectStatus(403);
		(await nobody.get("/api/v1/sections/{sectionId}/timetable/summary", { params: { sectionId: seed.sectionId } })).expectStatus(403);
		(await nobody.get("/api/v1/timetable/substitutions", { query: { date: "2026-12-07" } })).expectStatus(403);
		(await nobody.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: seed.sectionId } })).expectStatus(403);
	});

	test("ACA-40 anonymous requests are rejected with 401", async ({ anon, seed }) => {
		(await anon.get("/api/v1/timetable/settings")).expectStatus(401);
		(await anon.put("/api/v1/timetable/settings", { body: { gapMinutes: 0 } })).expectStatus(401);
		(await anon.get("/api/v1/timetable/rooms")).expectStatus(401);
		(await anon.post("/api/v1/sections/{sectionId}/timetable/publish", { params: { sectionId: seed.sectionId } })).expectStatus(401);
		(await anon.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: seed.sectionId } })).expectStatus(401);
	});
});

test.describe("ACA-41 tenant isolation", () => {
	test("ACA-41 another organisation cannot see, change or use this organisation's rooms, school days, blocks, covers or publication", async ({ request, calls }) => {
		const owner = await createOtherOrganisation(request, calls);
		const intruder = await createOtherOrganisation(request, calls);
		const base = await timetableBase(owner.client);
		const room = await createRoom(owner.client, "Private room");
		const template = (await owner.client.post("/api/v1/timetable/templates", { body: { name: "Private day" } })).expectStatus([200, 201]).body;
		const block = (await owner.client.post("/api/v1/teachers/{personId}/unavailability", { params: { personId: base.teacherPersonId }, body: { dayOfWeek: "MONDAY", periodId: base.p1 } })).expectStatus([200, 201]).body;
		const entry = (await putEntry(owner.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p2, room.id)).expectStatus(200).body;
		(await owner.client.put("/api/v1/timetable/settings", { body: { gapMinutes: 7 } })).expectStatus(200);

		// Lists and rules are the intruder's own.
		(await intruder.client.get("/api/v1/timetable/rooms")).expectJson((list) => expect(list).toEqual([]));
		(await intruder.client.get("/api/v1/timetable/templates")).expectJson((list) => expect(list).toEqual([]));
		(await intruder.client.get("/api/v1/timetable/settings")).expectJson((s) => expect(s.gapMinutes).toBe(0));
		(await intruder.client.get("/api/v1/teachers/{personId}/unavailability", { params: { personId: base.teacherPersonId } })).expectJson((list) => expect(list).toEqual([]));

		// Direct references to the other organisation's rows are not found.
		(await intruder.client.put("/api/v1/timetable/rooms/{id}", { params: { id: room.id }, body: { name: "Taken" } })).expectStatus(404);
		(await intruder.client.delete("/api/v1/timetable/rooms/{id}", { params: { id: room.id } })).expectStatus(404);
		(await intruder.client.put("/api/v1/timetable/templates/{id}", { params: { id: template.id }, body: { name: "Taken" } })).expectStatus(404);
		(await intruder.client.delete("/api/v1/timetable/templates/{id}", { params: { id: template.id } })).expectStatus(404);
		(await intruder.client.delete("/api/v1/timetable/unavailability/{id}", { params: { id: block.id } })).expectStatus(404);
		(await intruder.client.put("/api/v1/school-classes/{classId}/period-template", { params: { classId: base.classId }, body: { templateId: null } })).expectStatus(404);
		(await intruder.client.get("/api/v1/sections/{sectionId}/timetable/summary", { params: { sectionId: base.sectionId } })).expectStatus(404);
		(await intruder.client.post("/api/v1/sections/{sectionId}/timetable/publish", { params: { sectionId: base.sectionId } })).expectStatus(404);
		(await intruder.client.post("/api/v1/sections/{sectionId}/timetable/generate", { params: { sectionId: base.sectionId }, body: {} })).expectStatus(404);
		(await intruder.client.get("/api/v1/sections/{sectionId}/timetable/export", { params: { sectionId: base.sectionId } })).expectStatus(404);
		(await intruder.client.post("/api/v1/timetable/substitutions", { body: { entryId: entry.id, date: "2026-10-26", substituteTeacherPersonId: base.secondTeacherPersonId } })).expectStatus(404);
		(await intruder.client.get("/api/v1/timetable/substitutions", { query: { date: "2026-10-26" } })).expectJson((list) => expect(list).toEqual([]));

		// The owner's data is untouched.
		(await owner.client.get("/api/v1/timetable/rooms")).expectJson((list) => expect(list.map((r: { name: string }) => r.name)).toEqual(["Private room"]));
		(await owner.client.get("/api/v1/timetable/settings")).expectJson((s) => expect(s.gapMinutes).toBe(7));
	});

	test("ACA-41 another organisation's room cannot be booked for a slot", async ({ request, calls }) => {
		const owner = await createOtherOrganisation(request, calls);
		const intruder = await createOtherOrganisation(request, calls);
		const room = await createRoom(owner.client, "Other org room");
		const base = await timetableBase(intruder.client);
		(await putEntry(intruder.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1, room.id)).expectStatus(404);
	});
});
