// Auth UI scenarios beyond the basics in login.ui.spec.ts. IDs refer to docs/SCENARIOS.md.
// Uses the sanity `test` (API clients + page objects) because each scenario creates its own
// disposable user through the API, so signing out or changing a password never touches the
// shared owner session the other UI specs rely on.

import { test, expect } from "../../../src/sanity/fixtures";
import { createDisposableUser, inviteStaffMember } from "../../../src/api/users";
import { SESSION_STORAGE_KEY } from "../../../src/config/env";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { backendLogAvailable, loggedToken } from "../../../src/support/backend-log";

const NEW_PASSWORD = "BrandNewPassw0rd!456";

test.describe("landing page after sign-in", () => {
	test("AUTH-U04 an organisation owner lands on the dashboard", async ({ page, loginPage, seed }) => {
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, seed.ownerEmail, seed.ownerPassword);
		await expect(page).toHaveURL(/\/dashboard/);
	});

	test("AUTH-U04 a staff member without organisation settings access lands on students", async ({ page, loginPage, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);
	});
});

test.describe("signing out", () => {
	test("AUTH-U05 sign out clears the session and a protected page cannot be reopened", async ({ page, loginPage, appLayout, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);

		await appLayout.signOut();
		await expect(page).toHaveURL(/\/login/);
		expect(await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull();

		await page.goto("/students");
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
	});

	test("AUTH-U09 an expired or invalid session sends the user back to sign in", async ({ page, loginPage, api, anon, seed }) => {
		// The rejected token produces expected 401 traffic and follow-on console noise; the
		// assertion that matters here is the redirect.
		test.info().annotations.push({ type: "diagnostics-handled" });
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);

		await page.evaluate((key) => {
			const session = JSON.parse(window.localStorage.getItem(key) ?? "{}");
			window.localStorage.setItem(key, JSON.stringify({ ...session, token: "expired.invalid.token" }));
		}, SESSION_STORAGE_KEY);
		await page.reload();
		await expect(page).toHaveURL(/\/login/);
	});
});

