// Asks the running backend for its full endpoint list (springdoc's OpenAPI document), so the
// report can show which endpoints the suite never touched. Nothing is read from Operion's
// source tree: the suite stays decoupled from the codebase it tests.

export interface Operation {
	method: string;
	path: string;
	module: string;
	operationId?: string;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

/** `{studentId}` and `{id}` must compare equal across the spec's and the test's spelling. */
export function endpointKey(method: string, path: string): string {
	return `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}").replace(/\/+$/, "")}`;
}

/** /api/v1/fees/invoices/{id} -> "fees". Falls back to the first path segment. */
export function moduleOf(path: string): string {
	const segments = path.replace(/^\/api\/v\d+\//, "").split("/").filter((s) => s && !s.startsWith("{"));
	return segments[0] ?? "root";
}

export async function fetchInventory(apiBaseUrl: string): Promise<{ operations: Operation[] } | { error: string }> {
	try {
		const response = await fetch(`${apiBaseUrl}/v3/api-docs`, { signal: AbortSignal.timeout(8000) });
		if (!response.ok) return { error: `GET /v3/api-docs returned ${response.status}` };
		const doc = (await response.json()) as { paths?: Record<string, Record<string, { operationId?: string }>> };
		const operations: Operation[] = [];
		for (const [path, item] of Object.entries(doc.paths ?? {})) {
			for (const method of METHODS) {
				if (item[method]) operations.push({ method: method.toUpperCase(), path, module: moduleOf(path), operationId: item[method].operationId });
			}
		}
		return { operations };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}
