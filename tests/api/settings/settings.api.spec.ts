// Settings and configuration APIs: branding, custom fields, document templates, ID-card templates, asset
// uploads, external services and module switches. IDs refer to docs/SCENARIOS.md section 23 (SET-*).
// Business settings, profile, school template and go-live are covered by the ORG-* scenarios in
// tests/api/organisation. Anything that changes organisation-wide configuration runs in a throwaway
// organisation so the shared one keeps its numbering formats, templates and entitlements.

import { test, expect } from "../../../src/api/fixtures";
import { API_BASE_URL } from "../../../src/config/env";
import { createDisposableUser } from "../../../src/api/users";
import { admitStudent } from "../../../src/api/students";
import { createBook } from "../../../src/api/library";
import { uniqueCode } from "../../../src/api/data";
import { setExternalService, setModule, moduleHistory } from "../../../src/setup/provisioning";
import {
	ASSETS, BRANDING, CUSTOM_FIELDS, DOC_TEMPLATES, EXTERNAL_SERVICES, ID_CARDS,
	archiveCustomField, brandingBody, createCustomField, customFieldBody, docTemplateBody, idCardBody, jpeg, paddedPng, pdf, png, scratchOrg, upload, uploadedRef,
} from "../../../src/api/settings";

const BAD = [400, 422];

test.describe("SET-01 branding", () => {
	test("SET-01 a new organisation has the default number formats and no assets", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.get(BRANDING)).expectStatus(200).expectJson((b) => {
			expect(b.admissionNumberFormat).toBe("STU-{YYYY}-{SEQ:4}");
			expect(b.invoiceNumberFormat).toBe("INV-{AY}-{SEQ:6}");
			expect(b.receiptNumberFormat).toBe("RCT-{AY}-{SEQ:6}");
			expect(b.logoRef ?? null).toBeNull();
			expect(b.logoUrl ?? null).toBeNull();
		});
	});

	test("SET-01 every field is stored and read back", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const [logo, stamp, signature] = [await uploadedRef(client), await uploadedRef(client), await uploadedRef(client)];
		const body = brandingBody({ logoRef: logo, stampRef: stamp, signatureRef: signature });
		(await client.put(BRANDING, { body })).expectStatus(200);
		(await client.get(BRANDING)).expectJson((b) => {
			expect(b).toMatchObject(body);
			expect(b.logoUrl).toBe(`/uploads/${logo}`);
			expect(b.stampUrl).toBe(`/uploads/${stamp}`);
			expect(b.signatureUrl).toBe(`/uploads/${signature}`);
		});
	});

	test("SET-01 sending null for a text field or an asset clears it", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(BRANDING, { body: brandingBody({ logoRef: await uploadedRef(client) }) })).expectStatus(200);
		(await client.put(BRANDING, { body: brandingBody({ logoRef: null, schoolNameOverride: null, addressLine: null, affiliationText: null, footerText: null }) })).expectStatus(200);
		(await client.get(BRANDING)).expectJson((b) => {
			for (const key of ["logoRef", "logoUrl", "schoolNameOverride", "addressLine", "affiliationText", "footerText"]) expect(b[key] ?? null, key).toBeNull();
		});
	});

	for (const field of ["admissionNumberFormat", "invoiceNumberFormat", "receiptNumberFormat"]) {
		test(`SET-01 a blank ${field} is rejected and the stored format is kept`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			const before = (await client.get(BRANDING)).expectStatus(200).body[field];
			for (const value of ["", "   ", null]) (await client.put(BRANDING, { body: brandingBody({ [field]: value }) })).expectStatus(BAD);
			expect((await client.get(BRANDING)).body[field]).toBe(before);
		});
	}

	test("SET-01 a custom admission number format is used for the next admission", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(BRANDING, { body: brandingBody({ admissionNumberFormat: "ZED-{SEQ:3}" }) })).expectStatus(200);
		const stored = (await client.get(BRANDING)).body;
		expect(stored.admissionNumberFormat).toBe("ZED-{SEQ:3}");
	});

	test("SET-01 a reference that was never uploaded is rejected", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(BRANDING, { body: brandingBody({ logoRef: "00000000-0000-0000-0000-000000000000.png" }) })).expectStatus(BAD);
	});

	test("SET-01 a reference that points outside the upload folder is rejected", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(BRANDING, { body: brandingBody({ logoRef: "../../etc/passwd" }) })).expectStatus(BAD);
		expect((await client.get(BRANDING)).body.logoRef ?? null).toBeNull();
	});

	test("SET-01 each organisation keeps its own branding", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const mine = (await api.get(BRANDING)).expectStatus(200).body;
		(await client.put(BRANDING, { body: brandingBody({ schoolNameOverride: `Only here ${uniqueCode("b")}` }) })).expectStatus(200);
		expect((await api.get(BRANDING)).body.schoolNameOverride ?? null).toBe(mine.schoolNameOverride ?? null);
	});

	test("SET-01 changing one numbering format leaves the others as they were", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(BRANDING, { body: brandingBody({ invoiceNumberFormat: "BILL-{SEQ:5}" }) })).expectStatus(200);
		(await client.get(BRANDING)).expectJson((b) => {
			expect(b.invoiceNumberFormat).toBe("BILL-{SEQ:5}");
			expect(b.receiptNumberFormat).toBe("RCT-{AY}-{SEQ:6}");
		});
	});

	test("SET-01 changing branding needs ORGANISATION_MANAGE, reading does not", async ({ as, api }) => {
		const before = (await api.get(BRANDING)).body;
		(await as("readOnlyStaff").put(BRANDING, { body: brandingBody() })).expectStatus(403);
		(await as("noPermissions").put(BRANDING, { body: brandingBody() })).expectStatus(403);
		(await as("noPermissions").get(BRANDING)).expectStatus(200);
		expect((await api.get(BRANDING)).body.schoolNameOverride ?? null).toBe(before.schoolNameOverride ?? null);
	});

	test("SET-01 without a token branding answers 401", async ({ anon }) => {
		(await anon.get(BRANDING)).expectStatus(401);
		(await anon.put(BRANDING, { body: brandingBody() })).expectStatus(401);
	});
});

