// Auth scenarios beyond the basics in auth.api.spec.ts: the token-driven flows (reset, verify,
// invites), lockout, account state, and tenant isolation. IDs refer to docs/SCENARIOS.md.
//
// Reset and verification tokens are only logged by the backend (no mail server), so those
// specs read them from the backend log - see src/support/backend-log.ts.

import { test, expect } from "../../../src/api/fixtures";
import { createDisposableUser } from "../../../src/api/users";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { uniqueSuffix } from "../../../src/api/data";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { backendLogAvailable, loggedToken } from "../../../src/support/backend-log";

const NEW_PASSWORD = "BrandNewPassw0rd!456";
const CLIENT_ERRORS = [400, 401, 403, 404, 409];

function jwtClaims(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
}

test.describe("password reset flow", () => {
	test.skip(!backendLogAvailable(), "needs the backend log (.stack/backend.log) to read the reset token");

	test("AUTH-16 confirm with a valid token sets a new password; the old one stops working", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: user.email } })).expectStatus(200);
		const token = await loggedToken("reset-password", user.userId);

		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: seed.organisationSlug, token, newPassword: NEW_PASSWORD } })).expectStatus(200);

		const withNew = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: NEW_PASSWORD } });
		withNew.expectStatus(200).expectJson((body) => expect(body.token).toBeTruthy());
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } })).expectStatus(401);
	});

	test("AUTH-17 a reset token works once: reusing it is rejected", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: user.email } });
		const token = await loggedToken("reset-password", user.userId);

		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: seed.organisationSlug, token, newPassword: NEW_PASSWORD } })).expectStatus(200);
		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: seed.organisationSlug, token, newPassword: "AnotherPassw0rd!789" } })).expectStatus(401);
	});

	test("AUTH-17 a reset token for one organisation is rejected under another organisation's slug", async ({ api, anon, seed, request, calls }) => {
		const user = await createDisposableUser(api, anon, seed);
		await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: user.email } });
		const token = await loggedToken("reset-password", user.userId);

		const other = await createOtherOrganisation(request, calls);
		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: other.slug, token, newPassword: NEW_PASSWORD } })).expectStatus(401);
	});

	test("AUTH-17 a weak new password is rejected and the token stays usable", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: user.email } });
		const token = await loggedToken("reset-password", user.userId);

		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: seed.organisationSlug, token, newPassword: "short" } })).expectStatus(400);
		(await anon.post("/api/v1/auth/password-reset/confirm", { body: { organisationSlug: seed.organisationSlug, token, newPassword: NEW_PASSWORD } })).expectStatus(200);
	});
});

test.describe("email verification", () => {
	test.skip(!backendLogAvailable(), "needs the backend log (.stack/backend.log) to read the verification token");

	test("AUTH-18 a valid token verifies the email, then cannot be reused (AUTH-19)", async ({ api, anon, seed }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `verify-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const token = await loggedToken("verify-email", invite.body.userId);

		(await anon.post("/api/v1/auth/verify-email", { body: { organisationSlug: seed.organisationSlug, token } })).expectStatus(200);
		(await anon.post("/api/v1/auth/verify-email", { body: { organisationSlug: seed.organisationSlug, token } })).expectStatus(401);
	});

	test("AUTH-19 a token is rejected under a different organisation's slug", async ({ api, anon, seed, request, calls }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `verify-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const token = await loggedToken("verify-email", invite.body.userId);

		const other = await createOtherOrganisation(request, calls);
		(await anon.post("/api/v1/auth/verify-email", { body: { organisationSlug: other.slug, token } })).expectStatus(401);
	});
});

