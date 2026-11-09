// Settings > Imports & exports in the browser: the cards, template downloads, the validate -> preview
// -> confirm dialog, the export tab, import history and role access. IDs refer to docs/SCENARIOS.md
// section 29 (IMP-U*). The API side is in tests/api/imports-exports. Scenarios that create data work
// in a throwaway organisation (signed in by seeding its session), so rows and history start empty.

import { test, expect } from "../../../src/sanity/fixtures";
import { createOtherOrganisation, type OtherOrganisation } from "../../../src/api/organisations";
import { IMPORT_ENTITIES, csvFile, entity, subjectsCsv, xlsxFile } from "../../../src/api/imports";
import { uniqueCode } from "../../../src/api/data";
import { UI_BASE_URL } from "../../../src/config/env";
import { storageStateFor } from "../../../src/ui/session";
import { storageStatePath } from "../../../src/setup/session";
import { ImportsExportsPanel } from "../../../src/pages/settings/SettingsPage";
import type { Browser } from "@playwright/test";
import type { RecordedCall } from "../../../src/api/apiClient";

/** A browser page signed in as the owner of a brand-new organisation. */
async function inFreshOrganisation(browser: Browser, request: Parameters<typeof createOtherOrganisation>[0], calls: RecordedCall[]) {
	const org = await createOtherOrganisation(request, calls);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(org.session, UI_BASE_URL) });
	const page = await context.newPage();
	return { org, context, page, panel: new ImportsExportsPanel(page) };
}

const subjectCodes = async (org: OtherOrganisation) => ((await org.client.get("/api/v1/subjects")).body as { code: string }[]).map((s) => s.code);

test.describe("the page", () => {
	test("IMP-U01 the Import tab groups every importable entity into a card with a description, a template and an Import button", async ({ importsExports, page }) => {
		await importsExports.open();
		await expect(page.getByRole("tab", { name: "Import data" })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("button", { name: "View import history" })).toBeVisible();
		for (const group of ["People", "Academics", "Finance", "Operations", "Library"]) await expect(importsExports.groupHeading(group)).toBeVisible();
		await expect(importsExports.cards()).toHaveCount(IMPORT_ENTITIES.length);
		for (const e of IMPORT_ENTITIES) {
			const card = importsExports.card(e.label);
			await expect(card, e.label).toBeVisible();
			await expect(card.getByRole("button", { name: "Download template" })).toBeVisible();
			await expect(card.getByRole("button", { name: "Import", exact: true })).toBeVisible();
		}
	});

	test("IMP-U02 each entity sits under its group", async ({ importsExports }) => {
		await importsExports.open();
		const groups: Record<string, string[]> = {
			People: ["Staff", "Students", "Parents / Guardians"],
			Academics: ["Classes & sections", "Subjects", "Student enrolments"],
			Finance: ["Fee structures", "Opening balances"],
			Operations: ["Inventory items", "Vehicles & routes"],
			Library: ["Books"],
		};
		for (const [group, labels] of Object.entries(groups)) {
			const section = importsExports.groupHeading(group).locator("xpath=..");
			for (const label of labels) await expect(section.getByText(label, { exact: true }), `${label} under ${group}`).toBeVisible();
		}
	});

	test("IMP-U03 the Export tab offers one button per entity", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.openTab("Export data");
		for (const e of IMPORT_ENTITIES) await expect(importsExports.exportButton(e.label), e.label).toBeVisible();
	});

	test("IMP-U04 clicking a card (not just its Import button) opens that entity's dialog with Download template and Upload file", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.card("Subjects").getByText("Import subject list.").click();
		await expect(importsExports.dialog().getByRole("heading", { name: "Import Subjects" })).toBeVisible();
		await expect(importsExports.dialog().getByRole("button", { name: "Download template" })).toBeVisible();
		await expect(importsExports.uploadButton()).toBeVisible();
		await importsExports.closeDialog();
	});
});

