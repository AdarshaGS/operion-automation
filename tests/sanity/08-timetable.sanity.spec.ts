// Sanity phase 08 - timetable, UI only. Continues on the business from phases 01-07. The owner sets
// up the school day under Academics > Periods (three teaching periods and a break), gives the
// teacher from phase 04 English and Science on Grade 1 A next to her Mathematics, then builds the
// section's weekly timetable by clicking cells of the grid: the dialog only offers subject+teacher
// pairs the section has an active assignment for. A slot is then replaced and another cleared, and
// the grid is checked again after a fresh load. The owner then sets each subject's weekly period quota
// on the class, lets "Generate draft" fill what the quota still needs, books a room for one slot, and
// publishes the timetable (draft and published are different states to the people who see it).

import { test, expect } from "../../src/sanity/phaseFixtures";
import { continueAsOwner } from "../../src/sanity/session";
import { holdForViewer, journey } from "../../src/sanity/journey";
import { loadSanityBusiness, saveSanityBusiness, sanityStaff, SANITY_TIMETABLE as T } from "../../src/sanity/business";

const DAY_LABEL: Record<string, string> = { MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday" };

const S = {
	ownerLogin: "Owner › continues the signed-in session from phases 01-07",
	periodsEmpty: "Periods › the school day has no periods yet",
	addPeriods: "Periods › add three teaching periods and a break",
	overlap: "Periods › a period overlapping an existing one is rejected",
	openSection: "Timetable › open Grade 1, section A at Main Campus",
	gridEmpty: "Timetable › the grid shows the periods, the break, and every teaching slot empty",
	noPairs: "Timetable › only Mathematics with the class teacher is offered before more subjects are assigned",
	assignMore: "Teacher assignment › the teacher also takes English and Science on this section",
	place: "Timetable › place the week's subjects slot by slot",
	replace: "Timetable › replace a slot's subject",
	clear: "Timetable › clear a slot",
	saved: "Timetable › the grid is the same after a fresh load",
	quotas: "Quotas › each subject's weekly periods are set on the class",
	chips: "Quotas › the section's timetable shows how many of each subject's periods are placed",
	generate: "Generate draft › the one missing Science period is filled, nothing already placed is moved",
	rooms: "Rooms › a room is added and booked for a slot",
	publish: "Publish › the timetable becomes published and can be exported",
	unpublishedEdit: "Publish › unpublishing returns it to draft",
	handoff: "Hand-off › the timetable is saved",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity 08: timetable - school-day periods defined, Grade 1 A's weekly grid built", async ({
	page, diagnostics, loginPage, academics, periods, classOfferings, classSubjects, sectionTeachers, timetable,
}) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));
	const business = loadSanityBusiness(7);
	const staff = sanityStaff(business.slug);
	const teacherName = `${staff.teacher.firstName} ${staff.teacher.lastName}`;
	const { className, section } = staff.assignment;
	const pair = (subject: string) => new RegExp(`^${subject} — ${teacherName}$`);
	const filled = new Map<string, string>(); // "DAY|Period" -> subject, what the grid should show
	let generatedSlots = 0; // slots "Generate draft" added on top of the ones placed by hand

	await j.step(S.ownerLogin, async () => {
		await continueAsOwner(page, loginPage, business);
	});

	await j.step(S.periodsEmpty, async () => {
		await academics.open("Periods");
		for (const p of T.periods) await expect(periods.row(p.label), `${p.label} does not exist yet`).toHaveCount(0);
	});

	await j.step(S.addPeriods, async () => {
		for (const p of T.periods) {
			await periods.openAdd();
			await periods.fill(p);
			await periods.submit();
			await periods.dialog().waitFor({ state: "hidden" });
			await expect(periods.row(p.label)).toBeVisible();
		}
	});

	await j.step(S.overlap, async () => {
		await periods.openAdd();
		await periods.fill({ ordinal: "9", label: "Overlapping", start: "08:45", end: "09:30" });
		await periods.submit();
		await expect(periods.dialog().getByRole("alert")).toContainText("overlap");
		await periods.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(periods.row("Overlapping")).toHaveCount(0);
	});

	await j.step(S.openSection, async () => {
		await academics.open("Class offerings");
		// The Classes list shows only the campus picked in the top bar (Main Campus in a fresh session), so rows carry no campus name.
		await classOfferings.row(business.academicYearName ?? "2026-27").filter({ has: page.getByRole("cell", { name: className, exact: true }) }).getByRole("cell", { name: className, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+$/);
		await page.getByRole("cell", { name: section, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+\/sections\/\d+$/);
	});

	await j.step(S.gridEmpty, async () => {
		await expect(page.getByRole("heading", { name: "Timetable", level: 6 })).toBeVisible();
		for (const p of T.periods) await expect(timetable.periodRow(p.label)).toBeVisible();
		// A break spans the whole row, so it has no weekday cells to click.
		await expect(timetable.periodRow("Short break").getByRole("cell")).toHaveCount(2);
		for (const day of Object.keys(DAY_LABEL)) {
			for (const p of T.periods.filter((x) => !x.breakSlot)) {
				await expect(timetable.cell(day, p.label), `${day} ${p.label} starts empty`).toHaveText("+");
			}
		}
	});

	await j.step(S.noPairs, async () => {
		await timetable.openCell("MONDAY", "Period 1");
		await timetable.dialog().getByRole("combobox", { name: "Subject — teacher" }).click();
		const options = page.getByRole("option");
		await expect(options, "only the one assignment from phase 04").toHaveCount(1);
		await expect(options.first()).toHaveText(`${staff.assignment.subject} — ${teacherName}`);
		await page.keyboard.press("Escape"); // closes the option list
		await timetable.dialog().getByRole("button", { name: "Cancel" }).click();
		await expect(timetable.dialog()).toBeHidden();
	});

	await j.step(S.assignMore, async () => {
		for (const subject of T.extraSubjects) {
			await sectionTeachers.assign({ type: "SUBJECT", subject, teacher: teacherName, startDate: staff.assignment.startDate });
			await expect(sectionTeachers.row("SUBJECT", teacherName).filter({ hasText: subject })).toBeVisible();
		}
	});

	await j.step(S.place, async () => {
		for (const slot of T.slots) {
			await timetable.place(slot.day, slot.period, pair(slot.subject));
			filled.set(`${slot.day}|${slot.period}`, slot.subject);
			await expect(timetable.cell(slot.day, slot.period)).toContainText(slot.subject);
			await expect(timetable.cell(slot.day, slot.period)).toContainText(teacherName);
		}
	});

	await j.step(S.replace, async () => {
		const { day, period, from, to } = T.replaced;
		await expect(timetable.cell(day, period)).toContainText(from);
		await timetable.place(day, period, pair(to));
		filled.set(`${day}|${period}`, to);
		await expect(timetable.cell(day, period)).toContainText(to);
		await expect(timetable.cell(day, period)).not.toContainText(from);
	});

	await j.step(S.clear, async () => {
		const { day, period } = T.cleared;
		await timetable.openCell(day, period);
		await timetable.clearSlot();
		await timetable.dialog().waitFor({ state: "hidden" });
		filled.delete(`${day}|${period}`);
		await expect(timetable.cell(day, period)).toHaveText("+");
	});

	await j.step(S.saved, async () => {
		await page.reload();
		await expect(timetable.periodRow("Period 1")).toBeVisible();
		for (const day of Object.keys(DAY_LABEL)) {
			for (const p of T.periods.filter((x) => !x.breakSlot)) {
				const subject = filled.get(`${day}|${p.label}`);
				if (subject) await expect(timetable.cell(day, p.label), `${day} ${p.label}`).toContainText(subject);
				else await expect(timetable.cell(day, p.label), `${day} ${p.label} is empty`).toHaveText("+");
			}
		}
	});

	const sectionPath = () => new URL(page.url()).pathname;

	await j.step(S.quotas, async () => {
		await page.goto(sectionPath().replace(/\/sections\/\d+$/, ""));
		await expect(classSubjects.heading()).toBeVisible();
		for (const [subject, periods] of Object.entries(T.quotas)) {
			await classSubjects.setWeeklyPeriods(subject, periods);
			await expect(classSubjects.row(subject)).toContainText(String(periods));
		}
	});

	await j.step(S.chips, async () => {
		await page.getByRole("cell", { name: section, exact: true }).click();
		await expect(page).toHaveURL(/\/academics\/classes\/\d+\/sections\/\d+$/);
		await expect(page.getByLabel("Timetable draft")).toBeVisible();
		const chips = page.getByLabel("Weekly subject quotas");
		const placed = (subject: string) => [...filled.values()].filter((s) => s === subject).length;
		for (const [subject, quota] of Object.entries(T.quotas)) {
			await expect(chips.getByText(`${subject} ${placed(subject)}/${quota}`, { exact: true })).toBeVisible();
		}
	});

	await j.step(S.generate, async () => {
		const before = new Map(filled);
		await page.getByRole("button", { name: "Generate draft" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
		await expect(page.getByRole("dialog").getByText("Placed 1 period.")).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
		await expect(page.getByLabel("Weekly subject quotas").getByText(`Science ${T.quotas.Science}/${T.quotas.Science}`, { exact: true })).toBeVisible();
		for (const [key, subject] of before) {
			const [day, period] = key.split("|");
			await expect(timetable.cell(day, period), `${day} ${period} is where it was`).toContainText(subject);
		}
		generatedSlots = 1;
	});

	await j.step(S.rooms, async () => {
		const section = sectionPath(); // read before leaving the section page
		await academics.open("Rooms");
		await page.getByRole("button", { name: "Add room" }).click();
		await page.getByRole("dialog").getByLabel("Name").fill(T.room.name);
		await page.getByRole("dialog").getByLabel("Type").fill(T.room.type);
		await page.getByRole("dialog").getByLabel("Capacity").fill(String(T.room.capacity));
		await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
		await page.getByRole("dialog").waitFor({ state: "hidden" });
		await expect(page.getByRole("row").filter({ hasText: T.room.name })).toContainText("Active");

		await page.goto(section);
		const { day, period, subject } = T.slots[0];
		await timetable.openCell(day, period);
		await timetable.dialog().getByRole("combobox", { name: "Room" }).click();
		await page.getByRole("option", { name: T.room.name }).click();
		await timetable.save();
		await timetable.dialog().waitFor({ state: "hidden" });
		await expect(timetable.cell(day, period)).toContainText(T.room.name);
		await expect(timetable.cell(day, period)).toContainText(subject);
	});

	await j.step(S.publish, async () => {
		await page.getByRole("button", { name: "Publish" }).click();
		await expect(page.getByLabel("Timetable published")).toBeVisible();
		await expect(page.getByRole("button", { name: "Generate draft" })).toHaveCount(0);
		const download = page.waitForEvent("download");
		await page.getByRole("button", { name: "Export CSV" }).click();
		expect((await download).suggestedFilename()).toMatch(/\.csv$/);
		await page.reload();
		await expect(page.getByLabel("Timetable published")).toBeVisible();
	});

	await j.step(S.unpublishedEdit, async () => {
		await page.getByRole("button", { name: "Unpublish" }).click();
		await expect(page.getByLabel("Timetable draft")).toBeVisible();
	});

	await j.step(S.handoff, async () => {
		saveSanityBusiness({
			...business,
			completedPhase: 8,
			timetable: { className, sectionName: section, periods: T.periods.length, filledSlots: filled.size + generatedSlots },
		});
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});

	await holdForViewer(page);
});
