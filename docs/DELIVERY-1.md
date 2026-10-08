# Keystone PM — Delivery 1

Rebuild of the Claude Design prototype `design/Keystone PM v8.dc.html` as a Next.js 16 full-stack app.
Delivery 1 covers the foundations, the portfolio, the project register and the core planning and cost screens.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/` (00 overview → 12 coverage).

## 1. Status at hand-over (8 Oct 2026)

> **Delivery 2 has landed.** This file describes Delivery 1 as it was handed over. For the current status, data,
> `TODO(db)` list and APIs, read `docs/DELIVERY-2.md`. In particular, sections 3, 5 and 8 below are partly outdated.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 33 files, 318 tests, all passing (golden values computed from the prototype logic) |
| `npm run build` | succeeds (Next 16.4 / Turbopack), all app routes dynamic |
| `npm run db:generate` | "No schema changes" — one migration, `drizzle/0000_living_gateway.sql` (40 tables). Delivery 2 added `0001_colorful_speedball.sql` |
| Route matrix on `next start` with a fresh DB | 15 routes × 8 personas × FR/EN = 240 requests, all 200, no server error in the log |

Routes in the matrix: `/`, `/my/projects`, `/portfolio/overview`, `/portfolio/projects`, `/projects/HLT-026/plan`,
`/projects/HLT-026/plan?act=A1250`, `/projects/HLT-026/schedule`, `/projects/HLT-026/budget` (`?tab=setup`, `?tab=cash`),
`/projects/NDC-031/budget`, `/projects/RCF-019/schedule`, `/projects/EWA-051/plan` (project without data → empty state),
`/resources` (coming-soon page at Delivery 1; a built screen since Delivery 2), `/dev/components`.

## 2. How to run

```bash
npm install
npm run dev          # http://localhost:3000
```

- **First request** creates the local database in `./.data/pg` (PGlite, embedded Postgres), applies `./drizzle` and
  seeds it from the prototype. Nothing else to set up.
- **View as**: the persona switcher sits at the bottom of the sidebar (8 personas: Portfolio director, Project manager,
  Head of engineering, Structural engineer, Engineering lead, Quality manager, Procurement & stock, Client). It stands in for
  authentication; switching lands on Home. Stored in the `ks-role` cookie.
- **FR / EN**: segmented control in the page header. French is the default. Stored in the `ks-lang` cookie.
- **Other preferences** (cookies): sidebar sections `ks-nav`, last project `ks-project`, portfolio zone `ks-zone`.
- **Status date**: the data set is frozen at Fri 25 Sep 2026 (`STATUS_DATE` in `src/lib/format.ts`); the real clock is not used.
- Other scripts: `npm run build && npm start` (production), `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run db:generate` (after a schema change), `npm run db:reset` (deletes `./.data`; stop the server first).
- `/dev/components` is the design-system gallery. It returns 404 in production unless `KS_DEV_GALLERY=1` is set.
- `npx tsx --conditions=react-server scripts/db-check.ts` builds a throw-away database and prints row counts and golden checks.

## 3. Data

- **Database**: Drizzle ORM over PGlite in development (`src/server/db/client.ts`); the target is Postgres (swap the driver,
  schema and queries stay). Schema in `src/server/db/schema/` (organisation, portfolio, planning, cost, change), seeders in
  `src/server/db/seed/`. Codes are stored, never translated labels.
- **Seed**: `src/server/prototype/prototype-data.json` (every prototype constant by name) and `prototype-generated.json`
  (`initialProjects`, `projectData` for the 6 projects with data, `genPOs`). 17 projects; HLT-026, NDC-031, RCF-019,
  ERP-202, WSA-044 and MSR-012 have planning and cost data. The other 11 show empty states (never Harbor Line's data).
- **Modelled in the DB**: people, departments, zones, clients, users; lifecycle stages, transitions, stage deliverables;
  machine types and templates; projects, sites, members; WBS nodes, activities, links, assignments, milestones, schedule
  bars, pipeline plans, project controls; cost categories, work-package budgets, offer quotes, cost streams, EVM periods;
  change requests, approval steps, CR↔WBS, budget change lines, baselines.
- **Not modelled yet** (read from the prototype JSON at its initial state, marked `TODO(db)`): tasks/to-dos, resource
  requests and loads, notifications, ECOs, parts, drawings, POs, NCRs, risks, skills, client deliverables, contract and billing.
- **Writes that persist**: project stage moves and forced stage changes, stage deliverable ticks, new projects (wizard),
  Plan inline edits / add / move / remove / progress update. Re-baseline is toast-only, as in the prototype.

## 4. What is implemented

7 of the 59 registry screens are built (`built: true` in `src/config/screens.ts`). Every other screen is reachable from the
sidebar, search and links, and renders a "This module is being built" page with its spec reference.

### Shell (spec 01)
- Sidebar: page search, fixed entries, role-gated sections and Project groups, collapsible state persisted, badges,
  "Outside my workspace" section, View as switcher.
- Header: breadcrumb with extras, title, project switcher (search by code and FR/EN name), status date, FR/EN,
  Export (coming-soon toast), global search (⌘K), notifications panel with unread count.
- "Outside my workspace · Read-only" banner and gating; zone bar on zone screens; toasts.
- Esc closes every popover and returns focus to its trigger; popovers also close on an outside click.
- The "My tasks" badge and "My work" breadcrumb follow the viewer (not Hélène Sauvage, 00 §7.16).
- Switching project keeps `?tab=` and `?view=` and drops selections such as `?act=`.

### Home (spec 03 §1)
- All 8 persona variants: greeting, KPI tiles, cards and rows with deep links (`?cr=`, `?po=`, `?eco=`, `?dwg=`, `?part=`, `?tab=`, `/my/tasks/[id]`).
- Director KPIs and "Needs attention" are shared with the Portfolio overview.
- "New project" shows for director and PM only.

### My projects (spec 03 §4)
Cards for every persona, with role, read-only flag, health indicators, next milestone, forecast finish and open tasks.
Shows the fallback notice when the viewer has no project.

### Portfolio overview (spec 03 §2)
KPI tiles, project table, spend vs earned bars and alerts. Filtered by zone (zone bar); shows the empty-zone notice when a zone has no project.

### Projects register (spec 03 §5)
- Three views (`?view=`), stage slider (`?status=`), search (`?q=`).
- Status "Move to" menu and stage deliverable ticks, both saved to the database.
- New project wizard (persists the project, its next number and analytic code). Force stage change dialog (saved as pending validation).

### Plan — WBS & activities (spec 05 §2)
- Structure and Progress views (`?view=`) and KPI tiles.
- Activity drawer (`?act=`): links, to-dos, requests, cost.
- Inline edits saved to the database, add work package or activity, move or remove (with confirmation), progress update form.
- Read-only rendering for viewers who can't edit. French day unit "j".

### Schedule (spec 05 §1)
- Gantt with today line, slips and milestones; progression chart (planned vs actual); KPIs.
- Re-baseline dialog for the director, and for the PM on their own project.
- Empty states for projects without packages or milestones.

### Budget & cost (spec 04 §1)
- Performance tab: KPIs, EVM S-curve (760×290), cost breakdown.
- Structure & changes tab (`?tab=setup`): categories, work-package budgets, change requests.
- Cash & recovery tab (`?tab=cash`): contract, milestones, cash curve. Only HLT-026 has a contract; other projects show an empty state.
- Edit controls are hidden when the viewer can't edit.

### Platform
- Design system: Nocturne tokens and classes, `components/ds`, shared app components, SVG charts.
- FR translation engine (prototype dictionary + rules + `src/i18n/extra/*.json`).
- Domain modules with golden tests: `evm`, `health`, `lifecycle`, `schedule`, `schedule-gantt`, `portfolio`, `home`.

## 5. Known gaps — `TODO(db)` and placeholders

`grep -rn "TODO(db)" src` (23 markers):

| Where | What is still read from the prototype / not persisted |
|---|---|
| `src/server/dal/shell.ts:4, 31, 248, 304, 353, 357, 361, 388` | Nav badges, breadcrumb extras, notifications, global search hits (tasks, parts, resource pool, POs, ECOs, CRs, NCRs, risks, drawings, installed base) |
| `src/server/dal/home.ts:5, 36, 49, 55` | Resource requests, people loads, tasks, ECOs, parts, drawings, skills, POs, client deliverables (Harbor Line only), next invoice ("Milestone 4") |
| `src/domain/home.ts:266, 453` | ECO effectivity lock; "Unmet demand 240 h" / "Peak weeks 41–43" constants |
| `src/server/dal/portfolio.ts:47` | Open tasks per project (prototype TODOS) |
| `src/server/dal/plan.ts:146, 154, 161`, `src/features/plan/drawer-model.ts:124` | Template index; to-dos and resource requests of the drawer; A1250 "second crew (CR-008)" cost note |
| `src/server/dal/budget.ts:73` | Contract, amendments, milestones, invoices; `openCommit` 713 k€ literal for HLT-026 |
| `src/features/schedule/actions.ts:14` | Re-baseline should write a `baselines` row (proposed, linked to a CR) |

Other gaps:
- **52 screens not built.** They show the coming-soon page: My work and task, My approvals, Documents, client portal,
  Resources and HR, Change control, Risks, Contract/Billing, supply chain, engineering/PLM, quality, site, settings, among others.
- **Coming-soon toasts** (the prototype controls do nothing):
  - Header Export.
  - Plan: Calendar and Baseline chips, Reschedule, Set baseline, Add relationship, Add to-do.
  - Budget: Add category, category pencil, New change request.
- **No scheduling engine.** The driving predecessor is the first one listed; editing durations or links does not move dates.
- **Forced stage changes** are stored as pending validation, but nothing shows them yet (My approvals is not built).
- **Resource requests** badge and the "R. Aubert, project manager" breadcrumb are still hard-wired to R. Aubert for
  non-PM personas (08 OQ18).
- **No authentication.** The persona comes from a cookie (00 §8.12); permissions are checked server-side against that persona.
- **Portfolio alerts** are the prototype's static list (`src/domain/portfolio.ts:142`), not generated from rules.
- **Still in English in French mode, as in the prototype:** data text such as task, ECO and CR titles and work-package names.
  To-do titles are translated piece by piece, which can mix languages.

## 6. Deliberate deviations from the prototype

Defects listed in spec 00 §7.16 are not reproduced. Projects without data show empty states, and the member sees their own work.
The client's CR figures are derived, the procurement tile shows "Late deliveries", and codes are stored rather than labels.

| Area | Prototype | Rebuild |
|---|---|---|
| Zone, tabs, views, selection | `this.state` | URL search params (`?tab=`, `?view=`, `?act=`, `?q=`, `?status=`); zone kept in a cookie (not `?zone=`) |
| Project switcher search | matches code and English name | also matches the displayed French name |
| Overview "Active projects" | always "6 projects · FY2026" | counts the rows shown (identical without a zone filter) |
| CPI with no actual cost | division by zero | CPI 1, EAC = budget |
| Progress / spend bars | overflow their track (e.g. HRM-011 106 %) | clamped at 100 % (shared ProgressBar) |
| French project names and milestones | split on " — ", partly English | fully translated (`#032 · Migration ERP — Phase 2`, 15 milestone names). The header picker and register still translate "#id · name" as one string |
| French day unit | "d" | "j" (Plan, Schedule; 05 OQ23) |
| French grammar | "1 catégories", "1 non respectées", "1 ouvertes" | singular forms added |
| Force dialog approver | French title in EN mode | translated with the UI |
| Outside-workspace mode | status menus, ticks, WBS inputs still work | disabled / hidden |
| Plan "Next start" KPI | first in list order | sorted by start date |
| Plan baseline chip | fixed "BL1 · 12 Mar 2026" | the project's own baseline date |
| Plan inline edits | save on every keystroke, bad predecessors dropped silently, no confirm on delete | save on blur, Enter or pause; inline error; confirmation |
| Plan read-only | shows nothing / editable fields for everyone | text values, gated inputs |
| Plan "Show in Gantt" | drawer reopens on return | does not reopen |
| New project wizard | keeps values after creation (03 OQ12) | clears after creation (keeps them on close) |
| Schedule incomplete data | NaN % / Infinity % | empty cells, "—" |
| Budget tab on project switch | global tab state | `?tab=` / `?view=` carried over |
| Budget FR | "Réservation" | "Réserve"; strings the prototype leaves in English are translated (04 §0.7) |
| Popovers | no outside-click / Esc handling | Esc + outside click close, focus returned |
| Accessibility additions | — | slider label "Stage", work-package input label, `role="cell"` on Plan cells, focus traps in dialogs |

Kept on purpose although questionable (spec open questions):
- Budget KPIs are always shown in the attention colour, and variance bars don't show their sign (C-1).
- The outline status buttons for Initiative, APS, APD and Garantie show the browser's grey button background (shared `StatusTag.module.css`).
- Schedule package bars come from their own table, not from WBS roll-ups (A-7).
- Plan's "critical path" KPI counts activities that are behind (S-1).

## 7. Open questions blocking the next steps

The IDs refer to spec 00 §10.

| ID | Question | Blocks |
|---|---|---|
| P-1, P-2 | Outside-my-workspace: block (403) or read-only (read-only is implemented)? Ownership rules for englead, quality, procurement, depthead, member | Permission model, every new screen |
| P-13, I-2 | Real identity provider and users replacing the View as cookie; hard-coded actors (R. Aubert requests, comment author, new-project PM) | Phase 0 exit, My work, requests |
| A-2 | Should project creation instantiate the machine-type template (WBS, activities, cost categories)? Today new projects have no data | Projects without data, wizard |
| A-3, A-13 | Which stages count as "active" on the Overview; one health rule (clamped vs unclamped CPI, Settings thresholds) | Overview, register, Home |
| A-7, S-1, S-8 | Schedule from WBS roll-ups; CPM engine in scope; critical-path definition; calendar vs working days | Schedule, Plan Reschedule / Set baseline |
| S-3, L-1, L-2 | Re-baseline as an approval workflow tied to a CR; what the director does with forced stage changes; when BL1 is frozen | Re-baseline persistence, My approvals |
| A-4, C-2, C-3 | One change-request dataset; real EV/AC sources; behaviour of Add category / New change request | Change control, Budget edits |
| A-5 | Billing source of truth (`CONTRACTS` vs `BILLING` vs "Milestone 4 invoice") | Contract/Billing, Cash tab, client home |
| A-12 | Hard-coded KPIs (unmet demand 240 h, peak weeks, portfolio margin…) need formulas or sources | Home, Resources |
| X-1, X-2, X-12 | Default language per user; route scheme (e.g. `/resources/approvals/[dept]`, `?zone=`); EN labels for French domain terms | Routing, i18n QA |
| X-3 | What the header Export produces per screen | Export |

## 8. For the next team

- **Routes**: always via `screenHref(id, { code, taskId })`. Flip `built: true` in `src/config/screens.ts` when a screen lands.
  Unknown project screens fall through to `src/app/(app)/projects/[code]/[...rest]/page.tsx`.
- **Project context**: `src/app/(app)/projects/[code]/layout.tsx`; helpers in `src/server/project-context.ts`
  (`getProjectContext(code, screen)` → `readOnly`, `outside`, `canEdit(screen)`). Screens must hide edit controls when
  `outside` or `readOnly`.
- **Shell APIs**:
  - `PageHeader` takes an optional `taskId`.
  - `defaultTitleOf(screen, { taskId })` and `crumbExtraOf` are in `src/server/dal/shell.ts`.
  - `swapProjectInPath(pathname, code, search?)` is in `src/components/app/shell/nav-model.ts`.
  - `COOKIE_NAV` is in `src/components/app/shell/types.ts`.
- **Reusable logic**:
  - `src/domain/portfolio.ts`: `portfolioKpis`, `projectIndicators`, `myProjectRole`, `myProjectsModel`.
  - `src/domain/home.ts`: `renderTxt` with `{key|lc}`.
  - `projectName(p, t)` is in `src/features/portfolio/view.tsx`.
  - `slipText(s, lang)` is in `src/features/schedule/i18n.ts`.
- **Server actions**:
  - `src/features/projects/actions.ts`: `moveStageAction`, `setDeliverableAction`, `createProjectAction`. `NewProjectButton` is used by Home, Overview and Projects.
  - `src/features/plan/actions.ts`: `editActivity`, `renamePackage`, `moveActivity`, `removeRow`, `addActivity`, `addWorkPackage`, `saveProgress`.
  - `src/features/schedule/actions.ts`: `rebaselineSchedule`.
- **Retiring a `TODO(db)`**: model the module in `src/server/db/schema/<domain>.ts` and add a seeder.
  Then run `npm run db:generate`, switch the DAL block to the DB and keep the golden tests green.