test.describe("staff and guardian invites", () => {
	test("AUTH-20 claiming a staff invite sets the password and returns a working session", async ({ api, anon, seed }) => {
		const email = `claim-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`;
		const invite = await api.post("/api/v1/users/invite", { body: { email, phone: null } });
		invite.expectStatus(200).expectJson((body) => expect(body.claimToken).toBeTruthy());

		const claim = await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: FIXED_PASSWORD } });
		claim.expectStatus(200).expectJson((body) => {
			expect(body.token).toBeTruthy();
			expect(body.refreshToken).toBeTruthy();
		});
	});

	test("AUTH-20 an invite can be claimed only once", async ({ api, anon, seed }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `once-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const body = { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: FIXED_PASSWORD };
		(await anon.post("/api/v1/auth/claim-staff-invite", { body })).expectStatus(200);
		(await anon.post("/api/v1/auth/claim-staff-invite", { body })).expectStatus(CLIENT_ERRORS);
	});

	test("AUTH-20 claiming with a weak password is rejected", async ({ api, anon, seed }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `weak-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		(await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: "x" } })).expectStatus(400);
	});

	test("AUTH-22 resending an invite makes the old token unusable and the new one valid", async ({ api, anon, seed }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `resend-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const resent = await api.post("/api/v1/users/{id}/resend-invite", { params: { id: invite.body.userId } });
		resent.expectStatus(200);
		expect(resent.body.claimToken).not.toEqual(invite.body.claimToken);

		(await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: FIXED_PASSWORD } })).expectStatus(401);
		(await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: seed.organisationSlug, token: resent.body.claimToken, password: FIXED_PASSWORD } })).expectStatus(200);
	});

	test("AUTH-22 an invite token is rejected under a different organisation's slug", async ({ api, anon, seed, request, calls }) => {
		const invite = await api.post("/api/v1/users/invite", { body: { email: `xorg-${uniqueSuffix().toLowerCase()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const other = await createOtherOrganisation(request, calls);
		(await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: other.slug, token: invite.body.claimToken, password: FIXED_PASSWORD } })).expectStatus(401);
	});

	test("AUTH-21 a guardian portal invite is claimed once and yields portal access", async ({ api, anon, seed }) => {
		const suffix = uniqueSuffix();
		const person = await api.post("/api/v1/persons", { body: { firstName: "Guardian", lastName: suffix, email: `guardian-${suffix.toLowerCase()}@${seed.organisationSlug}.test` } });
		person.expectStatus([200, 201]);
		const guardian = await api.post("/api/v1/guardians", { body: { personId: person.body.id } });
		guardian.expectStatus([200, 201]);
		const invite = await api.post("/api/v1/guardians/{guardianId}/grant-portal-access", { params: { guardianId: guardian.body.id } });
		invite.expectStatus([200, 201]).expectJson((body) => expect(body.claimToken).toBeTruthy());

		const body = { organisationSlug: seed.organisationSlug, token: invite.body.claimToken, password: FIXED_PASSWORD };
		const claim = await anon.post("/api/v1/auth/claim-invite", { body });
		claim.expectStatus(200);
		const me = await api.withToken(claim.body.token, "guardian").get("/api/v1/auth/me");
		me.expectStatus(200).expectJson((profile) => expect(profile.permissions).toContain("PARENT_PORTAL_ACCESS"));

		(await anon.post("/api/v1/auth/claim-invite", { body })).expectStatus(CLIENT_ERRORS);
	});
});

test.describe("lockout", () => {
	const wrong = (user: { email: string }, slug: string) => ({ organisationSlug: slug, email: user.email, password: "definitely-wrong" });

	test("AUTH-23 repeated failed logins lock the account, even for the right password", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		for (let attempt = 0; attempt < 6; attempt++) {
			(await anon.post("/api/v1/auth/login", { body: wrong(user, seed.organisationSlug) })).expectStatus(401);
		}
		const locked = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } });
		locked.expectStatus(401);
	});

	test("AUTH-23 lockout is indistinguishable from a wrong password (no account enumeration)", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		for (let attempt = 0; attempt < 6; attempt++) await anon.post("/api/v1/auth/login", { body: wrong(user, seed.organisationSlug) });
		const locked = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } });
		const unknown = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: `ghost-${uniqueSuffix().toLowerCase()}@x.test`, password: "whatever" } });
		expect(locked.body).toEqual(unknown.body);
	});

	test("AUTH-23 lockout is per account: another user can still sign in", async ({ api, anon, seed }) => {
		const victim = await createDisposableUser(api, anon, seed);
		const bystander = await createDisposableUser(api, anon, seed);
		for (let attempt = 0; attempt < 6; attempt++) await anon.post("/api/v1/auth/login", { body: wrong(victim, seed.organisationSlug) });
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: bystander.email, password: bystander.password } })).expectStatus(200);
	});

	test("AUTH-24 a successful login resets the failed-attempt counter", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		const good = { organisationSlug: seed.organisationSlug, email: user.email, password: user.password };
		for (let attempt = 0; attempt < 4; attempt++) await anon.post("/api/v1/auth/login", { body: wrong(user, seed.organisationSlug) });
		(await anon.post("/api/v1/auth/login", { body: good })).expectStatus(200);
		for (let attempt = 0; attempt < 4; attempt++) await anon.post("/api/v1/auth/login", { body: wrong(user, seed.organisationSlug) });
		(await anon.post("/api/v1/auth/login", { body: good })).expectStatus(200);
	});
});

