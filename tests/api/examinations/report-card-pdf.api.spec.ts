// Report-card PDFs: one student's card, a whole section in one file, and the guardian's own copy.
// The first print freezes the card in the issued-document register; a card under correction prints
// PROVISIONAL for staff and is withheld from the guardian; a superseded card prints watermarked.
// IDs refer to docs/SCENARIOS.md (RCP-*).

import { inflateSync } from "node:zlib";
import { test, expect } from "../../../src/api/fixtures";
import type { ApiClient, ApiResult } from "../../../src/api/apiClient";
import { examSetup, approveSchedule, type ExamSetup } from "../../../src/api/examinations";
import { portalGuardian } from "../../../src/api/learning";
import { ME } from "../../../src/api/portal";
import { createDisposableUser } from "../../../src/api/users";

const PUBLISH = "/api/v1/examinations/exams/{examId}/report-cards";
const CARD_PDF = "/api/v1/examinations/report-cards/{reportCardId}/report-card.pdf";
const SECTION_PDF = "/api/v1/examinations/exams/{examId}/report-cards.pdf";
const CHILD_PDF = `${ME}/children/{studentId}/report-cards/{reportCardId}/report-card.pdf`;
const MARKS = "/api/v1/examinations/schedules/{scheduleId}/marks";
const AFTER_PUBLISH = "/api/v1/examinations/marks/{marksEntryId}/correct-after-publish";

async function approvedExam(api: ApiClient, students = 2): Promise<ExamSetup> {
	const s = await examSetup(api, students);
	await approveSchedule(api, s, 0, students === 2 ? [80, 40] : Array.from({ length: students }, () => 70));
	await approveSchedule(api, s, 1, students === 2 ? [40, 20] : Array.from({ length: students }, () => 35));
	return s;
}

const publish = async (api: ApiClient, s: ExamSetup, index: number) =>
	(await api.post(PUBLISH, { params: { examId: s.exam.id }, body: { studentEnrollmentId: s.enrollmentIds[index], gradingScaleId: s.scale.id } })).expectStatus([200, 201]).body as { id: number };

/** Asserts a real PDF came back and returns its page count. Page objects may sit in compressed object streams, so every Flate stream is inflated before counting. */
function expectPdf(res: ApiResult, fileNamePart: string): number {
	expect(res.headers["content-type"]).toContain("application/pdf");
	expect(res.headers["content-disposition"]).toContain(fileNamePart);
	expect(res.bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
	const raw = res.bytes.toString("latin1");
	const parts = [raw];
	for (const match of raw.matchAll(/stream\r?\n/g)) {
		const start = match.index! + match[0].length;
		const end = raw.indexOf("endstream", start);
		try {
			parts.push(inflateSync(res.bytes.subarray(start, end)).toString("latin1"));
		} catch {
			// not a Flate stream (image, font) or trailing bytes - ignore
		}
	}
	return parts.reduce((n, part) => n + (part.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length, 0);
}

test.describe("RCP-01 staff print one report card", () => {
	test("RCP-01 a published card downloads as a one-page PDF named after the student and exam", async ({ api }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		const res = (await api.get(CARD_PDF, { params: { reportCardId: card.id } })).expectStatus(200);
		expect(expectPdf(res, "report-card-")).toBe(1);
	});

	test("RCP-01 reprinting the same card works every time", async ({ api }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		for (let i = 0; i < 2; i++) expectPdf((await api.get(CARD_PDF, { params: { reportCardId: card.id } })).expectStatus(200), "report-card-");
	});

	test("RCP-01 an unknown report card is 404", async ({ api }) => {
		(await api.get(CARD_PDF, { params: { reportCardId: 99999999 } })).expectStatus(404);
	});

	test("RCP-01 a user without EXAM_VIEW is refused", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		const staff = await createDisposableUser(api, anon, seed, ["STUDENT_VIEW"]);
		(await staff.client.get(CARD_PDF, { params: { reportCardId: card.id } })).expectStatus(403);
	});

	test("RCP-01 a card under correction still prints for staff (watermarked PROVISIONAL)", async ({ api }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(200);
		expectPdf((await api.get(CARD_PDF, { params: { reportCardId: card.id } })).expectStatus(200), "report-card-");
	});

	test("RCP-01 a superseded card still prints (watermarked SUPERSEDED)", async ({ api }) => {
		const s = await approvedExam(api);
		const old = await publish(api, s, 0);
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(200);
		await publish(api, s, 0);
		expectPdf((await api.get(CARD_PDF, { params: { reportCardId: old.id } })).expectStatus(200), "report-card-");
	});
});

test.describe("RCP-02 staff print a whole section", () => {
	test("RCP-02 the section PDF has one page per published card", async ({ api }) => {
		const s = await approvedExam(api);
		await publish(api, s, 0);
		await publish(api, s, 1);
		const res = (await api.get(SECTION_PDF, { params: { examId: s.exam.id }, query: { sectionId: s.sectionId } })).expectStatus(200);
		expect(expectPdf(res, "report-cards-")).toBe(2);
	});

	test("RCP-02 students without a published card are left out", async ({ api }) => {
		const s = await approvedExam(api);
		await publish(api, s, 1);
		const res = (await api.get(SECTION_PDF, { params: { examId: s.exam.id }, query: { sectionId: s.sectionId } })).expectStatus(200);
		expect(expectPdf(res, "report-cards-")).toBe(1);
	});

	test("RCP-02 a section with no published cards is rejected", async ({ api }) => {
		const s = await approvedExam(api);
		(await api.get(SECTION_PDF, { params: { examId: s.exam.id }, query: { sectionId: s.sectionId } })).expectStatus([400, 409, 422])
			.expectJson((e) => expect(e.error).toMatch(/No published report cards/i));
	});
});

test.describe("RCP-03 guardians download their own child's card", () => {
	test("RCP-03 a guardian downloads their child's published card", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		expectPdf((await g.client.get(CHILD_PDF, { params: { studentId: s.studentIds[0], reportCardId: card.id } })).expectStatus(200), "report-card-");
	});

	test("RCP-03 a guardian cannot download another student's card, even through their own child's URL", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const other = await publish(api, s, 1);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.get(CHILD_PDF, { params: { studentId: s.studentIds[1], reportCardId: other.id } })).expectStatus(403);
		(await g.client.get(CHILD_PDF, { params: { studentId: s.studentIds[0], reportCardId: other.id } })).expectStatus(403);
	});

	test("RCP-03 a card under correction is withheld from the guardian", async ({ api, anon, seed }) => {
		const s = await approvedExam(api);
		const card = await publish(api, s, 0);
		const entry = (await api.get(MARKS, { params: { scheduleId: s.schedules[0].id } })).body.find((e: { studentEnrollmentId: number }) => e.studentEnrollmentId === s.enrollmentIds[0]);
		(await api.patch(AFTER_PUBLISH, { params: { marksEntryId: entry.id }, body: { marksObtained: 60, absent: false } })).expectStatus(200);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.get(CHILD_PDF, { params: { studentId: s.studentIds[0], reportCardId: card.id } })).expectStatus(403);
	});
});
