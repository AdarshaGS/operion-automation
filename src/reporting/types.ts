// Data model shared by the reporter and the HTML renderer. report.json is exactly `Report`.

export type Layer = "api" | "ui" | "sanity";
export type Outcome = "passed" | "failed" | "flaky" | "skipped";
export type EntityStatus = "passed" | "failed" | "affected" | "unverified";

export interface CallRecord {
	method: string;
	template: string;
	url: string;
	status: number;
	durationMs: number;
	actor: string;
	verdict: "pass" | "fail" | "unchecked";
	failure?: string;
	requestBody?: unknown;
	responseBody?: unknown;
}

export interface ComponentAction {
	component: string;
	action: string;
	status: "passed" | "failed";
	durationMs: number;
	error?: string;
}

export interface JourneyStep {
	title: string;
	phase: string;
	name: string;
	status: "passed" | "failed" | "notrun";
	durationMs: number;
	error?: string;
}

export interface TestRecord {
	id: string;
	title: string;
	/** describe titles above the test */
	group: string;
	file: string;
	project: string;
	layer: Layer;
	module: string;
	outcome: Outcome;
	/** Set when the test documents a known Operion defect and failed as expected (so it counts as passed). */
	knownDefect?: string;
	durationMs: number;
	retries: number;
	error?: { message: string; locator?: string };
	/** API layer: every HTTP call the test made. */
	calls: CallRecord[];
	/** The call blamed for the failure, if any. */
	blamedCall?: { index: number; method: string; template: string; status: number; reason: string };
	/** Sanity layer: the declared journey steps with their outcome, in order. */
	journey?: JourneyStep[];
	/** UI layer: page-object actions the test performed, in order. */
	actions: ComponentAction[];
	/** UI layer: backend calls that failed (5xx / connection) and console errors seen on the page. */
	uiFailedRequests: string[];
	uiConsoleErrors: string[];
	screenshot?: string;
	trace?: string;
}

export interface EndpointResult {
	key: string;
	method: string;
	path: string;
	module: string;
	status: EntityStatus;
	calls: number;
	passedChecks: number;
	failedChecks: number;
	statusesSeen: number[];
	tests: { id: string; title: string; outcome: Outcome }[];
	failures: { testId: string; testTitle: string; status: number; reason: string }[];
}

export interface ComponentResult {
	name: string;
	module: string;
	status: EntityStatus;
	actions: { action: string; status: EntityStatus; runs: number; failures: number }[];
	failures: { testId: string; testTitle: string; action: string; error: string }[];
}

export interface CoverageGap {
	method: string;
	path: string;
	module: string;
	operation?: string;
}

export interface ModuleSummary {
	module: string;
	api: { total: number; passed: number; failed: number };
	ui: { total: number; passed: number; failed: number };
	endpoints: { total: number; failed: number };
	components: { total: number; failed: number };
}

export interface Report {
	generatedAt: string;
	durationMs: number;
	targets: { api: string; ui: string };
	totals: { tests: number; passed: number; failed: number; flaky: number; skipped: number; knownDefects: number };
	byLayer: Record<Layer, { tests: number; passed: number; failed: number; flaky: number; skipped: number; knownDefects: number }>;
	modules: ModuleSummary[];
	tests: TestRecord[];
	endpoints: EndpointResult[];
	components: ComponentResult[];
	coverage: {
		available: boolean;
		note?: string;
		totalOperations: number;
		coveredOperations: number;
		gaps: CoverageGap[];
	};
}
