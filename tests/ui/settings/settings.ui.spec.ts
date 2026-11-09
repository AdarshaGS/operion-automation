// Settings and configuration screens: the hub, custom fields, branding, letter formats, ID-card studio and
// integrations, plus what a module switch does to the UI. IDs refer to docs/SCENARIOS.md section 23 (SET-U*).
// Business settings, profile, campuses, departments, designations, academic years and the school template are
// covered by the ORG-U* scenarios in tests/ui/organisation. Everything that saves organisation-wide
// configuration runs in a throwaway organisation.

import { test, expect } from "../../../src/sanity/fixtures";
import type { Browser, Page } from "@playwright/test";
import { createDisposableUser } from "../../../src/api/users";
import { admitStudent } from "../../../src/api/students";
import { buildAcademicBase } from "../../../src/api/academics";
import { uniqueCode } from "../../../src/api/data";
import { setExternalService, setModule } from "../../../src/setup/provisioning";
import { BRANDING, CUSTOM_FIELDS, DOC_TEMPLATES, ID_CARDS, EXTERNAL_SERVICES, archiveCustomField, createCustomField, idCardBody, jpeg, png, scratchOrg, type UploadFile } from "../../../src/api/settings";
import { BrandingPanel, CustomFieldsPanel, IdCardStudioPanel, IntegrationsPanel, LetterFormatsPanel } from "../../../src/pages/settings/ConfigurationPanels";
import { inThrowawayOrg } from "../../../src/ui/throwaway";
import { signedInAs } from "../../../src/ui/asUser";
import { AppLayoutPage } from "../../../src/pages/AppLayoutPage";
import { SETTINGS_SECTIONS } from "./sections";

type Scratch = Awaited<ReturnType<typeof scratchOrg>>;

/** A member of a throwaway organisation who holds `permissions`, signed in in a fresh browser context. */
async function asMember(browser: Browser, anon: Parameters<typeof createDisposableUser>[1], org: Scratch, permissions: string[]) {
	const user = await createDisposableUser(org.client, anon, { organisationSlug: org.slug, campusId: org.campusId }, permissions);
	const { page, context } = await signedInAs(browser, anon, org.slug, user.email);
	return { page, context, user };
}

