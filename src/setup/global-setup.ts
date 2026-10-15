// Runs once per `playwright test` invocation: provisions one fresh organisation, seeds the
// minimum academic structure + one enrolled student, creates every role fixture, and writes a
// Playwright storageState per role (the frontend's session is just localStorage, so no UI
// login round trip is needed). API and UI projects both consume this output.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR, SESSION_STORAGE_KEY, UI_BASE_URL } from "../config/env";
import { ROLE_FIXTURES, FIXED_PASSWORD } from "./roles";
import * as p from "./provisioning";
import type { SeedData } from "./session";

function storageState(session: p.Session) {
	return {
		cookies: [],
		origins: [
			{
				origin: UI_BASE_URL,
				localStorage: [
					{
						name: SESSION_STORAGE_KEY,
						value: JSON.stringify({
							token: session.token,
							expiresAt: session.expiresAt,
							userId: session.userId,
							organisationId: session.organisationId,
						}),
					},
				],
			},
		],
	};
}

export default async function globalSetup(): Promise<void> {
	// Fast re-runs: skip provisioning and reuse the previous run's organisation and tokens.
	// Only valid against the same, still-running stack the seed was created on.
	if (process.env.OPERION_REUSE_SEED === "1" && existsSync(join(AUTH_DIR, "seed.json"))) {
		return;
	}
	mkdirSync(AUTH_DIR, { recursive: true });

	const runId = Date.now().toString(36);
	const slug = `auto-${runId}`;
	const ownerEmail = `owner@${slug}.test`;

	await p.provisionOrganisation({
		name: `Automation Org ${runId}`,
		legalName: `Automation Org ${runId} Pvt Ltd`,
		slug,
		adminEmail: ownerEmail,
		adminPassword: FIXED_PASSWORD,
		adminFirstName: "Owner",
		adminLastName: "Automation",
	});

	const owner = await p.login(slug, ownerEmail, FIXED_PASSWORD);
	// Session files are written only once seeding has succeeded: a run that fails part-way (for example on
	// Operion #354 against a used database) must not leave tokens for a half-built organisation next to
	// the previous run's seed.json, which OPERION_REUSE_SEED=1 runs would then mix up.
	const sessions: Record<string, p.Session> = { owner };

	const campusId = (await p.listCampuses(owner.token))[0].id;
	const academicYearName = `Auto Year ${runId}`;
	const className = "Auto Grade 1";
	const year = await p.createAcademicYear(owner.token, academicYearName, "2026-06-01", "2027-03-31");
	await p.markAcademicYearCurrent(owner.token, year.id);
	const grade = await p.createGradeLevel(owner.token, className, 1, "PRIMARY");
	const schoolClass = await p.createSchoolClass(owner.token, year.id, campusId, grade.id, className);
	const section = await p.createSection(owner.token, schoolClass.id, "A", 40, "Room 1");

	for (const fixture of ROLE_FIXTURES) {
		if (fixture.name === "owner") continue;
		const role = await p.createRole(owner.token, fixture.roleName!, `Seeded for ${fixture.name}`, fixture.permissionCodes!);
		const person = await p.createPerson(owner.token, { firstName: "Auto", lastName: fixture.name });
		const invite = await p.inviteUser(owner.token, `${fixture.name}@${slug}.test`);
		const claimed = await p.claimStaffInvite(slug, invite.claimToken, FIXED_PASSWORD);
		await p.grantMembership(owner.token, { userId: invite.userId, personId: person.id, roleId: role.id, campusId });
		sessions[fixture.name] = claimed;
	}

	const studentPerson = await p.createPerson(owner.token, { firstName: "Auto", lastName: "Student", dateOfBirth: "2015-04-10", gender: "FEMALE" });
	const student = await p
		.admitStudent(owner.token, { personId: studentPerson.id, admissionNumber: `AUTO-${runId}`, admissionDate: "2026-06-01" })
		.catch((error) => {
			if (error instanceof p.SetupError && error.status === 409) {
				throw new Error(
					`${error.message}\n\nSeeding the first student conflicted. This is Operion's known tenant-scoping bug on generated student ids ` +
						"(GitHub #354): a new organisation cannot admit its first student in a database that already has one. Run against a fresh database - scripts/stack-up.sh does this.",
				);
			}
			throw error;
		});
	const enrollment = await p.enrollStudent(owner.token, student.id, {
		academicYearId: year.id,
		sectionId: section.id,
		rollNumber: 1,
		enrolledDate: "2026-06-01",
	});

	const seed: SeedData = {
		organisationSlug: slug,
		ownerEmail,
		ownerPassword: FIXED_PASSWORD,
		campusId,
		academicYearId: year.id,
		academicYearName,
		gradeLevelId: grade.id,
		classId: schoolClass.id,
		className,
		sectionId: section.id,
		sectionName: "A",
		studentId: student.id,
		studentPersonId: studentPerson.id,
		studentAdmissionNumber: `AUTO-${runId}`,
		studentEnrollmentId: enrollment.id,
	};
	for (const [name, session] of Object.entries(sessions)) writeFileSync(join(AUTH_DIR, `${name}.json`), JSON.stringify(storageState(session)));
	writeFileSync(join(AUTH_DIR, "seed.json"), JSON.stringify(seed, null, 2));
}
