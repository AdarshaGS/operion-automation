// MEM-U03: every sidebar item is enabled exactly when the signed-in role holds one of the
// permissions the item requires. Run once per role fixture, with that role's own session; the
// expected state is computed from the role's real permissions (GET /auth/me), so the test
// follows the backend rather than a hard-coded list.

import { test, expect } from "../../../src/sanity/fixtures";
import { NAV_ITEMS } from "../../../src/pages/AppLayoutPage";
import { ROLE_FIXTURES } from "../../../src/setup/roles";
import { storageStatePath, tokenFor } from "../../../src/setup/session";
import { ApiClient } from "../../../src/api/apiClient";

for (const { name: role } of ROLE_FIXTURES) {
	test.describe(`as ${role}`, () => {
		test.use({ storageState: storageStatePath(role) });

		test(`MEM-U03 each sidebar item is enabled only when ${role} holds its permission`, async ({ page, appLayout, request, calls }) => {
			const me = await new ApiClient(request, calls, role, tokenFor(role)).get("/api/v1/auth/me");
			const held = new Set<string>(me.body.permissions);
			await appLayout.open("/settings");

			const mismatches: string[] = [];
			for (const item of NAV_ITEMS) {
				if ((await appLayout.navItem(item.label).count()) === 0) continue; // hidden by an organisation module switch
				const expected = item.requiredPermissions.length === 0 || item.requiredPermissions.some((code) => held.has(code));
				const actual = await appLayout.isNavItemEnabled(item.label);
				if (actual !== expected) mismatches.push(`${item.label}: expected ${expected ? "enabled" : "disabled"}, was ${actual ? "enabled" : "disabled"}`);
			}
			expect(mismatches, `${role} sidebar differs from its permissions`).toEqual([]);
			expect(page.url()).toContain("/settings");
		});

		test(`MEM-U03 ${role} opening Members by direct link is told what is missing and sees no member data`, async ({ page, appLayout, request, calls }) => {
			const me = await new ApiClient(request, calls, role, tokenFor(role)).get("/api/v1/auth/me");
			test.skip(me.body.permissions.includes("MEMBERSHIP_VIEW"), "this role may open Members");
			await appLayout.open("/members");
			await expect(page.getByText("Missing required permission: MEMBERSHIP_VIEW")).toBeVisible();
			await expect(page.getByRole("row").filter({ hasText: "@" })).toHaveCount(0);
		});
	});
}