test.describe("sign-in form", () => {
	test("AUTH-U10 submitting the empty form stays on the page", async ({ page, loginPage }) => {
		await loginPage.open();
		await loginPage.submitEmpty();
		await expect(page).toHaveURL(/\/login/);
		await expect(loginPage.errorAlert()).toHaveCount(0);
	});

	test("AUTH-U10 pressing Enter submits the form", async ({ page, loginPage, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.loginWithEnterKey(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U10 the password is masked", async ({ loginPage }) => {
		await loginPage.open();
		await expect(loginPage.passwordField()).toHaveAttribute("type", "password");
	});

	test("AUTH-U10 stray spaces around the organisation slug and email are ignored", async ({ page, loginPage, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(` ${seed.organisationSlug} `, ` ${user.email} `, user.password);
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U10 an unknown organisation shows the same error as a wrong password", async ({ loginPage, seed }) => {
		await loginPage.open();
		await loginPage.login("no-such-organisation", seed.ownerEmail, seed.ownerPassword);
		const unknownOrganisation = await loginPage.errorAlert().textContent();
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, seed.ownerEmail, "wrong-password");
		await expect(loginPage.errorAlert()).toHaveText(unknownOrganisation ?? "");
	});
});

test.describe("forgot password", () => {
	test("AUTH-U06 the confirmation is identical for a known and an unknown email", async ({ forgotPassword, seed }) => {
		await forgotPassword.open();
		await forgotPassword.requestReset(seed.organisationSlug, seed.ownerEmail);
		await expect(forgotPassword.confirmation()).toBeVisible();

		await forgotPassword.open();
		await forgotPassword.requestReset(seed.organisationSlug, "nobody-here@example.test");
		await expect(forgotPassword.confirmation()).toBeVisible();
	});

	test("AUTH-U06 the Back to sign in link returns to the login form", async ({ page, forgotPassword }) => {
		await forgotPassword.open();
		await forgotPassword.backToSignIn();
		await expect(page).toHaveURL(/\/login/);
	});

	test("AUTH-U06 the login page links to forgot password", async ({ page, loginPage }) => {
		await loginPage.open();
		await loginPage.goToForgotPassword();
		await expect(page).toHaveURL(/\/forgot-password/);
	});
});

test.describe("reset password", () => {
	test("AUTH-U07 the emailed link prefills the form and a new password signs in", async ({ page, resetPassword, loginPage, api, anon, seed }) => {
		test.skip(!backendLogAvailable(), "needs the backend log (.stack/backend.log) to read the reset token");
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await anon.post("/api/v1/auth/password-reset/request", { body: { organisationSlug: seed.organisationSlug, email: user.email } });
		const token = await loggedToken("reset-password", user.userId);

		await resetPassword.openLink(seed.organisationSlug, token);
		await expect(resetPassword.organisationSlugField()).toHaveValue(seed.organisationSlug);
		await expect(resetPassword.tokenField()).toHaveValue(token);
		await resetPassword.setPassword(NEW_PASSWORD);
		await expect(page).toHaveURL(/\/login/);

		await loginPage.login(seed.organisationSlug, user.email, NEW_PASSWORD);
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U07 mismatched passwords are caught before anything is sent", async ({ page, resetPassword, seed }) => {
		await resetPassword.openLink(seed.organisationSlug, "any-token");
		await resetPassword.setPassword(NEW_PASSWORD, "Different!Passw0rd");
		await expect(resetPassword.errorAlert()).toContainText("Passwords don't match");
		await expect(page).toHaveURL(/\/reset-password/);
	});

	test("AUTH-U07 an invalid token shows an error and stays on the page", async ({ page, resetPassword, seed }) => {
		await resetPassword.openBlank();
		await resetPassword.fillManually(seed.organisationSlug, "not-a-real-token");
		await resetPassword.setPassword(NEW_PASSWORD);
		await expect(resetPassword.errorAlert()).toBeVisible();
		await expect(page).toHaveURL(/\/reset-password/);
	});
});

test.describe("email verification page", () => {
	test("AUTH-U07 a valid link verifies the email", async ({ emailVerify, api, seed }) => {
		test.skip(!backendLogAvailable(), "needs the backend log (.stack/backend.log) to read the verification token");
		const invite = await api.post("/api/v1/users/invite", { body: { email: `verify-ui-${Date.now()}@${seed.organisationSlug}.test`, phone: null } });
		invite.expectStatus(200);
		const token = await loggedToken("verify-email", invite.body.userId);

		await emailVerify.openLink(seed.organisationSlug, token);
		await emailVerify.verify();
		await expect(emailVerify.successAlert()).toBeVisible({ timeout: 15_000 }); // slow when the whole suite runs in parallel
	});

	test("AUTH-U07 an invalid token shows an error", async ({ emailVerify, seed }) => {
		await emailVerify.openLink(seed.organisationSlug, "not-a-real-token");
		await emailVerify.verify();
		await expect(emailVerify.errorAlert()).toBeVisible({ timeout: 15_000 });
	});
});

test.describe("staff invite claim", () => {
	test("AUTH-U08 the invite link creates the account and signs the new member in", async ({ page, claimStaffInvite, api, seed }) => {
		const invite = await inviteStaffMember(api, seed, ["STUDENT_VIEW"]);
		await claimStaffInvite.openLink(seed.organisationSlug, invite.claimToken);
		await claimStaffInvite.setUp(FIXED_PASSWORD);
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U08 mismatched passwords are caught on the claim page", async ({ page, claimStaffInvite, api, seed }) => {
		const invite = await inviteStaffMember(api, seed);
		await claimStaffInvite.openLink(seed.organisationSlug, invite.claimToken);
		await claimStaffInvite.setUp(FIXED_PASSWORD, "Different!Passw0rd");
		await expect(claimStaffInvite.errorAlert()).toContainText("Passwords don't match");
		await expect(page).toHaveURL(/\/claim-staff-invite/);
	});

	test("AUTH-U08 an already-used invite shows an error", async ({ page, claimStaffInvite, anon, api, seed }) => {
		const invite = await inviteStaffMember(api, seed);
		(await anon.post("/api/v1/auth/claim-staff-invite", { body: { organisationSlug: seed.organisationSlug, token: invite.claimToken, password: FIXED_PASSWORD } })).expectStatus(200);
		await claimStaffInvite.openLink(seed.organisationSlug, invite.claimToken);
		await claimStaffInvite.setUp(FIXED_PASSWORD);
		await expect(claimStaffInvite.errorAlert()).toBeVisible();
		await expect(page).toHaveURL(/\/claim-staff-invite/);
	});
});

test.describe("change password from the account menu", () => {
	test("AUTH-U05 a new password is accepted and used on the next sign-in", async ({ page, loginPage, appLayout, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);

		await appLayout.openChangePassword();
		await appLayout.changePassword(user.password, NEW_PASSWORD);
		await expect(appLayout.changePasswordDialog().getByText("Password updated")).toBeVisible();
		// The dialog stays open to show the confirmation; close it before using the account menu behind it.
		await appLayout.changePasswordDialog().getByRole("button", { name: "Close" }).click();
		await expect(appLayout.changePasswordDialog()).toBeHidden();

		await appLayout.signOut();
		await loginPage.login(seed.organisationSlug, user.email, NEW_PASSWORD);
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U05 a wrong current password is reported and nothing changes", async ({ page, loginPage, appLayout, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);

		await appLayout.openChangePassword();
		await appLayout.changePassword("not-my-password", NEW_PASSWORD);
		await expect(appLayout.changePasswordDialog().getByRole("alert")).toContainText("Current password is incorrect");
		// the session survived the 409 (it must not be treated as an expired session)
		await expect(page).toHaveURL(/\/students/);
	});

	test("AUTH-U05 mismatched new passwords are caught in the dialog", async ({ page, loginPage, appLayout, api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		await loginPage.open();
		await loginPage.login(seed.organisationSlug, user.email, user.password);
		await expect(page).toHaveURL(/\/students/);

		await appLayout.openChangePassword();
		await appLayout.changePassword(user.password, NEW_PASSWORD, "Different!Passw0rd");
		await expect(appLayout.changePasswordDialog().getByRole("alert")).toContainText("New passwords don't match");
	});
});
