// Library catalogue, borrowing, fines, settings, import/export. IDs refer to docs/SCENARIOS.md section 11
// (LIB-*). Library settings are one row per organisation, so anything that changes them runs in a
// throwaway organisation, where a plain person (no staff profile) counts as a student borrower.

import { test, expect } from "../../../src/api/fixtures";
import { attendanceSetup } from "../../../src/api/attendance";
import { createPerson } from "../../../src/api/academics";
import { createOtherOrganisation } from "../../../src/api/organisations";
import { createDisposableUser } from "../../../src/api/users";
import { LIBRARY, addCopy, bookWithCopies, copyStatus, createBook, issue, personOfStudent } from "../../../src/api/library";
import { uniqueCode } from "../../../src/api/data";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

async function campusOf(client: { get: (path: string) => Promise<{ body: { id: number }[] }> }) {
	return (await client.get("/api/v1/campuses")).body[0].id;
}

test.describe("LIB-01 and LIB-02 catalogue", () => {
	test("LIB-01 a new book is ACTIVE and listed; update changes it", async ({ api }) => {
		const book = await createBook(api, { isbn: "9780306406157" });
		expect(book.status).toBe("ACTIVE");
		(await api.get(`${LIBRARY}/books`)).expectStatus(200).expectJson((list) => expect(list.map((b: { id: number }) => b.id)).toContain(book.id));
		(await api.put(`${LIBRARY}/books/{id}`, { params: { id: book.id }, body: { title: `${book.title} (revised)`, author: "New Author", isbn: "9780306406157" } })).expectStatus(200).expectJson((b) => {
			expect(b).toMatchObject({ title: `${book.title} (revised)`, author: "New Author" });
		});
	});

	test("LIB-01 a withdrawn book leaves the list but stays in the export", async ({ api }) => {
		const book = await createBook(api);
		(await api.post(`${LIBRARY}/books/{id}/withdraw`, { params: { id: book.id } })).expectStatus(200).expectJson((b) => expect(b.status).toBe("WITHDRAWN"));
		(await api.get(`${LIBRARY}/books`)).expectJson((list) => expect(list.map((b: { id: number }) => b.id)).not.toContain(book.id));
		(await api.get(`${LIBRARY}/books/export`)).expectStatus(200).expectJson((rows) => expect(rows.find((b: { id: number }) => b.id === book.id)).toMatchObject({ status: "WITHDRAWN" }));
	});

	test("LIB-01 a book without a title returns 400", async ({ api }) => {
		(await api.post(`${LIBRARY}/books`, { body: { author: "Nobody" } })).expectStatus(400);
	});

	test("LIB-01 a second book with an ISBN already in the catalogue is rejected", async ({ api }) => {
		const isbn = `978${String(Date.now()).slice(-10)}`;
		await createBook(api, { isbn });
		const res = await api.post(`${LIBRARY}/books`, { body: { isbn, title: "Same ISBN" } });
		expect(res.status, "a duplicate ISBN is accepted (the CSV import treats it as a duplicate)").toBe(409);
	});

	test("LIB-01 updating an unknown book returns 404", async ({ api }) => {
		(await api.put(`${LIBRARY}/books/{id}`, { params: { id: 99999999 }, body: { title: "x" } })).expectStatus(404);
	});

	test("LIB-01 withdrawing a book with a copy on loan is rejected", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: today(), dueDate: null });
		const res = await api.post(`${LIBRARY}/books/{id}/withdraw`, { params: { id: book.id } });
		expect(res.status, "a book can be withdrawn while a copy is out").toBe(409);
	});

	test("LIB-02 copies are added AVAILABLE and listed; the shelf location can be changed", async ({ api, seed }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 2);
		(await api.get(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id } })).expectStatus(200).expectJson((list) => {
			expect(list.map((c: { id: number }) => c.id).sort()).toEqual(copies.map((c) => c.id).sort());
			for (const c of list) expect(c.status).toBe("AVAILABLE");
		});
		(await api.put(`${LIBRARY}/books/{id}/copies/{copyId}/shelf-location`, { params: { id: book.id, copyId: copies[0].id }, body: { shelfLocation: "Rack 7" } })).expectStatus(200).expectJson((c) => expect(c.shelfLocation).toBe("Rack 7"));
	});

	test("LIB-02 a duplicate accession number is rejected with 409", async ({ api, seed }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		(await api.post(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id }, body: { campusId: seed.campusId, accessionNumber: copies[0].accessionNumber } })).expectStatus(409);
	});

	for (const [title, body] of [
		["no accession number", { campusId: "CAMPUS" }],
		["no campus", { accessionNumber: "ACC" }],
	] as const) {
		test(`LIB-02 a copy with ${title} returns 400`, async ({ api, seed }) => {
			const book = await createBook(api);
			const filled = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "CAMPUS" ? seed.campusId : `${v}-${uniqueCode("x")}`]));
			(await api.post(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id }, body: filled })).expectStatus(400);
		});
	}

	test("LIB-02 a copy for an unknown book returns 404", async ({ api, seed }) => {
		(await api.post(`${LIBRARY}/books/{id}/copies`, { params: { id: 99999999 }, body: { campusId: seed.campusId, accessionNumber: uniqueCode("ACC") } })).expectStatus(404);
	});
});

