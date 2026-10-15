import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { REPORT_DIR } from "../config/env";

const file = join(REPORT_DIR, "unified", "index.html");
if (!existsSync(file)) {
	console.error(`No report yet at ${file} - run the tests first.`);
	process.exit(1);
}
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
spawn(opener, [file], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
console.log(file);
