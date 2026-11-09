// The secrets check (SecretsGuard) as the platform console API reports it. The test stack deliberately runs on the
// development defaults, so every shipped default must be flagged - by variable name, never by value - while the server
// still starts because it is not in the prod profile. IDs refer to docs/SCENARIOS.md section 25 (PLT-23..24).

import { test, expect } from "../../../src/sanity/fixtures";
import { API_BASE_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../../../src/config/env";

type SecretsReport = { enforced: boolean; problems: { setting: string; problem: string }[]; warnings: string[] };

async function platformToken(): Promise<string> {
	const response = await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
	});
	return ((await response.json()) as { token: string }).token;
}

async function get(path: string, token?: string): Promise<Response> {
	return fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test.describe("PLT-23 the secrets check", () => {
	test("PLT-23 every development default on the test stack is flagged by variable name, in warn mode", async () => {
		const response = await get("/api/v1/platform/system-health/secrets", await platformToken());
		expect(response.status).toBe(200);
		const text = await response.text();
		const report = JSON.parse(text) as SecretsReport;
		expect(report.enforced).toBe(false);
		const settings = report.problems.map((p) => p.setting);
		expect(settings).toEqual(expect.arrayContaining(["JWT_SECRET", "PLATFORM_JWT_SECRET", "INTEGRATION_SECRET_KEY", "REPORTING_DB_PASSWORD"]));
		expect(report.problems.find((p) => p.setting === "JWT_SECRET")?.problem).toBe("is still the built-in development value");
		// The stack signs in with the seeded platform admin password, so that is flagged too.
		expect(report.problems.find((p) => p.setting === "PLATFORM_ADMIN_PASSWORD")?.problem).toContain(`${PLATFORM_ADMIN_EMAIL} still has the seeded password`);
		expect(report.warnings).toContain("Scheduled backups are off - set BACKUP_ENABLED=true");
		for (const value of ["dev-only-secret", "dev-only-platform-secret", "dev-only-integration-secret", "changeme-reporting-ro", PLATFORM_ADMIN_PASSWORD]) {
			expect(text, `the report must not contain the value ${value}`).not.toContain(value);
		}
	});

	test("PLT-23 system health lists Secrets as down while defaults remain", async () => {
		const components = (await (await get("/api/v1/platform/system-health", await platformToken())).json()) as { name: string; operational: boolean }[];
		expect(components).toContainEqual({ name: "Secrets", operational: false });
	});
});

test.describe("PLT-24 who may read the secrets check", () => {
	test("PLT-24 without a token it is refused", async () => {
		expect((await get("/api/v1/platform/system-health/secrets")).status).toBe(401);
	});

	test("PLT-24 a school administrator's token is refused", async ({ api }) => {
		(await api.get("/api/v1/platform/system-health/secrets")).expectStatus([401, 403]);
	});
});
