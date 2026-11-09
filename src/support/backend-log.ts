// Operion has no mail server in the disposable stack: password-reset and email-verification
// tokens are only written to the backend log as "the email that would be sent". These helpers
// read that log, so specs can drive the real flow end to end.
//
// Needs the log of the backend under test: scripts/stack-up.sh writes .stack/backend.log, or
// point OPERION_BACKEND_LOG at another file. When it is absent the callers skip, not fail.
// .stack/backend.log belongs to the default stack (:8091) only: when OPERION_API_URL points at any other
// backend, a stale file left by an earlier default-stack run must not be mistaken for that backend's log, so
// the log counts as absent until OPERION_BACKEND_LOG names the right one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API_BASE_URL } from "../config/env";

const DEFAULT_STACK_LOG = join(process.cwd(), ".stack", "backend.log");
const DEFAULT_STACK_URL = "http://localhost:8091";

export const BACKEND_LOG = process.env.OPERION_BACKEND_LOG
	?? (API_BASE_URL === DEFAULT_STACK_URL ? DEFAULT_STACK_LOG : join(process.cwd(), ".stack", "no-log-for-this-backend"));

export type LoggedLinkKind = "reset-password" | "verify-email";

export function backendLogAvailable(): boolean {
	return existsSync(BACKEND_LOG);
}

/** Newest token logged for a user, polling because the log line is written just after the response. */
export async function loggedToken(kind: LoggedLinkKind, userId: number, timeoutMs = 5_000): Promise<string> {
	const pattern = new RegExp(`userId=${userId} link=/${kind}\\?org=[^&\\s]+&token=(\\S+?)(?= expiresAt|\\s|$)`, "g");
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const matches = [...readFileSync(BACKEND_LOG, "utf-8").matchAll(pattern)];
		if (matches.length > 0) return decodeURIComponent(matches[matches.length - 1][1]);
		if (Date.now() > deadline) throw new Error(`No ${kind} token logged for user ${userId} in ${BACKEND_LOG} within ${timeoutMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}
