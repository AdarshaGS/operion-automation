# Operion automation scenarios

Every scenario the automation should cover, grouped by module. Derived from the live
`/v3/api-docs` (548 operations) and the web app's modules. Use it as the backlog: tick a
box when a spec exists, and keep the ID in the test title so the report can link back.

**Status key**

- ✅ automated and passing
- 🐞 automated and currently failing because of a real Operion defect. Reporting scenarios are registered in `src/known-defects.ts` as expected failures: the test is reported as passed while the defect exists and turns red ("Expected to fail, but passed") when Operion fixes it, which is the cue to delete its line there
- ⬜ planned
- Layer tags: `API`, `UI`, `RBAC` (permission check), `TENANT` (cross-organisation isolation), `E2E` (spans modules)
- Priority: **P1** = must pass for a release, **P2** = important, **P3** = nice to have

**Totals:** 546 scenarios across the standard matrix, 25 module sections, UI health and 13 journeys. 47 are automated and passing, 10 are automated and failing on known Operion defects, and the rest are planned. The 74 tests that exist today (Auth, Students and Fees, plus the sanity journey) map onto those 57; one test can cover more than one row.

---

## 0. The standard matrix (applies to every endpoint)

Do not rewrite these per module. Generate them from the endpoint inventory, or write a
table-driven spec per module that loops over its endpoints. A module section below lists only
what is specific to that module.

| ID | Scenario | Layer | Priority |
|---|---|---|---|
| STD-01 | No token returns 401 | API | P1 |
| STD-02 | Malformed or expired token returns 401 | API | P1 |
| STD-03 | A role without the endpoint's permission returns 403; the `noPermissions` role gets 403 everywhere except self endpoints | RBAC | P1 |
| STD-04 | A read-only role can GET but every POST/PUT/PATCH/DELETE returns 403 | RBAC | P1 |
| STD-05 | `Owner` and `ALL_FUNCTIONS` roles can call every endpoint | RBAC | P2 |
| STD-06 | Unknown id returns 404, never 500 | API | P1 |
| STD-07 | Missing required body field returns 400 with a field-level message | API | P1 |
| STD-08 | Invalid enum in body or query returns 400, and the message does not leak an internal class name | API | P1 |
| STD-09 | Missing required query parameter returns 400, never 500 | API | P1 |
| STD-10 | Wrong type (string for a number, bad date format) returns 400 | API | P2 |
| STD-11 | Duplicate unique value (code, number, email) returns 409 with a clear message | API | P1 |
| STD-12 | A record created in organisation A is invisible to organisation B (list, get, update, delete) | TENANT | P1 |
| STD-13 | Paginated lists honour `page`, `size`, `sort`; an out-of-range page returns an empty page | API | P2 |
| STD-14 | A deactivated or inactive record is hidden or blocked where the module says so | API | P2 |
| STD-15 | Create then read back returns the same data (round trip) | API | P1 |
| STD-16 | Create writes an audit-log entry for audited entities | API | P3 |
| STD-17 | Import with a bad file type, an empty file, and a file with a bad row reports per-row results | API | P2 |
| STD-18 | Export returns every row the caller may see and nothing else | API | P2 |
| STD-19 | No 5xx for any input in this matrix (a fuzz pass over each endpoint) | API | P1 |

---

## 1. Auth (`/auth`)

Login, session and password flows. Backend: `auth` (10 endpoints). UI: login page.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| AUTH-01 | Valid credentials return access and refresh tokens | API | P1 | ✅ |
| AUTH-02 | Wrong password returns 401 with no token | API | P1 | ✅ |
| AUTH-03 | Unknown organisation returns the same error as a wrong password (no tenant enumeration) | API | P1 | ✅ |
| AUTH-04 | Empty body never yields a token | API | P2 | ✅ |
| AUTH-05 | `GET /auth/me` returns the caller | API | P1 | ✅ |
| AUTH-06 | A role with no permissions authenticates but holds none | API | P2 | ✅ |
| AUTH-07 | No token and malformed token both return 401 | API | P1 | ✅ |
| AUTH-08 | Valid refresh token yields a new access token | API | P1 | ✅ |
| AUTH-09 | Unknown refresh token returns 401 | API | P1 | ✅ |
| AUTH-10 | Change password requires authentication | API | P1 | ✅ |
| AUTH-11 | Change password rejects a wrong current password | API | P1 | ✅ |
| AUTH-12 | Change password: new one logs in, old one stops working | API | P1 | ✅ |
| AUTH-13 | Change password rejects a trivially weak password (1 character) | API | P1 | ✅ |
| AUTH-14 | Logout revokes the session; the refresh token no longer works | API | P1 | ✅ |
| AUTH-15 | Password-reset request answers identically for known and unknown emails | API | P1 | ✅ |
| AUTH-16 | Password-reset confirm with a valid token sets a new password | API | P1 | ✅ |
| AUTH-17 | Password-reset confirm with an expired, reused or invalid token returns 400 | API | P1 | ✅ |
| AUTH-18 | Verify email with a valid token marks the email verified | API | P2 | ✅ |
| AUTH-19 | Verify email with a bad or reused token is rejected | API | P2 | ✅ |
| AUTH-20 | Claim staff invite sets a password and grants membership | API | P1 | ✅ |
| AUTH-21 | Claim invite (guardian) works once; a second claim is rejected | API | P1 | ✅ |
| AUTH-22 | Claim with an expired or revoked invite is rejected; resending an invite invalidates the old link (currently it stays valid) | API | P2 | 🐞 |
| AUTH-23 | Repeated failed logins lock or throttle the account (login-attempt tracking) | API | P1 | ✅ |
| AUTH-24 | A successful login resets the failed-attempt counter | API | P2 | ✅ |
| AUTH-25 | A user whose membership was revoked cannot log in or refresh (refresh currently still works) | API | P1 | 🐞 |
| AUTH-26 | A deactivated user cannot log in, refresh, or keep using an issued access token (refresh and the old token currently still work) | API | P1 | 🐞 |
| AUTH-27 | An access token from organisation A is rejected on organisation B's data | TENANT | P1 | ✅ |
| AUTH-28 | The token payload does not contain the password hash or other secrets | API | P2 | ✅ |
| AUTH-29 | Claiming an invite with a one-character password is rejected (currently accepted) | API | P1 | 🐞 |
| AUTH-U01 | Valid sign-in reaches the dashboard | UI | P1 | ✅ |
| AUTH-U02 | Wrong password shows an error and stays on the login page | UI | P1 | ✅ |
| AUTH-U03 | Visiting a protected page while signed out redirects to login | UI | P1 | ✅ |
| AUTH-U04 | After login the user lands on the page their permissions allow (Dashboard versus Students) | UI | P2 | ✅ |
| AUTH-U05 | Logout from the UI clears the session and blocks the back button | UI | P1 | ✅ |
| AUTH-U06 | Forgot-password form shows the same message for any email | UI | P2 | ✅ |
| AUTH-U07 | Reset-password page completes the flow and signs in with the new password | UI | P1 | ✅ |
| AUTH-U08 | Staff-invite claim page creates the account and signs in | UI | P1 | ✅ |
| AUTH-U09 | An invalid or expired session redirects to login (currently the app stays on the page with the whole menu disabled) | UI | P2 | 🐞 |
| AUTH-U10 | Login form validation: empty fields, show/hide password, Enter key submits | UI | P3 | ✅ |

## 2. Organisation onboarding (`/organisations`, `/public`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ORG-01 | Create an organisation with a valid slug, type and board | API | P1 | ✅ |
| ORG-02 | Duplicate slug returns 409 | API | P1 | ✅ |
| ORG-03 | Invalid `organisationType` or `board` returns 400 | API | P2 | 🐞 |
| ORG-04 | A new organisation gets an `Owner` role and an owner who can log in | API | P1 | ✅ |
| ORG-05 | Get and patch organisation profile (name, address, contact) and read it back | API | P1 | 🐞 |
| ORG-06 | Get and patch organisation settings | API | P2 | 🐞 |
| ORG-07 | Patch organisation status (activate, suspend); a suspended organisation cannot log in | API | P1 | 🐞 |
| ORG-08 | School template: preview, recommend and apply seeds classes, subjects and categories | API | P2 | ✅ |
| ORG-09 | School template items: list by category, add, edit, delete | API | P3 | 🐞 |
| ORG-10 | School template needs lists what is still missing | API | P3 | ✅ |
| ORG-11 | Profile and settings changes need `ORGANISATION_MANAGE` | RBAC | P1 | ✅ |
| ORG-12 | An organisation owner cannot change another organisation's status or template, and template edits stay inside their organisation | TENANT | P1 | 🐞 |
| ORG-13 | Starter-pack recommend turns questionnaire answers into a module selection (core modules locked; no answers falls back to defaults) | API | P2 | ✅ |
| ORG-14 | Go-live check reports readiness per module group; new organisation is not ready; applying the template reduces findings; needs `ORGANISATION_MANAGE` | API | P2 | ✅ |
| ORG-U01 | Onboarding wizard takes a new organisation from empty to ready, step by step | UI | P1 | ✅ |
| ORG-U02 | Setup checklist moves from 0 of 6 to 6 of 6 in dependency order; partial data does not flip it early (built with the Dashboard module) | UI | P1 | ⬜ |
| ORG-U03 | Required-field validation blocks the profile form submit | UI | P2 | ✅ |
| ORG-U04 | Apply a school template from Settings, see what was added, re-apply says nothing new, review link opens | UI | P2 | ✅ |
| ORG-U05 | Business settings: currency, date format and timezone save and persist; an invalid primary colour is not accepted | UI | P2 | 🐞 |
| ORG-U06 | Review school setup and go-live check pages: links between them, new organisation not ready, Fix buttons navigate away | UI | P2 | ✅ |
| ORG-U07 | Settings page lists the Organisation group sections | UI | P3 | ✅ |
| PUB-01 | Public admission-inquiry form options load without a token | API | P1 | ✅ |
| PUB-02 | Public admission inquiry creates an applicant for the right organisation slug | API | P1 | ✅ |
| PUB-03 | Inquiry without `dateOfBirth` returns 400 | API | P2 | ✅ |
| PUB-04 | Inquiry to an unknown slug returns 404 and leaks no organisation detail | API | P2 | ✅ |
| PUB-05 | Public endpoints are rate-limited or reject obviously abusive input | API | P3 | ✅ |
| PUB-U01 | Public admission form at `/apply/:slug` shows the organisation name without sign-in | UI | P1 | ✅ |
| PUB-U02 | Completing the form shows the thank-you message and the applicant appears in the pipeline; a class can be chosen | UI | P1 | ✅ |
| PUB-U03 | Empty or invalid form shows field errors and sends nothing | UI | P2 | ✅ |
| PUB-U04 | An unknown form link shows "This admission form link isn't valid." and no form | UI | P2 | ✅ |

