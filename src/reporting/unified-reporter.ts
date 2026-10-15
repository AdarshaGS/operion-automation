// One report for both layers. Reads Playwright's results plus the two things our fixtures
// attach (`api-calls` from the recording API client, `ui-diagnostics` from the UI fixture),
// and answers three questions directly:
//
//   * which API endpoints are failing?       -> Report.endpoints  (grouped by module)
//   * which UI components are failing?       -> Report.components (page object + action)
//   * what hasn't the suite touched at all?  -> Report.coverage   (vs. the live OpenAPI doc)
//
// Output: reports/unified/report.json (machine-readable) and index.html (self-contained).

import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { API_BASE_URL, REPORT_DIR, UI_BASE_URL } from "../config/env";
import { endpointKey, fetchInventory, moduleOf } from "./endpoint-inventory";
import { renderHtml } from "./render-html";
import type {
	CallRecord, ComponentAction, JourneyStep, ComponentResult, CoverageGap, EndpointResult, EntityStatus, Layer, ModuleSummary, Outcome, Report, TestRecord,
} from "./types";

const OUT_DIR = join(REPORT_DIR, "unified");
const ANSI = /\u001b\[[0-9;]*m/g;
const COMPONENT_STEP = /^([A-Z]\w*Page)\.(\w+)$/;

const clean = (text: string) => text.replace(ANSI, "").trim();

function attachmentJson<T>(result: TestResult, name: string): T | undefined {
	const attachment = result.attachments.find((a) => a.name === name);
	if (!attachment?.body) return undefined;
	try {
		return JSON.parse(attachment.body.toString("utf-8")) as T;
	} catch {
		return undefined;
	}
}

/** [tests/]<layer>/<module>/x.spec.ts -> module (rootDir is the tests/ folder, so the prefix is optional). */
function moduleFromFile(file: string): string {
	if (/(?:^|\/)(?:tests\/)?sanity\//.test(file)) return "sanity";
	const match = file.match(/(?:^|\/)(?:tests\/)?(?:api|ui)\/([^/]+)\//);
	return match?.[1] ?? "other";
}

function collectActions(steps: TestStep[], into: ComponentAction[]): void {
	for (const step of steps) {
		const match = step.title.match(COMPONENT_STEP);
		if (match) {
			into.push({
				component: match[1],
				action: match[2],
				status: step.error ? "failed" : "passed",
				durationMs: step.duration,
				error: step.error?.message ? clean(step.error.message).split("\n")[0] : undefined,
			});
		}
		collectActions(step.steps, into);
	}
}

function buildJourney(plan: string[], steps: TestStep[]): JourneyStep[] {
	const ran = new Map(steps.map((step) => [step.title, step]));
	return plan.map((title) => {
		const [phase, ...rest] = title.split(" › ");
		const step = ran.get(title);
		return {
			title,
			phase,
			name: rest.join(" › ") || title,
			status: !step ? "notrun" : step.error ? "failed" : "passed",
			durationMs: step?.duration ?? 0,
			error: step?.error?.message ? clean(step.error.message).split("\n").slice(0, 6).join("\n") : undefined,
		};
	});
}

function firstLocator(message: string): string | undefined {
	return message.match(/Locator:\s*(.+)/)?.[1]?.trim();
}

export default class UnifiedReporter implements Reporter {
	private startedAt = Date.now();
	private rootDir = process.cwd();
	private records = new Map<string, TestRecord>();

	onBegin(config: FullConfig, _suite: Suite): void {
		this.rootDir = config.rootDir;
		this.startedAt = Date.now();
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		// Called once per attempt; the last attempt wins (retries count is kept).
		const projectName = test.parent.project()?.name ?? "";
		const layer: Layer = projectName.startsWith("api") ? "api" : projectName === "sanity" ? "sanity" : "ui";
		const file = relative(this.rootDir, test.location.file).replaceAll("\\", "/");

		const calls = attachmentJson<CallRecord[]>(result, "api-calls") ?? [];
		const diagnostics = attachmentJson<{ consoleErrors: string[]; failedRequests: string[] }>(result, "ui-diagnostics");
		const actions: ComponentAction[] = [];
		collectActions(result.steps, actions);

		const plan = attachmentJson<string[]>(result, "journey-plan");
		const journeySteps = plan ? buildJourney(plan, result.steps) : undefined;

		const rawMessage = result.error?.message ?? result.errors[0]?.message;
		const message = rawMessage ? clean(rawMessage) : undefined;
		const failed = result.status === "failed" || result.status === "timedOut" || result.status === "interrupted";
		const outcomeName = test.outcome();
		// A test marked as a known defect is expected to fail: failing is its pass. Passing means the defect was fixed.
		const knownDefect = test.annotations.find((a) => a.type === "known-defect")?.description;
		const outcome: Outcome = outcomeName === "expected" ? "passed" : outcomeName === "skipped" ? "skipped" : outcomeName === "flaky" ? "flaky" : failed || outcomeName === "unexpected" ? "failed" : "passed";

		let blamedCall: TestRecord["blamedCall"];
		if (outcome === "failed" && calls.length > 0) {
			// Prefer the call whose assertion failed; otherwise the last call made before the test died.
			const explicit = calls.find((c) => c.verdict === "fail") ?? calls.find((c) => c.status >= 500);
			const call = explicit ?? calls[calls.length - 1];
			blamedCall = {
				index: calls.indexOf(call),
				method: call.method,
				template: call.template,
				status: call.status,
				reason: call.failure ?? (call.status >= 500 ? `Server error ${call.status}` : message?.split("\n")[0] ?? "Assertion failed"),
			};
		}

		const screenshot = result.attachments.find((a) => a.name === "screenshot" && a.path)?.path;
		const trace = result.attachments.find((a) => a.name === "trace" && a.path)?.path;

		this.records.set(test.id, {
			id: test.id,
			title: test.title,
			group: test.titlePath().slice(3, -1).join(" › "),
			file,
			project: projectName,
			layer,
			module: moduleFromFile(file),
			outcome,
			knownDefect: outcomeName === "expected" ? knownDefect : undefined,
			durationMs: result.duration,
			retries: result.retry,
			error: message ? { message, locator: firstLocator(message) } : undefined,
			calls,
			blamedCall,
			actions,
			journey: journeySteps,
			uiFailedRequests: diagnostics?.failedRequests ?? [],
			uiConsoleErrors: diagnostics?.consoleErrors ?? [],
			screenshot,
			trace,
		});
	}

	async onEnd(result: FullResult): Promise<void> {
		rmSync(OUT_DIR, { recursive: true, force: true });
		mkdirSync(join(OUT_DIR, "assets"), { recursive: true });

		const tests = [...this.records.values()].sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
		for (const t of tests) {
			if (t.screenshot && existsSync(t.screenshot)) {
				const name = `${createHash("sha1").update(t.id).digest("hex").slice(0, 10)}-${basename(t.screenshot)}`;
				copyFileSync(t.screenshot, join(OUT_DIR, "assets", name));
				t.screenshot = `assets/${name}`;
			} else {
				t.screenshot = undefined;
			}
			// Traces are large and stay where Playwright put them; surface the path + the command.
			t.trace = t.trace ? relative(process.cwd(), t.trace) : undefined;
		}

		const endpoints = this.aggregateEndpoints(tests);
		const components = this.aggregateComponents(tests);
		const coverage = await this.coverage(endpoints);
		const report: Report = {
			generatedAt: new Date().toISOString(),
			durationMs: result.duration ?? Date.now() - this.startedAt,
			targets: { api: API_BASE_URL, ui: UI_BASE_URL },
			totals: this.count(tests),
			byLayer: { api: this.count(tests.filter((t) => t.layer === "api")), ui: this.count(tests.filter((t) => t.layer === "ui")), sanity: this.count(tests.filter((t) => t.layer === "sanity")) },
			modules: this.summariseModules(tests, endpoints, components),
			tests,
			endpoints,
			components,
			coverage,
		};

		writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
		writeFileSync(join(OUT_DIR, "index.html"), renderHtml(report));
		this.printSummary(report);
	}

	printsToStdio(): boolean {
		return true;
	}

	private count(tests: TestRecord[]) {
		return {
			tests: tests.length,
			passed: tests.filter((t) => t.outcome === "passed").length,
			failed: tests.filter((t) => t.outcome === "failed").length,
			flaky: tests.filter((t) => t.outcome === "flaky").length,
			skipped: tests.filter((t) => t.outcome === "skipped").length,
			knownDefects: tests.filter((t) => t.knownDefect).length,
		};
	}

	private aggregateEndpoints(tests: TestRecord[]): EndpointResult[] {
		const byKey = new Map<string, EndpointResult>();
		for (const t of tests.filter((x) => x.layer !== "ui")) {
			const blamed = t.blamedCall;
			const hasExplicitFail = t.calls.some((c) => c.verdict === "fail");
			t.calls.forEach((call, index) => {
				const key = endpointKey(call.method, call.template);
				let entry = byKey.get(key);
				if (!entry) {
					const path = call.template.replace(/\/+$/, "");
					entry = { key, method: call.method, path, module: moduleOf(path), status: "unverified", calls: 0, passedChecks: 0, failedChecks: 0, statusesSeen: [], tests: [], failures: [] };
					byKey.set(key, entry);
				}
				entry.calls += 1;
				if (!entry.statusesSeen.includes(call.status)) entry.statusesSeen.push(call.status);
				if (!entry.tests.some((x) => x.id === t.id)) entry.tests.push({ id: t.id, title: t.title, outcome: t.outcome });

				// A failed test with no explicitly failed call blames its last call (see blamedCall).
				const failedCheck = call.verdict === "fail" || call.status >= 500 || (!hasExplicitFail && blamed?.index === index);
				if (failedCheck) {
					entry.failedChecks += 1;
					entry.failures.push({ testId: t.id, testTitle: t.title, status: call.status, reason: call.failure ?? (call.status >= 500 ? `Server error ${call.status}` : blamed?.reason ?? "Assertion failed") });
				} else if (call.verdict === "pass") {
					entry.passedChecks += 1;
				}
			});
		}
		for (const entry of byKey.values()) {
			entry.statusesSeen.sort((a, b) => a - b);
			entry.status = entry.failedChecks > 0 ? "failed" : entry.passedChecks > 0 ? "passed" : "unverified";
		}
		return [...byKey.values()].sort((a, b) => a.module.localeCompare(b.module) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
	}

	private aggregateComponents(tests: TestRecord[]): ComponentResult[] {
		const byName = new Map<string, ComponentResult>();
		for (const t of tests.filter((x) => x.layer !== "api")) {
			for (const action of t.actions) {
				let comp = byName.get(action.component);
				if (!comp) {
					comp = { name: action.component, module: t.module, status: "unverified", actions: [], failures: [] };
					byName.set(action.component, comp);
				}
				let row = comp.actions.find((a) => a.action === action.action);
				if (!row) {
					row = { action: action.action, status: "unverified", runs: 0, failures: 0 };
					comp.actions.push(row);
				}
				row.runs += 1;
				if (action.status === "failed") {
					row.failures += 1;
					comp.failures.push({ testId: t.id, testTitle: t.title, action: action.action, error: action.error ?? "Action failed" });
				}
			}
			// A failing test whose error did not come from a page-object action (e.g. an assertion in the
			// spec itself) still taints every component the test used: the screen is suspect, not proven bad.
			if (t.outcome === "failed" && !t.actions.some((a) => a.status === "failed")) {
				for (const name of new Set(t.actions.map((a) => a.component))) {
					const comp = byName.get(name)!;
					comp.failures.push({ testId: t.id, testTitle: t.title, action: "(assertion in test)", error: t.error?.message.split("\n")[0] ?? "Test failed" });
				}
			}
		}
		for (const comp of byName.values()) {
			for (const row of comp.actions) row.status = row.failures > 0 ? "failed" : "passed";
			const hardFail = comp.actions.some((a) => a.status === "failed");
			comp.status = hardFail ? "failed" : comp.failures.length > 0 ? "affected" : "passed";
			comp.actions.sort((a, b) => a.action.localeCompare(b.action));
		}
		return [...byName.values()].sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
	}

	private async coverage(endpoints: EndpointResult[]): Promise<Report["coverage"]> {
		const inventory = await fetchInventory(API_BASE_URL);
		if ("error" in inventory) {
			return { available: false, note: `Endpoint inventory unavailable (${inventory.error}).`, totalOperations: 0, coveredOperations: 0, gaps: [] };
		}
		const touched = new Set(endpoints.map((e) => e.key));
		const gaps: CoverageGap[] = inventory.operations
			.filter((op) => !touched.has(endpointKey(op.method, op.path)))
			.map((op) => ({ method: op.method, path: op.path, module: op.module, operation: op.operationId }));
		gaps.sort((a, b) => a.module.localeCompare(b.module) || a.path.localeCompare(b.path));
		return { available: true, totalOperations: inventory.operations.length, coveredOperations: inventory.operations.length - gaps.length, gaps };
	}

	private summariseModules(tests: TestRecord[], endpoints: EndpointResult[], components: ComponentResult[]): ModuleSummary[] {
		const names = new Set<string>([...tests.map((t) => t.module), ...endpoints.map((e) => e.module), ...components.map((c) => c.module)]);
		return [...names].sort().map((module) => {
			const of = (layer: Layer) => this.count(tests.filter((t) => t.module === module && t.layer === layer));
			const api = of("api");
			const ui = of("ui");
			const eps = endpoints.filter((e) => e.module === module);
			const comps = components.filter((c) => c.module === module);
			return {
				module,
				api: { total: api.tests, passed: api.passed + api.flaky, failed: api.failed },
				ui: { total: ui.tests, passed: ui.passed + ui.flaky, failed: ui.failed },
				endpoints: { total: eps.length, failed: eps.filter((e) => e.status === "failed").length },
				components: { total: comps.length, failed: comps.filter((c) => c.status === "failed").length },
			};
		});
	}

	private sanityLine(report: Report): string {
		return report.tests
			.filter((t) => t.layer === "sanity")
			.map((t) => {
				const steps = t.journey ?? [];
				const failed = steps.find((s) => s.status === "failed");
				const done = steps.filter((s) => s.status === "passed").length;
				return failed ? `FAILED at "${failed.title}" (${done}/${steps.length} steps passed)` : `${t.outcome === "passed" ? "PASSED" : "FAILED"} (${done}/${steps.length} steps passed)`;
			})
			.join("; ");
	}

	private printSummary(report: Report): void {
		const { totals, byLayer } = report;
		const failedEndpoints = report.endpoints.filter((e) => e.status === "failed");
		const failedComponents = report.components.filter((c) => c.status === "failed");
		const lines = [
			"",
			"Unified report",
			...(byLayer.sanity.tests ? [`  sanity     ${this.sanityLine(report)}`] : []),
			`  tests      ${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped, ${totals.knownDefects} of the passed are known defects  (API ${byLayer.api.failed} failing, UI ${byLayer.ui.failed} failing)`,
			`  endpoints  ${report.endpoints.length} exercised, ${failedEndpoints.length} failing`,
			...failedEndpoints.map((e) => `     x ${e.method} ${e.path}  - ${e.failures[0]?.reason ?? ""}`.slice(0, 200)),
			`  components ${report.components.length} exercised, ${failedComponents.length} failing`,
			...failedComponents.map((c) => `     x ${c.name}.${c.failures[0]?.action ?? ""}  - ${c.failures[0]?.error ?? ""}`.slice(0, 200)),
			report.coverage.available ? `  coverage   ${report.coverage.coveredOperations}/${report.coverage.totalOperations} backend operations touched` : `  coverage   ${report.coverage.note}`,
			`  open       ${join(OUT_DIR, "index.html")}`,
			"",
		];
		console.log(lines.join("\n"));
	}
}
