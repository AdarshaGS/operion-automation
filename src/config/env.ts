// Single place the suite learns where Operion lives. Defaults match the disposable stack that
// scripts/stack-up.sh starts (backend :8091, frontend :5184). Never point this at a real
// database: every run provisions a fresh organisation through the public signup endpoint.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Optional local overrides (see .env.example); real environment variables still win.
if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

export const API_BASE_URL = process.env.OPERION_API_URL ?? "http://localhost:8091";
export const UI_BASE_URL = process.env.OPERION_UI_URL ?? "http://localhost:5184";

export const AUTH_DIR = join(ROOT, ".auth");
export const REPORT_DIR = join(ROOT, "reports");
export const SESSION_STORAGE_KEY = "operion.session";

// The platform operator that Operion's migrations seed on every fresh database (dev-only
// bootstrap account, see Operion V25__billing_schema.sql). Sanity phase 01 signs in as it to
// provision the business through the platform console.
export const PLATFORM_ADMIN_EMAIL = process.env.OPERION_PLATFORM_EMAIL ?? "admin@operion.platform";
export const PLATFORM_ADMIN_PASSWORD = process.env.OPERION_PLATFORM_PASSWORD ?? "ChangeMe123!";