## 3. Members, roles and permissions (`/users`, `/roles`, `/memberships`, `/permissions`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| MEM-01 | List permissions returns the full catalogue | API | P2 | ✅ |
| MEM-02 | Create a role with a set of permission codes and read it back | API | P1 | 🐞 |
| MEM-03 | Update a role's permissions; the change applies to users on their next token | API | P1 | ✅ |
| MEM-04 | Duplicate role name returns 409 | API | P2 | ✅ |
| MEM-05 | Unknown permission code in a role returns 400 | API | P2 | 🐞 |
| MEM-06 | Deactivate and reactivate a role; an inactive role cannot be assigned | API | P2 | 🐞 |
| MEM-07 | Mark a role as portal (`isPortal`); portal users route to the portal | API | P2 | ✅ |
| MEM-08 | The `Owner` role cannot be deleted, deactivated or stripped of permissions | API | P1 | 🐞 |
| MEM-09 | Invite a user by email; invite appears as pending | API | P1 | 🐞 |
| MEM-10 | Resend an invite issues a fresh token for a pending invitee (old-token invalidation is tracked as AUTH-22); resend for an active member is 409 | API | P2 | ✅ |
| MEM-11 | Invite an email that already exists in the organisation returns 409 | API | P2 | ✅ |
| MEM-12 | Create a user, then update details with PUT | API | P2 | 🐞 |
| MEM-13 | Deactivate and reactivate a user | API | P1 | 🐞 |
| MEM-14 | The last Owner cannot be deactivated or have the Owner membership revoked | API | P1 | 🐞 |
| MEM-15 | Create a membership (role, person); revoke it; access disappears | API | P1 | 🐞 |
| MEM-16 | A user with two memberships gets the union of their permissions | API | P2 | ✅ |
| MEM-17 | Role and user management need the matching manage permission | RBAC | P1 | ✅ |
| MEM-18 | Users list has the documented shape, includes created members and never shows another organisation's users (the endpoint is not paginated; search is client-side) | API | P3 | ✅ |
| MEM-19 | Roles, users and memberships of another organisation are invisible and cannot be changed or assigned | TENANT | P1 | ✅ |
| MEM-U01 | Invite a staff member from the Members page and see the pending invite | UI | P1 | 🐞 |
| MEM-U02 | Create a custom role with permission checkboxes, assign it, and the nav reflects it | UI | P1 | 🐞 |
| MEM-U03 | Nav visibility: each sidebar item is enabled only when the role holds its permission (every role × every item) | UI | P1 | ✅ |
| MEM-U04 | Revoke access from the UI; the member can no longer sign in | UI | P2 | ✅ |
| MEM-U05 | Opening Members by direct link without `MEMBERSHIP_VIEW` shows the missing-permission message and no member data | UI | P2 | ✅ |

## 4. Academics (`/academic-years`, `/school-classes`, `/sections`, `/subjects`, `/grade-levels`, `/campuses`, `/academic`, `/timetable`, `/teacher-assignments`, `/teachers`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ACA-01 | Create an academic year; list shows it | API | P1 | 🐞 |
| ACA-02 | Overlapping or inverted date range returns 400 | API | P1 | 🐞 |
| ACA-03 | Mark a year current; exactly one year is current afterwards | API | P1 | ✅ |
| ACA-04 | Close a year; closed year blocks new enrolments and attendance | API | P1 | 🐞 |
| ACA-05 | Create a campus; duplicate name returns 409 | API | P2 | 🐞 |
| ACA-06 | Create, update and deactivate a grade level; an inactive one is not selectable | API | P2 | 🐞 |
| ACA-07 | Create, update and deactivate a class | API | P1 | 🐞 |
| ACA-08 | Add and update sections under a class; section names are unique per class | API | P1 | 🐞 |
| ACA-09 | Deactivating a class with enrolled students is blocked or warns | API | P1 | 🐞 |
| ACA-10 | Add a subject to a class; update it; deactivate it | API | P1 | 🐞 |
| ACA-11 | Subject catalogue: create, deactivate, import, export | API | P2 | 🐞 |
| ACA-12 | Class-sections import and export round trip | API | P2 | ✅ |
| ACA-13 | Setup status reports which academic steps remain | API | P2 | ✅ |
| ACA-14 | Academic settings: get and patch | API | P3 | 🐞 |
| ACA-15 | Working calendar: add a working-day rule, list for a year, delete | API | P2 | 🐞 |
| ACA-16 | School events: add, list by date range, delete; `from > to` returns 400 | API | P2 | 🐞 |
| ACA-17 | Timetable periods: create, update, delete; `endTime <= startTime` returns 400; ordinal is unique | API | P1 | 🐞 |
| ACA-18 | Section timetable: put an entry (day, period, subject, teacher) and read it back | API | P1 | ✅ |
| ACA-19 | Timetable clash: the same teacher in two sections in one period is rejected | API | P1 | ✅ |
| ACA-20 | Timetable clash: two entries in the same section and period are rejected or replace each other, as designed | API | P2 | ✅ |
| ACA-21 | Delete a timetable entry; the slot becomes free | API | P2 | ✅ |
| ACA-22 | Teacher timetable and assignments views list the right entries | API | P2 | 🐞 |
| ACA-23 | Assign a teacher to a section and subject; end the assignment | API | P1 | 🐞 |
| ACA-24 | Section enrolments list shows the enrolled students | API | P2 | ✅ |
| ACA-25 | Academic structure writes need the matching manage permission (17 writes × 2 roles, plus view-permission reads and anonymous 401) | RBAC | P1 | ✅ |
| ACA-26 | Another organisation cannot see, change, delete or use years, classes, sections, subjects, periods, timetable entries or calendar rules | TENANT | P1 | ✅ |
| ACA-U01 | Create a class, then a section, from the Academics screens | UI | P1 | 🐞 |
| ACA-U02 | Academic year switcher in the top bar changes the selected year | UI | P2 | ✅ |
| ACA-U03 | Timetable grid: place a subject and teacher in a cell and see it persist after reload | UI | P1 | 🐞 |
| ACA-U04 | A clash shows an inline error and does not save | UI | P1 | ✅ |
| ACA-U05 | Working calendar and school events render on the calendar view | UI | P3 | ✅ |
| ACA-U06 | Periods tab: add, edit and delete a period; an invalid time range shows its error inside the dialog | UI | P2 | 🐞 |

## 5. Students (`/students`, `/guardians`, `/persons`, `/student-enrollments`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| STU-01 | Admit a student and get the created record back | API | P1 | 🐞 |
| STU-02 | Admit without `personId` or without `admissionDate` returns 400 | API | P1 | ✅ |
| STU-03 | Admit with a `personId` that does not exist returns a client error | API | P1 | ✅ |
| STU-04 | Duplicate admission number is rejected | API | P1 | ✅ |
| STU-05 | List students includes the seeded one; read-only staff may list, no `STUDENT_VIEW` may not | API | P1 | ✅ |
| STU-06 | Search returns a page envelope with list-row fields | API | P1 | ✅ |
| STU-07 | Search filters by text, section, and page size | API | P1 | ✅ |
| STU-08 | Search with an invalid `status` is a client error, not 404 or 500 | API | P1 | 🐞 |
| STU-09 | Search filters by status, class, and admission date range | API | P2 | 🐞 |
| STU-10 | Search sorts by each sortable column in both directions | API | P3 | 🐞 |
| STU-11 | Get returns the student; unknown id returns 404 | API | P1 | ✅ |
| STU-12 | Patch updates mutable fields and persists; read-only staff gets 403 | API | P1 | ✅ |
| STU-13 | Patch does not change admission number or person | API | P2 | 🐞 |
| STU-14 | Custom field values on admit and patch round trip | API | P2 | 🐞 |
| STU-15 | Enrol an admitted student into a section; status moves `ADMITTED` to `ACTIVE` | API | P1 | ✅ |
| STU-16 | Enrolling twice in the same year is rejected | API | P1 | 🐞 |
| STU-17 | Reassign a student to another section of the same class; the enrolment is updated in place | API | P1 | 🐞 |
| STU-18 | Promote to the next class; new enrolment in the next year, old one closed | API | P1 | ✅ |
| STU-19 | Add a guardian to a student; mark one as primary; only one primary at a time | API | P1 | 🐞 |
| STU-20 | Update a guardian link (relationship, primary flag, status) | API | P2 | 🐞 |
| STU-21 | Create a guardian, list a guardian's students, grant portal access | API | P1 | ✅ |
| STU-22 | Upload a student document; verify it | API | P2 | 🐞 |
| STU-23 | Record a student exit (leaving, transfer-out); the student is no longer active | API | P1 | 🐞 |
| STU-24 | Raise a transfer request, then approve it; reject another with a reason | API | P2 | 🐞 |
| STU-25 | Import students from a CSV and from an XLSX; a bad row fails alone, good rows succeed | API | P1 | 🐞 |
| STU-26 | Import is idempotent or rejects duplicates cleanly | API | P2 | 🐞 |
| STU-27 | Export students and guardians; the export respects permissions | API | P2 | ✅ |
| STU-28 | Persons: create, get, patch, set photo; unknown id returns 404 | API | P2 | 🐞 |
| STU-29 | Student-enrolments import and export round trip | API | P3 | ✅ |
| STU-30 | Two simultaneous admissions with the same admission number: one wins, one gets 409 | API | P2 | ✅ |
| STU-31 | Student data from organisation A is invisible to B on list, search, get, export | TENANT | P1 | ✅ |
| STU-32 | Student and guardian writes and sub-resource reads need the right permission (admit, patch, enrol, promote, guardians, documents, exits, transfers, persons) | RBAC | P1 | 🐞 |
| STU-U01 | Admit through the form creates, enrols and lists the student | UI | P1 | ✅ |
| STU-U02 | The seeded student appears in the list and opens its detail page | UI | P1 | ✅ |
| STU-U03 | List: search, filter by class/section/status, and pagination | UI | P1 | 🐞 |
| STU-U04 | Detail page panels (guardians, documents, campus transfers), enrol button, upload and verify a document, raise a transfer | UI | P2 | ✅ |
| STU-U05 | Add a guardian from the detail page | UI | P1 | ✅ |
| STU-U06 | Bulk import from Settings > Imports & exports: per-row result, bad row reported, template download | UI | P1 | 🐞 |
| STU-U07 | Required-field errors on the admit form block submit | UI | P2 | ✅ |
| STU-U08 | Read-only staff sees the list but no admit or edit buttons | UI | P1 | 🐞 |
| STU-U09 | Enrol an admitted student from the detail page (promote and reassign have no UI) | UI | P2 | ✅ |
| STU-U10 | Empty state when no students exist | UI | P3 | ✅ |

