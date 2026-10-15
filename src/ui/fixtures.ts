// The `test` every spec under tests/ui/ imports. Adds an auto-fixture that watches the page
// for uncaught JS exceptions, console errors and failed/5xx API calls, attaches them as
// `ui-diagnostics` (so the report can show which backend calls broke a screen), and fails
// the test if any occurred. Deliberate 4xx responses are expected traffic and are ignored.

import { test as base, expect } from "@playwright/test";
import { AppLayoutPage } from "../pages/AppLayoutPage";
import { ClaimStaffInvitePage } from "../pages/auth/ClaimStaffInvitePage";
import { EmailVerifyPage } from "../pages/auth/EmailVerifyPage";
import { ForgotPasswordPage } from "../pages/auth/ForgotPasswordPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { ResetPasswordPage } from "../pages/auth/ResetPasswordPage";
import { AcademicsPage } from "../pages/academics/AcademicsPage";
import { AcademicSetupWizardPage } from "../pages/academics/AcademicSetupWizardPage";
import { ClassSubjectsPanel } from "../pages/academics/ClassSubjectsPanel";
import { SubjectsPanel } from "../pages/academics/SubjectsPanel";
import { SectionTeachersPanel } from "../pages/academics/SectionTeachersPanel";
import { StaffCreatePage } from "../pages/hr/StaffCreatePage";
import { StaffDetailPage } from "../pages/hr/StaffDetailPage";
import { FeeSetupPage } from "../pages/fees/FeeSetupPage";
import { ClassOfferingsPanel } from "../pages/academics/ClassOfferingsPanel";
import { EventCalendarPanel } from "../pages/academics/EventCalendarPanel";
import { PeriodsPanel } from "../pages/academics/PeriodsPanel";
import { SectionsPanel } from "../pages/academics/SectionsPanel";
import { TimetablePanel } from "../pages/academics/TimetablePanel";
import { TopBarContext } from "../pages/academics/TopBarContext";
import { MembersPage } from "../pages/members/MembersPage";
import { RolesPanel } from "../pages/members/RolesPanel";
import { GoLiveCheckPage } from "../pages/onboarding/GoLiveCheckPage";
import { ReviewSchoolSetupPage } from "../pages/onboarding/ReviewSchoolSetupPage";
import { StructureSetupPage } from "../pages/onboarding/StructureSetupPage";
import { PlatformLoginPage } from "../pages/platform/PlatformLoginPage";
import { PlatformOrganisationsPage } from "../pages/platform/PlatformOrganisationsPage";
import { PublicAdmissionPage } from "../pages/public/PublicAdmissionPage";
import { AcademicYearsPanel } from "../pages/settings/AcademicYearsPanel";
import { BusinessSettingsPanel } from "../pages/settings/BusinessSettingsPanel";
import { CampusesPanel } from "../pages/settings/CampusesPanel";
import { DepartmentsPanel } from "../pages/settings/DepartmentsPanel";
import { DesignationsPanel } from "../pages/settings/DesignationsPanel";
import { OrganisationProfilePanel } from "../pages/settings/OrganisationProfilePanel";
import { SchoolTemplatePanel } from "../pages/settings/SchoolTemplatePanel";
import { ImportsExportsPanel, SettingsPage } from "../pages/settings/SettingsPage";
import { FeesSetupPage } from "../pages/fees/FeesSetupPage";
import { AdmissionsPage } from "../pages/admissions/AdmissionsPage";
import { ExaminationsPage } from "../pages/examinations/ExaminationsPage";
import { ExamDetailPage } from "../pages/examinations/ExamDetailPage";
import { MarksEntryPage } from "../pages/examinations/MarksEntryPage";
import { ReportCardPrintPage } from "../pages/examinations/ReportCardPrintPage";
import { FeeCollectionPage } from "../pages/fees/FeeCollectionPage";
import { FeeDemandPage } from "../pages/fees/FeeDemandPage";
import { LearningPage } from "../pages/learning/LearningPage";
import { LibraryPage } from "../pages/library/LibraryPage";
import { InventoryPage } from "../pages/inventory/InventoryPage";
import { AttendancePage } from "../pages/attendance/AttendancePage";
import { MarkAttendanceQuickPage } from "../pages/attendance/MarkAttendanceQuickPage";
import { StudentAttendanceSummary } from "../pages/attendance/StudentAttendanceSummary";
import { ReportDetailPage } from "../pages/reporting/ReportDetailPage";
import { ReportsPage } from "../pages/reporting/ReportsPage";
import { StudentCreatePage } from "../pages/students/StudentCreatePage";
import { StudentDetailPage } from "../pages/students/StudentDetailPage";
import { StudentListPage } from "../pages/students/StudentListPage";
import { knownDefect } from "../known-defects";
import { loadSeed, type SeedData } from "../setup/session";
import { instrument } from "./instrument";

