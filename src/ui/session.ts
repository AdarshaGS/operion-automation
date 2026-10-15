// Signs the browser in as someone other than the project's default storageState user (e.g. the
// owner of a throwaway organisation) without going through the login form, by seeding the same
// localStorage entry the app writes on login. Use with `test.use({ storageState: EMPTY_STORAGE })`
// so the default owner session is not present.

import type { Page } from "@playwright/test";
import { SESSION_STORAGE_KEY } from "../config/env";

export const EMPTY_STORAGE = { cookies: [], origins: [] };

export interface BrowserSession {
	token: string;
	expiresAt: string;
	userId: number;
	organisationId: number;
}

export async function signInWithSession(page: Page, session: BrowserSession): Promise<void> {
	const value = JSON.stringify({ token: session.token, expiresAt: session.expiresAt, userId: session.userId, organisationId: session.organisationId });
	// Only seeds when nothing is stored, so signing out in the test is not undone by a later navigation.
	await page.addInitScript(
		([key, stored]) => {
			if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, stored);
		},
		[SESSION_STORAGE_KEY, value],
	);
}

/** A Playwright storageState holding the given session, for `browser.newContext({ storageState })`. */
export function storageStateFor(session: BrowserSession, origin: string) {
	return {
		cookies: [],
		origins: [{ origin, localStorage: [{ name: SESSION_STORAGE_KEY, value: JSON.stringify({ token: session.token, expiresAt: session.expiresAt, userId: session.userId, organisationId: session.organisationId }) }] }],
	};
}
