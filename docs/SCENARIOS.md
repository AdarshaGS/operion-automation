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

**Totals (as of 2026-10-15):** 546 scenarios in the original matrix (25 module sections, UI health, 13 journeys); the row statuses in the module sections below are kept current, so count the ✅ and 🐞 marks rather than trusting an older total. The suite now registers 2,480 API and UI tests (1,976 API + 504 UI, plus 8 sanity journeys run separately). The last full API+UI run, on a freshly seeded database (22.0 minutes, 4 workers): 1,959 passed, 517 failed, 3 skipped, 1 did not run, and 1 error outside any test that was not identified. Every failing test asserts correct behaviour and is red for a defect listed under Known defects; that was checked test by test for Imports & exports, HR, Payroll, Profile, Inventory, Purchase, Sales, Dashboard and Settings, and was not re-checked in this run for the earlier modules (Auth, Students, Fees, Academics, Attendance, Examinations, Library, Learning, Members, Admissions, Organisation, Reports). Some reds depend on what the shared database holds (for example 5eu, 5ev, 5ez and 5fm only appear after other specs have written refunds or left Communication off).

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
| ACA-27 | Timetable rules: a new organisation has no gap and no limits; rules can be set and cleared; a negative or missing gap returns 400 | API | P1 | ✅ |
| ACA-28 | Minimum gap between class periods: a period that starts too soon returns 409; breaks are exempt; raising the gap leaves existing periods alone | API | P1 | ✅ |
| ACA-29 | Special slots: stored as SPECIAL, listed with their type, cannot hold a lesson; an unknown type returns 400; a period holding lessons cannot become special | API | P1 | ✅ |
| ACA-30 | Teacher workload: the per-day and per-week limits refuse the slot that would exceed them; replacing a slot is not counted twice | API | P1 | ✅ |
| ACA-31 | Weekly subject quotas: set, kept when omitted, cleared with 0; a quota caps placement; the section summary shows placed, remaining and the unplaced total; unknown section returns 404 | API | P1 | ✅ |
| ACA-32 | Rooms: create, rename, delete, duplicate or blank name rejected; a slot carries its room; a room cannot host two sections at overlapping times; a room in use cannot be deleted; an inactive room takes no new slots | API | P1 | ✅ |
| ACA-33 | Teacher unavailability: a blocked period or day refuses that teacher; removing the block frees them; duplicate, break period, unknown day and unknown id are rejected | API | P1 | ✅ |
| ACA-34 | Draft and publish: nothing to publish returns 409; publish and unpublish; publish the year (counts only drafts with slots); edits to a published timetable go live, generating over it is refused | API | P1 | ✅ |
| ACA-35 | Auto-generated draft: fills each quota, leaves placed slots, is repeatable, reports shortfalls with a reason, honours unavailability, reports a missing teacher, covers the year and skips published sections | API | P1 | ✅ |
| ACA-36 | Substitutions: needs list with free colleagues, assign, change, remove; refused for the wrong weekday, a date outside the year, the slot's own teacher, a busy, blocked or (approved) on-leave colleague; the weekly timetable is untouched | API | P1 | ✅ |
| ACA-37 | Portal views: a teacher sees their own published slots and the cover they give; a guardian sees only a published timetable of their own child; drafts return periods without slots; anonymous is 401 | API | P1 | ✅ |
| ACA-38 | CSV export of a section and of a teacher: text/csv attachment, periods as rows; a user without timetable access gets 403 | API | P2 | ✅ |
| ACA-39 | Period templates (school days): create, rename, delete, duplicates rejected; a class follows only its day's periods; teacher clashes are by clock time across days; in-use or non-empty days cannot be deleted; a class with slots cannot change day | API | P1 | ✅ |
| ACA-40 | The new timetable writes need TIMETABLE_MANAGE (11 writes x 2 roles); TIMETABLE_VIEW alone reads but cannot change; no permission is 403; anonymous is 401 | RBAC | P1 | ✅ |
| ACA-41 | Another organisation cannot see, change, publish, generate for, export, cover or book the rooms, school days, blocks, rules and entries of this organisation | TENANT | P1 | ✅ |
| ACA-U01 | Create a class, then a section, from the Academics screens | UI | P1 | 🐞 |
| ACA-U02 | Academic year switcher in the top bar changes the selected year | UI | P2 | ✅ |
| ACA-U03 | Timetable grid: place a subject and teacher in a cell and see it persist after reload | UI | P1 | 🐞 |
| ACA-U04 | A clash shows an inline error and does not save | UI | P1 | ✅ |
| ACA-U05 | Working calendar and school events render on the calendar view | UI | P3 | ✅ |
| ACA-U06 | Periods tab: add, edit and delete a period; an invalid time range shows its error inside the dialog | UI | P2 | 🐞 |
| ACA-U07 | Periods tab: set the minimum gap, a too-close class period is refused in the dialog, special slot and break chosen from the Kind select, a second school day with its own periods | UI | P1 | ✅ |
| ACA-U08 | Rooms tab: add a room, a duplicate name shows the error in the dialog, make a room inactive | UI | P2 | ✅ |
| ACA-U09 | Section timetable: quota chips, generate a draft (and the shortfall message), publish, export CSV, unpublish, book a room and see a room clash in the dialog, change the class's school day | UI | P1 | ✅ |
| ACA-U10 | Substitutions tab: find an absent teacher's slots, assign a free colleague, remove the cover; a teacher with no slots gets a plain message | UI | P1 | ✅ |
| ACA-U11 | Staff page: block a day and a period, the grid then refuses that slot; removing the block frees it | UI | P2 | ✅ |
| ACA-U12 | Portals: a teacher sees their published week (nothing from a draft); a guardian sees a published class timetable and the unpublished notice before | UI | P1 | ✅ |
| ACA-U13 | Class page: set a subject's weekly periods from its Edit dialog and the section's quota chips follow; book a room on a slot that is already placed | UI | P2 | ✅ |

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
| ATT-16 | Permissions: view-only can read but not mark, submit, lock, unlock or correct; each of mark, lock, unlock and correct is its own permission; no permission is 403; anonymous is 401. Mark/submit accept ATTENDANCE_MARK (own homeroom sections) or ATTENDANCE_MARK_ANY_SECTION | RBAC | P2 | ✅ |
| ATT-30 | Teacher-scoped: a class (HOMEROOM) teacher with ATTENDANCE_MARK marks and submits their own section | RBAC | P1 | ✅ |
| ATT-31 | Teacher-scoped: a class teacher cannot mark a section they are not class teacher of (403) | RBAC | P1 | ✅ |
| ATT-32 | Teacher-scoped: a class teacher cannot submit another section's register (403) | RBAC | P1 | ✅ |
| ATT-33 | Teacher-scoped: a SUBJECT-only teacher with ATTENDANCE_MARK cannot mark the section | RBAC | P1 | ✅ |
| ATT-34 | ATTENDANCE_MARK_ANY_SECTION marks any section with no teacher assignment | RBAC | P1 | ✅ |
| ATT-35 | GET /attendance/markable-sections: OWN with homeroom section+class, NONE without mark permission, ALL for the Owner | API | P1 | ✅ |
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
| ATT-U30 | Class teacher: quick-mark screen offers only their own class and section; marking it works | UI | P1 | ✅ |
| ATT-U31 | A teacher who is class teacher of nothing is told so on the quick-mark screen | UI | P2 | ✅ |
| ATT-U32 | Class teacher opening another section's register sees it read-only with a class-teacher notice; their own section is markable | UI | P1 | ✅ |
| ATT-U33 | An office user with ATTENDANCE_MARK_ANY_SECTION can mark any section from the register | UI | P1 | ✅ |

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
| RCP-01 | One report card as a PDF: one page, named after student and exam, reprintable; unknown card 404; no EXAM_VIEW 403; a card under correction prints PROVISIONAL and a superseded one prints SUPERSEDED | API | P1 | ✅ |
| RCP-02 | A whole section as one PDF, one page per published card, unpublished students left out; a section with none is refused | API | P1 | ✅ |
| RCP-03 | A guardian downloads their own child's published card; another student's card (directly or through their own child's URL) and a card under correction are 403 | API | P1 | ✅ |
| RCP-U01 | Exam page > Report cards: Download PDF after publishing; section picker downloads the whole section; an empty section shows why | UI | P1 | ✅ |
| RCP-U02 | The print view has Download PDF next to Print | UI | P2 | ✅ |
| RCP-U03 | Parent portal Exam results: each row has Download PDF | UI | P1 | ✅ |

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
| FEE-U08 | Payment history Receipt button downloads the PDF receipt (number, student, fee head, amount in figures and words, reference, balance); the second office print says DUPLICATE COPY 2 | UI | P1 | ✅ |
| FEE-U09 | Download receipt in the Payment recorded dialog gives the receipt just recorded, with the remaining balance | UI | P1 | ✅ |
| FEE-U10 | A bounced cheque's receipt still downloads, marked CANCELLED - PAYMENT BOUNCED | UI | P1 | ✅ |
| FEE-U11 | Settings > Letter formats offers the 80 mm thermal roll for the fee receipt only (server rejects it for other documents); receipts then print 80 mm wide | UI | P2 | ✅ |
| FEE-U12 | Parent portal lists the child's payments and downloads receipts that never count as office prints; a payment that also covers another family's child is hidden and its receipt is 403 | UI | P1 | ✅ |

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
| INV-01 | Category: create and list | API | P2 | 🐞 |
| INV-02 | Item: create with category, unit, reorder level; duplicate code returns 409 | API | P1 | 🐞 |
| INV-03 | Update storage location, reorder level, default supplier; discontinue an item | API | P2 | 🐞 |
| INV-04 | Stock entry increases the balance | API | P1 | 🐞 |
| INV-05 | Stock issue decreases the balance; issuing more than available is rejected | API | P1 | 🐞 |
| INV-06 | Stock adjustment (positive and negative) with a reason | API | P2 | 🐞 |
| INV-07 | Stock transfer between campuses: source decreases, destination increases, atomically | API | P1 | 🐞 |
| INV-08 | Balance never goes negative under concurrent issues | API | P1 | 🐞 |
| INV-09 | Item balance needs `campusId`; low-stock list shows items under the reorder level | API | P1 | ✅ |
| INV-10 | A discontinued item cannot receive new stock entries | API | P2 | 🐞 |
| INV-11 | Suppliers: create, list, deactivate | API | P2 | 🐞 |
| INV-12 | Customers: create, list, deactivate | API | P2 | 🐞 |
| INV-13 | Assets: register, assign to a person, change status; list needs `campusId` | API | P2 | 🐞 |
| INV-14 | Items import and export | API | P2 | ✅ |
| INV-U01 | Create an item and receive stock from the UI | UI | P1 | 🐞 |
| INV-U02 | Low-stock banner appears when under the reorder level | UI | P2 | ✅ |
| INV-U03 | Transfer stock between campuses from the UI | UI | P2 | ✅ |

## 13. Purchase (`/purchase`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PUR-01 | Create an order with lines; validation of lines, quantities, costs, dates, supplier, campus; inactive supplier and discontinued item refused | API | P1 | 🐞 |
| PUR-02 | Status machine DRAFT → SUBMITTED → APPROVED; cancel from DRAFT, SUBMITTED, APPROVED; out-of-order moves and cancel after receiving return 409 | API | P1 | ✅ |
| PUR-03 | Receive goods: partial and full, stock added at the ordered or a different cost, several lines, over-receive 409, atomic on a bad line, empty or zero receipts, a line from another order, simultaneous receipts | API | P1 | 🐞 |
| PUR-04 | Returns to the supplier: stock removed, repeated returns up to the received quantity, over-return and issued stock refused, reasons validated | API | P2 | 🐞 |
| PUR-05 | Permissions (401, no PURCHASE_VIEW, viewer, manager) and tenancy (another organisation's orders, lines, suppliers and campuses) | API | P1 | ✅ |
| PUR-U01 | New purchase order dialog: create with two lines, Create disabled until complete, add/remove line, inactive supplier not offered, unknown order page | UI | P1 | ✅ |
| PUR-U02 | Order page: submit, approve, receive in two goes, return, cancel from each stage, receive and return errors shown, stale action | UI | P1 | 🐞 |
| PUR-U03 | Access: a viewer is offered no write actions; a member with no permission is not shown an empty list | UI | P2 | 🐞 |

## 14. Sales (`/sales`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| SAL-01 | Create a sale: lines, total, receipt number, stock issued against the customer; validation; inactive customer and discontinued item refused | API | P1 | 🐞 |
| SAL-02 | Stock limits: oversell 409, whole balance sellable, atomic across lines, other campus, ten simultaneous sales | API | P1 | ✅ |
| SAL-03 | Payments: partial then full, every method, overpayment and a PAID sale refused, validation, simultaneous payments | API | P1 | 🐞 |
| SAL-04 | List and filter by customer, empty and unknown customer, paid amount and status on rows | API | P2 | ✅ |
| SAL-05 | Receipt numbers: start at RCT-000001 per organisation, increase by one, unique under concurrency, not used by a rejected sale | API | P1 | ✅ |
| SAL-06 | Permissions (401, no SALES_VIEW, viewer, manager) and tenancy (another organisation's sales, customers, items, campuses) | API | P1 | ✅ |
| SAL-U01 | New sale dialog: create with two lines, live total, Complete sale disabled until complete, inactive customer not offered, oversell reason shown | UI | P1 | 🐞 |
| SAL-U02 | Receipt page: lines and totals, part then full payment, suggested amount, overpayment and zero payment refused, print and back, unknown receipt | UI | P1 | 🐞 |
| SAL-U03 | Customer history from Inventory > Customers: that customer's sales only, status, open a receipt, empty and unknown customer | UI | P2 | ✅ |
| SAL-U04 | Access: a viewer is offered no write actions; a member with no permission is not shown an empty list | UI | P2 | 🐞 |

## 15. HR (`/hr`, `/departments`, `/designations`, `/job-applications`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| HR-01 | Departments: create, list, deactivate | API | P2 | 🐞 |
| HR-02 | Designations: create, list, deactivate | API | P2 | 🐞 |
| HR-03 | Create a staff profile with a designation and department | API | P1 | 🐞 |
| HR-04 | Get a staff profile; list; staff export | API | P1 | ✅ |
| HR-05 | Change staff status; transfer to another campus or department | API | P2 | 🐞 |
| HR-06 | Staff exit: record it; list exits; the staff member is no longer active | API | P1 | 🐞 |
| HR-07 | Salary structure: add with `basicAmount` and `effectiveFrom`; a new one closes the previous | API | P1 | 🐞 |
| HR-08 | Staff documents: upload, list, verify | API | P2 | 🐞 |
| HR-09 | Bank details: add and read back; the account number is masked in lists | API | P1 | 🐞 |
| HR-10 | Staff import (CSV and XLSX) with per-row results (covered in section 29, IMP-20) | API | P1 | ✅ |
| HR-11 | Leave types: create and list | API | P2 | 🐞 |
| HR-12 | Leave balance: allocate per staff, type and year; read needs all three filters | API | P2 | 🐞 |
| HR-13 | Leave request: create; approve reduces the balance; reject and cancel do not | API | P1 | 🐞 |
| HR-14 | Leave request exceeding the balance is rejected | API | P1 | ✅ |
| HR-15 | Overlapping leave requests for one person are rejected | API | P2 | 🐞 |
| HR-16 | Only a manager may approve; a staff member cannot approve their own leave | RBAC | P1 | 🐞 |
| HR-17 | Job application (public): submit for an organisation slug; approve creates staff; reject | API | P2 | 🐞 |
| HR-18 | Job-application subjects list needs `organisationSlug` | API | P3 | ✅ |
| HR-19 | Calendar days (`GET /api/v1/calendar/days`): weekly off, declared holidays with labels, campus-only holidays, special working days; `to` before `from` and ranges over 400 days are 400; any signed-in user may read | API | P1 | ⬜ |
| HR-20 | Leave counts working days only: a request may not ask for more days than the range has once holidays and weekly offs are removed; an all-off range is refused; a special working day makes a weekly-off day valid | API | P1 | ⬜ |
| HR-21 | Approving leave marks LEAVE attendance only on working days, not on a holiday inside the range | API | P2 | ⬜ |
| HR-U00 | The HR page: four panels, empty states, Add staff; the staff list opens a profile and drops staff who have left | UI | P1 | ✅ |
| HR-U01 | Leave types: add (dialog, required fields, duplicate code shows the server's message in the dialog); adding a staff member through the form is the sanity 04 journey | UI | P1 | 🐞 |
| HR-U02 | Leave in the UI: allocate and check a balance, raise, approve, reject, cancel, an over-balance approval, the inbox, and the approver recorded | UI | P1 | 🐞 |
| HR-U03 | Staff profile: status, transfer, exit, bank details (saved, masked), documents (add, verify, reject, expiry chip). Salary structure belongs to Payroll | UI | P2 | 🐞 |
| HR-U04 | Pending job applications inbox: a submitted application appears and can be approved or rejected | UI | P2 | 🐞 |
| HR-U05 | Access: view-only staff are offered no change buttons; a user without HR_VIEW is told so rather than shown an empty HR page | UI | P1 | 🐞 |
| HR-U08 | Raise-request dialog shows the working-day hint (names the holidays not counted), pre-fills the number of days, keeps a number the person typed until the dates change, and warns when the whole range is a day off | UI | P1 | ⬜ |
| HR-U09 | `/hr` shows "Upcoming holidays (next 60 days)": a holiday chip with its name, no weekly offs, and an empty-state line | UI | P2 | ⬜ |

## 16. Payroll (`/payroll`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PAY-01 | Create salary components (EARNING and DEDUCTION; FLAT and PERCENT_OF_BASIC); invalid values return 400 | API | P1 | ✅ |
| PAY-02 | Activate and deactivate a component | API | P2 | ✅ |
| PAY-03 | Create a payroll run for a month and year; one run per month | API | P1 | ✅ |
| PAY-04 | The run generates a payslip per active staff member with the right earnings and deductions | API | P1 | ✅ |
| PAY-05 | Percent-of-basic components calculate correctly | API | P1 | ✅ |
| PAY-06 | There is no leave proration, by design; unpaid leave does not change the amount | API | P2 | ✅ |
| PAY-07 | Add a manual adjustment (needs `amount` and `type`) to a payslip; net pay updates; a negative amount returns 400 | API | P1 | 🐞 |
| PAY-08 | Delete a payslip line in a draft run; recalculated totals | API | P2 | ✅ |
| PAY-09 | Finalize a run; finalized payslips cannot be edited or deleted | API | P1 | ✅ |
| PAY-10 | Correct a finalized run; the correction supersedes the original | API | P1 | ✅ |
| PAY-11 | Delete a draft run; a finalized run cannot be deleted | API | P1 | ✅ |
| PAY-12 | Month outside 1 to 12 returns 400 | API | P2 | ✅ |
| PAY-13 | A staff member sees only their own payslips (`/me/payslips`) | RBAC | P1 | ✅ |
| PAY-U01 | Salary components tab: add (earning/deduction, flat/percent), deactivate and activate, duplicate name shows an error, empty state; a user without payroll permissions is not offered the forms or told "No payroll runs yet" | UI | P1 | 🐞 |
| PAY-U02 | Payroll runs tab: empty state, Generate run opens the DRAFT with totals and payslips, the runs list, a duplicate month and an out-of-range year show an error, a run with no salaried staff | UI | P1 | ✅ |
| PAY-U03 | Run page: Finalize run locks it, Discard draft returns to the list, Start correction run opens a correction DRAFT, a negative-net payslip is flagged and blocks Finalize | UI | P1 | 🐞 |
| PAY-U04 | Payslip page: earnings, deductions and net pay, add and remove an adjustment on a draft, a negative amount is refused, a finalized payslip is read-only, run rows link to payslips | UI | P2 | ✅ |
| HR-U07 | Salary structure panel on a staff profile: empty note, save a version (basic and components), a raise becomes the latest, a version not after the latest shows an error, the staff member joins the next run | UI | P1 | ✅ |

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
| COM-11 | A scheduled announcement due on a day off (weekly off or holiday) stays a draft unless `sendOnNonWorkingDays` is set; it publishes once the day is a working day (waits on the ~60 s publisher job) | E2E | P1 | ⬜ |
| COM-12 | `sendOnNonWorkingDays` defaults to false and is returned on create and in the draft list; publishing by hand is never held back by a day off | API | P1 | ⬜ |
| COM-U01 | Compose, preview audience, publish | UI | P1 | ⬜ |
| COM-U02 | Notification bell shows unread count and marks read | UI | P2 | ⬜ |
| COM-U03 | Preferences page saves choices | UI | P3 | ⬜ |
| COM-U04 | Scheduling for a holiday shows the "held until the next working day" notice and the "Send on that day anyway" option; the saved draft carries the "Sends even on a day off" chip | UI | P1 | ⬜ |

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
| RPT-20 | Ready-made "Fee collection register" and "Fee collection summary": cleared receipts in a date range with student, class, fee head, method, amount, collector; bounced cheques and out-of-range receipts left out; summary totals by method and fee head | API | P1 | ✅ |
| RPT-21 | Ready-made "Fee defaulters": overdue outstanding per student as on a date (amount, invoices, oldest due date, days overdue); not-yet-due and paid invoices left out | API | P1 | ✅ |
| RPT-22 | Ready-made "Attendance percentage by student": present + late, half day as half, leave excluded; matches the monthly summary; only days in range | API | P1 | ✅ |
| RPT-23 | Ready-made "Exam results by section" (published cards, total, %, grade, result, rank order) and "Subject-wise marks" (student x subject, pass/fail/absent, draft vs approved) | API | P1 | ✅ |
| RPT-U01 | Run a report from the UI (columns, rows, parameters, empty, error) and export CSV (file name, header, quoting) | UI | P1 | 🐞 |
| RPT-U02 | Build a custom report in the UI; publish, archive, duplicate, edit and save | UI | P2 | 🐞 |
| RPT-U03 | Share from the report page; a sharee opens and runs it; run-only sharees are not offered edit actions | UI | P2 | 🐞 |
| RPT-U04 | Create and Seed buttons follow the person's permissions | UI | P2 | 🐞 |
| RPT-U20 | Fee defaulters and Fee collection register run from the Reports screen and show the student / receipt; defaulters export as CSV | UI | P1 | ✅ |
| RPT-U21 | Attendance percentage runs from the screen with a date range | UI | P1 | ✅ |
| RPT-U22 | Exam results by section runs for a typed exam name | UI | P1 | ✅ |

## 21. Profile and self-service (`/me`, `/profile-change-requests`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| ME-01 | `/me` reports ADMIN or PORTAL with GUARDIAN and TEACHER contexts (children listed); a parent who claimed an invite is a PORTAL session | API | P1 | 🐞 |
| ME-02 | Teacher: own sections, leave types, balance (allocated and remaining), raise and list own leave; no staff profile is 403; invalid dates and days return 400 | API | P1 | ✅ |
| ME-03 | A staff member sees only their own finalized payslips and cannot read someone else's by id (covered by PAY-13 in `tests/api/payroll`) | RBAC | P1 | ✅ |
| ME-04 | Submit a profile change request (own, validated); approve applies only the requested fields; reject does not; decided requests are final; inbox filter | API | P1 | 🐞 |
| ME-05 | Approving or rejecting needs `PROFILE_CHANGE_MANAGE`; a manager cannot decide their own request; other organisations cannot see them | RBAC | P1 | 🐞 |
| ME-06 | Guardian: a child's fees, attendance, report cards (published only) and announcements here; homework, materials, quizzes, answer sheets and standing under LRN-04 to LRN-15 | API | P1 | ✅ |
| ME-07 | A guardian gets 403 for a student who is not their child, on every child endpoint; so do staff and teachers | RBAC | P1 | ✅ |
| ME-08 | Guardian submits homework and takes a quiz; a second attempt is rejected (covered by LRN-04 and LRN-08 in `tests/api/learning`) | API | P2 | ✅ |
| ME-09 | A guardian sees the child's data only while the guardian link is ACTIVE (not reachable: there is no endpoint that deactivates a link) | API | P2 | ⬜ |
| ME-10 | Portal routing: teachers and parents land on the portal, are kept out of admin screens, administrators are kept out of the portal, a person with both chooses, one with neither is told | UI | P1 | 🐞 |
| ME-U01 | Parent portal: fees and outstanding total, invoice rows, no invoices, two children with a toggle, announcements, no linked child | UI | P1 | ✅ |
| ME-U02 | Teacher portal: sections, leave balance, raise a leave request from the dialog (PENDING, visible to HR), an end date before the start shows an error | UI | P2 | ✅ |
| ME-U03 | My profile: details, request a change (PENDING), empty submit refused, APPROVED after a manager approves; admin inbox Approve and Reject | UI | P2 | ✅ |
| ME-U04 | My payslips: empty message, only the caller's finalized payslip, open it, back, print | UI | P2 | ✅ |

## 22. Dashboard (`/dashboard`, `/academics/setup-status`)

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| DSH-01 | Summary returns counts that match the underlying lists (students, staff, inventory, library, sales, purchases, fees) | API | P1 | 🐞 5et, 5eu, 5ev |
| DSH-02 | Charts endpoint returns series for the current year and does not 500 | API | P1 | ✅ |
| DSH-03 | Dismiss setup progress and quick actions; the preference is per user, per organisation and persists | API | P2 | 🐞 5ew |
| DSH-04 | The setup checklist (structure, academic setup, members, students) reflects what exists | API | P2 | ✅ |
| DSH-05 | Dashboard data respects the caller's permissions | RBAC | P1 | 🐞 5ex |
| DSH-U01 | Dashboard renders greeting, hero stats, module tiles and charts with the API's numbers and no failing request | UI | P1 | 🐞 5ey, 5ez (5eu when refunds exceed payments) |
| DSH-U02 | A new school sees the first-step banner and the stats behind "Summary stats"; the setup guide counts steps | UI | P2 | ✅ |
| DSH-U03 | Setup guide and quick-actions dismissals persist across reload and browsers, for that user only | UI | P2 | ✅ |
| DSH-U04 | Each quick action is offered only with its permission and opens the right page | UI | P2 | ✅ |
| DSH-U05 | Desktop layout has no horizontal overflow and the main area scrolls; phone width has no horizontal scroll | UI | P3 | 🐞 5fa (phone) |
| DSH-U06 | Landing: managers go to /dashboard, others to /students; /dashboard opened without permission is handled | UI | P2 | 🐞 5fb |

## 23. Settings and configuration (`/organisation`, `/custom-field-definitions`, `/document-templates`, `/id-card-templates`, `/timezones`, `/imports`, `/assets`)

Business settings, profile, campuses, departments, designations, academic years and the school template are section 2 (ORG-*). Specs: `tests/api/settings`, `tests/ui/settings`.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| SET-01 | Branding: get and put (name, text, assets, numbering formats); blank formats and unknown asset references are rejected; the asset is served | API | P2 | 🐞 5fc |
| SET-02 | External services: list, enable by platform owner, set properties; secrets are never returned; entitlement and values are per organisation | API | P1 | 🐞 5fl |
| SET-03 | Custom field definitions: create, update, archive/reactivate, list by entity; duplicates, bad enums and missing fields | API | P1 | 🐞 5fd, 5fe |
| SET-04 | A custom field of each type validates input (required, type, options) | API | P1 | 🐞 5aj, 5ff, 5fg |
| SET-05 | A custom field appears on the student form and its value round trips and shows on the student page | E2E | P1 | ✅ (SET-U02, STU-14) |
| SET-06 | Document template: defaults until saved, upsert per type, all four styles, invalid style and page size | API | P2 | 🐞 5fi |
| SET-07 | ID-card templates: create, list, render for a student; validation; tenant isolation | API | P2 | 🐞 5fj |
| SET-08 | Timezones lookup returns IANA names | API | P3 | ✅ (ORG-06) |
| SET-09 | Import history lists past imports with counts | API | P2 | ✅ (IMP-*, import-history-and-tenancy) |
| SET-10 | Asset upload: PNG, JPEG and PDF succeed and are served; other types, empty, oversize and fake-content files are rejected | API | P1 | 🐞 5fk |
| SET-11 | Uploads are served from the unauthenticated `/uploads/` path by UUID reference (by design); unknown references 404; no path traversal | TENANT | P1 | ✅ |
| SET-12 | Module (feature-flag) switches (Transport, Communication, Messaging and Performance start off): 403 from the module's API for everyone including the owner, data kept, permission catalogue, history, per organisation | API | P1 | ✅ |
| SET-13 | Starter-pack module selection and go-live check | E2E | P2 | ✅ (ORG-10, ORG-13, ORG-14) |
| SET-U01 | The hub lists every section and each of the 22 opens with no failing request or console error | UI | P2 | 🐞 5ez (all pages), 5fm |
| SET-U02 | Custom fields in Settings: add, archive, activate; the form shows the right input per type; value on the student page | UI | P1 | 🐞 5fn, 5fo, 5fp |
| SET-U03 | Branding: defaults, save and reload, logo upload shown and saved, non-image refused, read-only for members | UI | P2 | ✅ |
| SET-U04 | Letter formats: save and reload, separate per document, invalid size refused, read-only for members | UI | P2 | ✅ |
| SET-U05 | ID Card Studio: save and reload a template, preview with a student, read-only for members | UI | P2 | ✅ |
| SET-U06 | Integrations: locked until enabled; secrets masked, saved and never shown again; read-only for members | UI | P2 | ✅ |
| SET-U07 | A switched-off module disappears from the sidebar and dashboard and a direct link explains why | UI | P1 | ✅ |
| SET-U08 | Dismissed onboarding widgets can be restored from Settings (future) | UI | P3 | ⬜ |

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
| PLT-20 | Back up now writes school.sql.gz, platform.sql.gz and uploads.zip; sizes and SHA-256 match the files on disk; the dumps are complete; the list shows it first and the status is healthy | API | P1 | ✅ |
| PLT-21 | System health lists Backups as operational once a recent backup exists | API | P1 | ✅ |
| PLT-22 | Listing and taking backups is refused without a token (401) and with a school admin's token | RBAC | P1 | ✅ |
| PLT-23 | Secrets check: every shipped default (JWT, platform JWT, integration key, reporting password, seeded admin password) is flagged by variable name, never by value; warn mode outside prod; Secrets is down in system health | API | P1 | ✅ |
| PLT-24 | The secrets check is refused without a token and with a school admin's token | RBAC | P1 | ✅ |
| PLT-U01 | Platform admin signs in and provisions an organisation | UI | P1 | ⬜ |
| PLT-U02 | Create a plan and a subscription | UI | P1 | ⬜ |
| PLT-U03 | Lead pipeline: create, move through stages, convert | UI | P1 | ⬜ |
| PLT-U04 | Module switch page toggles a module and shows history | UI | P2 | ⬜ |
| PLT-U05 | System health > Backups: Back up now says it was written and lists it first with all three files; the button reads Backing up… and is disabled while running | UI | P1 | ✅ |
| PLT-U06 | After a backup the Backups component reads Operational; an off schedule is warned about; a failed backup shows the server's reason | UI | P1 | ✅ |
| PLT-U07 | System health > Secrets lists the variables still at defaults (names only) and warns that production would refuse to start | UI | P1 | ✅ |

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
| E2E-12 | Year rollover: close the year, create the next, promote students, copy forward structure | P1 | ✅ (sanity phases 14 and 15) |
| E2E-13 | Exit: student leaves, fees settled, attendance excluded, data export for the request | P2 | ⬜ |
| E2E-14 | Sanity phase 08b: operator enables Performance, owner configures metrics, opens a cycle, rates the teacher, sets a goal, closes the cycle (16 steps, UI only) | P1 | ✅ |
| E2E-15 | Sanity phase 08: periods, assignments, weekly timetable grid, quotas, generated draft, room booking, publish (20 steps, UI only) | P1 | ✅ |
| E2E-16 | Sanity phase 09: the class teacher takes two registers in her own window and submits them; the owner locks one, corrects the other with a reason and locks it; staff attendance; the student's month summary (13 steps, UI only) | P1 | ✅ |
| E2E-17 | Sanity phase 10: grading scale, exam settings, create the exam, schedule three papers (a duplicate is refused), the teacher enters and submits marks (out-of-range refused), the owner approves (14 steps, UI only) | P1 | ✅ |
| E2E-18 | Sanity phase 11: publish a report card (a second publish is refused), print view, Published on the overview, correct marks after publishing, stale warning, republish (11 steps, UI only) | P1 | ✅ |
| E2E-19 | Sanity phase 12: the operator enables Communication; the teacher drafts a staff notice and is refused publishing; the owner publishes; she reads her notification; a class notice reaches the family; a cancelled draft; the in-app preference (13 steps, UI only) | P1 | ✅ |
| E2E-20 | Sanity phase 13: the owner builds a class register, attendance and exam results report over the reporting views, runs them with filters, publishes one and exports it as CSV (10 steps, UI only) | P1 | ✅ |
| E2E-21 | Sanity phase 14: add 2027-28, copy forward (preview, copy), promote the student to Grade 2 A, request and approve a campus transfer. Withdrawal is not covered (5gb) (11 steps, UI only) | P1 | ✅ |
| E2E-22 | Sanity phase 15: make 2027-28 current, close 2026-27, a closed year takes no new classes, the student is in Grade 2 A, last year's report card is still on record (9 steps, UI only) | P1 | ✅ |

---

## 29. Imports and exports (`*/import`, `*/export`, `/imports/history`; Settings > Imports & exports)

Eleven entities can be bulk imported from CSV or XLSX and exported: staff, students, guardians, classes & sections,
subjects, student enrolments, fee structures, opening balances, inventory items, vehicles & routes and books. Ten share
one parser and the per-row `{ row, status, message, id }` result with a validate-only dry run; Students predates that and answers
`{ success }` rows with no dry run. The entity catalogue is `src/api/imports.ts`; the two table-driven specs loop over it, so a new entity is one row there.
Entity rules that were already covered stay in their module sections (ACA-11/12, STU-25 to STU-29, FEE-40, LIB-13).

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| IMP-01 | Every import and export needs a token; a garbage token is refused like none (all 11 entities) | API | P1 | ✅ |
| IMP-02 | Importing needs the entity's manage permission (viewing alone gets 403); exporting needs its view permission | RBAC | P1 | ✅ |
| IMP-03 | No file, an unsupported file type: 400 with a plain message (all 11). A completely empty file is a 400 with a plain message; a header-only file reports no rows | API | P1 | ✅ |
| IMP-04 | A file with the wrong columns reports the problem per row, in plain words | API | P2 | ✅ |
| IMP-05 | Every export is a JSON array | API | P2 | ✅ |
| IMP-06 | Every row result is `{ row, status, message, id }`; the first data row is row 2 | API | P2 | ✅ |
| IMP-07 | An `.xlsx` workbook imports like the same CSV, in a dry run too; a file named `.xlsx` that is not a workbook is a 400; the extension is case-insensitive | API | P2 | ✅ |
| IMP-08 | Parsing: columns in any order, unknown columns ignored, CRLF, blank lines, quoted commas, trimmed spaces, non-Latin text, and a UTF-8 byte-order mark (Excel's "CSV UTF-8") | API | P1 | ✅ |
| IMP-09 | One bad row does not stop the others; the same key twice in a file is created once; an over-long value is a row error with a clean message | API | P2 | ✅ |
| IMP-10 | A few hundred rows import in one request; a dry run is repeatable and records no history | API | P3 | ✅ |
| IMP-20 | Staff import: dry run vs real, duplicate employee code, each required field, unknown department/designation/campus/employment type named, case-insensitive lookups, bad date, a failed row leaves no orphan person | API | P1 | ✅ |
| IMP-21 | Vehicles & routes import: vehicle only, vehicle with route, route attached to an existing vehicle, duplicate registration and route code, route name/code pair, unknown campus, bad type and capacity, unknown and known driver | API | P1 | ✅ |
| IMP-22 | Inventory items import: dry run vs real, optional fields, duplicate code (case-insensitive and within one file), required fields, unknown category, a bad or negative reorder level | API | P1 | ✅ |
| IMP-23 | Fee structures import: one installment for the full amount, default frequency, duplicate category in the group, unknown year/class/category/group, bad amount/date/frequency, zero or negative amount | API | P1 | ✅ |
| IMP-30 | Import history: empty for a new organisation, one entry per real import with file name and counts, newest first, no entry for a dry run, an all-error import still recorded, the entity name per importer | API | P2 | ✅ |
| IMP-31 | One organisation's history and exports never show another's rows | TENANT | P1 | ✅ |
| IMP-32 | Duplicate detection and lookups are per organisation | TENANT | P1 | ✅ |
| IMP-U01 | The Import tab shows all 11 cards in five groups, each with a template and an Import button; the Export tab one button per entity | UI | P1 | ✅ |
| IMP-U04 | Clicking anywhere on a card opens that entity's dialog | UI | P3 | ✅ |
| IMP-U05 | Each card's template downloads with the right file name, the importer's columns and one example row; the dialog offers the same file | UI | P1 | ✅ |
| IMP-U07 | A downloaded template uploads back and the importer reads every column (any error is about missing lookups, never about a column) | UI | P1 | ✅ |
| IMP-U10 | Upload, validate, preview, confirm, summary; only the confirm saves | UI | P1 | ✅ |
| IMP-U11 | Cancelling at the preview imports nothing; reopening starts clean | UI | P1 | ✅ |
| IMP-U12 | Errors and duplicates listed per row; only valid rows confirmed; the error report downloads | UI | P1 | ✅ |
| IMP-U13 | With no valid row the Confirm button is disabled; a header-only file previews zero rows | UI | P2 | ✅ |
| IMP-U15 | An `.xlsx` file imports through the dialog | UI | P2 | ✅ |
| IMP-U16 | An unreadable file shows the server's message and the user can try again | UI | P2 | ✅ |
| IMP-U18 | Students import has no preview step and reports rows straight away | UI | P2 | ✅ |
| IMP-U20 | Inventory, vehicles & routes, books and staff import through the dialog | UI | P2 | ✅ |
| IMP-U30 | Each Export button downloads the right file with the documented columns (all 11) | UI | P1 | ✅ |
| IMP-U31 | An export has one line per record the API returns | UI | P2 | ✅ |
| IMP-U32 | An empty export still downloads a header | UI | P3 | ✅ |
| IMP-U33 | What was imported is in the next export | UI | P2 | ✅ |
| IMP-U34 | A value starting with `=`, `+`, `-` or `@` is neutralised in the exported file (spreadsheet formula injection) | UI | P1 | ✅ |
| IMP-U40 | The import-history dialog: empty message, then entity, file, total, imported, errors and duplicates per run, newest first; a preview leaves it empty | UI | P2 | ✅ |
| IMP-U50 | A user without the manage permission who uploads gets the server's refusal; nothing is saved and the dialog stays usable | UI | P1 | ✅ |
| IMP-U51 | A view-only user can still export | UI | P2 | ✅ |
| IMP-U52 | An export the user may not run says so instead of failing silently | UI | P1 | ✅ |

---

## 30. Teacher performance (`/performance`, `/api/v1/performance`; "My performance" on `/learning`)

Opt-in module (PERFORMANCE): off for every organisation until the platform owner switches it on. Coaching, not ranking: teachers are listed alphabetically, outcome metrics are scored only against the previous period, and nothing feeds payroll. Each API test uses a throwaway organisation; the UI file runs serially on the shared organisation.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| PERF-01 | Every endpoint is refused while the module is off, even for the owner; once on, 13 metrics are listed and none is tracked | API | P1 | ✅ |
| PERF-02 | Weight (1-100), target (>0, within the metric's maximum) and days (0-90) are validated; KPI_VIEW reads but cannot change metrics or settings; no permission is refused | API | P1 | ✅ |
| PERF-03 | Punctuality is scored from staff attendance; a teacher with no records has no score; teachers are listed alphabetically | API | P1 | ✅ |
| PERF-04 | Cycles: create, list, close; a closed cycle takes no ratings or goals; ratings must be 1-5 from MANAGER or PEER about an active teacher; re-rating replaces; goals are added and moved on | API | P1 | ✅ |
| PERF-05 | Self-view: refused until switched on and for non-teachers; a teacher sees only their own rating while a cycle is open, the manager's (named) after it closes, never a peer's; cannot rate through the admin endpoint | API | P1 | ✅ |
| PERF-U01 | Metrics tab: switching a metric on keeps weight and target after a reload; weight 0 shows an error; days field only where needed; outcome metrics have no target | UI | P1 | ✅ |
| PERF-U02 | Scorecard shows 75.0% for 3 of 4 on-time days, a dash for a teacher with no records; changing the period changes the numbers | UI | P1 | ✅ |
| PERF-U03 | Appraisal cycles tab: create (listed Open), close, and a duplicate name is refused on screen | UI | P1 | ✅ |
| PERF-U04 | Staff appraisal page (opened from an Overview row, or a Scorecard row): manager rating and goal saved and kept on reopening; re-rating replaces; closed cycle is read-only; Overview search by name | UI | P1 | ✅ |
| PERF-U05 | The Metrics-tab switch gives a teacher a My performance tab; the teacher sees their scorecard, writes a self-appraisal and a goal, and sees the manager's rating only after the cycle closes | UI | P1 | ✅ |
| PERF-U06 | A KPI_VIEW-only user reads scorecard, overview and cycles but has no Metrics tab, Create appraisal cycle, Close cycle, Save rating or Add goal | UI | P2 | ✅ |
| PERF-U10 | Overview cards (Total staff, Pending, Completed, Average performance) equal the server's counts, move when a teacher is rated, and the average leaves out an unscored teacher; with no metric tracked the screen says so and the average is a dash | UI | P1 | ✅ |
| PERF-U11 | Row status goes Pending -> Reviewed -> Finalized when the cycle closes, an unrated teacher ends as Not reviewed; a teacher with no data shows a dash, never 0 | UI | P1 | ✅ |
| PERF-U12 | Filters (department, designation, review status), search by name or employee ID, Clear filters, "No staff match" message, "Not set" department and "No employee ID" fallbacks | UI | P1 | ✅ |
| PERF-U13 | More than ten staff: ten per page, next page, rows per page, and a search returns to page one | UI | P2 | ✅ |
| PERF-U14 | Insights charts (manager ratings, department score, goal bar, monthly presence) match the server's data; an untouched cycle shows an honest empty message in each | UI | P2 | ✅ |
| PERF-U15 | Appraisal cycles tab: progress "X of Y" matches the server, Close cycle can be cancelled, View staff opens Overview on that cycle; the cycle choice lives in the URL | UI | P1 | ✅ |
| PERF-U16 | Create appraisal cycle dialog: Create disabled for a blank name or an end before the start; the new cycle becomes the selected one | UI | P2 | ✅ |
| PERF-U17 | Staff appraisal page: HR details, presence block, workflow and status follow a rating; no HR profile / no data shows "Not set" and no attendance message; cycle selector switches ratings; closing the cycle from the page removes the edit controls | UI | P1 | ✅ |
| PERF-U18 | Rating form: Save disabled until a star is chosen, a double click saves one rating, "Rating saved." is shown, a peer rating survives a reload | UI | P2 | ✅ |
| PERF-U19 | Goals: edit title and details, change status (Insights follows), a blank title cannot be saved; a closed cycle's goal status must be read-only | UI | P2 | 🐞 |
| PERF-U20 | Creating a cycle, a rating and a goal through the screen writes audit entries (AppraisalCycle, TeacherFeedback, TeacherGoal); the Performance page has no screen for that history | UI | P2 | ✅ |
| PERF-U21 | Permissions: KPI_VIEW + KPI_REVIEW rates but cannot create or close cycles or see Metrics; KPI_VIEW + KPI_MANAGE has no rating or goal controls; no permission gives no staff table | UI | P1 | ✅ |
| PERF-U22 | No cycles shows the "No appraisal cycles yet" invitation; a failing overview shows an alert and Retry recovers | UI | P2 | ✅ |
| PERF-U23 | At 390px wide none of Overview, Insights, Cycles or the appraisal page scrolls sideways; dark mode renders a dark page and table panel | UI | P2 | ✅ |

## 31. Certificates (`/students/certificates`, the student page, Settings > Certificate types, `/verify/:org/:token`)

Part of the STUDENTS module. Types are copied from four presets (TC, Leaving, Bonafide, Character) or created with generic wording; the transfer certificate needs a second person's approval, the student's exit record and dues clearance (or an override reason), and is issued once. The UI file runs serially on the shared organisation.

| ID | Scenario | Layer | Priority | Status |
|---|---|---|---|---|
| CERT-U01 | A TC requested on the student page is Awaiting approval with no Issue button; the requester's own approve is refused (403); a CERTIFICATE_APPROVE user approves but cannot issue (403); the row then reads Ready to issue | UI | P1 | ✅ |
| CERT-U02 | Issue dialog shows the unpaid fee as Pending and keeps Issue and print disabled until an override reason is typed (server answers 409 without it); the PDF is A4 with the title, student, exit reason and destination school, a TC-YYYY-NNNN number and a verify URL; Reprint says DUPLICATE COPY 2; a second TC for the student is refused (409) | UI | P1 | ✅ |
| CERT-U03 | The PDF's verify link opens a public page (no login) saying genuine and valid with the number and no admission number; after Cancel certificate it says cancelled and the reprint is marked CANCELLED; a made-up token says no certificate matches | UI | P1 | ✅ |
| CERT-U04 | A parent is refused a TC (403) and does not see it offered; requests a bonafide certificate in the portal; the office sees it marked Portal and issues it; the parent downloads it twice with no DUPLICATE; another family's child is refused (403) | UI | P1 | ✅ |

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
5df. Every importer answers a request with no file with 500 "An unexpected error occurred" and an unsupported file type (or a file named `.xlsx` that is not a workbook) with 404 and the right message; both should be 400. Eleven endpoints; extends 5x, 5ap and 5dc. IMP-03, IMP-07. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dg. A CSV saved by Excel as "CSV UTF-8" begins with a byte-order mark, which the shared parser keeps in the first header: every row of the file then fails with "<first column> is required". IMP-08. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dh. Row messages carry database and Java text: an over-long value reports `could not execute statement [Data truncation ...] [insert into subjects ...]`, a non-numeric reorder level `For input string: "plenty"`, and a bad vehicle type `No enum constant com.operion.transport.VehicleType.SPACESHIP`. IMP-09, IMP-21, IMP-22. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5di. Inventory import: the dry run says a non-numeric reorder level is VALID (the real import then fails the row), so the preview promises a row it cannot import; a negative reorder level is accepted. IMP-22. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dj. Fee structure import accepts a zero or negative amount, in the dry run and the real import (extends 5ce and 5ci). IMP-23. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dk. **UI:** the exported CSV writes every value as-is inside quotes, so a subject named `=HYPERLINK(...)` is exported as a cell that spreadsheet software runs as a formula. IMP-U34. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dl. **UI:** an export the user may not run (`SUBJECT_VIEW` missing) throws an uncaught `Missing required permission: SUBJECT_VIEW` from the button's click handler: no message, no download. IMP-U52. **Fixed in the Operion working tree; the scenarios named above pass (re-run 2026-10-15).**
5dm. Departments and designations accept a blank name and a second record with the same name (`POST /departments`, `/designations`). HR-01, HR-02.
5dn. An invalid enum value answers 404 with the Java class name instead of 400: `No enum constant com.operion.hr.EmploymentType.FREELANCE` (department/designation status, employment type, staff status, exit type, document verification status). HR-01, HR-02, HR-03, HR-05, HR-06, HR-08.
5do. Missing or invalid required fields on HR writes: no `employmentType` -> 500; a transfer without `designationId` -> 500; a leave request without dates -> 500; a document without `documentType` and a leave type without `code` -> 409 "conflicts with an existing one"; zero or negative leave days -> 404; listing leave requests with no filter -> 404. HR-03, HR-05, HR-08, HR-11, HR-13.
5dp. A person can have two staff profiles; a staff member who has already exited can be exited again; an exit dated before the date of joining is accepted. HR-03, HR-06.
5dq. Staff bank details return the full account number (no masking) and accept letters in it. HR-09.
5dr. Leave: a negative allocation is accepted; `numberOfDays` is not checked against the date range (9 days for a 2-day range); overlapping requests for one person are accepted. HR-12, HR-13, HR-15.
5ds. Leave approval: a leave-manager can approve their own request, and the approver recorded is whatever `decidedBy` the body names (any user id, including one that does not exist). HR-16.
5dt. **Job applications never reach HR:** the public form returns 200 and an id, but the application is in no organisation's list and `approve` answers 404 "No job application with id N" (probed with two fresh organisations). The form also accepts a blank name, a malformed email, negative experience and the same email twice. HR-17.
5du. **UI:** Approve and Reject on the HR inbox and on the staff profile send `decidedBy: 1` (hard-coded), so the approver recorded is user 1 whoever clicked (extends 5ds). HR-U02.
5dv. **UI:** a view-only user (`HR_VIEW`) is offered Raise request, Add document, Allocate, Approve, Reject, Add leave type and Add staff; only Transfer and Record exit are hidden. The server answers 403. HR-U05.
5dw. **UI:** a user without `HR_VIEW` who opens `/hr` gets the whole page: each panel says `Missing required permission: HR_VIEW`, and then also "No active staff yet." and "No pending leave requests.", as if there were none. HR-U05.
5dx. **UI:** a failed Add leave type (duplicate code) shows its error on the page behind the dialog, not in it; an exit dated before joining is saved with no message (5dp); the saved bank account number is shown in full (5dq); a submitted job application never appears in the inbox (5dt). HR-U01, HR-U03, HR-U04.
5dy. **Payroll validation answers 404:** a negative basic amount, a negative component value or percentage over 100 on a salary structure, and a negative adjustment amount on a payslip, return 404 with the correct message ("Basic amount must be zero or more", "Line amount must be zero or more"): the `IllegalArgumentException` pattern. Tests assert 400. HR-07, PAY-07.
5dz. **UI:** Discard draft on a payroll run deletes the run but then shows "Action failed" and stays on the deleted run: the endpoint answers 200 with an empty body and the client only treats 204 as empty, so `response.json()` throws. PAY-U03.
5ea. **UI:** a user without `PAYROLL_VIEW` who opens `/payroll` is also told "No payroll runs yet." beside the permission error (same pattern as 5dw). PAY-U01.
5eb. **A parent who claims a portal invite is treated as an administrator:** `PortalInviteService.createGuardianPortalRole` builds the "Guardian" role with `new Role(name, description, false, true)`, so `portal` is false. `/me` then answers `ADMIN` with no contexts, and the web app sends the parent to `/students` instead of `/portal/guardian` (the parent is blocked by 403s there, but sees the admin shell). `findFirstByManaged(true)` also picks whichever managed role exists first. ME-01, ME-10. (Side note: `GET /roles` is open to every authenticated member, so a parent can list the school's role names.)
5ec. FIXED 2026-10-17 (the holiday-aware leave change returns 400 for these). Leave raised from the portal (`POST /me/leave-requests`): an end date before the start, zero days and negative days used to be refused with status 404. ME-02.
5ed. Profile change requests: any text is accepted as `email` and `phone` ("not-an-email", "call me maybe"); an empty request returns 404 instead of 400 and an unknown `status` filter returns 404 with "No enum constant ...". ME-04.
5ee. A holder of `PROFILE_CHANGE_MANAGE` can approve their own change request, and `reviewedBy` is their own user id (same gap as 5ds for leave). ME-05.
5ef. Inventory create/update validation is missing or answers the wrong status: a blank name is accepted for categories, items, suppliers and customers; a negative reorder level (on create and on `reorder-level`), a negative stock-entry unit cost, an invalid supplier email and an asset whose warranty ends before its purchase are accepted; a category, item or asset with no code/unit/tag returns 409 and an item with no category returns 500. INV-01, INV-02, INV-03, INV-04, INV-11, INV-12, INV-13.
5eg. Inventory business rules answer 404 instead of 400 (message is correct, status is not): entry or issue quantity 0 or negative, an issue naming two recipients, an adjustment with a zero delta, a transfer to the same campus or of quantity 0, a customer linked to both a student and a guardian; an unknown adjustment reason, supplier status or asset status leaks "No enum constant ..."; a stock entry with no campus and an adjustment with no reason return 500. INV-04, INV-05, INV-06, INV-07, INV-11, INV-12, INV-13.
5eh. Concurrent stock issues oversell: ten parallel issues of 1 against a balance of 5 succeeded 7 times and left the balance at -2 (no row lock or conditional update on the balance). INV-08.
5ei. Inventory state rules are not enforced: a discontinued item accepts new stock entries; an inactive supplier can be set as an item's default supplier and named on a new stock entry; a disposed asset can be assigned and set back to an active status. INV-03, INV-10, INV-11, INV-13.
5ej. Inventory UI: issuing more than the balance leaves the dialog open with no reason shown (the error is written to the page alert behind the modal, as in 5q and 5af); a viewer with only `INVENTORY_VIEW` is still offered Add category, Add item, Add asset, Add supplier, Add customer, Record entry, Record issue, Record adjustment and Transfer, all of which answer 403. INV-U01.
5ek. Purchase order creation validation answers the wrong status or none: no lines and a line quantity of 0 or below return 404 (the message is right), missing lines, supplier or campus return 500, a missing unit cost or expected date returns 409, a negative unit cost is accepted. PUR-01.
5el. A purchase order can be raised against an inactive supplier and for a discontinued item (the New purchase order dialog hides inactive suppliers, the API does not). PUR-01.
5em. Purchase receipt and return validation: a received or returned quantity of 0 or below returns 404, an unknown return reason returns 404 "No enum constant ...", a missing reason returns 500, a missing entry or return date returns 409, and a receipt with no lines returns 200 and moves an APPROVED order to PARTIALLY_RECEIVED with nothing received. PUR-03, PUR-04.
5en. A line that belongs to a different order can be received against this one (the call returns 200 and adds stock). PUR-03.
5eo. Two simultaneous receipts of the full quantity both succeed: the line is received twice and the balance is 10 against an order of 5 (the same lost update as 5eh). PUR-03.
5ep. Sale creation validation answers the wrong status or none: no lines and a line quantity of 0 or below return 404, missing lines, customer, campus or unit price return 500, a missing sale date returns 409, a negative unit price is accepted (a sale with total -5 was created). SAL-01.
5eq. A sale can be made to an inactive customer and for a discontinued item (the New sale dialog hides inactive customers, the API does not). SAL-01.
5er. Sale payments: an overpayment is accepted (the sale's paid amount exceeds its total), a PAID sale takes further payments, two simultaneous payments that together exceed the total are both accepted, a payment of 0 or below returns 404, an unknown method returns 404 "No enum constant ...", a missing amount or method returns 500, a missing date returns 409. The payment dialog accepts an overpayment too. SAL-03, SAL-U02.
5es. Purchase and Sales UI: the receive, return, New sale and Record payment dialogs stay open on a server error but show it only on the page behind the modal (as 5q); a viewer (PURCHASE_VIEW or SALES_VIEW only) is offered New purchase order, Receive goods, Cancel, New sale and Record payment, which all answer 403; a member with neither permission sees "No purchase orders yet." or "No sales yet." instead of an access message (the menu does hide the links). PUR-U02, PUR-U03, SAL-U01, SAL-U02, SAL-U04.
5et. Dashboard summary: `inventory.lowStockItems` counts stock rows, not items, so an item that is below its reorder level at two campuses counts twice (in the shared organisation 735 low-stock items against 445 active items). DSH-01.
5eu. Dashboard summary: `fees.totalCollected` and `collectionRate` go negative when refunds exceed payments (the refund cap is missing, see 5ch) and nothing clamps them: the shared organisation showed ₹-1,69,948 and -99% on the tile. Seen after the refund specs had run; not reproduced on a fresh database. DSH-01, DSH-U01.
5ev. Dashboard charts: the "Students by class" total (1074) exceeded the Active students tile (1072) in the shared organisation. Cause not confirmed (inference: students who left still hold a current enrolment). Seen on an accumulated database, not reproduced on a fresh one. DSH-02 (class total check).
5ew. Dashboard dismiss: four simultaneous first dismissals of the setup guide returned 409 for three of them and one dismissal was lost (cause not isolated). DSH-03.
5ex. Dashboard summary: a member holding only ORGANISATION_MANAGE is returned the fee, staff, inventory, sales and purchase sections, which the page hides unless the member also holds FEE_VIEW, HR_VIEW, INVENTORY_VIEW and so on; the API does not apply the same permission checks. DSH-05.
5ey. Dashboard UI: the summary returns sales and purchase totals but the page has no Sales or Purchase tiles. DSH-U01.
5ez. Every page load (seen on the dashboard and on all 22 Settings pages) calls `GET /api/v1/notifications/me`, which answered 403 for the organisation owner (twice per load, with console errors) while the Communication module was off in a freshly seeded database; the bell should not poll a module that is switched off. Cause is inference from the fresh-database run, not isolated. DSH-U01.
5fa. Shell header at phone width (390px): the top bar (campus name, academic year, date) is 535px wide, so every page scrolls sideways (document scrollWidth 536). Found on the dashboard; affects all pages. DSH-U05.
5fb. Dashboard UI: opening `/dashboard` directly without ORGANISATION_MANAGE shows the API's raw "Missing required permission ..." message in an alert instead of an access page or a redirect to /students. DSH-U06.
5fc. Branding: `PUT /organisation/branding` accepts logo, stamp and signature references that were never uploaded and ones that point outside the upload folder (`../../etc/passwd` is stored and returned as the URL `/uploads/../../etc/passwd`). SET-01.
5fd. Custom field definitions: an unknown `dataType` ("RICH_TEXT", "MONEY") or status ("DELETED") answers 404 "No enum constant ..." instead of 400. SET-03.
5fe. Custom field definitions: no validation - a blank label, a blank field key and keys with spaces, capitals or punctuation are stored; a missing label, entity type or field key reaches the database NOT NULL and answers 409 "conflicts with an existing one"; a missing data type answers 500. SET-03.
5ff. A SELECT custom field can be created with no options, so its form dropdown is empty. SET-04.
5fg. Custom field values are not validated against their type on a student: "next tuesday" and "2026-02-30" are stored in a DATE field, "perhaps" in a BOOLEAN field and "Purple" in a SELECT whose options are Red, Blue and Green (a NUMBER field accepting "abc" is 5aj). SET-04.
5fh. Editing a student's custom fields after a field was archived erases the archived field's stored value (the map is replaced, see 5aj), although archiving is meant to keep existing values. SET-04.
5fi. Document templates: `PUT /document-templates/{type}` accepts any page size ("Poster-XL"); the screen offers A4 and Letter. SET-06.
5fj. ID-card templates: `layoutJson` that is not JSON ("{not json") is stored; rendering such a template is expected to fail (not tested). SET-07.
5fk. Asset upload trusts the declared content type: HTML bytes labelled image/png are stored and served from the public `/uploads/` path. SET-10.
5fl. External services: `PUT /organisation/external-services/{key}/properties` with a body that has no `properties` answers 500. SET-02.
5fm. Settings > Notifications calls `GET /api/v1/notification-templates`, which answers 403 while the Communication module is off, so the page opens with failing requests. SET-U01.
5fn. Settings > Custom fields: a Choice list can be added with no choices. SET-U02.
5fo. Settings > Custom fields: the error for a duplicate field key is shown on the page behind the Add dialog, not in the dialog (as 5q). SET-U02.
5fp. Settings > Custom fields: a member without ORGANISATION_MANAGE is offered Add custom field and Archive, which answer 403. SET-U02.
5fq. Performance: on a closed (finalized) appraisal cycle the goal status select is still offered and the API accepts the change, although Add goal, Edit and the rating form are withdrawn. PERF-U19 (marked `test.fail`, so it passes while the gap exists and goes red once it is closed).
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
5fr. **Fixed (Operion working tree, not committed):** class pickers in Attendance (`AttendancePage.tsx`, `MarkAttendanceQuickPage.tsx`), Examinations (`ExamDetailPage.tsx`), Communication (`AnnouncementsPanel.tsx`), Messaging (`MessagingPage.tsx`) and Fees (`FeeDemandPage.tsx`, `BulkInvoicePanel.tsx`) labelled every template class "Class #<id>" (as 5cp, Fees section). They now use the existing `useSchoolClassLabel()` hook: "Grade 1 · Main Campus". Found by sanity phases 09 and 10.
5fs. Student search (`StudentRepository` search, used by the Collect fee student picker) matches the first name, last name or admission number one at a time, so typing the full name "Aarav Nair", or the student ID that the option label shows, finds nothing. Found by sanity phase 07.
5ft. **Fixed (Operion working tree, `StaffAttendancePanel.tsx`):** after a campus was picked, Staff attendance's "Staff member" list was empty: the campus select held a number and was compared with a string. Found by sanity phase 09.
5fu. **UX:** the Examinations overview's Classes column says "Grade 1" with no campus, although the class exists on both campuses. Found by sanity phase 10.
5fv. **UX:** a published report card is held only in the Report cards tab's state. Once staff leave the page there is no list to find it again (only its print address). A refused second publish also clears the result already on screen. Found by sanity phase 11.
5fw. The Teacher template role has no `GRADE_LEVEL_VIEW`, so `GET /grade-levels` answers 403 for teachers and `useSchoolClassLabel()` falls back to "Class #<id> · <campus>". A teacher's class pickers (for example Compose announcement's Class) list 24 options she cannot tell apart. Found by sanity phase 12.
5fx. **UX:** My notifications shows only the channel, status and time of each notification, not its title or text. Found by sanity phase 12.
5fy. Reporting: `reporting_exam_results` lists superseded report cards next to the current ones and has no status column to filter them out, so a republished student appears twice (117/150 B+ and 121/150 A). Found by sanity phase 13.
5fz. Reporting: the "Result columns" display labels a report is saved with are never applied. Run results and the CSV export use the SQL column names (`ReportExecutionService` reads `getColumnLabel`). Found by sanity phase 13.
5ga. Reporting: a DATE column comes back as the UTC instant of local midnight, so 2026-10-12 shows as "2026-10-11T18:30:00.000Z", which reads as the day before. Found by sanity phase 13.
5gb. There is no screen to record a student exit (withdrawal, transfer-out). `POST /students/{id}/exits` exists, but no web page calls it, so withdrawal cannot be done from the UI. Found by sanity phase 14.
5gc. **UX:** Close on an academic year takes effect on one click with no confirmation, although a closed year can never be made current again. Close is also offered on the current year. Found by sanity phase 15.
5gd. **UI:** a teacher (`ANNOUNCEMENT_CREATE` without `ANNOUNCEMENT_PUBLISH`) is offered Publish on drafts; the server answers 403 "Missing required permission: ANNOUNCEMENT_PUBLISH". Found by sanity phase 12.
5ge. **UX:** the student profile's enrolment banner gives the roll number and date ("Enrolled - roll number 1, since 2027-03-31") but not the class, section or year. Found by sanity phase 15.