test.describe("SET-03 custom field definitions", () => {
	for (const dataType of ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]) {
		test(`SET-03 a ${dataType} field is created active and listed`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			const options = dataType === "SELECT" ? "Red,Blue,Green" : null;
			const field = await createCustomField(client, { dataType, options, label: `${dataType} field` });
			expect(field).toMatchObject({ entityType: "STUDENT", dataType, options, required: false, status: "ACTIVE" });
			(await client.get(CUSTOM_FIELDS)).expectJson((list) => expect(list.map((f: { id: number }) => f.id)).toContain(field.id));
		});
	}

	test("SET-03 the list can be filtered by entity type", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const student = await createCustomField(client, { entityType: "STUDENT" });
		const other = await createCustomField(client, { entityType: "STAFF" });
		(await client.get(CUSTOM_FIELDS, { query: { entityType: "STUDENT" } })).expectJson((list) => {
			const ids = list.map((f: { id: number }) => f.id);
			expect(ids).toContain(student.id);
			expect(ids).not.toContain(other.id);
		});
	});

	test("SET-03 a field key already used for the entity is rejected with 409", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const first = await createCustomField(client);
		(await client.post(CUSTOM_FIELDS, { body: customFieldBody({ fieldKey: first.fieldKey }) })).expectStatus(409);
		(await client.get(CUSTOM_FIELDS)).expectJson((list) => expect(list.filter((f: { fieldKey: string }) => f.fieldKey === first.fieldKey)).toHaveLength(1));
	});

	test("SET-03 the same key may be used for a different entity type", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const first = await createCustomField(client, { entityType: "STUDENT" });
		(await client.post(CUSTOM_FIELDS, { body: customFieldBody({ entityType: "STAFF", fieldKey: first.fieldKey }) })).expectStatus(200);
	});

	test("SET-03 an unknown data type is a client error, not 404 or 500", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.post(CUSTOM_FIELDS, { body: customFieldBody({ dataType: "RICH_TEXT" }) })).expectStatus(BAD);
	});

	for (const [name, overrides] of [
		["a blank label", { label: "  " }],
		["a missing label", { label: undefined }],
		["a blank field key", { fieldKey: "" }],
		["a missing field key", { fieldKey: undefined }],
		["a missing entity type", { entityType: undefined }],
		["a missing data type", { dataType: undefined }],
	] as [string, Record<string, unknown>][]) {
		test(`SET-03 ${name} is rejected`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			(await client.post(CUSTOM_FIELDS, { body: customFieldBody(overrides) })).expectStatus(BAD);
		});
	}

	test("SET-03 a field key with spaces or capitals is rejected (it becomes a JSON key on every record)", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		for (const fieldKey of ["blood group", "BloodGroup", "blood-group!"]) (await client.post(CUSTOM_FIELDS, { body: customFieldBody({ fieldKey }) })).expectStatus(BAD);
	});

	test("SET-04 a select field needs at least one option", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		for (const options of [null, "", " , "]) (await client.post(CUSTOM_FIELDS, { body: customFieldBody({ dataType: "SELECT", options }) })).expectStatus(BAD);
	});

	test("SET-03 an edit changes label, type, options and required but never the key", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const field = await createCustomField(client);
		(await client.patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: field.id }, body: { label: "Blood group", dataType: "SELECT", options: "A,B,O", required: true, fieldKey: "other_key", entityType: "STAFF" } })).expectStatus(200).expectJson((f) => {
			expect(f).toMatchObject({ id: field.id, label: "Blood group", dataType: "SELECT", options: "A,B,O", required: true, fieldKey: field.fieldKey, entityType: "STUDENT" });
		});
	});

	test("SET-03 editing with an unknown id is 404 and with an unknown data type is a client error", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const field = await createCustomField(client);
		(await client.patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: 999999999 }, body: { label: "x", dataType: "TEXT", required: false } })).expectStatus(404);
		(await client.patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: field.id }, body: { label: "x", dataType: "MONEY", required: false } })).expectStatus(BAD);
		(await client.patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: field.id }, body: { label: "", dataType: "TEXT", required: false } })).expectStatus(BAD);
	});

	test("SET-03 a field can be archived and reactivated, and an unknown status is a client error", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const field = await createCustomField(client);
		(await archiveCustomField(client, field.id)).expectStatus(200).expectJson((f) => expect(f.status).toBe("ARCHIVED"));
		(await client.post(`${CUSTOM_FIELDS}/{id}/status`, { params: { id: field.id }, body: { status: "ACTIVE" } })).expectStatus(200).expectJson((f) => expect(f.status).toBe("ACTIVE"));
		(await client.post(`${CUSTOM_FIELDS}/{id}/status`, { params: { id: field.id }, body: { status: "DELETED" } })).expectStatus(BAD);
		(await client.post(`${CUSTOM_FIELDS}/{id}/status`, { params: { id: 999999999 }, body: { status: "ARCHIVED" } })).expectStatus(404);
	});

	test("SET-03 the definitions of one organisation are invisible and untouchable from another", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const field = await createCustomField(client);
		(await api.get(CUSTOM_FIELDS)).expectJson((list) => expect(list.map((f: { id: number }) => f.id)).not.toContain(field.id));
		(await api.patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: field.id }, body: { label: "Stolen", dataType: "TEXT", required: false } })).expectStatus(404);
		(await archiveCustomField(api, field.id)).expectStatus(404);
		expect((await client.get(CUSTOM_FIELDS)).body.find((f: { id: number }) => f.id === field.id).label).toBe(field.label);
	});

	test("SET-03 creating, editing or archiving needs ORGANISATION_MANAGE; listing is open to any member", async ({ as, api }) => {
		const field = await createCustomField(api);
		try {
			for (const role of ["readOnlyStaff", "noPermissions"] as const) {
				(await as(role).post(CUSTOM_FIELDS, { body: customFieldBody() })).expectStatus(403);
				(await as(role).patch(`${CUSTOM_FIELDS}/{id}`, { params: { id: field.id }, body: { label: "x", dataType: "TEXT", required: false } })).expectStatus(403);
				(await archiveCustomField(as(role), field.id)).expectStatus(403);
			}
			(await as("noPermissions").get(CUSTOM_FIELDS)).expectStatus(200);
		} finally {
			await archiveCustomField(api, field.id);
		}
	});

	test("SET-03 without a token the endpoints answer 401", async ({ anon }) => {
		(await anon.get(CUSTOM_FIELDS)).expectStatus(401);
		(await anon.post(CUSTOM_FIELDS, { body: customFieldBody() })).expectStatus(401);
	});
});

