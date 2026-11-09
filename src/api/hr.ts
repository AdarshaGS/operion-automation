// HR fixtures: departments, designations, staff profiles and leave. Staff need a person (which needs a
// gender) and a designation; leave needs a staff profile, a leave type and an academic year.

import type { ApiClient } from "./apiClient";
import { createPerson } from "./academics";
import { uniqueCode, uniqueSuffix } from "./data";

export const HR = "/api/v1/hr";

export interface Staff {
	id: number;
	personId: number;
	campusId: number | null;
	employeeCode: string;
	designationId: number;
	designationName: string;
	departmentId: number | null;
	departmentName: string | null;
	reportingManagerId: number | null;
	dateOfJoining: string;
	employmentType: string;
	status: string;
}

export interface LeaveRequest {
	id: number;
	staffProfileId: number;
	leaveTypeId: number;
	academicYearId: number;
	startDate: string;
	endDate: string;
	numberOfDays: number;
	reason: string | null;
	status: string;
	approvedBy: number | null;
	decidedAt: string | null;
}

export async function createDepartment(api: ApiClient, name = `Dept ${uniqueSuffix()}`) {
	const res = await api.post("/api/v1/departments", { body: { name } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; name: string; status: string };
}

export async function createDesignation(api: ApiClient, name = `Role ${uniqueSuffix()}`) {
	const res = await api.post("/api/v1/designations", { body: { name } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; name: string; status: string };
}

/** A staff profile with its own new person, designation and (unless `departmentId: null`) department. */
export async function createStaff(api: ApiClient, campusId: number, overrides: Record<string, unknown> = {}): Promise<Staff> {
	const personId = (overrides.personId as number | undefined) ?? (await createPerson(api, "Staff", { dateOfBirth: "1988-05-05" }));
	const designationId = (overrides.designationId as number | undefined) ?? (await createDesignation(api)).id;
	const departmentId = "departmentId" in overrides ? overrides.departmentId : (await createDepartment(api)).id;
	const res = await api.post(`${HR}/staff`, {
		body: { campusId, employeeCode: uniqueCode("EMP"), dateOfJoining: "2024-06-01", employmentType: "PERMANENT", reportingManagerId: null, ...overrides, personId, designationId, departmentId },
	});
	res.expectStatus([200, 201]);
	return res.body as Staff;
}

export async function createLeaveType(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${HR}/leave-types`, { body: { code: uniqueCode("LT"), name: `Leave ${uniqueSuffix()}`, defaultAnnualDays: 12, ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as { id: number; code: string; name: string; defaultAnnualDays: number; status: string };
}

export async function allocateLeave(api: ApiClient, staffProfileId: number, leaveTypeId: number, academicYearId: number, allocatedDays: number) {
	const res = await api.post(`${HR}/leave-balances`, { body: { staffProfileId, leaveTypeId, academicYearId, allocatedDays } });
	res.expectStatus([200, 201]);
	return res.body as { allocatedDays: number; remainingDays: number };
}

export async function raiseLeave(api: ApiClient, input: { staffProfileId: number; leaveTypeId: number; academicYearId: number }, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${HR}/leave-requests`, { body: { startDate: "2026-09-07", endDate: "2026-09-08", numberOfDays: 2, reason: "Family event", ...input, ...overrides } });
	res.expectStatus([200, 201]);
	return res.body as LeaveRequest;
}

export async function balance(api: ApiClient, staffProfileId: number, leaveTypeId: number, academicYearId: number) {
	const res = await api.get(`${HR}/leave-balances`, { query: { staffProfileId, leaveTypeId, academicYearId } });
	res.expectStatus(200);
	return res.body as { allocatedDays: number; remainingDays: number };
}

/** A staff member with a leave type and `days` allocated for the seeded academic year. */
export async function staffWithLeave(api: ApiClient, campusId: number, academicYearId: number, days = 10) {
	const staff = await createStaff(api, campusId);
	const type = await createLeaveType(api);
	await allocateLeave(api, staff.id, type.id, academicYearId, days);
	return { staff, type, ids: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId } };
}