## 6. Admissions pipeline (`/applicants`, `/job-applications` public side)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ADM-01 | Create an applicant (inquiry date, person); no duplicate application for one person, no future inquiry date | API | P1 | 🐞 |
| ADM-02 | Missing `inquiryDate` or `personId`, a malformed date, or overlong notes return 400 | API | P1 | 🐞 |
| ADM-03 | Start review moves INQUIRY to UNDER_REVIEW; invalid transitions are rejected | API | P1 | ✅ |
| ADM-04 | Reject needs a reason and ends the pipeline; a rejected applicant cannot be converted | API | P1 | ✅ |
| ADM-05 | Convert creates a Student with the right data; the applicant is marked converted and shows which student it became | API | P1 | 🐞 |
| ADM-06 | Converting twice is rejected | API | P1 | 🐞 |
| ADM-07 | Convert validation: missing, future or conflicting admission date, duplicate admission number, negative score, unknown applicant | API | P2 | 🐞 |
| ADM-08 | Status counts match the lists; paging and status filter validation | API | P2 | 🐞 |
| ADM-09 | Required-documents checklist: list the five types, mark received and undo, validation | API | P2 | 🐞 |
| ADM-10 | A public inquiry appears in the applicants list with guardian and class, then can be reviewed, rejected or converted | E2E | P1 | ✅ |
| ADM-11 | Applicant reads need `STUDENT_VIEW`, writes need `STUDENT_MANAGE`; every endpoint needs a sign-in | RBAC | P1 | ✅ |
| ADM-12 | Applicants of organisation A are invisible and untouchable from B | TENANT | P1 | ✅ |
| ADM-U01 | Admissions page: status chips with counts filter the table; row details; empty state; paging at 20 | UI | P1 | ✅ |
| ADM-U02 | Start review, approve (creates the student, opens the record), duplicate number error, counts update | UI | P1 | 🐞 |
| ADM-U03 | Reject dialog requires a reason | UI | P2 | ✅ |
| ADM-U04 | Documents dialog: five documents, save received ones, reopen shows them | UI | P2 | ✅ |
| ADM-U05 | Public form link dialog builds the link from the organisation slug | UI | P3 | ✅ |
| ADM-U06 | Read-only staff sees applicants and documents but no review, approve, reject or Save | UI | P1 | ✅ |
| ADM-U07 | Record inquiry on the Students page creates a pending applicant | UI | P2 | ✅ |

## 7. Attendance (`/attendance`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ATT-01 | Get the register for a section and date; a day with no marks answers 404 "No attendance register", a marked day lists one entry per marked student | API | P1 | ✅ |
| ATT-02 | Mark attendance (present, absent, late, half day, leave, excused flag, remarks); marking a day that already has marks is rejected (409) because changes go through corrections; the excused flag is required; invalid input is rejected | API | P1 | 🐞 |
| ATT-03 | Register for a date without the `date` parameter, or with a malformed date, returns 400 | API | P2 | ✅ |
| ATT-04 | Marking is limited to the section's academic year and to working days: a date outside the year, or a holiday in the working calendar, is rejected | API | P2 | 🐞 |
| ATT-05 | Submit a register; it becomes read-only for marking, cannot be submitted twice | API | P1 | ✅ |
| ATT-06 | Lock a submitted register (a draft cannot be locked); a locked register rejects marking and corrections | API | P1 | ✅ |
| ATT-07 | Unlock a locked register back to submitted (only a locked one); lock and unlock are separate permissions | API | P1 | ✅ |
| ATT-08 | Correct one student's attendance (patch) with a reason; records who and when; unknown ids, missing reason, unknown status and a no-op change are rejected | API | P1 | 🐞 |
| ATT-09 | Corrections history lists every change in order with previous status, new status, reason, who and when; empty for an untouched entry; unknown entry returns 404 | API | P2 | 🐞 |
| ATT-10 | Student attendance for a date range (`from`, `to`, inclusive); missing bounds, reversed bounds and unknown enrolment are rejected | API | P2 | 🐞 |
| ATT-11 | Monthly summary percentage = (present + late + half a half day) over marked days excluding leave; excused absences count as absent; corrections change it | API | P1 | ✅ |
| ATT-12 | Summary input is validated (month 1 to 12, year and month required, unknown enrolment 404) and counts only the requested month | API | P1 | 🐞 |
| ATT-13 | Staff attendance: mark for a campus and date, list by campus and day, check out; duplicate day, unknown person or campus, bad status, missing date are rejected | API | P2 | 🐞 |
| ATT-14 | Check-out before check-in, check-out for someone with no check-in, or without a time is rejected | API | P3 | 🐞 |
| ATT-15 | A student cannot be marked on a day before their enrolment date | API | P2 | 🐞 |
| ATT-16 | Permissions: view-only can read but not mark, submit, lock, unlock or correct; each of mark, lock, unlock and correct is its own permission; no permission is 403; anonymous is 401. Known gap: no rule ties a marker to the sections they teach, so any user with mark permission can mark any section | RBAC | P2 | ✅ |
| ATT-17 | A student whose enrolment was closed by an exit cannot be marked | API | P2 | ✅ |
| ATT-18 | Another organisation cannot read, mark, submit, lock, unlock, correct or summarise these registers or staff records | Tenant | P1 | ✅ |
| ATT-U01 | Open a register, mark everyone present, save, submit and lock | UI | P1 | ✅ |
| ATT-U02 | Mark absent (with excuse and remark) and late, half day, leave; counts update | UI | P1 | ✅ |
| ATT-U03 | A locked register shows no Correct, Submit or Lock; an unlock action exists for permitted roles | UI | P1 | 🐞 |
| ATT-U04 | Student page shows the month's percentage and counts; an unmarked month shows 0% | UI | P2 | ✅ |
| ATT-U05 | Staff attendance screen: mark and check out | UI | P3 | 🐞 |
| ATT-U06 | Correct an entry from the register: reason required, status changes, trail recorded | UI | P1 | ✅ |
| ATT-U07 | Loading an already marked day shows the register, not an empty form | UI | P2 | ✅ |
| ATT-U08 | Day arrows load the previous and next day | UI | P3 | ✅ |
| ATT-U09 | A section with no students says so and cannot be submitted | UI | P3 | ✅ |
| ATT-U10 | A mark the server rejects is explained on the page and the typed marks are kept | UI | P2 | ✅ |
| ATT-U11 | The correction history of an entry can be seen on screen | UI | P3 | 🐞 |
| ATT-U12 | Quick "mark today" screen: mark a section, then it points to the full register | UI | P2 | ✅ |
| ATT-U13 | A view-only user sees the register without the marking form, Submit, Lock or Correct controls | UI | P2 | 🐞 |

## 8. Examinations (`/examinations`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| EXM-01 | Create a grading scale with bands (each band is a minimum-percentage floor); a scale needs a name, at least one band, a band at 0%, minima between 0 and 100, no duplicate minima, a grade on every band | API | P1 | 🐞 |
| EXM-02 | List and get grading scales; unknown scale 404; only one scale is the default | API | P2 | 🐞 |
| EXM-03 | Create an exam for an academic year (all four types), list it (needs `academicYearId`, limited to that year), get it; name, type and year are validated | API | P1 | 🐞 |
| EXM-04 | Add schedules (class or one section, subject, date, max, pass) and list them; a subject cannot be scheduled twice or for a section already covered; date, class and section must belong to the exam's year and class | API | P1 | 🐞 |
| EXM-05 | Pass marks above max, zero or negative max, negative pass marks, a missing date or missing marks are rejected | API | P1 | 🐞 |
| EXM-06 | The marks register of a schedule starts as a draft with no id; an unknown schedule returns 404 | API | P1 | 🐞 |
| EXM-07 | Enter marks for a schedule, then read them back with who entered them and pass/fail | API | P1 | ✅ |
| EXM-08 | Marks validation: above max and negative rejected, pass mark is the line, absent allowed, duplicates and unknown or foreign-class students rejected | API | P1 | 🐞 |
| EXM-09 | Correct one marks entry before submission (who, when, audit log); invalid values rejected | API | P1 | 🐞 |
| EXM-10 | Submit marks; entry is closed (409), cannot submit twice, submit and approve are audited; submitting with nothing entered is rejected | API | P1 | 🐞 |
| EXM-11 | Approve submitted marks, records the approver; enter, submit and approve are separate permissions | API | P1 | ✅ |
| EXM-12 | Approving before submission is rejected | API | P1 | ✅ |
| EXM-13 | Publish a report card only when every subject is approved and the student has marks; one per exam and student; unknown or missing inputs rejected | API | P1 | 🐞 |
| EXM-14 | Report card totals, percentage and grade match the scale (including at band boundaries); pass/fail follows the configured strategy (every subject, minimum aggregate, both; absent fails) | API | P1 | ✅ |
| EXM-15 | Report card render returns the data to lay out (student, exam, subject table, totals) | API | P2 | ✅ |
| EXM-16 | Correct marks after publish: needs its own permission, flags the card stale, republish supersedes it, audit trail; ordinary correction on a published student is refused | API | P1 | 🐞 |
| EXM-17 | Report cards list needs `studentEnrollmentId`; get a card by id; unknown id 404 | API | P2 | ✅ |
| EXM-18 | Examination settings: defaults, get, put, per-organisation; strategy and threshold validated | API | P3 | 🐞 |
| EXM-19 | A guardian sees only their own child's report cards, and only after publish and while not stale. Covered with the portals in module 21 | RBAC | P1 | ⬜ |
| EXM-20 | Permissions: view-only reads but changes nothing; exam, grading-scale, enter, submit, approve, correct, correct-after-publish and publish are all separate; no permission 403; anonymous 401 | RBAC | P1 | ✅ |
| EXM-21 | Another organisation cannot read or change exams, scales, schedules, marks, registers or report cards | Tenant | P1 | ✅ |
| EXM-22 | Ranking: off means no ranks; on gives competition ranks (1, 1, 3) per subject and per class and re-ranks after a correction | API | P2 | ✅ |
| EXM-U01 | Create an exam and add its schedule from the UI; a clash is explained | UI | P1 | 🐞 |
| EXM-U02 | Enter marks in the grid, save, submit for review, approve; absent students; invalid marks refused | UI | P1 | 🐞 |
| EXM-U03 | Publish a report card from the exam page and read the result; a premature publish is explained | UI | P1 | 🐞 |
| EXM-U04 | Print view lays out student, subject table, totals and grade; stale card warns; unknown card says so | UI | P2 | ✅ |
| EXM-U05 | Settings panel saves strategy, ranking and threshold; the threshold field follows the strategy; an out-of-range threshold is refused | UI | P3 | 🐞 |
| EXM-U06 | Add a grading scale from the UI and see its bands; an invalid scale is refused | UI | P2 | 🐞 |
| EXM-U07 | Correct a mark from the marks screen, with a stale warning for published students | UI | P2 | ✅ |
| EXM-U08 | A view-only user does not get the add, publish, approve, correct or entry controls | UI | P2 | 🐞 |