test.describe("account state", () => {
	test("AUTH-25 a revoked membership blocks login", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: user.membershipId } })).expectStatus(200);
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } })).expectStatus(401);
	});

	test("AUTH-25 a revoked membership also kills the refresh token", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: user.membershipId } })).expectStatus(200);
		(await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: user.refreshToken } })).expectStatus(401);
	});

	test("AUTH-25 a revoked membership removes access for an already-issued access token", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await user.client.get("/api/v1/students")).expectStatus(200);
		(await api.post("/api/v1/memberships/{id}/revoke", { params: { id: user.membershipId } })).expectStatus(200);
		(await user.client.get("/api/v1/students")).expectStatus([401, 403]);
	});

	test("AUTH-26 a disabled user cannot log in", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } })).expectStatus(200);
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } })).expectStatus(401);
	});

	test("AUTH-26 a disabled user cannot refresh their session", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } })).expectStatus(200);
		(await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: user.refreshToken } })).expectStatus(401);
	});

	test("AUTH-26 a disabled user's already-issued access token stops working", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await user.client.get("/api/v1/students")).expectStatus(200);
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } })).expectStatus(200);
		(await user.client.get("/api/v1/students")).expectStatus([401, 403]);
	});

	test("AUTH-26 re-activating a disabled user lets them sign in again", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed);
		await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "DISABLED" } });
		(await api.post("/api/v1/users/{id}/status", { params: { id: user.userId }, body: { status: "ACTIVE" } })).expectStatus(200);
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } })).expectStatus(200);
	});
});

test.describe("tenant isolation of sessions", () => {
	test("AUTH-27 an organisation's token cannot read another organisation's records", async ({ api, seed, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		// The seeded student's person lives in the main organisation only.
		(await other.client.get("/api/v1/persons/{id}", { params: { id: seed.studentPersonId } })).expectStatus(404);
		(await other.client.get("/api/v1/students/{studentId}", { params: { studentId: seed.studentId } })).expectStatus(404);
		const list = await other.client.get("/api/v1/persons");
		list.expectStatus(200).expectJson((body) => {
			const rows = Array.isArray(body) ? body : body.content;
			expect(rows.map((row: { id: number }) => row.id)).not.toContain(seed.studentPersonId);
		});
		// ...and the main organisation never sees the other one's owner.
		const mine = await api.get("/api/v1/users");
		mine.expectStatus(200).expectJson((body) => expect(JSON.stringify(body)).not.toContain(other.ownerEmail));
	});

	test("AUTH-27 a refresh token is bound to its organisation", async ({ anon, seed, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: seed.ownerPassword } });
		login.expectStatus(200);
		(await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: other.slug, refreshToken: login.body.refreshToken } })).expectStatus(401);
	});

	test("AUTH-27 an email from one organisation cannot sign in to another", async ({ anon, seed, request, calls }) => {
		const other = await createOtherOrganisation(request, calls);
		(await anon.post("/api/v1/auth/login", { body: { organisationSlug: other.slug, email: seed.ownerEmail, password: seed.ownerPassword } })).expectStatus(401);
	});
});

test.describe("token contents", () => {
	test("AUTH-28 the access token and login response carry no password or secret material", async ({ anon, seed }) => {
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: seed.ownerPassword } });
		login.expectStatus(200).expectJson((body) => {
			const sensitive = /password|hash|secret/i;
			expect(Object.keys(body).filter((key) => sensitive.test(key))).toEqual([]);
			expect(Object.keys(jwtClaims(body.token)).filter((key) => sensitive.test(key))).toEqual([]);
			expect(JSON.stringify(body)).not.toContain(seed.ownerPassword);
		});
	});

	test("AUTH-28 the access token has a finite expiry", async ({ anon, seed }) => {
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: seed.ownerPassword } });
		login.expectStatus(200).expectJson((body) => {
			const claims = jwtClaims(body.token);
			expect(typeof claims.exp).toBe("number");
			expect(Number(claims.exp) * 1000).toBeGreaterThan(Date.now());
			expect(Number(claims.exp) * 1000).toBeLessThan(Date.now() + 24 * 3600 * 1000);
		});
	});

	test("AUTH-28 a token with a tampered signature is rejected", async ({ anon, seed }) => {
		const login = await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: seed.ownerEmail, password: seed.ownerPassword } });
		const parts = (login.body.token as string).split(".");
		const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -3)}${parts[2].endsWith("AAA") ? "BBB" : "AAA"}`;
		(await anon.get("/api/v1/auth/me", { token: tampered })).expectStatus(401);
	});
});
