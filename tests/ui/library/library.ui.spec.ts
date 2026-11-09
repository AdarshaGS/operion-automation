// Library screens (/library, /library/books/{id}). IDs refer to docs/SCENARIOS.md section 11 (LIB-U*).
// Books, copies and borrowers are created with unique names, so rows are found in long shared lists.

import { test, expect } from "../../../src/sanity/fixtures";
import { createPerson } from "../../../src/api/academics";
import { LIBRARY, addCopy, bookWithCopies, copyStatus, createBook, issue } from "../../../src/api/library";
import { uniqueCode, uniqueSuffix } from "../../../src/api/data";
import { storageStateFor } from "../../../src/ui/session";
import { createDisposableUser, type OrgContext } from "../../../src/api/users";
import { FIXED_PASSWORD } from "../../../src/setup/roles";
import { UI_BASE_URL } from "../../../src/config/env";
import { LibraryPage } from "../../../src/pages/library/LibraryPage";
import { AppLayoutPage } from "../../../src/pages/AppLayoutPage";
import type { ApiClient } from "../../../src/api/apiClient";
import type { Browser } from "@playwright/test";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

/** A person with a unique name, returned with the name the Borrower select shows. */
async function borrower(api: ApiClient, extra: Record<string, unknown> = {}) {
	const id = await createPerson(api, `Reader${uniqueSuffix()}`, extra);
	const p = (await api.get("/api/v1/persons/{id}", { params: { id } })).expectStatus(200).body;
	return { id, name: `${p.firstName} ${p.lastName}` };
}

async function signedInAs(api: ApiClient, anon: ApiClient, seed: OrgContext, browser: Browser, permissions: string[]) {
	const user = await createDisposableUser(api, anon, seed, permissions);
	const login = (await anon.post("/api/v1/auth/login", { body: { organisationSlug: seed.organisationSlug, email: user.email, password: FIXED_PASSWORD } })).expectStatus(200);
	const context = await browser.newContext({ baseURL: UI_BASE_URL, storageState: storageStateFor(login.body, UI_BASE_URL) });
	const page = await context.newPage();
	return { page, context, library: new LibraryPage(page) };
}

test.describe("LIB-U01 catalogue", () => {
	test("LIB-U01 a book added from the dialog is listed and searchable", async ({ api, library }) => {
		const title = `UI Book ${uniqueSuffix()}`;
		await library.open();
		await library.addBook({ title, author: "Ui Author" });
		await expect(library.dialog("Add book")).toHaveCount(0);
		await library.search(title);
		await expect(library.row(title)).toContainText("Ui Author");
		await expect(library.row(title)).toContainText("ACTIVE");
		(await api.get(`${LIBRARY}/books`)).expectJson((list) => expect(list.map((b: { title: string }) => b.title)).toContain(title));
	});

	test("LIB-U01 clicking a book opens its page; a copy added there shows campus, shelf and AVAILABLE", async ({ api, seed, library, page }) => {
		const book = await createBook(api);
		const campus = (await api.get("/api/v1/campuses")).expectStatus(200).body.find((c: { id: number }) => c.id === seed.campusId).name;
		const accession = uniqueCode("ACC");
		await library.open();
		await library.search(book.title);
		await library.row(book.title).click();
		await expect(page).toHaveURL(new RegExp(`/library/books/${book.id}$`));
		await expect(page.getByRole("heading", { name: book.title })).toBeVisible();
		await library.addCopy({ campus, accessionNumber: accession, shelfLocation: "R2-S3" });
		const row = library.row(accession);
		await expect(row).toContainText(campus);
		await expect(row).toContainText("R2-S3");
		await expect(row).toContainText("AVAILABLE");
		(await api.get(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id } })).expectJson((copies) => expect(copies.map((c: { accessionNumber: string }) => c.accessionNumber)).toEqual([accession]));
	});

	test("LIB-U01 the shelf location of a copy can be changed", async ({ api, seed, library }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		await library.openBook(book.id);
		await library.setShelf(copies[0].accessionNumber, "Z9");
		await expect(library.row(copies[0].accessionNumber)).toContainText("Z9");
		(await api.get(`${LIBRARY}/books/{id}/copies`, { params: { id: book.id } })).expectJson((list) => expect(list[0].shelfLocation).toBe("Z9"));
	});

	test("LIB-U01 editing a book from its page renames it", async ({ api, library, page }) => {
		const book = await createBook(api);
		await library.openBook(book.id);
		await library.button("Edit").click();
		const dialog = library.dialog("Edit book");
		await dialog.getByLabel("Title").fill(`${book.title} v2`);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(page.getByRole("heading", { name: `${book.title} v2` })).toBeVisible();
	});
});

