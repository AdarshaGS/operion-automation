// Organisation onboarding: creation, profile, settings, status, school template, go-live.
// IDs refer to docs/SCENARIOS.md section 2. Anything that mutates organisation-wide settings
// runs against a throwaway second organisation so the shared fixture organisation stays intact.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { expectShape } from "../../../src/api/shapes";
import { uniqueSuffix } from "../../../src/api/data";
import { FIXED_PASSWORD } from "../../../src/setup/roles";

function newOrganisationBody(overrides: Record<string, unknown> = {}) {
	const id = uniqueSuffix().toLowerCase();
	return {
		name: `Org ${id}`,
		legalName: `Org ${id} Pvt Ltd`,
		slug: `org-${id}`,
		adminEmail: `owner@org-${id}.test`,
		adminPassword: FIXED_PASSWORD,
		adminFirstName: "New",
		adminLastName: "Owner",
		...overrides,
	};
}

test.describe("POST /api/v1/organisations", () => {
	test("ORG-01 creates a trial organisation whose owner can sign in", async ({ anon }) => {
		const body = newOrganisationBody();
		const created = await anon.post("/api/v1/organisations", { body });
		created.expectStatus([200, 201]).expectJson((org) => {
			expectShape(org, { id: "number", name: "string", slug: "string", status: "string", createdAt: "string" });
			expect(org.slug).toBe(body.slug);
			expect(org.status).toBe("TRIAL");
			expect(new Date(org.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
		});
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: body.slug, email: body.adminEmail, password: body.adminPassword } })).expectStatus(200);
	});

	test("ORG-04 the new owner holds the Owner role and a working permission set", async ({ anon }) => {
		const body = newOrganisationBody();
		(await anon.post("/api/v1/organisations", { body })).expectStatus([200, 201]);
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: body.slug, email: body.adminEmail, password: body.adminPassword } });
		const me = await anon.withToken(login.body.token, "new-owner").get("/api/v1/auth/me");
		me.expectStatus(200).expectJson((profile) => {
			expect(profile.roleNames).toContain("Owner");
			expect(profile.permissions.length).toBeGreaterThan(0);
			expect(profile.firstName).toBe("New");
		});
	});

	test("ORG-01 a new organisation starts with a campus and its optional details stored", async ({ anon }) => {
		const body = newOrganisationBody({
			organisationType: "GROUP_OF_SCHOOLS",
			board: "CBSE",
			schoolCode: "SC-001",
			city: "Pune",
			state: "MH",
			country: "India",
			pincode: "411001",
			primaryContactName: "Principal",
			primaryContactEmail: "principal@example.test",
			timezone: "Asia/Kolkata",
			academicYearName: "2026-27",
			academicYearStartDate: "2026-06-01",
			academicYearEndDate: "2027-03-31",
		});
		const created = await anon.post("/api/v1/organisations", { body });
		created.expectStatus([200, 201]).expectJson((org) => {
			expect(org.organisationType).toBe("GROUP_OF_SCHOOLS");
			expect(org.board).toBe("CBSE");
			expect(org.schoolCode).toBe("SC-001");
		});
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: body.slug, email: body.adminEmail, password: body.adminPassword } });
		const owner = anon.withToken(login.body.token, "new-owner");
		(await owner.get("/api/v1/campuses")).expectStatus(200).expectJson((campuses) => expect(campuses.length).toBeGreaterThanOrEqual(1));
		(await owner.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => {
			expect(profile.city).toBe("Pune");
			expect(profile.pincode).toBe("411001");
			expect(profile.primaryContactEmail).toBe("principal@example.test");
		});
		(await owner.get("/api/v1/academic-years")).expectStatus(200).expectJson((years) => {
			expect(years.map((year: { name: string }) => year.name)).toContain("2026-27");
		});
	});

	test("ORG-02 a duplicate slug is rejected with 409", async ({ anon }) => {
		const body = newOrganisationBody();
		(await anon.post("/api/v1/organisations", { body })).expectStatus([200, 201]);
		const again = { ...body, adminEmail: `second@${body.slug}.test` };
		(await anon.post("/api/v1/organisations", { body: again })).expectStatus(409);
	});

	test("ORG-02 the same admin email may own organisations in different tenants", async ({ anon }) => {
		const first = newOrganisationBody();
		const second = newOrganisationBody({ adminEmail: first.adminEmail });
		(await anon.post("/api/v1/organisations", { body: first })).expectStatus([200, 201]);
		(await anon.post("/api/v1/organisations", { body: second })).expectStatus([200, 201]);
	});

	for (const [field, bad] of [
		["organisationType", "UNIVERSITY"],
		["board", "NOT_A_BOARD"],
	] as const) {
		test(`ORG-03 an invalid ${field} is a client error, not a 500`, async ({ anon }) => {
			(await anon.post("/api/v1/organisations", { body: newOrganisationBody({ [field]: bad }) })).expectStatus(400);
		});
	}

	for (const field of ["name", "slug", "adminEmail", "adminPassword"]) {
		test(`ORG-03 a missing ${field} returns 400 (not a misleading 409)`, async ({ anon }) => {
			const body: Record<string, unknown> = newOrganisationBody();
			delete body[field];
			(await anon.post("/api/v1/organisations", { body })).expectStatus(400);
		});
	}

	test("ORG-03 an empty body returns 400", async ({ anon }) => {
		(await anon.post("/api/v1/organisations", { body: {} })).expectStatus(400);
	});

	test("ORG-03 a slug with spaces or capitals is rejected", async ({ anon }) => {
		(await anon.post("/api/v1/organisations", { body: newOrganisationBody({ slug: "Not A Valid Slug" }) })).expectStatus(400);
	});

	test("ORG-03 a weak admin password is rejected", async ({ anon }) => {
		(await anon.post("/api/v1/organisations", { body: newOrganisationBody({ adminPassword: "x" }) })).expectStatus(400);
	});

	test("ORG-03 an invalid admin email is rejected", async ({ anon }) => {
		(await anon.post("/api/v1/organisations", { body: newOrganisationBody({ adminEmail: "not-an-email" }) })).expectStatus(400);
	});
});

