// Helpers for Teacher performance (/api/v1/performance). The module is off for every organisation until the
// platform owner switches it on, so anything exercising it has to call `performanceOn` first.
// Scenario ids refer to docs/SCENARIOS.md section 30 (PERF-*).

import { uniqueSuffix } from "./data";
import { buildAcademicBase, createPerson } from "./academics";
import { assignTeacher } from "./learning";
import { createDepartment, createDesignation, createStaff } from "./hr";
import { enableModule, login } from "../setup/provisioning";
import type { ApiClient } from "./apiClient";
import type { OrgContext } from "./users";

export const PERFORMANCE = "/api/v1/performance";

interface MetricConfig {
	metric: string;
	enabled: boolean;
	weight: number;
	target: number;
	days: number | null;
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

let switchedOn = false;

/** Switches the PERFORMANCE module on for the shared organisation (once per worker). */
export async function performanceOn(seed: { organisationSlug: string; ownerEmail: string; ownerPassword: string }): Promise<void> {
	if (switchedOn) return;
	const session = await login(seed.organisationSlug, seed.ownerEmail, seed.ownerPassword);
	await enableModule(session.organisationId, "PERFORMANCE");
	switchedOn = true;
}

/** Stops tracking every metric, so a test starts from "nothing is tracked" whatever ran before it. */
export async function resetMetrics(api: ApiClient): Promise<void> {
	const metrics: MetricConfig[] = (await api.get(`${PERFORMANCE}/metrics`)).expectStatus(200).body;
	for (const m of metrics.filter((metric) => metric.enabled)) {
		(await api.put(`${PERFORMANCE}/metrics/{metric}`, { params: { metric: m.metric }, body: { enabled: false, weight: m.weight, target: m.target, days: m.days } })).expectStatus(200);
	}
}

export async function trackMetric(api: ApiClient, metric: string, body: { weight?: number; target?: number; days?: number | null } = {}) {
	(await api.put(`${PERFORMANCE}/metrics/{metric}`, { params: { metric }, body: { enabled: true, weight: body.weight ?? 1, target: body.target ?? 100, days: body.days ?? null } })).expectStatus(200);
}

export async function setSelfView(api: ApiClient, on: boolean) {
	(await api.put(`${PERFORMANCE}/settings`, { body: { teacherSelfView: on } })).expectStatus(200);
}

export interface Pair {
	sectionId: number;
	subjectId: number;
}

/** Section-and-subject pairs still free to give a teacher. Two teachers on the same pair would end the first one's assignment. */
export interface Pool {
	campusId: number;
	pairs: Pair[];
}

export interface TeacherSetup {
	personId: number;
	/** The name the scorecard shows. */
	name: string;
	campusId: number;
	sectionId: number;
	subjectId: number;
	/** Hand this to `teacher` (or `.pairs.shift()`) to add another teacher in the same organisation without clashing. */
	pool: Pool;
}

/** A class with two sections and two subjects: four distinct pairs, so up to four teachers who do not displace each other. */
export async function poolIn(api: ApiClient): Promise<Pool> {
	const b = await buildAcademicBase(api, { assignTeachers: false, markCurrent: false });
	const pairs = [b.sectionId, b.secondSectionId].flatMap((sectionId) => [b.subjectId, b.secondSubjectId].map((subjectId) => ({ sectionId, subjectId })));
	return { campusId: b.campusId, pairs };
}

/** A person with a unique name who actively teaches one subject in one section - the only thing that makes someone a teacher here. */
export async function teacher(api: ApiClient, pool?: Pool): Promise<TeacherSetup> {
	const free = pool ?? (await poolIn(api));
	const pair = free.pairs.shift();
	if (!pair) throw new Error("No free section/subject pair left in this pool");
	const personId = await createPerson(api, `Coach${uniqueSuffix()}`);
	await assignTeacher(api, pair.sectionId, pair.subjectId, personId);
	const p = (await api.get("/api/v1/persons/{id}", { params: { id: personId } })).expectStatus(200).body;
	return { personId, name: `${p.firstName} ${p.lastName}`, campusId: free.campusId, ...pair, pool: free };
}

/** Staff attendance for a teacher on the given days-ago, for example [[1, "PRESENT"], [2, "LATE"]]. */
export async function markStaff(api: ApiClient, t: Pick<TeacherSetup, "personId" | "campusId">, days: [number, "PRESENT" | "LATE" | "ABSENT"][]) {
	for (const [ago, status] of days) {
		(await api.post("/api/v1/attendance/staff", { body: { personId: t.personId, campusId: t.campusId, attendanceDate: daysAgo(ago), status } })).expectStatus([200, 201]);
	}
}

export async function createCycle(api: ApiClient, name = `Cycle ${uniqueSuffix()}`, startAgo = 30, endAgo = 0): Promise<{ id: number; name: string }> {
	const created = (await api.post(`${PERFORMANCE}/cycles`, { body: { name, startDate: daysAgo(startAgo), endDate: daysAgo(endAgo) } })).expectStatus([200, 201]);
	return { id: created.body.id, name };
}

/** A teacher who also has an HR staff profile, so the overview can show an employee ID, designation and department. */
export async function teacherWithProfile(api: ApiClient, pool: Pool | undefined, profile: { department?: string | null; departmentId?: number; designation?: string } = {}): Promise<TeacherSetup & { employeeCode: string }> {
	const t = await teacher(api, pool);
	const designation = await createDesignation(api, profile.designation);
	const department = profile.departmentId !== undefined ? { id: profile.departmentId } : profile.department === null ? null : await createDepartment(api, profile.department);
	const staff = await createStaff(api, t.campusId, { personId: t.personId, designationId: designation.id, departmentId: department?.id ?? null });
	return { ...t, employeeCode: staff.employeeCode };
}

/** A manager rating through the API, for tests that need a rated teacher without driving the form. */
export async function rateViaApi(api: ApiClient, cycleId: number, personId: number, rating: number, source: "MANAGER" | "PEER" | "SELF" = "MANAGER", comment = "") {
	(await api.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/feedback`, { params: { cycleId, personId }, body: { source, rating, comment } })).expectStatus([200, 201]);
}

export async function goalViaApi(api: ApiClient, cycleId: number, personId: number, title: string, status?: "OPEN" | "ACHIEVED" | "PARTLY_ACHIEVED" | "MISSED") {
	const goal = (await api.post(`${PERFORMANCE}/cycles/{cycleId}/teachers/{personId}/goals`, { params: { cycleId, personId }, body: { title, description: "" } })).expectStatus([200, 201]);
	if (status && status !== "OPEN") (await api.put(`${PERFORMANCE}/goals/{goalId}`, { params: { goalId: goal.body.id }, body: { title, description: "", status } })).expectStatus(200);
}

export interface OverviewJson {
	summary: { totalStaff: number; pending: number; completed: number; averageScore: number | null; scoredCount: number };
	staff: { personId: number; name: string; reviewStatus: string; department: string | null; designation: string | null }[];
}
export async function overviewOf(api: ApiClient, cycleId: number): Promise<OverviewJson> {
	return (await api.get(`${PERFORMANCE}/cycles/{cycleId}/overview`, { params: { cycleId } })).expectStatus(200).body;
}

export type { OrgContext };
