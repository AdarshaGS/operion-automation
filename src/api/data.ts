// Unique-per-call test data. Specs share one organisation for the whole run (and run in
// parallel), so anything with a uniqueness constraint (admission numbers, fee codes) must
// never be hard-coded.

let counter = 0;

export function uniqueSuffix(): string {
	counter += 1;
	return `${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
}

export function uniqueCode(prefix: string): string {
	return `${prefix}-${uniqueSuffix()}`;
}