test.describe("LIB-03 to LIB-06 borrowing", () => {
	test("LIB-03 issuing makes the record BORROWED and the copy BORROWED", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		const person = await personOfStudent(api, s.studentIds[0]);
		const record = await issue(api, copies[0].id, person, { borrowedDate: today(), dueDate: null });
		expect(record.status).toBe("BORROWED");
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("BORROWED");
		(await api.get(`${LIBRARY}/borrow-records`, { query: { borrowerPersonId: person } })).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).toContain(record.id));
	});

	test("LIB-03 without a due date a student gets the 14-day default period", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const settings = (await api.get(`${LIBRARY}/settings`)).body;
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: "2026-10-01", dueDate: null });
		const expected = new Date(Date.parse("2026-10-01") + settings.borrowingPeriodDaysStudent * 86400e3).toISOString().slice(0, 10);
		expect(record.dueDate).toBe(expected);
	});

	test("LIB-04 an issued copy cannot be issued again (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 2);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: today(), dueDate: null });
		(await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[0].id, borrowerPersonId: await personOfStudent(api, s.studentIds[1]), borrowedDate: today() } })).expectStatus(409);
	});

	test("LIB-04 a lost copy cannot be issued (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const person = await personOfStudent(api, s.studentIds[0]);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, person, { borrowedDate: today(), dueDate: null });
		await api.post(`${LIBRARY}/borrow-records/{id}/mark-lost`, { params: { id: record.id } });
		(await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[0].id, borrowerPersonId: person, borrowedDate: today() } })).expectStatus(409);
	});

	test("LIB-04 a copy of a withdrawn book cannot be issued", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		await api.post(`${LIBRARY}/books/{id}/withdraw`, { params: { id: book.id } });
		const res = await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[0].id, borrowerPersonId: await personOfStudent(api, s.studentIds[0]), borrowedDate: today() } });
		expect(res.status, "a withdrawn book's copy can still be issued").toBe(409);
	});

	test("LIB-04 a due date before the borrowed date returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		(await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[0].id, borrowerPersonId: await personOfStudent(api, s.studentIds[0]), borrowedDate: "2026-10-10", dueDate: "2026-10-01" } })).expectStatus(400);
	});

	test("LIB-04 an unknown copy or borrower returns 404", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		(await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: 99999999, borrowerPersonId: await personOfStudent(api, s.studentIds[0]), borrowedDate: today() } })).expectStatus(404);
		(await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[0].id, borrowerPersonId: 99999999, borrowedDate: today() } })).expectStatus(404);
	});

	test("LIB-06 returning makes the record RETURNED and the copy AVAILABLE again", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		(await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-08", damaged: false } })).expectStatus(200).expectJson((r) => {
			expect(r).toMatchObject({ status: "RETURNED", returnedDate: "2026-09-08" });
		});
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("AVAILABLE");
	});

	test("LIB-06 a copy returned damaged becomes DAMAGED", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-08", damaged: true } });
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("DAMAGED");
	});

	test("LIB-06 returning twice is rejected (409)", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-08", damaged: false } });
		(await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-09", damaged: false } })).expectStatus(409);
	});

	test("LIB-06 a return dated before the book was borrowed returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		(await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-08-01", damaged: false } })).expectStatus(400);
	});

	test("LIB-06 returning an unknown record returns 404", async ({ api }) => {
		(await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: 99999999 }, body: { returnedDate: today(), damaged: false } })).expectStatus(404);
	});
});