test.describe("template downloads", () => {
	for (const e of IMPORT_ENTITIES) {
		test(`IMP-U05 ${e.key}: the card's template is ${e.templateFile} with the importer's columns and one example row`, async ({ importsExports }) => {
			await importsExports.open();
			const file = await importsExports.downloadTemplate(e.label);
			expect(file.fileName).toBe(e.templateFile);
			const [header, example, ...rest] = file.text.split("\n");
			expect(header.split(",")).toEqual(e.templateHeaders);
			expect(example, "an example row").toBeTruthy();
			expect(example.split(",")).toHaveLength(e.templateHeaders.length);
			expect(rest.filter(Boolean)).toEqual([]);
		});
	}

	test("IMP-U06 the dialog offers the same template as the card", async ({ importsExports }) => {
		await importsExports.open();
		const fromCard = await importsExports.downloadTemplate("Subjects");
		await importsExports.openImport("Subjects");
		const fromDialog = await importsExports.downloadTemplateInDialog();
		expect(fromDialog.fileName).toBe(fromCard.fileName);
		expect(fromDialog.text).toBe(fromCard.text);
	});

	for (const e of IMPORT_ENTITIES.filter((x) => !x.legacy)) {
		test(`IMP-U07 ${e.key}: the downloaded template uploads back without any column being rejected`, async ({ importsExports }) => {
			await importsExports.open();
			const template = await importsExports.downloadTemplate(e.label);
			await importsExports.openImport(e.label);
			await importsExports.upload({ name: e.templateFile, mimeType: "text/csv", buffer: template.buffer });
			await expect(importsExports.chip("Total rows: 1")).toBeVisible();
			// Whatever the example row says about missing lookups (an unknown class, campus, student), it must never be that one of the template's own columns was not understood.
			const message = await importsExports.resultRow(2).innerText();
			expect(message, "the importer read every template column").not.toMatch(/is required|missing required column/i);
		});
	}
});

