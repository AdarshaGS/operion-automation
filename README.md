# operion-automation

Standalone API + UI automation for [Operion](../Operion), with **one report** that says which
API endpoints and which UI components are failing.

It lives outside the Operion repo on purpose: it only talks to a running Operion over HTTP
(API tests) and through a browser (UI tests). Nothing here imports Operion code.

## What you get

`reports/unified/index.html` (plus `report.json`) after every run:

| Tab | Answers |
|---|---|
| **Failures** | Every failing test, API and UI separately: the error, the exact endpoint blamed (with its request/response), or the failing page-object action (with screenshot + trace command) |
| **API endpoints** | Every endpoint the suite called, grouped by module, pass/fail per endpoint, statuses seen |
| **UI components** | Every page object used, grouped by module, pass/fail per action (`StudentCreatePage.fill`, ...) |
| **All tests** | Filterable list |
| **Coverage** | Which of Operion's ~550 endpoints no test has touched yet (read live from `/v3/api-docs`) |

The terminal also prints the failing endpoints/components at the end of every run.

## Run it

```bash
npm install
npm run install:browsers          # first time only (Chromium)

npm run stack:up                  # fresh DB + backend :8091 + frontend :5184 (see below)
npm test
npm run report                    # opens reports/unified/index.html
npm run stack:down
```

or all in one: `npm run test:fresh`.

Subsets: `npm run test:api`, `npm run test:ui`, `npx playwright test tests/api/fees`,
`npx playwright test -g "invoice"`.

### Why a fresh stack every run

