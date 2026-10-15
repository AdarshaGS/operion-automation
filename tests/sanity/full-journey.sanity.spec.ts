// Start-to-end sanity: sign in -> setup is in place -> admit a student -> configure fees ->
// bill and collect -> access control holds -> session ends cleanly. Each step names the thing
// being proven; if one fails the report shows exactly where the journey broke and which steps
// never ran.

import { test, expect } from "../../src/sanity/fixtures";
import { journey } from "../../src/sanity/journey";
import { createDisposableUser } from "../../src/api/users";
import { uniqueCode } from "../../src/api/data";
import { expectShape } from "../../src/api/shapes";

const S = {
	backendUp: "Environment › backend is up and publishes its API contract",
	frontendUp: "Environment › frontend is serving the app",
	uiLogin: "Authentication › owner signs in through the login form",
	apiSession: "Authentication › the API session is the owner with the Owner role",
	setupComplete: "Setup › academic setup is reported complete",
	setupData: "Setup › the academic year, class and section exist",
	admitUi: "Admission › admit a student through the form",
	admitVerify: "Admission › the student is enrolled and visible in API and UI list",
	feeSetupUi: "Fees › create a fee category and structure in the setup screen",
	feeSetupApi: "Fees › the structure is available through the API",
	assign: "Fees › assign the fee to the new student",
	invoice: "Fees › generate the invoice",
	pay: "Fees › collect the payment and the invoice settles",
	history: "Fees › the payment appears in the student's history",
	rbacStudents: "Access control › read-only staff can view students but not admit",
	rbacFees: "Access control › fees collector can view fees; no-permission user is blocked",
	logout: "Session › logging out revokes the refresh token",
	browserHealth: "Browser health › no console errors or failed backend calls during the journey",
};