## 9. Fees (`/fees`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| FEE-01 | Create a category; read it back | API | P1 | ✅ |
| FEE-02 | Duplicate category code is rejected | API | P1 | ✅ |
| FEE-03 | Category without a name returns 400 | API | P1 | ✅ |
| FEE-04 | Category with an unknown type returns 400 | API | P1 | ✅ |
| FEE-05 | Category list includes the new one; fees collector can read, no `FEE_VIEW` cannot | API | P1 | ✅ |
| FEE-06 | Create a structure group for a year and class; list requires both; a second group for the same pair is 409 | API | P1 | 🐞 |
| FEE-07 | Create a structure with installments; amounts sum to the total | API | P1 | ✅ |
| FEE-08 | Installments that do not sum to the amount, duplicate installment numbers and non-positive amounts are rejected with 400 | API | P1 | 🐞 |
| FEE-09 | Structure with a missing group returns a client error | API | P1 | ✅ |
| FEE-10 | Structure creation needs `FEE_STRUCTURE_MANAGE`; fees collector gets 403 | RBAC | P1 | ✅ |
| FEE-11 | List structures needs `feeStructureGroupId` (400) | API | P1 | ✅ |
| FEE-12 | Get structure; unknown id returns 404 | API | P1 | ✅ |
| FEE-13 | Payment frequency values: MONTHLY, QUARTERLY, HALF_YEARLY, ONE_SHOT; invalid value returns 400 | API | P1 | ✅ |
| FEE-14 | One-shot discount amount reduces the total correctly; a negative or oversized discount is rejected | API | P2 | 🐞 |
| FEE-15 | Fee structures import and export | API | P2 | 🐞 |
| FEE-16 | Assign a structure to a student enrolment | API | P1 | ✅ |
| FEE-17 | Assigning the same structure twice is rejected | API | P1 | 🐞 |
| FEE-18 | Discounts on assignment and revisions (in place before invoicing, supersede after); history is kept | API | P2 | 🐞 |
| FEE-19 | Generate an invoice for an assignment installment | API | P1 | ✅ |
| FEE-20 | Generating the same installment twice is rejected with 409 and no second invoice is created | API | P1 | 🐞 |
| FEE-21 | Concurrent first invoice generation does not deadlock on `fee_document_counters` | API | P1 | ✅ |
| FEE-22 | Invoice and receipt numbers are sequential and unique per year series | API | P1 | ✅ |
| FEE-23 | Record a payment that settles an invoice; invoice moves to PAID | API | P1 | ✅ |
| FEE-24 | Partial payment leaves PARTIALLY_PAID with the right balance | API | P1 | ✅ |
| FEE-25 | A payment larger than the invoice (rejected, 409) or zero, negative, future-dated or mis-allocated is rejected | API | P1 | 🐞 |
| FEE-26 | Record payment needs `FEE_COLLECT`; read-only staff gets 403 | RBAC | P1 | ✅ |
| FEE-27 | Payment methods: cash, cheque (with bank name), UPI, card; reference required where designed | API | P2 | 🐞 |
| FEE-28 | Bounce a cheque payment; the invoice reopens; bouncing twice is 409 | API | P1 | 🐞 |
| FEE-29 | Refund a payment; the amount cannot exceed what was paid | API | P1 | 🐞 |
| FEE-30 | Waiver: create with an approver and a reason; the invoice balance drops | API | P1 | 🐞 |
| FEE-31 | Waiver or discount needs an approver from the approvers list; a non-approver is rejected | RBAC | P1 | 🐞 |
| FEE-32 | Adjustments: add a debit or credit to an invoice and list by invoice | API | P2 | 🐞 |
| FEE-33 | Invoice list for a student; missing `studentEnrollmentId` returns 400 | API | P1 | ✅ |
| FEE-34 | Overdue invoices list contains only past-due, unpaid invoices | API | P1 | ✅ |
| FEE-35 | Unknown invoice id returns 404 | API | P1 | ✅ |
| FEE-36 | Payments and assignments lists for a student | API | P1 | ✅ |
| FEE-37 | Send reminders for overdue invoices; none are sent for paid invoices | API | P2 | 🐞 |
| FEE-38 | Payment link: create for an invoice, open by token, checkout (502 without a gateway); an expired link is rejected (fixme: cannot age a link from outside) | API | P1 | ✅ |
| FEE-39 | Payment link for organisation A's token cannot be used under organisation B's slug | TENANT | P1 | ✅ |
| FEE-40 | Opening balances import and export | API | P2 | 🐞 |
| FEE-41 | Per-payer fee frequency; transport and tuition categories bill separately | API | P2 | ✅ |
| FEE-42 | Fee reads need `FEE_VIEW` and authentication | RBAC | P1 | ✅ |
| FEE-43 | Fee data from organisation A is invisible to B | TENANT | P1 | ✅ |
| FEE-U01 | Create a category and a structure through the setup forms | UI | P1 | ✅ |
| FEE-U02 | Assign fees to a student from the student's fee panel | UI | P1 | 🐞 |
| FEE-U03 | Collect a payment from the UI and see the receipt and updated balance | UI | P1 | 🐞 |
| FEE-U04 | Overdue list and send-reminder action | UI | P2 | ✅ |
| FEE-U05 | Waiver dialog requires an approver and a reason | UI | P1 | 🐞 |
| FEE-U06 | Discount proof upload attaches to the waiver | UI | P3 | 🐞 |
| FEE-U07 | Fees collector sees collection screens but not structure setup; a view-only user gets no change buttons | UI | P1 | 🐞 |

## 10. Learning (`/learning`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| LRN-01 | Scope: a teacher sees and writes only the section and subject they teach; managers and `LEARNING_VIEW` see all; no access without either; tenant isolation | API | P1 | ✅ |
| LRN-02 | Section students list needs `sectionId` | API | P2 | ✅ |
| LRN-03 | Homework: create, list, cancel; required fields; the subject must belong to the class | API | P1 | 🐞 |
| LRN-04 | Guardian submits homework for their child (portal); late submission is flagged; resubmit before review; not for another child | API | P1 | 🐞 |
| LRN-05 | Teacher reviews a submission with feedback; a reviewed submission is locked | API | P1 | ✅ |
| LRN-06 | Quiz: create, add questions, publish; a published quiz cannot be edited | API | P1 | 🐞 |
| LRN-07 | Add a question from the question bank; delete a question from a quiz | API | P2 | ✅ |
| LRN-08 | Guardian attempts a quiz (portal); only while open; one attempt only; scoring is correct | API | P1 | 🐞 |
| LRN-09 | Quiz results show every student, attempted or not; QUIZ leaderboard ranks by percentage | API | P2 | ✅ |
| LRN-10 | Question bank: add, list, delete | API | P2 | 🐞 |
| LRN-11 | Materials: add file, link, note; archive; invalid `kind` returns 400 | API | P2 | 🐞 |
| LRN-12 | Lesson plans: draft, submit, approve, reject; invalid transitions are blocked | API | P1 | 🐞 |
| LRN-13 | Lesson-plan calendar needs `from` and `to` | API | P3 | 🐞 |
| LRN-14 | Lesson-plan status filter accepts DRAFT, SUBMITTED, APPROVED, REJECTED only | API | P2 | ✅ |
| LRN-15 | Answer sheets: upload for a schedule, mark, release; students see only released ones | API | P1 | 🐞 |
| LRN-16 | Rewards: give a reward to a student; list by section | API | P3 | 🐞 |
| LRN-17 | Leaderboards: student tracks QUIZ, ACADEMIC, REWARD; invalid track returns 400; teacher leaderboard | API | P2 | ✅ |
| LRN-18 | A teacher cannot see a colleague's draft plans, write outside their section and subject, or approve plans (scope check) | RBAC | P2 | ✅ |
| LRN-U01 | Teacher creates homework, tracks and reviews submissions; scoped section list; view-only users get no change buttons | UI | P1 | 🐞 |
| LRN-U02 | Quiz builder: add questions, publish, view results | UI | P1 | ✅ |
| LRN-U03 | Lesson-plan board: submit, approve | UI | P2 | ✅ |
| LRN-U04 | Leaderboard page loads for each track | UI | P3 | ✅ |

## 11. Library (`/library`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| LIB-01 | Add a book; update it; withdraw it | API | P1 | 🐞 |
| LIB-02 | Add copies to a book; set shelf location on a copy | API | P1 | 🐞 |
| LIB-03 | Borrow a copy; the copy becomes unavailable | API | P1 | ✅ |
| LIB-04 | Borrowing an unavailable or withdrawn copy is rejected | API | P1 | 🐞 |
| LIB-05 | Borrow limit per borrower is enforced (library settings) | API | P1 | ✅ |
| LIB-06 | Return a copy; the copy is available again | API | P1 | 🐞 |
| LIB-07 | A late return creates a fine using the configured rate | API | P1 | 🐞 |
| LIB-08 | Mark lost and mark damaged update the copy and may raise a fine | API | P2 | ✅ |
| LIB-09 | Fines: create, pay, waive; paying more than the fine is rejected | API | P1 | 🐞 |
| LIB-10 | Fines list needs `borrowRecordId` | API | P3 | ✅ |
| LIB-11 | Overdue list, borrower history, summary counts | API | P2 | ✅ |
| LIB-12 | Send a reminder for a borrow record | API | P3 | 🐞 |
| LIB-13 | Books import and export | API | P2 | 🐞 |
| LIB-14 | Library settings: get and put | API | P3 | 🐞 |
| LIB-15 | Borrow records for a student from another organisation are not found | TENANT | P1 | ✅ |
| LIB-U01 | Add a book with copies from the UI | UI | P1 | 🐞 |
| LIB-U02 | Issue and return a book from the UI | UI | P1 | ✅ |
| LIB-U03 | Overdue view and fine collection | UI | P2 | 🐞 |

## 12. Inventory (`/inventory`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| INV-01 | Category: create and list | API | P2 | ⬜ |
| INV-02 | Item: create with category, unit, reorder level; duplicate code returns 409 | API | P1 | ⬜ |
| INV-03 | Update storage location, reorder level, default supplier; discontinue an item | API | P2 | ⬜ |
| INV-04 | Stock entry increases the balance | API | P1 | ⬜ |
| INV-05 | Stock issue decreases the balance; issuing more than available is rejected | API | P1 | ⬜ |
| INV-06 | Stock adjustment (positive and negative) with a reason | API | P2 | ⬜ |
| INV-07 | Stock transfer between campuses: source decreases, destination increases, atomically | API | P1 | ⬜ |
| INV-08 | Balance never goes negative under concurrent issues | API | P1 | ⬜ |
| INV-09 | Item balance needs `campusId`; low-stock list shows items under the reorder level | API | P1 | ⬜ |
| INV-10 | A discontinued item cannot receive new stock entries | API | P2 | ⬜ |
| INV-11 | Suppliers: create, list, deactivate | API | P2 | ⬜ |
| INV-12 | Customers: create, list, deactivate | API | P2 | ⬜ |
| INV-13 | Assets: register, assign to a person, change status; list needs `campusId` | API | P2 | ⬜ |
| INV-14 | Items import and export | API | P2 | ⬜ |
| INV-U01 | Create an item and receive stock from the UI | UI | P1 | ⬜ |
| INV-U02 | Low-stock banner appears when under the reorder level | UI | P2 | ⬜ |
| INV-U03 | Transfer stock between campuses from the UI | UI | P2 | ⬜ |

## 13. Purchase (`/purchase`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PUR-01 | Create a purchase order with lines for a supplier | API | P1 | ⬜ |
| PUR-02 | Submit then approve; approval needs the approver permission | API | P1 | ⬜ |
| PUR-03 | Invalid transitions (approve a draft, receive an unapproved order) are rejected | API | P1 | ⬜ |
| PUR-04 | Receive an approved order; stock entries are created and balances rise | E2E | P1 | ⬜ |
| PUR-05 | Partial receive keeps the order open with the right outstanding quantities | API | P1 | ⬜ |
| PUR-06 | Cancel an order; a received order cannot be cancelled | API | P2 | ⬜ |
| PUR-07 | Return part of a received line; stock decreases | API | P2 | ⬜ |
| PUR-08 | Order totals equal the sum of lines | API | P1 | ⬜ |
| PUR-U01 | Create a purchase order (supplier and item as preconditions) | UI | P1 | ⬜ |
| PUR-U02 | Approve and receive from the order page | UI | P1 | ⬜ |

