// The business the sanity run sets up in phase 01, and the hand-off to later phases.
//
// Phase 01 (tests/sanity/01-business-setup.sanity.spec.ts) provisions a brand-new organisation,
// fills in its business details through the UI and saves who/what it created with
// saveSanityBusiness(). Later phases (02-..., 03-...) call loadSanityBusiness() to continue on the
// same organisation instead of the shared fixture org that global-setup seeds.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR } from "../config/env";
import { uniqueSuffix } from "../api/data";
import { FIXED_PASSWORD } from "../setup/roles";

/** Everything phase 01 types into the forms - one place to change the business being set up. */
export function sanityBusinessDetails() {
	const id = uniqueSuffix().toLowerCase();
	const slug = `sanity-${id}`;
	return {
		slug,
		owner: { email: `owner@${slug}.test`, password: FIXED_PASSWORD, firstName: "Sanity", lastName: "Owner" },
		profile: {
			name: `Sanity Business ${id}`,
			legalName: `Sanity Business ${id} Pvt Ltd`,
			contactName: "Priya Raman",
			contactEmail: `contact@${slug}.test`,
			contactPhone: "+91 98450 12345",
			addressLine1: "12 MG Road",
			city: "Bengaluru",
			state: "Karnataka",
			country: "India",
			pincode: "560001",
			taxIdentifier: "29ABCDE1234F1Z5",
		},
		settings: {
			timezone: "Asia/Kolkata",
			currency: "INR",
			dateFormat: "dd-MM-yyyy",
			workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
		},
		campus: { name: `North Branch ${id}`, code: `NB${id.slice(-4).toUpperCase()}`, city: "Mysuru" },
	};
}

export type SanityBusinessDetails = ReturnType<typeof sanityBusinessDetails>;

/** Phase 02 - the academic year it marks current and how it tailors the school template. The
 * default catalog (Operion's school_template_master_items) is 12 grades LKG..Grade 10, one class
 * per grade and section "A", plus departments, designations, roles, subjects and fee categories;
 * phase 02 adds section "B" and switches Library on in the starter pack. Departments and
 * designations are not set up in the structure wizard - they only come from this template. */