test.describe("SET-04 custom field values on a student", () => {
	// The shared organisation is the only place a student can be admitted (Operion #354); optional fields with unique keys are harmless there.
	async function withField<T>(api: Parameters<typeof createCustomField>[0], overrides: Record<string, unknown>, run: (key: string) => Promise<T>) {
		const field = await createCustomField(api, overrides);
		try {
			return await run(field.fieldKey);
		} finally {
			await archiveCustomField(api, field.id);
		}
	}

	test("SET-04 a date field rejects text that is not a date", async ({ api }) => {
		await withField(api, { dataType: "DATE" }, async (key) => {
			const student = await admitStudent(api);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "next tuesday" } } })).expectStatus(BAD);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "2026-02-30" } } })).expectStatus(BAD);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "2026-03-14" } } })).expectStatus(200);
		});
	});

	test("SET-04 a boolean field accepts true and false and rejects anything else", async ({ api }) => {
		await withField(api, { dataType: "BOOLEAN" }, async (key) => {
			const student = await admitStudent(api);
			for (const value of [true, false]) (await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: value } } })).expectStatus(200);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "perhaps" } } })).expectStatus(BAD);
		});
	});

	test("SET-04 a select field accepts one of its options and rejects any other value", async ({ api }) => {
		await withField(api, { dataType: "SELECT", options: "Red,Blue,Green" }, async (key) => {
			const student = await admitStudent(api);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "Blue" } } })).expectStatus(200);
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [key]: "Purple" } } })).expectStatus(BAD);
		});
	});

	test("SET-04 archiving a field keeps its stored values on existing records, even when another field is edited", async ({ api }) => {
		const archived = await createCustomField(api);
		const active = await createCustomField(api);
		try {
			const student = await admitStudent(api, { customFields: { [archived.fieldKey]: "kept", [active.fieldKey]: "one" } });
			(await archiveCustomField(api, archived.id)).expectStatus(200);
			(await api.get("/api/v1/students/{studentId}", { params: { studentId: student.id } })).expectJson((s) => expect(s.customFields?.[archived.fieldKey], "after archiving").toBe("kept"));
			(await api.patch("/api/v1/students/{studentId}", { params: { studentId: student.id }, body: { customFields: { [active.fieldKey]: "two" } } })).expectStatus(200);
			(await api.get("/api/v1/students/{studentId}", { params: { studentId: student.id } })).expectJson((s) => {
				expect(s.customFields?.[active.fieldKey]).toBe("two");
				expect(s.customFields?.[archived.fieldKey], "stored value of the archived field after editing another field").toBe("kept");
			});
		} finally {
			await archiveCustomField(api, active.id);
		}
	});

	test("SET-04 a value for a key that has no definition is not stored", async ({ api }) => {
		const student = await admitStudent(api, { customFields: { never_defined_key: "x" } });
		expect(student.body.customFields ?? {}).toEqual({});
	});
});

