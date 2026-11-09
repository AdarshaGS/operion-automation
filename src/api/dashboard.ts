// Dashboard fixtures. The dashboard counts everything in the organisation, and the shared organisation is
// written to by every other spec, so exact counts are checked in a throwaway organisation of their own.

import type { APIRequestContext } from "@playwright/test";
import type { ApiClient, RecordedCall } from "./apiClient";
import { createOtherOrganisation, organisationContext, type OtherOrganisation } from "./organisations";

export const DASH = "/api/v1/dashboard";

export interface Summary {
	enrollment: { activeStudents: number; campuses: number };
	attendanceToday: { present: number; absent: number; late: number; halfDay: number; marked: number; attendanceRatePercent: number };
	fees: { totalInvoiced: number; totalCollected: number; collectionRatePercent: number; outstanding: number; overdueInvoices: number };
	staff: { activeStaff: number; departments: number; designations: number };
	examinations: { activeExams: number };
	library: { activeBooks: number; currentlyBorrowed: number; overdueBorrows: number };
	transport: { activeVehicles: number; activeRoutes: number; studentsUsingTransport: number };
	inventory: { activeItems: number; categories: number; lowStockItems: number };
	communication: { announcementsThisMonth: number };
	sales: { totalToday: number; totalThisMonth: number };
	purchase: { openOrders: number };
	setupChecklist: Record<"structureConfigured" | "rolesConfigured" | "membersAdded" | "academicSetupConfigured" | "studentsAdded" | "feesConfigured" | "attendanceStarted", boolean>;
	preferences: { setupProgressDismissed: boolean; quickActionsDismissed: boolean };
}

export interface Charts {
	attendanceTrend: { date: string; marked: number; present: number; ratePercent: number }[];
	feeCollections: { month: string; collected: number; invoiced: number }[];
	studentsByClass: { className: string; students: number }[];
}

export async function summary(api: ApiClient) {
	return (await api.get(`${DASH}/summary`)).expectStatus(200).body as Summary;
}

export async function charts(api: ApiClient) {
	return (await api.get(`${DASH}/charts`)).expectStatus(200).body as Charts;
}

export interface ScratchOrg {
	org: OtherOrganisation;
	client: ApiClient;
	campusId: number;
	slug: string;
}

/** A throwaway organisation whose dashboard starts at zero. */
export async function scratchOrg(request: APIRequestContext, calls: RecordedCall[]): Promise<ScratchOrg> {
	const org = await createOtherOrganisation(request, calls);
	const { campusId } = await organisationContext(org);
	return { org, client: org.client, campusId, slug: org.slug };
}

/** Today as the server (and the browser, in the same time zone) reads it. */
export function today(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function firstOfThisMonth(): string {
	return `${today().slice(0, 8)}01`;
}

export function lastMonth(): string {
	const d = new Date();
	d.setDate(1);
	d.setMonth(d.getMonth() - 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
}