export const SANITY_SCHOOL_TEMPLATE = {
	academicYear: { name: "2026-27", startDate: "2026-06-01", endDate: "2027-03-31" },
	defaultGrades: ["LKG", "UKG", ...Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`)],
	defaultSection: "A",
	addedSection: "B",
	/** Always-on template departments/designations (no module tag), used by the staff phase. */
	departments: ["Administration", "Academics", "Finance & Accounts"],
	designations: ["Principal", "Teacher", "Accountant"],
	starterPack: {
		/** Library on brings its department and designation along. */
		switchOn: { question: "Do you have a library with book borrowing?", module: "Library", department: "Library", designation: "Librarian" },
		/** Defaults to no and is left alone, so its module must stay out of the navigation and its department/designations are not created. */
		leftOff: { question: "Do you run school buses or arrange student transport?", module: "Transport", department: "Transport", designations: ["Transport Manager", "Driver"] },
	},
};

/** Phase 03 - the subjects the school template created (shown at the wizard's Subjects step), and the class that gets them. */
export const SANITY_SUBJECTS = {
	subjects: [
		{ name: "Mathematics", code: "MATH", mandatory: true },
		{ name: "English", code: "ENG", mandatory: true },
		{ name: "Science", code: "SCI", mandatory: true },
		{ name: "Computer Science", code: "CS", mandatory: false },
	],
	/** Assigned on the Main Campus class of this grade. */
	className: "Grade 1",
};

/** Phase 04 - staff added through HR "Add staff member" (template roles, designations, departments). */
export function sanityStaff(slug: string) {
	return {
		teacher: {
			firstName: "Anita", lastName: "Sharma", email: `anita.sharma@${slug}.test`, phone: "+91 98450 22334",
			employeeCode: "EMP-T001", joiningDate: "2026-06-01", campus: "Main Campus", department: "Academics",
			roles: ["Teacher"], designation: "Teacher", employmentType: "PERMANENT" as const,
		},
		accountant: {
			firstName: "Ravi", lastName: "Kumar", email: `ravi.kumar@${slug}.test`, phone: "+91 98450 55667",
			employeeCode: "EMP-A001", joiningDate: "2026-06-01", campus: "Main Campus", department: "Finance & Accounts",
			roles: ["Accountant"], designation: "Accountant", employmentType: "PERMANENT" as const,
		},
		/** The teacher becomes Grade 1 (Main Campus) section A's class teacher and Mathematics teacher. */
		assignment: { className: "Grade 1", section: "A", subject: "Mathematics", startDate: "2026-06-01" },
	};
}

/** Phase 05 - fee setup for one class. The template brings the standard categories (only those
 * of switched-on modules, so no Transport Fee); the school adds one of its own. Every component's
 * installments must add up to its amount - that is the payment schedule a student is billed by. */
export const SANITY_FEES = {
	templateCategories: [
		{ code: "TUITION", name: "Tuition Fee" },
		{ code: "ADMISSION", name: "Admission Fee" },
		{ code: "LIBRARY", name: "Library Fee" },
		{ code: "OTHER", name: "Other Fee" },
	],
	/** Tagged to the Transport module, which phase 02 left off. */
	absentCategoryCode: "TRANSPORT",
	addedCategory: { code: "LAB", name: "Computer Lab Fee", description: "Computer lab usage, billed twice a year", type: "GENERAL" as const },
	/** The class the structure is for - phase 07 allocates the student here and applies it. */
	className: "Grade 1",
	campus: "Main Campus",
	components: [
		{
			category: "Tuition Fee", amount: 36000, frequency: "QUARTERLY" as const, oneShotDiscount: 1000,
			installments: [
				{ dueDate: "2026-06-10", amount: 9000 }, { dueDate: "2026-09-10", amount: 9000 },
				{ dueDate: "2026-12-10", amount: 9000 }, { dueDate: "2027-03-10", amount: 9000 },
			],
		},
		{ category: "Admission Fee", amount: 5000, frequency: "ONE_SHOT" as const, installments: [{ dueDate: "2026-06-01", amount: 5000 }] },
		{
			category: "Computer Lab Fee", amount: 2400, frequency: "HALF_YEARLY" as const,
			installments: [{ dueDate: "2026-06-10", amount: 1200 }, { dueDate: "2026-12-10", amount: 1200 }],
		},
	],
};

/** Phase 06 - the first student, admitted through "Admit student" with the primary guardian typed
 * into the same form, plus a second guardian added from the student's Guardians panel. Operion's
 * form enrols the student in the same step, so it asks for year, class and section: the student
 * lands in Grade 1 A (the class phase 05 built the fee structure for) and phase 07 builds on it.
 * The admission number is left blank so the organisation's numbering format generates it. */
export const SANITY_ADMISSION = {
	student: {
		firstName: "Aarav", lastName: "Nair", dateOfBirth: "2019-08-14", gender: "Male", phone: "+91 98450 77881",
		address: "27 Lake View Road, Mysuru", admissionDate: "2026-06-01", previousSchool: "Little Stars Preschool",
		bloodGroup: "B+", category: "General", nationality: "Indian", medicalAlerts: "Allergic to peanuts",
		emergencyContactName: "Meera Nair", emergencyContactPhone: "+91 98450 77882", rollNumber: 1,
	},
	/** The class picker lists "<class> · <campus>" - Grade 1 exists on both campuses, so name the one phase 05 priced. */
	enrolment: { className: "Grade 1", campus: "Main Campus", sectionName: "A" },
	primaryGuardian: { firstName: "Suresh", lastName: "Nair", phone: "+91 98450 77883", relationship: "FATHER" },
	secondGuardian: { firstName: "Meera", lastName: "Nair", phone: "+91 98450 77882", email: "meera.nair@example.test", relationship: "MOTHER", emergencyContact: true, contactPriority: 2 },
};

/** What later phases need to continue on the business phase 01 set up. */
export interface SanityBusiness {
	organisationId: number;
	slug: string;
	ownerEmail: string;
	ownerPassword: string;
	details: SanityBusinessDetails;
	/** The last phase that finished all its steps on this business. */
	completedPhase: number;
	/** Set by phase 02 once the year is current and the template is applied. */
	academicYearName?: string;
	/** Set by phase 04: staff who can sign in, and the accountant's not-yet-claimed invite link. */
	staff?: { teacherEmail: string; teacherPassword: string; accountantEmail: string; accountantClaimLink: string; accountantPassword?: string };
	/** Set by phase 05: the class fee structure the student is billed by once allocated (phase 07). */
	fees?: { structureName: string; className: string; campus: string; total: number };
	/** Set by phase 06: the admitted student, who phase 07 allocates and bills. */
	student?: { id: number; name: string; admissionNumber: string; studentId: string; className: string; sectionName: string };
	/** Set by phase 07: the fee components applied to the student and what they add up to. */
	allocation?: { categories: string[]; total: number };
}

const STATE_FILE = join(AUTH_DIR, "sanity-business.json");

export function saveSanityBusiness(business: SanityBusiness): void {
	mkdirSync(AUTH_DIR, { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(business, null, 2));
}

/** Phase 01 calls this first, so a failed phase 01 can never leave an older run's business for phase 02. */
export function clearSanityBusiness(): void {
	rmSync(STATE_FILE, { force: true });
}

/** The business to continue on, provided phase `previousPhase` finished on it - otherwise this phase
 * must not run (it would act on a missing or half-built business), so it fails straight away. */
export function loadSanityBusiness(previousPhase: number): SanityBusiness {
	const pad = (n: number) => String(n).padStart(2, "0");
	if (!existsSync(STATE_FILE)) throw new Error(`Sanity phase ${pad(previousPhase)} has not completed in this run - fix it and run the phases again from 01 (npm run test:sanity).`);
	const business = JSON.parse(readFileSync(STATE_FILE, "utf8")) as SanityBusiness;
	if ((business.completedPhase ?? 0) < previousPhase) {
		throw new Error(`Sanity phase ${pad(previousPhase)} did not complete on business "${business.slug}" (last completed: ${pad(business.completedPhase ?? 0)}) - fix it and run the phases again from 01.`);
	}
	return business;
}