const IGNORED_CONSOLE = [/Download the React DevTools/i, /^Failed to load resource:/];

export interface UiDiagnostics {
	consoleErrors: string[];
	failedRequests: string[];
}

// Page objects are exposed as fixtures (already instrumented) so the report can attribute
// failures to a component + action. Add new page objects here, not with `new X(page)` in specs.
interface UiFixtures {
	diagnostics: UiDiagnostics;
	seed: SeedData;
	loginPage: LoginPage;
	forgotPassword: ForgotPasswordPage;
	resetPassword: ResetPasswordPage;
	claimStaffInvite: ClaimStaffInvitePage;
	emailVerify: EmailVerifyPage;
	appLayout: AppLayoutPage;
	admissions: AdmissionsPage;
	examinations: ExaminationsPage;
	examDetail: ExamDetailPage;
	marksEntry: MarksEntryPage;
	reportCardPrint: ReportCardPrintPage;
	feeCollection: FeeCollectionPage;
	feeDemand: FeeDemandPage;
	learning: LearningPage;
	library: LibraryPage;
	inventory: InventoryPage;
	attendance: AttendancePage;
	quickAttendance: MarkAttendanceQuickPage;
	attendanceSummary: StudentAttendanceSummary;
	studentList: StudentListPage;
	studentCreate: StudentCreatePage;
	studentDetail: StudentDetailPage;
	feesSetup: FeesSetupPage;
	settings: SettingsPage;
	importsExports: ImportsExportsPanel;
	organisationProfile: OrganisationProfilePanel;
	businessSettings: BusinessSettingsPanel;
	academicYears: AcademicYearsPanel;
	campuses: CampusesPanel;
	departments: DepartmentsPanel;
	designations: DesignationsPanel;
	schoolTemplate: SchoolTemplatePanel;
	structureSetup: StructureSetupPage;
	reviewSetup: ReviewSchoolSetupPage;
	goLiveCheck: GoLiveCheckPage;
	publicAdmission: PublicAdmissionPage;
	platformLogin: PlatformLoginPage;
	platformOrganisations: PlatformOrganisationsPage;
	members: MembersPage;
	roles: RolesPanel;
	academics: AcademicsPage;
	academicSetup: AcademicSetupWizardPage;
	subjects: SubjectsPanel;
	classSubjects: ClassSubjectsPanel;
	sectionTeachers: SectionTeachersPanel;
	staffCreate: StaffCreatePage;
	staffDetail: StaffDetailPage;
	feeSetup: FeeSetupPage;
	classOfferings: ClassOfferingsPanel;
	sections: SectionsPanel;
	timetable: TimetablePanel;
	periods: PeriodsPanel;
	eventCalendar: EventCalendarPanel;
	topBar: TopBarContext;
	reports: ReportsPage;
	reportDetail: ReportDetailPage;
	knownDefect: void;
}

