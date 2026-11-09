// Import/export fixtures: the catalogue of bulk-importable entities (mirrors Operion's
// web/src/modules/settings/imports/importEntities.tsx and the backend controllers) plus small
// file builders. Shared by tests/api/imports-exports and tests/ui/imports-exports so both layers
// drive the same list - add an entity here and the table-driven specs pick it up.

import type { ApiClient } from "./apiClient";
import { uniqueCode, uniqueSuffix } from "./data";
import { XLSX_MIME, xlsxBuffer } from "./xlsx";

export interface ImportEntity {
	key: string;
	/** Card / export-button label in Settings > Imports & exports. */
	label: string;
	importPath: string;
	exportPath: string;
	/** Students predate validateOnly: the endpoint ignores it and answers { success } rows, not { status } rows. */
	legacy?: boolean;
	/** `entityType` this entity's runs carry in /api/v1/imports/history; absent when the backend records none. */
	historyType?: string;
	/** Permission the import needs; the export needs the entity's *_VIEW permission instead. */
	managePermission: string;
	templateFile: string;
	templateHeaders: string[];
	exportFile: string;
	exportColumns: string[];
}

export const IMPORT_ENTITIES: ImportEntity[] = [
	{
		key: "staff", label: "Staff", importPath: "/api/v1/hr/staff/import", exportPath: "/api/v1/hr/staff/export", historyType: "Staff", managePermission: "HR_STAFF_MANAGE",
		templateFile: "staff-import-template.csv", templateHeaders: ["firstName", "lastName", "dateOfBirth", "gender", "email", "phone", "employeeCode", "dateOfJoining", "employmentType", "department", "designation", "campus"],
		exportFile: "staff.csv", exportColumns: ["id", "employeeCode", "firstName", "lastName", "email", "phone", "department", "designation", "employmentType", "dateOfJoining", "status"],
	},
	{
		key: "students", label: "Students", importPath: "/api/v1/students/import", exportPath: "/api/v1/students/export", legacy: true, managePermission: "STUDENT_MANAGE",
		templateFile: "students-import-template.csv", templateHeaders: ["firstName", "lastName", "dateOfBirth", "gender", "email", "phone", "admissionNumber", "admissionDate", "admissionSource", "previousSchool", "tcNumber", "entranceScore", "bloodGroup", "category", "nationality", "remarks"],
		exportFile: "students.csv", exportColumns: ["id", "firstName", "lastName", "email", "phone", "admissionNumber", "admissionDate", "bloodGroup", "category", "status"],
	},
	{
		key: "guardians", label: "Parents / Guardians", importPath: "/api/v1/guardians/import", exportPath: "/api/v1/guardians/export", historyType: "Guardian", managePermission: "GUARDIAN_MANAGE",
		templateFile: "guardians-import-template.csv", templateHeaders: ["studentAdmissionNumber", "firstName", "lastName", "email", "phone", "occupation", "relationshipType", "isPrimary", "isEmergencyContact", "canPickup", "canReceiveCommunication", "contactPriority"],
		exportFile: "guardians.csv", exportColumns: ["guardianId", "firstName", "lastName", "email", "phone", "occupation", "studentAdmissionNumber", "relationshipType"],
	},
	{
		key: "class-sections", label: "Classes & sections", importPath: "/api/v1/class-sections/import", exportPath: "/api/v1/class-sections/export", historyType: "ClassSection", managePermission: "CLASS_MANAGE",
		templateFile: "class-sections-import-template.csv", templateHeaders: ["academicYear", "campus", "gradeLevel", "gradeSequenceOrder", "stage", "className", "sectionName", "sectionCapacity", "sectionRoom"],
		exportFile: "class-sections.csv", exportColumns: ["sectionId", "academicYear", "campus", "gradeLevel", "className", "sectionName", "capacity", "room"],
	},
	{
		key: "subjects", label: "Subjects", importPath: "/api/v1/subjects/import", exportPath: "/api/v1/subjects/export", historyType: "Subject", managePermission: "SUBJECT_MANAGE",
		templateFile: "subjects-import-template.csv", templateHeaders: ["name", "code"],
		exportFile: "subjects.csv", exportColumns: ["id", "name", "code", "status"],
	},
	{
		key: "student-enrolments", label: "Student enrolments", importPath: "/api/v1/student-enrollments/import", exportPath: "/api/v1/student-enrollments/export", historyType: "StudentEnrolment", managePermission: "STUDENT_MANAGE",
		templateFile: "student-enrolments-import-template.csv", templateHeaders: ["studentAdmissionNumber", "academicYear", "className", "sectionName", "rollNumber", "enrolledDate"],
		exportFile: "student-enrolments.csv", exportColumns: ["id", "admissionNumber", "academicYear", "className", "sectionName", "rollNumber", "enrolledDate", "current"],
	},
	{
		key: "fee-structures", label: "Fee structures", importPath: "/api/v1/fees/structures/import", exportPath: "/api/v1/fees/structures/export", historyType: "FeeStructure", managePermission: "FEE_STRUCTURE_MANAGE",
		templateFile: "fee-structures-import-template.csv", templateHeaders: ["academicYear", "className", "feeCategory", "amount", "installmentDueDate", "paymentFrequency"],
		exportFile: "fee-structures.csv", exportColumns: ["id", "academicYear", "className", "feeCategory", "amount", "paymentFrequency", "status"],
	},
	{
		key: "opening-balances", label: "Opening balances", importPath: "/api/v1/fees/opening-balances/import", exportPath: "/api/v1/fees/opening-balances/export", historyType: "OpeningBalance", managePermission: "FEE_STRUCTURE_MANAGE",
		templateFile: "opening-balances-import-template.csv", templateHeaders: ["studentAdmissionNumber", "amount", "asOfDate"],
		exportFile: "opening-balances.csv", exportColumns: ["id", "studentAdmissionNumber", "studentName", "amount", "status"],
	},
	{
		key: "inventory-items", label: "Inventory items", importPath: "/api/v1/inventory/items/import", exportPath: "/api/v1/inventory/items/export", historyType: "InventoryItem", managePermission: "INVENTORY_CATALOG_MANAGE",
		templateFile: "inventory-items-import-template.csv", templateHeaders: ["category", "code", "name", "unit", "description", "reorderLevel"],
		exportFile: "inventory-items.csv", exportColumns: ["id", "categoryName", "code", "name", "unit", "description", "reorderLevel", "status"],
	},
	{
		key: "vehicles-routes", label: "Vehicles & routes", importPath: "/api/v1/transport/vehicles/import", exportPath: "/api/v1/transport/vehicles/export", historyType: "VehicleRoute", managePermission: "TRANSPORT_VEHICLE_MANAGE",
		templateFile: "vehicles-routes-import-template.csv", templateHeaders: ["campus", "registrationNumber", "vehicleType", "capacity", "driverName", "attendantName", "routeName", "routeCode"],
		exportFile: "vehicles.csv", exportColumns: ["id", "registrationNumber", "vehicleType", "capacity", "campusName", "driverName", "attendantName", "status"],
	},
	{
		key: "books", label: "Books", importPath: "/api/v1/library/books/import", exportPath: "/api/v1/library/books/export", historyType: "Book", managePermission: "LIBRARY_CATALOG_MANAGE",
		templateFile: "books-import-template.csv", templateHeaders: ["isbn", "title", "author", "publisher", "category", "edition"],
		exportFile: "books.csv", exportColumns: ["id", "isbn", "title", "author", "publisher", "category", "edition", "status"],
	},
];

