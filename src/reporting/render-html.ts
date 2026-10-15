// Inlines the report data, stylesheet and client script into one self-contained HTML file
// (no network, no build step) so it can be opened from disk, attached to a ticket, or served.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Report } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));

export function renderHtml(report: Report): string {
	const css = readFileSync(join(HERE, "report.css"), "utf-8");
	const js = readFileSync(join(HERE, "report.client.js"), "utf-8");
	// "</" inside JSON would end the script element early.
	const data = JSON.stringify(report).replaceAll("</", "<\\/").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operion Automation Report</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script id="report-data" type="application/json">${data}</script>
<script>${js}</script>
</body>
</html>
`;
}
