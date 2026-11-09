// Sanity phase 12 - communication, UI only. Continues on the business from phases 01-11. Announcements are a core
// module (AppModule.defaultEnabled), so Communication is on for a new school without the operator touching it. The class teacher drafts a notice to all staff, but
// publishing needs the office: she is refused, and the owner publishes it. It lands in her own notifications, where
// she marks it read. The owner sends Grade 1 A a notice about the unit test results - the audience preview counts
// Aarav and his two guardians - and cancels a draft that should never go out. When the teacher switches in-app
// notifications off, the next staff notice still counts her (by email) but adds nothing to her in-app list.

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { signInAsStaff } from "../../src/sanity/staffSession";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, SANITY_COMMUNICATION as C } from "../../src/sanity/business";
import { PlatformLoginPage } from "../../src/pages/platform/PlatformLoginPage";
import { PlatformOrganisationsPage } from "../../src/pages/platform/PlatformOrganisationsPage";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, UI_BASE_URL } from "../../src/config/env";
import { EMPTY_STORAGE } from "../../src/ui/session";
import type { Locator, Page } from "@playwright/test";

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-11",
	inMenu: "Owner › Communication is in the menu from the start - announcements are a core module",
	operatorSeesOn: "Platform console › the operator sees Communication already switched on for this school",
	empty: "Communication › the owner sees no notifications, drafts or published announcements yet",
	teacherDraft: "Teacher › drafts a notice to all staff; the preview counts both staff members",
	teacherRefused: "Teacher › publishing is refused - that needs the office",
	ownerPublishes: "Owner › publishes the teacher's draft; it moves to the published feed",
	teacherReads: "Teacher › the staff notice is in her notifications and she marks it read",
	classNotice: "Owner › sends Grade 1 A a notice that reaches Aarav and his two guardians, not the teacher",
	cancel: "Owner › a draft that should not go out is cancelled and never published",
	preference: "Preferences › the teacher turns in-app notifications off; her email still counts her in the preview, but no new in-app notification arrives",
	handoff: "Hand-off › the published class notice is saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

const panel = (page: Page, heading: string) =>
	page.getByRole("heading", { name: heading, level: 6 }).locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]");
const draftRow = (page: Page, title: string) => panel(page, "Drafts").getByRole("row").filter({ hasText: title });
const feedRow = (page: Page, title: string) => panel(page, "Published feed").getByRole("row").filter({ hasText: title });

async function compose(page: Page, notice: { title: string; body: string }, audience: string, pick?: (form: Locator) => Promise<void>) {
	const form = panel(page, "Compose announcement");
	await form.getByLabel("Title").fill(notice.title);
	await form.getByLabel("Body").fill(notice.body);
	await form.getByRole("combobox", { name: "Audience" }).click();
	await page.getByRole("option", { name: audience, exact: true }).click();
	if (pick) await pick(form);
	return form;
}

async function previewSays(form: Locator, text: string) {
	await form.getByRole("button", { name: "Preview audience" }).click();
	await expect(form.getByText(text, { exact: true })).toBeVisible();
}