test.describe("organisation profile", () => {
	test("ORG-05 returns the profile of the caller's organisation", async ({ api }) => {
		(await api.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => {
			expectShape(profile, { name: "string", legalName: "nullable", logoUrl: "nullable", city: "nullable", taxIdentifier: "nullable" });
		});
	});

	test("ORG-05 an update is stored and read back", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const update = {
			name: "Renamed School",
			legalName: "Renamed School Trust",
			logoUrl: null,
			primaryContactName: "Asha Rao",
			primaryContactEmail: "asha@example.test",
			primaryContactPhone: "+911234567890",
			addressLine1: "1 Main Road",
			addressLine2: "Near Park",
			city: "Chennai",
			state: "TN",
			country: "India",
			pincode: "600001",
			taxIdentifier: "GSTIN123",
		};
		(await org.client.patch("/api/v1/organisations/profile", { body: update })).expectStatus(200);
		(await org.client.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => expect(profile).toEqual(update));
	});

	test("ORG-05 a blank organisation name is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/profile", { body: { name: "" } })).expectStatus(400);
	});

	test("ORG-05 an invalid contact email is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/profile", { body: { name: "Valid Name", primaryContactEmail: "nope" } })).expectStatus(400);
	});

	test("ORG-05 a partial update leaves the fields it does not mention unchanged", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const before = await org.client.get("/api/v1/organisations/profile");
		(await org.client.patch("/api/v1/organisations/profile", { body: { name: "Only The Name Changed" } })).expectStatus(200);
		(await org.client.get("/api/v1/organisations/profile")).expectStatus(200).expectJson((profile) => {
			expect(profile.name).toBe("Only The Name Changed");
			expect(profile.legalName).toBe(before.body.legalName);
		});
	});

	test("ORG-11 changing the profile needs ORGANISATION_MANAGE", async ({ as }) => {
		const body = { name: "Hijacked" };
		(await as("readOnlyStaff").patch("/api/v1/organisations/profile", { body })).expectStatus(403);
		(await as("noPermissions").patch("/api/v1/organisations/profile", { body })).expectStatus(403);
	});

	test("ORG-11 any signed-in member may read the profile", async ({ as }) => {
		(await as("noPermissions").get("/api/v1/organisations/profile")).expectStatus(200);
	});
});