test.describe("LIB-05 and LIB-14 settings and limits (throwaway organisation)", () => {
	test("LIB-14 settings start at the defaults and a PUT is read back", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		(await org.client.get(`${LIBRARY}/settings`)).expectStatus(200).expectJson((s) => {
			expect(s).toEqual({ maxLoansStudent: 3, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false });
		});
		const next = { maxLoansStudent: 2, maxLoansStaff: 6, borrowingPeriodDaysStudent: 7, borrowingPeriodDaysStaff: 21, blockIssueOnOverdue: true };
		(await org.client.put(`${LIBRARY}/settings`, { body: next })).expectStatus(200);
		(await org.client.get(`${LIBRARY}/settings`)).expectJson((s) => expect(s).toEqual(next));
	});

	for (const [title, overrides] of [
		["a negative loan limit", { maxLoansStudent: -1 }],
		["a zero borrowing period", { borrowingPeriodDaysStaff: 0 }],
	] as const) {
		test(`LIB-14 ${title} returns 400`, async ({ request, calls }) => {
			const org = await createOtherOrganisation(request, calls);
			(await org.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 3, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false, ...overrides } })).expectStatus(400);
		});
	}

	test("LIB-05 the student loan limit is enforced (409 on the next issue)", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 2, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false } });
		const campusId = await campusOf(org.client);
		const { copies } = await bookWithCopies(org.client, campusId, 3);
		const person = await createPerson(org.client, "Reader");
		await issue(org.client, copies[0].id, person, { borrowedDate: today(), dueDate: null });
		await issue(org.client, copies[1].id, person, { borrowedDate: today(), dueDate: null });
		(await org.client.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[2].id, borrowerPersonId: person, borrowedDate: today() } })).expectStatus(409);
	});

	test("LIB-05 a returned book frees a place under the limit", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 1, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false } });
		const { copies } = await bookWithCopies(org.client, await campusOf(org.client), 2);
		const person = await createPerson(org.client, "Reader");
		const first = await issue(org.client, copies[0].id, person, { borrowedDate: today(), dueDate: null });
		await org.client.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: first.id }, body: { returnedDate: today(), damaged: false } });
		await issue(org.client, copies[1].id, person, { borrowedDate: today(), dueDate: null });
	});

	test("LIB-05 with blockIssueOnOverdue a borrower holding an overdue book cannot borrow another (409)", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		await org.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 5, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: true } });
		const { copies } = await bookWithCopies(org.client, await campusOf(org.client), 2);
		const person = await createPerson(org.client, "Late");
		await issue(org.client, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(5) });
		(await org.client.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copies[1].id, borrowerPersonId: person, borrowedDate: today() } })).expectStatus(409);
	});

	test("LIB-05 without blockIssueOnOverdue the same borrower may borrow", async ({ request, calls }) => {
		const org = await createOtherOrganisation(request, calls);
		const { copies } = await bookWithCopies(org.client, await campusOf(org.client), 2);
		const person = await createPerson(org.client, "Late");
		await issue(org.client, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(5) });
		await issue(org.client, copies[1].id, person, { borrowedDate: today(), dueDate: null });
	});
});

