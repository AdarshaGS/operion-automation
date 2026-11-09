// Settings and configuration: branding, custom fields, document templates, ID-card templates, asset uploads,
// external services and module switches. Anything that changes organisation-wide configuration is exercised
// in a throwaway organisation (scratchOrg) so the shared one keeps its numbering formats and templates.

import type { ApiClient } from "./apiClient";
import { uniqueCode } from "./data";

export { scratchOrg } from "./dashboard";

export const BRANDING = "/api/v1/organisation/branding";
export const CUSTOM_FIELDS = "/api/v1/custom-field-definitions";
export const DOC_TEMPLATES = "/api/v1/document-templates";
export const ID_CARDS = "/api/v1/id-card-templates";
export const ASSETS = "/api/v1/assets";
export const EXTERNAL_SERVICES = "/api/v1/organisation/external-services";

export interface UploadFile { name: string; mimeType: string; buffer: Buffer }

/** A 1x1 PNG. */
export const png = (name = "logo.png"): UploadFile => ({
	name,
	mimeType: "image/png",
	buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
});

export const jpeg = (name = "photo.jpg"): UploadFile => ({
	name,
	mimeType: "image/jpeg",
	buffer: Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"),
});

export const pdf = (name = "letter.pdf"): UploadFile => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });

/** A file of `bytes` bytes that claims to be a PNG. */
export const paddedPng = (bytes: number, name = "big.png"): UploadFile => ({ name, mimeType: "image/png", buffer: Buffer.concat([png().buffer, Buffer.alloc(Math.max(0, bytes - png().buffer.length), 0)]) });

export const upload = (api: ApiClient, file: UploadFile) => api.post(ASSETS, { multipart: { file } });

/** Uploads a PNG and returns its stored reference. */
export async function uploadedRef(api: ApiClient): Promise<string> {
	const response = await upload(api, png());
	response.expectStatus(200);
	return response.body.reference;
}

export function brandingBody(overrides: Record<string, unknown> = {}) {
	return {
		logoRef: null, stampRef: null, signatureRef: null,
		schoolNameOverride: "Automation Public School", addressLine: "1 Test Road", affiliationText: "Affiliated to the Test Board", footerText: "Computer generated",
		admissionNumberFormat: "ADM-{YYYY}-{SEQ:4}", invoiceNumberFormat: "INV-{AY}-{SEQ:6}", receiptNumberFormat: "RCT-{AY}-{SEQ:6}",
		...overrides,
	};
}

export function customFieldBody(overrides: Record<string, unknown> = {}) {
	return { entityType: "STUDENT", fieldKey: uniqueCode("cf").toLowerCase().replace(/-/g, "_"), label: "House", dataType: "TEXT", options: null, required: false, ...overrides };
}

export async function createCustomField(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const response = await api.post(CUSTOM_FIELDS, { body: customFieldBody(overrides) });
	response.expectStatus(200);
	return response.body as { id: number; entityType: string; fieldKey: string; label: string; dataType: string; options: string | null; required: boolean; status: string };
}

export const archiveCustomField = (api: ApiClient, id: number) => api.post(`${CUSTOM_FIELDS}/{id}/status`, { params: { id }, body: { status: "ARCHIVED" } });

export function docTemplateBody(overrides: Record<string, unknown> = {}) {
	return { templateStyle: "MODERN", pageSize: "A4", fontStyle: "Serif", fontSize: 11, headerSubtext: "Annual examination", ...overrides };
}

export function idCardBody(overrides: Record<string, unknown> = {}) {
	const layout = { elements: [
		{ id: "name", type: "DATA_FIELD", field: "fullName", x: 4, y: 20, width: 50, height: 6 },
		{ id: "adm", type: "DATA_FIELD", field: "admissionNumber", x: 4, y: 28, width: 50, height: 6 },
		{ id: "cls", type: "DATA_FIELD", field: "className", x: 4, y: 36, width: 50, height: 6 },
		{ id: "title", type: "TEXT", text: "Automation School", x: 4, y: 4, width: 50, height: 8 },
	] };
	return { name: `Card ${uniqueCode("idc")}`, widthMm: 54, heightMm: 86, layoutJson: JSON.stringify(layout), ...overrides };
}
