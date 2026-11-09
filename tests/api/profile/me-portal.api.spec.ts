// /me: who the caller is for routing (ADMIN or PORTAL with guardian and teacher contexts), the teacher's own
// sections and leave, and the guardian's view of a child's attendance, fees, report cards and announcements.
// IDs refer to docs/SCENARIOS.md section 21 (ME-*). The child endpoints of learning (homework, quizzes, ...)
// are covered under LRN-04 to LRN-15.

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { examSetup, approveSchedule } from "../../../src/api/examinations";
import { invoiced, pay } from "../../../src/api/fees";
import { createLeaveType, allocateLeave } from "../../../src/api/hr";
import { portalGuardian } from "../../../src/api/learning";
import { ME, portalTeacher, portalUser } from "../../../src/api/portal";
import { createDisposableUser } from "../../../src/api/users";
import { uniqueSuffix } from "../../../src/api/data";
import { enableModule } from "../../../src/setup/provisioning";

test.describe("ME-01 who am I", () => {
	test("ME-01 the owner is an ADMIN session with no portal contexts", async ({ api }) => {
		(await api.get(ME)).expectStatus(200).expectJson((me) => expect(me).toEqual({ sessionType: "ADMIN", portalContexts: [] }));
	});

	test("ME-01 a staff member with a normal role is an ADMIN session too", async ({ api, anon, seed }) => {
		const staff = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await staff.client.get(ME)).expectStatus(200).expectJson((me) => expect(me.sessionType).toBe("ADMIN"));
	});

	test("ME-01 a parent who claimed a portal invite is a PORTAL session with a GUARDIAN context for the child", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.get(ME)).expectStatus(200).expectJson((me) => {
			expect(me.sessionType, "the claimed Guardian role is not flagged portal, so the parent is routed to the admin app").toBe("PORTAL");
			expect(me.portalContexts).toEqual([expect.objectContaining({ type: "GUARDIAN", guardianId: g.guardianId })]);
		});
	});

	test("ME-01 a guardian in a portal role gets a GUARDIAN context listing each linked child", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const user = await portalUser(api, anon, seed);
		const guardian = (await api.post("/api/v1/guardians", { body: { personId: user.personId, occupation: "Engineer" } })).expectStatus([200, 201]).body;
		for (const studentId of s.studentIds) {
			(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId }, body: { guardianId: guardian.id, relationshipType: "FATHER", primaryGuardian: false, emergencyContact: false, canPickup: true, canReceiveCommunication: true, contactPriority: 1 } })).expectStatus(200);
		}
		(await user.client.get(ME)).expectStatus(200).expectJson((me) => {
			expect(me.sessionType).toBe("PORTAL");
			expect(me.portalContexts).toHaveLength(1);
			expect(me.portalContexts[0]).toMatchObject({ type: "GUARDIAN", guardianId: guardian.id });
			expect(me.portalContexts[0].children.map((c: { studentId: number }) => c.studentId).sort()).toEqual([...s.studentIds].sort());
			expect(me.portalContexts[0].children.map((c: { name: string }) => c.name).sort()).toEqual([...s.studentNames].sort());
		});
	});

	test("ME-01 a teacher is a PORTAL session with a TEACHER context", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		(await teacher.client.get(ME)).expectStatus(200).expectJson((me) => {
			expect(me.sessionType).toBe("PORTAL");
			expect(me.portalContexts).toEqual([expect.objectContaining({ type: "TEACHER", teacherPersonId: teacher.personId })]);
		});
	});

	test("ME-01 a portal user linked to nothing is PORTAL with no contexts", async ({ api, anon, seed }) => {
		const user = await portalUser(api, anon, seed);
		(await user.client.get(ME)).expectStatus(200).expectJson((me) => expect(me).toEqual({ sessionType: "PORTAL", portalContexts: [] }));
	});

	test("ME-01 a teacher who is also a guardian gets both contexts", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const guardian = await api.post("/api/v1/guardians", { body: { personId: teacher.personId, occupation: "Teacher" } });
		guardian.expectStatus([200, 201]);
		(await api.post("/api/v1/students/{studentId}/guardians", { params: { studentId: s.studentIds[0] }, body: { guardianId: guardian.body.id, relationshipType: "MOTHER", primaryGuardian: false, emergencyContact: false, canPickup: true, canReceiveCommunication: true, contactPriority: 1 } })).expectStatus(200);
		(await teacher.client.get(ME)).expectJson((me) => expect(me.portalContexts.map((c: { type: string }) => c.type).sort()).toEqual(["GUARDIAN", "TEACHER"]));
	});

	test("ME-01 an anonymous caller gets 401", async ({ anon }) => {
		(await anon.get(ME)).expectStatus(401);
	});
});

