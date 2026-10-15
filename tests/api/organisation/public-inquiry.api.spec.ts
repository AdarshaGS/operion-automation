// Public admission-inquiry form (no sign-in). IDs refer to docs/SCENARIOS.md section 2 (PUB-*).
// The endpoint allows 10 submissions per hour per client address and organisation slug, so each
// test uses its own throwaway organisation: re-running the suite never exhausts a shared window.

import { test, expect } from "../../../src/api/fixtures";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { uniqueSuffix } from "../../../src/api/data";

function inquiry(overrides: Record<string, unknown> = {}) {
	const suffix = uniqueSuffix();
	return {
		firstName: "Asha",
		lastName: `Inquiry${suffix}`,
		dateOfBirth: "2018-05-10",
		gender: "FEMALE",
		desiredGradeId: null,
		guardianName: "Ravi Parent",
		guardianPhone: "+919876543210",
		guardianEmail: "parent@example.test",
		notes: "Interested in the next intake",
		...overrides,
	};
}

const PUBLIC = "/api/v1/public/orgs/{slug}/admission-inquiries";

test.describe("GET form-options", () => {
	test("PUB-01 loads without a token and names the organisation and its classes", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		(await anon.get(`${PUBLIC}/form-options`, { params: { slug: org.slug } })).expectStatus(200).expectJson((options) => {
			expect(options.organisationName).toContain("Other Org");
			expect(options.grades.length).toBeGreaterThan(0);
			for (const grade of options.grades) expect(grade).toEqual({ id: expect.any(Number), name: expect.any(String) });
		});
	});

	test("PUB-04 an unknown organisation returns 404 and reveals nothing", async ({ anon }) => {
		(await anon.get(`${PUBLIC}/form-options`, { params: { slug: "no-such-school" } })).expectStatus(404).expectJson((body) => {
			expect(JSON.stringify(body)).not.toMatch(/exception|stack|org\.|com\./i);
		});
	});

	test("PUB-01 only active classes are offered", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const grades = await org.client.get("/api/v1/grade-levels");
		const hidden = grades.body[0];
		(await org.client.post("/api/v1/grade-levels/{id}/status", { params: { id: hidden.id }, body: { status: "INACTIVE" } })).expectStatus(200);
		(await anon.get(`${PUBLIC}/form-options`, { params: { slug: org.slug } })).expectStatus(200).expectJson((options) => {
			expect(options.grades.map((grade: { id: number }) => grade.id)).not.toContain(hidden.id);
		});
	});
});

test.describe("POST an inquiry", () => {
	test("PUB-02 a valid inquiry is accepted and reaches the applicants pipeline", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const body = inquiry();
		const submitted = await anon.post(PUBLIC, { params: { slug: org.slug }, body });
		submitted.expectStatus([200, 201]).expectJson((result) => expect(result.id).toEqual(expect.any(Number)));

		const applicants = await org.client.get("/api/v1/applicants");
		applicants.expectStatus(200).expectJson((list) => {
			const rows = Array.isArray(list) ? list : list.content;
			expect(JSON.stringify(rows)).toContain(body.lastName);
		});
	});

	test("PUB-02 an inquiry lands in the organisation named in the link, not another", async ({ anon, request, calls }) => {
		const target = await createOtherOrganisation(request, calls);
		const bystander = await createOtherOrganisation(request, calls);
		const body = inquiry();
		(await anon.post(PUBLIC, { params: { slug: target.slug }, body })).expectStatus([200, 201]);
		(await bystander.client.get("/api/v1/applicants")).expectStatus(200).expectJson((list) => {
			expect(JSON.stringify(list)).not.toContain(body.lastName);
		});
	});

	test("PUB-02 an inquiry may name the class applied for", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.post("/api/v1/organisations/settings/school-template/apply");
		const options = await anon.get(`${PUBLIC}/form-options`, { params: { slug: org.slug } });
		(await anon.post(PUBLIC, { params: { slug: org.slug }, body: inquiry({ desiredGradeId: options.body.grades[0].id }) })).expectStatus([200, 201]);
	});

	for (const [title, overrides] of [
		["a missing date of birth", { dateOfBirth: null }],
		["a date of birth in the future", { dateOfBirth: "2999-01-01" }],
		["a blank first name", { firstName: " " }],
		["a blank last name", { lastName: "" }],
		["a blank guardian name", { guardianName: "" }],
		["a blank guardian phone", { guardianPhone: "" }],
		["an invalid guardian email", { guardianEmail: "not-an-email" }],
		["a 3000 character note", { notes: "x".repeat(3000) }],
		["a 200 character first name", { firstName: "y".repeat(200) }],
	] as const) {
		test(`PUB-03 ${title} returns 400`, async ({ anon, request, calls }) => {
			const org = await createOtherOrganisation(request, calls);
			(await anon.post(PUBLIC, { params: { slug: org.slug }, body: inquiry(overrides) })).expectStatus(400);
		});
	}

	test("PUB-04 an inquiry to an unknown organisation returns 404", async ({ anon }) => {
		(await anon.post(PUBLIC, { params: { slug: "no-such-school" }, body: inquiry() })).expectStatus(404);
	});

	test("PUB-05 a filled honeypot field looks successful but stores nothing", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const body = inquiry({ website: "http://spam.example" });
		(await anon.post(PUBLIC, { params: { slug: org.slug }, body })).expectStatus([200, 201]);
		(await org.client.get("/api/v1/applicants")).expectStatus(200).expectJson((list) => {
			expect(JSON.stringify(list)).not.toContain(body.lastName);
		});
	});

	test("PUB-05 the eleventh inquiry within the window is throttled with 429", async ({ anon, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		for (let n = 0; n < 10; n++) (await anon.post(PUBLIC, { params: { slug: org.slug }, body: inquiry() })).expectStatus([200, 201]);
		(await anon.post(PUBLIC, { params: { slug: org.slug }, body: inquiry() })).expectStatus(429);
	});

	test("PUB-05 the throttle is per organisation, not global", async ({ anon, request, calls }) => {
		const busy = await createOtherOrganisation(request, calls);
		const quiet = await createOtherOrganisation(request, calls);
		for (let n = 0; n < 10; n++) await anon.post(PUBLIC, { params: { slug: busy.slug }, body: inquiry() });
		(await anon.post(PUBLIC, { params: { slug: quiet.slug }, body: inquiry() })).expectStatus([200, 201]);
	});
});
