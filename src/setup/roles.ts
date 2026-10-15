// Permission-driven role fixtures. Operion seeds only an "Owner" role per organisation; every
// other role is a tenant-defined bundle of permission codes, so "different users" here means
// different bundles. Add a fixture = add a row, then reference it as `as("name")` in API
// specs or `test.use({ storageState: storageStateFor("name") })` in UI specs.

export type RoleName = "owner" | "readOnlyStaff" | "feesCollector" | "noPermissions";

export interface RoleFixture {
	name: RoleName;
	/** Unset for `owner`, which comes from organisation provisioning rather than role creation. */
	roleName?: string;
	permissionCodes?: string[];
}

const VIEW_PERMISSIONS = [
	"ATTENDANCE_VIEW", "CLASS_VIEW", "COMMUNICATION_VIEW", "EXAM_VIEW", "FEE_VIEW", "GRADE_LEVEL_VIEW",
	"GUARDIAN_VIEW", "HR_VIEW", "INVENTORY_VIEW", "LIBRARY_VIEW", "MEMBERSHIP_VIEW", "PURCHASE_VIEW",
	"REPORT_VIEW", "SALES_VIEW", "STAFF_ATTENDANCE_VIEW", "STUDENT_VIEW", "SUBJECT_VIEW",
	"TEACHER_ASSIGNMENT_VIEW", "TRANSPORT_VIEW",
];

export const ROLE_FIXTURES: RoleFixture[] = [
	{ name: "owner" },
	{ name: "readOnlyStaff", roleName: "Auto Read Only Staff", permissionCodes: VIEW_PERMISSIONS },
	{
		name: "feesCollector",
		roleName: "Auto Fees Collector",
		permissionCodes: ["STUDENT_VIEW", "FEE_VIEW", "FEE_COLLECT", "FEE_INVOICE_MANAGE", "FEE_ASSIGNMENT_MANAGE"],
	},
	{ name: "noPermissions", roleName: "Auto No Permissions", permissionCodes: [] },
];

export const FIXED_PASSWORD = "AutoPassw0rd!123";