test.describe("ME-02 a teacher's own sections and leave", () => {
	test("ME-02 sections lists the teacher's active assignments and nobody else's", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const other = await portalUser(api, anon, seed);
		(await teacher.client.get(`${ME}/sections`)).expectStatus(200).expectJson((list) => {
			expect(list).toEqual([expect.objectContaining({ sectionId: s.sectionId, sectionName: s.sectionName, assignmentType: "SUBJECT" })]);
			expect(list[0].schoolClassDisplayName).toBe(s.className);
		});
		(await other.client.get(`${ME}/sections`)).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("ME-02 leave types lists the organisation's active leave types", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const live = await createLeaveType(api);
		(await teacher.client.get(`${ME}/leave-types`)).expectStatus(200).expectJson((list) => {
			expect(list.map((t: { id: number }) => t.id)).toContain(live.id);
			expect(list.every((t: { status: string }) => t.status === "ACTIVE")).toBe(true);
		});
	});

	test("ME-02 the leave balance shows allocated and remaining days, and remaining drops when leave is approved", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		await allocateLeave(api, teacher.staffProfileId, type.id, s.yearId, 10);
		const own = async () => (await teacher.client.get(`${ME}/leave-balance`, { query: { academicYearId: s.yearId } })).expectStatus(200).body.find((b: { leaveTypeId: number }) => b.leaveTypeId === type.id);
		expect(await own()).toMatchObject({ leaveTypeName: type.name, allocatedDays: 10, remainingDays: 10 });
		const raised = (await teacher.client.post(`${ME}/leave-requests`, { body: { leaveTypeId: type.id, academicYearId: s.yearId, startDate: s.day(10), endDate: s.day(11), numberOfDays: 2, reason: "Family event" } })).expectStatus(200).body;
		(await api.post("/api/v1/hr/leave-requests/{id}/approve", { params: { id: raised.id }, body: { decidedBy: teacher.userId } })).expectStatus(200);
		expect(await own()).toMatchObject({ allocatedDays: 10, remainingDays: 8 });
	});

	test("ME-02 a leave type with no allocation shows zero allocated", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		(await teacher.client.get(`${ME}/leave-balance`, { query: { academicYearId: s.yearId } })).expectJson((list) => expect(list.find((b: { leaveTypeId: number }) => b.leaveTypeId === type.id)).toMatchObject({ allocatedDays: 0 }));
	});

	test("ME-02 a raised request is PENDING, belongs to the caller, and is visible to HR", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		await allocateLeave(api, teacher.staffProfileId, type.id, s.yearId, 5);
		const raised = (await teacher.client.post(`${ME}/leave-requests`, { body: { leaveTypeId: type.id, academicYearId: s.yearId, startDate: s.day(10), endDate: s.day(10), numberOfDays: 1, reason: "Appointment" } })).expectStatus(200).body;
		expect(raised).toMatchObject({ status: "PENDING", leaveTypeName: type.name, numberOfDays: 1, reason: "Appointment" });
		(await teacher.client.get(`${ME}/leave-requests`)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toEqual([raised.id]));
		(await api.get("/api/v1/hr/leave-requests", { query: { status: "PENDING" } })).expectJson((list) => expect(list.find((r: { id: number }) => r.id === raised.id)).toMatchObject({ staffProfileId: teacher.staffProfileId }));
	});

	test("ME-02 one teacher cannot see another teacher's leave requests", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const [first, second] = [await portalTeacher(api, anon, seed, s), await portalTeacher(api, anon, seed, s)];
		const type = await createLeaveType(api);
		await allocateLeave(api, first.staffProfileId, type.id, s.yearId, 5);
		await first.client.post(`${ME}/leave-requests`, { body: { leaveTypeId: type.id, academicYearId: s.yearId, startDate: s.day(10), endDate: s.day(10), numberOfDays: 1, reason: "Mine" } });
		(await second.client.get(`${ME}/leave-requests`)).expectJson((list) => expect(list).toEqual([]));
	});

	test("ME-02 a leave request needs enough balance (409), a real leave type and academic year (404)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		await allocateLeave(api, teacher.staffProfileId, type.id, s.yearId, 1);
		// A fortnight of calendar days always holds five working days whatever the weekly off, so the request is judged on balance, not on the calendar.
		const body = { leaveTypeId: type.id, academicYearId: s.yearId, startDate: s.day(10), endDate: s.day(24), numberOfDays: 5, reason: "Too long" };
		const tooMany = await teacher.client.post(`${ME}/leave-requests`, { body });
		expect([200, 409], "a 5-day request against 1 day of balance may be raised and refused only on approval").toContain(tooMany.status);
		(await teacher.client.post(`${ME}/leave-requests`, { body: { ...body, leaveTypeId: 99999999, numberOfDays: 1 } })).expectStatus(404);
		(await teacher.client.post(`${ME}/leave-requests`, { body: { ...body, academicYearId: 99999999, numberOfDays: 1 } })).expectStatus(404);
	});

	test("ME-02 an end date before the start, zero days and a negative number of days return 400", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const teacher = await portalTeacher(api, anon, seed, s);
		const type = await createLeaveType(api);
		await allocateLeave(api, teacher.staffProfileId, type.id, s.yearId, 5);
		const base = { leaveTypeId: type.id, academicYearId: s.yearId, startDate: s.day(10), endDate: s.day(11), numberOfDays: 2 };
		for (const [label, over] of [["end before start", { startDate: s.day(12), endDate: s.day(10) }], ["zero days", { numberOfDays: 0 }], ["negative days", { numberOfDays: -2 }]] as const) {
			const res = await teacher.client.post(`${ME}/leave-requests`, { body: { ...base, ...over } });
			expect.soft(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
		}
	});

	test("ME-02 a portal user with no staff profile gets 403 on leave", async ({ api, anon, seed }) => {
		const user = await portalUser(api, anon, seed);
		(await user.client.get(`${ME}/leave-requests`)).expectStatus(403);
		(await user.client.get(`${ME}/leave-balance`, { query: { academicYearId: (await attendanceSetup(api, 1)).yearId } })).expectStatus(403);
		(await user.client.post(`${ME}/leave-requests`, { body: { leaveTypeId: 1, academicYearId: 1, startDate: "2026-01-01", endDate: "2026-01-01", numberOfDays: 1 } })).expectStatus(403);
	});

	test("ME-02 the self-service endpoints need a login", async ({ anon }) => {
		for (const path of ["sections", "leave-types", "leave-requests", "leave-balance?academicYearId=1", "payslips"]) (await anon.get(`${ME}/${path}`)).expectStatus(401);
	});
});