test.describe("importing through the dialog", () => {
	test("IMP-U10 upload -> validating -> preview -> confirm -> summary, and only the confirm saves anything", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const { file, codes } = subjectsCsv(3);
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(file);

			await expect(panel.chip("Total rows: 3")).toBeVisible();
			await expect(panel.chip("Valid: 3")).toBeVisible();
			await expect(panel.chip(/^Errors:/)).toHaveCount(0);
			await expect(panel.resultRows()).toHaveCount(3);
			await expect(panel.resultRow(2)).toContainText("VALID");
			await expect(panel.confirmButton()).toHaveText("Confirm import (3)");
			expect(await subjectCodes(org), "a preview saves nothing").toEqual([]);

			await panel.confirm();
			await expect(panel.chip("Imported: 3")).toBeVisible();
			await expect(panel.chip("Valid: 3")).toHaveCount(0);
			await expect(panel.resultRow(2)).toContainText("IMPORTED");
			await expect(panel.confirmButton()).toHaveCount(0);
			expect((await subjectCodes(org)).sort()).toEqual([...codes].sort());
			await panel.closeDialog();
		} finally {
			await context.close();
		}
	});

	test("IMP-U11 cancelling at the preview imports nothing, and reopening the dialog starts clean", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(subjectsCsv(2).file);
			await expect(panel.chip("Valid: 2")).toBeVisible();
			await panel.closeDialog();
			expect(await subjectCodes(org)).toEqual([]);

			await panel.openImport("Subjects");
			await expect(panel.uploadButton()).toBeVisible();
			await expect(panel.chip(/Total rows/)).toHaveCount(0);
			await panel.closeDialog();
		} finally {
			await context.close();
		}
	});

	test("IMP-U12 errors and duplicates are listed per row; only the valid rows are confirmed; the error report downloads", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const existing = uniqueCode("EXIST");
			const fresh = uniqueCode("FRESH");
			await org.client.post("/api/v1/subjects", { body: { name: `Existing ${existing}`, code: existing } });
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(csvFile(["name", "code"], [`Fresh ${fresh},${fresh}`, ",NONAME", `Again ${existing},${existing}`]));

			await expect(panel.chip("Total rows: 3")).toBeVisible();
			await expect(panel.chip("Valid: 1")).toBeVisible();
			await expect(panel.chip("Errors: 1")).toBeVisible();
			await expect(panel.chip("Duplicates: 1")).toBeVisible();
			await expect(panel.resultRow(2)).toContainText("VALID");
			await expect(panel.resultRow(3)).toContainText("ERROR");
			await expect(panel.resultRow(3)).toContainText(/name/i);
			await expect(panel.resultRow(4)).toContainText("DUPLICATE");
			await expect(panel.confirmButton()).toHaveText("Confirm import (1)");

			const report = await panel.downloadErrorReport();
			expect(report.fileName).toBe("subjects-import-errors.csv");
			const lines = report.text.split("\n");
			expect(lines[0]).toBe('"row","status","message"');
			expect(lines).toHaveLength(3);
			expect(lines[1]).toMatch(/^"3","ERROR",/);
			expect(lines[2]).toMatch(/^"4","DUPLICATE",/);

			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			await expect(panel.chip("Errors: 1")).toBeVisible();
			expect((await subjectCodes(org)).sort()).toEqual([existing, fresh].sort());
		} finally {
			await context.close();
		}
	});

	test("IMP-U13 when no row is valid the Confirm button is disabled", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.openImport("Subjects");
		await importsExports.upload(csvFile(["name", "code"], [",A", ",B"]));
		await expect(importsExports.chip("Errors: 2")).toBeVisible();
		await expect(importsExports.chip("Valid: 0")).toBeVisible();
		await expect(importsExports.confirmButton()).toBeDisabled();
		await importsExports.closeDialog();
	});

	test("IMP-U14 a clean file shows no Errors or Duplicates chip and no error-report button", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.openImport("Subjects");
		await importsExports.upload(subjectsCsv(1).file);
		await expect(importsExports.chip("Valid: 1")).toBeVisible();
		await expect(importsExports.chip(/^(Errors|Duplicates):/)).toHaveCount(0);
		await expect(importsExports.dialog().getByRole("button", { name: "Download error report" })).toHaveCount(0);
		await importsExports.closeDialog();
	});

	test("IMP-U15 an .xlsx workbook is accepted and imported like a CSV", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const code = uniqueCode("XL");
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(xlsxFile(["name", "code"], [[`Excel ${code}`, code]], "subjects.xlsx"));
			await expect(panel.chip("Valid: 1")).toBeVisible();
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			expect(await subjectCodes(org)).toEqual([code]);
		} finally {
			await context.close();
		}
	});

	test("IMP-U16 a file type the importer cannot read shows its message and lets the user try again", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.openImport("Subjects");
		await importsExports.upload({ name: "subjects.txt", mimeType: "text/plain", buffer: Buffer.from("name,code\nA,B\n") });
		await expect(importsExports.alert()).toContainText(/Unsupported file type/i);
		await expect(importsExports.uploadButton(), "back at the start step").toBeVisible();
		await importsExports.upload(subjectsCsv(1).file);
		await expect(importsExports.chip("Valid: 1")).toBeVisible();
		await expect(importsExports.alert()).toHaveCount(0);
		await importsExports.closeDialog();
	});

	test("IMP-U17 a header-only file previews zero rows and offers nothing to confirm", async ({ importsExports }) => {
		await importsExports.open();
		await importsExports.openImport("Subjects");
		await importsExports.upload(csvFile(["name", "code"], []));
		await expect(importsExports.chip("Total rows: 0")).toBeVisible();
		await expect(importsExports.confirmButton()).toBeDisabled();
		await importsExports.closeDialog();
	});

	test("IMP-U18 Students import has no preview step: it imports on upload and reports the rows", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			await panel.open();
			await panel.openImport("Students");
			await panel.upload(csvFile(["firstName", "admissionDate"], ["A,not-a-date", ",2026-06-01"], "students.csv"));
			await expect(panel.chip("Total rows: 2")).toBeVisible();
			await expect(panel.chip(/^Valid:/)).toHaveCount(0);
			await expect(panel.chip("Errors: 2")).toBeVisible();
			await expect(panel.confirmButton()).toHaveCount(0);
			await panel.closeDialog();
		} finally {
			await context.close();
		}
	});
});

