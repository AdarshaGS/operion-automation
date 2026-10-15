// Learning screens (/learning). IDs refer to docs/SCENARIOS.md section 10 (LRN-U*). Each test builds
// its own draft-year section through the API, so its rows have unique titles in long shared lists.

import { test, expect } from "../../../src/sanity/fixtures";
import { attendanceSetup, type AttendanceSetup } from "../../../src/api/attendance";
import { LEARNING, CHILD, assignTeacher, createHomework, createLessonPlan, openQuiz, portalGuardian, rightAnswer } from "../../../src/api/learning";
import { uniqueSuffix } from "../../../src/api/data";
import { storageStateFor } from "../../../src/ui/session";
import { createDisposableUser, type OrgContext } from "../../../src/api/users";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { UI_BASE_URL } from "../../../src/config/env";
import { LearningPage } from "../../../src/pages/learning/LearningPage";
import type { ApiClient } from "../../../src/api/apiClient";
import type { Browser } from "@playwright/test";

async function subjectName(api: ApiClient, id: number): Promise<string> {
	const subjects = (await api.get("/api/v1/subjects")).expectStatus(200).body;
	return subjects.find((s: { id: number }) => s.id === id).name;
}

const sectionLabel = (s: AttendanceSetup) => `${s.className} – ${s.sectionName}`;
/** `datetime-local` value `minutes` from now in the browser's local time. */
function localDateTime(minutes: number) {
	const d = new Date(Date.now() + minutes * 60_000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function signedInAs(api: ApiClient, anon: ApiClient, seed: OrgContext, browser: Browser, permissions: string[], teaches?: { sectionId: number; subjectId: number }) {
	const user = await createDisposableUser(api, anon, seed, permissions);
	if (teaches) await assignTeacher(api, teaches.sectionId, teaches.subjectId, user.personId);
	const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } })).expectStatus(200);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
	const page = await context.newPage();
	return { page, context, learning: new LearningPage(page) };
}

test.describe("LRN-U01 homework", () => {
	test("LRN-U01 a teacher assigns homework from the dialog and sees it in the list", async ({ api, learning, page }) => {
		const s = await attendanceSetup(api, 2);
		const title = `UI homework ${uniqueSuffix()}`;
		await learning.open();
		await learning.assignHomework({ section: sectionLabel(s), subject: await subjectName(api, s.base.subjectId), title, dueDate: s.day(15) });
		await expect(learning.dialog("Assign homework")).toHaveCount(0);
		await expect(learning.row(title)).toContainText("0/2");
		await expect(learning.row(title)).toContainText(s.day(15));
		(await api.get(`${LEARNING}/homework`, { query: { sectionId: s.sectionId } })).expectJson((list) => expect(list.map((h: { title: string }) => h.title)).toContain(title));
		await expect(page.getByRole("alert").filter({ hasText: /Failed/ })).toHaveCount(0);
	});

	test("LRN-U01 the tracker shows a guardian's submission, and review marks it Reviewed", async ({ api, anon, seed, learning }) => {
		const s = await attendanceSetup(api, 2);
		const hw = await createHomework(api, s);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.post(`${CHILD}/homework/{homeworkId}/submission`, { params: { studentId: s.studentIds[0], homeworkId: hw.id }, body: { text: "My answer" } })).expectStatus(200);
		await learning.open();
		const tracker = await learning.trackHomework(hw.title);
		const row = tracker.getByRole("row").filter({ hasText: s.studentNames[0] });
		await expect(row).toContainText("My answer");
		await expect(row).toContainText("Submitted");
		await expect(tracker.getByRole("row").filter({ hasText: s.studentNames[1] })).toContainText("Not submitted");
		await learning.reviewSubmission(tracker, s.studentNames[0], "Neat work");
		await expect(row).toContainText("Reviewed");
		await expect(row).toContainText("Feedback: Neat work");
	});

	test("LRN-U01 cancelling homework shows it as Cancelled without a Cancel button", async ({ api, learning }) => {
		const s = await attendanceSetup(api, 1);
		const hw = await createHomework(api, s);
		await learning.open();
		await learning.row(hw.title).getByRole("button", { name: "Cancel" }).click();
		await expect(learning.row(hw.title)).toContainText("Cancelled");
		await expect(learning.row(hw.title).getByRole("button", { name: "Cancel" })).toHaveCount(0);
	});
});

