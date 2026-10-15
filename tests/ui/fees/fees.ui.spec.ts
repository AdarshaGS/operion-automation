import { test, expect } from "../../../src/ui/fixtures";
import { uniqueCode } from "../../../src/api/data";

test("creating a fee category and a fee structure through the forms", async ({ feesSetup, seed }) => {
	const code = uniqueCode("UI");
	const categoryName = `UI Tuition ${code}`;

	await feesSetup.open();
	await feesSetup.addCategory({ code, name: categoryName });
	await expect(feesSetup.categoryRow(code)).toBeVisible();

	await feesSetup.selectStructureScope(seed.academicYearName, seed.className);
	await feesSetup.setUpStructureIfNeeded(`${seed.className} Fees ${code}`);
	await feesSetup.addStructure({ categoryName, amount: 5000, installmentDueDate: "2026-07-01" });
	await expect(feesSetup.structureRow(categoryName)).toContainText("5000");
});
