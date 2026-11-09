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
			firstName: "Anita", lastName: "Sharma", gender: "Female" as const, email: `anita.sharma@${slug}.test`, phone: "+91 98450 22334",
			employeeCode: "EMP-T001", joiningDate: "2026-06-01", campus: "Main Campus", department: "Academics",
			roles: ["Teacher"], designation: "Teacher", employmentType: "PERMANENT" as const,
		},
		accountant: {
			firstName: "Ravi", lastName: "Kumar", gender: "Male" as const, email: `ravi.kumar@${slug}.test`, phone: "+91 98450 55667",
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
	primaryGuardian: { firstName: "Suresh", lastName: "Nair", phone: "+91 98450 77883", relationship: "FATHER", gender: "Male" },
	secondGuardian: { firstName: "Meera", lastName: "Nair", phone: "+91 98450 77882", email: "meera.nair@example.test", relationship: "MOTHER", emergencyContact: true, contactPriority: 2 },
};

/** Phase 08 - the school day (periods, one of them a break) and Grade 1 A's weekly timetable. Only
 * subject+teacher pairs the section has an ACTIVE assignment for can be placed, so the teacher
 * from phase 04 is also given English and Science on this section first (she already has Mathematics). */
export const SANITY_TIMETABLE = {
	periods: [
		{ ordinal: "1", label: "Period 1", start: "08:30", end: "09:15", breakSlot: false },
		{ ordinal: "2", label: "Period 2", start: "09:15", end: "10:00", breakSlot: false },
		{ ordinal: "3", label: "Short break", start: "10:00", end: "10:15", breakSlot: true },
		{ ordinal: "4", label: "Period 3", start: "10:15", end: "11:00", breakSlot: false },
	],
	extraSubjects: ["English", "Science"],
	/** Slots placed through the grid, in this order. */
	slots: [
		...["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].map((day) => ({ day, period: "Period 1", subject: "Mathematics" })),
		...["MONDAY", "WEDNESDAY", "FRIDAY"].map((day) => ({ day, period: "Period 2", subject: "English" })),
		...["TUESDAY", "THURSDAY"].map((day) => ({ day, period: "Period 2", subject: "Science" })),
		{ day: "MONDAY", period: "Period 3", subject: "Science" },
		{ day: "THURSDAY", period: "Period 3", subject: "English" },
	],
	/** Monday Period 3 is changed from Science to English, and Thursday Period 3 is cleared. */
	replaced: { day: "MONDAY", period: "Period 3", from: "Science", to: "English" },
	cleared: { day: "THURSDAY", period: "Period 3" },
	/** Weekly periods per subject once the grid is built: Mathematics 5 and English 4 are met by hand, Science 2 of 3 so Generate has one to place. */
	quotas: { Mathematics: 5, English: 4, Science: 3 } as Record<string, number>,
	room: { name: "Room 101", type: "Classroom", capacity: 30 },
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
	/** Set by phase 08: the section whose weekly timetable was built and how many slots it ended with. */
	timetable?: { className: string; sectionName: string; periods: number; filledSlots: number };
	/** Set by phase 08b: the appraisal cycle that was run for the phase 04 teacher and how it ended. */
	performance?: { cycleName: string; teacher: string; managerRating: number; goal: string; closed: boolean };
	/** Set by phase 09: the register days marked for the student and his month's attendance. */
	attendance?: { days: string[]; monthPercentage: number };
	/** Set by phase 10: the exam held for Grade 1 A, its papers and the marks the student got in each. */
	exam?: { name: string; subjects: { subject: string; maxMarks: number; passMarks: number; marks: number }[] };
	/** Set by phase 11: the student's published report card. */
	reportCard?: { id: number; total: number; max: number; percentage: number; grade: string; passed: boolean };
	/** Set by phase 12: the announcement published to the student's class. */
	announcement?: { title: string };
	/** Set by phase 13: the names of the reports the owner built. */
	reports?: string[];
	/** Set by phase 14: the year the school moves into and where the students ended up. */
	nextYear?: { name: string; promotedTo: string; transferTo: string; closed?: string };
}

/** Phase 08b - the optional Performance feature: metrics the school tracks, one appraisal cycle, one manager rating and one goal. */
export const SANITY_PERFORMANCE = {
	cycleName: "Term 1 Appraisal 2026-27",
	metrics: [
		{ label: "Punctuality", weight: 40, target: 90 },
		{ label: "Presence", weight: 60, target: 95 },
	],
	rating: { value: 4, comment: "Dependable class teacher; parents appreciate the weekly updates." },
	goal: { title: "Run a weekly reading club", details: "Friday afternoons for Grade 1." },
};

/** Phase 09 - two school days of Grade 1 A's register. The dates are fixed school days (a Monday and a
 * Tuesday of 2026-27) already in the past, so they can be marked whenever the run happens. The class
 * teacher marks both days from her own login; the owner locks them and corrects the second. */
export const SANITY_ATTENDANCE = {
	firstDay: "2026-10-12",
	secondDay: "2026-10-13",
	absence: { remarks: "Fever - mother called the office" },
	correction: { from: "ABSENT", to: "HALF_DAY", reason: "Came in after lunch with a doctor's note" },
	staff: { status: "PRESENT", checkIn: "08:05", checkOut: "15:40" },
	month: { year: 2026, name: "October" },
	/** One present day and one half day: (1 + 0.5) / 2 marked days. */
	summary: { percentage: 75, counts: "Present 1 · Late 0 · Half-day 1 · Absent 0 · Leave 0 · 2 days marked" },
};

/** Phase 10 - one unit test for Grade 1 A: three papers already sat (dates in the past), marks entered by the
 * class teacher. The template's "Standard Grading Scale" (A+ 90, A 80, B+ 70, ... F 0) grades the result.
 * 117 of 150 is 78.0% (B+); phase 11's re-totalled English paper (+4) lifts it to 121, 80.7% (A). */
export const SANITY_EXAM = {
	name: "Term 1 Unit Test",
	type: "UNIT_TEST",
	typeLabel: "Unit Test",
	gradingScale: { name: "Standard Grading Scale", bands: ["A+ (90%+)", "A (80%+)", "B+ (70%+)", "B (60%+)", "C+ (50%+)", "C (40%+)", "D (33%+)", "F (0%+)"] },
	strategy: "Must pass every subject",
	papers: [
		{ subject: "Mathematics", date: "2026-10-14", maxMarks: 50, passMarks: 18, marks: 42, remarks: "Neat working" },
		{ subject: "English", date: "2026-10-15", maxMarks: 50, passMarks: 18, marks: 37, remarks: "" },
		{ subject: "Science", date: "2026-10-16", maxMarks: 50, passMarks: 18, marks: 38, remarks: "" },
	],
	/** Typed into the Mathematics paper first; the server must refuse it. */
	outOfRange: 55,
};

/** Phase 11 - the report card for the phase 10 exam, and the English paper re-totalled after it was published. */
export const SANITY_REPORT_CARD = {
	first: { total: 117, max: 150, percentage: "78.0", grade: "B+" },
	correction: { subject: "English", from: 37, to: 41, remarks: "Re-totalled: page 3 was missed" },
	republished: { total: 121, max: 150, percentage: "80.7", grade: "A" },
};

/** Phase 12 - announcements. The class announcement reaches Aarav and both his guardians (phase 06); the staff
 * notice reaches the two staff members from phase 04. */
export const SANITY_COMMUNICATION = {
	classNotice: {
		title: "Term 1 unit test results are out",
		body: "Report cards for the Term 1 unit test are ready. Please collect them from the class teacher.",
		reach: 3,
	},
	staffNotice: {
		title: "Staff meeting on Friday",
		body: "All staff: meeting in the library on Friday at 3:30 pm to review the unit test results.",
		reach: 2,
	},
	reminder: { title: "Reminder: staff meeting today", body: "A reminder that the staff meeting is in the library at 3:30 pm today." },
	cancelled: { title: "Sports day moved", body: "Sports day is moved to next month." },
};

/** Phase 13 - the owner's own reports over the reporting_* views (the seeded standard reports cover shops, not schools). */
/** Phase 13 - the owner's own reports over the reporting_* views (the seeded standard reports cover shops, not schools).
 * The headings come from SQL aliases: the "Result columns" labels a report can be saved with are never applied to its
 * results (5fz). `headings` is what the result table shows. A raw DATE column comes back as the UTC instant of
 * local midnight - 2026-10-12 shows as "2026-10-11T18:30:00.000Z" (5ga) - so dates are formatted in the SQL. */
export const SANITY_REPORTS = {
	register: {
		name: "Class register",
		description: "Every enrolled student in a school year, by class and roll number",
		sql: "SELECT admission_number AS `Admission no.`, student_name AS `Student`, class_name AS `Class`, section_name AS `Section`, roll_number AS `Roll no.`, student_status AS `Status` FROM reporting_students WHERE academic_year_name = :year ORDER BY class_name, section_name, roll_number",
		parameters: [{ name: "year", type: "STRING", label: "School year" }],
		headings: ["Admission no.", "Student", "Class", "Section", "Roll no.", "Status"],
	},
	attendance: {
		name: "Attendance between dates",
		description: "Each student's register entries in a date range",
		sql: "SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS `Date`, student_name AS `Student`, class_name AS `Class`, section_name AS `Section`, attendance_status AS `Status`, is_excused AS `Excused` FROM reporting_attendance_daily WHERE attendance_date BETWEEN :fromDate AND :toDate ORDER BY attendance_date, student_name",
		parameters: [
			{ name: "fromDate", type: "DATE", label: "From" },
			{ name: "toDate", type: "DATE", label: "To" },
		],
		headings: ["Date", "Student", "Class", "Section", "Status", "Excused"],
	},
	results: {
		name: "Exam results",
		description: "Published report cards with totals and grades",
		sql: "SELECT exam_name AS `Exam`, student_name AS `Student`, class_name AS `Class`, total_marks_obtained AS `Marks`, total_max_marks AS `Out of`, ROUND(percentage, 1) AS `Percent`, overall_grade AS `Grade` FROM reporting_exam_results ORDER BY exam_name, student_name, report_card_id",
		parameters: [] as { name: string; type: string; label: string }[],
		headings: ["Exam", "Student", "Class", "Marks", "Out of", "Percent", "Grade"],
	},
};

/** Phases 14-15 - the year end. 2027-28 is set up from 2026-27 by Copy forward, Aarav is promoted into Grade 2 A,
 * his family asks to move him to the second campus, and 2026-27 is then closed with 2027-28 as the current year. */
export const SANITY_YEAR_END = {
	nextYear: { name: "2027-28", startDate: "2027-06-01", endDate: "2028-03-31" },
	promotedTo: { className: "Grade 2", sectionName: "A", rollNumber: 1 },
	promotionDate: "2027-03-31",
	transferReason: "Family is moving to Mysuru over the summer",
};

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
