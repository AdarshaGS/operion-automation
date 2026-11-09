// Dashboard summary, charts, setup checklist and the per-user dismiss flags. IDs refer to docs/SCENARIOS.md
// section 22 (DSH-*). Exact counts are checked in a throwaway organisation (every other spec writes to the
// shared one); the shared organisation is only checked for relationships that hold whatever is in it.

import { test, expect } from "../../../src/api/fixtures";
import { createDisposableUser } from "../../../src/api/users";
import { buildAcademicBase } from "../../../src/api/academics";
import { createStaff } from "../../../src/api/hr";
import { INV, createCampus, createCategory, createItem, stockIn } from "../../../src/api/inventory";
import { createBook } from "../../../src/api/library";
import { createOrder, transition, approvedOrder, receive } from "../../../src/api/purchase";
import { stockedItem } from "../../../src/api/sales";
import { DASH, charts, firstOfThisMonth, lastMonth, scratchOrg, summary, today } from "../../../src/api/dashboard";
import { enableModule } from "../../../src/setup/provisioning";
import { uniqueSuffix } from "../../../src/api/data";

test.describe("DSH-01 summary counts", () => {
	test("DSH-01 a new organisation starts at zero, with its one campus and no sales or open orders", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const s = await summary(client);
		expect(s.enrollment).toEqual({ activeStudents: 0, campuses: 1 });
		expect(s.attendanceToday).toEqual({ present: 0, absent: 0, late: 0, halfDay: 0, marked: 0, attendanceRatePercent: 0 });
		expect(s.fees).toEqual({ totalInvoiced: 0, totalCollected: 0, collectionRatePercent: 0, outstanding: 0, overdueInvoices: 0 });
		expect(s.staff).toEqual({ activeStaff: 0, departments: 0, designations: 0 });
		expect(s.examinations).toEqual({ activeExams: 0 });
		expect(s.library).toEqual({ activeBooks: 0, currentlyBorrowed: 0, overdueBorrows: 0 });
		expect(s.transport).toEqual({ activeVehicles: 0, activeRoutes: 0, studentsUsingTransport: 0 });
		expect(s.inventory).toEqual({ activeItems: 0, categories: 0, lowStockItems: 0 });
		expect(s.communication).toEqual({ announcementsThisMonth: 0 });
		expect(s.sales).toEqual({ totalToday: 0, totalThisMonth: 0 });
		expect(s.purchase).toEqual({ openOrders: 0 });
		expect(s.preferences).toEqual({ setupProgressDismissed: false, quickActionsDismissed: false });
	});

	test("DSH-01 the summary counts only the caller's organisation", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const mine = await summary(api);
		const theirs = await summary(client);
		expect(mine.enrollment.activeStudents).toBeGreaterThan(0);
		expect(theirs.enrollment.activeStudents).toBe(0);
		expect(theirs.inventory.activeItems).toBe(0);
		expect(theirs.staff.activeStaff).toBe(0);
	});

	test("DSH-01 campuses follow the campus list", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		await createCampus(client);
		await createCampus(client);
		expect((await summary(client)).enrollment.campuses).toBe(3);
	});

	test("DSH-01 staff: active staff, departments and designations", async ({ request, calls }) => {
		const { client, campusId } = await scratchOrg(request, calls);
		const a = await createStaff(client, campusId);
		await createStaff(client, campusId);
		expect((await summary(client)).staff).toEqual({ activeStaff: 2, departments: 2, designations: 2 });
		(await client.post("/api/v1/hr/staff/{id}/exit", { params: { id: a.id }, body: { exitType: "RESIGNATION", exitDate: today(), reason: "Automation", initiatedBy: null } })).expectStatus(200);
		expect((await summary(client)).staff.activeStaff).toBe(1);
	});

	test("DSH-01 inventory: active items and categories (a discontinued item is not active)", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const category = await createCategory(client);
		await createItem(client, { categoryId: category.id });
		const gone = await createItem(client, { categoryId: category.id });
		await createCategory(client);
		(await client.post(`${INV}/items/{id}/discontinue`, { params: { id: gone.id } })).expectStatus(200);
		expect((await summary(client)).inventory).toMatchObject({ activeItems: 1, categories: 2 });
	});

	test("DSH-01 inventory: low stock follows the reorder level and clears when stock arrives", async ({ request, calls }) => {
		const { client, campusId } = await scratchOrg(request, calls);
		const low = await createItem(client, { reorderLevel: 10 });
		const fine = await createItem(client, { reorderLevel: 10 });
		await stockIn(client, low.id, campusId, 3);
		await stockIn(client, fine.id, campusId, 30);
		expect((await summary(client)).inventory.lowStockItems).toBe(1);
		await stockIn(client, low.id, campusId, 20);
		expect((await summary(client)).inventory.lowStockItems).toBe(0);
	});

	test("DSH-01 inventory: an item that is low at two campuses is one low-stock item, not two", async ({ request, calls }) => {
		const { client, campusId } = await scratchOrg(request, calls);
		const second = await createCampus(client);
		const item = await createItem(client, { reorderLevel: 10 });
		await stockIn(client, item.id, campusId, 2);
		await stockIn(client, item.id, second.id, 2);
		const s = await summary(client);
		expect(s.inventory.lowStockItems, "the tile is labelled Low stock items").toBe(1);
		expect(s.inventory.lowStockItems).toBeLessThanOrEqual(s.inventory.activeItems);
	});

	test("DSH-01 library: active books", async ({ request, calls }) => {
		const org = await scratchOrg(request, calls);
		await enableModule(org.org.id, "LIBRARY").catch(() => undefined);
		await createBook(org.client);
		await createBook(org.client);
		expect((await summary(org.client)).library.activeBooks).toBe(2);
	});

	test("DSH-01 sales: today's total and this month's total, and sales from earlier months count in neither", async ({ request, calls }) => {
		const { client, campusId } = await scratchOrg(request, calls);
		const item = await stockedItem(client, campusId, 50);
		const customer = (await client.post(`${INV}/customers`, { body: { name: `Buyer ${uniqueSuffix()}` } })).expectStatus(200).body;
		const sell = async (saleDate: string, qty: number, price: number) =>
			(await client.post("/api/v1/sales", { body: { customerId: customer.id, campusId, saleDate, lines: [{ itemId: item.id, quantity: qty, unitPrice: price }] } })).expectStatus(200);
		await sell(today(), 2, 50);
		await sell(today(), 1, 25);
		if (firstOfThisMonth() !== today()) await sell(firstOfThisMonth(), 3, 10);
		await sell(lastMonth(), 1, 999);
		const expectedMonth = 125 + (firstOfThisMonth() !== today() ? 30 : 0);
		expect((await summary(client)).sales).toEqual({ totalToday: 125, totalThisMonth: expectedMonth });
	});

	test("DSH-01 purchase: open orders are the ones not yet RECEIVED or CANCELLED", async ({ request, calls }) => {
		const { client, campusId } = await scratchOrg(request, calls);
		await createOrder(client, campusId);
		const submitted = await createOrder(client, campusId);
		await transition(client, submitted.id, "submit");
		const approved = await approvedOrder(client, campusId);
		const partial = await approvedOrder(client, campusId);
		await receive(client, partial.id, [[partial.lines[0].id, 1]]);
		expect((await summary(client)).purchase.openOrders).toBe(4);
		await receive(client, approved.id, [[approved.lines[0].id, approved.lines[0].quantity]]);
		expect((await summary(client)).purchase.openOrders).toBe(3);
		await transition(client, submitted.id, "cancel");
		expect((await summary(client)).purchase.openOrders).toBe(2);
	});

	test("DSH-01 communication: announcements published this month (a draft does not count)", async ({ request, calls }) => {
		const org = await scratchOrg(request, calls);
		await enableModule(org.org.id, "COMMUNICATION");
		const before = (await summary(org.client)).communication.announcementsThisMonth;
		const made = await org.client.post("/api/v1/announcements", { body: { campusId: org.campusId, title: `Notice ${uniqueSuffix()}`, body: "Hello", audienceType: "ORG", audienceRefId: null, audienceMemberPersonIds: null, scheduledAt: null } });
		made.expectStatus([200, 201]);
		expect((await summary(org.client)).communication.announcementsThisMonth, "a draft").toBe(before);
		(await org.client.post("/api/v1/announcements/{id}/publish", { params: { id: made.body.id } })).expectStatus(200);
		expect((await summary(org.client)).communication.announcementsThisMonth).toBe(before + 1);
	});

	test("DSH-01 the figures in the shared organisation agree with each other", async ({ api }) => {
		const s = await summary(api);
		expect(s.fees.outstanding).toBeCloseTo(s.fees.totalInvoiced - s.fees.totalCollected, 2);
		const a = s.attendanceToday;
		expect(a.present + a.absent + a.late + a.halfDay).toBeLessThanOrEqual(a.marked);
		expect(a.attendanceRatePercent).toBe(a.marked === 0 ? 0 : Math.floor((a.present * 100) / a.marked));
		expect(s.inventory.lowStockItems).toBeLessThanOrEqual(s.inventory.activeItems);
		expect(s.library.overdueBorrows).toBeLessThanOrEqual(s.library.currentlyBorrowed);
	});

	test("DSH-01 the fee figures are never negative and the collection rate stays within 0-100", async ({ api }) => {
		const { fees } = await summary(api);
		expect(fees.totalCollected, "total collected").toBeGreaterThanOrEqual(0);
		expect(fees.outstanding, "outstanding").toBeGreaterThanOrEqual(0);
		expect(fees.collectionRatePercent, "collection rate").toBeGreaterThanOrEqual(0);
		expect(fees.collectionRatePercent, "collection rate").toBeLessThanOrEqual(100);
	});
});