test.describe("LIB-U02 issue and return", () => {
	test("LIB-U02 issuing from the dialog adds an active borrow and takes the copy off the shelf", async ({ api, seed, library }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		const reader = await borrower(api);
		await library.open();
		await library.tab("Borrow / return");
		await library.issueBook({ borrower: reader.name, book: book.title, copy: `${copies[0].accessionNumber} — A1`, dueDate: daysAgo(-7) });
		await expect(library.dialog("Issue book")).toHaveCount(0);
		const row = library.row(copies[0].accessionNumber);
		await expect(row).toContainText(reader.name);
		await expect(row).toContainText(book.title);
		await expect(row).toContainText(today());
		await expect(row).toContainText(daysAgo(-7));
		expect(await copyStatus(api, book.id, copies[0].id)).not.toBe("AVAILABLE");
	});

	test("LIB-U02 the Issue button stays disabled until a borrower, book and copy are chosen; a book with no free copy warns", async ({ api, seed, library }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		await issue(api, copies[0].id, (await borrower(api)).id);
		await library.open();
		await library.tab("Borrow / return");
		await library.button("Issue book").click();
		const dialog = library.dialog("Issue book");
		await expect(dialog.getByRole("button", { name: "Issue" })).toBeDisabled();
		await library.choose(dialog, "Book", book.title);
		await expect(dialog.getByText("No available copies for this book.")).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Issue" })).toBeDisabled();
	});

	test("LIB-U02 returning a book removes the active borrow and shows the record as RETURNED", async ({ api, seed, library, page }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		const record = await issue(api, copies[0].id, (await borrower(api)).id, { borrowedDate: today(), dueDate: daysAgo(-7) });
		await library.open();
		await library.tab("Borrow / return");
		await library.returnBook(copies[0].accessionNumber);
		await expect(library.row(copies[0].accessionNumber)).toHaveCount(0);
		await expect(page.getByText(`Borrow record #${record.id}`)).toBeVisible();
		await expect(page.locator(".MuiChip-root").filter({ hasText: /^RETURNED$/ })).toBeVisible();
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("AVAILABLE");
	});

	test("LIB-U02 a damaged return with a fine marks the copy DAMAGED and lists a pending DAMAGED fine", async ({ api, seed, library }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		await issue(api, copies[0].id, (await borrower(api)).id, { borrowedDate: today(), dueDate: daysAgo(-7) });
		await library.open();
		await library.tab("Borrow / return");
		await library.returnBook(copies[0].accessionNumber, { fine: 25 });
		await expect(library.fineRows()).toHaveCount(1);
		await expect(library.fineRows()).toContainText("25");
		await expect(library.fineRows()).toContainText("DAMAGED");
		await expect(library.fineRows()).toContainText("PENDING");
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("DAMAGED");
	});

	test("LIB-U02 mark lost shows LOST; a LOST fine raised there can be paid", async ({ api, seed, library, page }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		await issue(api, copies[0].id, (await borrower(api)).id, { borrowedDate: today(), dueDate: daysAgo(-7) });
		await library.open();
		await library.tab("Borrow / return");
		await library.row(copies[0].accessionNumber).getByRole("button", { name: "Mark lost" }).click();
		await expect(page.locator(".MuiChip-root").filter({ hasText: /^LOST$/ })).toBeVisible();
		expect(await copyStatus(api, book.id, copies[0].id)).toBe("LOST");
		await library.raiseFine(300, "LOST");
		await expect(library.fineRows()).toContainText("PENDING");
		await library.fineRows().getByRole("button", { name: "Pay" }).click();
		await expect(library.fineRows()).toContainText("PAID");
		await expect(library.fineRows().getByRole("button", { name: "Pay" })).toHaveCount(0);
	});
});

