// Scenarios that document a real Operion defect (docs/SCENARIOS.md, "Known defects"). Each one is expected to
// fail: Playwright marks it passed while the product is still wrong, and marks it FAILED ("expected to fail but
// passed") the moment the defect is fixed, which is the cue to delete its line here and let it run as a normal test.
//
// Keyed by the exact test title; the value is the defect number from docs/SCENARIOS.md.

export const DEFECTS: Record<string, string> = {
	"RPT-05 an unknown principal type returns 400 and does not name the internal enum": "5aw",
	"RPT-03 a missing parameter value returns 400 naming the parameter": "5aw",
	"RPT-04 exporting an unknown report returns 404 and a missing parameter returns 400": "5aw",
	"RPT-08 an empty query is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a blank query is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a DELETE is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 an UPDATE is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 an INSERT is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a DROP is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 an ALTER is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a TRUNCATE is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a GRANT is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a CALL is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 two statements is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a data change after a SELECT is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a line comment is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a block comment is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 a lock is rejected when the report is saved, with a 400 and a readable message": "5aw",
	"RPT-08 the same checks apply when an existing report is edited": "5aw",
	"RPT-08 an unknown parameter type returns 400 and does not leak the internal enum name": "5aw",
	"RPT-03 a run request with no parameters object at all returns 400, never 500": "5ax",
	"RPT-08 a malformed request body returns 400, never 500": "5ax",
	"RPT-08 a blank report name is rejected": "5ax",
	"RPT-08 a name longer than the stored limit is a 400 that says so, not a bare conflict": "5ax",
	"RPT-08 two parameters, or two columns, with the same name are rejected with a message that names them": "5ax",
	"RPT-02 a second report with the name of an existing one is flagged (the standard-report seed treats the name as the identity)": "5ax",
	"RPT-07 a report cannot switch to another organisation by assigning the session variable the views are filtered by": "5ay",
	"RPT-08 a hash comment is rejected when the report is saved, with a 400 and a readable message": "5az",
	"RPT-08 a write to a file is rejected when the report is saved, with a 400 and a readable message": "5az",
	"RPT-08 a write to a dump file is rejected when the report is saved, with a 400 and a readable message": "5az",
	"RPT-08 a harmless word like 'Update' inside a text value or a REPLACE() function does not block a valid read-only query": "5az",
	"RPT-03 a placeholder in the SQL that was never declared as a parameter is rejected, not silently run as NULL": "5ba",
	"RPT-03 a value that does not match the declared parameter type is rejected with a readable message, not passed to the database": "5ba",
	"RPT-06 a query on an application table is refused when it is run, and no rows come back": "5ba",
	"RPT-06 a database error is reported without the SQL, the column or table names, or the database login": "5ba",
	"RPT-U01 a query that fails shows an error and no table, without database internals": "5ba",
	"RPT-U01 a run with a required date left empty shows a readable error, not a database message": "5ba",
	"RPT-03 a result larger than the row limit is flagged as truncated instead of silently cut": "5bb",
	"RPT-04 an export with more rows than the row limit says so": "5bb",
	"RPT-05 sharing with a user or role that does not exist is rejected": "5bc",
	"RPT-05 sharing twice with the same user gives a clear conflict, and an empty body is a 400": "5bc",
	"RPT-05 a share with neither run nor edit is rejected as meaningless": "5bc",
	"RPT-05 archiving a report stops the people it was shared with from running it": "5bc",
	"RPT-07 another organisation cannot share a report with a user of ours, and we cannot share ours with a user of theirs": "5bc",
	"RPT-05 publishing a report makes it visible to people who hold REPORT_VIEW, the permission described as 'View operational/academic reports'": "5bd",
	"RPT-05 the standard reports seeded for the organisation can be opened by a colleague with REPORT_VIEW": "5bd",
	"RPT-06 a person who may create reports but has no student permission cannot read student rows through a report": "5bd",
	"RPT-06 the same person cannot read staff records through a report either": "5bd",
	"RPT-06 a person with only fee permissions cannot read every student's date of birth through a report they write": "5bd",
	"RPT-09 an unknown sort column returns 400, never 500": "5be",
	"RPT-09 a very large page size is capped rather than returning the whole table": "5be",
	"RPT-09 an attempted run that fails (for example one reaching for an application table) is still on the record": "5be",
	"RPT-09 creating, editing, publishing, archiving and sharing a report are logged too, not only running it": "5be",
	"RPT-U02 a query the server refuses shows its reason inside the dialog, where the person is looking": "5bf",
	"RPT-U03 sharing with a user saves the share and closes the dialog without an error": "5bf",
	"RPT-U03 a colleague who may only run a report is not offered Publish, Archive, Save changes or Share": "5bf",
	"RPT-U03 sharing with a user id that does not exist shows an error in the dialog": "5bf",
	"RPT-U03 sharing a report the person cannot edit is refused with the reason, not silently closed": "5bf",
	"RPT-U04 a person with no report permission who opens /reports by link cannot start creating a report": "5bf",
	"RPT-U04 a person whose create request is refused sees the reason": "5bf",
};

export const DEFECT_SUMMARY: Record<string, string> = {
	"5aw": "validation errors answer 404 (or name an enum class) instead of 400",
	"5ax": "malformed or duplicate input answers 500 or a bare 409, or is accepted",
	"5ay": "CRITICAL: a report can read another organisation's rows by assigning @reporting_org_id",
	"5az": "SQL guard misses # comments and INTO OUTFILE/DUMPFILE, and refuses harmless words",
	"5ba": "database text leaks into run errors; parameter types and placeholders are not checked",
	"5bb": "run and export stop silently at the 5000 row limit",
	"5bc": "sharing accepts unknown or foreign principals and cannot be withdrawn",
	"5bd": "reports bypass module permissions; REPORT_VIEW is never checked",
	"5be": "audit log misses report changes and failed runs; bad sort is 500; page size uncapped",
	"5bf": "UI shows server errors behind the modal and offers actions the person cannot use",
};

/** The defect a test documents, as "5ay: summary", or undefined when the test is expected to pass. */
export function knownDefect(title: string): string | undefined {
	const id = DEFECTS[title];
	return id ? `${id}: ${DEFECT_SUMMARY[id]}` : undefined;
}
