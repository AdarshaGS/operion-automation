// The `test` every spec under tests/api/ imports instead of @playwright/test's.
//
//   api      - owner (bypass-all) client: the default actor for happy paths and setup calls
//   anon     - no Authorization header (401 checks, public endpoints)
//   as(role) - client authenticated as a role fixture seeded by src/setup/global-setup.ts
//   seed     - ids global-setup created (campus, year, class, section, student, enrollment)
//
// All clients in one test share a single call log, attached at teardown as `api-calls`;
// the unified reporter turns that into the per-endpoint results.

import { test as base } from "@playwright/test";
import { knownDefect } from "../known-defects";
import { loadSeed, tokenFor, type SeedData } from "../setup/session";
import type { RoleName } from "../setup/roles";
import { ApiClient, type RecordedCall } from "./apiClient";

interface ApiFixtures {
	calls: RecordedCall[];
	api: ApiClient;
	anon: ApiClient;
	as: (role: RoleName) => ApiClient;
	seed: SeedData;
	knownDefect: void;
}

export const test = base.extend<ApiFixtures>({
	calls: async ({}, use, testInfo) => {
		const calls: RecordedCall[] = [];
		await use(calls);
		await testInfo.attach("api-calls", { body: JSON.stringify(calls), contentType: "application/json" });
	},
	api: async ({ request, calls }, use) => use(new ApiClient(request, calls, "owner", tokenFor("owner"))),
	anon: async ({ request, calls }, use) => use(new ApiClient(request, calls, "anonymous")),
	as: async ({ request, calls }, use) => use((role) => new ApiClient(request, calls, role, tokenFor(role))),
	seed: async ({}, use) => use(loadSeed()),
	knownDefect: [
		async ({}, use, testInfo) => {
			const defect = knownDefect(testInfo.title);
			if (defect) {
				testInfo.fail(true, defect);
				testInfo.annotations.push({ type: "known-defect", description: defect });
			}
			await use();
		},
		{ auto: true },
	],
});

export { expect } from "@playwright/test";