## 14. Sales (`/sales`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| SAL-01 | Create a sale with lines; stock decreases | E2E | P1 | ⬜ |
| SAL-02 | Selling more than the stock is rejected | API | P1 | ⬜ |
| SAL-03 | Record a payment against a sale; partial and full | API | P1 | ⬜ |
| SAL-04 | Overpaying a sale is rejected | API | P1 | ⬜ |
| SAL-05 | Sale totals and tax equal the sum of lines | API | P1 | ⬜ |
| SAL-06 | List and get sales | API | P2 | ⬜ |
| SAL-U01 | Create a sale with a stock-entry precondition | UI | P1 | ⬜ |
| SAL-U02 | Record a payment from the sale page | UI | P2 | ⬜ |

## 15. HR (`/hr`, `/departments`, `/designations`, `/job-applications`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| HR-01 | Departments: create, list, deactivate | API | P2 | ⬜ |
| HR-02 | Designations: create, list, deactivate | API | P2 | ⬜ |
| HR-03 | Create a staff profile with a designation and department | API | P1 | ⬜ |
| HR-04 | Get a staff profile; list; staff export | API | P1 | ⬜ |
| HR-05 | Change staff status; transfer to another campus or department | API | P2 | ⬜ |
| HR-06 | Staff exit: record it; list exits; the staff member is no longer active | API | P1 | ⬜ |
| HR-07 | Salary structure: add with `basicAmount` and `effectiveFrom`; a new one closes the previous | API | P1 | ⬜ |
| HR-08 | Staff documents: upload, list, verify | API | P2 | ⬜ |
| HR-09 | Bank details: add and read back; the account number is masked in lists | API | P1 | ⬜ |
| HR-10 | Staff import (CSV and XLSX) with per-row results | API | P1 | ⬜ |
| HR-11 | Leave types: create and list | API | P2 | ⬜ |
| HR-12 | Leave balance: allocate per staff, type and year; read needs all three filters | API | P2 | ⬜ |
| HR-13 | Leave request: create; approve reduces the balance; reject and cancel do not | API | P1 | ⬜ |
| HR-14 | Leave request exceeding the balance is rejected | API | P1 | ⬜ |
| HR-15 | Overlapping leave requests for one person are rejected | API | P2 | ⬜ |
| HR-16 | Only a manager may approve; a staff member cannot approve their own leave | RBAC | P1 | ⬜ |
| HR-17 | Job application (public): submit for an organisation slug; approve creates staff; reject | API | P2 | ⬜ |
| HR-18 | Job-application subjects list needs `organisationSlug` | API | P3 | ⬜ |
| HR-U01 | Add a designation, then a staff member | UI | P1 | ⬜ |
| HR-U02 | Apply for, approve and reject leave in the UI | UI | P1 | ⬜ |
| HR-U03 | Staff profile tabs: documents, bank, salary | UI | P2 | ⬜ |

## 16. Payroll (`/payroll`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PAY-01 | Create salary components (EARNING and DEDUCTION; FLAT and PERCENT_OF_BASIC); invalid values return 400 | API | P1 | ⬜ |
| PAY-02 | Activate and deactivate a component | API | P2 | ⬜ |
| PAY-03 | Create a payroll run for a month and year; one run per month | API | P1 | ⬜ |
| PAY-04 | The run generates a payslip per active staff member with the right earnings and deductions | API | P1 | ⬜ |
| PAY-05 | Percent-of-basic components calculate correctly | API | P1 | ⬜ |
| PAY-06 | There is no leave proration, by design; unpaid leave does not change the amount | API | P2 | ⬜ |
| PAY-07 | Add a manual adjustment (needs `amount` and `type`) to a payslip; net pay updates | API | P1 | ⬜ |
| PAY-08 | Delete a payslip line in a draft run; recalculated totals | API | P2 | ⬜ |
| PAY-09 | Finalize a run; finalized payslips cannot be edited or deleted | API | P1 | ⬜ |
| PAY-10 | Correct a finalized run; the correction supersedes the original | API | P1 | ⬜ |
| PAY-11 | Delete a draft run; a finalized run cannot be deleted | API | P1 | ⬜ |
| PAY-12 | Month outside 1 to 12 returns 400 | API | P2 | ⬜ |
| PAY-13 | A staff member sees only their own payslips (`/me/payslips`) | RBAC | P1 | ⬜ |
| PAY-U01 | Run payroll for a month and review payslips | UI | P1 | ⬜ |
| PAY-U02 | Add an adjustment and finalize | UI | P2 | ⬜ |

## 17. Transport (`/transport`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| TRN-01 | Vehicles: create, list, change status; duplicate registration returns 409 | API | P1 | ⬜ |
| TRN-02 | Vehicle documents: upload, list, verify | API | P2 | ⬜ |
| TRN-03 | Assign crew (driver, attendant) to a vehicle | API | P2 | ⬜ |
| TRN-04 | Driver details: set and read for a person | API | P2 | ⬜ |
| TRN-05 | Routes: create, set vehicle, change status | API | P1 | ⬜ |
| TRN-06 | Stops: add in order; list returns them in sequence | API | P1 | ⬜ |
| TRN-07 | Assign a student to a route stop; capacity limit is enforced | API | P1 | ⬜ |
| TRN-08 | Reassign, add legs to, and end an assignment | API | P2 | ⬜ |
| TRN-09 | Lookups by vehicle, route and stop return the right students | API | P2 | ⬜ |
| TRN-10 | Trip log: create for a route and date, start, complete, cancel; invalid transitions are rejected | API | P1 | ⬜ |
| TRN-11 | Boarding: record and list for a trip | API | P1 | ⬜ |
| TRN-12 | Trip-log list needs `routeId` and `tripDate` | API | P3 | ⬜ |
| TRN-13 | Vehicles import and export | API | P2 | ⬜ |
| TRN-14 | A transport assignment creates the transport fee split on the student's fees | E2E | P1 | ⬜ |
| TRN-15 | No GPS live tracking in scope (deferred); verify no endpoint exists yet | API | P3 | ⬜ |
| TRN-U01 | Create a vehicle, route and stops from the UI | UI | P1 | ⬜ |
| TRN-U02 | Assign a student to a stop and see them on the route | UI | P1 | ⬜ |
| TRN-U03 | Run a trip and record boarding | UI | P2 | ⬜ |

## 18. Communication (`/announcements`, `/notifications`, `/notification-templates`, `/notification-preferences`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| COM-01 | Create an announcement as a draft, publish it, cancel another | API | P1 | ⬜ |
| COM-02 | Preview audience needs `audienceType` and returns the right count | API | P1 | ⬜ |
| COM-03 | A published announcement shows in `/me/announcements` for the targeted audience only | API | P1 | ⬜ |
| COM-04 | A cancelled or draft announcement is not shown to recipients | API | P1 | ⬜ |
| COM-05 | Publishing twice is rejected | API | P2 | ⬜ |
| COM-06 | Notification templates: create and list; placeholders are validated | API | P2 | ⬜ |
| COM-07 | Notifications for the caller: list, mark one read | API | P1 | ⬜ |
| COM-08 | A user cannot read or mark another user's notification | RBAC | P1 | ⬜ |
| COM-09 | Notification preferences: get and put, and the preferences are respected | API | P2 | ⬜ |
| COM-10 | Publishing an announcement creates in-app notifications for recipients | E2E | P2 | ⬜ |
| COM-U01 | Compose, preview audience, publish | UI | P1 | ⬜ |
| COM-U02 | Notification bell shows unread count and marks read | UI | P2 | ⬜ |
| COM-U03 | Preferences page saves choices | UI | P3 | ⬜ |

## 19. Messaging (`/messaging`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| MSG-01 | Start a direct thread with a person; a second call returns the same thread | API | P1 | ⬜ |
| MSG-02 | Start a class-group thread for a section | API | P2 | ⬜ |
| MSG-03 | Post a message; list messages in order | API | P1 | ⬜ |
| MSG-04 | Mark a thread read; unread count drops | API | P1 | ⬜ |
| MSG-05 | A non-participant cannot read or post in a thread | RBAC | P1 | ⬜ |
| MSG-06 | Empty or over-long message returns 400 | API | P2 | ⬜ |
| MSG-07 | Thread list shows only the caller's threads | API | P1 | ⬜ |
| MSG-08 | A guardian can message only their child's teachers, as designed | RBAC | P2 | ⬜ |
| MSG-U01 | Send and receive a message between two sessions | UI | P1 | ⬜ |
| MSG-U02 | Unread badge updates | UI | P3 | ⬜ |

## 20. Reporting (`/reports`, `/audit-logs`)

Specs: `tests/api/reporting/` (`reports`, `reports-access`, `audit-logs`) and `tests/ui/reporting/reports.ui.spec.ts`. The SQL-guard cases (RPT-08) and the per-view smoke runs (RPT-06) are table-driven, so one row covers several tests.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| RPT-01 | Seed standard reports; running it twice does not duplicate; they are published, declare their parameters, run, and do not cross organisations | API | P1 | ✅ |
| RPT-02 | Create a custom report; get, update, duplicate, publish, archive; archived reports cannot be edited; duplicate names are flagged | API | P2 | 🐞 |
| RPT-03 | Run a report and get rows that match the underlying data; parameters are bound; empty result; timeout; row limit is flagged; wrong-type and missing parameters | API | P1 | 🐞 |
| RPT-04 | Export returns the same rows as run, needs `REPORT_EXPORT`, and says when rows were left out | API | P2 | 🐞 |
| RPT-05 | Private to author; share to user or role; run-only vs edit shares; unknown principals rejected; archive stops sharees; `REPORT_VIEW` sees published reports | RBAC | P1 | 🐞 |
| RPT-06 | Reports use the read-only reporting database: application tables refused, ten curated views readable, database errors do not leak, module permissions are respected | API | P1 | 🐞 |
| RPT-07 | A report cannot expose another organisation's rows (including by assigning `@reporting_org_id`) | TENANT | P1 | 🐞 |
| RPT-08 | A malformed report definition returns 400, never a SQL error or 500 (18 SQL-guard cases, body, name, parameter type, duplicates) | API | P1 | 🐞 |
| RPT-09 | Audit log: list, page, filter by type, entity, actor and window, entity-types lookup; runs and exports are logged; definition changes and shares are logged | API | P2 | 🐞 |
| RPT-10 | Audit log is visible only to a role with `ORGANISATION_MANAGE`, and only for the caller's organisation | RBAC | P1 | ✅ |
| RPT-U01 | Run a report from the UI (columns, rows, parameters, empty, error) and export CSV (file name, header, quoting) | UI | P1 | 🐞 |
| RPT-U02 | Build a custom report in the UI; publish, archive, duplicate, edit and save | UI | P2 | 🐞 |
| RPT-U03 | Share from the report page; a sharee opens and runs it; run-only sharees are not offered edit actions | UI | P2 | 🐞 |
| RPT-U04 | Create and Seed buttons follow the person's permissions | UI | P2 | 🐞 |

