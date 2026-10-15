import type { Page } from "@playwright/test";

/** /hr/staff/:id - a staff member's HR profile. */
export class StaffDetailPage {
	constructor(private readonly page: Page) {}

	name(fullName: string) {
		return this.page.getByRole("heading", { name: fullName, level: 1 });
	}

	/** "EMP-001 — Teacher (Academics)" under the name. */
	summary(employeeCode: string) {
		return this.page.getByText(new RegExp(`^${employeeCode} — `));
	}
}
