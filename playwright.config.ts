import { defineConfig, devices } from "@playwright/test";
import { API_BASE_URL, UI_BASE_URL } from "./src/config/env";
import { storageStatePath } from "./src/setup/session";

// No webServer block: Operion's backend (Java) and frontend are started separately against a
// throwaway database - see README.md. This suite never starts, stops, or resets them.
export default defineConfig({
	testDir: "./tests",
	globalSetup: "./src/setup/global-setup.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// list: terminal. html: per-test traces/screenshots. unified: the single API + UI dashboard.
	reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["./src/reporting/unified-reporter.ts"]],
	// SLOWMO=<ms> pauses between browser actions so a --headed run is watchable. Defaults to 700;
	// use SLOWMO=0 for fast runs (CI, or while writing a spec). API specs never open a browser.
	use: { trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { slowMo: Number(process.env.SLOWMO ?? 700) } },
	projects: [
		// API layer - no browser. Specs: tests/api/<module>/*.api.spec.ts
		{
			name: "api",
			testMatch: "api/**/*.api.spec.ts",
			use: { baseURL: API_BASE_URL },
		},
		// UI layer, logged in as the organisation owner. Specs: tests/ui/<module>/*.ui.spec.ts
		{
			name: "ui",
			testMatch: "ui/**/*.ui.spec.ts",
			testIgnore: "ui/auth/**",
			timeout: 180_000,
			use: { ...devices["Desktop Chrome"], baseURL: UI_BASE_URL, storageState: storageStatePath("owner") },
		},
		// End-to-end sanity journeys: API + browser in one ordered test. Starts logged out and signs in
		// through the real form as step 1. Specs: tests/sanity/NN-<phase>.sanity.spec.ts - phases run
		// one after another in file order (01 business setup, then the next phase builds on it), so
		// run this project with --workers=1 (npm run test:sanity does).
		{
			name: "sanity",
			testMatch: "sanity/**/*.sanity.spec.ts",
			fullyParallel: false,
			// Own artifacts folder: every run empties its outputDir at start, so sharing test-results/
			// with a concurrent api/ui run deleted a sanity trace mid-run.
			outputDir: "test-results/sanity",
			timeout: 600_000,
			use: { ...devices["Desktop Chrome"], baseURL: UI_BASE_URL },
		},
		// UI flows that start logged out (login form, redirects).
		{
			name: "ui-anonymous",
			testMatch: "ui/auth/**/*.ui.spec.ts",
			timeout: 180_000,
			use: { ...devices["Desktop Chrome"], baseURL: UI_BASE_URL },
		},
	],
});