test.describe("SET-06 document templates", () => {
	const TYPES = ["QUESTION_PAPER_HEADER", "REPORT_CARD"];
	const STYLES = ["CLASSIC", "MODERN", "MINIMAL", "ELEGANT"];

	for (const type of TYPES) {
		test(`SET-06 ${type} has defaults until it is saved`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			(await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type } })).expectStatus(200).expectJson((t) => {
				expect(t).toMatchObject({ documentType: type, templateStyle: "CLASSIC", pageSize: "A4", fontStyle: "Sans-serif", fontSize: 12, configured: false });
			});
		});
	}

	for (const style of STYLES) {
		test(`SET-06 style ${style} can be saved and read back`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			const body = docTemplateBody({ templateStyle: style });
			(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body })).expectStatus(200).expectJson((t) => expect(t).toMatchObject({ ...body, documentType: "REPORT_CARD", configured: true }));
			(await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" } })).expectJson((t) => expect(t).toMatchObject({ ...body, configured: true }));
		});
	}

	test("SET-06 saving twice updates the one template and the two document types stay separate", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody({ templateStyle: "ELEGANT" }) })).expectStatus(200);
		(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody({ templateStyle: "MINIMAL", fontSize: 9 }) })).expectStatus(200);
		(await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" } })).expectJson((t) => expect(t).toMatchObject({ templateStyle: "MINIMAL", fontSize: 9 }));
		(await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "QUESTION_PAPER_HEADER" } })).expectJson((t) => expect(t.configured).toBe(false));
	});

	test("SET-06 an unknown style is a client error", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody({ templateStyle: "COMIC" }) })).expectStatus(BAD);
		(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody({ templateStyle: undefined }) })).expectStatus(BAD);
	});

	test("SET-06 an unknown document type is 404 or a client error, never 500", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const get = await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "INVOICE" } });
		expect([400, 404]).toContain(get.status);
		const put = await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "INVOICE" }, body: docTemplateBody() });
		expect([400, 404]).toContain(put.status);
	});

	for (const [name, overrides] of [
		["a blank page size", { pageSize: " " }],
		["a blank font style", { fontStyle: "" }],
		["a zero font size", { fontSize: 0 }],
		["a negative font size", { fontSize: -4 }],
		["a page size that is not offered", { pageSize: "Poster-XL" }],
	] as [string, Record<string, unknown>][]) {
		test(`SET-06 ${name} is rejected`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody(overrides) })).expectStatus(BAD);
			(await client.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" } })).expectJson((t) => expect(t.configured, "nothing was saved").toBe(false));
		});
	}

	test("SET-06 each organisation has its own templates", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(`${DOC_TEMPLATES}/{type}`, { params: { type: "QUESTION_PAPER_HEADER" }, body: docTemplateBody({ headerSubtext: `Only here ${uniqueCode("t")}` }) })).expectStatus(200);
		(await api.get(`${DOC_TEMPLATES}/{type}`, { params: { type: "QUESTION_PAPER_HEADER" } })).expectJson((t) => expect(t.headerSubtext ?? "").not.toContain("Only here"));
	});

	test("SET-06 saving needs ORGANISATION_MANAGE; reading does not", async ({ as }) => {
		(await as("readOnlyStaff").put(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" }, body: docTemplateBody() })).expectStatus(403);
		(await as("noPermissions").get(`${DOC_TEMPLATES}/{type}`, { params: { type: "REPORT_CARD" } })).expectStatus(200);
	});
});