test.describe("organisation settings", () => {
	test("ORG-06 returns timezone, currency, date format and working days", async ({ api }) => {
		(await api.get("/api/v1/organisations/settings")).expectStatus(200).expectJson((settings) => {
			expectShape(settings, { timezone: "string", defaultCurrency: "string", dateFormat: "string", workingDaysMask: "number", logoUrl: "nullable", primaryColor: "nullable" });
		});
	});

	test("ORG-06 an update is stored and read back", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const update = { timezone: "Asia/Dubai", defaultCurrency: "AED", dateFormat: "yyyy-MM-dd", workingDaysMask: 31, logoUrl: null, primaryColor: "#112233" };
		(await org.client.patch("/api/v1/organisations/settings", { body: update })).expectStatus(200);
		(await org.client.get("/api/v1/organisations/settings")).expectStatus(200).expectJson((settings) => expect(settings).toEqual(update));
	});

	test("ORG-06 an unknown timezone is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const body = { timezone: "Not/AZone", defaultCurrency: "INR", dateFormat: "dd-MM-yyyy", workingDaysMask: 63 };
		(await org.client.patch("/api/v1/organisations/settings", { body })).expectStatus(400);
	});

	for (const mask of [0, 128, -1]) {
		test(`ORG-06 working-days mask ${mask} is rejected`, async ({ request, calls }) => {
			const org = await createOtherOrganisation(request, calls);
			const body = { timezone: "Asia/Kolkata", defaultCurrency: "INR", dateFormat: "dd-MM-yyyy", workingDaysMask: mask };
			(await org.client.patch("/api/v1/organisations/settings", { body })).expectStatus(400);
		});
	}

	test("ORG-06 an invalid primary colour is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const body = { timezone: "Asia/Kolkata", defaultCurrency: "INR", dateFormat: "dd-MM-yyyy", workingDaysMask: 63, primaryColor: "not-a-colour" };
		(await org.client.patch("/api/v1/organisations/settings", { body })).expectStatus(400);
	});

	test("ORG-11 changing settings needs ORGANISATION_MANAGE", async ({ as }) => {
		const body = { timezone: "Asia/Kolkata", defaultCurrency: "INR", dateFormat: "dd-MM-yyyy", workingDaysMask: 63 };
		(await as("readOnlyStaff").patch("/api/v1/organisations/settings", { body })).expectStatus(403);
	});

	test("ORG-06 the timezone lookup lists IANA names", async ({ api }) => {
		(await api.get("/api/v1/timezones")).expectStatus(200).expectJson((zones) => {
			expect(zones.map((zone: { name: string }) => zone.name)).toContain("Asia/Kolkata");
			for (const zone of zones.slice(0, 5)) expectShape(zone, { id: "number", name: "string", region: "string" });
		});
	});
});

