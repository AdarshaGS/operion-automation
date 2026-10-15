// `test` for tests/sanity/: everything a journey needs in one place - recording API clients
// (api / anon / as(role)), instrumented page objects, and the browser watchdog.
//
// The API client talks to the backend through its own request context so it isn't tied to
// the browser project's baseURL (which points at the frontend).

import { mergeTests } from "@playwright/test";
import { API_BASE_URL } from "../config/env";
import { test as apiTest } from "../api/fixtures";
import { test as uiTest, expect } from "../ui/fixtures";

export const test = mergeTests(apiTest, uiTest).extend({
	request: async ({ playwright }, use) => {
		const context = await playwright.request.newContext({ baseURL: API_BASE_URL });
		await use(context);
		await context.dispose();
	},
});

export { expect };
