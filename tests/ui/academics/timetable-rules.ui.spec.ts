// Timetable screens added on top of the basic grid: rules and special slots under Academics > Periods, school days
// (period templates), the Rooms tab, the section timetable's draft/publish/generate/export controls, the
// Substitutions tab, a teacher's unavailable times, and the teacher / guardian portal weeks. IDs refer to
// docs/SCENARIOS.md section 4 (ACA-U07 and onward). The rules are organisation-wide, so every test builds its own
// throwaway organisation and signs the browser in as its owner.

import { test, expect } from "../../../src/sanity/fixtures";
import type { Page } from "@playwright/test";
import { createOtherOrganisation, organisationContext } from "../../../src/api/organisations";
import { AcademicsPage } from "../../../src/pages/academics/AcademicsPage";
import { PeriodsPanel } from "../../../src/pages/academics/PeriodsPanel";
import { TimetablePanel } from "../../../src/pages/academics/TimetablePanel";
import { ClassSubjectsPanel } from "../../../src/pages/academics/ClassSubjectsPanel";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { classSubjectIds, createRoom, firstWeekdayOnOrAfter, putEntry, setQuota, timetableBase } from "../../../src/api/timetable";
import { createPerson } from "../../../src/api/academics";
import { portalUser } from "../../../src/api/portal";

const sectionUrl = (classId: number, sectionId: number) => `/academics/classes/${classId}/sections/${sectionId}`;

test.describe("ACA-U07 school day rules and special slots", () => {
	test("ACA-U07 the owner sets a minimum gap, and a class period that starts too soon is refused inside the dialog", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const academics = new AcademicsPage(page);
			const periods = new PeriodsPanel(page);
			await academics.open("Periods");
			await page.getByLabel("Minimum gap between class periods (minutes)").fill("10");
			await page.getByRole("button", { name: "Save rules" }).click();
			await expect(page.getByText("Timetable rules saved.")).toBeVisible();
			expect((await org.client.get("/api/v1/timetable/settings")).body.gapMinutes).toBe(10);

			await periods.openAdd();
			await periods.fill({ ordinal: "1", label: "First", start: "09:00", end: "09:45" });
			await periods.submit();
			await expect(periods.row("First")).toContainText("Class period");

			await periods.openAdd();
			// The start time is offered as the previous end plus the gap.
			await expect(periods.dialog().getByLabel(/^Start/)).toHaveValue("09:55");
			await periods.fill({ ordinal: "2", label: "Second", start: "09:50", end: "10:30" });
			await periods.submit();
			await expect(periods.dialog().getByRole("alert")).toContainText("at least 10 minutes");
			await periods.fill({ label: "Second", start: "09:55", end: "10:30" });
			await periods.submit();
			await periods.dialog().waitFor({ state: "hidden" });
			await expect(periods.row("Second")).toBeVisible();
		});
	});

	test("ACA-U07 a special slot is added from the Kind select and shows as Special, a break as Break", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const periods = new PeriodsPanel(page);
			await new AcademicsPage(page).open("Periods");
			await periods.openAdd();
			await periods.fill({ ordinal: "0", label: "Assembly", start: "08:30", end: "09:00", kind: "SPECIAL" });
			await periods.submit();
			await expect(periods.row("Assembly")).toContainText("Special");
			await periods.openAdd();
			await periods.fill({ ordinal: "1", label: "Recess", start: "11:00", end: "11:15", kind: "BREAK" });
			await periods.submit();
			await expect(periods.row("Recess")).toContainText("Break");
			const list = (await org.client.get("/api/v1/timetable/periods")).body as { label: string; slotType: string }[];
			expect(list.map((p) => `${p.label}:${p.slotType}`).sort()).toEqual(["Assembly:SPECIAL", "Recess:BREAK"]);
		});
	});

	test("ACA-U07 a second school day is created, given its own periods, and the default day is not mixed with it", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const periods = new PeriodsPanel(page);
			await new AcademicsPage(page).open("Periods");
			await periods.openAdd();
			await periods.fill({ ordinal: "1", label: "Main 1", start: "09:00", end: "09:45" });
			await periods.submit();
			await expect(periods.row("Main 1")).toBeVisible();

			await page.getByRole("button", { name: "New school day" }).click();
			await page.getByRole("dialog").getByLabel(/Name/).fill("Junior wing");
			await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
			await page.getByRole("dialog").waitFor({ state: "hidden" });
			await expect(page.getByRole("combobox", { name: "School day" })).toContainText("Junior wing");
			await expect(periods.row("Main 1")).toHaveCount(0);

			await periods.openAdd();
			await periods.fill({ ordinal: "1", label: "Junior 1", start: "09:00", end: "09:30" });
			await periods.submit();
			await expect(periods.row("Junior 1")).toBeVisible();

			await page.getByRole("combobox", { name: "School day" }).click();
			await page.getByRole("option", { name: "Default school day" }).click();
			await expect(periods.row("Main 1")).toBeVisible();
			await expect(periods.row("Junior 1")).toHaveCount(0);
			const templates = (await org.client.get("/api/v1/timetable/templates")).body as { name: string; periodCount: number }[];
			expect(templates).toMatchObject([{ name: "Junior wing", periodCount: 1 }]);
		});
	});
});

