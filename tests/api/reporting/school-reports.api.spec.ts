// Ready-made school reports, seeded with the standard reports: fee collection register and summary, fee
// defaulters, attendance percentage, exam results and subject-wise marks. Each test builds its own class in
// the shared organisation and reads back only its own rows (by student name or the unique fee head / exam).
// IDs refer to docs/SCENARIOS.md section 20 (RPT-20..23).

import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { attendanceSetup, markRegister } from "../../../src/api/attendance";
import { approveSchedule, examSetup } from "../../../src/api/examinations";
import { FEES, getInvoice, invoiced, pay } from "../../../src/api/fees";
import { REPORTS, runReport } from "../../../src/api/reports";

type Row = Record<string, any>;

/** Seeds the standard reports (idempotent) and runs the named one. */
async function run(api: ApiClient, name: string, parameters: Record<string, unknown>): Promise<Row[]> {
	(await api.post(`${REPORTS}/seed-standard`)).expectStatus(200);
	const report = (await api.get(REPORTS)).expectStatus(200).body.find((r: { name: string }) => r.name === name);
	expect(report, `standard report "${name}" exists after seeding`).toBeTruthy();
	return (await runReport(api, report.id, parameters)).expectStatus(200).body.rows;
}

const forStudent = (rows: Row[], name: string) => rows.filter((r) => r.student_name === name);

test.describe("RPT-20 fee collection", () => {
	test("RPT-20 the register lists a cleared receipt with the student's class, fee head, method, amount and collector", async ({ api }) => {
		const i = await invoiced(api, { each: 1500 });
		const payment = (await pay(api, i, i.invoice.id, 1000)).expectStatus([200, 201]).body;
		const rows = forStudent(await run(api, "Fee collection register", { fromDate: i.day(1), toDate: i.day(28) }), i.studentNames[0]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ receipt_number: payment.receiptNumber, class_name: i.className, section_name: "A", fee_heads: i.category.name, payment_method: "CASH" });
		expect(Number(rows[0].amount)).toBe(1000);
		expect(rows[0].collected_by).toEqual(expect.stringContaining("@"));
		expect(String(rows[0].payment_date)).toContain(i.day(12));
	});

	test("RPT-20 a receipt outside the date range, and a bounced cheque, are left out", async ({ api }) => {
		const i = await invoiced(api, { each: 1500 });
		await pay(api, i, i.invoice.id, 300);
		const cheque = (await pay(api, i, i.invoice.id, 200, { paymentMethod: "CHEQUE", paymentReference: "C-RPT", paymentBankName: "HDFC" })).expectStatus([200, 201]).body;
		(await api.post(`${FEES}/payments/{paymentId}/bounce`, { params: { paymentId: cheque.id } })).expectStatus(200);
		const inRange = forStudent(await run(api, "Fee collection register", { fromDate: i.day(1), toDate: i.day(28) }), i.studentNames[0]);
		expect(inRange.map((r) => Number(r.amount))).toEqual([300]);
		const outOfRange = forStudent(await run(api, "Fee collection register", { fromDate: i.day(13), toDate: i.day(28) }), i.studentNames[0]);
		expect(outOfRange).toEqual([]);
	});

	test("RPT-20 the summary totals cleared collections by method and fee head", async ({ api }) => {
		const i = await invoiced(api, { students: 2, each: 1500 });
		await pay(api, i, i.invoice.id, 1000);
		await pay(api, i, i.invoice.id, 250, { paymentMethod: "UPI", paymentReference: "UPI-RPT" });
		const rows = (await run(api, "Fee collection summary", { fromDate: i.day(1), toDate: i.day(28) })).filter((r) => r.fee_head === i.category.name);
		const byMethod = Object.fromEntries(rows.map((r) => [r.payment_method, { receipts: Number(r.receipts), amount: Number(r.amount) }]));
		expect(byMethod).toEqual({ CASH: { receipts: 1, amount: 1000 }, UPI: { receipts: 1, amount: 250 } });
	});
});

test.describe("RPT-21 fee defaulters", () => {
	test("RPT-21 a part-paid invoice past its due date lists the student with the overdue amount and days overdue", async ({ api }) => {
		const i = await invoiced(api, { each: 1500 });
		await pay(api, i, i.invoice.id, 500);
		const due = i.structure.installments[0].dueDate;
		const asOf = i.day(28);
		const rows = forStudent(await run(api, "Fee defaulters", { asOfDate: asOf }), i.studentNames[0]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ class_name: i.className, section_name: "A", overdue_invoices: 1 });
		expect(Number(rows[0].overdue_amount)).toBe(1000);
		expect(String(rows[0].oldest_due_date)).toContain(due);
		expect(Number(rows[0].days_overdue)).toBe((Date.parse(asOf) - Date.parse(due)) / 86_400_000);
	});

	test("RPT-21 an invoice not yet due, or fully paid, is not a default", async ({ api }) => {
		const i = await invoiced(api, { each: 1500 });
		const due = i.structure.installments[0].dueDate;
		expect(forStudent(await run(api, "Fee defaulters", { asOfDate: due }), i.studentNames[0]), "due today is not overdue").toEqual([]);
		await pay(api, i, i.invoice.id, 1500);
		expect((await getInvoice(api, i.invoice.id)).status).toBe("PAID");
		expect(forStudent(await run(api, "Fee defaulters", { asOfDate: i.day(28) }), i.studentNames[0])).toEqual([]);
	});
});