test.describe("organisation status", () => {
	test("ORG-07 a suspended organisation cannot sign in", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/{id}/status", { params: { id: org.id }, body: { status: "SUSPENDED" } })).expectStatus(200).expectJson((body) => expect(body.status).toBe("SUSPENDED"));
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: org.slug, email: org.ownerEmail, password: org.ownerPassword } })).expectStatus(401);
	});

	test("ORG-07 an archived organisation cannot sign in", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/{id}/status", { params: { id: org.id }, body: { status: "ARCHIVED" } })).expectStatus(200);
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: org.slug, email: org.ownerEmail, password: org.ownerPassword } })).expectStatus(401);
	});

	test("ORG-07 an organisation can be moved to ACTIVE", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/{id}/status", { params: { id: org.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((body) => expect(body.status).toBe("ACTIVE"));
	});

	test("ORG-07 an unknown status value is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/{id}/status", { params: { id: org.id }, body: { status: "EXPLODED" } })).expectStatus(400);
	});

	test("ORG-07 a missing status is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.patch("/api/v1/organisations/{id}/status", { params: { id: org.id }, body: {} })).expectStatus(400);
	});

	test("ORG-07 an organisation owner cannot change another organisation's status", async ({ request, calls }) => {
		// Both organisations are throwaway: if the platform lets this through, nothing shared is harmed.
		const attacker = await createOtherOrganisation(request, calls);
		const target = await createOtherOrganisation(request, calls);
		(await attacker.client.patch("/api/v1/organisations/{id}/status", { params: { id: target.id }, body: { status: "SUSPENDED" } })).expectStatus([403, 404]);
		const intact = await target.client.get("/api/v1/organisations/profile");
		intact.expectStatus(200);
	});

	test("ORG-11 changing status needs ORGANISATION_MANAGE", async ({ as, api }) => {
		const mine = await api.get("/api/v1/auth/me");
		(await as("readOnlyStaff").patch("/api/v1/organisations/{id}/status", { params: { id: mine.body.organisationId }, body: { status: "SUSPENDED" } })).expectStatus(403);
	});
});

test.describe("school setup template", () => {
	test("ORG-08 the preview lists what applying would create", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/organisations/settings/school-template/preview")).expectStatus(200).expectJson((preview) => {
			expectShape(preview, { grades: "array", departments: "array", designations: "array", roles: "array", feeCategories: "array", itemCategories: "array", items: "array" });
			expect(preview.grades.length).toBeGreaterThan(0);
			expect(preview.grades.every((grade: { alreadyExists: boolean }) => grade.alreadyExists === false)).toBe(true);
		});
	});

	test("ORG-08 applying creates grades, departments and designations", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const applied = await org.client.post("/api/v1/organisations/settings/school-template/apply");
		applied.expectStatus(200).expectJson((result) => {
			expect(result.gradesCreated.length).toBeGreaterThan(0);
			expect(result.departmentsCreated.length).toBeGreaterThan(0);
			expect(result.designationsCreated.length).toBeGreaterThan(0);
		});
		(await org.client.get("/api/v1/grade-levels")).expectStatus(200).expectJson((grades) => {
			const names = grades.map((grade: { name: string }) => grade.name);
			for (const created of applied.body.gradesCreated) expect(names).toContain(created);
		});
		(await org.client.get("/api/v1/departments")).expectStatus(200).expectJson((departments) => {
			expect(departments.map((department: { name: string }) => department.name)).toEqual(expect.arrayContaining(applied.body.departmentsCreated));
		});
	});

	test("ORG-08 applying twice adds nothing the second time", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const first = await org.client.post("/api/v1/organisations/settings/school-template/apply");
		first.expectStatus(200);
		const second = await org.client.post("/api/v1/organisations/settings/school-template/apply");
		second.expectStatus(200).expectJson((result) => {
			expect(result.gradesCreated).toEqual([]);
			expect(result.departmentsCreated).toEqual([]);
			expect(result.designationsCreated).toEqual([]);
			expect(result.gradesSkipped).toEqual(first.body.gradesCreated);
		});
	});

	test("ORG-08 after applying, the preview marks everything as already existing", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		(await org.client.get("/api/v1/organisations/settings/school-template/preview")).expectStatus(200).expectJson((preview) => {
			expect(preview.grades.every((grade: { alreadyExists: boolean }) => grade.alreadyExists)).toBe(true);
		});
	});

	test("ORG-08 applying needs ORGANISATION_MANAGE", async ({ as }) => {
		(await as("readOnlyStaff").post("/api/v1/organisations/settings/school-template/apply")).expectStatus(403);
	});

	test("ORG-08 applying never touches another organisation", async ({ api, request, calls }) => {
		const grades = await api.get("/api/v1/grade-levels");
		const before = grades.body.length;
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		(await api.get("/api/v1/grade-levels")).expectStatus(200).expectJson((after) => expect(after.length).toBe(before));
	});

	test("ORG-10 needs lists the starter-pack questions", async ({ api }) => {
		(await api.get("/api/v1/organisations/settings/school-template/needs")).expectStatus(200).expectJson((needs) => {
			expect(typeof needs.canSelectModules).toBe("boolean");
			expect(needs.questions.length).toBeGreaterThan(0);
			for (const question of needs.questions) expectShape(question, { key: "string", label: "string", defaultYes: "boolean" });
		});
	});

	test("ORG-13 recommend turns answers into a module selection with locked core modules", async ({ api }) => {
		const answers = { FEES: true, EXAMS: false };
		(await api.post("/api/v1/organisations/settings/school-template/recommend", { body: { answers } })).expectStatus(200).expectJson((result) => {
			const byCode = new Map<string, { enabled: boolean; locked: boolean }>(result.modules.map((module: { code: string; enabled: boolean; locked: boolean }) => [module.code, module]));
			for (const core of ["DASHBOARD", "STUDENTS", "ACADEMICS", "ATTENDANCE"]) {
				expect(byCode.get(core), `${core} is core`).toMatchObject({ enabled: true, locked: true });
			}
			expect(byCode.get("FEES")?.enabled).toBe(true);
		});
	});

	test("ORG-13 recommend with no answers falls back to the defaults", async ({ api }) => {
		(await api.post("/api/v1/organisations/settings/school-template/recommend", { body: { answers: {} } })).expectStatus(200).expectJson((result) => {
			expect(result.modules.length).toBeGreaterThan(0);
		});
	});
});

