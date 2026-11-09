import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { ApiClient } from "../api/apiClient";
import { UI_BASE_URL } from "../config/env";
import { FIXED_PASSWORD } from "../setup/roles";
import { storageStateFor } from "./session";

/** Logs `email` into `organisationSlug` through the API and opens a browser already signed in as them. */
export async function signedInAs(browser: Browser, anon: ApiClient, organisationSlug: string, email: string, password = FIXED_PASSWORD): Promise<{ page: Page; context: BrowserContext }> {
	const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug, email, password } })).expectStatus(200);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
	return { page: await context.newPage(), context };
}