test.describe("LIB-07 to LIB-10 overdue, lost, damaged and fines", () => {
	test("LIB-07 a late return raises an overdue fine", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: "2026-09-01", dueDate: "2026-09-10" });
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-20", damaged: false } });
		(await api.get(`${LIBRARY}/fines`, { query: { borrowRecordId: record.id } })).expectStatus(200).expectJson((fines) => {
			expect(fines.filter((f: { reason: string }) => f.reason === "OVERDUE"), "returning 10 days late raises no fine; there is no fine rate setting").toHaveLength(1);
		});
	});

	test("LIB-07 the overdue list shows days overdue and a fine due", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: daysAgo(20), dueDate: daysAgo(6) });
		(await api.get(`${LIBRARY}/borrow-records/overdue`)).expectStatus(200).expectJson((list) => {
			const row = list.find((r: { id: number }) => r.id === record.id);
			expect(row.daysOverdue).toBe(6);
			expect(row.fineDue, "fineDue is always 0").toBeGreaterThan(0);
		});
	});

	test("LIB-08 marking lost makes the record and copy LOST", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: today(), dueDate: null });
		(await api.post(`${LIBRARY}/borrow-records/{id}/mark-lost`, { params: { id: record.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("LOST"));
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("LOST");
		(await api.post(`${LIBRARY}/borrow-records/{id}/mark-lost`, { params: { id: record.id } })).expectStatus(409);
	});

	test("LIB-08 marking damaged returns the record and makes the copy DAMAGED", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { book, copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]), { borrowedDate: today(), dueDate: null });
		(await api.post(`${LIBRARY}/borrow-records/{id}/mark-damaged`, { params: { id: record.id } })).expectStatus(200).expectJson((r) => expect(r.status).toBe("RETURNED"));
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("DAMAGED");
		(await api.post(`${LIBRARY}/borrow-records/{id}/mark-damaged`, { params: { id: record.id } })).expectStatus(409);
	});

	test("LIB-08 the summary counts available, issued, overdue, lost and damaged copies", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const before = (await api.get(`${LIBRARY}/summary`)).expectStatus(200).body;
		const person = await personOfStudent(api, s.studentIds[0]);
		const { copies } = await bookWithCopies(api, s.base.campusId, 4);
		await issue(api, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(2) });
		const lost = await issue(api, copies[1].id, person, { borrowedDate: today(), dueDate: null });
		await api.post(`${LIBRARY}/borrow-records/{id}/mark-lost`, { params: { id: lost.id } });
		const damaged = await issue(api, copies[2].id, person, { borrowedDate: today(), dueDate: null });
		await api.post(`${LIBRARY}/borrow-records/{id}/mark-damaged`, { params: { id: damaged.id } });
		const after = (await api.get(`${LIBRARY}/summary`)).body;
		// other specs run in parallel in the shared organisation, so each count moved by at least this much
		expect(after.lost - before.lost).toBeGreaterThanOrEqual(1);
		expect(after.damaged - before.damaged).toBeGreaterThanOrEqual(1);
		expect(after.overdue - before.overdue).toBeGreaterThanOrEqual(1);
	});

	test("LIB-09 a fine is raised PENDING, can be paid once, and a paid fine cannot be waived", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		const fine = await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, amount: 25, reason: "OVERDUE" } });
		fine.expectStatus(200).expectJson((f) => expect(f).toMatchObject({ status: "PENDING", amount: 25, reason: "OVERDUE" }));
		(await api.post(`${LIBRARY}/fines/{id}/pay`, { params: { id: fine.body.id }, body: { paidDate: today() } })).expectStatus(200).expectJson((f) => expect(f).toMatchObject({ status: "PAID", paidDate: today() }));
		(await api.post(`${LIBRARY}/fines/{id}/pay`, { params: { id: fine.body.id }, body: { paidDate: today() } })).expectStatus(409);
		(await api.post(`${LIBRARY}/fines/{id}/waive`, { params: { id: fine.body.id }, body: { waivedBy: 1, waivedReason: "x" } })).expectStatus(409);
		(await api.get(`${LIBRARY}/fines`, { query: { borrowRecordId: record.id } })).expectJson((list) => expect(list.map((f: { id: number }) => f.id)).toEqual([fine.body.id]));
	});

	test("LIB-09 a waived fine records who waived it and why", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		const fine = await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, amount: 40, reason: "DAMAGED" } });
		(await api.post(`${LIBRARY}/fines/{id}/waive`, { params: { id: fine.body.id }, body: { waivedBy: 1, waivedReason: "First offence" } })).expectStatus(200).expectJson((f) => {
			expect(f).toMatchObject({ status: "WAIVED", waivedBy: 1, waivedReason: "First offence" });
		});
		(await api.post(`${LIBRARY}/fines/{id}/pay`, { params: { id: fine.body.id }, body: { paidDate: today() } })).expectStatus(409);
	});

	for (const [title, body] of [
		["a zero amount", { amount: 0, reason: "OVERDUE" }],
		["a negative amount", { amount: -5, reason: "OVERDUE" }],
		["an unknown reason", { amount: 5, reason: "SPILLED_TEA" }],
		["no amount", { reason: "OVERDUE" }],
	] as const) {
		test(`LIB-09 a fine with ${title} returns 400`, async ({ api }) => {
			const s = await attendanceSetup(api, 1);
			const { copies } = await bookWithCopies(api, s.base.campusId, 1);
			const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
			(await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, ...body } })).expectStatus(400);
		});
	}

	test("LIB-09 waiving without a reason or with an unknown waiver returns 400", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const { copies } = await bookWithCopies(api, s.base.campusId, 1);
		const record = await issue(api, copies[0].id, await personOfStudent(api, s.studentIds[0]));
		const a = await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, amount: 5, reason: "OVERDUE" } });
		const b = await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, amount: 5, reason: "OVERDUE" } });
		(await api.post(`${LIBRARY}/fines/{id}/waive`, { params: { id: a.body.id }, body: { waivedBy: 1 } })).expectStatus(400);
		(await api.post(`${LIBRARY}/fines/{id}/waive`, { params: { id: b.body.id }, body: { waivedBy: 99999999, waivedReason: "x" } })).expectStatus(400);
	});

	test("LIB-09 a fine for an unknown record returns 404; paying an unknown fine returns 404", async ({ api }) => {
		(await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: 99999999, amount: 5, reason: "OVERDUE" } })).expectStatus(404);
		(await api.post(`${LIBRARY}/fines/{id}/pay`, { params: { id: 99999999 }, body: { paidDate: today() } })).expectStatus(404);
	});

	test("LIB-10 the fines list needs borrowRecordId (400)", async ({ api }) => {
		(await api.get(`${LIBRARY}/fines`)).expectStatus(400);
	});
});