## 21. Profile and self-service (`/me`, `/profile-change-requests`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ME-01 | `/me` returns the caller's profile and permissions | API | P1 | ⬜ |
| ME-02 | Staff: own leave types, balance, requests, payslips, sections | API | P1 | ⬜ |
| ME-03 | A staff member cannot read someone else's payslip by id | RBAC | P1 | ⬜ |
| ME-04 | Submit a profile change request; approve applies it; reject does not | API | P1 | ⬜ |
| ME-05 | Approving a change request needs the right permission | RBAC | P1 | ⬜ |
| ME-06 | Guardian: a child's fees, attendance, report cards, homework, materials, lesson plans, answer sheets, standing | API | P1 | ⬜ |
| ME-07 | A guardian gets 403 or 404 for a student who is not their child | RBAC | P1 | ⬜ |
| ME-08 | Guardian submits homework and takes a quiz for their child; second attempt is rejected | API | P2 | ⬜ |
| ME-09 | A guardian sees the child's data only after the guardian link is ACTIVE | API | P2 | ⬜ |
| ME-10 | Portal role routing: portal users land on the portal, not the staff app | UI | P1 | ⬜ |
| ME-U01 | Guardian portal home lists each child | UI | P1 | ⬜ |
| ME-U02 | Guardian views fees, attendance and report cards | UI | P1 | ⬜ |
| ME-U03 | Staff profile page: submit a change and see it pending | UI | P2 | ⬜ |
| ME-U04 | Staff applies for leave from the profile | UI | P2 | ⬜ |

## 22. Dashboard (`/dashboard`, `/academics/setup-status`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| DSH-01 | Summary returns counts that match the underlying lists (students, staff, fees due) | API | P1 | ⬜ |
| DSH-02 | Charts endpoint returns series for the current year and does not 500 | API | P1 | ⬜ |
| DSH-03 | Dismiss setup progress and quick actions; the preference is per user and persists | API | P2 | ⬜ |
| DSH-04 | The Roles setup step threshold is correct after roles are added | API | P2 | ⬜ |
| DSH-05 | Dashboard data respects the caller's permissions | RBAC | P1 | ⬜ |
| DSH-U01 | Dashboard renders cards and charts with no console errors | UI | P1 | ⬜ |
| DSH-U02 | Setup progress widget dismisses and stays dismissed after reload | UI | P2 | ⬜ |
| DSH-U03 | Quick actions open the right pages | UI | P2 | ⬜ |
| DSH-U04 | Desktop layout has no horizontal overflow and the main area scrolls | UI | P3 | ⬜ |

## 23. Settings and configuration (`/organisation`, `/custom-field-definitions`, `/document-templates`, `/id-card-templates`, `/timezones`, `/imports`, `/assets`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| SET-01 | Branding: get and put (name, colours, logo); the logo is served | API | P2 | ⬜ |
| SET-02 | External services: list, set properties; secrets are masked on read | API | P1 | ⬜ |
| SET-03 | Custom field definitions: create, update, deactivate | API | P1 | ⬜ |
| SET-04 | A custom field of each type validates input (required, type, options) | API | P1 | ⬜ |
| SET-05 | A custom field appears on the student form and its value round trips | E2E | P1 | ⬜ |
| SET-06 | Document template: get and put with the style CLASSIC, MODERN, MINIMAL or ELEGANT; invalid style returns 400 | API | P2 | ⬜ |
| SET-07 | ID-card templates: create, list, render for a student (needs `studentId`) | API | P2 | ⬜ |
| SET-08 | Timezones lookup returns IANA names | API | P3 | ⬜ |
| SET-09 | Import history lists past imports with counts | API | P2 | ⬜ |
| SET-10 | Asset upload: a valid image succeeds; wrong type, empty file and oversize file are rejected | API | P1 | ⬜ |
| SET-11 | Uploaded assets cannot be read by another organisation | TENANT | P1 | ⬜ |
| SET-12 | Module (feature-flag) switches hide the module from the nav and return 403 from its API | E2E | P1 | ⬜ |
| SET-13 | Starter-pack module selection and go-live check | E2E | P2 | ⬜ |
| SET-U01 | Branding change shows in the header | UI | P2 | ⬜ |
| SET-U02 | Create a custom field in Settings and see it on the form | UI | P1 | ⬜ |
| SET-U03 | Settings pages are hidden from roles without `ORGANISATION_MANAGE` | UI | P1 | ⬜ |
| SET-U04 | Dismissed onboarding widgets can be restored from Settings (future) | UI | P3 | ⬜ |

## 24. Compliance and data protection (`/consent-purposes`, `/consents`, `/data-subject-requests`, `/regulatory-export-schemas`, `/transfer-connector-jobs`, `/transfer-requests`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| CMP-01 | Consent purposes: create, edit, change status | API | P2 | ⬜ |
| CMP-02 | Record a consent for a person; current shows the latest, history shows all | API | P1 | ⬜ |
| CMP-03 | Withdrawing a consent is recorded and never deletes history | API | P1 | ⬜ |
| CMP-04 | Consent reads need `personId` | API | P3 | ⬜ |
| CMP-05 | Data-subject request: create, verify identity, complete, reject | API | P1 | ⬜ |
| CMP-06 | Completing a request before identity is verified is rejected | API | P1 | ⬜ |
| CMP-07 | Data export for a request contains the person's data and nothing else | API | P1 | ⬜ |
| CMP-08 | Regulatory export schemas: create, set fields, edit, change status | API | P2 | ⬜ |
| CMP-09 | Source-fields lookup needs `entityType` | API | P3 | ⬜ |
| CMP-10 | Run an export for a schema; columns match the schema fields | API | P1 | ⬜ |
| CMP-11 | Transfer-connector jobs: create, submit, re-prepare, fail, cancel; invalid transitions are rejected | API | P2 | ⬜ |
| CMP-12 | Compliance endpoints need their own permissions | RBAC | P1 | ⬜ |
| CMP-U01 | Record and view consent for a person | UI | P2 | ⬜ |
| CMP-U02 | Handle a data-subject request end to end | UI | P2 | ⬜ |

## 25. Platform administration (`/platform`, separate auth plane)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PLT-01 | Platform login; `/platform/auth/me` returns the admin | API | P1 | ⬜ |
| PLT-02 | A tenant token is rejected on `/platform/**`, and a platform token on tenant endpoints | RBAC | P1 | ⬜ |
| PLT-03 | Organisations: create, list, get, change status | API | P1 | ⬜ |
| PLT-04 | Plans: create, list, change status | API | P1 | ⬜ |
| PLT-05 | Subscriptions: create for an organisation; list; MRR is the sum of active plans | API | P1 | ⬜ |
| PLT-06 | Generate an invoice for an organisation; mark it paid; lists agree | API | P1 | ⬜ |
| PLT-07 | Modules: list, switch on and off per organisation, and read the change history | API | P1 | ⬜ |
| PLT-08 | Switching a module off blocks that module's tenant API with 403 | E2E | P1 | ⬜ |
| PLT-09 | External services per organisation: list and patch | API | P2 | ⬜ |
| PLT-10 | CRM leads: create, update, change stage, convert to an organisation | API | P1 | ⬜ |
| PLT-11 | Converting a lead twice is rejected | API | P1 | ⬜ |
| PLT-12 | CRM contacts: create, update, delete | API | P2 | ⬜ |
| PLT-13 | CRM activities: create with `type`; list by lead | API | P2 | ⬜ |
| PLT-14 | CRM tasks: create with `dueAt`, update, complete | API | P2 | ⬜ |
| PLT-15 | CRM metrics and admins lookups | API | P3 | ⬜ |
| PLT-16 | Support tickets: create, list, change status and assignee | API | P2 | ⬜ |
| PLT-17 | Platform settings, usage, system health, activity feed | API | P3 | ⬜ |
| PLT-18 | A platform admin's status change on an organisation writes an attributed audit entry | API | P2 | ⬜ |
| PLT-U01 | Platform admin signs in and provisions an organisation | UI | P1 | ⬜ |
| PLT-U02 | Create a plan and a subscription | UI | P1 | ⬜ |
| PLT-U03 | Lead pipeline: create, move through stages, convert | UI | P1 | ⬜ |
| PLT-U04 | Module switch page toggles a module and shows history | UI | P2 | ⬜ |

## 26. Webhooks (`/webhooks`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| WHK-01 | Razorpay webhook with a valid signature updates the payment; an invalid signature returns 401 or 400 | API | P1 | ⬜ |
| WHK-02 | Replaying the same Razorpay event is idempotent | API | P1 | ⬜ |
| WHK-03 | Brevo email, Brevo SMS and Resend email webhooks update delivery status | API | P2 | ⬜ |
| WHK-04 | Webhooks accept no user token and are not callable with a tenant token alone | API | P1 | ⬜ |
| WHK-05 | A malformed payload returns 400, never 500 | API | P2 | ⬜ |

---

## 27. Cross-cutting UI health

Run these across every page the UI suite visits. The `diagnostics` fixture already fails a
test on 5xx responses, failed requests and console errors.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| UIX-01 | No console errors on any page (known: dashboard alignItems/justifyContent warnings) | UI | P1 | 🐞 |
| UIX-02 | No failed or 5xx network calls on any page load | UI | P1 | ✅ |
| UIX-03 | Every sidebar link loads its page for the owner | UI | P1 | ⬜ |
| UIX-04 | Loading, empty and error states render for list pages | UI | P2 | ⬜ |
| UIX-05 | Forms show field-level validation and keep typed input after a server error | UI | P2 | ⬜ |
| UIX-06 | Browser back, forward and reload keep the user on the right page | UI | P3 | ⬜ |
| UIX-07 | Layout at tablet and phone widths: no horizontal overflow, menu collapses | UI | P3 | ⬜ |
| UIX-08 | Keyboard: tab order and Enter/Escape on dialogs | UI | P3 | ⬜ |
| UIX-09 | Accessibility scan (axe) finds no critical violations on the main pages | UI | P3 | ⬜ |
| UIX-10 | Dark and light theme both render readable text | UI | P3 | ⬜ |

## 28. End-to-end journeys (sanity and regression)

The sanity journey already runs 18 steps in 9 phases. These are the other journeys worth a
single long, step-structured spec each.