export const test = base.extend<UiFixtures>({
	seed: async ({}, use) => use(loadSeed()),
	loginPage: async ({ page }, use) => use(instrument(new LoginPage(page))),
	forgotPassword: async ({ page }, use) => use(instrument(new ForgotPasswordPage(page))),
	resetPassword: async ({ page }, use) => use(instrument(new ResetPasswordPage(page))),
	claimStaffInvite: async ({ page }, use) => use(instrument(new ClaimStaffInvitePage(page))),
	emailVerify: async ({ page }, use) => use(instrument(new EmailVerifyPage(page))),
	appLayout: async ({ page }, use) => use(instrument(new AppLayoutPage(page))),
	admissions: async ({ page }, use) => use(instrument(new AdmissionsPage(page))),
	examinations: async ({ page }, use) => use(instrument(new ExaminationsPage(page))),
	examDetail: async ({ page }, use) => use(instrument(new ExamDetailPage(page))),
	marksEntry: async ({ page }, use) => use(instrument(new MarksEntryPage(page))),
	reportCardPrint: async ({ page }, use) => use(instrument(new ReportCardPrintPage(page))),
	feeCollection: async ({ page }, use) => use(instrument(new FeeCollectionPage(page))),
	feeDemand: async ({ page }, use) => use(instrument(new FeeDemandPage(page))),
	learning: async ({ page }, use) => use(instrument(new LearningPage(page))),
	library: async ({ page }, use) => use(instrument(new LibraryPage(page))),
	inventory: async ({ page }, use) => use(instrument(new InventoryPage(page))),
	attendance: async ({ page }, use) => use(instrument(new AttendancePage(page))),
	quickAttendance: async ({ page }, use) => use(instrument(new MarkAttendanceQuickPage(page))),
	attendanceSummary: async ({ page }, use) => use(instrument(new StudentAttendanceSummary(page))),
	studentList: async ({ page }, use) => use(instrument(new StudentListPage(page))),
	studentCreate: async ({ page }, use) => use(instrument(new StudentCreatePage(page))),
	studentDetail: async ({ page }, use) => use(instrument(new StudentDetailPage(page))),
	feesSetup: async ({ page }, use) => use(instrument(new FeesSetupPage(page))),
	settings: async ({ page }, use) => use(instrument(new SettingsPage(page))),
	importsExports: async ({ page }, use) => use(instrument(new ImportsExportsPanel(page))),
	organisationProfile: async ({ page }, use) => use(instrument(new OrganisationProfilePanel(page))),
	businessSettings: async ({ page }, use) => use(instrument(new BusinessSettingsPanel(page))),
	academicYears: async ({ page }, use) => use(instrument(new AcademicYearsPanel(page))),
	campuses: async ({ page }, use) => use(instrument(new CampusesPanel(page))),
	departments: async ({ page }, use) => use(instrument(new DepartmentsPanel(page))),
	designations: async ({ page }, use) => use(instrument(new DesignationsPanel(page))),
	schoolTemplate: async ({ page }, use) => use(instrument(new SchoolTemplatePanel(page))),
	structureSetup: async ({ page }, use) => use(instrument(new StructureSetupPage(page))),
	reviewSetup: async ({ page }, use) => use(instrument(new ReviewSchoolSetupPage(page))),
	goLiveCheck: async ({ page }, use) => use(instrument(new GoLiveCheckPage(page))),
	publicAdmission: async ({ page }, use) => use(instrument(new PublicAdmissionPage(page))),
	platformLogin: async ({ page }, use) => use(instrument(new PlatformLoginPage(page))),
	platformOrganisations: async ({ page }, use) => use(instrument(new PlatformOrganisationsPage(page))),
	members: async ({ page }, use) => use(instrument(new MembersPage(page))),
	roles: async ({ page }, use) => use(instrument(new RolesPanel(page))),
	academics: async ({ page }, use) => use(instrument(new AcademicsPage(page))),
	academicSetup: async ({ page }, use) => use(instrument(new AcademicSetupWizardPage(page))),
	subjects: async ({ page }, use) => use(instrument(new SubjectsPanel(page))),
	classSubjects: async ({ page }, use) => use(instrument(new ClassSubjectsPanel(page))),
	sectionTeachers: async ({ page }, use) => use(instrument(new SectionTeachersPanel(page))),
	staffCreate: async ({ page }, use) => use(instrument(new StaffCreatePage(page))),
	staffDetail: async ({ page }, use) => use(instrument(new StaffDetailPage(page))),
	feeSetup: async ({ page }, use) => use(instrument(new FeeSetupPage(page))),
	classOfferings: async ({ page }, use) => use(instrument(new ClassOfferingsPanel(page))),
	sections: async ({ page }, use) => use(instrument(new SectionsPanel(page))),
	timetable: async ({ page }, use) => use(instrument(new TimetablePanel(page))),
	periods: async ({ page }, use) => use(instrument(new PeriodsPanel(page))),
	eventCalendar: async ({ page }, use) => use(instrument(new EventCalendarPanel(page))),
	topBar: async ({ page }, use) => use(instrument(new TopBarContext(page))),
	reports: async ({ page }, use) => use(instrument(new ReportsPage(page))),
	reportDetail: async ({ page }, use) => use(instrument(new ReportDetailPage(page))),
	knownDefect: [
		async ({}, use, testInfo) => {
			const defect = knownDefect(testInfo.title);
			if (defect) {
				testInfo.fail(true, defect);
				testInfo.annotations.push({ type: "known-defect", description: defect });
			}
			await use();
		},
		{ auto: true },
	],
	diagnostics: [
		async ({ page }, use, testInfo) => {
			const diagnostics: UiDiagnostics = { consoleErrors: [], failedRequests: [] };

			page.on("console", (msg) => {
				if (msg.type() !== "error") return;
				if (IGNORED_CONSOLE.some((pattern) => pattern.test(msg.text()))) return;
				diagnostics.consoleErrors.push(msg.text());
			});
			page.on("pageerror", (error) => diagnostics.consoleErrors.push(`Uncaught exception: ${error.message}`));
			page.on("requestfailed", (request) =>
				diagnostics.failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText ?? "failed"}`),
			);
			page.on("response", (response) => {
				if (response.status() >= 500) diagnostics.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
			});

			await use(diagnostics);

			await testInfo.attach("ui-diagnostics", { body: JSON.stringify(diagnostics), contentType: "application/json" });
			// Sanity journeys assert on diagnostics themselves, as a named step, so the failure
			// shows up in the journey timeline instead of as an anonymous teardown error.
			if (testInfo.annotations.some((a) => a.type === "diagnostics-handled")) return;
			expect.soft(diagnostics.failedRequests, "Failed/5xx API calls during the UI flow").toEqual([]);
			expect.soft(diagnostics.consoleErrors, "Browser console errors during the UI flow").toEqual([]);
		},
		{ auto: true },
	],
});

export { expect };
