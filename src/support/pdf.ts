// Reads what a downloaded PDF actually says, so receipt tests assert on the printed text rather than
// just "a file arrived". pdfjs-dist's legacy build runs in plain Node with no canvas.

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Download } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfInfo {
	fileName: string;
	pages: number;
	/** Width and height of page 1 in millimetres. */
	pageSizeMm: { width: number; height: number };
	/** All text of all pages, whitespace collapsed to single spaces. */
	text: string;
}

const POINTS_PER_MM = 72 / 25.4;

export async function readPdf(bytes: Uint8Array, fileName = ""): Promise<PdfInfo> {
	const header = Buffer.from(bytes.slice(0, 4)).toString("latin1");
	if (header !== "%PDF") throw new Error(`${fileName || "download"} is not a PDF (starts with ${JSON.stringify(header)})`);
	const doc = await getDocument({ data: bytes, useSystemFonts: false }).promise;
	const parts: string[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const content = await (await doc.getPage(n)).getTextContent();
		parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
	}
	const [x0, y0, x1, y1] = (await doc.getPage(1)).view;
	const info = {
		fileName,
		pages: doc.numPages,
		pageSizeMm: { width: Math.round((x1 - x0) / POINTS_PER_MM), height: Math.round((y1 - y0) / POINTS_PER_MM) },
		text: parts.join(" ").replace(/\s+/g, " ").trim(),
	};
	await doc.cleanup();
	return info;
}

/** Waits for `trigger` to start a browser download and returns the parsed PDF. */
export async function downloadedPdf(download: Promise<Download>): Promise<PdfInfo> {
	const file = await download;
	const path = await file.path();
	// SAVE_PDFS=<dir> keeps every downloaded PDF (numbered in download order) so a person can open them after a run.
	const keepDir = process.env.SAVE_PDFS;
	if (keepDir) {
		await mkdir(keepDir, { recursive: true });
		await copyFile(path, join(keepDir, `${Date.now()}-${file.suggestedFilename()}`));
	}
	return readPdf(new Uint8Array(await readFile(path)), file.suggestedFilename());
}
