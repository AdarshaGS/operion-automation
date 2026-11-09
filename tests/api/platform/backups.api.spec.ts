// Local backups from the platform console API: take one, read it back from disk, and check who may call it.
// IDs refer to docs/SCENARIOS.md section 25 (PLT-20..22). The stack writes backups to .stack/backups.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test, expect } from "../../../src/sanity/fixtures";
import { API_BASE_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../../../src/config/env";

const BACKUPS = "/api/v1/platform/backups";

type BackupFile = { name: string; sizeBytes: number; sha256: string };
type BackupSummary = { name: string; createdAt: string; totalBytes: number; files: BackupFile[] };
type BackupStatus = { directory: string; healthy: boolean; lastError: string | null; lastSuccessAt: string | null; backups: BackupSummary[] };

async function platformToken(): Promise<string> {
	const response = await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
	});
	return ((await response.json()) as { token: string }).token;
}

async function call(method: string, path: string, token?: string): Promise<Response> {
	return fetch(`${API_BASE_URL}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// Backups are serialised on the server and each one dumps both databases, so these run one at a time.
test.describe.configure({ mode: "serial" });

test.describe("PLT-20 taking a backup", () => {
	test("PLT-20 Back up now writes both database dumps and the uploads, with checksums that match the files on disk", async () => {
		const token = await platformToken();
		const response = await call("POST", BACKUPS, token);
		expect(response.status).toBe(200);
		const summary = (await response.json()) as BackupSummary;
		expect(summary.name).toMatch(/^operion-backup-\d{8}-\d{6}(-\d+)?$/);
		expect(summary.files.map((f) => f.name)).toEqual(["school.sql.gz", "platform.sql.gz", "uploads.zip"]);

		const status = (await (await call("GET", BACKUPS, token)).json()) as BackupStatus;
		const folder = join(status.directory, summary.name);
		for (const file of summary.files) {
			const bytes = readFileSync(join(folder, file.name));
			expect(bytes.length, `${file.name} size`).toBe(file.sizeBytes);
			expect(createHash("sha256").update(bytes).digest("hex"), `${file.name} checksum`).toBe(file.sha256);
		}
		const school = gunzipSync(readFileSync(join(folder, "school.sql.gz"))).toString("utf8");
		expect(school).toContain("CREATE TABLE `students`");
		expect(school).toContain("-- Dump completed");
		const platform = gunzipSync(readFileSync(join(folder, "platform.sql.gz"))).toString("utf8");
		expect(platform).toContain("CREATE TABLE `organisations`");
		const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
		expect(JSON.stringify(manifest)).toContain(summary.files[0].sha256);
	});

	test("PLT-20 the backup list shows the new backup first and the status is healthy", async () => {
		const token = await platformToken();
		const summary = (await (await call("POST", BACKUPS, token)).json()) as BackupSummary;
		const status = (await (await call("GET", BACKUPS, token)).json()) as BackupStatus;
		expect(status.backups[0].name).toBe(summary.name);
		expect(status.healthy).toBe(true);
		expect(status.lastError).toBeNull();
		expect(status.lastSuccessAt).not.toBeNull();
	});
});

test.describe("PLT-21 system health", () => {
	test("PLT-21 system health lists Backups as operational once a recent backup exists", async () => {
		const token = await platformToken();
		expect((await call("POST", BACKUPS, token)).status).toBe(200);
		const components = (await (await call("GET", "/api/v1/platform/system-health", token)).json()) as { name: string; operational: boolean }[];
		expect(components).toContainEqual({ name: "Backups", operational: true });
	});
});

test.describe("PLT-22 who may take a backup", () => {
	test("PLT-22 without a token, listing and taking backups are both refused", async () => {
		expect((await call("GET", BACKUPS)).status).toBe(401);
		expect((await call("POST", BACKUPS)).status).toBe(401);
	});

	test("PLT-22 a school administrator's token cannot list or take platform backups", async ({ api }) => {
		(await api.get(BACKUPS)).expectStatus([401, 403]);
		(await api.post(BACKUPS)).expectStatus([401, 403]);
	});
});