test.describe("LRN-U02 quiz builder", () => {
	test("LRN-U02 create a quiz, add questions, publish, and see it locked and listed", async ({ api, learning, page }) => {
		const s = await attendanceSetup(api, 2);
		const title = `UI quiz ${uniqueSuffix()}`;
		await learning.open();
		await learning.tab("Quizzes");
		await learning.createQuiz({ section: sectionLabel(s), subject: await subjectName(api, s.base.subjectId), title, opensAt: localDateTime(-60), closesAt: localDateTime(60) });
		const manage = learning.dialog(title);
		await expect(manage.getByText("No questions yet.")).toBeVisible();
		await learning.addQuestion(manage, { text: "What is 6 x 7?", marks: 2, options: ["42", "36", "48"], correct: 0 });
		await expect(manage.getByText("1. What is 6 x 7?")).toBeVisible();
		await learning.addQuestion(manage, { text: "What is 9 - 4?", marks: 3, options: ["4", "5"], correct: 1 });
		await expect(manage.getByText("2. What is 9 - 4?")).toBeVisible();
		await manage.getByRole("button", { name: "Publish" }).click();
		await expect(manage.getByText("Published - questions are locked.")).toBeVisible();
		await expect(manage.getByRole("button", { name: "Remove question" })).toHaveCount(0);
		await manage.getByRole("button", { name: "Close" }).click();
		await expect(learning.row(title)).toContainText("PUBLISHED");
		await expect(learning.row(title)).toContainText("OPEN");
		await expect(learning.row(title)).toContainText("2 (5 marks)");
		await expect(learning.row(title)).toContainText("0/2");
		await expect(page.getByRole("alert").filter({ hasText: /Failed/ })).toHaveCount(0);
	});

	test("LRN-U02 the results dialog shows each student's score or Not attempted", async ({ api, anon, seed, learning }) => {
		const s = await attendanceSetup(api, 2);
		const { quiz, questions } = await openQuiz(api, s);
		const g = await portalGuardian(api, anon, seed.organisationSlug, s.studentIds[0]);
		(await g.client.post(`${CHILD}/quizzes/{quizId}/attempt`, { params: { studentId: s.studentIds[0], quizId: quiz.id }, body: { answers: [rightAnswer(questions[0])] } })).expectStatus(200);
		await learning.open();
		await learning.tab("Quizzes");
		await learning.row(quiz.title).getByRole("button", { name: "Results" }).click();
		const results = learning.dialog(`${quiz.title} – results`);
		await expect(results.getByRole("row").filter({ hasText: s.studentNames[0] })).toContainText("2");
		await expect(results.getByRole("row").filter({ hasText: s.studentNames[1] })).toContainText("Not attempted");
	});

	test("LRN-U02 a quiz that closes before it opens shows the error inside the dialog", async ({ api, learning }) => {
		const s = await attendanceSetup(api, 1);
		await learning.open();
		await learning.tab("Quizzes");
		const dialog = await learning.createQuiz({ section: sectionLabel(s), subject: await subjectName(api, s.base.subjectId), title: `Backwards ${uniqueSuffix()}`, opensAt: localDateTime(120), closesAt: localDateTime(60) });
		await expect(dialog.getByRole("alert")).toContainText("The quiz must close after it opens");
	});

	test("LRN-U02 a question with blank options shows the error in the quiz dialog", async ({ api, learning }) => {
		const s = await attendanceSetup(api, 1);
		const title = `Blank options ${uniqueSuffix()}`;
		await learning.open();
		await learning.tab("Quizzes");
		await learning.createQuiz({ section: sectionLabel(s), subject: await subjectName(api, s.base.subjectId), title, opensAt: localDateTime(-60), closesAt: localDateTime(60) });
		const manage = learning.dialog(title);
		await manage.getByLabel("Question", { exact: true }).fill("Unanswerable");
		await manage.getByRole("button", { name: "Add question" }).click();
		await expect(manage.getByRole("alert").filter({ hasText: "Every option needs text" })).toBeVisible();
	});
});

test.describe("LRN-U03 lesson-plan board", () => {
	test("LRN-U03 save a draft, submit it, and approve it from the review dialog", async ({ api, learning }) => {
		const s = await attendanceSetup(api, 1);
		const title = `UI plan ${uniqueSuffix()}`;
		await learning.open();
		await learning.tab("Lesson plans");
		await learning.newLessonPlan({ section: sectionLabel(s), subject: await subjectName(api, s.base.subjectId), date: s.day(12), title, objectives: "Equivalent fractions" });
		await expect(learning.row(title)).toContainText("DRAFT");
		await learning.row(title).getByRole("button", { name: "Submit" }).click();
		await expect(learning.row(title)).toContainText("SUBMITTED");
		await learning.row(title).getByRole("button", { name: "Review" }).click();
		const review = learning.dialog(title);
		await review.getByLabel("Review note (required to reject)").fill("Good plan");
		await review.getByRole("button", { name: "Approve" }).click();
		await expect(learning.row(title)).toContainText("APPROVED");
		await expect(learning.row(title).getByRole("button", { name: "Edit" })).toHaveCount(0);
	});

	test("LRN-U03 rejecting needs a note; the rejected plan shows the note and can be edited", async ({ api, learning }) => {
		const s = await attendanceSetup(api, 1);
		const plan = await createLessonPlan(api, s);
		await api.post(`${LEARNING}/lesson-plans/{id}/submit`, { params: { id: plan.id } });
		await learning.open();
		await learning.tab("Lesson plans");
		await learning.row(plan.title).getByRole("button", { name: "Review" }).click();
		const review = learning.dialog(plan.title);
		await review.getByRole("button", { name: "Reject" }).click();
		await expect(review.getByRole("alert")).toContainText("Tell the teacher what to change");
		await review.getByLabel("Review note (required to reject)").fill("Add an exit ticket");
		await review.getByRole("button", { name: "Reject" }).click();
		await expect(learning.row(plan.title)).toContainText("REJECTED");
		await expect(learning.row(plan.title)).toContainText("Rejected: Add an exit ticket");
		await expect(learning.row(plan.title).getByRole("button", { name: "Edit" })).toBeVisible();
	});
});

