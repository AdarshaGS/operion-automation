import type { Page } from "@playwright/test";

/** /examinations/report-cards/:id/print: the laid-out report card. */
export class ReportCardPrintPage {
	constructor(private readonly page: Page) {}

	async open(reportCardId: number) {
		await this.page.goto(`/examinations/report-cards/${reportCardId}/print`);
	}

	subjectRow(subjectName: string) {
		return this.page.getByRole("row").filter({ hasText: subjectName });
	}

	text(text: string | RegExp) {
		return this.page.getByText(text);
	}

	printButton() {
		return this.page.getByRole("button", { name: "Print" });
	}

	downloadPdfButton() {
		return this.page.getByRole("button", { name: "Download PDF" });
	}

	staleWarning() {
		return this.page.getByRole("alert").filter({ hasText: /stale/i });
	}

	error() {
		return this.page.getByRole("alert");
	}
}