test("sanity 12: communication - on from the start, the teacher drafts, the owner publishes and staff are notified", async ({
	page, browser, diagnostics, loginPage,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(11);
	const student = business.student!;
	const classOption = `${student.className} · Main Campus`;

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.inMenu, async () => {
		await page.goto("/dashboard");
		await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Communication", exact: true })).toBeVisible();
	});

	await j.step(S.operatorSeesOn, async () => {
		const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: EMPTY_STORAGE });
		const operator = await context.newPage();
		const platformLogin = new PlatformLoginPage(operator);
		const organisations = new PlatformOrganisationsPage(operator);
		await platformLogin.open();
		await platformLogin.login(PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
		await expect(operator).toHaveURL(/\/platform\/dashboard/);
		await organisations.open();
		await organisations.openDetail(business.slug);
		await expect(organisations.moduleSwitch("Communication")).toBeChecked();
		await platformLogin.signOut();
		await context.close();
	});

	await j.step(S.empty, async () => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "Communication", exact: true }).click();
		await expect(page).toHaveURL(/\/communication$/);
		await expect(panel(page, "My notifications").getByText("No notifications yet.")).toBeVisible();
		await expect(panel(page, "Drafts").getByText("No drafts.")).toBeVisible();
		await expect(panel(page, "Published feed").getByText("No published announcements yet.")).toBeVisible();
	});

	const teacher = await signInAsStaff(browser, business, business.staff!.teacherEmail, business.staff!.teacherPassword, diagnostics);
	const tp = teacher.page;
	try {
		await j.step(S.teacherDraft, async () => {
			// Her class pickers read "Class #<id>" - the Teacher role cannot load grade names (5fw) - so she writes to
			// all staff, which needs no class.
			await tp.goto("/communication");
			const form = await compose(tp, C.staffNotice, "STAFF");
			await previewSays(form, `Will reach ${C.staffNotice.reach} people`);
			await form.getByRole("button", { name: "Save as draft" }).click();
			await expect(draftRow(tp, C.staffNotice.title).getByRole("cell")).toHaveText([C.staffNotice.title, "STAFF", "—", "PublishCancel"]);
			await expect(form.getByLabel("Title"), "the form is cleared for the next notice").toHaveValue("");
		});

		await j.step(S.teacherRefused, async () => {
			await draftRow(tp, C.staffNotice.title).getByRole("button", { name: "Publish" }).click();
			await expect(panel(tp, "Compose announcement").getByRole("alert")).toContainText("ANNOUNCEMENT_PUBLISH");
			await expect(draftRow(tp, C.staffNotice.title), "still a draft").toBeVisible();
			await expect(panel(tp, "Published feed").getByText("No published announcements yet.")).toBeVisible();
		});

		await j.step(S.ownerPublishes, async () => {
			await page.reload();
			await draftRow(page, C.staffNotice.title).getByRole("button", { name: "Publish" }).click();
			await expect(panel(page, "Drafts").getByText("No drafts.")).toBeVisible();
			const row = feedRow(page, C.staffNotice.title);
			await expect(row.getByRole("cell").nth(1)).toHaveText("STAFF");
			await expect(row.getByRole("cell").nth(2)).not.toHaveText("—");
			await expect(row.getByRole("cell").nth(3)).toHaveText("PUBLISHED");
			await expect(panel(page, "My notifications").getByText("No notifications yet."), "the owner is not on the staff list").toBeVisible();
		});

		await j.step(S.teacherReads, async () => {
			await tp.reload();
			await expect(feedRow(tp, C.staffNotice.title)).toBeVisible();
			const mine = panel(tp, "My notifications").getByRole("row").filter({ hasText: "IN_APP" });
			await expect(mine).toHaveCount(1);
			await expect(mine).toContainText("SENT");
			await mine.getByRole("button", { name: "Mark read" }).click();
			await expect(mine).toContainText("READ");
			await expect(mine.getByRole("button", { name: "Mark read" })).toHaveCount(0);
		});

		await j.step(S.classNotice, async () => {
			const form = await compose(page, C.classNotice, "SECTION", async (f) => {
				await f.getByRole("combobox", { name: "Class" }).click();
				await page.getByRole("option", { name: classOption, exact: true }).click();
				await f.getByRole("combobox", { name: "Section" }).click();
				await page.getByRole("option", { name: student.sectionName, exact: true }).click();
			});
			await previewSays(form, `Will reach ${C.classNotice.reach} people`);
			await form.getByRole("button", { name: "Save as draft" }).click();
			await draftRow(page, C.classNotice.title).getByRole("button", { name: "Publish" }).click();
			const row = feedRow(page, C.classNotice.title);
			await expect(row.getByRole("cell").nth(1)).toHaveText("SECTION");
			await expect(row.getByRole("cell").nth(3)).toHaveText("PUBLISHED");
			await tp.reload();
			await expect(feedRow(tp, C.classNotice.title), "staff see it in the feed").toBeVisible();
			await expect(panel(tp, "My notifications").getByRole("row").filter({ hasText: "IN_APP" }), "but it is not sent to her - only to the family").toHaveCount(1);
		});

		await j.step(S.cancel, async () => {
			const form = await compose(page, C.cancelled, "ORG");
			await form.getByRole("button", { name: "Save as draft" }).click();
			await draftRow(page, C.cancelled.title).getByRole("button", { name: "Cancel" }).click();
			await expect(panel(page, "Drafts").getByText("No drafts.")).toBeVisible();
			await expect(feedRow(page, C.cancelled.title)).toHaveCount(0);
		});

		await j.step(S.preference, async () => {
			const toggle = panel(tp, "My notifications").getByRole("switch", { name: "In-app notifications" });
			await expect(toggle).toBeChecked();
			await toggle.click();
			await expect(toggle).not.toBeChecked();
			await tp.reload();
			await expect(panel(tp, "My notifications").getByRole("switch", { name: "In-app notifications" }), "the choice is saved").not.toBeChecked();
			// Only the in-app channel is off: her email is on file, so the preview still counts her.
			const form = await compose(page, C.reminder, "STAFF");
			await previewSays(form, `Will reach ${C.staffNotice.reach} people`);
			await form.getByRole("button", { name: "Save as draft" }).click();
			await draftRow(page, C.reminder.title).getByRole("button", { name: "Publish" }).click();
			await expect(feedRow(page, C.reminder.title).getByRole("cell").nth(3)).toHaveText("PUBLISHED");
			await tp.reload();
			await expect(feedRow(tp, C.reminder.title)).toBeVisible();
			await expect(panel(tp, "My notifications").getByRole("row").filter({ hasText: "IN_APP" }), "no new in-app notification").toHaveCount(1);
		});
	} finally {
		await teacher.close();
	}

	await j.step(S.handoff, async () => {
		saveSanityBusiness({ ...business, completedPhase: 12, announcement: { title: C.classNotice.title } });
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
