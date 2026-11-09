// Plain-fetch helpers used only by global-setup to build the run's fixture organisation.
// Specs never import this: they exercise the product through api/ (recorded) or pages/ (UI).

import { API_BASE_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../config/env";

export class SetupError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

export interface Session {
	token: string;
	expiresAt: string;
	refreshToken: string;
	userId: number;
	organisationId: number;
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
	const response = await fetch(`${API_BASE_URL}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new SetupError(response.status, `${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
	}
	return (response.status === 204 ? undefined : await response.json()) as T;
}

const post = <T>(path: string, body?: unknown, token?: string) => call<T>("POST", path, body, token);
const get = <T>(path: string, token?: string) => call<T>("GET", path, undefined, token);

export const provisionOrganisation = (input: {
	name: string; legalName: string; slug: string; adminEmail: string; adminPassword: string; adminFirstName: string; adminLastName: string;
}) => post<{ id: number; slug: string }>("/api/v1/organisations", input);

export const login = (organisationSlug: string, email: string, password: string) =>
	post<Session>("/api/v1/auth/login", { organisationSlug, email, password });

/** Switches a module on or off for an organisation through the platform console API. Transport is off by default
 * (Operion ModuleAccessService), so anything exercising vehicles, routes or trips has to enable it first. */
export async function setModule(organisationId: number, code: string, enabled: boolean): Promise<void> {
	const platform = await post<{ token: string }>("/api/v1/platform/auth/login", { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD });
	await call("PUT", `/api/v1/platform/organisations/${organisationId}/modules/${code}`, { enabled, note: "Set by automation" }, platform.token);
}

export const enableModule = (organisationId: number, code: string) => setModule(organisationId, code, true);

/**
 * Optional modules start off for a new organisation (AppModule.defaultEnabled, Operion school/V24), but the
 * suite covers every one of them, so each organisation the suite creates switches them all on. Specs that
 * check the "module off" behaviour turn a module off themselves.
 */
export const SUITE_MODULES = ["TRANSPORT", "LIBRARY", "LEARNING", "MESSAGING", "INVENTORY", "PURCHASE", "SALES", "REPORTS", "PAYROLL", "COMPLIANCE", "PERFORMANCE"];

export async function enableSuiteModules(organisationId: number) {
	for (const code of SUITE_MODULES) await enableModule(organisationId, code);
}

/** Grants or withdraws an organisation's entitlement to an external service (brevo, whatsapp) through the platform console API. */
export async function setExternalService(organisationId: number, serviceKey: string, enabled: boolean): Promise<void> {
	const platform = await post<{ token: string }>("/api/v1/platform/auth/login", { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD });
	await call("PATCH", `/api/v1/platform/organisations/${organisationId}/external-services/${serviceKey}`, { enabled }, platform.token);
}

/** The module switches the platform console shows for an organisation, with the history of changes. */
export async function moduleHistory(organisationId: number): Promise<unknown[]> {
	const platform = await post<{ token: string }>("/api/v1/platform/auth/login", { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD });
	return get<unknown[]>(`/api/v1/platform/organisations/${organisationId}/modules/history`, platform.token);
}

export const listCampuses = (token: string) => get<{ id: number }[]>("/api/v1/campuses", token);

export const createAcademicYear = (token: string, name: string, startDate: string, endDate: string) =>
	post<{ id: number }>("/api/v1/academic-years", { name, startDate, endDate }, token);

export const markAcademicYearCurrent = (token: string, id: number) => post(`/api/v1/academic-years/${id}/mark-current`, undefined, token);

export const createGradeLevel = (token: string, name: string, sequenceOrder: number, stage: string) =>
	post<{ id: number }>("/api/v1/grade-levels", { name, sequenceOrder, stage }, token);

export const createSchoolClass = (token: string, academicYearId: number, campusId: number, gradeLevelId: number, displayName: string) =>
	post<{ id: number }>("/api/v1/school-classes", { academicYearId, campusId, gradeLevelId, displayName }, token);

export const createSection = (token: string, classId: number, name: string, capacity: number, room: string) =>
	post<{ id: number }>(`/api/v1/school-classes/${classId}/sections`, { name, capacity, room }, token);

export const createPerson = (token: string, input: { firstName: string; lastName: string; dateOfBirth?: string; gender?: string; email?: string }) =>
	post<{ id: number }>("/api/v1/persons", input, token);

export const admitStudent = (token: string, input: { personId: number; admissionNumber: string; admissionDate: string }) =>
	post<{ id: number }>("/api/v1/students", input, token);

export const enrollStudent = (
	token: string,
	studentId: number,
	input: { academicYearId: number; sectionId: number; rollNumber: number; enrolledDate: string },
) => post<{ id: number }>(`/api/v1/students/${studentId}/enrollments`, input, token);

export const createRole = (token: string, name: string, description: string, permissionCodes: string[]) =>
	post<{ id: number }>("/api/v1/roles", { name, description, permissionCodes, portal: false }, token);

export const inviteUser = (token: string, email: string) =>
	post<{ userId: number; claimToken: string }>("/api/v1/users/invite", { email, phone: null }, token);

export const claimStaffInvite = (organisationSlug: string, rawToken: string, password: string) =>
	post<Session>("/api/v1/auth/claim-staff-invite", { organisationSlug, token: rawToken, password });

export const grantMembership = (token: string, input: { userId: number; personId: number; roleId: number; campusId: number }) =>
	post("/api/v1/memberships", { ...input, departmentId: null, memberId: null, joiningDate: new Date().toISOString().slice(0, 10) }, token);
