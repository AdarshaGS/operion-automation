import type { Page } from "@playwright/test";

// Mirrors NAV_GROUPS in web/src/layout/AppLayout.tsx - kept as data here (rather than
// imported) since e2e is a standalone TS project outside web/'s build graph. A change
// to AppLayout's nav structure should be reflected here too; tests/rbac/nav-visibility
// spec is what will actually catch the drift.
export const NAV_ITEMS: { label: string; path: string; requiredPermissions: string[] }[] = [
	{ label: "Dashboard", path: "/dashboard", requiredPermissions: ["ORGANISATION_MANAGE"] },
	{ label: "Students", path: "/students", requiredPermissions: ["STUDENT_VIEW"] },
	{ label: "Admissions", path: "/admissions", requiredPermissions: ["STUDENT_VIEW"] },
	{ label: "Academics", path: "/academics", requiredPermissions: ["CLASS_VIEW", "GRADE_LEVEL_VIEW", "SUBJECT_VIEW", "TEACHER_ASSIGNMENT_VIEW"] },
	{ label: "Attendance", path: "/attendance", requiredPermissions: ["ATTENDANCE_VIEW", "STAFF_ATTENDANCE_VIEW"] },
	{ label: "Examinations", path: "/examinations", requiredPermissions: ["EXAM_VIEW"] },
	{ label: "Library", path: "/library", requiredPermissions: ["LIBRARY_VIEW"] },
	{ label: "Learning", path: "/learning", requiredPermissions: ["LEARNING_VIEW", "LESSON_PLAN_REVIEW"] },
	{ label: "Fees", path: "/fees", requiredPermissions: ["FEE_VIEW"] },
	{ label: "Transport", path: "/transport", requiredPermissions: ["TRANSPORT_VIEW"] },
	{ label: "Communication", path: "/communication", requiredPermissions: ["COMMUNICATION_VIEW"] },
	{ label: "Messaging", path: "/messaging", requiredPermissions: ["COMMUNICATION_VIEW"] },
	{ label: "Inventory", path: "/inventory", requiredPermissions: ["INVENTORY_VIEW"] },
	{ label: "Purchase", path: "/purchase", requiredPermissions: ["PURCHASE_VIEW"] },
	{ label: "Sales", path: "/sales", requiredPermissions: ["SALES_VIEW"] },
	{ label: "Reports", path: "/reports", requiredPermissions: ["REPORT_CREATE", "REPORT_MANAGE"] },
	{ label: "HR", path: "/hr", requiredPermissions: ["HR_VIEW"] },
	{ label: "Payroll", path: "/payroll", requiredPermissions: ["PAYROLL_VIEW"] },
	{ label: "Members", path: "/members", requiredPermissions: ["MEMBERSHIP_VIEW"] },
	{ label: "Settings", path: "/settings", requiredPermissions: [] },
];

export class AppLayoutPage {
	constructor(private readonly page: Page) {}

	/** Defaults to /settings - the one nav route with no requiredPermissions and no
	 * gated backend call on load, so it's a safe landing page for every role fixture,
	 * unlike /dashboard which 403s its own summary call without ORGANISATION_MANAGE.
	 * Waits for /auth/me to resolve before returning - until then AppLayout treats
	 * every nav item as enabled (permissionsLoaded=false bypass), so reading nav state
	 * any earlier is a race. */
	async open(path = "/settings") {
		const meResponse = this.page.waitForResponse((response) => response.url().includes("/api/v1/auth/me") && response.request().method() === "GET");
		await this.page.goto(path);
		await meResponse;
		// The response resolving doesn't guarantee React has re-rendered with it yet -
		// give the AuthContext state update a moment to flush before reading nav state.
		await this.page.waitForTimeout(200);
	}

	navItem(label: string) {
		return this.page.getByRole("button", { name: label, exact: true });
	}

	async isNavItemEnabled(label: string): Promise<boolean> {
		return (await this.navItem(label).isEnabled({ timeout: 5_000 })) && (await this.navItem(label).getAttribute("aria-disabled")) !== "true";
	}

	async navigateVia(label: string) {
		await this.navItem(label).click();
	}

	organisationWordmark() {
		return this.page.getByLabel("Go to home");
	}

	async openAccountMenu() {
		await this.page.getByRole("button", { name: "Account menu" }).click();
	}

	async signOut() {
		await this.openAccountMenu();
		await this.page.getByRole("menuitem", { name: "Sign out" }).click();
	}

	async openChangePassword() {
		await this.openAccountMenu();
		await this.page.getByRole("menuitem", { name: "Change password" }).click();
	}

	/** Fills and submits the Change password dialog (open it first with openChangePassword). */
	async changePassword(currentPassword: string, newPassword: string, confirmPassword = newPassword) {
		const dialog = this.page.getByRole("dialog", { name: "Change password" });
		await dialog.getByLabel(/^Current password/).fill(currentPassword);
		await dialog.getByLabel(/^New password/).fill(newPassword);
		await dialog.getByLabel(/^Confirm new password/).fill(confirmPassword);
		await dialog.getByRole("button", { name: "Change password" }).click();
	}

	changePasswordDialog() {
		return this.page.getByRole("dialog", { name: "Change password" });
	}
}