test.describe("SET-07 ID-card templates", () => {
	test("SET-07 a template is created and listed with its size and layout", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const body = idCardBody();
		const created = (await client.post(ID_CARDS, { body })).expectStatus(200);
		expect(created.body).toMatchObject({ name: body.name, widthMm: 54, heightMm: 86, layoutJson: body.layoutJson });
		(await client.get(ID_CARDS)).expectJson((list) => expect(list.map((t: { id: number }) => t.id)).toContain(created.body.id));
	});

	for (const [name, overrides] of [
		["a blank name", { name: " " }],
		["a zero width", { widthMm: 0 }],
		["a negative height", { heightMm: -5 }],
		["a blank layout", { layoutJson: "" }],
		["a layout that is not JSON", { layoutJson: "{not json" }],
	] as [string, Record<string, unknown>][]) {
		test(`SET-07 ${name} is rejected`, async ({ request, calls }) => {
			const { client } = await scratchOrg(request, calls);
			(await client.post(ID_CARDS, { body: idCardBody(overrides) })).expectStatus(BAD);
			expect((await client.get(ID_CARDS)).body).toEqual([]);
		});
	}

	test("SET-07 rendering resolves the student's name, admission number and class", async ({ api }) => {
		const template = (await api.post(ID_CARDS, { body: idCardBody() })).expectStatus(200).body;
		const student = await admitStudent(api, {}, { firstName: "Asha", lastName: "Verma" });
		const rendered = (await api.post(`${ID_CARDS}/{id}/render`, { params: { id: template.id }, query: { studentId: student.id } })).expectStatus(200).body;
		expect(rendered).toMatchObject({ templateId: template.id, widthMm: 54, heightMm: 86 });
		const byId = Object.fromEntries(rendered.elements.map((e: { id: string; value: string }) => [e.id, e.value]));
		expect(byId.name).toBe("Asha Verma");
		expect(byId.adm).toBe(student.body.admissionNumber);
		expect(byId.title).toBe("Automation School");
	});

	test("SET-07 rendering an unknown template or student is 404", async ({ api }) => {
		const template = (await api.post(ID_CARDS, { body: idCardBody() })).expectStatus(200).body;
		const student = await admitStudent(api);
		(await api.post(`${ID_CARDS}/{id}/render`, { params: { id: 999999999 }, query: { studentId: student.id } })).expectStatus(404);
		(await api.post(`${ID_CARDS}/{id}/render`, { params: { id: template.id }, query: { studentId: 999999999 } })).expectStatus(404);
	});

	test("SET-07 rendering without a student id is a client error", async ({ api }) => {
		const template = (await api.post(ID_CARDS, { body: idCardBody() })).expectStatus(200).body;
		(await api.post(`${ID_CARDS}/{id}/render`, { params: { id: template.id } })).expectStatus(BAD);
	});

	test("SET-07 a template of another organisation can be neither listed nor used to render", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const theirs = (await client.post(ID_CARDS, { body: idCardBody() })).expectStatus(200).body;
		const student = await admitStudent(api);
		(await api.get(ID_CARDS)).expectJson((list) => expect(list.map((t: { id: number }) => t.id)).not.toContain(theirs.id));
		(await api.post(`${ID_CARDS}/{id}/render`, { params: { id: theirs.id }, query: { studentId: student.id } })).expectStatus(404);
	});

	test("SET-07 creating needs ORGANISATION_MANAGE and listing needs STUDENT_VIEW", async ({ as }) => {
		(await as("readOnlyStaff").post(ID_CARDS, { body: idCardBody() })).expectStatus(403);
		(await as("readOnlyStaff").get(ID_CARDS)).expectStatus(200);
		(await as("noPermissions").get(ID_CARDS)).expectStatus(403);
	});
});