test.describe("LIB-11 and LIB-12 lists and reminders", () => {
	test("LIB-11 the overdue list holds only borrowed books past their due date", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const person = await personOfStudent(api, s.studentIds[0]);
		const { copies } = await bookWithCopies(api, s.base.campusId, 3);
		const late = await issue(api, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(1) });
		const onTime = await issue(api, copies[1].id, person, { borrowedDate: today(), dueDate: null });
		const returned = await issue(api, copies[2].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(1) });
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: returned.id }, body: { returnedDate: today(), damaged: false } });
		(await api.get(`${LIBRARY}/borrow-records/overdue`)).expectJson((list) => {
			const ids = list.map((r: { id: number }) => r.id);
			expect(ids).toContain(late.id);
			expect(ids).not.toContain(onTime.id);
			expect(ids).not.toContain(returned.id);
		});
	});

	test("LIB-11 borrower history includes returned and lost records", async ({ api }) => {
		const s = await attendanceSetup(api, 1);
		const person = await personOfStudent(api, s.studentIds[0]);
		const { copies } = await bookWithCopies(api, s.base.campusId, 2);
		const a = await issue(api, copies[0].id, person);
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: a.id }, body: { returnedDate: "2026-09-05", damaged: false } });
		const b = await issue(api, copies[1].id, person, { borrowedDate: today(), dueDate: null });
		await api.post(`${LIBRARY}/borrow-records/{id}/mark-lost`, { params: { id: b.id } });
		(await api.get(`${LIBRARY}/borrow-records/by-borrower/{personId}`, { params: { personId: person } })).expectStatus(200).expectJson((list) => {
			expect(Object.fromEntries(list.map((r: { id: number; status: string }) => [r.id, r.status]))).toEqual({ [a.id]: "RETURNED", [b.id]: "LOST" });
		});
	});

	test("LIB-12 a reminder to a borrower with an email reports one notification", async ({ api }) => {
		const { copies } = await bookWithCopies(api, (await api.get("/api/v1/campuses")).body[0].id, 1);
		const person = await createPerson(api, "Borrower", { email: `reader-${uniqueCode("r").toLowerCase()}@example.test` });
		const record = await issue(api, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(3) });
		(await api.post(`${LIBRARY}/borrow-records/{id}/send-reminder`, { params: { id: record.id } })).expectStatus(200).expectJson((n) => expect(n).toBe(1));
	});

	test("LIB-12 a borrower without contact details is notified of nothing (0)", async ({ api }) => {
		const { copies } = await bookWithCopies(api, (await api.get("/api/v1/campuses")).body[0].id, 1);
		const person = await createPerson(api, "Silent");
		const record = await issue(api, copies[0].id, person, { borrowedDate: daysAgo(20), dueDate: daysAgo(3) });
		(await api.post(`${LIBRARY}/borrow-records/{id}/send-reminder`, { params: { id: record.id } })).expectStatus(200).expectJson((n) => expect(n).toBe(0));
	});

	test("LIB-12 no reminder is sent for a book already returned", async ({ api }) => {
		const { copies } = await bookWithCopies(api, (await api.get("/api/v1/campuses")).body[0].id, 1);
		const person = await createPerson(api, "Done", { email: `done-${uniqueCode("r").toLowerCase()}@example.test` });
		const record = await issue(api, copies[0].id, person);
		await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: "2026-09-05", damaged: false } });
		const res = await api.post(`${LIBRARY}/borrow-records/{id}/send-reminder`, { params: { id: record.id } });
		expect(res.status === 409 || res.body === 0, `a reminder was sent for a returned book (status ${res.status}, body ${JSON.stringify(res.body)})`).toBe(true);
	});
});