Every run provisions a **new organisation** and seeds a student. Operion currently has a
tenant-scoping bug on generated student ids (GitHub #354): a second organisation can't admit
its first student in a database that already has one, so global setup fails with a message
pointing here. `scripts/stack-up.sh` drops and recreates `operion_auto` /
`operion_auto_platform`, so it never touches your dev data or your other ports
(8080/8090/5173/5183). Once #354 is fixed you can point the suite at any long-lived
*throwaway* environment instead via `OPERION_API_URL` / `OPERION_UI_URL`.

Quick re-run against the stack you just seeded (skips provisioning, same org + tokens):
`OPERION_REUSE_SEED=1 npx playwright test tests/api/students`

`stack-up.sh` runs the jar at `$OPERION_HOME/build/libs/operion-0.0.1-SNAPSHOT.jar`
(`OPERION_HOME` defaults to `../Operion`). It warns if Operion's source is newer than the jar -
run `./gradlew bootJar` first or you're testing an older build. **Never point this suite at a real
database.**

## Sanity (phased, start-to-end)

`npm run test:sanity` runs `tests/sanity/` one file at a time, in file order. Each file is one
phase: an ordered journey of named steps across API and browser. The report's **Sanity journey**
tab shows every step as passed / failed / not run, so you see exactly where the flow broke.

| Phase | File | What it proves |
| --- | --- | --- |
| 01 Business onboarding (UI only) | `01-business-setup.sanity.spec.ts` | platform operator adds the business in the platform console (listed on TRIAL) and signs out; the new owner signs in, follows the dashboard guide into the structure wizard, fills organisation profile and business settings (each save moves the wizard on), adds 2026-27 and marks it current, adds a second campus (optional step), reviews the three required items and finishes; dashboard reports Structure complete; departments and designations are not set up here - they come from the school template in phase 02; Settings pages show every saved value after a fresh load |
| 02 School template (UI only) | `02-school-template.sanity.spec.ts` | on the phase 01 business: Academic setup opens at the Academic year step, where 2026-27 (added in the structure wizard) is the only, current year, then moves to the School setup template step, which lists the default 12 grades (LKG to Grade 10), a class per grade, section A, and the default departments and designations; add section B; starter pack questions (Library on, Transport left off) and apply with no warnings; Settings lists the template's departments and designations (Library's in, Transport's not); Academics shows every grade level, a class per grade on both campuses and sections A and B in a class; navigation shows Library and hides Transport; dashboard moves on to "Add your first students" |
| 03 Academic setup (UI only) | `03-academic-setup.sanity.spec.ts` | the guided Academic setup wizard: year current, the School setup template step (already applied, offers a re-apply), template grade levels, Mathematics / English / Science / Computer Science already listed at the Subjects step (the template created them), template classes; review ticks all three; then Grade 1 gets the subjects (Computer Science elective) and keeps them after a reload |
| 04 Staff management (UI only) | `04-staff-management.sanity.spec.ts` | template roles (Teacher, Principal, Accountant) are listed; HR "Add staff member" adds a teacher and an accountant with roles, campus, department, designation and HR profile, each issuing an invite; both show as Invited; the teacher claims the invite in a separate signed-out window and becomes Active; the owner makes them Grade 1 A's class teacher and Mathematics teacher; dashboard Roles and Members tasks are done; the accountant's invite is kept for the fee phase |
| 05 Fee management (UI only) | `05-fee-management.sanity.spec.ts` | the accountant claims the invite phase 04 kept and becomes Active; the owner opens fee setup from the dashboard guide's Fees step; the template's fee categories are listed (Tuition, Admission, Library, Other) and Transport Fee is not (module off); add Computer Lab Fee; set up Grade 1 · Main Campus 2026-27's fee structure with the suggested name; add Tuition Fee (36000, 4 quarterly installments, 1000 one-shot discount) - a schedule that doesn't add up is refused - Admission Fee (one installment) and Computer Lab Fee (two half-yearly); all kept after a reload; the guide ticks Fees |
| 06 Student admission (UI only) | `06-student-admission.sanity.spec.ts` | the dashboard's "Add your first students" prompt opens Admit student; an empty submit is refused; Aarav Nair is admitted into Grade 1 · Main Campus A with his father typed in as primary guardian and the admission number left blank (generated); the profile shows every detail entered, status Active, a generated student ID; the mother is added from the Guardians panel as an emergency contact with priority 2; all kept after a reload; the student list shows 1 student in Grade 1 A; the "Add your first students" prompt is gone and Fees/Attendance unlock in the navigation |
| 07 Student allocation (UI only) | `07-student-allocation.sanity.spec.ts` | the student list's Class (Grade 1 · Main Campus) and Section (A) filters find Aarav and show "Grade 1 · Main Campus / A", Grade 2 shows no match; his profile confirms Active with roll number 1; on the Fees page he has no assignments and no invoices; the Assign fee list offers exactly Grade 1's three components; Tuition (Quarterly), Admission (One-shot) and Computer Lab (Half-yearly) are assigned with base = effective amount and no discount (43,400 in total); same after a reload. Invoices are not generated here |
| 08 onwards | _next_ | follows the roadmap below, on the same business (`loadSanityBusiness()` in `src/sanity/business.ts`) |
| legacy | `full-journey.sanity.spec.ts` | owner journey on the shared fixture org, from sign-in to fee collection (18 steps) |

Roadmap (build in this order): Platform Setup → School Onboarding → Academic Setup → Staff Management → Fee Management → Student Admission → Student Allocation → Timetable → Attendance → Examinations → Results and Report Cards → Communication → Reports → Student Promotion / Transfer / Withdrawal → Academic-Year Closure.

Only one sanity run at a time: phases hand state to each other through `.auth/sanity-business.json`, so two runs at once read each other's business.

`npm run test:sanity:business` runs only phase 01; phase 02 needs phase 01 to have run first on the same stack. The values it types into the forms live in
`sanityBusinessDetails()` (`src/sanity/business.ts`). Phase 01 makes no API calls: it creates
its own organisation through the platform console, signing in as the dev platform operator that
Operion seeds (`admin@operion.platform`, override with `OPERION_PLATFORM_EMAIL` /
`OPERION_PLATFORM_PASSWORD`), and writes the business to `.auth/sanity-business.json` for the
next phase.

Rules for a journey (see `src/sanity/journey.ts`): declare every step title up front in
`journey([...])` (that is what makes "not run" visible), prove each step with an assertion
(never just "the page opened"), mix UI actions with API verification of what they created, and
let state flow forward (the student created in step 7 is the one billed in step 11). To add a
module, add its phase between existing ones and append its titles to the plan. For a second
business flow (teacher takes attendance, guardian views fees...) add another
`*.sanity.spec.ts` with its own plan.

## Layout

```
playwright.config.ts          projects: sanity | api | ui (owner session) | ui-anonymous
src/
  sanity/                     journey() helper + combined API/UI fixtures
  config/env.ts               URLs + paths (.env supported, see .env.example)
  setup/                      global setup: org -> academic structure -> student -> role fixtures
    roles.ts                  role fixtures = permission bundles (add a role = add a row)
  api/
    apiClient.ts              recording client: calls use path *templates*, so the report groups by endpoint
    fixtures.ts               `api` (owner) | `anon` | `as(role)` | `seed`
    users.ts                  disposable logins (change password / logout without touching shared fixtures)
    shapes.ts, data.ts        response-contract + unique-data helpers
  ui/
    fixtures.ts               page-object fixtures + auto console/5xx watchdog
    instrument.ts             turns every page-object action into a named step for the report
  pages/                      page objects (one class per screen/panel)
  reporting/                  unified reporter, endpoint inventory, HTML renderer
tests/
  sanity/*.sanity.spec.ts     end-to-end journeys (ordered, step-reported)
  api/<module>/*.api.spec.ts
  ui/<module>/*.ui.spec.ts
```

## Adding coverage for a module

**API** - create `tests/api/<module>/<module>.api.spec.ts`:

```ts
import { test, expect } from "../../../src/api/fixtures";

test.describe("GET /api/v1/library/books/{bookId}", () => {
  test("returns the book", async ({ api }) => {
    const res = await api.get("/api/v1/library/books/{bookId}", { params: { bookId: 1 } });
    res.expectStatus(200).expectJson((body) => expect(body.id).toBe(1));
  });
  test("is forbidden without LIBRARY_VIEW", async ({ as }) => {
    (await as("noPermissions").get("/api/v1/library/books/{bookId}", { params: { bookId: 1 } })).expectStatus(403);
  });
});
```

Always pass the **template** plus `params`, never an interpolated URL - that is what makes the
report show one row per endpoint. `expectStatus` / `expectJson` mark the verdict against that
endpoint; if a test fails without one, the last call is blamed. Any 5xx fails its endpoint.

The suggested minimum per endpoint: happy path + contract shape, validation (4xx not 5xx),
401 without a token, 403 for a role lacking the permission, 404 for an unknown id.

**UI** - add the page object under `src/pages/<module>/`, register it in `src/ui/fixtures.ts`
(`instrument(new MyPage(page))`), then write `tests/ui/<module>/*.ui.spec.ts` using the fixture.
Use `async` methods for actions and plain methods for locators. Every UI test also fails on
uncaught JS errors, console errors and 5xx responses.

## Currently covered

Auth, Students and Fees on both layers. Everything else shows up under **Coverage** as untouched.

## Known product findings this suite surfaces

See the Failures tab; at the time of writing: missing required query params and malformed enum
bodies return 500 instead of 400, an invalid enum query param returns 404 with an internal class
name, any password (even one character) is accepted, payments larger than the invoice are
accepted, and the first concurrent invoice generation deadlocks on `fee_document_counters`.
Tests asserting the *correct* behaviour are deliberately left failing.
