// Reads what global-setup persisted: per-role bearer tokens (as Playwright storageState,
// which the UI projects reuse directly) and the seed ids.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR, SESSION_STORAGE_KEY } from "../config/env";
import type { RoleName } from "./roles";

export interface SeedData {
	organisationSlug: string;
	ownerEmail: string;
	ownerPassword: string;
	campusId: number;
	academicYearId: number;
	academicYearName: string;
	gradeLevelId: number;
	classId: number;
	className: string;
	sectionId: number;
	sectionName: string;
	studentId: number;
	studentPersonId: number;
	studentAdmissionNumber: string;
	studentEnrollmentId: number;
}

export function storageStatePath(role: RoleName): string {
	return join(AUTH_DIR, `${role}.json`);
}

export function tokenFor(role: RoleName): string {
	const state = JSON.parse(readFileSync(storageStatePath(role), "utf-8"));
	const entry = state.origins[0].localStorage.find((item: { name: string }) => item.name === SESSION_STORAGE_KEY);
	return JSON.parse(entry.value).token;
}

let cachedSeed: SeedData | undefined;
export function loadSeed(): SeedData {
	cachedSeed ??= JSON.parse(readFileSync(join(AUTH_DIR, "seed.json"), "utf-8")) as SeedData;
	return cachedSeed;
}
