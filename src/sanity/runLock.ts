// One sanity run at a time. The phases hand one business along through .auth/sanity-business.json, and
// every `playwright test` run empties test-results/sanity before globalSetup even starts. A second run
// started while one is in progress therefore deletes the first run's traces mid-test (ENOENT on context
// close) and then plays its own phases 02-15 against the first run's business ("already exists"
// failures everywhere). The check runs from playwright.config.ts because that is the only code that
// runs before Playwright empties the output folder.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR } from "../config/env";

const LOCK_FILE = join(AUTH_DIR, "sanity-run.lock");

interface LockOwner {
	pid: number;
	startedAt: string;
	command: string;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** True when this `playwright test` invocation includes the sanity project: no --project at all (every
 * project runs), or a --project value that names it. */
function runsSanity(args: string[]): boolean {
	const projects: string[] = [];
	args.forEach((arg, i) => {
		if (arg.startsWith("--project=")) projects.push(arg.slice("--project=".length));
		else if (arg === "--project" && args[i + 1]) projects.push(args[i + 1]);
	});
	return projects.length === 0 || projects.some((p) => p.includes("sanity") || p.includes("*"));
}

/** Called from playwright.config.ts. Fails the run straight away if another live run holds the lock;
 * otherwise takes it until this process exits. A lock left by a killed run (dead pid) is taken over. */
export function claimSanityRunLock(): void {
	const args = process.argv.slice(2);
	// Workers re-load the config; only the runner's own `playwright test` claims the lock. Listing, the
	// report server and the VS Code test server are not covered.
	if (process.env.TEST_WORKER_INDEX !== undefined || args[0] !== "test" || !runsSanity(args)) return;

	if (existsSync(LOCK_FILE)) {
		let owner: LockOwner | undefined;
		try {
			owner = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as LockOwner;
		} catch {
			owner = undefined;
		}
		if (owner && owner.pid !== process.pid && isAlive(owner.pid)) {
			throw new Error(
				`Another sanity run is in progress (pid ${owner.pid}, started ${owner.startedAt}: ${owner.command}).\n` +
					"Two runs share .auth/sanity-business.json and test-results/sanity, so starting this one would break that run. " +
					`Wait for it to finish, or stop it (kill ${owner.pid}) and run again.`,
			);
		}
	}

	mkdirSync(AUTH_DIR, { recursive: true });
	const self: LockOwner = { pid: process.pid, startedAt: new Date().toISOString(), command: `playwright ${args.join(" ")}` };
	writeFileSync(LOCK_FILE, JSON.stringify(self, null, 2));
	process.once("exit", () => {
		try {
			const current = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as LockOwner;
			if (current.pid === process.pid) rmSync(LOCK_FILE, { force: true });
		} catch {
			// Already gone - nothing to release.
		}
	});
}
