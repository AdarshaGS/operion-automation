// Recording API client for the `api` Playwright project.
//
// Every call is made against a path *template* (`/api/v1/students/{studentId}`) plus a params
// map, never an interpolated URL - the template is what the unified report groups by, so
// "GET /api/v1/students/{studentId}" shows up as one endpoint no matter how many ids were hit.
// Calls are collected per test and attached as `api-calls` JSON (see fixtures.ts); the
// reporter reads that to answer "which endpoints failed".
//
// Verdicts: a call is only marked pass/fail when the test asserts on it through
// ApiResult.expectStatus / expectJson. If a test fails and no call was explicitly marked
// failed, the reporter blames the last call made (see reporting/unified-reporter.ts).

import { expect, type APIRequestContext } from "@playwright/test";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RecordedCall {
	method: HttpMethod;
	/** Path template with `{param}` placeholders - the grouping key in the report. */
	template: string;
	url: string;
	status: number;
	durationMs: number;
	/** Fixture role that made the call, or "anonymous". */
	actor: string;
	verdict: "pass" | "fail" | "unchecked";
	/** Why the verdict is "fail" - the assertion message. */
	failure?: string;
	requestBody?: unknown;
	responseBody?: unknown;
}

export interface CallOptions {
	params?: Record<string, string | number>;
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	/** multipart/form-data fields; a file is `{ name, mimeType, buffer }`. Used by the CSV import endpoints. */
	multipart?: Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }>;
	/** Overrides the client's own token (e.g. to send a garbage token). `null` sends none. */
	token?: string | null;
}

const REDACTED_KEYS = /password|token|secret/i;
const MAX_BODY_CHARS = 1500;

function redact(value: unknown, depth = 0): unknown {
	if (value === null || typeof value !== "object" || depth > 5) return value;
	if (Array.isArray(value)) return value.slice(0, 5).map((item) => redact(item, depth + 1));
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, REDACTED_KEYS.test(key) ? "***" : redact(v, depth + 1)]),
	);
}

function truncate(value: unknown): unknown {
	const text = JSON.stringify(value);
	if (text === undefined || text.length <= MAX_BODY_CHARS) return value;
	return `${text.slice(0, MAX_BODY_CHARS)}... [truncated ${text.length - MAX_BODY_CHARS} chars]`;
}

function fillTemplate(template: string, params: Record<string, string | number> = {}): string {
	return template.replace(/\{(\w+)\}/g, (_, name: string) => {
		if (!(name in params)) throw new Error(`Missing path param "${name}" for ${template}`);
		return encodeURIComponent(String(params[name]));
	});
}

export class ApiResult {
	constructor(
		readonly status: number,
		readonly body: any,
		readonly headers: Record<string, string>,
		private readonly record: RecordedCall,
	) {}

	get ok(): boolean {
		return this.status >= 200 && this.status < 300;
	}

	/** Asserts the status and records the verdict against this endpoint. Returns `this` to chain. */
	expectStatus(expected: number | number[]): this {
		const allowed = Array.isArray(expected) ? expected : [expected];
		this.verdict(() => expect(allowed, `${this.record.method} ${this.record.template} returned ${this.status}, body: ${JSON.stringify(this.body)}`).toContain(this.status));
		return this;
	}

	/** Asserts on the JSON body; the assertion callback may use any `expect(...)`. */
	expectJson(assertion: (body: any) => void): this {
		this.verdict(() => assertion(this.body));
		return this;
	}

	private verdict(check: () => void): void {
		try {
			check();
			if (this.record.verdict !== "fail") this.record.verdict = "pass";
		} catch (error) {
			this.record.verdict = "fail";
			this.record.failure = error instanceof Error ? error.message.split("\n")[0] : String(error);
			throw error;
		}
	}
}

export class ApiClient {
	constructor(
		private readonly context: APIRequestContext,
		private readonly calls: RecordedCall[],
		readonly actor: string,
		private readonly token?: string,
	) {}

	/** Same context and call log, different identity - e.g. a freshly created user. */
	withToken(token: string, actor: string): ApiClient {
		return new ApiClient(this.context, this.calls, actor, token);
	}

	get = (template: string, options?: CallOptions) => this.send("GET", template, options);
	post = (template: string, options?: CallOptions) => this.send("POST", template, options);
	put = (template: string, options?: CallOptions) => this.send("PUT", template, options);
	patch = (template: string, options?: CallOptions) => this.send("PATCH", template, options);
	delete = (template: string, options?: CallOptions) => this.send("DELETE", template, options);

	private async send(method: HttpMethod, template: string, options: CallOptions = {}): Promise<ApiResult> {
		const token = options.token === undefined ? this.token : (options.token ?? undefined);
		const headers: Record<string, string> = {};
		if (token) headers.Authorization = `Bearer ${token}`;

		const url = fillTemplate(template, options.params);
		const startedAt = Date.now();
		const response = await this.context.fetch(url, {
			method,
			headers,
			params: options.query as Record<string, string | number | boolean>,
			data: options.body,
			multipart: options.multipart,
			failOnStatusCode: false,
		});
		const durationMs = Date.now() - startedAt;

		const text = await response.text();
		let body: unknown = text;
		try {
			body = text ? JSON.parse(text) : undefined;
		} catch {
			// non-JSON body (CSV export, plain-text error) - keep the raw text
		}

		const record: RecordedCall = {
			method,
			template,
			url,
			status: response.status(),
			durationMs,
			actor: this.actor,
			verdict: "unchecked",
			requestBody: truncate(redact(options.body ?? (options.multipart ? { multipart: Object.keys(options.multipart) } : undefined))),
			responseBody: truncate(redact(body)),
		};
		this.calls.push(record);
		return new ApiResult(response.status(), body, response.headers(), record);
	}
}
