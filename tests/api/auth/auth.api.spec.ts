import { test, expect } from "../../../src/api/fixtures";
import { expectShape } from "../../../src/api/shapes";
import { createDisposableUser } from "../../../src/api/users";

test.describe("POST /api/v1/auth/login", () => {
	test("valid credentials return a session with access and refresh tokens", async ({ anon, seed }) => {
		const res = await anon.post("/api/v1/auth/login", {
			body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: seed.ownerPassword },
		});
		res.expectStatus(200).expectJson((body) =>
			expectShape(body, { token: "string", expiresAt: "string", refreshToken: "string", refreshExpiresAt: "string", userId: "number", organisationId: "number" }),
		);
	});

	test("wrong password is rejected with 401 and no token", async ({ anon, seed }) => {
		const res = await anon.post("/api/v1/auth/login", {
			body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: "definitely-wrong" },
		});
		res.expectStatus(401).expectJson((body) => expect(body.token).toBeUndefined());
	});

	test("unknown organisation gets the same error as a wrong password (no tenant enumeration)", async ({ anon, seed }) => {
		const wrongPassword = await anon.post("/api/v1/auth/login", {
			body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: "definitely-wrong" },
		});
		const unknownOrg = await anon.post("/api/v1/auth/login", {
			body: { organisationSlug: "no-such-org-zzz", email: seed.ownerEmail, password: "definitely-wrong" },
		});
		unknownOrg.expectStatus(401).expectJson((body) => expect(body.error).toBe(wrongPassword.body.error));
	});

	test("an empty body never yields a token", async ({ anon }) => {
		const res = await anon.post("/api/v1/auth/login", { body: {} });
		res.expectStatus([400, 401]).expectJson((body) => expect(body?.token).toBeUndefined());
	});
});

test.describe("GET /api/v1/auth/me", () => {
	test("returns the caller's identity, roles and permissions", async ({ api, seed }) => {
		const res = await api.get("/api/v1/auth/me");
		res.expectStatus(200).expectJson((body) => {
			expectShape(body, { userId: "number", organisationId: "number", email: "string", roleNames: "array", permissions: "array" });
			expect(body.email).toBe(seed.ownerEmail);
			expect(body.roleNames).toContain("Owner");
		});
	});

	test("a role with no permissions authenticates but holds none", async ({ as }) => {
		const res = await as("noPermissions").get("/api/v1/auth/me");
		res.expectStatus(200).expectJson((body) => expect(body.permissions).toEqual([]));
	});

	test("no token is rejected with 401", async ({ anon }) => {
		(await anon.get("/api/v1/auth/me")).expectStatus(401);
	});

	test("a malformed token is rejected with 401", async ({ anon }) => {
		(await anon.get("/api/v1/auth/me", { token: "not-a-jwt" })).expectStatus(401);
	});
});

test.describe("POST /api/v1/auth/refresh", () => {
	test("a valid refresh token yields a new access token", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const res = await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: user.refreshToken } });
		res.expectStatus(200).expectJson((body) => expectShape(body, { token: "string", expiresAt: "string" }));
	});

	test("an unknown refresh token is rejected with 401", async ({ anon, seed }) => {
		(await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: "bogus" } })).expectStatus(401);
	});
});

test.describe("PUT /api/v1/auth/password", () => {
	test("requires authentication", async ({ anon }) => {
		(await anon.put("/api/v1/auth/password", { body: { currentPassword: "a", newPassword: "b" } })).expectStatus(401);
	});

	test("rejects a wrong current password", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await user.client.put("/api/v1/auth/password", { body: { currentPassword: "wrong", newPassword: "NewPassw0rd!123" } })).expectStatus(409);
	});

	test("changes the password: the new one logs in, the old one no longer does", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const newPassword = "NewPassw0rd!456";
		(await user.client.put("/api/v1/auth/password", { body: { currentPassword: user.password, newPassword } })).expectStatus(200);

		const withNew = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: newPassword } });
		withNew.expectStatus(200);
		const withOld = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } });
		withOld.expectStatus(401);
	});

	test("rejects a trivially weak new password", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const res = await user.client.put("/api/v1/auth/password", { body: { currentPassword: user.password, newPassword: "x" } });
		res.expectStatus([400, 409, 422]);
	});
});

test.describe("POST /api/v1/auth/logout", () => {
	test("revokes the session's refresh token", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await user.client.post("/api/v1/auth/logout")).expectStatus([200, 204]);
		const refresh = await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: user.refreshToken } });
		refresh.expectStatus(401);
	});
});

test.describe("POST /api/v1/auth/password-reset/request", () => {
	test("answers identically for known and unknown emails (non-enumerable)", async ({ anon, seed }) => {
		const known = await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail } });
		const unknown = await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: `nobody@${seed.organisationSlug}.test` } });
		known.expectStatus(200);
		unknown.expectStatus(200).expectJson((body) => expect(body).toEqual(known.body));
	});
});

test.describe("single-use token endpoints reject invalid tokens", () => {
	const cases: { endpoint: string; body: (slug: string) => object }[] = [
		{ endpoint: "/api/v1/auth/password-reset/confirm", body: (slug) => ({ organisationSlug: slug, token: "bogus", newPassword: "NewPassw0rd!123" }) },
		{ endpoint: "/api/v1/auth/verify-email", body: () => ({ token: "bogus" }) },
		{ endpoint: "/api/v1/auth/claim-staff-invite", body: (slug) => ({ organisationSlug: slug, token: "bogus", password: "NewPassw0rd!123" }) },
		{ endpoint: "/api/v1/auth/claim-invite", body: (slug) => ({ organisationSlug: slug, token: "bogus", password: "NewPassw0rd!123" }) },
	];
	for (const { endpoint, body } of cases) {
		test(`POST ${endpoint}`, async ({ anon, seed }) => {
			(await anon.post(endpoint, { body: body(seed.organisationSlug) })).expectStatus(401);
		});
	}
});