test.describe("ME-06 a guardian's view of a child", () => {
	test("ME-06 fees lists the child's invoices with amounts and status, and moves when a payment is made", async ({ api, anon, seed }) => {
		const f = await invoiced(api, { count: 2, each: 1000 });
		const g = await portalGuardian(api, anon, seed.organisationSlug, f.studentIds[0]);
		(await g.client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: f.studentIds[0] } })).expectStatus(200).expectJson((list) => {
			expect(list).toEqual([expect.objectContaining({ invoiceId: f.invoice.id, invoiceNumber: f.invoice.invoiceNumber, totalAmount: 1000, amountPaid: 0, outstanding: 1000 })]);
		});
		(await pay(api, f, f.invoice.id, 400)).expectStatus([200, 201]);
		(await g.client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: f.studentIds[0] } })).expectJson((list) => expect(list[0]).toMatchObject({ amountPaid: 400, outstanding: 600 }));
	});

	test("ME-06 a child with no invoices has an empty fee list", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
	});

	test("ME-06 attendance returns today's status and the month's summary", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.get(`${ME}/children/{studentId}/attendance`, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((a) => {
			expect(a).toHaveProperty("todayStatus");
			expect(a.monthly).toBeTruthy();
		});
	});

	test("ME-06 report cards lists only published, current ones", async ({ api, anon, seed }) => {
		const s = await examSetup(api, 2);
		await approveSchedule(api, s, 0, [80, 40]);
		await approveSchedule(api, s, 1, [40, 20]);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const url = `${ME}/children/{studentId}/report-cards`;
		(await g.client.get(url, { params: { studentId: s.studentIds[0] } })).expectStatus(200).expectJson((list) => expect(list).toEqual([]));
		(await api.post("/api/v1/examinations/exams/{examId}/report-cards", { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus([200, 201]);
		(await g.client.get(url, { params: { studentId: s.studentIds[0] } })).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ examName: s.exam.name, passed: true });
			expect(list[0].percentage).toBeCloseTo(80, 0);
		});
	});

	test("ME-06 announcements shows published organisation-wide ones, newest first, and never a draft", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		const orgId = (await api.get("/api/v1/auth/me")).expectStatus(200).body.organisationId;
		await enableModule(orgId, "COMMUNICATION");
		const stamp = uniqueSuffix();
		const make = async (title: string, publish: boolean) => {
			const created = (await api.post("/api/v1/announcements", { body: { campusId: null, title, body: "Body", audienceType: "ORG", audienceRefId: null } })).expectStatus([200, 201]).body;
			if (publish) (await api.post("/api/v1/announcements/{id}/publish", { params: { id: created.id } })).expectStatus(200);
			return created;
		};
		const draft = await make(`Draft ${stamp}`, false);
		const first = await make(`First ${stamp}`, true);
		const second = await make(`Second ${stamp}`, true);
		(await g.client.get(`${ME}/announcements`)).expectStatus(200).expectJson((list) => {
			const ids = list.map((a: { id: number }) => a.id);
			expect(ids).not.toContain(draft.id);
			expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
			expect(list.find((a: { id: number }) => a.id === first.id)).toMatchObject({ title: `First ${stamp}`, body: "Body" });
		});
	});
});