test.describe("importing each kind of data", () => {
	test("IMP-U20 inventory items: a category-based CSV previews and confirms", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const category = (await org.client.post("/api/v1/inventory/categories", { body: { code: uniqueCode("CAT"), name: `Cat ${uniqueCode("N")}`, description: null } })).expectStatus(200).body;
			const code = uniqueCode("ITM");
			const e = entity("inventory-items");
			await panel.open();
			await panel.openImport("Inventory items");
			await panel.upload(csvFile(e.templateHeaders, [`${category.name},${code},Paper,ream,,20`], "items.csv"));
			await expect(panel.chip("Valid: 1")).toBeVisible();
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			expect(((await org.client.get(e.exportPath)).body as { code: string }[]).map((i) => i.code)).toEqual([code]);
		} finally {
			await context.close();
		}
	});

	test("IMP-U21 vehicles & routes: a vehicle with a route previews and confirms", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const campus = ((await org.client.get("/api/v1/campuses")).body as { name: string }[])[0].name;
			const e = entity("vehicles-routes");
			const reg = uniqueCode("KA01");
			await panel.open();
			await panel.openImport("Vehicles & routes");
			await panel.upload(csvFile(e.templateHeaders, [`${campus},${reg},BUS,40,,,Route 1,${uniqueCode("RT")}`], "vehicles.csv"));
			await expect(panel.chip("Valid: 1")).toBeVisible();
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			expect(((await org.client.get(e.exportPath)).body as { registrationNumber: string }[]).map((v) => v.registrationNumber)).toEqual([reg]);
		} finally {
			await context.close();
		}
	});

	test("IMP-U22 books: a CSV previews and confirms, and a repeated ISBN is flagged as a duplicate the second time", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const e = entity("books");
			const isbn = `978${String(Date.now()).slice(-10)}`;
			const file = csvFile(e.templateHeaders, [`${isbn},UI book,Author,Publisher,Reference,1st`], "books.csv");
			await panel.open();
			await panel.openImport("Books");
			await panel.upload(file);
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			await panel.closeDialog();

			await panel.openImport("Books");
			await panel.upload(file);
			await expect(panel.chip("Duplicates: 1")).toBeVisible();
			await expect(panel.chip("Valid: 0")).toBeVisible();
			expect(((await org.client.get(e.exportPath)).body as { isbn: string }[]).filter((b) => b.isbn === isbn)).toHaveLength(1);
		} finally {
			await context.close();
		}
	});

	test("IMP-U23 staff: an unknown department is flagged in the preview, naming it", async ({ importsExports }) => {
		const e = entity("staff");
		await importsExports.open();
		await importsExports.openImport("Staff");
		await importsExports.upload(csvFile(e.templateHeaders, [`Ravi,Menon,1985-01-01,MALE,,,${uniqueCode("EMP")},2020-06-01,PERMANENT,No Such Dept,No Such Role,No Such Campus`]));
		await expect(importsExports.chip("Errors: 1")).toBeVisible();
		await expect(importsExports.resultRow(2)).toContainText("No Such Dept");
		await expect(importsExports.confirmButton()).toBeDisabled();
		await importsExports.closeDialog();
	});
});

test.describe("exporting", () => {
	for (const e of IMPORT_ENTITIES) {
		test(`IMP-U30 ${e.key}: the Export tab downloads ${e.exportFile} with the documented columns`, async ({ importsExports }) => {
			await importsExports.open();
			const file = await importsExports.exportCsv(e.label);
			expect(file.fileName).toBe(e.exportFile);
			expect(file.text.split("\n")[0]).toBe(e.exportColumns.map((c) => `"${c}"`).join(","));
		});
	}

	test("IMP-U31 an export lists what the API returns, one line per record, in the documented column order", async ({ importsExports, api }) => {
		const code = uniqueCode("EXP");
		const made = (await api.post("/api/v1/subjects", { body: { name: `Exported ${code}`, code } })).expectStatus([200, 201]).body;
		await importsExports.open();
		const file = await importsExports.exportCsv("Subjects");
		const lines = file.text.split("\n");
		const records = (await api.get("/api/v1/subjects/export")).body as { id: number }[];
		expect(lines.length - 1, "one CSV line per exported subject").toBe(records.length);
		expect(lines).toContain(`"${made.id}","Exported ${code}","${code}","ACTIVE"`);
	});

	test("IMP-U32 an organisation with nothing to export still downloads a file with just the header", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			await panel.open();
			const file = await panel.exportCsv("Inventory items");
			expect(file.fileName).toBe("inventory-items.csv");
			expect(file.text.split("\n")).toEqual([entity("inventory-items").exportColumns.map((c) => `"${c}"`).join(",")]);
		} finally {
			await context.close();
		}
	});

	test("IMP-U33 what was imported in the dialog is in the next export", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const code = uniqueCode("ROUND");
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(csvFile(["name", "code"], [`Round ${code},${code}`]));
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			await panel.closeDialog();
			const file = await panel.exportCsv("Subjects");
			expect(file.text).toContain(`"Round ${code}","${code}"`);
		} finally {
			await context.close();
		}
	});

	test("IMP-U34 a value that starts with = + - or @ is neutralised in the exported file so a spreadsheet does not run it as a formula", async ({ browser, request, calls }) => {
		const { org, context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const code = uniqueCode("INJ");
			(await org.client.post("/api/v1/subjects", { body: { name: `=HYPERLINK("http://example.test","click")`, code } })).expectStatus([200, 201]);
			await panel.open();
			const file = await panel.exportCsv("Subjects");
			const line = file.text.split("\n").find((l) => l.includes(code)) ?? "";
			expect(line, "the exported line").toBeTruthy();
			const nameCell = line.split('","')[1];
			expect(nameCell, "the cell must not begin with a formula character").not.toMatch(/^[=+\-@]/);
		} finally {
			await context.close();
		}
	});
});