test.describe("RPT-22 attendance percentage", () => {
	test("RPT-22 present and late count, half day counts half, leave is left out - and it matches the monthly summary", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const days: [string, string][] = [["PRESENT", "ABSENT"], ["LATE", "ABSENT"], ["HALF_DAY", "ABSENT"], ["LEAVE", "PRESENT"]];
		for (let d = 0; d < days.length; d++) await markRegister(api, s, s.day(10 + d), days[d]);
		const rows = await run(api, "Attendance percentage by student", { fromDate: s.day(1), toDate: s.day(28) });
		const [first] = forStudent(rows, s.studentNames[0]);
		const [second] = forStudent(rows, s.studentNames[1]);
		expect(first).toMatchObject({ class_name: s.className, section_name: "A", days_marked: 4 });
		expect([first.present_days, first.late_days, first.half_days, first.absent_days, first.leave_days].map(Number)).toEqual([1, 1, 1, 0, 1]);
		expect(Number(first.attendance_percentage)).toBeCloseTo(83.3, 1);
		expect(Number(second.attendance_percentage)).toBeCloseTo(25.0, 1);
		const summary = (await api.get("/api/v1/attendance/enrollments/{enrollmentId}/summary", { params: { enrollmentId: s.enrollmentIds[0] }, query: { year: s.year, month: s.month } })).expectStatus(200).body;
		expect(Number(first.attendance_percentage)).toBeCloseTo(summary.percentage, 1);
	});

	test("RPT-22 only days inside the range are counted", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		await markRegister(api, s, s.day(10), ["ABSENT"]);
		await markRegister(api, s, s.day(11), ["PRESENT"]);
		const [row] = forStudent(await run(api, "Attendance percentage by student", { fromDate: s.day(11), toDate: s.day(28) }), s.studentNames[0]);
		expect(Number(row.days_marked)).toBe(1);
		expect(Number(row.attendance_percentage)).toBe(100);
	});
});

test.describe("RPT-23 exam results and marks", () => {
	test("RPT-23 exam results list each published card with total, percentage, grade, result and rank", async ({ api }) => {
		const s = await examSetup(api, 2);
		await approveSchedule(api, s, 0, [90, 30]);
		await approveSchedule(api, s, 1, [45, 10]);
		for (const enrollmentId of s.enrollmentIds) {
			(await api.post("/api/v1/examinations/exams/{examId}/report-cards", { params: { examId: s.exam.id }, body: { studentEnrollmentId: enrollmentId, gradingScaleId: s.scale.id } })).expectStatus([200, 201]);
		}
		const rows = await run(api, "Exam results by section", { examName: s.exam.name });
		expect(rows.map((r) => r.student_name).sort()).toEqual([...s.studentNames].sort());
		const [top] = forStudent(rows, s.studentNames[0]);
		const [low] = forStudent(rows, s.studentNames[1]);
		expect(top).toMatchObject({ class_name: s.className, section_name: "A", overall_grade: "A", result: "PASS" });
		expect([Number(top.total_marks_obtained), Number(top.total_max_marks), Number(top.percentage)]).toEqual([135, 150, 90]);
		expect(low.result).toBe("FAIL");
		expect(rows[0].student_name, "ordered by rank").toBe(s.studentNames[0]);
	});

	test("RPT-23 subject-wise marks give one row per student per subject, with pass/fail and the marks status", async ({ api }) => {
		const s = await examSetup(api, 2);
		await approveSchedule(api, s, 0, [90, 30]);
		(await api.post("/api/v1/examinations/schedules/{scheduleId}/marks", { params: { scheduleId: s.schedules[1].id }, body: { marks: [
			{ studentEnrollmentId: s.enrollmentIds[0], marksObtained: 45, absent: false, remarks: null },
			{ studentEnrollmentId: s.enrollmentIds[1], marksObtained: null, absent: true, remarks: null },
		] } })).expectStatus([200, 201]);
		const rows = await run(api, "Subject-wise marks", { examName: s.exam.name });
		expect(rows).toHaveLength(4);
		const cell = (student: number, subject: number): Row => rows.find((r) => r.student_name === s.studentNames[student] && r.subject_name === s.subjectNames[subject]) ?? {};
		expect(cell(0, 0)).toMatchObject({ result: "PASS", register_status: "APPROVED" });
		expect(Number(cell(0, 0).marks_obtained)).toBe(90);
		expect(cell(1, 0)).toMatchObject({ result: "FAIL", register_status: "APPROVED" });
		expect(cell(0, 1)).toMatchObject({ result: "PASS", register_status: "DRAFT" });
		expect(cell(1, 1)).toMatchObject({ result: "ABSENT" });
	});

	test("RPT-23 another exam's results are not mixed in", async ({ api }) => {
		const s = await examSetup(api, 1);
		expect(await run(api, "Exam results by section", { examName: s.exam.name })).toEqual([]);
		expect(await run(api, "Subject-wise marks", { examName: s.exam.name })).toEqual([]);
	});
});
