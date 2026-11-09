// HR: departments, designations, staff profiles, exits, bank details, documents, leave and the public
// job-application form. IDs refer to docs/SCENARIOS.md section 15 (HR-*). Staff import/export is covered
// in tests/api/imports-exports (section 29), so only the roster export is checked here.

import { test, expect } from "../../../src/api/fixtures";
import { createPerson } from "../../../src/api/academics";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";
import { expectShape } from "../../../src/api/shapes";
import { HR, allocateLeave, balance, createDepartment, createDesignation, createLeaveType, createStaff, raiseLeave, staffWithLeave } from "../../../src/api/hr";

const BAD = 400;
const ids = (list: { id: number }[]) => list.map((x) => x.id);

for (const [label, path, make] of [
	["HR-01 departments", "/api/v1/departments", createDepartment],
	["HR-02 designations", "/api/v1/designations", createDesignation],
] as const) {
	test.describe(label, () => {
		test(`${label}: a new one is ACTIVE and listed`, async ({ api }) => {
			const made = await make(api);
			expect(made.status).toBe("ACTIVE");
			expectShape(made, { id: "number", name: "string", status: "string" });
			(await api.get(path)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(made.id));
		});

		test(`${label}: deactivate and reactivate`, async ({ api }) => {
			const made = await make(api);
			(await api.post(`${path}/{id}/status`, { params: { id: made.id }, body: { status: "INACTIVE" } })).expectStatus(200).expectJson((b) => expect(b.status).toBe("INACTIVE"));
			(await api.post(`${path}/{id}/status`, { params: { id: made.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((b) => expect(b.status).toBe("ACTIVE"));
		});

		test(`${label}: a blank or missing name returns 400`, async ({ api }) => {
			(await api.post(path, { body: { name: " " } })).expectStatus(BAD);
			(await api.post(path, { body: {} })).expectStatus(BAD);
		});

		test(`${label}: an unknown status returns 400 and an unknown id returns 404`, async ({ api }) => {
			const made = await make(api);
			(await api.post(`${path}/{id}/status`, { params: { id: made.id }, body: { status: "RETIRED" } })).expectStatus(BAD);
			(await api.post(`${path}/{id}/status`, { params: { id: 99999999 }, body: { status: "ACTIVE" } })).expectStatus(404);
		});

		test(`${label}: a second one with the same name is rejected`, async ({ api }) => {
			const made = await make(api);
			const res = await api.post(path, { body: { name: made.name } });
			expect(res.status, "a duplicate name is accepted").toBe(409);
		});

		test(`${label}: creating needs ORGANISATION_MANAGE; listing needs only a token`, async ({ as, anon }) => {
			(await as("readOnlyStaff").post(path, { body: { name: `Nope ${uniqueSuffix()}` } })).expectStatus(403);
			(await as("noPermissions").get(path)).expectStatus(200);
			(await anon.get(path)).expectStatus(401);
		});
	});
}

test.describe("HR-03 create a staff profile", () => {
	test("HR-03 a staff profile is ACTIVE with its designation, department and campus, and appears in the roster", async ({ api, seed }) => {
		const designation = await createDesignation(api);
		const department = await createDepartment(api);
		const staff = await createStaff(api, seed.campusId, { designationId: designation.id, departmentId: department.id });
		expect(staff).toMatchObject({ status: "ACTIVE", campusId: seed.campusId, designationId: designation.id, designationName: designation.name, departmentId: department.id, departmentName: department.name, employmentType: "PERMANENT" });
		expectShape(staff, { id: "number", personId: "number", employeeCode: "string", designationId: "number", dateOfJoining: "string", employmentType: "string", status: "string" });
		(await api.get(`${HR}/staff`)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(staff.id));
	});

	test("HR-03 a department and a campus are optional (org-wide staff)", async ({ api }) => {
		const staff = await createStaff(api, null as unknown as number, { departmentId: null });
		expect(staff).toMatchObject({ campusId: null, departmentId: null });
	});

	test("HR-03 a reporting manager is stored", async ({ api, seed }) => {
		const manager = await createStaff(api, seed.campusId);
		const staff = await createStaff(api, seed.campusId, { reportingManagerId: manager.id });
		expect(staff.reportingManagerId).toBe(manager.id);
	});

	for (const type of ["PERMANENT", "CONTRACT", "PART_TIME"]) {
		test(`HR-03 employment type ${type} is accepted`, async ({ api, seed }) => {
			expect((await createStaff(api, seed.campusId, { employmentType: type })).employmentType).toBe(type);
		});
	}

	test("HR-03 an unknown employment type returns 400", async ({ api, seed }) => {
		const personId = await createPerson(api, "Bad");
		const designation = await createDesignation(api);
		(await api.post(`${HR}/staff`, { body: { personId, campusId: seed.campusId, employeeCode: uniqueCode("EMP"), designationId: designation.id, dateOfJoining: "2024-06-01", employmentType: "FREELANCE" } })).expectStatus(BAD);
	});

	test("HR-03 a missing employment type, date of joining or designation returns 400", async ({ api, seed }) => {
		const personId = await createPerson(api, "Missing");
		const designation = await createDesignation(api);
		const full = { personId, campusId: seed.campusId, employeeCode: uniqueCode("EMP"), designationId: designation.id, dateOfJoining: "2024-06-01", employmentType: "PERMANENT" };
		for (const field of ["employmentType", "dateOfJoining", "designationId", "personId", "employeeCode"]) {
			const body: Record<string, unknown> = { ...full, employeeCode: uniqueCode("EMP") };
			delete body[field];
			const res = await api.post(`${HR}/staff`, { body });
			expect(res.status, `without ${field}: ${JSON.stringify(res.body)}`).toBe(BAD);
		}
	});

	test("HR-03 an unknown person, designation, department or campus is a client error", async ({ api, seed }) => {
		const personId = await createPerson(api, "Unknown");
		const designation = await createDesignation(api);
		const base = { personId, campusId: seed.campusId, employeeCode: uniqueCode("EMP"), designationId: designation.id, dateOfJoining: "2024-06-01", employmentType: "PERMANENT" };
		for (const [field, value] of [["personId", 99999999], ["designationId", 99999999], ["departmentId", 99999999], ["campusId", 99999999]] as const) {
			const res = await api.post(`${HR}/staff`, { body: { ...base, employeeCode: uniqueCode("EMP"), [field]: value } });
			expect([400, 404], `${field}: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
		}
	});

	test("HR-03 a duplicate employee code is rejected with 409", async ({ api, seed }) => {
		const first = await createStaff(api, seed.campusId);
		const personId = await createPerson(api, "Dup");
		const designation = await createDesignation(api);
		const res = await api.post(`${HR}/staff`, { body: { personId, campusId: seed.campusId, employeeCode: first.employeeCode, designationId: designation.id, dateOfJoining: "2024-06-01", employmentType: "PERMANENT" } });
		expect(res.status, "a duplicate employee code is accepted").toBe(409);
	});

	test("HR-03 the same person cannot have two staff profiles", async ({ api, seed }) => {
		const first = await createStaff(api, seed.campusId);
		const designation = await createDesignation(api);
		const res = await api.post(`${HR}/staff`, { body: { personId: first.personId, campusId: seed.campusId, employeeCode: uniqueCode("EMP"), designationId: designation.id, dateOfJoining: "2024-06-01", employmentType: "PERMANENT" } });
		expect(res.status, "a second profile for one person is accepted").toBe(409);
	});

	test("HR-03 creating a profile needs HR_STAFF_MANAGE", async ({ as, seed }) => {
		(await as("readOnlyStaff").post(`${HR}/staff`, { body: { personId: seed.studentPersonId, employeeCode: "X", designationId: 1, dateOfJoining: "2024-06-01", employmentType: "PERMANENT" } })).expectStatus(403);
	});
});

test.describe("HR-04 read, list and export", () => {
	test("HR-04 get returns one profile; an unknown id returns 404", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.get(`${HR}/staff/{id}`, { params: { id: staff.id } })).expectStatus(200).expectJson((s) => expect(s).toMatchObject({ id: staff.id, employeeCode: staff.employeeCode }));
		(await api.get(`${HR}/staff/{id}`, { params: { id: 99999999 } })).expectStatus(404);
	});

	test("HR-04 the roster can be filtered by campus", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.get(`${HR}/staff`, { query: { campusId: seed.campusId } })).expectStatus(200).expectJson((list) => {
			expect(ids(list)).toContain(staff.id);
			for (const s of list) expect(s.campusId).toBe(seed.campusId);
		});
	});

	test("HR-04 the export has one row per staff member with names, department and designation", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.get(`${HR}/staff/export`)).expectStatus(200).expectJson((rows) => {
			const row = rows.find((r: { id: number }) => r.id === staff.id);
			expect(row).toMatchObject({ employeeCode: staff.employeeCode, department: staff.departmentName, designation: staff.designationName, employmentType: "PERMANENT", dateOfJoining: "2024-06-01", status: "ACTIVE" });
			expectShape(row, { id: "number", employeeCode: "string", firstName: "string", lastName: "string", department: "string", designation: "string", status: "string" });
		});
	});

	test("HR-04 reading needs HR_VIEW", async ({ as, anon, api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await as("readOnlyStaff").get(`${HR}/staff/{id}`, { params: { id: staff.id } })).expectStatus(200);
		(await as("noPermissions").get(`${HR}/staff`)).expectStatus(403);
		(await as("noPermissions").get(`${HR}/staff/export`)).expectStatus(403);
		(await anon.get(`${HR}/staff`)).expectStatus(401);
	});

	test("HR-04 one organisation cannot read another's staff", async ({ api, request, calls, seed }) => {
		const other = await createOtherOrganisation(request, calls);
		const staff = await createStaff(api, seed.campusId);
		(await other.client.get(`${HR}/staff/{id}`, { params: { id: staff.id } })).expectStatus(404);
		(await other.client.get(`${HR}/staff`)).expectJson((list) => expect(ids(list)).not.toContain(staff.id));
	});
});

test.describe("HR-05 status and transfer", () => {
	test("HR-05 the status can be changed to ON_LEAVE and back; a staff member on leave stays on the roster", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/status`, { params: { id: staff.id }, body: { status: "ON_LEAVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("ON_LEAVE"));
		(await api.get(`${HR}/staff`)).expectJson((list) => expect(ids(list)).toContain(staff.id));
		(await api.post(`${HR}/staff/{id}/status`, { params: { id: staff.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((s) => expect(s.status).toBe("ACTIVE"));
	});

	test("HR-05 an unknown status returns 400 and an unknown staff id 404", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/status`, { params: { id: staff.id }, body: { status: "RETIRED" } })).expectStatus(BAD);
		(await api.post(`${HR}/staff/{id}/status`, { params: { id: staff.id }, body: {} })).expectStatus(BAD);
		(await api.post(`${HR}/staff/{id}/status`, { params: { id: 99999999 }, body: { status: "ACTIVE" } })).expectStatus(404);
	});

	test("HR-05 a transfer moves the profile, closes the old assignment and opens a new one", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const designation = await createDesignation(api);
		const department = await createDepartment(api);
		(await api.get(`${HR}/staff/{id}/assignments`, { params: { id: staff.id } })).expectStatus(200).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ status: "ACTIVE", designationId: staff.designationId, startDate: "2024-06-01", endDate: null });
		});
		(await api.post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { campusId: seed.campusId, departmentId: department.id, designationId: designation.id, effectiveDate: "2026-04-01" } }))
			.expectStatus(200)
			.expectJson((s) => expect(s).toMatchObject({ designationId: designation.id, departmentId: department.id }));
		(await api.get(`${HR}/staff/{id}/assignments`, { params: { id: staff.id } })).expectJson((list) => {
			expect(list).toHaveLength(2);
			expect(list[0]).toMatchObject({ status: "ACTIVE", designationId: designation.id, startDate: "2026-04-01", endDate: null });
			expect(list[1]).toMatchObject({ designationId: staff.designationId, endDate: "2026-04-01" });
			expect(list[1].status).not.toBe("ACTIVE");
		});
	});

	test("HR-05 a transfer to no campus and no department is allowed", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { campusId: null, departmentId: null, designationId: staff.designationId, effectiveDate: "2026-04-01" } }))
			.expectStatus(200)
			.expectJson((s) => expect(s).toMatchObject({ campusId: null, departmentId: null }));
	});

	test("HR-05 a transfer without a designation or an effective date returns 400", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const res1 = await api.post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { campusId: seed.campusId, effectiveDate: "2026-04-01" } });
		expect(res1.status, "no designation").toBe(BAD);
		const res2 = await api.post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { campusId: seed.campusId, designationId: staff.designationId } });
		expect(res2.status, "no effective date").toBe(BAD);
	});

	test("HR-05 a transfer is recorded in the audit log", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { campusId: seed.campusId, departmentId: null, designationId: staff.designationId, effectiveDate: "2026-04-01" } })).expectStatus(200);
		const logs = (await api.get("/api/v1/audit-logs", { query: { entityType: "StaffProfile", entityId: staff.id } })).expectStatus(200).body;
		const list = Array.isArray(logs) ? logs : logs.content;
		expect(JSON.stringify(list)).toContain("TRANSFER");
	});

	test("HR-05 changing status or transferring needs HR_STAFF_MANAGE", async ({ as, api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await as("readOnlyStaff").post(`${HR}/staff/{id}/status`, { params: { id: staff.id }, body: { status: "ON_LEAVE" } })).expectStatus(403);
		(await as("readOnlyStaff").post(`${HR}/staff/{id}/transfer`, { params: { id: staff.id }, body: { designationId: staff.designationId, effectiveDate: "2026-04-01" } })).expectStatus(403);
	});
});

test.describe("HR-06 exits", () => {
	for (const [exitType, status] of [["RESIGNATION", "RESIGNED"], ["RETIREMENT", "RESIGNED"], ["CONTRACT_END", "RESIGNED"], ["TERMINATION", "TERMINATED"]] as const) {
		test(`HR-06 a ${exitType} is recorded, listed, and leaves the profile ${status} and off the roster`, async ({ api, seed }) => {
			const staff = await createStaff(api, seed.campusId);
			(await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType, exitDate: "2026-08-31", reason: "Automation", initiatedBy: null } }))
				.expectStatus(200)
				.expectJson((e) => expect(e).toMatchObject({ staffProfileId: staff.id, exitType, exitDate: "2026-08-31", reason: "Automation" }));
			(await api.get(`${HR}/staff/{id}/exits`, { params: { id: staff.id } })).expectStatus(200).expectJson((list) => expect(list.map((e: { exitType: string }) => e.exitType)).toEqual([exitType]));
			(await api.get(`${HR}/staff/{id}`, { params: { id: staff.id } })).expectJson((s) => expect(s.status).toBe(status));
			(await api.get(`${HR}/staff`)).expectJson((list) => expect(ids(list)).not.toContain(staff.id));
		});
	}

	test("HR-06 an unknown exit type returns 400; a missing exit date returns 400", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "FIRED", exitDate: "2026-08-31" } })).expectStatus(BAD);
		const res = await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "RESIGNATION" } });
		expect(res.status, "an exit with no date").toBe(BAD);
	});

	test("HR-06 an exit date before the date of joining returns 400", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId, { dateOfJoining: "2026-01-01" });
		const res = await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "RESIGNATION", exitDate: "2025-01-01" } });
		expect(res.status, "an exit before joining is accepted").toBe(BAD);
	});

	test("HR-06 a second exit for a staff member who has already left is rejected", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "RESIGNATION", exitDate: "2026-08-31" } })).expectStatus(200);
		const res = await api.post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "TERMINATION", exitDate: "2026-09-30" } });
		expect(res.status, "a second exit is accepted").toBe(409);
	});

	test("HR-06 an unknown staff id returns 404; recording an exit needs HR_STAFF_MANAGE", async ({ api, as, seed }) => {
		(await api.post(`${HR}/staff/{id}/exit`, { params: { id: 99999999 }, body: { exitType: "RESIGNATION", exitDate: "2026-08-31" } })).expectStatus(404);
		const staff = await createStaff(api, seed.campusId);
		(await as("readOnlyStaff").post(`${HR}/staff/{id}/exit`, { params: { id: staff.id }, body: { exitType: "RESIGNATION", exitDate: "2026-08-31" } })).expectStatus(403);
	});
});

test.describe("HR-08 staff documents", () => {
	const doc = (type: string, extra: Record<string, unknown> = {}) => ({ documentType: type, fileReference: `ref-${uniqueSuffix()}`, fileName: "id.pdf", mimeType: "application/pdf", expiryDate: null, ...extra });

	test("HR-08 a document is added PENDING and listed; the expiry date is optional", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const added = (await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("ID_PROOF", { expiryDate: "2030-01-01" }) })).expectStatus(200).body;
		expect(added).toMatchObject({ staffProfileId: staff.id, documentType: "ID_PROOF", verificationStatus: "PENDING", status: "ACTIVE", expiryDate: "2030-01-01" });
		(await api.get(`${HR}/staff/{id}/documents`, { params: { id: staff.id } })).expectStatus(200).expectJson((list) => expect(ids(list)).toEqual([added.id]));
	});

	test("HR-08 uploading the same type again supersedes the earlier document", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const first = (await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("CONTRACT") })).body;
		const second = (await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("CONTRACT") })).body;
		(await api.get(`${HR}/staff/{id}/documents`, { params: { id: staff.id } })).expectJson((list) => expect(ids(list)).toEqual([second.id]));
		expect(first.id).not.toBe(second.id);
	});

	for (const status of ["VERIFIED", "REJECTED"]) {
		test(`HR-08 a document can be marked ${status}`, async ({ api, seed }) => {
			const staff = await createStaff(api, seed.campusId);
			const added = (await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("QUALIFICATION") })).body;
			(await api.post(`${HR}/staff/documents/{documentId}/verify`, { params: { documentId: added.id }, body: { verificationStatus: status, verifiedBy: null } }))
				.expectStatus(200)
				.expectJson((d) => {
					expect(d.verificationStatus).toBe(status);
					expect(d.verifiedAt).toBeTruthy();
				});
		});
	}

	test("HR-08 an unknown verification status returns 400 and an unknown document 404", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const added = (await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("OTHER") })).body;
		(await api.post(`${HR}/staff/documents/{documentId}/verify`, { params: { documentId: added.id }, body: { verificationStatus: "MAYBE" } })).expectStatus(BAD);
		(await api.post(`${HR}/staff/documents/{documentId}/verify`, { params: { documentId: 99999999 }, body: { verificationStatus: "VERIFIED" } })).expectStatus(404);
	});

	test("HR-08 a document without a type or file reference returns 400", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		for (const field of ["documentType", "fileReference", "fileName"]) {
			const body: Record<string, unknown> = doc("ID_PROOF");
			delete body[field];
			const res = await api.post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body });
			expect(res.status, `without ${field}`).toBe(BAD);
		}
	});

	test("HR-08 adding or verifying needs HR_STAFF_MANAGE; listing needs HR_VIEW", async ({ api, as, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await as("readOnlyStaff").post(`${HR}/staff/{id}/documents`, { params: { id: staff.id }, body: doc("ID_PROOF") })).expectStatus(403);
		(await as("readOnlyStaff").get(`${HR}/staff/{id}/documents`, { params: { id: staff.id } })).expectStatus(200);
		(await as("noPermissions").get(`${HR}/staff/{id}/documents`, { params: { id: staff.id } })).expectStatus(403);
	});
});

test.describe("HR-09 bank details", () => {
	const bank = { bankAccountHolderName: "A Teacher", bankAccountNumber: "123456789012", bankName: "Test Bank", bankBranchCode: "TB001", taxIdentifier: "ABCDE1234F" };

	test("HR-09 bank details are saved and read back; saving again updates the one record", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } })).expectStatus(200);
		const first = (await api.post(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id }, body: bank })).expectStatus(200).body;
		expect(first).toMatchObject({ staffProfileId: staff.id, bankName: "Test Bank", bankBranchCode: "TB001", bankAccountHolderName: "A Teacher" });
		const second = (await api.post(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id }, body: { ...bank, bankName: "Other Bank" } })).expectStatus(200).body;
		expect(second.id).toBe(first.id);
		(await api.get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } })).expectJson((b) => expect(b.bankName).toBe("Other Bank"));
	});

	test("HR-09 the account number is masked when read back", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await api.post(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id }, body: bank })).expectStatus(200);
		const read = (await api.get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } })).expectStatus(200).body;
		expect(read.bankAccountNumber, "the full account number is returned").not.toBe(bank.bankAccountNumber);
		expect(read.bankAccountNumber).toMatch(/\*|X|x/);
		expect(read.bankAccountNumber).toMatch(/9012$/);
	});

	test("HR-09 a staff member with no bank details gets an empty answer, not an error", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const res = await api.get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } });
		res.expectStatus(200);
		expect(res.body === "" || res.body === null || res.body === undefined).toBe(true);
	});

	test("HR-09 a bank detail for an unknown staff member returns 404", async ({ api }) => {
		(await api.post(`${HR}/staff/{id}/bank-details`, { params: { id: 99999999 }, body: bank })).expectStatus(404);
	});

	test("HR-09 an account number with letters returns 400", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const res = await api.post(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id }, body: { ...bank, bankAccountNumber: "not-a-number" } });
		expect(res.status, "letters in an account number are accepted").toBe(BAD);
	});

	test("HR-09 bank details need HR_PAYROLL_VIEW, which HR_VIEW alone does not give", async ({ as, api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		(await as("readOnlyStaff").get(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id } })).expectStatus(403);
		(await as("readOnlyStaff").post(`${HR}/staff/{id}/bank-details`, { params: { id: staff.id }, body: bank })).expectStatus(403);
	});
});

test.describe("HR-11 leave types", () => {
	test("HR-11 a leave type is created ACTIVE and listed", async ({ api }) => {
		const type = await createLeaveType(api, { defaultAnnualDays: 8.5 });
		expect(type).toMatchObject({ status: "ACTIVE", defaultAnnualDays: 8.5 });
		expectShape(type, { id: "number", code: "string", name: "string", status: "string" });
		(await api.get(`${HR}/leave-types`)).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(type.id));
	});

	test("HR-11 the default annual days are optional", async ({ api }) => {
		expect((await createLeaveType(api, { defaultAnnualDays: null })).defaultAnnualDays).toBeNull();
	});

	test("HR-11 a missing code or name returns 400; negative default days returns 400", async ({ api }) => {
		for (const body of [{ name: "No code", defaultAnnualDays: 1 }, { code: uniqueCode("LT"), defaultAnnualDays: 1 }, { code: uniqueCode("LT"), name: "Negative", defaultAnnualDays: -3 }]) {
			const res = await api.post(`${HR}/leave-types`, { body });
			expect(res.status, JSON.stringify(body)).toBe(BAD);
		}
	});

	test("HR-11 a duplicate code is rejected with 409", async ({ api }) => {
		const type = await createLeaveType(api);
		const res = await api.post(`${HR}/leave-types`, { body: { code: type.code, name: "Again", defaultAnnualDays: 1 } });
		expect(res.status, "a duplicate leave type code is accepted").toBe(409);
	});

	test("HR-11 creating needs HR_LEAVE_TYPE_MANAGE", async ({ as }) => {
		(await as("readOnlyStaff").post(`${HR}/leave-types`, { body: { code: uniqueCode("LT"), name: "No", defaultAnnualDays: 1 } })).expectStatus(403);
		(await as("readOnlyStaff").get(`${HR}/leave-types`)).expectStatus(200);
	});
});

test.describe("HR-12 leave balance", () => {
	test("HR-12 allocating sets the entitlement; allocating again replaces it", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		expect(await allocateLeave(api, staff.id, type.id, seed.academicYearId, 12)).toMatchObject({ allocatedDays: 12, remainingDays: 12 });
		expect(await allocateLeave(api, staff.id, type.id, seed.academicYearId, 5)).toMatchObject({ allocatedDays: 5, remainingDays: 5 });
		expect(await balance(api, staff.id, type.id, seed.academicYearId)).toMatchObject({ allocatedDays: 5, remainingDays: 5 });
	});

	test("HR-12 with nothing allocated the balance is zero", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		expect(await balance(api, staff.id, type.id, seed.academicYearId)).toMatchObject({ allocatedDays: 0, remainingDays: 0 });
	});

	test("HR-12 reading needs all three of staffProfileId, leaveTypeId and academicYearId", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		for (const missing of ["staffProfileId", "leaveTypeId", "academicYearId"] as const) {
			const query: Record<string, number> = { ...q };
			delete query[missing];
			(await api.get(`${HR}/leave-balances`, { query })).expectStatus(BAD);
		}
	});

	test("HR-12 negative days returns 400; an unknown staff, type or year returns 404", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		const neg = await api.post(`${HR}/leave-balances`, { body: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId, allocatedDays: -1 } });
		expect(neg.status, "negative allocation").toBe(BAD);
		for (const [field, value] of [["staffProfileId", 99999999], ["leaveTypeId", 99999999], ["academicYearId", 99999999]] as const) {
			const body = { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId, allocatedDays: 1, [field]: value };
			(await api.post(`${HR}/leave-balances`, { body })).expectStatus(404);
		}
	});

	test("HR-12 allocating needs HR_LEAVE_MANAGE", async ({ as, api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		(await as("readOnlyStaff").post(`${HR}/leave-balances`, { body: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId, allocatedDays: 1 } })).expectStatus(403);
		(await as("readOnlyStaff").get(`${HR}/leave-balances`, { query: { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId } })).expectStatus(200);
	});
});

test.describe("HR-13 leave requests", () => {
	test("HR-13 a request is raised PENDING and listed by staff and by status", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const request = await raiseLeave(api, q);
		expect(request).toMatchObject({ status: "PENDING", staffProfileId: q.staffProfileId, numberOfDays: 2, startDate: "2026-09-07", endDate: "2026-09-08", reason: "Family event", approvedBy: null });
		expectShape(request, { id: "number", status: "string", numberOfDays: "number", startDate: "string", endDate: "string" });
		(await api.get(`${HR}/leave-requests`, { query: { staffProfileId: q.staffProfileId } })).expectStatus(200).expectJson((list) => expect(ids(list)).toEqual([request.id]));
		(await api.get(`${HR}/leave-requests`, { query: { status: "PENDING" } })).expectJson((list) => expect(ids(list)).toContain(request.id));
		(await api.get(`${HR}/leave-requests`, { query: { staffProfileId: q.staffProfileId, status: "APPROVED" } })).expectJson((list) => expect(list).toEqual([]));
	});

	test("HR-13 approving takes the days off the remaining balance", async ({ api, seed }) => {
		const { staff, type, ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		const request = await raiseLeave(api, q);
		expect((await balance(api, staff.id, type.id, seed.academicYearId)).remainingDays, "a pending request does not use the balance").toBe(10);
		(await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } })).expectStatus(200).expectJson((r) => {
			expect(r.status).toBe("APPROVED");
			expect(r.decidedAt).toBeTruthy();
		});
		expect(await balance(api, staff.id, type.id, seed.academicYearId)).toMatchObject({ allocatedDays: 10, remainingDays: 8 });
	});

	test("HR-13 rejecting or cancelling leaves the balance alone", async ({ api, seed }) => {
		const { staff, type, ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 10);
		const a = await raiseLeave(api, q);
		const b = await raiseLeave(api, q, { startDate: "2026-10-05", endDate: "2026-10-06" });
		(await api.post(`${HR}/leave-requests/{id}/reject`, { params: { id: a.id }, body: { decidedBy: null } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("REJECTED"));
		(await api.post(`${HR}/leave-requests/{id}/cancel`, { params: { id: b.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("CANCELLED"));
		expect((await balance(api, staff.id, type.id, seed.academicYearId)).remainingDays).toBe(10);
	});

	test("HR-13 a decided request cannot be decided or cancelled again", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const request = await raiseLeave(api, q);
		(await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } })).expectStatus(200);
		for (const action of ["approve", "reject"]) {
			const res = await api.post(`${HR}/leave-requests/{id}/${action}`, { params: { id: request.id }, body: { decidedBy: null } });
			expect(res.status, `${action} after approval: ${JSON.stringify(res.body)}`).toBe(409);
		}
		const cancel = await api.post(`${HR}/leave-requests/{id}/cancel`, { params: { id: request.id } });
		expect(cancel.status, "cancel after approval").toBe(409);
	});

	test("HR-13 an unknown request returns 404", async ({ api }) => {
		(await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: 99999999 }, body: { decidedBy: null } })).expectStatus(404);
		(await api.post(`${HR}/leave-requests/{id}/cancel`, { params: { id: 99999999 } })).expectStatus(404);
	});

	test("HR-13 listing with neither staffProfileId nor status returns 400; an unknown status returns 400", async ({ api }) => {
		(await api.get(`${HR}/leave-requests`)).expectStatus(BAD);
		(await api.get(`${HR}/leave-requests`, { query: { status: "MAYBE" } })).expectStatus(BAD);
	});

	test("HR-13 zero or negative days, or an end before the start, returns 400", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		for (const overrides of [{ numberOfDays: 0 }, { numberOfDays: -1 }, { startDate: "2026-09-10", endDate: "2026-09-01" }]) {
			const res = await api.post(`${HR}/leave-requests`, { body: { startDate: "2026-09-07", endDate: "2026-09-08", numberOfDays: 2, ...q, ...overrides } });
			expect(res.status, JSON.stringify(overrides)).toBe(BAD);
		}
	});

	test("HR-13 a request without dates returns 400", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const res = await api.post(`${HR}/leave-requests`, { body: { ...q, numberOfDays: 1 } });
		expect(res.status, "no dates").toBe(BAD);
	});

	test("HR-13 more days than the dates cover returns 400", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const res = await api.post(`${HR}/leave-requests`, { body: { ...q, startDate: "2026-09-07", endDate: "2026-09-08", numberOfDays: 9 } });
		expect(res.status, "9 days for a 2-day range").toBe(BAD);
	});

	test("HR-13 approving marks the staff member's attendance as LEAVE for each covered day", async ({ api, seed }) => {
		const { staff, ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const request = await raiseLeave(api, q, { startDate: "2026-09-07", endDate: "2026-09-08" });
		(await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } })).expectStatus(200);
		const res = await api.get("/api/v1/attendance/staff", { query: { campusId: seed.campusId, date: "2026-09-07" } });
		if (res.status === 200) expect(JSON.stringify(res.body)).toContain(String(staff.personId));
	});

	test("HR-13 raising and deciding need HR_LEAVE_MANAGE; reading needs HR_VIEW", async ({ as, api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		(await as("readOnlyStaff").post(`${HR}/leave-requests`, { body: { ...q, startDate: "2026-09-07", endDate: "2026-09-08", numberOfDays: 2 } })).expectStatus(403);
		const request = await raiseLeave(api, q);
		(await as("readOnlyStaff").post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } })).expectStatus(403);
		(await as("readOnlyStaff").get(`${HR}/leave-requests`, { query: { staffProfileId: q.staffProfileId } })).expectStatus(200);
		(await as("noPermissions").get(`${HR}/leave-requests`, { query: { staffProfileId: q.staffProfileId } })).expectStatus(403);
	});
});

test.describe("HR-14 and HR-15 leave limits", () => {
	test("HR-14 a request for more days than remain cannot be approved, and the balance is unchanged", async ({ api, seed }) => {
		const { staff, type, ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 1);
		const request = await raiseLeave(api, q, { numberOfDays: 2 });
		const res = await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } });
		expect(res.status, JSON.stringify(res.body)).toBe(409);
		expect((await balance(api, staff.id, type.id, seed.academicYearId)).remainingDays).toBe(1);
		(await api.get(`${HR}/leave-requests`, { query: { staffProfileId: staff.id } })).expectJson((list) => expect(list[0].status).toBe("PENDING"));
	});

	test("HR-14 the second approval is refused when the first used the balance", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId, 3);
		const a = await raiseLeave(api, q, { startDate: "2026-09-07", endDate: "2026-09-08", numberOfDays: 2 });
		const b = await raiseLeave(api, q, { startDate: "2026-10-05", endDate: "2026-10-06", numberOfDays: 2 });
		(await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: a.id }, body: { decidedBy: null } })).expectStatus(200);
		const res = await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: b.id }, body: { decidedBy: null } });
		expect(res.status).toBe(409);
	});

	test("HR-14 with no allocation at all a request cannot be approved", async ({ api, seed }) => {
		const staff = await createStaff(api, seed.campusId);
		const type = await createLeaveType(api);
		const request = await raiseLeave(api, { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId });
		const res = await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: null } });
		expect(res.status).toBe(409);
	});

	test("HR-15 a second request overlapping the first for the same person is rejected", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		await raiseLeave(api, q, { startDate: "2026-09-07", endDate: "2026-09-09", numberOfDays: 3 });
		const res = await api.post(`${HR}/leave-requests`, { body: { ...q, startDate: "2026-09-09", endDate: "2026-09-10", numberOfDays: 2, reason: "Overlap" } });
		expect(res.status, "an overlapping request is accepted").toBe(409);
	});

	test("HR-15 after the first is cancelled the same dates can be requested again", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const first = await raiseLeave(api, q);
		(await api.post(`${HR}/leave-requests/{id}/cancel`, { params: { id: first.id } })).expectStatus(200);
		await raiseLeave(api, q);
	});
});

test.describe("HR-16 who may approve", () => {
	test("HR-16 a staff member with leave-manage rights cannot approve their own request", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["HR_VIEW", "HR_LEAVE_MANAGE"]);
		const staff = await createStaff(api, seed.campusId, { personId: manager.personId });
		const type = await createLeaveType(api);
		await allocateLeave(api, staff.id, type.id, seed.academicYearId, 5);
		const request = await raiseLeave(api, { staffProfileId: staff.id, leaveTypeId: type.id, academicYearId: seed.academicYearId });
		const res = await manager.client.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: manager.userId } });
		expect(res.status, "someone approved their own leave").toBe(403);
	});

	test("HR-16 the decision is recorded against the caller, whatever decidedBy the body names", async ({ api, seed }) => {
		const { ids: q } = await staffWithLeave(api, seed.campusId, seed.academicYearId);
		const request = await raiseLeave(api, q);
		const res = (await api.post(`${HR}/leave-requests/{id}/approve`, { params: { id: request.id }, body: { decidedBy: 99999999 } })).expectStatus(200);
		expect(res.body.approvedBy, "the approver is whatever the request body says").not.toBe(99999999);
	});
});

test.describe("HR-17 and HR-18 job applications", () => {
	const apply = (anon: { post: Function }, slug: string, overrides: Record<string, unknown> = {}) =>
		anon.post("/api/v1/job-applications", { body: { organisationSlug: slug, applicantName: "Asha Rao", email: `asha-${uniqueSuffix().toLowerCase()}@example.test`, specialization: "Mathematics", yearsExperience: 4, ...overrides } });

	test("HR-17 anyone can apply with an organisation slug; the application is PENDING", async ({ anon, seed }) => {
		const res = await apply(anon, seed.organisationSlug);
		res.expectStatus([200, 201]);
		expect(res.body).toMatchObject({ applicantName: "Asha Rao", specialization: "Mathematics", yearsExperience: 4, status: "PENDING", decidedBy: null });
		expectShape(res.body, { id: "number", applicantName: "string", email: "string", status: "string", appliedAt: "string" });
	});

	test("HR-17 an unknown organisation slug returns 404", async ({ anon }) => {
		(await apply(anon, "no-such-organisation-slug")).expectStatus(404);
	});

	test("HR-17 a missing name or a malformed email returns 400", async ({ anon, seed }) => {
		for (const overrides of [{ applicantName: "" }, { applicantName: null }, { email: "not-an-email" }, { email: null }, { yearsExperience: -2 }]) {
			const res = await apply(anon, seed.organisationSlug, overrides);
			expect(res.status, JSON.stringify(overrides)).toBe(BAD);
		}
	});

	test("HR-17 the same email applying twice is rejected", async ({ anon, seed }) => {
		const email = `dup-${uniqueSuffix().toLowerCase()}@example.test`;
		(await apply(anon, seed.organisationSlug, { email })).expectStatus([200, 201]);
		const again = await apply(anon, seed.organisationSlug, { email });
		expect(again.status, "a second application from the same email is accepted").toBe(409);
	});

	test("HR-17 applications are listed for HR_RECRUITMENT_MANAGE and can be filtered by status", async ({ api, anon, seed }) => {
		const made = (await apply(anon, seed.organisationSlug)).body;
		(await api.get("/api/v1/job-applications")).expectStatus(200).expectJson((list) => expect(ids(list)).toContain(made.id));
		(await api.get("/api/v1/job-applications", { query: { status: "PENDING" } })).expectJson((list) => expect(ids(list)).toContain(made.id));
		(await api.get("/api/v1/job-applications", { query: { status: "APPROVED" } })).expectJson((list) => expect(ids(list)).not.toContain(made.id));
		(await api.get("/api/v1/job-applications", { query: { status: "MAYBE" } })).expectStatus(BAD);
	});

	test("HR-17 approve and reject record the decider and time; a decided application cannot be decided again", async ({ api, anon, seed }) => {
		const a = (await apply(anon, seed.organisationSlug)).body;
		const b = (await apply(anon, seed.organisationSlug)).body;
		(await api.post("/api/v1/job-applications/{id}/approve", { params: { id: a.id } })).expectStatus(200).expectJson((r) => {
			expect(r.status).toBe("APPROVED");
			expect(r.decidedBy).not.toBeNull();
			expect(r.decidedAt).toBeTruthy();
		});
		(await api.post("/api/v1/job-applications/{id}/reject", { params: { id: b.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("REJECTED"));
		const again = await api.post("/api/v1/job-applications/{id}/reject", { params: { id: a.id } });
		expect(again.status).toBe(409);
		(await api.post("/api/v1/job-applications/{id}/approve", { params: { id: 99999999 } })).expectStatus(404);
	});

	// Hiring is opt-in: a staff profile needs a designation, join date and employee code that the application itself
	// does not carry, so approving with no body only records the decision (see the test above).
	test("HR-17 approving an application with hire details creates a staff profile for the applicant", async ({ api, anon, seed }) => {
		const email = `hire-${uniqueSuffix().toLowerCase()}@example.test`;
		const made = (await apply(anon, seed.organisationSlug, { email })).body;
		const designation = await createDesignation(api);
		const employeeCode = uniqueCode("EMP");
		(await api.post("/api/v1/job-applications/{id}/approve", {
			params: { id: made.id },
			body: { designationId: designation.id, employmentType: "PERMANENT", dateOfJoining: "2024-06-01", employeeCode, campusId: seed.campusId },
		})).expectStatus(200).expectJson((r) => expect(r.status).toBe("APPROVED"));
		const export_ = (await api.get(`${HR}/staff/export`)).body as { email: string; employeeCode: string }[];
		expect(export_.find((s) => s.email === email)?.employeeCode, "no staff profile exists for the approved applicant").toBe(employeeCode);
	});

	test("HR-17 hire details missing a required field are rejected and leave the application pending", async ({ api, anon, seed }) => {
		const made = (await apply(anon, seed.organisationSlug)).body;
		(await api.post("/api/v1/job-applications/{id}/approve", { params: { id: made.id }, body: { employmentType: "PERMANENT" } })).expectStatus(400);
		const pending = (await api.get("/api/v1/job-applications", { query: { status: "PENDING" } })).body as { id: number }[];
		expect(pending.map((a) => a.id)).toContain(made.id);
	});

	test("HR-17 deciding or listing applications needs HR_RECRUITMENT_MANAGE", async ({ as, anon, seed }) => {
		const made = (await apply(anon, seed.organisationSlug)).body;
		(await as("readOnlyStaff").get("/api/v1/job-applications")).expectStatus(403);
		(await as("readOnlyStaff").post("/api/v1/job-applications/{id}/approve", { params: { id: made.id } })).expectStatus(403);
		(await anon.get("/api/v1/job-applications")).expectStatus(401);
	});

	test("HR-18 the public subject list needs organisationSlug and returns only id and name", async ({ anon, api, seed }) => {
		const subject = (await api.post("/api/v1/subjects", { body: { name: `Subj ${uniqueSuffix()}`, code: uniqueCode("S") } })).expectStatus([200, 201]).body;
		(await anon.get("/api/v1/job-applications/subjects", { query: { organisationSlug: seed.organisationSlug } })).expectStatus(200).expectJson((list) => {
			const found = list.find((s: { id: number }) => s.id === subject.id);
			expect(Object.keys(found).sort()).toEqual(["id", "name"]);
		});
		(await anon.get("/api/v1/job-applications/subjects")).expectStatus(BAD);
		(await anon.get("/api/v1/job-applications/subjects", { query: { organisationSlug: "no-such-organisation-slug" } })).expectStatus(404);
	});
});