test.describe("LRN-U04 leaderboards", () => {
	for (const [track, header] of [["Quizzes", "Avg quiz %"], ["Academic", "Marks %"], ["Rewards", "Points"]] as const) {
		test(`LRN-U04 the ${track} board loads for a section`, async ({ api, learning, page }) => {
			const s = await attendanceSetup(api, 1);
			if (track === "Rewards") (await api.post(`${LEARNING}/rewards`, { body: { enrollmentId: s.enrollmentIds[0], title: "Star", points: 4 } })).expectStatus(200);
			await learning.open();
			await learning.tab("Leaderboards");
			await learning.showBoard(sectionLabel(s), track);
			if (track === "Rewards") {
				await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
				await expect(learning.row(s.studentNames[0])).toContainText("4");
			} else {
				await expect(page.getByText(`Nobody in this section has a ${track.toLowerCase()} score yet.`)).toBeVisible();
			}
			await expect(page.getByRole("alert").filter({ hasText: /Failed/ })).toHaveCount(0);
		});
	}

	test("LRN-U04 granting a reward from the dialog puts the student on the Rewards board", async ({ api, learning, page }) => {
		const s = await attendanceSetup(api, 2);
		await learning.open();
		await learning.tab("Leaderboards");
		await learning.showBoard(sectionLabel(s), "Rewards");
		const dialog = await learning.grantReward({ student: `2. ${s.studentNames[1]}`, title: "Kindness", points: 9, reason: "Helped a classmate" });
		await expect(dialog).toHaveCount(0);
		await expect(learning.row(s.studentNames[1]).first()).toContainText("9");
		await expect(page.getByText("Recent rewards")).toBeVisible();
	});

	test("LRN-U04 an administrator sees the teacher leaderboard", async ({ learning, page }) => {
		await learning.open();
		await learning.tab("Leaderboards");
		await expect(page.getByText("Teacher leaderboard")).toBeVisible();
	});
});

test.describe("scoped users", () => {
	test("LRN-U01 a teacher's section list holds only the section they teach", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const { page, context, learning } = await signedInAs(api, anon, seed, browser, [], { sectionId: s.sectionId, subjectId: s.base.subjectId });
		await learning.open();
		await page.getByRole("button", { name: "Assign", exact: true }).click();
		const dialog = learning.dialog("Assign homework");
		await dialog.getByRole("combobox", { name: "Section" }).click();
		await expect(page.getByRole("option")).toHaveText([sectionLabel(s)]);
		await context.close();
	});

	test("LRN-U04 a teacher does not see the teacher leaderboard", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const { page, context, learning } = await signedInAs(api, anon, seed, browser, [], { sectionId: s.sectionId, subjectId: s.base.subjectId });
		await learning.open();
		await learning.tab("Leaderboards");
		await expect(page.getByRole("combobox", { name: "Section" })).toBeVisible();
		await expect(page.getByText("Teacher leaderboard")).toHaveCount(0);
		await context.close();
	});

	test("LRN-U01 a view-only user (LEARNING_VIEW) is offered no buttons that change anything", async ({ api, anon, seed, browser }) => {
		const s = await attendanceSetup(api, 1);
		const hw = await createHomework(api, s);
		const { page, context, learning } = await signedInAs(api, anon, seed, browser, ["LEARNING_VIEW"]);
		await learning.open();
		await expect(learning.row(hw.title)).toBeVisible();
		const offered: string[] = [];
		const check = async (name: string) => { if ((await page.getByRole("button", { name, exact: true }).count()) > 0) offered.push(name); };
		await check("Assign");
		await check("Cancel");
		await learning.tab("Quizzes");
		await check("New quiz");
		await learning.tab("Lesson plans");
		await check("New plan");
		await learning.tab("Materials");
		await check("Add material");
		await learning.tab("Leaderboards");
		await learning.choose(page, "Section", sectionLabel(s));
		if (await page.getByRole("button", { name: "Grant reward" }).isEnabled()) offered.push("Grant reward");
		expect(offered, "buttons a view-only user should not be offered").toEqual([]);
		await context.close();
	});
});
