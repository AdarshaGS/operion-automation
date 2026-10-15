import type { Locator, Page } from "@playwright/test";

/** /library (tabs: Books, Borrow / return, Overdue, Settings) and /library/books/{id}. */
export class LibraryPage {
	constructor(private readonly page: Page) {}

	async open() {
		await this.page.goto("/library");
		await this.page.getByRole("tab", { name: "Books" }).waitFor();
	}

	async openBook(bookId: number) {
		await this.page.goto(`/library/books/${bookId}`);
		await this.page.getByRole("heading", { name: "Copies" }).waitFor();
	}

	async tab(name: "Books" | "Borrow / return" | "Overdue" | "Settings") {
		await this.page.getByRole("tab", { name }).click();
	}

	/** Summary chip text, for example "Issued: 4". */
	chip(label: "Available" | "Issued" | "Overdue" | "Lost" | "Damaged") {
		return this.page.locator(".MuiChip-root").filter({ hasText: new RegExp(`^${label}: \\d+$`) });
	}

	dialog(title: string | RegExp) {
		return this.page.getByRole("dialog").filter({ has: this.page.getByRole("heading", { name: title }) });
	}

	/** MUI select (TextField select) inside `scope`. */
	async choose(scope: Locator | Page, label: string | RegExp, option: string) {
		await scope.getByRole("combobox", { name: label }).click();
		await this.page.getByRole("option", { name: option, exact: true }).click();
	}

	row(text: string) {
		return this.page.getByRole("row").filter({ hasText: text });
	}

	button(name: string) {
		return this.page.getByRole("button", { name, exact: true });
	}

	// books

	async addBook(input: { title: string; author?: string; isbn?: string }) {
		await this.button("Add book").click();
		const dialog = this.dialog("Add book");
		await dialog.getByLabel("Title").fill(input.title);
		if (input.author) await dialog.getByLabel("Author").fill(input.author);
		if (input.isbn) await dialog.getByLabel("ISBN").fill(input.isbn);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	async search(text: string) {
		await this.page.getByLabel("Search title, author, or category").fill(text);
	}

	async addCopy(input: { campus: string; accessionNumber: string; shelfLocation?: string }) {
		await this.button("Add copy").click();
		const dialog = this.dialog("Add copy");
		await this.choose(dialog, "Campus", input.campus);
		await dialog.getByLabel("Accession number").fill(input.accessionNumber);
		if (input.shelfLocation) await dialog.getByLabel("Shelf location").fill(input.shelfLocation);
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
	}

	async setShelf(accessionNumber: string, shelfLocation: string) {
		await this.row(accessionNumber).getByRole("button", { name: "Edit shelf location" }).click();
		const dialog = this.dialog(`Shelf location — ${accessionNumber}`);
		await dialog.getByLabel("Shelf location").fill(shelfLocation);
		await dialog.getByRole("button", { name: "Save" }).click();
	}

	// borrowing

	async issueBook(input: { borrower: string; book: string; copy: string; dueDate?: string }) {
		await this.button("Issue book").click();
		const dialog = this.dialog("Issue book");
		await this.choose(dialog, "Borrower", input.borrower);
		await this.choose(dialog, "Book", input.book);
		await this.choose(dialog, "Available copy", input.copy);
		if (input.dueDate) await dialog.getByLabel(/^Due date/).fill(input.dueDate);
		await dialog.getByRole("button", { name: "Issue" }).click();
	}

	async returnBook(accessionNumber: string, damage?: { fine?: number }) {
		await this.row(accessionNumber).getByRole("button", { name: "Return" }).click();
		const dialog = this.dialog("Return book");
		if (damage) {
			await dialog.getByLabel("Copy came back damaged").check();
			if (damage.fine != null) await dialog.getByLabel("Damage fine amount (optional)").fill(String(damage.fine));
		}
		await dialog.getByRole("button", { name: "Return" }).click();
	}

	async raiseFine(amount: number, reason: "OVERDUE" | "LOST" | "DAMAGED") {
		await this.page.getByLabel("Fine amount").fill(String(amount));
		await this.choose(this.page, "Reason", reason);
		await this.button("Raise fine").click();
	}

	/** Fine rows under the last returned / lost record. */
	fineRows() {
		return this.page.getByRole("row").filter({ has: this.page.locator(".MuiChip-root").filter({ hasText: /^(PENDING|PAID|WAIVED)$/ }) });
	}

	// settings

	async saveSettings(values: Partial<Record<"Max books - student" | "Max books - staff" | "Borrowing period (days) - student" | "Borrowing period (days) - staff", number>>) {
		for (const [label, value] of Object.entries(values)) await this.page.getByLabel(label, { exact: true }).fill(String(value));
		await this.button("Save").click();
	}
}