| ID | Journey | Priority | Status |
|---|---|---|---|
| E2E-01 | Owner: environment check, sign-in, set up academic structure, admit a student, set up and collect fees, access control, session, browser health (18 steps) | P1 | ✅ |
| E2E-02 | New institution owner: empty organisation to a fully set-up school, driven through the UI | P1 | ⬜ |
| E2E-03 | Admission to fees: public inquiry, review, convert, enrol, assign fees, generate invoice, pay | P1 | ⬜ |
| E2E-04 | Teacher day: log in, mark attendance, set homework, enter exam marks, send an announcement | P1 | ⬜ |
| E2E-05 | Exam cycle: create exam, schedule, enter marks, submit, approve, report cards, guardian views them | P1 | ⬜ |
| E2E-06 | Guardian: claim invite, see child, pay a fee through a payment link, read an announcement | P1 | ⬜ |
| E2E-07 | Procurement: supplier, item, purchase order, approve, receive, issue, sale | P2 | ⬜ |
| E2E-08 | HR and payroll: designation, staff, salary structure, leave approval, payroll run, finalize, payslip visible to staff | P2 | ⬜ |
| E2E-09 | Transport: vehicle, route, stops, assign a student, fee split, trip with boarding | P2 | ⬜ |
| E2E-10 | Library: add book, issue, return late, fine, pay | P2 | ⬜ |
| E2E-11 | Platform admin: lead to organisation, plan, subscription, invoice, module switch-off blocks tenant API | P1 | ⬜ |
| E2E-12 | Year rollover: close the year, create the next, promote students, copy forward structure | P1 | ⬜ |
| E2E-13 | Exit: student leaves, fees settled, attendance excluded, data export for the request | P2 | ⬜ |

---

## Known defects the failing scenarios document

These tests fail on purpose. Those listed in `src/known-defects.ts` (currently all Reporting ones, 5aw to 5bf; Attendance is 5bm to 5bt, Examinations 5bu to 5cb, Fees 5cc to 5cl, Learning 5cm to 5cq, Library 5cr to 5de) are expected failures and count as passed until Operion fixes the defect; the others still show as failed in the report.

