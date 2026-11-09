// Teacher-scoped attendance (go-live must-fix). Plain ATTENDANCE_MARK covers only sections the caller is the
// ACTIVE homeroom (class) teacher of; ATTENDANCE_MARK_ANY_SECTION (or the Owner) covers every section.
// IDs refer to docs/SCENARIOS.md section 7 (ATT-30..ATT-35).

import { test, expect } from "../../../src/api/fixtures";
import { createDisposableUser } from "../../../src/api/users";
import { attendanceSetup, CLASS_TEACHER_CODES, makeClassTeacher, marks, REGISTER } from "../../../src/api/attendance";

const MARKABLE = "/api/v1/attendance/markable-sections";
const SUBMIT = "/api/v1/attendance/register/{registerId}/submit";

test.describe("teacher-scoped attendance", () => {
	test("ATT-30 a class teacher marks and submits their own section", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, s.sectionId, teacher.personId, s.day(1));
		const reg = (await teacher.client.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT", "ABSENT"]) } })).expectStatus(200).body;
		(await teacher.client.post(SUBMIT, { params: { registerId: reg.register.id } })).expectStatus(200);
	});

	test("ATT-31 a class teacher cannot mark a section they are not class teacher of", async ({ api, anon, seed }) => {
		const own = await attendanceSetup(api, 1);
		const other = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, own.sectionId, teacher.personId, own.day(1));
		const denied = (await teacher.client.post(REGISTER, { params: { sectionId: other.sectionId }, body: { attendanceDate: other.day(10), marks: marks(other, ["PRESENT"]) } })).expectStatus(403);
		expect(JSON.stringify(denied.body)).toContain("class teacher");
	});

	test("ATT-32 a class teacher cannot submit another section's register", async ({ api, anon, seed }) => {
		const own = await attendanceSetup(api, 1);
		const other = await attendanceSetup(api, 1);
		const reg = (await api.post(REGISTER, { params: { sectionId: other.sectionId }, body: { attendanceDate: other.day(10), marks: marks(other, ["PRESENT"]) } })).expectStatus(200).body;
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, own.sectionId, teacher.personId, own.day(1));
		(await teacher.client.post(SUBMIT, { params: { registerId: reg.register.id } })).expectStatus(403);
	});

	test("ATT-33 a subject-only teacher with ATTENDANCE_MARK cannot mark the section", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: s.sectionId }, body: { subjectId: s.base.subjectId, teacherPersonId: teacher.personId, assignmentType: "SUBJECT", startDate: s.day(1) } })).expectStatus([200, 201]);
		(await teacher.client.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT"]) } })).expectStatus(403);
		(await teacher.client.get(MARKABLE)).expectJson((body) => {
			expect(body.scope).toBe("OWN");
			expect(body.sectionIds).not.toContain(s.sectionId);
		});
	});

	test("ATT-34 ATTENDANCE_MARK_ANY_SECTION marks any section without a teacher assignment", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const office = await createDisposableUser(api, anon, seed, ["ATTENDANCE_VIEW", "ATTENDANCE_MARK_ANY_SECTION"]);
		(await office.client.post(REGISTER, { params: { sectionId: s.sectionId }, body: { attendanceDate: s.day(10), marks: marks(s, ["PRESENT"]) } })).expectStatus(200);
		(await office.client.get(MARKABLE)).expectJson((body) => expect(body.scope).toBe("ALL"));
	});

	test("ATT-35 markable-sections reports OWN with the homeroom section and its class, NONE without a mark permission", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await createDisposableUser(api, anon, seed, CLASS_TEACHER_CODES);
		await makeClassTeacher(api, s.sectionId, teacher.personId, s.day(1));
		(await teacher.client.get(MARKABLE)).expectJson((body) => {
			expect(body.scope).toBe("OWN");
			expect(body.sectionIds).toEqual([s.sectionId]);
			expect(body.schoolClassIds).toEqual([s.base.classId]);
		});
		const viewer = await createDisposableUser(api, anon, seed, ["ATTENDANCE_VIEW"]);
		(await viewer.client.get(MARKABLE)).expectJson((body) => expect(body.scope).toBe("NONE"));
		(await api.get(MARKABLE)).expectJson((body) => expect(body.scope).toBe("ALL"));
	});
});