test.describe("LIB-U03 overdue and fines", () => {
	test("LIB-U03 the Overdue tab lists a late book with its days overdue and contact", async ({ api, seed, library }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		const reader = await borrower(api, { email: `reader.${uniqueSuffix()}@example.test` });
		await issue(api, copies[0].id, reader.id, { borrowedDate: daysAgo(12), dueDate: daysAgo(5) });
		await library.open();
		await library.tab("Overdue");
		const row = library.row(reader.name);
		await expect(row).toContainText(book.title);
		await expect(row).toContainText(daysAgo(5));
		await expect(row.locator(".MuiChip-root")).toHaveText("5");
	});

	test("LIB-U03 Send reminder reports 'No contact on file' for a borrower without email or phone", async ({ api, seed, library }) => {
		const { copies } = await bookWithCopies(api, seed.campusId, 1);
		const reader = await borrower(api);
		await issue(api, copies[0].id, reader.id, { borrowedDate: daysAgo(12), dueDate: daysAgo(5) });
		await library.open();
		await library.tab("Overdue");
		await library.row(reader.name).getByRole("button", { name: "Send reminder" }).click();
		await expect(library.row(reader.name)).toContainText("No contact on file");
	});

	test("LIB-U03 the Overdue tab shows the fine due on a late book", async ({ api, seed, library }) => {
		const rules = (await api.get("/api/v1/library/settings")).expectStatus(200).body;
		(await api.put("/api/v1/library/settings", { body: { ...rules, fineRatePerDay: 2 } })).expectStatus(200);
		const { copies } = await bookWithCopies(api, seed.campusId, 1);
		const reader = await borrower(api);
		await issue(api, copies[0].id, reader.id, { borrowedDate: daysAgo(30), dueDate: daysAgo(20) });
		await library.open();
		await library.tab("Overdue");
		// The Fine due column is the sixth cell; "—" means no fine is due.
		await expect(library.row(reader.name).getByRole("cell").nth(5), "a book 20 days late shows no fine due").not.toHaveText("—");
	});

	test("LIB-U03 a pending fine can be waived from the record panel", async ({ api, seed, library }) => {
		const { copies } = await bookWithCopies(api, seed.campusId, 1);
		// Not yet due, so returning it raises no automatic fine and the one raised below is the only row.
		await issue(api, copies[0].id, (await borrower(api)).id, { borrowedDate: daysAgo(12), dueDate: daysAgo(-5) });
		await library.open();
		await library.tab("Borrow / return");
		await library.returnBook(copies[0].accessionNumber);
		await library.raiseFine(40, "OVERDUE");
		await expect(library.fineRows()).toContainText("OVERDUE");
		await library.fineRows().getByRole("button", { name: "Waive" }).click();
		await expect(library.fineRows()).toContainText("WAIVED");
	});
});

test.describe("LIB-U settings and access", () => {
	test("LIB-14 borrowing rules saved from the Settings tab are stored", async ({ api, library, page }) => {
		const before = (await api.get(`${LIBRARY}/settings`)).expectStatus(200).body;
		try {
			await library.open();
			await library.tab("Settings");
			await expect(page.getByRole("heading", { name: "Borrowing rules" })).toBeVisible();
			await library.saveSettings({ "Max books - staff": before.maxLoansStaff + 1 });
			await expect(page.getByText("Saved.")).toBeVisible();
			(await api.get(`${LIBRARY}/settings`)).expectJson((s) => expect(s.maxLoansStaff).toBe(before.maxLoansStaff + 1));
		} finally {
			(await api.put(`${LIBRARY}/settings`, { body: before })).expectStatus(200);
		}
	});

	test("LIB-U01 a library viewer is offered no catalogue, issue or fine actions", async ({ api, anon, seed, browser }) => {
		const { book, copies } = await bookWithCopies(api, seed.campusId, 1);
		await issue(api, copies[0].id, (await borrower(api)).id, { borrowedDate: today(), dueDate: daysAgo(-7) });
		const { library, context, page } = await signedInAs(api, anon, seed, browser, ["LIBRARY_VIEW"]);
		try {
			await library.open();
			await library.search(book.title);
			await expect(library.row(book.title)).toBeVisible();
			const offered: string[] = [];
			if (await library.button("Add book").isVisible()) offered.push("Add book");
			await library.tab("Borrow / return");
			await expect(library.row(copies[0].accessionNumber)).toBeVisible();
			for (const name of ["Issue book", "Return", "Mark lost"]) if ((await library.button(name).count()) > 0) offered.push(name);
			await library.tab("Settings");
			await expect(page.getByRole("heading", { name: "Borrowing rules" })).toBeVisible();
			if (await library.button("Save").isVisible()) offered.push("Save settings");
			expect(offered, "buttons the viewer cannot use (the API answers 403)").toEqual([]);
		} finally {
			await context.close();
		}
	});

	test("LIB-U01 a member without library access does not see the Library menu item", async ({ api, anon, seed, browser }) => {
		const { page, context } = await signedInAs(api, anon, seed, browser, []);
		try {
			const layout = new AppLayoutPage(page);
			await layout.open();
			// Items a member has no permission for are left out of the menu rather than greyed out.
			await expect(layout.navItem("Library")).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