test.describe("school template items", () => {
	test("ORG-09 lists the items of a category", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "GRADE" } })).expectStatus(200).expectJson((items) => {
			expect(items.length).toBeGreaterThan(0);
			for (const item of items) {
				expectShape(item, { id: "number", category: "string", name: "string", included: "boolean" });
				expect(item.category).toBe("GRADE");
			}
		});
	});

	test("ORG-09 an unknown category is a client error", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "NOT_A_CATEGORY" } })).expectStatus(400);
	});

	test("ORG-09 a custom item is created, edited, applied and deleted", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const name = `Custom Grade ${uniqueSuffix()}`;
		const created = await org.client.post("/api/v1/organisations/settings/school-template/items/{category}", {
			params: { category: "GRADE" },
			body: { name, sequenceOrder: 99, stage: "Primary" },
		});
		created.expectStatus([200, 201]).expectJson((item) => expect(item).toMatchObject({ name, included: true, category: "GRADE" }));

		const renamed = `${name} Renamed`;
		(await org.client.put("/api/v1/organisations/settings/school-template/items/{id}", { params: { id: created.body.id }, body: { name: renamed, sequenceOrder: 99, stage: "Primary" } }))
			.expectStatus(200)
			.expectJson((item) => expect(item.name).toBe(renamed));

		(await org.client.post("/api/v1/organisations/settings/school-template/apply")).expectStatus(200).expectJson((result) => expect(result.gradesCreated).toContain(renamed));

		(await org.client.delete("/api/v1/organisations/settings/school-template/items/{id}", { params: { id: created.body.id } })).expectStatus([200, 204]);
		(await org.client.get("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "GRADE" } })).expectStatus(200).expectJson((items) => {
			expect(items.map((item: { id: number }) => item.id)).not.toContain(created.body.id);
		});
	});

	test("ORG-09 an item switched off is skipped when the template is applied", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const items = await org.client.get("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "DEPARTMENT" } });
		const target = items.body[0];
		(await org.client.put("/api/v1/organisations/settings/school-template/items/{id}/included", { params: { id: target.id }, body: { included: false } })).expectStatus(200).expectJson((item) => expect(item.included).toBe(false));
		(await org.client.post("/api/v1/organisations/settings/school-template/apply")).expectStatus(200).expectJson((result) => {
			expect(result.departmentsCreated).not.toContain(target.name);
		});
	});

	test("ORG-09 a whole category can be switched off at once", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put("/api/v1/organisations/settings/school-template/items/category/{category}/included", { params: { category: "DESIGNATION" }, body: { included: false } }))
			.expectStatus(200)
			.expectJson((items) => expect(items.every((item: { included: boolean }) => item.included === false)).toBe(true));
		(await org.client.post("/api/v1/organisations/settings/school-template/apply")).expectStatus(200).expectJson((result) => expect(result.designationsCreated).toEqual([]));
	});

	test("ORG-09 an item without a name is rejected", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.post("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "GRADE" }, body: {} })).expectStatus(400);
	});

	test("ORG-09 unknown item ids return 404", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.put("/api/v1/organisations/settings/school-template/items/{id}", { params: { id: 999999999 }, body: { name: "x" } })).expectStatus(404);
		(await org.client.delete("/api/v1/organisations/settings/school-template/items/{id}", { params: { id: 999999999 } })).expectStatus(404);
	});

	test("ORG-11 editing the template needs ORGANISATION_MANAGE", async ({ as }) => {
		(await as("readOnlyStaff").post("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "GRADE" }, body: { name: "Nope" } })).expectStatus(403);
	});

	test("ORG-09 template items belong to one organisation", async ({ request, calls }) => {
		const first = await createOtherOrganisation(request, calls);
		const second = await createOtherOrganisation(request, calls);
		const item = await first.client.post("/api/v1/organisations/settings/school-template/items/{category}", { params: { category: "GRADE" }, body: { name: `Private ${uniqueSuffix()}` } });
		item.expectStatus([200, 201]);
		(await second.client.delete("/api/v1/organisations/settings/school-template/items/{id}", { params: { id: item.body.id } })).expectStatus(404);
	});
});

