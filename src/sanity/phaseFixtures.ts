// `test` for the UI-only sanity phases (tests/sanity/NN-*.sanity.spec.ts).
//
// One browser context for the whole run (the sanity project runs with --workers=1): phase 01
// signs the new owner in and every later phase's page inherits that session, so the run tells
// one school's story without logging out and in between phases. Each phase still gets its own
// page; only the signed-in state is shared. Pair with continueAsOwner() in ./session.ts.

import { devices, type BrowserContext } from "@playwright/test";
import { UI_BASE_URL } from "../config/env";
import { test as uiTest, expect } from "../ui/fixtures";
import { EMPTY_STORAGE } from "../ui/session";

export const test = uiTest.extend<object, { sanityContext: BrowserContext }>({
	sanityContext: [
		async ({ browser }, use) => {
			const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
			await use(context);
			// The context outlives every phase, so it is closed only when the worker shuts down - by then Playwright
			// has already removed the worker's .playwright-artifacts-N folder and the final trace flush fails with
			// ENOENT. Every test has finished at that point, so only that error is dropped.
			await context.close().catch((error: Error) => {
				if (!/ENOENT.*\.playwright-artifacts-/.test(error.message)) throw error;
			});
		},
		{ scope: "worker" },
	],
	context: async ({ sanityContext }, use) => {
		await use(sanityContext);
	},
});

export { expect };