test.describe("LIB-13 import and export", () => {
	const csv = (rows: string[]) => ({ name: "books.csv", mimeType: "text/csv", buffer: Buffer.from(["title,isbn,author,publisher,category,edition", ...rows].join("\n")) });

	test("LIB-13 validateOnly reports rows without saving; a real import saves them", async ({ api }) => {
		const title = `Imported ${uniqueCode("b")}`;
		const file = csv([`${title},,Import Author,,Science,`]);
		(await api.post(`${LIBRARY}/books/import`, { query: { validateOnly: true }, multipart: { file } })).expectStatus(200).expectJson((report) => expect(JSON.stringify(report)).toContain("VALID"));
		(await api.get(`${LIBRARY}/books`)).expectJson((list) => expect(list.map((b: { title: string }) => b.title)).not.toContain(title));
		(await api.post(`${LIBRARY}/books/import`, { query: { validateOnly: false }, multipart: { file } })).expectStatus(200);
		(await api.get(`${LIBRARY}/books`)).expectJson((list) => expect(list.map((b: { title: string }) => b.title)).toContain(title));
	});

	test("LIB-13 a row whose ISBN is already in the catalogue is reported DUPLICATE", async ({ api }) => {
		const isbn = `979${String(Date.now()).slice(-10)}`;
		await createBook(api, { isbn });
		(await api.post(`${LIBRARY}/books/import`, { query: { validateOnly: true }, multipart: { file: csv([`Again,${isbn},,,,`]) } })).expectStatus(200).expectJson((report) => expect(JSON.stringify(report)).toContain("DUPLICATE"));
	});

	test("LIB-13 a row without a title is reported invalid, not saved", async ({ api }) => {
		(await api.post(`${LIBRARY}/books/import`, { query: { validateOnly: true }, multipart: { file: csv([`,123,Someone,,,`]) } })).expectStatus(200).expectJson((report) => expect(JSON.stringify(report)).toMatch(/INVALID|ERROR/));
	});

	test("LIB-13 an import without a file returns 400", async ({ api }) => {
		(await api.post(`${LIBRARY}/books/import`, { query: { validateOnly: true } })).expectStatus(400);
	});

	test("LIB-13 the export has the documented columns", async ({ api }) => {
		const book = await createBook(api);
		(await api.get(`${LIBRARY}/books/export`)).expectStatus(200).expectJson((rows) => {
			expect(Object.keys(rows.find((b: { id: number }) => b.id === book.id)).sort()).toEqual(["author", "category", "edition", "id", "isbn", "publisher", "status", "title"]);
		});
	});
});

