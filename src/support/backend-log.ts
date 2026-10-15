// Operion has no mail server in the disposable stack: password-reset and email-verification
// tokens are only written to the backend log as "the email that would be sent". These helpers
// read that log, so specs can drive the real flow end to end.
//
// Needs the log of the backend under test: scripts/stack-up.sh writes .stack/backend.log, or
// point OPERION_BACKEND_LOG at another file. When it is absent the callers skip, not fail.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BACKEND_LOG = process.env.OPERION_BACKEND_LOG ?? join(process.cwd(), ".stack", "backend.log");

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