test.describe("ACA-U08 rooms", () => {
	test("ACA-U08 adds a room, edits it, and a duplicate name shows the error in the dialog", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const academics = new AcademicsPage(page);
			await academics.open("Rooms");
			await expect(page.getByText("No rooms yet.")).toBeVisible();
			await page.getByRole("button", { name: "Add room" }).click();
			await page.getByRole("dialog").getByLabel("Name").fill("Physics lab");
			await page.getByRole("dialog").getByLabel("Type").fill("Lab");
			await page.getByRole("dialog").getByLabel("Capacity").fill("24");
			await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
			await page.getByRole("dialog").waitFor({ state: "hidden" });
			const row = page.getByRole("row").filter({ hasText: "Physics lab" });
			await expect(row).toContainText("Lab");
			await expect(row).toContainText("24");
			await expect(row).toContainText("Active");

			await page.getByRole("button", { name: "Add room" }).click();
			await page.getByRole("dialog").getByLabel("Name").fill("Physics lab");
			await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
			await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

			await row.getByRole("button", { name: "Edit" }).click();
			await page.getByRole("dialog").getByLabel("Active").uncheck();
			await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
			await page.getByRole("dialog").waitFor({ state: "hidden" });
			await expect(row).toContainText("Inactive");
			expect((await org.client.get("/api/v1/timetable/rooms")).body).toMatchObject([{ name: "Physics lab", active: false }]);
		});
	});
});

