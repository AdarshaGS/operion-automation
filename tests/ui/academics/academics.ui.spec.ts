// Academics screens. IDs refer to docs/SCENARIOS.md section 4 (ACA-U*).
// Everything created here is uniquely named in the shared organisation, uses a draft year that is
// never made current, and timetable periods are removed again, so other specs are unaffected.

import { test, expect } from "../../../src/sanity/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { buildAcademicBase, createGrade, createYear, type AcademicBase } from "../../../src/api/academics";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";

async function draftYear(api: ApiClient) {
	const start = 2100 + Math.floor(Math.random() * 800);
	return createYear(api, { startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` });
}

async function campusName(api: ApiClient, campusId: number): Promise<string> {
	const campuses = await api.get("/api/v1/campuses");
	return campuses.body.find((c: { id: number }) => c.id === campusId).name;
}

function randomSlot(): { startTime: string; endTime: string } {
	const start = Math.floor(Math.random() * 140) * 10;
	const at = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
	return { startTime: at(start), endTime: at(start + 10) };
}

/** A draft-year academic structure with a uniquely named period and its names, ready for timetable work. */
async function timetableFixture(api: ApiClient) {
	const base = await buildAcademicBase(api, { markCurrent: false });
	const classes = await api.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } });
	const className: string = classes.body.find((c: { id: number }) => c.id === base.classId).displayName;
	const subjects = await api.get("/api/v1/subjects");
	const subjectName = (id: number): string => subjects.body.find((s: { id: number }) => s.id === id).name;
	const label = `UIP${uniqueSuffix().slice(-6)}`;
	const ordinal = 1000 + Math.floor(Math.random() * 100000);
	// Periods may not overlap, and other specs run in parallel in the same organisation: take a random
	// 10-minute slot and try another when it is already taken.
	let period = await api.post("/api/v1/timetable/periods", { body: { ordinal, label, ...randomSlot(), breakSlot: false } });
	for (let attempt = 0; attempt < 30 && period.status === 409; attempt++) {
		period = await api.post("/api/v1/timetable/periods", { body: { ordinal, label, ...randomSlot(), breakSlot: false } });
	}
	period.expectStatus([200, 201]);
	const cleanup = async () => {
		for (const sectionId of [base.sectionId, base.secondSectionId]) {
			const entries = await api.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId } });
			for (const entry of entries.body ?? []) await api.delete("/api/v1/timetable-entries/{id}", { params: { id: entry.id } });
		}
		await api.delete("/api/v1/timetable/periods/{id}", { params: { id: period.body.id } });
	};
	return { base, className, label, periodId: period.body.id as number, subjectName, cleanup };
}

test.describe("classes and sections", () => {
	test("ACA-U01 creates a class and then a section from the Academics screens", async ({ api, academics, classOfferings, sections }) => {
		const year = await draftYear(api);
		const gradeId = await createGrade(api);
		const grade = (await api.get("/api/v1/grade-levels")).body.find((g: { id: number }) => g.id === gradeId).name;
		const campus = await campusName(api, (await api.get("/api/v1/campuses")).body[0].id);
		const displayName = `UI Class ${uniqueSuffix()}`;

		await academics.open("Class offerings");
		await classOfferings.openAdd();
		await classOfferings.fillClass({ year: year.name, campus, grade, displayName });
		await classOfferings.submitAdd();
		await expect(classOfferings.row(displayName)).toBeVisible();
		await expect(classOfferings.row(displayName)).toContainText(year.name);
		await expect(classOfferings.row(displayName)).toContainText("ACTIVE");

		const created = (await api.get("/api/v1/school-classes", { query: { academicYearId: year.id } })).body.find((c: { displayName: string }) => c.displayName === displayName);
		expect(created.gradeLevelId).toBe(gradeId);

		await academics.openTab("Sections");
		await academics.selectClassOffering(displayName);
		await sections.openAdd();
		await sections.fillSection({ name: "A", capacity: "25", room: "Room 7" });
		await sections.submitAdd();
		await expect(sections.row("Room 7")).toBeVisible();
		await expect(sections.row("Room 7")).toContainText("25");
		(await api.get("/api/v1/school-classes/{classId}/sections", { params: { classId: created.id } })).expectJson((list) => {
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ name: "A", capacity: 25, room: "Room 7" });
		});
	});

	test("ACA-U01 a class can be renamed and deactivated from the table", async ({ api, academics, classOfferings }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const before = (await api.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).body.find((c: { id: number }) => c.id === base.classId).displayName;
		const renamed = `Renamed ${uniqueSuffix()}`;
		await academics.open("Class offerings");
		await classOfferings.rename(before, renamed);
		await expect(classOfferings.row(renamed)).toBeVisible();
		await classOfferings.toggleStatus(renamed);
		await expect(classOfferings.row(renamed)).toContainText("INACTIVE");
		(await api.get("/api/v1/school-classes", { query: { academicYearId: base.yearId } })).expectJson((list) => {
			expect(list.find((c: { id: number }) => c.id === base.classId)).toMatchObject({ displayName: renamed, status: "INACTIVE" });
		});
	});

	test("ACA-U01 a duplicate class shows its error where the user can see it", async ({ api, academics, classOfferings }) => {
		const base = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
		const year = (await api.get("/api/v1/academic-years")).body.find((y: { id: number }) => y.id === base.yearId).name;
		const grade = (await api.get("/api/v1/grade-levels")).body.find((g: { id: number }) => g.id === base.gradeId).name;
		await academics.open("Class offerings");
		await classOfferings.openAdd();
		await classOfferings.fillClass({ year, campus: await campusName(api, base.campusId), grade, displayName: `Dup ${uniqueSuffix()}` });
		await classOfferings.submitAdd();
		// The dialog stays open on failure; the message must be inside it, not hidden behind it.
		await expect(classOfferings.addDialog().getByRole("alert")).toBeVisible();
	});
});

test.describe("academic year switcher", () => {
	test("ACA-U02 the top bar lists the years and the selection survives a reload", async ({ api, page, academics, topBar }) => {
		const other = await draftYear(api);
		await academics.open();
		expect(await topBar.yearOptions()).toContain(other.name);
		await topBar.selectYear(other.name);
		await expect(topBar.yearButton()).toContainText(other.name);
		expect(await page.evaluate(() => localStorage.getItem("operion.selectedAcademicYearId"))).toBe(String(other.id));

		await page.reload();
		await expect(topBar.yearButton()).toContainText(other.name);
	});

	test("ACA-U02 the current year is selected on a first visit", async ({ api, page, academics, topBar }) => {
		await page.addInitScript(() => localStorage.removeItem("operion.selectedAcademicYearId"));
		await academics.open();
		const current = (await api.get("/api/v1/academic-years")).body.find((y: { current: boolean }) => y.current);
		await expect(topBar.yearButton()).toContainText(current.name);
	});
});

test.describe("timetable grid", () => {
	test("ACA-U03 places a subject and teacher in a cell and it persists after a reload", async ({ api, academics, timetable }) => {
		const fx = await timetableFixture(api);
		try {
			const pair = `${fx.subjectName(fx.base.subjectId)} — Tej`;
			await academics.open("Timetable");
			await academics.selectClassAndSection(fx.className, "A");
			await expect(timetable.cell("MONDAY", fx.label)).toHaveText("+");
			await timetable.place("MONDAY", fx.label, pair);
			await expect(timetable.cell("MONDAY", fx.label)).toContainText(fx.subjectName(fx.base.subjectId));
			await expect(timetable.cell("MONDAY", fx.label)).toContainText("Tej");

			await academics.open("Timetable");
			await academics.selectClassAndSection(fx.className, "A");
			await expect(timetable.cell("MONDAY", fx.label)).toContainText(fx.subjectName(fx.base.subjectId));
			(await api.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: fx.base.sectionId } })).expectJson((list) => {
				expect(list).toHaveLength(1);
				expect(list[0]).toMatchObject({ dayOfWeek: "MONDAY", periodId: fx.periodId, subjectId: fx.base.subjectId });
			});
		} finally {
			await fx.cleanup();
		}
	});

	test("ACA-U03 clearing a slot empties the cell", async ({ api, academics, timetable }) => {
		const fx = await timetableFixture(api);
		try {
			const pair = `${fx.subjectName(fx.base.subjectId)} — Tej`;
			await academics.open("Timetable");
			await academics.selectClassAndSection(fx.className, "A");
			await timetable.place("TUESDAY", fx.label, pair);
			await timetable.openCell("TUESDAY", fx.label);
			await timetable.clearSlot();
			await expect(timetable.dialog()).toBeHidden();
			await expect(timetable.cell("TUESDAY", fx.label)).toHaveText("+");
			(await api.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: fx.base.sectionId } })).expectJson((list) => expect(list).toEqual([]));
		} finally {
			await fx.cleanup();
		}
	});

	test("ACA-U03 only teachers assigned to the section are offered", async ({ api, academics, timetable }) => {
		const fx = await timetableFixture(api);
		try {
			await academics.open("Timetable");
			await academics.selectClassAndSection(fx.className, "A");
			await timetable.openCell("MONDAY", fx.label);
			await timetable.dialog().getByRole("combobox", { name: "Subject — teacher" }).click();
			const options = await timetable.dialog().page().getByRole("option").allTextContents();
			expect(options.length).toBeGreaterThan(0);
			for (const option of options) expect(option).toContain("Tej");
			expect(options.join(" ")).not.toContain("Tara");
		} finally {
			await fx.cleanup();
		}
	});

	test("ACA-U04 a teacher clash shows an inline error and saves nothing", async ({ api, academics, timetable }) => {
		const fx = await timetableFixture(api);
		try {
			const { base } = fx;
			// Tara takes section A's subject too, then is booked into section B for the same slot.
			(await api.post("/api/v1/sections/{sectionId}/teacher-assignments", { params: { sectionId: base.sectionId }, body: { subjectId: base.subjectId, teacherPersonId: base.teacherPersonId, assignmentType: "SUBJECT", startDate: "2026-06-01" } })).expectStatus([200, 201]);
			(await api.put("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.secondSectionId }, body: { subjectId: base.subjectId, teacherPersonId: base.teacherPersonId, dayOfWeek: "MONDAY", periodId: fx.periodId } })).expectStatus(200);

			await academics.open("Timetable");
			await academics.selectClassAndSection(fx.className, "A");
			await timetable.openCell("MONDAY", fx.label);
			await timetable.choosePair(`${fx.subjectName(base.subjectId)} — Tara`);
			await timetable.save();

			await expect(timetable.dialogError()).toBeVisible();
			await expect(timetable.dialog()).toBeVisible();
			await timetable.dialog().getByRole("button", { name: "Cancel" }).click();
			await expect(timetable.cell("MONDAY", fx.label)).toHaveText("+");
			(await api.get("/api/v1/sections/{sectionId}/timetable", { params: { sectionId: base.sectionId } })).expectJson((list) => expect(list).toEqual([]));
		} finally {
			await fx.cleanup();
		}
	});
});

test.describe("school day periods", () => {
	test("ACA-U06 adds, edits and deletes a period", async ({ api, academics, periods }) => {
		const label = `UIP${uniqueSuffix().slice(-6)}`;
		const ordinal = String(2000 + Math.floor(Math.random() * 100000));
		await academics.open("Periods");
		await periods.openAdd();
		await periods.fill({ ordinal, label, start: "22:00", end: "22:30" });
		await periods.submit();
		await expect(periods.row(label)).toBeVisible();
		await expect(periods.row(label)).toContainText("22:00");
		await expect(periods.row(label)).toContainText("Class period");

		await periods.openEdit(label);
		await periods.fill({ label: `${label}x`, start: "22:00", end: "22:45", breakSlot: true });
		await periods.submit();
		await expect(periods.row(`${label}x`)).toContainText("22:45");
		await expect(periods.row(`${label}x`)).toContainText("Break");

		try {
			await periods.delete(`${label}x`);
			await expect(periods.row(`${label}x`)).toHaveCount(0);
			(await api.get("/api/v1/timetable/periods")).expectJson((list) => expect(list.map((p: { label: string }) => p.label)).not.toContain(`${label}x`));
		} finally {
			const left = (await api.get("/api/v1/timetable/periods")).body.find((p: { label: string }) => p.label === `${label}x`);
			if (left) await api.delete("/api/v1/timetable/periods/{id}", { params: { id: left.id } });
		}
	});

	test("ACA-U06 an end time before the start shows the error inside the dialog", async ({ academics, periods }) => {
		await academics.open("Periods");
		await periods.openAdd();
		await periods.fill({ ordinal: String(3000 + Math.floor(Math.random() * 100000)), label: `Bad${uniqueSuffix().slice(-5)}`, start: "10:00", end: "09:00" });
		await periods.submit();
		await expect(periods.dialog().getByRole("alert")).toContainText(/end/i);
	});
});

test.describe("events calendar", () => {
	// Communication is off by default for a new organisation (Operion ModuleAccessService), and the calendar page lives in it.
	test.beforeEach(async ({ api }) => {
		const { enableModule } = await import("../../../src/setup/provisioning");
		await enableModule((await api.get("/api/v1/auth/me")).expectStatus(200).body.organisationId, "COMMUNICATION");
	});

	function dayInCurrentMonth(day: number): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}

	test("ACA-U05 a working-calendar holiday and a school event both render on the month grid", async ({ api, eventCalendar }) => {
		const year = (await api.get("/api/v1/academic-years")).body.find((y: { current: boolean }) => y.current);
		const holiday = `Holiday ${uniqueCode("H")}`;
		const title = `Event ${uniqueCode("E")}`;
		const entry = await api.post("/api/v1/academic/working-calendar", { body: { academicYearId: year.id, date: dayInCurrentMonth(21), label: holiday, type: "HOLIDAY" } });
		entry.expectStatus([200, 201]);
		try {
			await eventCalendar.open();
			await expect(eventCalendar.chip(holiday)).toBeVisible();

			await eventCalendar.openAdd();
			await eventCalendar.fillEvent({ date: dayInCurrentMonth(22), title, description: "Added from the calendar" });
			await eventCalendar.submitAdd();
			await expect(eventCalendar.chip(title)).toBeVisible();
			(await api.get("/api/v1/academic/school-events", { query: { from: dayInCurrentMonth(1), to: dayInCurrentMonth(28) } })).expectJson((list) => {
				expect(list.find((e: { title: string }) => e.title === title)).toMatchObject({ date: dayInCurrentMonth(22), description: "Added from the calendar" });
			});

			await eventCalendar.nextMonth();
			await expect(eventCalendar.chip(title)).toHaveCount(0);
			await eventCalendar.previousMonth();
			await expect(eventCalendar.chip(title)).toBeVisible();
		} finally {
			await api.delete("/api/v1/academic/working-calendar/{id}", { params: { id: entry.body.id } });
			const events = await api.get("/api/v1/academic/school-events", { query: { from: dayInCurrentMonth(1), to: dayInCurrentMonth(28) } });
			for (const event of events.body.filter((e: { title: string }) => e.title === title)) await api.delete("/api/v1/academic/school-events/{id}", { params: { id: event.id } });
		}
	});

	test("ACA-U05 an event can be removed from the grid", async ({ api, eventCalendar }) => {
		const title = `Remove ${uniqueCode("E")}`;
		const created = await api.post("/api/v1/academic/school-events", { body: { date: dayInCurrentMonth(23), title } });
		created.expectStatus([200, 201]);
		try {
			await eventCalendar.open();
			await expect(eventCalendar.chip(title)).toBeVisible();
			await eventCalendar.chip(title).locator("..").locator(".MuiChip-deleteIcon").click();
			await expect(eventCalendar.chip(title)).toHaveCount(0);
			(await api.get("/api/v1/academic/school-events", { query: { from: dayInCurrentMonth(1), to: dayInCurrentMonth(28) } })).expectJson((list) => {
				expect(list.map((e: { id: number }) => e.id)).not.toContain(created.body.id);
			});
		} finally {
			await api.delete("/api/v1/academic/school-events/{id}", { params: { id: created.body.id } });
		}
	});
});