test.describe("import history", () => {
	test("IMP-U40 a new organisation's history says there are no imports yet", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			await panel.open();
			await panel.openHistory();
			await expect(panel.dialog().getByText("No imports yet.")).toBeVisible();
			await panel.dialog().getByRole("button", { name: "Close" }).click();
			await expect(panel.dialog()).toBeHidden();
		} finally {
			await context.close();
		}
	});

	test("IMP-U41 an import shows up in the history with its entity, file and counts, newest first", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			const code = uniqueCode("HIST");
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(csvFile(["name", "code"], [`Hist ${code},${code}`, ",NONAME", `Hist ${code},${code}`], "first-run.csv"));
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			await panel.closeDialog();

			await panel.openImport("Subjects");
			const second = uniqueCode("HIST");
			await panel.upload(csvFile(["name", "code"], [`Second ${second},${second}`], "second-run.csv"));
			await panel.confirm();
			await expect(panel.chip("Imported: 1")).toBeVisible();
			await panel.closeDialog();

			await panel.openHistory();
			await expect(panel.historyRows()).toHaveCount(2);
			await expect(panel.historyRows().nth(0)).toContainText("second-run.csv");
			await expect(panel.historyRows().nth(1)).toContainText("first-run.csv");
			const first = panel.historyRows().nth(1);
			await expect(first.getByRole("cell").nth(1)).toHaveText("Subject");
			await expect(first.getByRole("cell").nth(3), "total rows").toHaveText("3");
			await expect(first.getByRole("cell").nth(4), "imported").toHaveText("1");
			await expect(first.getByRole("cell").nth(5), "errors").toHaveText("1");
			await expect(first.getByRole("cell").nth(6), "duplicates").toHaveText("1");
			await expect(panel.historyRows().nth(0).getByRole("cell").nth(5), "no errors shows a dash").toHaveText("-");
		} finally {
			await context.close();
		}
	});

	test("IMP-U42 previewing without confirming leaves the history empty", async ({ browser, request, calls }) => {
		const { context, panel } = await inFreshOrganisation(browser, request, calls);
		try {
			await panel.open();
			await panel.openImport("Subjects");
			await panel.upload(subjectsCsv(1).file);
			await expect(panel.chip("Valid: 1")).toBeVisible();
			await panel.closeDialog();
			await panel.openHistory();
			await expect(panel.dialog().getByText("No imports yet.")).toBeVisible();
		} finally {
			await context.close();
		}
	});
});

test.describe("role access", () => {
	test.describe("signed in as read-only staff", () => {
		test.use({ storageState: storageStatePath("readOnlyStaff") });

		test("IMP-U50 an import is refused with the server's message, nothing is saved, and the dialog stays usable", async ({ importsExports, page, api }) => {
			const { file, codes } = subjectsCsv(1);
			await importsExports.open();
			await importsExports.openImport("Subjects");
			await importsExports.upload(file);
			await expect(importsExports.alert()).toBeVisible();
			await expect(importsExports.uploadButton()).toBeVisible();
			await importsExports.closeDialog();
			expect(((await api.get("/api/v1/subjects")).body as { code: string }[]).map((s) => s.code)).not.toContain(codes[0]);
			await expect(page).toHaveURL(/\/settings\/imports-exports/);
		});

		test("IMP-U51 an export still downloads for someone who may view the data", async ({ importsExports }) => {
			await importsExports.open();
			const file = await importsExports.exportCsv("Subjects");
			expect(file.fileName).toBe("subjects.csv");
		});
	});

	test.describe("signed in with no permissions", () => {
		test.use({ storageState: storageStatePath("noPermissions") });

		test("IMP-U52 an export the user may not run tells them so instead of failing silently, and downloads nothing", async ({ importsExports, page }) => {
			await importsExports.open();
			await importsExports.openTab("Export data");
			const downloads: string[] = [];
			page.on("download", (d) => downloads.push(d.suggestedFilename()));
			await importsExports.exportButton("Subjects").click();
			await expect(page.getByRole("alert").or(page.getByText(/permission|not allowed|forbidden|denied/i)).first(), "the user is told why nothing was downloaded").toBeVisible();
			expect(downloads).toEqual([]);
		});
	});
});