4. Invalid enum query on `/students/search` returns 404 and leaks an internal class name. STU-08.
5. Claiming a staff invite accepts a one-character password (change-password and reset enforce 8+). AUTH-29.
5a. Resending an invite leaves the old invite link valid. AUTH-22.
5b. A disabled user or revoked membership can still refresh a session, and a disabled user's issued access token keeps working. AUTH-25, AUTH-26.
5c. An invalid session in the browser leaves the user on a page with every menu item disabled instead of returning to sign-in. AUTH-U09.
5d. **Critical:** any organisation owner can change any other organisation's status (suspend or archive a different tenant). ORG-07, ORG-12.
5e. Suspended and archived organisations can still sign in. ORG-07.
5f. Creating an organisation with a missing name, slug, admin email or password returns 409 instead of 400; slug format, admin password strength and admin email are not validated. ORG-03.
5g. Profile accepts a blank name or invalid contact email, and a partial PATCH nulls the fields it omits. ORG-05.
5h. Settings accept an unknown timezone, an invalid primary colour and out-of-range working-day masks. ORG-06, ORG-U05.
5i. An unknown organisation status returns 404 naming an internal class, and a missing status returns 500. ORG-07.
5j. A template item without a name returns 409 instead of 400. ORG-09.
5k. Roles: a blank name is accepted; an unknown permission code or invalid status returns 404 (the status error names an internal enum class) instead of 400. MEM-02, MEM-05, MEM-06.
5l. An inactive role can still be assigned to a member. MEM-06.
5m. The Owner role can be marked as a portal role, which would route the owner into the self-service portal. MEM-08.
5n. The organisation's only Owner user can be deactivated. MEM-14.
5o. Invite with no email returns 409 and with an invalid email is accepted; creating or updating a user accepts an invalid email, and creating a user accepts a one-character password. MEM-09, MEM-12.
5p. An invalid user status returns 404 naming an internal enum class; `POST /memberships` with an empty body returns 500. MEM-13, MEM-15.
5q. The Add member and Add role dialogs stay open on a server error but show it only on the page behind the modal, so the user sees nothing. MEM-U01, MEM-U02.
5r. The row-actions icon button on the Members table has no accessible name (not reachable by screen readers). Noted while building MEM-U01; no failing test.
5s. Academic years: an end date before the start date or a range overlapping another year is accepted; a closed year can be marked current again and still accepts new classes and enrolments; missing name or date returns 409 instead of 400. ACA-01, ACA-02, ACA-04.
5t. Campuses: a duplicate name, a blank name and an unknown timezone are accepted; a missing name returns 409 instead of 400. ACA-05.
5u. Grade levels: unknown stage and negative sequence order are accepted; a missing name returns 409; a partial PATCH returns 400 because it behaves like PUT; an invalid status returns 404 naming an internal enum class; an inactive grade level can still be used for a new class. ACA-06.
5v. Classes: a blank display name is accepted on update; a missing display name returns 409; an invalid status returns 404 naming an internal enum class; a class or section with enrolled students can be deactivated. ACA-07, ACA-09.
5w. Sections: a zero or negative capacity is accepted; a missing name returns 409. ACA-08.
5x. Subjects: a duplicate code is accepted through the API (the CSV import rejects it); a missing name returns 409; an invalid status returns 404 naming an enum class; an inactive subject can still be added to a class; an import with no file returns 500. ACA-10, ACA-11.
5y. Academic settings: an end time before the start time is accepted, a malformed time returns 500, and a partial PATCH wipes the fields it omits. ACA-14.
5z. Working calendar: a missing date returns 409, an unknown type returns 404 naming an enum class, a date outside the academic year and a second rule for the same date are accepted. ACA-15.
5aa. School events: `from` after `to` returns an empty list instead of 400; a missing title or date returns 409. ACA-16.
5ab. Timetable periods: an end time at or before the start time returns 409 instead of 400, and overlapping periods and a negative ordinal are accepted. ACA-17.
5ac. Teacher assignments: ending an assignment before it starts is accepted, a SUBJECT assignment with no subject is accepted, a missing start date returns 409, and an unknown assignment type returns 404 naming an enum class. ACA-23.
5ad. The timetable of an unknown section returns an empty list instead of 404. ACA-22.
5ae. **UI:** `DELETE /timetable-entries/{id}` and `DELETE /timetable/periods/{id}` return 200 with an empty body, but the web client only treats 204 as empty. The delete succeeds, yet the UI shows "Failed to clear slot" or "Failed to delete period" and leaves the stale row until reload. ACA-U03, ACA-U06.
5af. The Add class dialog stays open on a server error but shows it only on the page behind the modal. ACA-U01.
5ag. Students cannot be created in a second organisation once the first has issued `STU-2026-00001`: `students.uq_students_student_id` is unique across organisations (known as Operion #354). Academics enrolment scenarios therefore run in the shared organisation.
5ah. Student search: an inverted admission-date range returns 200 with an empty page; sorting by `firstName`, `lastName` or any unknown column returns 500; page size is silently capped at 2000. STU-09, STU-10.
5ai. A student can be admitted with an admission date in the year 2999. STU-01.
5aj. `PATCH /students/{id}` nulls any field it omits and replaces the whole custom-field map; a NUMBER custom field accepts "abc"; a missing required custom field returns 404 instead of 400/409. STU-13, STU-14.
5ak. Enrolment: a missing year, section or date returns 500; a section from a different academic year than the one named is accepted; reassigning to a section of another class is accepted. STU-16, STU-17.
5al. Guardian links: any omitted boolean makes the create and the update answer 400 "Malformed or invalid request body" (so a partial update is impossible); an unknown relationship returns 404 naming the enum class; a link can be updated through another student's URL. STU-19, STU-20.
5am. Documents: an unknown verification status returns 404 naming the enum; a document with no type, name or reference returns 409; a document can be verified through another student's URL. STU-22.
5an. Exits: an unknown type returns 404 naming the enum; a missing type or date returns 500; an exit date before the admission date is accepted; a withdrawn student who is enrolled again stays `WITHDRAWN`, and enrolling again in the same year is a bare 409. STU-23.
5ao. Transfers: a request to the student's own campus and an unknown status filter both return 404. STU-24.
5ap. Student import: an unsupported file type returns 404, a request with no file returns 500, and a duplicate admission number is reported with raw SQL text ("could not execute statement ... insert into students"). STU-25, STU-26.
5aq. Persons: `PATCH /persons/{id}` requires `lastName` (so partial patches and the 404 for an unknown id are masked by a 400); an unknown gender or a future date of birth is accepted; **any signed-in user, including one with no permissions, can create a person**. STU-28, STU-32.
5ar. **UI:** the students list ignores response order, so a slow unfiltered response arriving after a filtered one replaces the filtered rows (the box says one thing, the table shows another); the Imports & exports page logs React `justifyContent`/`alignItems` prop errors; read-only staff still see the Admit student button, the person Edit button, and can open `/students/new`. STU-U03, STU-U06, STU-U08.
5as. Applicants: the same person can apply twice, and a person who is already a student can apply; an inquiry date in 2999 and a 5000 character note are accepted; an unknown status filter returns 409. ADM-01, ADM-02, ADM-08.
5at. Convert: a future admission date and a negative entrance score are accepted; converting an applicant twice answers a bare "This record conflicts with an existing one"; the converted applicant carries no reference to the student it became. ADM-05, ADM-06, ADM-07.
5au. Documents checklist: an unknown document type returns 404; an entry with no type or no flag returns 500. ADM-09.
5av. **UI:** when approving fails (for example a duplicate admission number) the dialog closes and the error shows on the page behind it, so the typed details are lost. ADM-U02.
5bm. Student marking: an unknown status returns 404 naming the Java enum class; a missing date returns a bare 409; an enrolment that belongs to a different section is accepted into this section's register. ATT-02.
5bn. Marking has no date rules: a date outside the academic year (2000-01-01), a holiday in the working calendar, and a day before the student's enrolment date are all accepted. ATT-04, ATT-15.
5bo. Corrections: a missing reason returns a bare 409; an unknown status returns 404 naming the enum class; correcting to the status the entry already has is accepted. ATT-08.
5bp. Reads of unknown ids answer 200 with empty data instead of 404 (corrections of an unknown entry, range and summary of an unknown enrolment); a range with `from` after `to` answers 200 with an empty list. ATT-09, ATT-10, ATT-12.
5bq. The monthly summary with month 13 returns 500 "An unexpected error occurred". ATT-12.
5br. Staff attendance: a missing date returns a bare 409; an unknown status returns 404 naming the enum class; a check-out earlier than the check-in, a check-out for a record with no check-in, and a check-out with no time (stored as null) are all accepted. ATT-13, ATT-14.
5bs. **UI:** the API can unlock a register and list corrections, and has staff attendance endpoints, but the web app has no unlock action, no correction history and no staff attendance screen. ATT-U03, ATT-U05, ATT-U11.
5bt. **UI:** a user who may only view attendance is shown the marking form, Submit, Lock and Correct controls (the server then answers 403 when they are used). ATT-U13.
5bu. Grading scales: a blank name, no bands, no band at 0%, and minimums outside 0 to 100 are all accepted (a card then fails to publish later); duplicate minimums and a band with no grade return a bare 409; several scales can be the default at once. EXM-01, EXM-02.
5bv. Exams: a blank name is accepted; a missing academic year returns 500; an unknown type returns 404 naming the enum class. EXM-03.
5bw. Schedules: pass marks above max, zero or negative max, negative pass marks are accepted; a missing date or missing marks return a bare 409; a date outside the year, a class from another year and a section of another class are accepted; listing the schedules of an unknown exam answers 200 with an empty list. EXM-04, EXM-05.
5bx. Marks: marks above the maximum and negative marks are accepted on entry and on both correction routes; a present student without a mark returns 500; students from another class or section are accepted into a schedule's marks; the register of an unknown schedule answers 200 as a draft; submitting a register with nothing entered is accepted. EXM-06, EXM-08, EXM-09, EXM-10, EXM-16.
5by. Publishing a report card with a missing enrolment or grading scale returns 500. EXM-13.
5bz. Settings: an unknown strategy returns 404 naming the enum class; a missing strategy returns 500; a minimum aggregate outside 0 to 100 is accepted. EXM-18.
5ca. **UI:** when adding a schedule or publishing a report card fails, the dialog stays open and the error appears on the page behind it, where the user cannot see it. EXM-U01, EXM-U03.
5cb. **UI:** a user who may only view examinations is shown Add exam, Add grading scale, Add schedule, Publish report card, Submit marks, Approve and Correct (the server then answers 403). EXM-U08.
5aw. Reports: a rejected definition (unsafe or empty SQL), an unknown parameter type or share principal type, and a missing run parameter all answer 404 instead of 400; the enum cases name `com.operion...` classes. RPT-08, RPT-03, RPT-05.
5ax. Reports: creating with a missing field returns 500; running a report that has parameters with no `parameters` object returns 500; a blank name is accepted; an over-long name and duplicate parameter or column names answer a bare 409; two reports can share a name (the standard-report seed treats the name as identity). RPT-02, RPT-03, RPT-08.
5ay. **Critical:** any organisation can read another organisation's rows through a report: the views are filtered by `@reporting_org_id`, the SQL guard does not reject `:=`, so `SELECT ... FROM (SELECT @reporting_org_id := 1 AS o) x CROSS JOIN reporting_students s` run by a brand-new organisation's owner returned the shared organisation's students. RPT-07.
5az. SQL guard: `#` comments and `INTO OUTFILE` / `INTO DUMPFILE` are accepted at save time; valid read-only queries are refused for containing the words `Update`, `REPLACE()` or `set` (even inside a text value or alias). RPT-08.
5ba. Run errors expose database text verbatim (`SELECT command denied to user 'reporting_ro'@'localhost' for table 'users'`, column and table names, `Incorrect DATE value`); declared parameter types are not enforced (a bad date or number reaches the database); an undeclared `:placeholder` runs as NULL and returns 0 rows. RPT-03, RPT-06.
5bb. Run and export stop silently at 5000 rows with nothing in the response saying so. RPT-03, RPT-04.
5bc. Sharing: a user or role id that does not exist (or belongs to another organisation) is accepted; a share with neither run nor edit is accepted; an edit-only share lets the user change the report but not open it; a repeat share is a bare 409; archiving does not stop sharees running the report; there is no way to withdraw a share. RPT-05, RPT-07.
5bd. Reports bypass module permissions: with only `REPORT_CREATE` a user reads every student (including date of birth) and staff record through a report although the students API answers 403; `REPORT_VIEW` ("View operational/academic reports") is never checked, so the standard reports the seed publishes are visible only to whoever seeded them and to managers. RPT-05, RPT-06.
5be. Audit: only RUN and EXPORTED are logged (not create, edit, share, publish or archive, and not a failed or refused run); an unknown `sort` column returns 500; page size is not capped. RPT-09.
5bf. **UI:** the Create report and Share dialogs show server errors only on the page behind the modal; sharing from the page always ends in "Failed to share report" with the dialog still open although the share was saved (the endpoint returns 200 with an empty body, the web client only accepts 204: same cause as 5ae); a run-only sharee is still offered Publish, Archive, Save changes and Share; "Create report" is offered to people without `REPORT_CREATE`; run errors show raw database text. RPT-U01 to RPT-U04.
5cc. Fees status codes: every validation failure in the fee services answers 404 instead of 400: installments that do not sum to the amount, a structure with no installments, a group or assignment for a different class or year, a discount without a reason or approver, an approver who may not approve, an installment from another structure, a payment allocation that is empty or does not match the amount, a waiver above the outstanding balance and an adjustment below what is already paid. An unknown payment method answers 404 naming `com.operion.finance.PaymentMethod`. FEE-08, FEE-17, FEE-20, FEE-25, FEE-27, FEE-30, FEE-31, FEE-32.
5cd. Fees missing fields: a group without a name, duplicate installment numbers, and a waiver, adjustment or refund without a reason or approver return a bare 409; a structure without installments, an invoice request without an installment id, a payment without an amount or date, send-reminders without invoice ids, and a structure or opening-balance import without a file return 500. FEE-06, FEE-08, FEE-15, FEE-20, FEE-25, FEE-29, FEE-30, FEE-32, FEE-37, FEE-40.
5ce. Fee structures accept a negative or zero amount and a one-shot discount that is negative or larger than the amount. FEE-08, FEE-14.
5cf. Fee assignments: the same structure can be assigned to the same student twice; a discount that is negative or larger than the amount is accepted (the effective amount goes negative), also when added through a revision. Revision history itself is correct. FEE-17, FEE-18.
5cg. Payments: a zero, negative or far-future (2999) payment is accepted; a cheque without a bank name or number is accepted. FEE-25, FEE-27.
5ch. Refunds have no cap: a refund larger than the payment, cumulative refunds above it and a negative refund are all accepted; a refund can name an invoice the payment never paid and can be taken from a bounced payment; bouncing a partly refunded payment drives the invoice's amount paid to -400. FEE-28, FEE-29.
5ci. Waivers and adjustments accept zero or negative amounts; an opening-balance import accepts a negative balance and reports it VALID. FEE-30, FEE-32, FEE-40.
5cj. `FEE_DISCOUNT_APPROVE` is never checked: a fees collector without it can grant discounts and waivers. FEE-31.
5ck. Reminders are sent for invoices that are already paid. FEE-37.
5cl. **UI:** fee dialogs (assign with a discount but no approver, a duplicate invoice, a refund above the payment, a waiver above the balance, a proof file of the wrong type) show the server error only on the page behind the modal; a user with exactly the fees-collector permissions cannot use /fees because the page demands `CLASS_VIEW`; /fees/setup is not permission-gated (the collector is offered Add category); a view-only user is offered Assign fee, Record payment and Generate invoice. FEE-U02, FEE-U03, FEE-U05, FEE-U06, FEE-U07.
5cm. Learning validation failures answer 404 instead of 400 throughout: homework with a blank title or no due date; a quiz with a blank title or a closing time before its opening; a question (in a quiz or the bank) with no or two correct options, fewer than 2 or more than 6 options, a blank option, zero marks or blank text; a FILE material without an attachment, a LINK without a valid http(s) url, a NOTE without text, a blank title; a lesson plan with a blank title or no date, a rejection without a note, a calendar range that ends before it starts; a reward outside 1 to 100 points or without a title; an empty homework submission; a quiz answer whose option belongs to another question; an answer-sheet upload with no pages or for a student outside the schedule's class; marks outside 0 to the maximum and annotations off the page or on a missing page. LRN-03, LRN-04, LRN-06, LRN-08, LRN-10 to LRN-13, LRN-15, LRN-16.
5cn. Homework without a section or subject returns 500; homework for a subject the class does not take is accepted. LRN-03.
5co. Create and publish responses report stale counts: a new homework says 0 enrolled, and a just-published quiz says 0 questions and 0 marks (the list endpoints are right). LRN-03, LRN-06.
5cp. A quiz attempt that answers the same question twice is accepted. LRN-08.
5cq. **UI:** a view-only user (`LEARNING_VIEW`) is offered Grant reward on the leaderboard (the server then answers 403). LRN-U01.
5cr. A book can be added without a title: the server answers 409 "This record conflicts with an existing one" instead of 400. LIB-01.
5cs. A second book with an ISBN already in the catalogue is accepted (the CSV import does treat it as a duplicate). LIB-01.
5ct. A book can be withdrawn while one of its copies is on loan. LIB-01.
5cu. A copy with no accession number gives 409 "conflicts with an existing one", and a copy with no campus gives 500. Both should be 400. LIB-02.
5cv. A copy of a withdrawn book can still be issued. LIB-04.
5cw. A borrow record with a due date before the borrowed date is accepted. LIB-04.
5cx. A return dated before the book was borrowed is accepted. LIB-06.
5cy. A late return raises no overdue fine, and the overdue list's `fineDue` is always 0. There is no fine rate setting at all, so "a late return creates a fine using the configured rate" cannot happen. LIB-07, LIB-U03.
5cz. Fines accept a zero or negative amount. A missing amount gives 409 "conflicts", and an unknown reason gives 404 naming the Java enum (`No enum constant com.operion.library.FineReason...`). All should be 400. LIB-09.
5da. A fine can be waived with no reason and with a `waivedBy` person who does not exist. LIB-09.
5db. A reminder is sent (count 1) for a borrow record that has already been returned. LIB-12.
5dc. A books import with no file attached gives 500 instead of 400. LIB-13.
5dd. Library settings accept a negative loan limit and a zero borrowing period. LIB-14.
5de. **UI:** a view-only user (`LIBRARY_VIEW`) is offered Add book, Issue book, Return, Mark lost and the settings Save button (the server then answers 403). The library screens have no permission checks at all. LIB-U01.
8. Dashboard React console errors for alignItems/justifyContent (intermittent). UIX-01.
5cn. **UI:** the dashboard logs React "unknown prop" console errors (`alignItems`, `justifyContent`) because `SetupProgress.tsx:66` and `QuickActions.tsx:79` pass them straight to MUI 9 `Stack`, which no longer supports system props (same pattern in `ImportsExportsPanel.tsx:44`, `ImportWorkflowDialog.tsx:159`, `ImportHistoryDialog.tsx:41`); they belong in `sx`. Caught by sanity phase 01 "Browser health". **Fixed 2026-10-12** in the Operion working tree (props moved into `sx`), uncommitted.
5co. **UX:** the "Claim link" in the Staff invite issued dialog (`StaffInviteDialog.tsx`) carries only `?token=`, not `&org=<slug>`, although the claim page reads `org` from the URL; a new hire opening the link must know and type the school slug. Found by sanity phase 04 (the test types it).

## Suggested build order

1. Standard matrix (section 0) as one table-driven spec per module. It reaches every endpoint for little effort.
2. Attendance, Examinations, Academics: they sit directly after the student and fee flow.
3. Members and Settings: they unlock role-based scenarios for every other module.
4. Learning, HR, Payroll, Transport, Library, Inventory, Purchase, Sales.
5. Platform, Compliance, Webhooks.
6. Journeys E2E-02 to E2E-13 once their modules have page objects.
5cp. **Fixed (Operion `FeeStructuresPanel.tsx`):** the Fee structures "Class" picker listed every class of every year as "Class #<id>" (template classes have no display name and exist once per campus), so no one could tell Grade 1 at Main Campus from any other; and the suggested structure name was always blank (the select returns numeric ids, compared to strings). Now classes are filtered to the chosen year and labelled "<grade> · <campus>", and the name is suggested. Found by sanity phase 05.
5cq. **UX:** the sidebar Fees item stays disabled ("Add students first") until students exist, although fee structures are set up before admissions; the owner reaches fee setup only through the dashboard guide's Fees step. Found by sanity phase 05.