test.describe("go-live check", () => {
	test("ORG-14 reports readiness per module group", async ({ api }) => {
		(await api.get("/api/v1/organisations/settings/go-live")).expectStatus(200).expectJson((report) => {
			expect(typeof report.ready).toBe("boolean");
			expect(report.groups.length).toBeGreaterThan(0);
			expect(report.groups.map((group: { code: string }) => group.code)).toContain("ORGANISATION");
			for (const group of report.groups) {
				expectShape(group, { code: "string", label: "string", level: "string", hasChecks: "boolean", findings: "array" });
				expect(["PASS", "WARN", "FAIL"]).toContain(group.level);
			}
		});
	});

	test("ORG-14 a brand-new organisation is not ready to go live", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get("/api/v1/organisations/settings/go-live")).expectStatus(200).expectJson((report) => {
			expect(report.ready).toBe(false);
			const failing = report.groups.flatMap((group: { findings: { level: string; fixPath: string | null }[] }) => group.findings).filter((finding: { level: string }) => finding.level === "FAIL");
			expect(failing.length).toBeGreaterThan(0);
			for (const finding of failing) expect(finding.fixPath, "every blocking finding says where to fix it").toBeTruthy();
		});
	});

	test("ORG-14 applying the template reduces the blocking findings", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const failing = (report: { groups: { findings: { level: string }[] }[] }) => report.groups.flatMap((group) => group.findings).filter((finding) => finding.level === "FAIL").length;
		const before = await org.client.get("/api/v1/organisations/settings/go-live");
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const after = await org.client.get("/api/v1/organisations/settings/go-live");
		expect(failing(after.body)).toBeLessThan(failing(before.body));
	});

	test("ORG-14 the go-live check needs ORGANISATION_MANAGE", async ({ as }) => {
		(await as("readOnlyStaff").get("/api/v1/organisations/settings/go-live")).expectStatus(403);
	});
});
