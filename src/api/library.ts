// Library fixtures: a book with copies, and a borrower. Student borrowers exist only in the shared
// organisation (Operion #354); staff borrowers are plain persons.

import type { ApiClient } from "./apiClient";
import { uniqueCode, uniqueSuffix } from "./data";

export const LIBRARY = "/api/v1/library";

export async function createBook(api: ApiClient, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LIBRARY}/books`, { body: { isbn: null, title: `Book ${uniqueSuffix()}`, author: "Automation Author", publisher: "Test Press", category: "Fiction", edition: "1st", ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; title: string; status: string; isbn: string | null };
}

export async function addCopy(api: ApiClient, bookId: number, campusId: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LIBRARY}/books/{id}/copies`, { params: { id: bookId }, body: { campusId, accessionNumber: uniqueCode("ACC"), acquiredDate: "2026-01-01", shelfLocation: "A1", ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; accessionNumber: string; status: string; shelfLocation: string | null };
}

/** A book with `copies` available copies. */
export async function bookWithCopies(api: ApiClient, campusId: number, copies = 1) {
	const book = await createBook(api);
	const list = [];
	for (let i = 0; i < copies; i++) list.push(await addCopy(api, book.id, campusId));
	return { book, copies: list };
}

export async function issue(api: ApiClient, copyId: number, personId: number, overrides: Record<string, unknown> = {}) {
	const res = await api.post(`${LIBRARY}/borrow-records`, { body: { bookCopyId: copyId, borrowerPersonId: personId, borrowedDate: "2026-09-01", dueDate: "2026-09-10", ...overrides } });
	res.expectStatus(200);
	return res.body as { id: number; status: string; dueDate: string; borrowedDate: string };
}

export async function copyStatus(api: ApiClient, bookId: number, copyId: number): Promise<string> {
	const copies = (await api.get(`${LIBRARY}/books/{id}/copies`, { params: { id: bookId } })).expectStatus(200).body;
	return copies.find((c: { id: number }) => c.id === copyId).status;
}

export async function personOfStudent(api: ApiClient, studentId: number): Promise<number> {
	return (await api.get("/api/v1/students/{id}", { params: { id: studentId } })).expectStatus(200).body.personId;
}