test.describe("permissions and tenancy", () => {
	test("LIB-01 reads need LIBRARY_VIEW and writes need the matching manage permission", async ({ api, anon, seed }) => {
		const viewer = await createDisposableUser(api, anon, seed, ["LIBRARY_VIEW"]);
		const nobody = await createDisposableUser(api, anon, seed, []);
		(await viewer.client.get(`${LIBRARY}/books`)).expectStatus(200);
		(await nobody.client.get(`${LIBRARY}/books`)).expectStatus(403);
		(await nobody.client.get(`${LIBRARY}/summary`)).expectStatus(403);
		(await viewer.client.post(`${LIBRARY}/books`, { body: { title: "x" } })).expectStatus(403);
		(await viewer.client.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: 1, borrowerPersonId: 1, borrowedDate: today() } })).expectStatus(403);
		(await viewer.client.post(`${LIBRARY}/fines`, { body: { borrowRecordId: 1, amount: 1, reason: "OVERDUE" } })).expectStatus(403);
		(await viewer.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 3, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false } })).expectStatus(403);
	});

	test("LIB-14 any member can read the borrowing rules but not change them", async ({ api, anon, seed }) => {
		const nobody = await createDisposableUser(api, anon, seed, []);
		(await nobody.client.get(`${LIBRARY}/settings`)).expectStatus(200).expectJson((s) => expect(s).toHaveProperty("maxLoansStudent"));
		(await nobody.client.put(`${LIBRARY}/settings`, { body: { maxLoansStudent: 3, maxLoansStaff: 5, borrowingPeriodDaysStudent: 14, borrowingPeriodDaysStaff: 30, blockIssueOnOverdue: false } })).expectStatus(403);
	});

	test("LIB-01 a borrow manager cannot edit the catalogue, a cataloguer cannot issue", async ({ api, anon, seed }) => {
		const desk = await createDisposableUser(api, anon, seed, ["LIBRARY_VIEW", "LIBRARY_BORROW_MANAGE"]);
		const cataloguer = await createDisposableUser(api, anon, seed, ["LIBRARY_VIEW", "LIBRARY_CATALOG_MANAGE"]);
		(await desk.client.post(`${LIBRARY}/books`, { body: { title: "x" } })).expectStatus(403);
		(await cataloguer.client.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: 1, borrowerPersonId: 1, borrowedDate: today() } })).expectStatus(403);
	});

	for (const path of ["/books", "/summary", "/borrow-records/overdue", "/settings"]) {
		test(`LIB-01 GET ${path} without a token returns 401`, async ({ anon }) => {
			(await anon.get(`${LIBRARY}${path}`)).expectStatus(401);
		});
	}

	test("LIB-15 another organisation's books, copies and borrow records are invisible and untouchable", async ({ api, request, calls, seed }) => {
		const org = await createOtherOrganisation(request, calls);
		const { book, copies } = await bookWithCopies(org.client, await campusOf(org.client), 1);
		const person = await createPerson(org.client, "Foreign");
		const record = await issue(org.client, copies[0].id, person, { borrowedDate: daysAgo(10), dueDate: daysAgo(2) });
		(await api.get(`${LIBRARY}/books`)).expectJson((list) => expect(list.map((b: { id: number }) => b.id)).not.toContain(book.id));
		(await api.get(`${LIBRARY}/borrow-records/overdue`)).expectJson((list) => expect(list.map((r: { id: number }) => r.id)).not.toContain(record.id));
		const history = await api.get(`${LIBRARY}/borrow-records/by-borrower/{personId}`, { params: { personId: person } });
		if (history.status === 200) expect(history.body).toEqual([]);
		else expect(history.status).toBe(404);
		const foreignCopies = await api.get(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id } });
		if (foreignCopies.status === 200) expect(foreignCopies.body).toEqual([]);
		else expect([403, 404]).toContain(foreignCopies.status);
		expect((await api.put(`${LIBRARY}/books/{id}`, { params: { id: book.id }, body: { title: "hijack" } })).status).toBe(404);
		expect((await api.post(`${LIBRARY}/borrow-records/{id}/return`, { params: { id: record.id }, body: { returnedDate: today(), damaged: false } })).status).toBe(404);
		expect((await api.post(`${LIBRARY}/borrow-records/{id}/send-reminder`, { params: { id: record.id } })).status).toBe(404);
		expect((await api.post(`${LIBRARY}/fines`, { body: { borrowRecordId: record.id, amount: 5, reason: "OVERDUE" } })).status).toBe(404);
		const mine = await addCopy(api, (await createBook(api)).id, seed.campusId);
		expect((await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: mine.id, borrowerPersonId: person, borrowedDate: today() } })).status, "a borrower from another organisation").toBe(404);
	});
});
