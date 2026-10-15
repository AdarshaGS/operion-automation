// Wraps a page object so every async action it exposes becomes a Playwright test step titled
// `ClassName.method`. The unified reporter reads those steps to say which UI component
// (page object) and which action on it failed - with no changes to the page objects.
//
// Sync members (locator getters like `row()`) pass through untouched.

import { test } from "@playwright/test";

export function instrument<T extends object>(pageObject: T): T {
	const className = pageObject.constructor.name;
	return new Proxy(pageObject, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof prop !== "string" || typeof value !== "function") return value;
			if (value.constructor.name !== "AsyncFunction") return value.bind(target);
			return (...args: unknown[]) => test.step(`${className}.${prop}`, () => value.apply(target, args), { box: true });
		},
	});
}