test.describe("SET-U01 the settings hub", () => {
	test("SET-U01 the hub groups every section under Organisation, Access & Security, Configuration, Compliance and System", async ({ page, settings }) => {
		await settings.open();
		for (const group of ["Organisation", "Access & Security", "Configuration", "Compliance", "System"]) await expect(page.getByText(group, { exact: true }).first()).toBeVisible();
		for (const section of SETTINGS_SECTIONS) await expect(page.getByRole("button", { name: new RegExp(`^${section.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first(), section.label).toBeVisible();
	});

	for (const section of SETTINGS_SECTIONS) {
		test(`SET-U01 ${section.label} opens its page with no failing request or console error`, async ({ page, settings }) => {
			const problems: string[] = [];
			// A "Failed to load resource" console line carries no URL; the response entry below names the request.
			page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
			page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
			page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
			await settings.openSection(section.key as never);
			await expect(page.getByRole("heading", { name: section.label, level: 1 })).toBeVisible();
			await page.waitForLoadState("networkidle");
			// The bell's GET /notifications/me answers 403 while the Communication module is off (5ez); it is asserted once, on the dashboard.
			expect(problems.filter((p) => p !== "403 GET /api/v1/notifications/me")).toEqual([]);
		});
	}

	test("SET-U01 an unknown section goes back to the hub", async ({ page }) => {
		await page.goto("/settings/no-such-section");
		await expect(page).toHaveURL(/\/settings$/);
	});

	test("SET-U01 the back button on a section returns to the hub", async ({ page, settings }) => {
		await settings.openSection("branding");
		await page.getByRole("button", { name: "Back to settings" }).click();
		await expect(page).toHaveURL(/\/settings$/);
	});
});

test.describe("SET-U02 custom fields", () => {
	test("SET-U02 a field added in Settings is listed active and then offered on the new-student form", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await buildAcademicBase(org.client);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await expect(panel.row("No custom fields defined yet.")).toBeVisible();
			await panel.openDialog();
			await panel.fill({ label: "House", fieldKey: "house" });
			await panel.submit().click();
			await panel.dialog().waitFor({ state: "hidden" });
			await expect(panel.row("house")).toContainText(/Student.*House.*house.*Text.*No.*ACTIVE/s);
			await page.goto("/students/new");
			await expect(page.getByLabel("House")).toBeVisible();
		});
		expect((await org.client.get(CUSTOM_FIELDS)).body).toHaveLength(1);
	});

	test("SET-U02 each type shows the right input on the form: Yes/No a switch, Choice list a list of its choices", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await buildAcademicBase(org.client);
		await createCustomField(org.client, { label: "Needs bus", dataType: "BOOLEAN" });
		await createCustomField(org.client, { label: "Colour", dataType: "SELECT", options: "Red,Blue,Green" });
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			await page.goto("/students/new");
			await expect(page.getByLabel("Needs bus")).toBeVisible();
			await page.getByRole("combobox", { name: "Colour" }).click();
			await expect(page.getByRole("option")).toHaveText(["Red", "Blue", "Green"]);
		});
	});

	test("SET-U02 archiving removes the field from the form and activating brings it back", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await buildAcademicBase(org.client);
		const field = await createCustomField(org.client, { label: "Hobby" });
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await panel.row(field.fieldKey).getByRole("button", { name: /archive/i }).click();
			await expect(panel.row(field.fieldKey)).toContainText("ARCHIVED");
			await page.goto("/students/new");
			await page.waitForLoadState("networkidle");
			await expect(page.getByLabel("Hobby")).toHaveCount(0);
			await panel.open();
			await panel.row(field.fieldKey).getByRole("button", { name: /activate/i }).click();
			await expect(panel.row(field.fieldKey)).toContainText("ACTIVE");
			await page.goto("/students/new");
			await expect(page.getByLabel("Hobby")).toBeVisible();
		});
	});

	test("SET-U02 Add stays disabled until both the label and the key are filled", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await panel.openDialog();
			await expect(panel.submit()).toBeDisabled();
			await panel.fill({ label: "House" });
			await expect(panel.submit()).toBeDisabled();
			await panel.fill({ fieldKey: "house" });
			await expect(panel.submit()).toBeEnabled();
		});
	});

	test("SET-U02 a duplicate key shows its error inside the dialog where the user is looking", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		const existing = await createCustomField(org.client);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await panel.openDialog();
			await panel.fill({ label: "Again", fieldKey: existing.fieldKey });
			await panel.submit().click();
			await expect(panel.errorAlert(), "the server's error reaches the page").toHaveCount(1);
			await expect(panel.dialog().locator('[role="alert"].MuiAlert-colorError'), "the error is inside the dialog").toBeVisible();
		});
	});

	test("SET-U02 a Choice list cannot be added without any choices", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await panel.openDialog();
			await panel.chooseType("Choice list");
			await panel.fill({ label: "Colour", fieldKey: "colour" });
			const accepted = (await panel.submit().isEnabled()) && (await panel.submit().click().then(() => true));
			await page.waitForLoadState("networkidle");
			expect(accepted && (await org.client.get(CUSTOM_FIELDS)).body.length > 0, "a Choice list with no choices was saved").toBe(false);
		});
	});

	test("SET-U02 a value saved through the API is shown on the student's page", async ({ page, api }) => {
		const field = await createCustomField(api, { label: `Locker ${uniqueCode("L")}` });
		try {
			const student = await admitStudent(api, { customFields: { [field.fieldKey]: "B-14" } });
			await page.goto(`/students/${student.id}`);
			await expect(page.getByText(field.label, { exact: true }).first()).toBeVisible();
			await expect(page.getByText("B-14", { exact: true }).first()).toBeVisible();
		} finally {
			await archiveCustomField(api, field.id);
		}
	});

	test("SET-U02 a member without ORGANISATION_MANAGE is not offered Add custom field or Archive", async ({ browser, request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		const field = await createCustomField(org.client);
		const { page, context } = await asMember(browser, anon, org, ["STUDENT_VIEW"]);
		try {
			const panel = new CustomFieldsPanel(page);
			await panel.open();
			await page.waitForLoadState("networkidle");
			await expect(page.getByRole("button", { name: "Add custom field" }), "write button shown to a member who cannot use it").toHaveCount(0);
			await expect(panel.row(field.fieldKey).getByRole("button", { name: /archive/i })).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("SET-U03 branding", () => {
	test("SET-U03 a new organisation shows the default numbering formats", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new BrandingPanel(page);
			await panel.open();
			await expect(panel.field("Admission number format")).toHaveValue("STU-{YYYY}-{SEQ:4}");
			await expect(panel.field("Invoice number format")).toHaveValue("INV-{AY}-{SEQ:6}");
			await expect(panel.field("Receipt number format")).toHaveValue("RCT-{AY}-{SEQ:6}");
		});
	});

	test("SET-U03 text and number formats save, show a confirmation and survive a reload", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new BrandingPanel(page);
			await panel.open();
			await panel.set("School name override", "Automation Public School");
			await panel.set("Address line", "1 Test Road");
			await panel.set("Affiliation text", "Affiliated to the Test Board");
			await panel.set("Document footer", "Computer generated");
			await panel.set("Admission number format", "ADM-{SEQ:4}");
			await panel.save().click();
			await expect(panel.successAlert()).toBeVisible();
			await page.reload();
			await panel.heading().waitFor();
			await expect(panel.field("School name override")).toHaveValue("Automation Public School");
			await expect(panel.field("Address line")).toHaveValue("1 Test Road");
			await expect(panel.field("Document footer")).toHaveValue("Computer generated");
			await expect(panel.field("Admission number format")).toHaveValue("ADM-{SEQ:4}");
		});
		(await org.client.get(BRANDING)).expectJson((b) => expect(b).toMatchObject({ schoolNameOverride: "Automation Public School", admissionNumberFormat: "ADM-{SEQ:4}" }));
	});

	test("SET-U03 an uploaded logo is shown, saved and still shown after a reload", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new BrandingPanel(page);
			await panel.open();
			await panel.upload("School logo", png());
			await expect(panel.slotImage("School logo")).toBeVisible();
			await panel.save().click();
			await expect(panel.successAlert()).toBeVisible();
			await page.reload();
			await expect(panel.slotImage("School logo")).toBeVisible();
			const natural = await panel.slotImage("School logo").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
			expect(natural, "the saved logo actually loads").toBe(true);
		});
		expect((await org.client.get(BRANDING)).body.logoRef).toBeTruthy();
	});

	test("SET-U03 a file that is not an image is refused with a visible message and no logo is set", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new BrandingPanel(page);
			await panel.open();
			await panel.upload("School logo", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") } satisfies UploadFile);
			await expect(panel.errorAlert()).toContainText(/PNG, JPG, or PDF/i);
			await expect(panel.slotImage("School logo")).toHaveCount(0);
		});
	});

	test("SET-U03 a blank numbering format is refused and the stored one is kept", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new BrandingPanel(page);
			await panel.open();
			await panel.set("Receipt number format", "");
			await panel.save().click();
			await expect(panel.errorAlert().or(panel.save().filter({ hasNot: page.locator(":enabled") }))).toBeVisible();
		});
		expect((await org.client.get(BRANDING)).body.receiptNumberFormat).toBe("RCT-{AY}-{SEQ:6}");
	});

	test("SET-U03 a member without ORGANISATION_MANAGE sees the values read-only and no Save", async ({ browser, request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		const { page, context } = await asMember(browser, anon, org, ["STUDENT_VIEW"]);
		try {
			const panel = new BrandingPanel(page);
			await panel.open();
			await expect(panel.field("School name override")).toBeDisabled();
			await expect(panel.field("Admission number format")).toBeDisabled();
			await expect(panel.save()).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("SET-U04 letter formats", () => {
	test("SET-U04 a document's style, page size, font and subtext save and survive a reload", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new LetterFormatsPanel(page);
			await panel.open();
			await panel.choose("Template style", "Modern");
			await panel.choose("Page size", "Letter");
			await panel.field("Font style").fill("Serif");
			await panel.field("Font size").fill("14");
			await panel.field("Header subtext").fill("Half-Yearly Examination");
			await panel.save().click();
			await expect(page.getByRole("alert").filter({ hasText: "Template saved" })).toBeVisible();
			await page.reload();
			await panel.field("Font style").waitFor();
			await expect(panel.field("Font style")).toHaveValue("Serif");
			await expect(panel.field("Font size")).toHaveValue("14");
			await expect(panel.field("Header subtext")).toHaveValue("Half-Yearly Examination");
		});
		(await org.client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "QUESTION_PAPER_HEADER" } })).expectJson((t) => expect(t).toMatchObject({ templateStyle: "MODERN", pageSize: "Letter", fontStyle: "Serif", fontSize: 14, configured: true }));
	});

	test("SET-U04 the report card keeps its own settings, separate from the question paper header", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new LetterFormatsPanel(page);
			await panel.open();
			await panel.field("Font size").fill("16");
			await panel.save().click();
			await expect(page.getByRole("alert").filter({ hasText: "Template saved" })).toBeVisible();
			await panel.chooseDocument("Report card");
			await expect(panel.field("Font size")).toHaveValue("12");
		});
	});

	test("SET-U04 a font size of 0 is refused with a visible message and nothing is saved", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new LetterFormatsPanel(page);
			await panel.open();
			await panel.field("Font size").fill("0");
			await panel.save().click();
			await expect(panel.errorAlert()).toBeVisible();
		});
		(await org.client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "QUESTION_PAPER_HEADER" } })).expectJson((t) => expect(t.configured).toBe(false));
	});

	test("SET-U04 a member without ORGANISATION_MANAGE sees the template read-only and no Save", async ({ browser, request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		const { page, context } = await asMember(browser, anon, org, ["STUDENT_VIEW"]);
		try {
			const panel = new LetterFormatsPanel(page);
			await panel.open();
			await expect(panel.field("Font size")).toBeDisabled();
			await expect(panel.save()).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("SET-U05 ID card studio", () => {
	test("SET-U05 a template designed in the studio is saved with its elements and can be loaded again", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		const name = `Card ${uniqueCode("S")}`;
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const studio = new IdCardStudioPanel(page);
			await studio.open();
			await studio.field("Name").fill(name);
			await studio.field("Width (mm)").first().fill("60");
			await studio.field("Height (mm)").first().fill("90");
			await studio.addElement("Text box");
			await studio.save().click();
			await expect(studio.savedAlert()).toBeVisible();
			await page.reload();
			await studio.open();
			await studio.templatePicker().click();
			await page.getByRole("option", { name }).click();
			await expect(studio.field("Name")).toHaveValue(name);
		});
		(await org.client.get(ID_CARDS)).expectJson((list) => {
			const saved = list.find((t: { name: string }) => t.name === name);
			expect(saved).toMatchObject({ widthMm: 60, heightMm: 90 });
			expect(JSON.parse(saved.layoutJson).elements.length).toBeGreaterThan(0);
		});
	});

	test("SET-U05 the preview fills a card with a real student's name and admission number", async ({ page, api }) => {
		const student = await admitStudent(api, {}, { firstName: "Asha", lastName: `Verma${uniqueCode("v").slice(-4)}` });
		const template = (await api.post(ID_CARDS, { body: idCardBody() })).expectStatus(200).body;
		const studio = new IdCardStudioPanel(page);
		await studio.open();
		await studio.templatePicker().click();
		await page.getByRole("option", { name: template.name }).click();
		await page.getByRole("combobox", { name: "Student" }).click();
		await page.getByRole("option", { name: student.body.admissionNumber, exact: true }).click();
		await studio.previewButton().click();
		await expect(page.getByText(student.body.admissionNumber, { exact: true }).first()).toBeVisible();
		await expect(page.getByText(/^Asha Verma/).first()).toBeVisible();
	});

	test("SET-U05 Preview is disabled until the template has been saved", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const studio = new IdCardStudioPanel(page);
			await studio.open();
			await expect(studio.previewButton()).toBeDisabled();
		});
	});

	test("SET-U05 a member without ORGANISATION_MANAGE cannot add elements or save", async ({ browser, request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		const { page, context } = await asMember(browser, anon, org, ["STUDENT_VIEW"]);
		try {
			const studio = new IdCardStudioPanel(page);
			await studio.open();
			await expect(page.getByRole("button", { name: "Text box", exact: true })).toBeDisabled();
			await expect(page.getByRole("button", { name: "Save template" })).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("SET-U06 integrations", () => {
	test("SET-U06 a service the platform owner has not enabled is shown locked, with its fields hidden", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new IntegrationsPanel(page);
			await panel.open();
			const brevo = panel.card(/Brevo/);
			await expect(brevo.getByText("Not enabled")).toBeVisible();
			await expect(brevo.getByText(/Ask your platform administrator/)).toBeVisible();
			await expect(brevo.getByRole("button", { name: "Save" })).toHaveCount(0);
		});
	});

	test("SET-U06 an enabled service takes credentials; secrets are masked, saved, and never shown again", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await setExternalService(org.org.id, "brevo", true);
		const secret = `key-${uniqueCode("s")}`;
		await inThrowawayOrg(browser, org.org.session, async (page) => {
			const panel = new IntegrationsPanel(page);
			await panel.open();
			const brevo = panel.card(/Brevo/);
			await expect(brevo.getByText("Enabled", { exact: true })).toBeVisible();
			const apiKey = brevo.locator('input[type="password"]').first();
			await apiKey.fill(secret);
			await brevo.getByRole("button", { name: "Save" }).click();
			await expect(brevo.getByRole("alert").filter({ hasText: "Saved." })).toBeVisible();
			await expect(apiKey).toHaveValue("");
			await expect(apiKey).toHaveAttribute("placeholder", /configured/);
			await page.reload();
			await panel.open();
			expect(await page.content(), "the secret never comes back to the page").not.toContain(secret);
		});
		const list = (await org.client.get(EXTERNAL_SERVICES)).body;
		expect(JSON.stringify(list)).not.toContain(secret);
		expect(list.find((s: { serviceKey: string }) => s.serviceKey === "brevo").properties.find((p: { key: string }) => p.key === "email.api-key").configured).toBe(true);
	});

	test("SET-U06 a member without ORGANISATION_MANAGE sees the fields disabled and no Save", async ({ browser, request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		await setExternalService(org.org.id, "brevo", true);
		const { page, context } = await asMember(browser, anon, org, ["STUDENT_VIEW"]);
		try {
			const panel = new IntegrationsPanel(page);
			await panel.open();
			const brevo = panel.card(/Brevo/);
			await expect(brevo.locator("input").first()).toBeDisabled();
			await expect(brevo.getByRole("button", { name: "Save" })).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("SET-U07 a module switched off by the platform owner", () => {
	async function ownerPage(browser: Browser, org: Scratch, run: (page: Page) => Promise<void>) {
		await inThrowawayOrg(browser, org.org.session, run);
	}

	test("SET-U07 its sidebar entry disappears and comes back when it is switched on", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await ownerPage(browser, org, async (page) => {
			const layout = new AppLayoutPage(page);
			await layout.open("/settings");
			await expect(layout.navItem("Library")).toBeVisible();
			await setModule(org.org.id, "LIBRARY", false);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(layout.navItem("Library")).toHaveCount(0);
			await setModule(org.org.id, "LIBRARY", true);
			await page.reload();
			await expect(layout.navItem("Library")).toBeVisible();
		});
	});

	test("SET-U07 opening a switched-off module by direct link explains it instead of showing a raw error or an empty list", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await setModule(org.org.id, "LIBRARY", false);
		await ownerPage(browser, org, async (page) => {
			await page.goto("/library");
			await page.waitForLoadState("networkidle");
			await expect(page.getByText(/not enabled|not available|contact your (platform )?administrator/i).first(), "a message that the module is off").toBeVisible();
		});
	});

	test("SET-U07 a switched-off module's tiles are missing from the dashboard", async ({ browser, request, calls }) => {
		const org = await scratchOrg(request, calls);
		await setModule(org.org.id, "LIBRARY", false);
		await ownerPage(browser, org, async (page) => {
			await page.goto("/dashboard");
			await page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ }).waitFor();
			await page.waitForLoadState("networkidle");
			await expect(page.getByRole("heading", { name: "Library", exact: true, level: 6 })).toHaveCount(0);
		});
	});
});

void jpeg;