test.describe("ACA-U09 section timetable: draft, quotas, generate, publish, export", () => {
	test("ACA-U09 generates a draft from the quotas, publishes it, exports the CSV, and unpublishes", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const ids = await classSubjectIds(org.client, base.classId);
		(await setQuota(org.client, base.classId, ids.get(base.subjectId)!, 3)).expectStatus(200);
		(await setQuota(org.client, base.classId, ids.get(base.secondSubjectId)!, 2)).expectStatus(200);
		await inThrowawayOrg(browser, org.session, async (page) => {
			await page.goto(sectionUrl(base.classId, base.sectionId));
			await expect(page.getByRole("heading", { name: "Timetable", level: 6 })).toBeVisible();
			await expect(page.getByLabel("Timetable draft")).toBeVisible();
			await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
			await expect(page.getByLabel("Weekly subject quotas").getByText(/0\/3/)).toBeVisible();

			await page.getByRole("button", { name: "Generate draft" }).click();
			await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
			await expect(page.getByRole("dialog").getByText("Placed 5 periods.")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
			await expect(page.getByLabel("Weekly subject quotas").getByText(/3\/3/)).toBeVisible();
			await expect(page.getByLabel("Weekly subject quotas").getByText(/2\/2/)).toBeVisible();

			const download = page.waitForEvent("download");
			await page.getByRole("button", { name: "Export CSV" }).click();
			expect((await download).suggestedFilename()).toMatch(/\.csv$/);

			await page.getByRole("button", { name: "Publish" }).click();
			await expect(page.getByLabel("Timetable published")).toBeVisible();
			await expect(page.getByRole("button", { name: "Generate draft" })).toHaveCount(0);
			expect((await org.client.get("/api/v1/sections/{sectionId}/timetable/summary", { params: { sectionId: base.sectionId } })).body.published).toBe(true);

			await page.getByRole("button", { name: "Unpublish" }).click();
			await expect(page.getByLabel("Timetable draft")).toBeVisible();
		});
	});

	test("ACA-U09 a generate run that cannot fill a quota says which subject is short and why", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const ids = await classSubjectIds(org.client, base.classId);
		(await setQuota(org.client, base.classId, ids.get(base.subjectId)!, 40)).expectStatus(200);
		await inThrowawayOrg(browser, org.session, async (page) => {
			await page.goto(sectionUrl(base.classId, base.sectionId));
			await page.getByRole("button", { name: "Generate draft" }).click();
			await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
			await expect(page.getByRole("dialog").getByText(/could not be placed/)).toBeVisible();
			await expect(page.getByRole("dialog").getByText(/short - /)).toBeVisible();
		});
	});

	test("ACA-U09 a slot can hold a room, and the grid shows it; a room clash is shown in the dialog", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const room = await createRoom(org.client, "Hall");
		(await putEntry(org.client, base.secondSectionId, base.secondSubjectId, base.secondTeacherPersonId, "MONDAY", base.p1, room.id)).expectStatus(200);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const grid = new TimetablePanel(page);
			await page.goto(sectionUrl(base.classId, base.sectionId));
			await grid.openCell("MONDAY", "P1");
			await grid.dialog().getByRole("combobox", { name: "Subject — teacher" }).click();
			await page.getByRole("option").first().click();
			await grid.dialog().getByRole("combobox", { name: "Room" }).click();
			await page.getByRole("option", { name: "Hall" }).click();
			await grid.save();
			await expect(grid.dialogError()).toContainText("already booked");
			await grid.dialog().getByRole("combobox", { name: "Room" }).click();
			await page.getByRole("option", { name: "No room" }).click();
			await grid.save();
			await grid.dialog().waitFor({ state: "hidden" });
			await grid.openCell("TUESDAY", "P1");
			await grid.dialog().getByRole("combobox", { name: "Subject — teacher" }).click();
			await page.getByRole("option").first().click();
			await grid.dialog().getByRole("combobox", { name: "Room" }).click();
			await page.getByRole("option", { name: "Hall" }).click();
			await grid.save();
			await grid.dialog().waitFor({ state: "hidden" });
			await expect(grid.cell("TUESDAY", "P1")).toContainText("Hall");
		});
	});

	test("ACA-U09 the class's school day can be changed until it has slots", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const template = (await org.client.post("/api/v1/timetable/templates", { body: { name: "Short day" } })).expectStatus([200, 201]).body;
		(await org.client.post("/api/v1/timetable/periods", { body: { ordinal: 1, label: "S1", startTime: "13:00", endTime: "13:40", templateId: template.id } })).expectStatus([200, 201]);
		await inThrowawayOrg(browser, org.session, async (page) => {
			await page.goto(sectionUrl(base.classId, base.sectionId));
			await expect(page.getByText("School day: Default school day")).toBeVisible();
			await page.getByRole("button", { name: "Change school day" }).click();
			await page.getByRole("dialog").getByRole("combobox", { name: "School day" }).click();
			await page.getByRole("option", { name: "Short day" }).click();
			await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
			await page.getByRole("dialog").waitFor({ state: "hidden" });
			await expect(page.getByText("School day: Short day")).toBeVisible();
			await expect(new TimetablePanel(page).periodRow("S1")).toBeVisible();
			await expect(new TimetablePanel(page).periodRow("P1")).toHaveCount(0);
		});
	});
});