export type ImportStatus = "VALID" | "IMPORTED" | "ERROR" | "DUPLICATE";
export interface ImportRow {
	row: number;
	status: ImportStatus;
	message: string;
	id: number | null;
}

export interface UploadFile {
	name: string;
	mimeType: string;
	buffer: Buffer;
}

/** A CSV upload; `lines` are written under `header`. */
export function csvFile(header: string[], lines: string[], name = "import.csv"): UploadFile {
	return { name, mimeType: "text/csv", buffer: Buffer.from([header.join(","), ...lines].join("\n")) };
}

/** The same table as csvFile, as an .xlsx workbook. */
export function xlsxFile(header: string[], lines: string[][], name = "import.xlsx"): UploadFile {
	return { name, mimeType: XLSX_MIME, buffer: xlsxBuffer([header, ...lines]) };
}

export const multipart = (file: UploadFile) => ({ file });

/** POSTs a file to an import endpoint; `validateOnly` omitted sends no query (a real import). */
export function importFile(client: ApiClient, entity: Pick<ImportEntity, "importPath">, file: UploadFile, validateOnly?: boolean) {
	return client.post(entity.importPath, { query: validateOnly === undefined ? undefined : { validateOnly }, multipart: multipart(file) });
}

export const entity = (key: string): ImportEntity => {
	const found = IMPORT_ENTITIES.find((e) => e.key === key);
	if (!found) throw new Error(`Unknown import entity ${key}`);
	return found;
};

/** A subjects CSV with `count` unique rows, for tests that only need "some valid import". */
export function subjectsCsv(count: number, name = "subjects.csv"): { file: UploadFile; codes: string[] } {
	const codes = Array.from({ length: count }, () => uniqueCode("SUB"));
	return { file: csvFile(["name", "code"], codes.map((code) => `Subject ${code},${code}`), name), codes };
}

/** A department + designation in an organisation (a staff import row must name both). */
export async function staffLookups(client: ApiClient): Promise<{ department: string; designation: string; campus: string }> {
	const tag = uniqueSuffix();
	const department = await client.post("/api/v1/departments", { body: { name: `Dept ${tag}` } });
	department.expectStatus([200, 201]);
	const designation = await client.post("/api/v1/designations", { body: { name: `Desig ${tag}` } });
	designation.expectStatus([200, 201]);
	const campuses = await client.get("/api/v1/campuses");
	campuses.expectStatus(200);
	return { department: department.body.name, designation: designation.body.name, campus: campuses.body[0].name };
}
