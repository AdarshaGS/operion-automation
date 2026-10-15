// A sanity journey is ONE ordered test made of named steps, declared up front as a plan.
// Declaring the plan is what lets the report show "step 9 failed, steps 10-17 never ran"
// instead of just "the test failed" - Playwright itself only knows about steps that started.
//
//   const j = journey(["Auth › sign in", "Setup › classes exist"]);
//   await j.step("Auth › sign in", async () => { ... });
//
// Steps run in order and stop at the first failure (an exception ends the test), because a
// later step usually depends on an earlier one. Use one journey per business flow.

import { test } from "@playwright/test";

export interface Journey {
	step<T>(title: string, body: () => Promise<T>): Promise<T>;
}

export function journey(plan: string[]): Journey {
	const planned = new Set(plan);
	void test.info().attach("journey-plan", { body: JSON.stringify(plan), contentType: "application/json" });
	return {
		step(title, body) {
			if (!planned.has(title)) throw new Error(`Journey step "${title}" is not in the declared plan - add it to journey([...]) so the report can track it.`);
			return test.step(title, body);
		},
	};
}

/** Keeps the final screen up for a moment after a phase's last action so someone watching a
 * --headed run can see where it ended. SANITY_HOLD_MS overrides it (0 to skip, e.g. in CI). */
export async function holdForViewer(page: { waitForTimeout(ms: number): Promise<void> }): Promise<void> {
	const ms = Number(process.env.SANITY_HOLD_MS ?? 3000);
	if (ms > 0) await page.waitForTimeout(ms);
}
