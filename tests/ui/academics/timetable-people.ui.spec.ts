// The people side of the timetable: a teacher's unavailable times on their staff page, and the weekly timetable in
// the teacher and guardian portals. IDs refer to docs/SCENARIOS.md section 4 (ACA-U11, ACA-U12).

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { signedInAs } from "../../../src/ui/asUser";
import { attendanceSetup } from "../../../src/api/attendance";
import { createStaff } from "../../../src/api/hr";
import { guardianInPortalRole, portalUser } from "../../../src/api/portal";
import { putEntry, scratchPeriod, timetableBase } from "../../../src/api/timetable";

test.describe("ACA-U11 teacher unavailable times", () => {
	test("ACA-U11 blocks a day and a period from the staff page, which then refuses that slot; removing the block frees it", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const staff = await createStaff(org.client, (await organisationContext(org)).campusId, { personId: base.teacherPersonId });
		await inThrowawayOrg(browser, org.session, async (page) => {
			await page.goto(`/hr/staff/${staff.id}`);
			await expect(page.getByRole("heading", { name: "Unavailable times" })).toBeVisible();
			await expect(page.getByText("No unavailable times - this teacher can be given any slot.")).toBeVisible();

			await page.getByRole("combobox", { name: "Day" }).click();
			await page.getByRole("option", { name: "Monday" }).click();
			await page.getByRole("combobox", { name: "Period" }).click();
			await page.getByRole("option", { name: "P1" }).click();
			await page.getByLabel("Reason").fill("Union meeting");
			await page.getByRole("button", { name: "Add unavailable time" }).click();
			const chip = page.getByText(/Monday P1 · Union meeting/);
			await expect(chip).toBeVisible();

			(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(409);
			await page.getByRole("combobox", { name: "Day" }).click();
			await page.getByRole("option", { name: "Tuesday" }).click();
			await page.getByRole("combobox", { name: "Period" }).click();
			await page.getByRole("option", { name: "All day" }).click();
			await page.getByRole("button", { name: "Add unavailable time" }).click();
			await expect(page.getByText(/Tuesday all day/)).toBeVisible();
			(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "TUESDAY", base.p3)).expectStatus(409);

			await chip.locator("..").locator("svg").click();
			await expect(chip).toHaveCount(0);
			(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		});
	});
});

test.describe("ACA-U12 portal timetables", () => {
	test("ACA-U12 a teacher sees their published slots this week in the portal, and nothing from a draft", async ({ browser, request, calls, anon }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const teacher = await portalUser(org.client, anon, await organisationContext(org));
		(await org.client.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId }, body: { subjectId: base.subjectId, teacherPersonId: teacher.personId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
		(await putEntry(org.client, base.sectionId, base.subjectId, teacher.personId, "WEDNESDAY", base.p2)).expectStatus(200);
		const { page, context } = await signedInAs(browser, anon, org.slug, teacher.email);
		try {
			await page.goto("/portal/teacher/timetable");
			await expect(page.getByRole("heading", { name: /timetable/i, level: 5 })).toBeVisible();
			await expect(page.getByText(/Week of /)).toBeVisible();
			await expect(page.getByRole("table")).toHaveCount(0); // draft: nothing yet

			(await org.client.post("/api/v1/sections/{sectionId}/timetable/publish", { params: { sectionId: base.sectionId } })).expectStatus(200);
			await page.reload();
			await expect(page.getByRole("table")).toBeVisible();
			await expect(page.getByRole("cell", { name: /Subject/ })).toHaveCount(1);
			await page.getByRole("button", { name: "Next week" }).click();
			await expect(page.getByRole("cell", { name: /Subject/ })).toHaveCount(1); // the weekly pattern repeats
			await page.getByRole("button", { name: "This week" }).click();
			await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", /\/portal\/teacher/);
		} finally {
			await context.close();
		}
	});

	test("ACA-U12 a guardian opens the class timetable from the dashboard and sees only a published one", async ({ browser, api, anon, seed }) => {
		const setup = await attendanceSetup(api, 2, 1, { coverToday: true });
		const period = await scratchPeriod(api, [setup.sectionId]);
		try {
			(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: setup.sectionId }, body: { subjectId: setup.base.subjectId, teacherPersonId: setup.base.teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
			(await putEntry(api, setup.sectionId, setup.base.subjectId, setup.base.teacherPersonId, "THURSDAY", period.id)).expectStatus(200);
			const guardian = await guardianInPortalRole(api, anon, seed, [setup.studentIds[0]]);
			const { page, context } = await signedInAs(browser, anon, seed.organisationSlug, guardian.email);
			try {
				await page.goto(`/portal/guardian/children/${setup.studentIds[0]}/timetable`);
				await expect(page.getByText("The timetable for this class has not been published yet.")).toBeVisible();
				(await api.post("/api/v1/sections/{sectionId}/timetable/publish", { params: { sectionId: setup.sectionId } })).expectStatus(200);
				await page.reload();
				await expect(page.getByText("has not been published yet")).toHaveCount(0);
				await expect(page.getByRole("table")).toContainText(period.label);
			} finally {
				await context.close();
			}
		} finally {
			await period.cleanup();
		}
	});
});