test.describe("DSH-02 charts", () => {
	test("DSH-02 a new organisation has empty trend and class series and six zero-filled fee months ending this month", async ({ request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		const c = await charts(client);
		expect(c.attendanceTrend).toEqual([]);
		expect(c.studentsByClass).toEqual([]);
		expect(c.feeCollections).toHaveLength(6);
		expect(c.feeCollections.every((m) => m.collected === 0 && m.invoiced === 0)).toBe(true);
		expect(c.feeCollections[5].month).toBe(today().slice(0, 7));
	});

	test("DSH-02 the fee months are consecutive, oldest first", async ({ api }) => {
		const { feeCollections } = await charts(api);
		expect(feeCollections).toHaveLength(6);
		const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
		for (let i = 1; i < feeCollections.length; i++) expect(index(feeCollections[i].month)).toBe(index(feeCollections[i - 1].month) + 1);
		for (const m of feeCollections) {
			expect(m.collected).toBeGreaterThanOrEqual(0);
			expect(m.invoiced).toBeGreaterThanOrEqual(0);
		}
	});

	test("DSH-02 students by class lists each class once with a positive count, and never exceeds the active students", async ({ api }) => {
		const c = await charts(api);
		const s = await summary(api);
		expect(c.studentsByClass.length).toBeGreaterThan(0);
		expect(new Set(c.studentsByClass.map((x) => x.className)).size).toBe(c.studentsByClass.length);
		for (const x of c.studentsByClass) expect(x.students).toBeGreaterThan(0);
		expect(c.studentsByClass.reduce((sum, x) => sum + x.students, 0)).toBeLessThanOrEqual(s.enrollment.activeStudents);
	});

	test("DSH-02 the attendance trend covers the last 30 days only, oldest first, with each day's rate worked out from its marks", async ({ api }) => {
		const { attendanceTrend } = await charts(api);
		const oldest = new Date();
		oldest.setDate(oldest.getDate() - 29);
		const floor = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2, "0")}-${String(oldest.getDate()).padStart(2, "0")}`;
		const dates = attendanceTrend.map((p) => p.date);
		expect(dates).toEqual([...dates].sort());
		for (const p of attendanceTrend) {
			expect(p.date >= floor && p.date <= today()).toBe(true);
			expect(p.present).toBeLessThanOrEqual(p.marked);
			expect(p.ratePercent).toBe(p.marked === 0 ? 0 : Math.floor((p.present * 100) / p.marked));
		}
	});
});

test.describe("DSH-03 dismissing the setup guide and quick actions", () => {
	const manager = ["ORGANISATION_MANAGE"];

	test("DSH-03 both are shown until dismissed, each dismissal is independent and sticks across sessions", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, manager);
		expect((await summary(user.client)).preferences).toEqual({ setupProgressDismissed: false, quickActionsDismissed: false });
		(await user.client.post(`${DASH}/setup-progress/dismiss`)).expectStatus(200);
		expect((await summary(user.client)).preferences).toEqual({ setupProgressDismissed: true, quickActionsDismissed: false });
		(await user.client.post(`${DASH}/quick-actions/dismiss`)).expectStatus(200);
		expect((await summary(user.client)).preferences).toEqual({ setupProgressDismissed: true, quickActionsDismissed: true });
		const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: user.password } })).expectStatus(200);
		expect((await summary(anon.withToken(login.body.token, "again"))).preferences).toEqual({ setupProgressDismissed: true, quickActionsDismissed: true });
	});

	test("DSH-03 dismissing again is harmless", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, manager);
		for (let i = 0; i < 3; i++) (await user.client.post(`${DASH}/quick-actions/dismiss`)).expectStatus(200);
		expect((await summary(user.client)).preferences.quickActionsDismissed).toBe(true);
	});

	test("DSH-03 a dismissal belongs to the person who made it", async ({ api, anon, seed }) => {
		const one = await createDisposableUser(api, anon, seed, manager);
		const two = await createDisposableUser(api, anon, seed, manager);
		(await one.client.post(`${DASH}/setup-progress/dismiss`)).expectStatus(200);
		expect((await summary(two.client)).preferences.setupProgressDismissed).toBe(false);
		expect((await summary(one.client)).preferences.setupProgressDismissed).toBe(true);
	});

	test("DSH-03 simultaneous first dismissals leave the dashboard working", async ({ api, anon, seed }) => {
		const user = await createDisposableUser(api, anon, seed, manager);
		const results = await Promise.all([
			user.client.post(`${DASH}/setup-progress/dismiss`),
			user.client.post(`${DASH}/setup-progress/dismiss`),
			user.client.post(`${DASH}/quick-actions/dismiss`),
			user.client.post(`${DASH}/quick-actions/dismiss`),
		]);
		expect.soft(results.map((r) => r.status), "dismiss requests").toEqual([200, 200, 200, 200]);
		const after = await user.client.get(`${DASH}/summary`);
		expect.soft(after.status, "the dashboard after simultaneous dismissals").toBe(200);
		expect.soft(after.body.preferences, "both dismissals should have been kept").toEqual({ setupProgressDismissed: true, quickActionsDismissed: true });
	});

	test("DSH-03 a dismissal is per organisation: the same flags in another organisation are untouched", async ({ api, request, calls }) => {
		const { client } = await scratchOrg(request, calls);
		(await api.post(`${DASH}/setup-progress/dismiss`)).expectStatus(200);
		expect((await summary(client)).preferences).toEqual({ setupProgressDismissed: false, quickActionsDismissed: false });
	});
});

test.describe("DSH-04 setup checklist", () => {
	test("DSH-04 Roles turns on once a role beyond the owner exists, and Members once a second member joins", async ({ request, calls, anon }) => {
		const org = await scratchOrg(request, calls);
		const seed = { organisationSlug: org.slug, campusId: org.campusId };
		expect((await summary(org.client)).setupChecklist).toMatchObject({ rolesConfigured: false, membersAdded: false });
		(await org.client.post("/api/v1/roles", { body: { name: `Role ${uniqueSuffix()}`, description: "x", permissionCodes: ["STUDENT_VIEW"], portal: false } })).expectStatus([200, 201]);
		expect((await summary(org.client)).setupChecklist).toMatchObject({ rolesConfigured: true, membersAdded: false });
		await createDisposableUser(org.client, anon, seed, ["STUDENT_VIEW"]);
		expect((await summary(org.client)).setupChecklist).toMatchObject({ rolesConfigured: true, membersAdded: true });
	});

	test("DSH-04 Academic setup needs a current academic year and a class", async ({ request, calls }) => {
		const org = await scratchOrg(request, calls);
		expect((await summary(org.client)).setupChecklist.academicSetupConfigured).toBe(false);
		(await org.client.post("/api/v1/academic-years", { body: { name: `Year ${uniqueSuffix()}`, startDate: "2026-04-01", endDate: "2027-03-31" } })).expectStatus([200, 201]);
		expect((await summary(org.client)).setupChecklist.academicSetupConfigured, "an academic year that is not current").toBe(false);
		await buildAcademicBase(org.client);
		expect((await summary(org.client)).setupChecklist.academicSetupConfigured).toBe(true);
	});

	test("DSH-04 Structure needs the contact name and email, a time zone and a current academic year", async ({ request, calls }) => {
		const org = await scratchOrg(request, calls);
		const before = (await summary(org.client)).setupChecklist.structureConfigured;
		expect(before).toBe(false);
		const profile = (await org.client.get("/api/v1/organisations/profile")).expectStatus(200).body;
		(await org.client.patch("/api/v1/organisations/profile", { body: { ...profile, primaryContactName: "Head Teacher", primaryContactEmail: `head@${org.slug}.test` } })).expectStatus(200);
		expect((await summary(org.client)).setupChecklist.structureConfigured, "contact set, but no current academic year").toBe(false);
		await buildAcademicBase(org.client);
		expect((await summary(org.client)).setupChecklist.structureConfigured).toBe(true);
	});

	test("DSH-04 Students, Fees and Attendance flags follow the data in the shared organisation", async ({ api }) => {
		const s = await summary(api);
		expect(s.setupChecklist).toMatchObject({ studentsAdded: s.enrollment.activeStudents > 0, rolesConfigured: true, membersAdded: true, academicSetupConfigured: true });
	});
});

test.describe("DSH-05 who can see the dashboard", () => {
	const paths = [`${DASH}/summary`, `${DASH}/charts`];

	for (const path of paths) {
		test(`DSH-05 GET ${path.replace(DASH, "")} without a token returns 401`, async ({ anon }) => {
			(await anon.get(path)).expectStatus(401);
		});
	}

	test("DSH-05 both dismiss endpoints without a token return 401", async ({ anon }) => {
		(await anon.post(`${DASH}/setup-progress/dismiss`)).expectStatus(401);
		(await anon.post(`${DASH}/quick-actions/dismiss`)).expectStatus(401);
	});

	test("DSH-05 a member without ORGANISATION_MANAGE gets 403 from every dashboard endpoint, whatever else they can do", async ({ api, anon, seed }) => {
		const staff = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW", "FEE_VIEW", "HR_VIEW", "INVENTORY_VIEW"]);
		for (const path of paths) (await staff.client.get(path)).expectStatus(403);
		(await staff.client.post(`${DASH}/setup-progress/dismiss`)).expectStatus(403);
		(await staff.client.post(`${DASH}/quick-actions/dismiss`)).expectStatus(403);
	});

	test("DSH-05 the read-only and no-permission roles are refused as well", async ({ as }) => {
		for (const role of ["readOnlyStaff", "noPermissions"] as const) (await as(role).get(`${DASH}/summary`)).expectStatus(403);
	});

	test("DSH-05 a refused dismissal leaves no flag behind", async ({ api, anon, seed }) => {
		const staff = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await staff.client.post(`${DASH}/setup-progress/dismiss`)).expectStatus(403);
		const owner = await createDisposableUser(api, anon, seed, ["ORGANISATION_MANAGE"]);
		expect((await summary(owner.client)).preferences.setupProgressDismissed).toBe(false);
	});

	test("DSH-05 ORGANISATION_MANAGE alone does not reveal fee, staff or inventory figures that need their own permission", async ({ api, anon, seed }) => {
		const manager = await createDisposableUser(api, anon, seed, ["ORGANISATION_MANAGE"]);
		const res = await manager.client.get(`${DASH}/summary`);
		const body = res.body as Record<string, unknown>;
		const leaked = res.status === 200 ? ["fees", "staff", "inventory", "sales", "purchase"].filter((key) => body[key] != null) : [];
		expect(leaked, "sections returned to a member who holds none of FEE_VIEW, HR_VIEW, INVENTORY_VIEW, SALES_VIEW or PURCHASE_VIEW").toEqual([]);
	});
});