test.describe("ACA-U10 substitutions", () => {
	test("ACA-U10 finds an absent teacher's slots, assigns a free colleague, then removes the cover", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const monday = firstWeekdayOnOrAfter(base.yearStart, "MONDAY");
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		const persons = (await org.client.get("/api/v1/persons")).body as { id: number; firstName: string; lastName: string }[];
		const absent = persons.find((p) => p.id === base.teacherPersonId)!;
		const colleague = persons.find((p) => p.id === base.secondTeacherPersonId)!;
		await inThrowawayOrg(browser, org.session, async (page) => {
			await new AcademicsPage(page).open("Substitutions");
			await page.getByRole("combobox", { name: "Absent teacher" }).click();
			await page.getByRole("option", { name: `${absent.firstName} ${absent.lastName}` }).click();
			await page.getByLabel("From", { exact: true }).fill(monday);
			await page.getByLabel("To", { exact: true }).fill(monday);
			await page.getByLabel("Reason").fill("Sick leave");
			await page.getByRole("button", { name: "Find slots" }).click();
			const table = page.getByRole("table", { name: "Slots needing cover" });
			await expect(table).toContainText("P1");
			await table.getByRole("combobox", { name: "Substitute" }).click();
			await page.getByRole("option", { name: new RegExp(`${colleague.firstName} ${colleague.lastName}`) }).click();
			await table.getByRole("button", { name: "Assign" }).click();
			await expect(table).toContainText(`Covered by ${colleague.firstName} ${colleague.lastName}`);
			expect((await org.client.get("/api/v1/timetable/substitutions", { query: { date: monday } })).body).toMatchObject([{ reason: "Sick leave", substituteTeacherPersonId: base.secondTeacherPersonId }]);
			await table.getByRole("button", { name: "Remove" }).click();
			await expect(table.getByRole("combobox", { name: "Substitute" })).toBeVisible();
			expect((await org.client.get("/api/v1/timetable/substitutions", { query: { date: monday } })).body).toEqual([]);
		});
	});

	test("ACA-U10 a teacher with no slots in the range gets a plain message", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const person = (await org.client.get("/api/v1/persons")).body.find((p: { id: number }) => p.id === base.teacherPersonId);
		await inThrowawayOrg(browser, org.session, async (page) => {
			await new AcademicsPage(page).open("Substitutions");
			await page.getByRole("combobox", { name: "Absent teacher" }).click();
			await page.getByRole("option", { name: `${person.firstName} ${person.lastName}` }).click();
			await page.getByLabel("From", { exact: true }).fill(firstWeekdayOnOrAfter(base.yearStart, "MONDAY"));
			await page.getByLabel("To", { exact: true }).fill(firstWeekdayOnOrAfter(base.yearStart, "MONDAY"));
			await page.getByRole("button", { name: "Find slots" }).click();
			await expect(page.getByText("This teacher has no timetable slots in that period.")).toBeVisible();
		});
	});
});

test.describe("ACA-U13 quotas from the class page and rooms on an existing slot", () => {
	test("ACA-U13 a subject's weekly periods are set from its Edit dialog and the section's chips follow; a room is added to a slot that is already placed", async ({ browser, request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const base = await timetableBase(org.client);
		const subjects = (await org.client.get("/api/v1/subjects")).body as { id: number; name: string }[];
		const name = (id: number) => subjects.find((s) => s.id === id)!.name;
		const room = await createRoom(org.client, "Room 101");
		(await putEntry(org.client, base.sectionId, base.subjectId, base.teacherPersonId, "MONDAY", base.p1)).expectStatus(200);
		await inThrowawayOrg(browser, org.session, async (page) => {
			const classSubjects = new ClassSubjectsPanel(page);
			await page.goto(`/academics/classes/${base.classId}`);
			await expect(classSubjects.heading()).toBeVisible();
			await classSubjects.setWeeklyPeriods(name(base.subjectId), 3);
			await expect(classSubjects.row(name(base.subjectId))).toContainText("3");
			expect((await org.client.get("/api/v1/school-classes/{classId}/subjects", { params: { classId: base.classId } })).body.find((r: { subjectId: number }) => r.subjectId === base.subjectId).weeklyPeriods).toBe(3);

			await page.goto(sectionUrl(base.classId, base.sectionId));
			await expect(page.getByLabel("Weekly subject quotas").getByText(`${name(base.subjectId)} 1/3`, { exact: true })).toBeVisible();

			const grid = new TimetablePanel(page);
			await grid.openCell("MONDAY", "P1");
			await grid.dialog().getByRole("combobox", { name: "Room" }).click();
			await page.getByRole("option", { name: "Room 101" }).click();
			await grid.save();
			await grid.dialog().waitFor({ state: "hidden" });
			await expect(grid.cell("MONDAY", "P1")).toContainText("Room 101");
			await expect(grid.cell("MONDAY", "P1")).toContainText(name(base.subjectId));
			(await org.client.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).expectJson((entries) => expect(entries[0]).toMatchObject({ roomId: room.id, subjectId: base.subjectId }));
		});
	});
});