test("sanity: owner journey from sign-in to fee collection", async ({ page, api, anon, as, seed, diagnostics, loginPage, studentList, studentCreate, studentDetail, feesSetup }) => {
	test.info().annotations.push({ type: "diagnostics-handled" });
	const j = journey(Object.values(S));

	const admissionNumber = uniqueCode("SAN");
	const categoryCode = uniqueCode("SAN");
	const categoryName = `Sanity Tuition ${categoryCode}`;
	let studentId = 0;
	let enrollmentId = 0;
	let structure: { id: number; feeStructureGroupId: number; installments: { id: number }[] } | undefined;
	let assignmentId = 0;
	let invoiceId = 0;
	let paymentId = 0;

	await j.step(S.backendUp, async () => {
		const res = await anon.get("/v3/api-docs");
		res.expectStatus(200).expectJson((body) => expect(Object.keys(body.paths).length).toBeGreaterThan(100));
	});

	await j.step(S.frontendUp, async () => {
		await loginPage.open();
		await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
	});

	await j.step(S.uiLogin, async () => {
		await loginPage.login(seed.organisationSlug, seed.ownerEmail, seed.ownerPassword);
		await expect(page).toHaveURL(/\/dashboard/);
	});

	await j.step(S.apiSession, async () => {
		(await api.get("/api/v1/auth/me")).expectStatus(200).expectJson((body) => {
			expect(body.email).toBe(seed.ownerEmail);
			expect(body.roleNames).toContain("Owner");
		});
	});

	await j.step(S.setupComplete, async () => {
		(await api.get("/api/v1/academics/setup-status")).expectStatus(200).expectJson((body) => expect(body.configured).toBe(true));
	});

	await j.step(S.setupData, async () => {
		(await api.get("/api/v1/academic-years")).expectStatus(200).expectJson((body) => {
			const year = body.find((y: { id: number }) => y.id === seed.academicYearId);
			expect(year, "seeded academic year is listed").toBeDefined();
			expect(year.current).toBe(true);
		});
		(await api.get("/api/v1/school-classes")).expectStatus(200).expectJson((body) => expect(body.map((c: { id: number }) => c.id)).toContain(seed.classId));
	});

	await j.step(S.admitUi, async () => {
		await studentList.open();
		await studentList.admitStudent();
		await studentCreate.fill({
			firstName: "Sanity",
			lastName: "Student",
			admissionNumber,
			admissionDate: "2026-06-01",
			enrolment: { academicYearName: seed.academicYearName, className: seed.className, sectionName: seed.sectionName, rollNumber: 200 + Math.floor(Math.random() * 700) },
		});
		await studentCreate.submit();
		await studentDetail.expectStudentIdInUrl();
		await expect(studentDetail.studentName("Sanity Student")).toBeVisible();
	});

	await j.step(S.admitVerify, async () => {
		const search = await api.get("/api/v1/students/search", { query: { search: admissionNumber } });
		search.expectStatus(200).expectJson((body) => {
			expect(body.totalElements).toBe(1);
			expect(body.content[0].sectionId).toBe(seed.sectionId);
		});
		studentId = search.body.content[0].id;
		const enrollments = await api.get("/api/v1/students/{studentId}/enrollments", { params: { studentId } });
		enrollments.expectStatus(200).expectJson((body) => expect(body.length).toBeGreaterThan(0));
		enrollmentId = enrollments.body[0].id;

		await studentList.open();
		await expect(studentList.row(admissionNumber)).toContainText("Sanity Student");
	});

	await j.step(S.feeSetupUi, async () => {
		await feesSetup.open();
		await feesSetup.addCategory({ code: categoryCode, name: categoryName });
		await expect(feesSetup.categoryRow(categoryCode)).toBeVisible();
		await feesSetup.selectStructureScope(seed.academicYearName, seed.className);
		await feesSetup.setUpStructureIfNeeded(`${seed.className} Fees (sanity)`);
		await feesSetup.addStructure({ categoryName, amount: 5000, installmentDueDate: "2026-07-01" });
		await expect(feesSetup.structureRow(categoryName)).toContainText("5000");
	});

	await j.step(S.feeSetupApi, async () => {
		const categories = await api.get("/api/v1/fees/categories");
		categories.expectStatus(200);
		const category = categories.body.find((c: { code: string }) => c.code === categoryCode);
		expect(category, "category created in the UI is returned by the API").toBeDefined();

		const groups = await api.get("/api/v1/fees/structure-groups", { query: { academicYearId: seed.academicYearId, schoolClassId: seed.classId } });
		groups.expectStatus(200);
		const structures = await api.get("/api/v1/fees/structures", { query: { feeStructureGroupId: groups.body[0].id } });
		structures.expectStatus(200);
		structure = structures.body.find((s: { feeCategoryId: number }) => s.feeCategoryId === category.id);
		expect(structure, "structure created in the UI is returned by the API").toBeDefined();
		expect(structure!.installments).toHaveLength(1);
	});

	await j.step(S.assign, async () => {
		const res = await api.post("/api/v1/fees/assignments", { body: { studentEnrollmentId: enrollmentId, feeStructureId: structure!.id, paymentFrequency: "MONTHLY" } });
		res.expectStatus([200, 201]).expectJson((body) => {
			expectShape(body, { id: "number", effectiveAmount: "number", status: "string" });
			expect(body.effectiveAmount).toBe(5000);
		});
		assignmentId = res.body.id;
	});

	await j.step(S.invoice, async () => {
		const res = await api.post("/api/v1/fees/assignments/{assignmentId}/invoices", { params: { assignmentId }, body: { feeStructureInstallmentId: structure!.installments[0].id } });
		res.expectStatus([200, 201]).expectJson((body) => {
			expect(body.totalAmount).toBe(5000);
			expect(body.outstanding).toBe(5000);
		});
		invoiceId = res.body.id;
	});

	await j.step(S.pay, async () => {
		const payment = await api.post("/api/v1/fees/payments", {
			body: { academicYearId: seed.academicYearId, amount: 5000, paymentMethod: "CASH", paymentDate: "2026-07-05", allocations: [{ invoiceId, amount: 5000 }] },
		});
		payment.expectStatus([200, 201]).expectJson((body) => expectShape(body, { id: "number", receiptNumber: "string" }));
		paymentId = payment.body.id;
		(await api.get("/api/v1/fees/invoices/{invoiceId}", { params: { invoiceId } })).expectStatus(200).expectJson((body) => {
			expect(body.amountPaid).toBe(5000);
			expect(body.outstanding).toBe(0);
		});
	});

	await j.step(S.history, async () => {
		(await api.get("/api/v1/fees/payments", { query: { studentEnrollmentId: enrollmentId } })).expectStatus(200).expectJson((body) => expect(body.map((p: { id: number }) => p.id)).toContain(paymentId));
	});

	await j.step(S.rbacStudents, async () => {
		(await as("readOnlyStaff").get("/api/v1/students")).expectStatus(200);
		(await as("readOnlyStaff").post("/api/v1/students", { body: { personId: 1, admissionNumber: "x", admissionDate: "2026-06-01" } })).expectStatus(403);
	});

	await j.step(S.rbacFees, async () => {
		(await as("feesCollector").get("/api/v1/fees/categories")).expectStatus(200);
		(await as("noPermissions").get("/api/v1/fees/categories")).expectStatus(403);
		(await as("noPermissions").get("/api/v1/students")).expectStatus(403);
	});

	await j.step(S.logout, async () => {
		const user = await createDisposableUser(api, anon, seed);
		(await user.client.post("/api/v1/auth/logout")).expectStatus([200, 204]);
		(await anon.post("/api/v1/auth/refresh", { body: { organisationSlug: seed.organisationSlug, refreshToken: user.refreshToken } })).expectStatus(401);
	});

	await j.step(S.browserHealth, async () => {
		expect(diagnostics.failedRequests, "Failed/5xx backend calls seen by the browser").toEqual([]);
		expect(diagnostics.consoleErrors, "Browser console errors").toEqual([]);
	});
});