test.describe("SET-10 asset uploads", () => {
	for (const [label, file, extension] of [["PNG", png(), "png"], ["JPEG", jpeg(), "jpg"], ["PDF", pdf(), "pdf"]] as const) {
		test(`SET-10 a ${label} is stored and served from the URL returned`, async ({ api, request }) => {
			const stored = (await upload(api, file)).expectStatus(200).body;
			expect(stored.reference).toMatch(new RegExp(`^[0-9a-f-]{36}\\.${extension}$`));
			expect(stored.url).toBe(`/uploads/${stored.reference}`);
			const served = await request.get(`${API_BASE_URL}${stored.url}`);
			expect(served.status()).toBe(200);
			expect((await served.body()).equals(file.buffer), "the served bytes are the uploaded bytes").toBe(true);
		});
	}

	test("SET-10 two uploads of the same file get different references", async ({ api }) => {
		const a = (await upload(api, png())).expectStatus(200).body.reference;
		const b = (await upload(api, png())).expectStatus(200).body.reference;
		expect(a).not.toBe(b);
	});

	for (const [label, file] of [
		["a GIF", { name: "a.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") }],
		["an SVG", { name: "a.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }],
		["an HTML page", { name: "a.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") }],
		["a plain text file", { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }],
		["an executable", { name: "a.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }],
	] as const) {
		test(`SET-10 ${label} is rejected with 400`, async ({ api }) => {
			(await upload(api, file)).expectStatus(400).expectJson((b) => expect(JSON.stringify(b)).toMatch(/PNG, JPG, or PDF/i));
		});
	}

	test("SET-10 an empty file is rejected with 400", async ({ api }) => {
		(await upload(api, { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) })).expectStatus(400);
	});

	test("SET-10 a request with no file is a client error", async ({ api }) => {
		(await api.post(ASSETS, { multipart: { note: "no file here" } })).expectStatus(BAD);
	});

	test("SET-10 a file just under 5 MB is accepted and one over 5 MB is rejected with 400", async ({ api }) => {
		(await upload(api, paddedPng(5 * 1024 * 1024 - 1024))).expectStatus(200);
		(await upload(api, paddedPng(5 * 1024 * 1024 + 1024))).expectStatus(400).expectJson((b) => expect(JSON.stringify(b)).toMatch(/5MB/i));
	});

	test("SET-10 a file whose bytes are not an image is rejected even when it says image/png", async ({ api }) => {
		(await upload(api, { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") })).expectStatus(400);
	});

	test("SET-10 a file name with path characters cannot choose where the file is stored", async ({ api, request }) => {
		const stored = (await upload(api, { ...png(), name: "../../../../tmp/evil.png" })).expectStatus(200).body;
		expect(stored.reference).toMatch(/^[0-9a-f-]{36}\.png$/);
		expect((await request.get(`${API_BASE_URL}${stored.url}`)).status()).toBe(200);
	});

	test("SET-10 uploading needs a signed-in user", async ({ anon }) => {
		(await upload(anon, png())).expectStatus(401);
	});
});

test.describe("SET-11 uploaded assets and tenants", () => {
	test("SET-11 an uploaded file is fetched by its unguessable reference and an unknown reference is 404", async ({ api, request }) => {
		const stored = (await upload(api, png())).expectStatus(200).body;
		expect((await request.get(`${API_BASE_URL}/uploads/${stored.reference}`)).status()).toBe(200);
		expect((await request.get(`${API_BASE_URL}/uploads/00000000-0000-0000-0000-000000000000.png`)).status()).toBe(404);
	});

	test("SET-11 uploads are served from /uploads/, which sits outside the authenticated API (by design: print output cannot send a token)", async ({ api, request }) => {
		const stored = (await upload(api, png())).expectStatus(200).body;
		const withoutToken = await request.get(`${API_BASE_URL}${stored.url}`, { headers: { Authorization: "" } });
		expect(withoutToken.status()).toBe(200);
	});

	test("SET-11 the upload folder cannot be walked out of", async ({ request }) => {
		const response = await request.get(`${API_BASE_URL}/uploads/..%2f..%2fapplication.properties`);
		expect(response.status()).not.toBe(200);
		expect(response.status()).toBeLessThan(500);
	});
});

test.describe("SET-02 external services", () => {
	test("SET-02 every service is listed locked, with its properties unconfigured", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.get(EXTERNAL_SERVICES)).expectStatus(200).expectJson((list) => {
			const brevo = list.find((s: { serviceKey: string }) => s.serviceKey === "brevo");
			const whatsapp = list.find((s: { serviceKey: string }) => s.serviceKey === "whatsapp");
			expect(brevo).toMatchObject({ enabled: false });
			expect(whatsapp).toMatchObject({ enabled: false });
			expect(brevo.properties.map((p: { key: string }) => p.key).sort()).toEqual(["email.api-key", "email.sender-email", "email.sender-name", "sms.api-key", "sms.sender"]);
			for (const p of [...brevo.properties, ...whatsapp.properties]) expect(p.configured).toBe(false);
		});
	});

	test("SET-02 properties cannot be saved until the platform owner enables the service", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const response = await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: { "email.sender-email": "school@example.test" } } });
		expect([403, 409]).toContain(response.status);
		(await client.get(EXTERNAL_SERVICES)).expectJson((list) => expect(list.find((s: { serviceKey: string }) => s.serviceKey === "brevo").properties.every((p: { configured: boolean }) => !p.configured)).toBe(true));
	});

	test("SET-02 once enabled, saved properties show as configured and no value is ever returned", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setExternalService(org.id, "brevo", true);
		const secret = `secret-${uniqueCode("k")}`;
		const response = (await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: { "email.api-key": secret, "email.sender-email": "school@example.test" } } })).expectStatus(200);
		expect(JSON.stringify(response.body)).not.toContain(secret);
		expect(JSON.stringify(response.body)).not.toContain("school@example.test");
		const read = (await client.get(EXTERNAL_SERVICES)).expectStatus(200);
		expect(JSON.stringify(read.body)).not.toContain(secret);
		const brevo = read.body.find((s: { serviceKey: string }) => s.serviceKey === "brevo");
		expect(brevo.enabled).toBe(true);
		const byKey = Object.fromEntries(brevo.properties.map((p: { key: string; configured: boolean; secret: boolean }) => [p.key, p]));
		expect(byKey["email.api-key"]).toMatchObject({ configured: true, secret: true });
		expect(byKey["email.sender-email"]).toMatchObject({ configured: true, secret: false });
		expect(byKey["sms.api-key"].configured).toBe(false);
	});

	test("SET-02 a blank value clears a property and a key that is not mentioned is left alone", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setExternalService(org.id, "brevo", true);
		const put = (properties: Record<string, string | null>) => client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties } });
		(await put({ "email.api-key": "abc", "email.sender-name": "School" })).expectStatus(200);
		(await put({ "email.api-key": "  " })).expectStatus(200).expectJson((s) => {
			const byKey = Object.fromEntries(s.properties.map((p: { key: string; configured: boolean }) => [p.key, p.configured]));
			expect(byKey["email.api-key"]).toBe(false);
			expect(byKey["email.sender-name"]).toBe(true);
		});
		(await put({ "email.sender-name": null })).expectStatus(200).expectJson((s) => expect(s.properties.find((p: { key: string }) => p.key === "email.sender-name").configured).toBe(false));
	});

	test("SET-02 a key that is not in the service's catalogue is ignored and creates nothing", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setExternalService(org.id, "brevo", true);
		(await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: { "not.a.property": "x" } } })).expectStatus(200).expectJson((s) => {
			expect(s.properties.map((p: { key: string }) => p.key)).not.toContain("not.a.property");
			expect(s.properties.every((p: { configured: boolean }) => !p.configured)).toBe(true);
		});
	});

	test("SET-02 an unknown service is 404", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "carrier-pigeon" }, body: { properties: {} } })).expectStatus(404);
	});

	test("SET-02 a body without properties is a client error, not a 500", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setExternalService(org.id, "brevo", true);
		(await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: {} })).expectStatus(BAD);
	});

	test("SET-02 withdrawing the entitlement stops further saves but keeps what was stored", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setExternalService(org.id, "whatsapp", true);
		(await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "whatsapp" }, body: { properties: { "whatsapp.phone-number-id": "12345" } } })).expectStatus(200);
		await setExternalService(org.id, "whatsapp", false);
		expect([403, 409]).toContain((await client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "whatsapp" }, body: { properties: { "whatsapp.phone-number-id": "999" } } })).status);
		(await client.get(EXTERNAL_SERVICES)).expectJson((list) => {
			const wa = list.find((s: { serviceKey: string }) => s.serviceKey === "whatsapp");
			expect(wa.enabled).toBe(false);
			expect(wa.properties.find((p: { key: string }) => p.key === "whatsapp.phone-number-id").configured).toBe(true);
		});
	});

	test("SET-02 one organisation's entitlement and values do not reach another", async ({ request, calls }) => {
		const a = await scratchOrg(request, calls);
		const b = await scratchOrg(request, calls);
		await setExternalService(a.org.id, "brevo", true);
		(await a.client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: { "email.sender-name": "A School" } } })).expectStatus(200);
		(await b.client.get(EXTERNAL_SERVICES)).expectJson((list) => {
			const brevo = list.find((s: { serviceKey: string }) => s.serviceKey === "brevo");
			expect(brevo.enabled).toBe(false);
			expect(brevo.properties.every((p: { configured: boolean }) => !p.configured)).toBe(true);
		});
		expect([403, 409]).toContain((await b.client.put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: { "email.sender-name": "B" } } })).status);
	});

	test("SET-02 saving needs ORGANISATION_MANAGE; reading does not", async ({ as }) => {
		(await as("readOnlyStaff").put(`${EXTERNAL_SERVICES}/{key}/properties`, { params: { key: "brevo" }, body: { properties: {} } })).expectStatus(403);
		(await as("noPermissions").get(EXTERNAL_SERVICES)).expectStatus(200);
	});

	test("SET-02 an organisation owner cannot call the platform console endpoint that grants the entitlement", async ({ api, request, calls }) => {
		const { org } = await scratchOrg(request, calls);
		const response = await api.patch("/api/v1/platform/organisations/{id}/external-services/{key}", { params: { id: org.id, key: "brevo" }, body: { enabled: true } });
		expect([401, 403]).toContain(response.status);
	});
});