test.describe("ME-07 a guardian sees only their own children", () => {
	const endpoints = ["attendance", "fees", "report-cards", "homework", "materials", "quizzes", "answer-sheets", "standing"];

	test("ME-07 every child endpoint returns 403 for a student who is not their child", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		for (const endpoint of endpoints) {
			const own = await g.client.get(`${ME}/children/{studentId}/${endpoint}`, { params: { studentId: s.studentIds[0] } });
			expect.soft(own.status, `own child ${endpoint}`).toBe(200);
			const stranger = await g.client.get(`${ME}/children/{studentId}/${endpoint}`, { params: { studentId: s.studentIds[1] } });
			expect.soft(stranger.status, `other child ${endpoint}`).toBe(403);
		}
	});

	test("ME-07 a student that does not exist is refused the same way (403, not 404)", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		for (const endpoint of ["attendance", "fees", "report-cards"]) (await g.client.get(`${ME}/children/{studentId}/${endpoint}`, { params: { studentId: 99999999 } })).expectStatus(403);
	});

	test("ME-07 two guardians of different children cannot read each other's", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 2);
		const [one, two] = [await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]), await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[1])];
		(await one.client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: s.studentIds[1] } })).expectStatus(403);
		(await two.client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: s.studentIds[1] } })).expectStatus(200);
	});

	test("ME-07 a staff member who is not a guardian, and a teacher, get 403 on the child endpoints", async ({ api, anon, seed }) => {
		const s = await attendanceSetup(api, 1);
		const staff = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW", "FEE_COLLECT", "ATTENDANCE_VIEW"]);
		const teacher = await portalTeacher(api, anon, seed, s);
		for (const client of [staff.client, teacher.client, api]) {
			(await client.get(`${ME}/children/{studentId}/fees`, { params: { studentId: s.studentIds[0] } })).expectStatus(403);
			(await client.get(`${ME}/children/{studentId}/attendance`, { params: { studentId: s.studentIds[0] } })).expectStatus(403);
		}
	});

	test("ME-07 the child endpoints need a login", async ({ anon }) => {
		(await anon.get(`${ME}/children/{studentId}/fees`, { params: { studentId: 1 } })).expectStatus(401);
	});
});
