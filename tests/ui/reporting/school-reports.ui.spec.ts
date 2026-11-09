// Ready-made school reports from the Reports screen: fill the parameters, run, read the student's row,
// export it as CSV. IDs refer to docs/SCENARIOS.md section 20 (RPT-U20..22).

import { readFileSync } from "node:fs";
import { test, expect } from "../../../src/sanity/fixtures";
import type { ApiClient } from "../../../src/api/apiClient";
import { attendanceSetup, markRegister } from "../../../src/api/attendance";
import { approveSchedule, examSetup } from "../../../src/api/examinations";
import { invoiced, pay } from "../../../src/api/fees";
import { REPORTS } from "../../../src/api/reports";

async function reportId(api: ApiClient, name: string): Promise<number> {
	(await api.post(`${REPORTS}/seed-standard`)).expectStatus(200);
	return (await api.get(REPORTS)).expectStatus(200).body.find((r: { name: string }) => r.name === name).id;
}

test.describe("ready-made school reports", () => {
	test("RPT-U20 Fee defaulters shows a part-paid overdue student with the amount still owed, and exports it", async ({ api, reportDetail }) => {
		const i = await invoiced(api, { each: 1500 });
		await pay(api, i, i.invoice.id, 500);
		await reportDetail.open(await reportId(api, "Fee defaulters"));
		await reportDetail.paramInput("As on date").fill(i.day(28));
		await reportDetail.run();
		const row = reportDetail.resultTable().getByRole("row").filter({ hasText: i.studentNames[0] });
		await expect(row).toContainText(i.className);
		await expect(row).toContainText("1000");
		const csv = readFileSync(await (await reportDetail.exportCsv()).path(), "utf8");
		expect(csv.split("\n")[0]).toContain("overdue_amount");
		expect(csv).toContain(i.studentNames[0]);
	});

	test("RPT-U20 Fee collection register shows the receipt that was just collected", async ({ api, reportDetail }) => {
		const i = await invoiced(api, { each: 1500 });
		const payment = (await pay(api, i, i.invoice.id, 700)).expectStatus([200, 201]).body;
		await reportDetail.open(await reportId(api, "Fee collection register"));
		await reportDetail.paramInput("From date").fill(i.day(1));
		await reportDetail.paramInput("To date").fill(i.day(28));
		await reportDetail.run();
		const row = reportDetail.resultTable().getByRole("row").filter({ hasText: payment.receiptNumber });
		await expect(row).toContainText(i.studentNames[0]);
		await expect(row).toContainText("CASH");
		await expect(row).toContainText("700");
	});

	test("RPT-U21 Attendance percentage shows each student's rate for the range", async ({ api, reportDetail }) => {
		const s = await attendanceSetup(api, 1);
		await markRegister(api, s, s.day(10), ["PRESENT"]);
		await markRegister(api, s, s.day(11), ["ABSENT"]);
		await reportDetail.open(await reportId(api, "Attendance percentage by student"));
		await reportDetail.paramInput("From date").fill(s.day(1));
		await reportDetail.paramInput("To date").fill(s.day(28));
		await reportDetail.run();
		const row = reportDetail.resultTable().getByRole("row").filter({ hasText: s.studentNames[0] });
		await expect(row).toContainText("50");
	});

	test("RPT-U22 Exam results by section lists the published results of the exam typed in", async ({ api, reportDetail }) => {
		const s = await examSetup(api, 1);
		await approveSchedule(api, s, 0, [90]);
		await approveSchedule(api, s, 1, [45]);
		(await api.post("/api/v1/examinations/exams/{examId}/report-cards", { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[0], gradingScaleId: s.scale.id } })).expectStatus([200, 201]);
		await reportDetail.open(await reportId(api, "Exam results by section"));
		await reportDetail.paramInput("Exam name").fill(s.exam.name);
		await reportDetail.run();
		const row = reportDetail.resultTable().getByRole("row").filter({ hasText: s.studentNames[0] });
		await expect(row).toContainText("PASS");
		await expect(row).toContainText("A");
	});
});