test.describe("SET-12 module switches", () => {
	const LIBRARY_BOOKS = "/api/v1/library/books";
	const disabledModules = async (client: Parameters<typeof createBook>[0]) => (await client.get("/api/v1/auth/me")).expectStatus(200).body.disabledModules as string[];

	test("SET-12 Transport, Communication, Messaging and Performance start off and everything else on", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const disabled = await disabledModules(client);
		expect(disabled.filter((m) => m !== "TRANSPORT").sort()).toEqual(["COMMUNICATION", "MESSAGING", "PERFORMANCE"]);
	});

	test("SET-12 switching a module off answers 403 for the owner, names the module and keeps the data", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		const book = await createBook(client);
		await setModule(org.id, "LIBRARY", false);
		const blocked = await client.get(LIBRARY_BOOKS);
		expect(blocked.status).toBe(403);
		expect(JSON.stringify(blocked.body)).toMatch(/Library module is not enabled/i);
		expect(await disabledModules(client)).toContain("LIBRARY");
		await setModule(org.id, "LIBRARY", true);
		(await client.get(LIBRARY_BOOKS)).expectStatus(200).expectJson((page) => expect(JSON.stringify(page)).toContain(book.title));
		expect(await disabledModules(client)).not.toContain("LIBRARY");
	});

	test("SET-12 the switch takes effect on the very next request, for a member who holds the permission too", async ({ request, calls, anon }) => {
		const { client, org, campusId, slug } = await scratchOrg(request, calls);
		const member = await createDisposableUser(client, anon, { organisationSlug: slug, campusId }, ["LIBRARY_VIEW", "LIBRARY_CATALOG_MANAGE"]);
		(await member.client.get(LIBRARY_BOOKS)).expectStatus(200);
		await setModule(org.id, "LIBRARY", false);
		(await member.client.get(LIBRARY_BOOKS)).expectStatus(403);
		await setModule(org.id, "LIBRARY", true);
		(await member.client.get(LIBRARY_BOOKS)).expectStatus(200);
	});

	test("SET-12 a module's permissions leave the permission catalogue while it is off", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		const codes = async () => ((await client.get("/api/v1/permissions")).expectStatus(200).body as { code: string }[]).map((p) => p.code);
		expect(await codes()).toContain("LIBRARY_VIEW");
		await setModule(org.id, "LIBRARY", false);
		expect(await codes()).not.toContain("LIBRARY_VIEW");
		await setModule(org.id, "LIBRARY", true);
		expect(await codes()).toContain("LIBRARY_VIEW");
	});

	test("SET-12 switching a module off in one organisation leaves the others untouched", async ({ request, calls }) => {
		const a = await scratchOrg(request, calls);
		const b = await scratchOrg(request, calls);
		await setModule(a.org.id, "LIBRARY", false);
		(await b.client.get(LIBRARY_BOOKS)).expectStatus(200);
		expect(await disabledModules(b.client)).not.toContain("LIBRARY");
	});

	test("SET-12 the Dashboard module off blocks the dashboard endpoints", async ({ request, calls }) => {
		const { client, org } = await scratchOrg(request, calls);
		await setModule(org.id, "DASHBOARD", false);
		(await client.get("/api/v1/dashboard/summary")).expectStatus(403);
		await setModule(org.id, "DASHBOARD", true);
		(await client.get("/api/v1/dashboard/summary")).expectStatus(200);
	});

	test("SET-12 the history records each real change and nothing for a switch that changes nothing", async ({ request, calls }) => {
		const { org } = await scratchOrg(request, calls);
		const before = (await moduleHistory(org.id)).length;
		await setModule(org.id, "LIBRARY", true);
		expect((await moduleHistory(org.id)).length, "switching on a module that is already on").toBe(before);
		await setModule(org.id, "LIBRARY", false);
		await setModule(org.id, "LIBRARY", true);
		const history = (await moduleHistory(org.id)) as { code: string; enabled: boolean }[];
		expect(history.length).toBe(before + 2);
		expect(history.slice(0, 2).map((h) => [h.code, h.enabled])).toEqual([["LIBRARY", true], ["LIBRARY", false]]);
	});

	test("SET-12 an organisation owner cannot switch modules", async ({ api, request, calls }) => {
		const { org } = await scratchOrg(request, calls);
		const response = await api.put("/api/v1/platform/organisations/{id}/modules/{code}", { params: { id: org.id, code: "LIBRARY" }, body: { enabled: false, note: "nope" } });
		expect([401, 403]).toContain(response.status);
		(await org.client.get(LIBRARY_BOOKS)).expectStatus(200);
	});

	test("SET-12 an unknown module code is a client error from the platform console", async ({ request, calls }) => {
		const { org } = await scratchOrg(request, calls);
		await expect(setModule(org.id, "TELEPORTATION", false)).rejects.toThrow(/-> (400|404)/);
	});
});
