import type { Browser, Page } from "@playwright/test";
import { UI_BASE_URL } from "../config/env";
import { storageStateFor, type BrowserSession } from "./session";

/** Runs `run` in a fresh browser context signed in as the owner of a throwaway organisation. */
export async function inThrowawayOrg<T>(browser: Browser, session: BrowserSession, run: (page: Page) => Promise<T>): Promise<T> {
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(session, UI_BASE_URL) });
	const page = await context.newPage();
	try {
		return await run(page);
	} finally {
		await context.close();
	}
}
