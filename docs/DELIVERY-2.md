# Keystone PM — Delivery 2

Delivery 2 adds cost, change and risk control, plus resources and personal work (spec 00 §9, phases 3 and 4).
It also moves the shell, Home, My projects and Plan from prototype constants to the database.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Delivery 1 baseline: `docs/DELIVERY-1.md`.

## 1. Status at hand-over (8 Oct 2026)

> **Delivery 3 has landed.** This file describes Delivery 2 as it was handed over. For the current status, data,
> `TODO(db)` list and APIs, read `docs/DELIVERY-3.md`. In particular, sections 3, 5 and 8 below are partly outdated.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 63 files, 668 tests, all passing (Delivery 1: 33 files, 318 tests). Golden values are computed from the prototype logic. |
| `npm run build` | succeeds (Next 16.4 / Turbopack), all 28 app routes dynamic |
| `npm run db:generate` | "No schema changes". Two migrations: `drizzle/0000_living_gateway.sql` (40 tables) and `drizzle/0001_colorful_speedball.sql` (35 new tables, 3 new columns) |
| `scripts/db-check.ts` | "All checks passed", including the new "Delivery 2 data" and "Numbering & writes" blocks |
| Route matrix on `next start` with a fresh DB | 22 routes × 8 personas × FR/EN = 352 requests, all 200, no server error in the log; re-run after the mutations below, same result |
| Feature reviews | Seven fidelity reviews (risks, changes, resources, requests, mywork, myapprovals, hr) re-ran the prototype's own logic in node and compared it with the rebuild's view models on a seeded database, in EN and FR, for every persona and the 6 projects with data. English matches the prototype; the French differences are the deliberate ones in §6. They fixed 27 deviations (summary in §6.1) and added golden tests for each. |

**Route matrix:** `/`, `/my/tasks`, `/my/tasks/T-2314`, `/my/approvals`, `/resources`, `/resources/requests`,
`/resources/approvals/engineering`, `/resources/what-if`, `/resources/skills`, `/resources/leave`, `/resources/rates`,
`/projects/HLT-026/{risks, contingency, changes, trends, resources, hours, budget, plan}`, `/projects/NDC-031/risks`,
`/projects/EWA-051/changes` (project without data, so it shows the empty states) and `/portfolio/projects`.
- The server ran on port 3110 because port 3100 is used by another project's `next dev`. The log is `/tmp/ks-d2-final.log`.
- None of these routes shows the "being built" page any more (checked on every response, EN and FR wording).

**Extra routes:**
- `/resources/approvals` redirects (307) to the viewer's department.
- These return 404: an unknown department, `/my/tasks/T-9999`, an unknown project code, and `/dev/components` in production.
- A malformed escape in the path (e.g. `/resources/approvals/%E0%A4%A`) gets a plain 500 "Internal Server Error" from Next
  itself, on every route, before the app runs. The Approvals page's own 404 guard only applies when the router hands it the raw value.
- These deep links return 200 for director, PM, member and client: `?cr=`, `?risk=` (any case), `?act=`, `?project=`
  (HLT-026 and NDC-031, which has no levelling context), `?view=board|calendar`, `?new=1`, `?kpi=`, `?filter=`, `?person=`,
  `hours?view=unassigned`, and the EWA-051 risks, trends, resources, contingency and hours empty states.
- A second pass covered 13 more routes for every persona in FR and EN: the remaining Delivery 1 routes and the deep links.
  All 208 requests returned 200, with no server errors. The routes were `/my/projects`, `/portfolio/overview`, `plan?act=A1250`,
  `schedule`, `budget?tab=setup|cash`, NDC-031 budget, RCF-019 schedule, EWA-051 plan, `changes?cr=CR-008`,
  `risks?risk=R-03`, `/my/tasks?view=board` and `/resources/what-if?project=HLT-026`.

**Outside-my-workspace banner** (EN render; `O` = banner, read-only; re-checked at the final integration):

| Route | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| `/my/tasks`, `/my/tasks/T-2314` | | O | O | | O | O | O | O |
| `/my/approvals` | | | | O | | | | |
| `/resources` | | O | | O | O | O | | O |
| `/resources/requests` | | | | O | | O | O | O |
| `/resources/approvals/engineering` | | O | | O | O | | O | O |
| `/resources/what-if` | | | | O | O | O | O | O |
| `/resources/skills` | | | | | | O | O | O |
| `/resources/leave` | | | | | | | | O |
| `/resources/rates` | | | O | O | O | O | O | O |
| `/projects/HLT-026/risks` | | | O | O | O | | O | O |
| `/projects/HLT-026/contingency`, `/projects/HLT-026/resources` | | | O | O | O | O | O | O |
| `/projects/HLT-026/changes`, `/projects/HLT-026/trends` | | | O | O | O | O | O | |
| `/projects/HLT-026/hours` | | | | O | O | O | O | O |

**Mutations tested at the final integration** (fresh DB, by posting Server Functions to `next start`, in this order;
badges and queues read back from the rendered pages):

| Feature | Action | Result |
|---|---|---|
| Notifications | PM marks n2 read | PM's bell 4 → 3; director's stays at 3 |
| My work | client sets T-2305 status | refused ("Read-only — outside my workspace") |
| My work | member marks T-2305 done | My tasks badge 1 → none |
| My work | member comments T-2305 | comment signed Julien Wagner |
| My work | member adds a checklist item to T-2314 (not his task) | refused |
| My work | member logs "2,5" h on T-2305 | recorded |
| Requests | member approves RQ-041 | refused |
| Requests | department head approves RQ-041 | creates T-2341; member's bell 2 → 3; Plan drawer of A1250 no longer lists RQ-041 |
| Requests | PM sends a request (A1260, Julien Wagner, "12,5" h) | RQ-045 |
| Change control | PM submits CR-009 | Change control badge 1 → 2; director and client My approvals queues +1 (5 → 6, 3 → 4) |
| Change control | director approves his CR-008 step | recorded |
| My approvals | client approves CR-008 inline | status stays "In review"; client queue −1 (4 → 3), director's unchanged (6). On a DB where CR-009 was not submitted: client 3 → 2, director 5 |
| Change control | director records the CCB step of CR-008 | CR-008 "Approved"; director queue 6 → 5 |
| Trends | generate status report | toast "Status report generated · PDF ready" |
| Risks | PM raises R-07 to P4, response Transfer | Risks badge 1 → 2 |
| Risks | member closes R-03 | refused |
| Risks | PM closes R-03, then registers "Port strike" (P5, I3) | R-21; badge stays 2 |
| Contingency | PM draw-down "12,5" | recorded; member draw-down refused |
| What-if | PM toggles a lever, creates "Scenario C" | recorded |
| Rates | director sets a rate | recorded |
| Rates | member sets a rate | refused |
| Skills | director adds a skill | recorded |
| Hours | PM imports Lucca on HLT-026 | "10 lines matched · 2 to assign" |
| Hours | director imports Lucca on NDC-031 (no import yet) | "No hours declared in Lucca for this period"; the PM (not his project) is refused |
| Notifications | member marks all read | bell → none |

The integration report before the reviews said the client's approval left the client queue at 3 and raised the director's
to 6. That was the effect of the CR-009 submission made just before, not of the approval.

## 2. How to run

Nothing changed from `DELIVERY-1.md` §2 (`npm install`, `npm run dev`, View as, FR/EN, cookies, status date frozen on 25 Sep 2026).

- An existing `./.data` from Delivery 1 has no Delivery 2 tables or seed. Run `npm run db:reset` (server stopped) once.
- The persona now drives:
  - My work (the viewer's own tasks).
  - The authors of comments, requests, decisions and audit rows.
  - The notification read state, saved per user in the database (not in sessionStorage any more).
- `npx tsx --conditions=react-server scripts/db-check.ts` checks the new seed against the prototype, and the numbering
  of new risks, change requests, requests and tasks, on a throw-away database.

## 3. Data

### Newly modelled (migration `0001`, schema in `src/server/db/schema/`, seeders in `src/server/db/seed/`)

| Schema file | Tables | Seeded from |
|---|---|---|
| `work.ts` | `tasks`, `task_checklist_items`, `task_comments`, `task_attachments`, `time_entries`, `resource_requests`, `resource_request_events`, `request_activity_choices` | TODOS, DESC, CHECKS, COMMENTS, FILES, ENTRIES; REQUESTS (decision trail parsed from `sent` / `response`) |
| `control.ts` | `risks`, `status_snapshots`, `status_reports`, `contingency_registers`, `contingency_draws` | RISKS_HLT for HLT-026; the other 5 projects with data get the prototype's generated registers (R-01…R-04, EMV scaled to BAC). HLT_SNAPS, plus 13-week linear series ending at the live EVM for other projects. CONTINGENCY (HLT-026). |
| `resources.ts` | `allocations`, `rate_roles`, `rate_multipliers`, `job_title_rates`, `skills`, `person_skills`, `certifications`, `leave_types`, `leave_entries`, `public_holidays`, `hours_imports`, `hours_lines`, `unassigned_hours`, `whatif_levers`, `whatif_auto_levers`, `whatif_contexts`, `whatif_scenarios`, `whatif_scenario_levers` | PEOPLE (weekly loads), RATE_ROLES, MULTS, RATES, SKILLS, SKILL_LV, CERTS, LEAVE_DAYS, LEAVE, Settings holidays, HOURS (HLT-026), LEVERS, AUTO, HLT-026 scenarios A/B |
| `platform.ts` | `notifications`, `notification_recipients`, `activity_events`, `audit_entries` | NOTIFS (each audience role expanded to the users who hold it, with their seed read flag), ACTIVITY, AUDIT |

New columns:
- `persons.resource_pool_position`
- `projects.short_name`
- `change_request_steps.decided_at`

Projects without data have no risk register, snapshots, team, hours or what-if context. They show empty states, never Harbor Line's data.

### Writes that persist (new in Delivery 2)

Every write is checked server-side against the persona and the project read-only rule. It records the viewer as the
actor in `audit_entries` / `activity_events` and revalidates the affected screens and badges. Since the reviews this
includes task checklist ticks and items, comments, time entries and new what-if scenarios. "New risk" and "Record
draw-down" answer non-text values from a forged request with the normal validation message instead of throwing.

- **My work / Task:**
  - Status, % (the two stay consistent, applied in one transaction), Mark done, list toggle.
  - Checklist: tick an item, add an item.
  - Comments; time entries (0 < h ≤ 24, logged on the status date).
- **Resource requests:**
  - Send, withdraw, re-request, accept a proposed reschedule.
  - Approve: creates the task (T-2341…) and notifies the requester and the person.
  - Propose a reschedule (shift + reason), reject (reason).
- **Change control:**
  - New change request (CR-011…, justification stored), submit for review.
  - Approval-step decisions, from the drawer or inline from My approvals. The portfolio director records the change control board step.
  - An approved CR with a proposed baseline makes it current (CR-009 → BL2).
- **Trends:** generate status report (a `status_reports` row and a toast; no document yet).
- **Risks:** new risk (R-21…), drawer edits (P, I, response), close and reopen.
- **Contingency:** record a draw-down. The first draw-down on a project creates the register with the default provision.
- **What-if:** priority, lever toggles, auto-level, select scenario, new scenario.
- **HR:**
  - Rate card: base rates and multipliers saved on blur or Enter; Add role.
  - Add skill (a new matrix column).
  - Import Lucca hours (re-stamps the import with real counts); Assign unassigned hours to a work package.
- **Notifications:** mark one as read, mark all as read (per user).

### Still not modelled (read from the prototype JSON, marked `TODO(db)`)

- ECOs, parts, drawings, installed base.
- Purchase orders, goods receipts, supplier invoices, RFQs.
- NCRs, client deliverables, the Codex index.
- Contract, amendments, billing.
- Documents, stock, claims, connectors, meetings, interfaces, punch list, engineering checks, P&ID, site.
- The Lucca connector: leave is a seeded mirror, and "Sync Lucca" fetches nothing.

## 4. What is implemented

23 of the 59 registry screens are built: the 7 from Delivery 1 plus 16 new ones, all `built: true` in `src/config/screens.ts`.
The other 36 still render the "This module is being built" page.

### My work — `/my/tasks` (spec 10 §6)
- Shows **the viewer** (not Hélène Sauvage).
- Director, PM, department head, quality and procurement can open someone else's work with `?person=Full Name`; the person chip becomes a switcher.
- KPI tiles; groups Overdue / Today / Next week / Later / Recently done.
- Views (`?view=`):
  - List, with the done toggle.
  - Board, by status.
  - Calendar: two working weeks, `?week=n`, hours row.
- Primary "Log time" opens the person's first open task.
- Read-only outside the workspace: every role except director and member.

### Task — `/my/tasks/[taskId]` (spec 10 §7)
- Header with breadcrumb "My work · T-2314". Primary "Mark done".
- Status and % segments, kept consistent.
- Checklist: tick and "Add an item…".
- Comments, authored by the viewer.
- Files: "Attach" shows a toast.
- Time log with entries; labour cost note in €.
- Plan card: activity, float, critical-path notice.
- Who may edit:
  - Assignee and director: status, %, checklist and time.
  - Anyone inside the workspace: comments.
- An unknown task returns 404.

### My approvals — `/my/approvals` (spec 08 §7, 00 §7.8)
- One inbox built by the provider registry `src/server/approvals/` (one provider per kind, prototype push order). Kind chips filter with `?filter=<kind>`.
- KPI tiles, including "Decided this week".
- Kinds and how they are decided:
  - **From the database:** resource requests (the row links to the Approvals screen), change requests (decided inline through Change control), forced stage changes (informational, L-1).
  - **Still from prototype data, decisions are previews (toast):** POs, ECOs, delivery QC, deliverables, RFQs, invoices, NCRs, Codex documents.
- Project-bound kinds follow the current project (`ks-project` cookie).
- Inline Approve / Reject buttons name their item ("Approve CR-008"). A failed change-request decision shows the toast
  "The decision could not be saved".
- The sidebar badge and My projects "Pending decisions" use `approvalCount`.

### Risk register — `/projects/[code]/risks` (spec 07 §2.1)
- Five KPI tiles. Exposure is compared with the contingency (e.g. 340 k€ = 227 % of 150 k€).
- Category chips (`?filter=`, Settings order), table sorted by score, 5×5 heat map of open risks.
- Drawer `?risk=R-03` (any case): assessment, links, P/I/response edits, close and reopen. "What-if levelling" opens
  the risk's own project (`/resources/what-if?project=<code>`).
- Primary "New risk".
- The sidebar badge follows the register.
- A project without a register shows an empty register.

### Contingency register — `/projects/[code]/contingency` (spec 04 §5)
- Initial provision: the stored register, else round(BAC × 3 %).
- Drawn and remaining, use vs project progress, open-risk exposure, three bars, draw-downs most recent first.
- Primary "Draw-down". Approvers are the project's PM and the portfolio director.

### Change control & baselines — `/projects/[code]/changes` (spec 07 §2.2)
- KPI row, type chips (`?filter=budget|scope|schedule`), register.
- Drawer `?cr=`:
  - Impact list and approval chain (each dot carries its state, e.g. "Portfolio director · Pending").
  - Decisions only for the owner of the pending step; the director records the CCB step. Each Approve / Reject
    button names its step for screen readers.
  - Submit for review.
- Baseline register (BL0–BL2).
- Primary "New change request". `?new=1` opens the form on arrival; Budget's "New change request" uses it.
- The sidebar badge follows the register.

### Trends & status report — `/projects/[code]/trends` (spec 04 §2)
- KPI row; six indicator cards with their 4-week delta and sparkline.
- 760×220 trend chart (`?kpi=cpi|spi|eac|float|risk|slip`); snapshot history, newest first.
- Primary "Generate status report".

### Project resources — `/projects/[code]/resources` (spec 06 §1)
- Project banner and 5 KPI tiles.
- Allocation heatmap of the project team.
- Capacity vs demand per department of the team (320 h per person); "No department to compare yet" without a team.
- "Suggested rebalancing", HLT-026 only. "Apply" shows a toast.
- Primary "Request resource".
- A PM is read-only on another PM's project.

### Hours — Lucca reconciliation — `/projects/[code]/hours` (spec 06 §5)
- KPIs; views by resource, by work package, and to assign (`?view=resource|wp|unassigned`).
- "Assign" routes unassigned hours to a level-1 work package. Editors only.
- Primary "Import Lucca" for editors on every project, as in the prototype. On a project without an import it answers "No hours declared in Lucca for this period".

### Resources — `/resources` (spec 06 §1)
- 5 KPI tiles; heatmap of the pool over 8 weeks with load bands and links to each person's My work.
- Capacity vs demand by department; suggested rebalancing.
- Primary "Request resource", which opens the New resource request dialog.

### Resource requests — `/resources/requests` (spec 08 §5)
- Outbox of the viewer: the requests a PM, department head or engineering lead sent.
- The director, and viewers outside the workspace, see every request, read-only except their own.
- KPIs, status chips (`?status=`), rows with the 3-step stepper and decision lines.
- PM actions: withdraw, accept reschedule, re-request.
- "New request" dialog: activity, weeks, duration, hours, routing sentence.

### Approvals — `/resources/approvals/[dept]` (spec 08 §6)
- The department is in the path. `/resources/approvals` redirects to the viewer's department, and the sidebar entry highlights on every department.
- Head, KPIs, queue with load impact, decided list, team heat.
- "Approve & send to <first name>" (to procurement for contract roles), propose reschedule, reject. The reason field
  takes focus; Esc or Cancel returns focus to the button that opened it.
- Director, department heads and quality may decide for any department (08 OQ19).
- Primary "Team capacity".

### What-if levelling — `/resources/what-if` (spec 05 §4)
- Levelling context of `?project=`, defaulting to HLT-026, the only project with one.
- KPI tiles; base figures come from the data.
- Two scenario cards: levers, priority segment, auto-level, select. Side-by-side table.
- Primary "New scenario" adds a card with no levers.
- Editable inside the workspace (director, PM, department head), except by a PM on another PM's project.

### Skills matrix — `/resources/skills` (spec 06 §3)
- KPIs, skill chips (`?filter=<index>` shows people at level ≥ 3).
- People × skills matrix, certifications, single-expert coverage.
- Primary "Add skill".

### Leave & working calendar — `/resources/leave` (spec 06 §4)
- KPIs, public-holiday row, available hours per person over 8 weeks with leave codes.
- Primary "Sync Lucca" shows a toast only.

### Rate cards — `/resources/rates` (spec 06 §2)
- KPIs, base rates and multiplied rates, recomputed live and saved on blur or Enter.
- Values are visible to director and PM only. Others get "•••" and the lock banner, and the values are never sent to their browser.
- Primary "Add role".

### Shell and Delivery 1 screens (now read from the database)
- **Sidebar badges:**
  - My tasks: the viewer's open tasks due today.
  - Resource requests: proposed reschedules among the requests the viewer sees.
  - Approvals: pending requests of the viewer's department.
  - Risks, Change control and My approvals: from the database.
- **Breadcrumb extras and default titles** follow the viewer (no fixed R. Aubert or Hélène Sauvage). The task title comes from the database.
- **Notifications** come from the database with a per-user read state. A click and "Mark all read" call Server Functions; optimistic marks are kept per persona.
- **Global search:** change requests, risks and people come from the database.
- **Home:** requests, pool loads, departments, tasks, skills and certifications come from the database.
- **My projects:** open-task counts and "Pending decisions" come from the database.
- **Plan drawer:**
  - To-dos and requests come from the database (`getPlanTodos(code)`, `getPlanRequests(code)`).
  - The A1250 "second crew (CR-008) pending approval" note shows only while CR-008 is in review.

### Platform
- Domain modules with golden tests: `approvals`, `change-control`, `contingency`, `hr`, `requests`, `resources`, `risk`, `tasks`, `trends`, `whatif`.
- i18n: `src/i18n/extra/{changes,hr,myapprovals,mywork,requests,resources,risks}.json`. Feature `i18n.ts` helpers build the parameterised French sentences the shared rules miss.

## 5. Known gaps — `TODO(db)` and placeholders

`grep -rn "TODO(db)" src` (32 markers):

| Where | What is still read from the prototype / not persisted |
|---|---|
| `src/server/dal/shell.ts:7, 49, 380, 387, 414` | Badges, crumbs and search hits of unmodelled modules: documents, ECOs, invoices, stock, claims, connectors, meetings, interfaces, contracts/billing, punch list, engineering checks, P&ID, site, NCRs, POs, deliveries, client deliverables, parts, drawings, installed base |
| `src/server/dal/home.ts:6, 41, 51, 57` | ECOs, parts, drawings, POs, client deliverables (Harbor Line only), next invoice ("Milestone 4") |
| `src/domain/home.ts:266, 453` | ECO effectivity lock; "Unmet demand 240 h" constant (A-12) |
| `src/server/dal/plan.ts:149` | Template index (DEFS idx) of a project is not stored |
| `src/features/plan/drawer-model.ts:127` | Activity ↔ change request link (CRs link to work packages only) |
| `src/server/dal/budget.ts:73` | Contract, amendments, payment milestones, invoices; `openCommit` 713 k€ literal for HLT-026 |
| `src/features/schedule/actions.ts:14` | Re-baseline should write a `baselines` row (proposed, linked to a CR) |
| `src/features/hr/actions.ts:94, 117`, `src/features/hr/leave-view.tsx:30`, `src/app/(app)/projects/[code]/hours/page.tsx:32` | Lucca connector: sync fetches nothing, the last-sync time is the prototype constant, and an import cannot create a project's first import (the dialog reports that no hours were declared) |
| `src/features/hr/skills-view.tsx:37` | "Open requests needing level ≥4" KPI is a prototype constant (06 OQ4, A-12) |
| `src/server/approvals/{purchase-orders, delivery-qc, invoices, rfq-awards, ecos, ncr-verification, deliverables, codex-documents}.ts:2`, `types.ts:26` | My approvals kinds still on prototype data (decisions are previews) |
| `src/domain/approvals.ts:83, 85` | Item builders of those kinds; the PO / receipt submitter is the prototype buyer literal |
| `src/server/prototype/index.ts:4` | Rule: prototype reads must be marked `TODO(db)` |

Other gaps:
- **36 screens not built:**
  - Client view, Documents, Portfolio schedule, Projects map, Prioritisation.
  - Cash, Contract, Billing, Meetings, Stakeholders, Interfaces.
  - Engineering (5 screens), P&ID, BOM, Quality, ITP, Site, Commissioning, REX.
  - PLM, ECO, Drawings, Procurement, Orders, Deliveries, Stock, Installed base, Warranty claims.
  - Settings, Machine types, Document types, Activity & integrations.
- **MVP scope** (phases 0–4) is complete except Settings, Machine types, Projects map and Portfolio schedule.
- **Coming-soon toasts.** Delivery 1's toasts are unchanged, except Budget's "New change request", which now opens the Change control form. New ones:
  - Task "Attach". The DAL `addTaskAttachment` exists but has no upload.
  - "Apply" on Suggested rebalancing (R-3).
  - "Sync Lucca".
  - My approvals preview decisions for unmodelled kinds.
- **Constants kept from the prototype** (A-12; no formula yet):
  - Resources "Unmet demand 240 h · Mostly engineering" (`src/domain/resources.ts:118`; the ROLES data give 280 h) and
    "Peak weeks 41–43" (`src/features/resources/model.ts:84`; Home: `src/domain/home.ts:452`).
  - Requests "Avg response" tiles 1.4 d / 0.9 d (`src/domain/requests.ts:55`).
  - What-if "People above 100%" sub "Weeks 41–43" (`src/features/resources/whatif-model.ts:43`).
  - Change control board "Monthly · next 8 Oct".
  - Skills "requests needing level ≥4" (`src/domain/hr.ts:161`).
  - Hours valuation at a flat 62 €/h (`src/domain/hr.ts:243`, A-10).
- **What-if** has a context only for HLT-026. "Select scenario → create requests" marks the scenario selected but creates no request (05 OQ11, S-7).
- **Forced stage changes** appear in My approvals but are informational: there is no validate or revert workflow (L-1).
- **Status reports** are recorded (`status_reports`), but no PDF or deck is produced (C-5).
- **Notifications** are created only by resource-request events: send, withdraw, re-request, approve, propose or accept a reschedule, reject. Other events (CR decisions, new risks, task comments…) notify no one yet (X-6).
- **No authentication.** Actors follow the View as persona (I-2).
- **Left open by the reviews** (no code change):
  - The task cost note shows the hourly rate to anyone who opens a task, the client included, as in the prototype; the
    director/PM-only rule covers the rate cards only (A-10).
  - Member, engineering lead and client following a `?person=` link (from Resources or Approvals) land on their own work without a notice.
  - An approved CR revises neither budget, schedule nor WBS (A-4). Rejecting CR-009 leaves BL2 "Proposed". Recorded status reports are not listed anywhere.
  - My approvals decides "who may approve" a CR by approver name, Change control by role and edit rights; the inline
    action does not re-run Change control's project edit check. Both agree for the seeded personas but could drift.
  - `src/i18n/extra/budget.json` translates "second crew", so RQ-043 reads "Steel connection checks — seconde équipe" in
    French on Home, the Plan drawer and My approvals. The Requests screens use `dataText` and keep the stored English.
  - Package names are partly translated in French (e.g. "1.2 CVC-élec — electrical & medical gas"), on My work as on Plan.
  - `isoOfDayOffset` (`src/server/db/codes.ts:306`) has the negative-offset bug fixed in `dayDate`; only the seeders use it, with dates from 21 Sep on.
  - The leave-availability functions of `src/domain/resources.ts` are tested but unused; `src/domain/hr.ts` has its own copy.
  - Resources "Labor cost to date" shows "—" when a project has no labour or staff cost category (the prototype fell back to the first category).
  - The Contingency register shows "No draw-down recorded yet" under an empty table; spec 04 §5.3 has no empty state there.

## 6. Deliberate deviations from the prototype

Delivery 1 deviations still apply (`DELIVERY-1.md` §6). New in Delivery 2:

| Area | Prototype | Rebuild |
|---|---|---|
| Hard-coded actors (00 §7.16, P-13) | My work = Hélène Sauvage; comment author = Marie Lefebvre; requests from R. Aubert, decided by "the department head"; contingency approvers "R. Aubert / M. Lefebvre" | The viewer everywhere. Contingency approvers are the project's PM and the portfolio director. Inbox items carry the real sender and sent date |
| Harbor Line fallback | Risks, trends, changes, team, baselines of HLT-026 on every project | Empty states for projects without data |
| Badges (My tasks, Resource requests, Approvals) | Fixed actors | Follow the viewer; the quality manager's Approvals badge counts the Quality department |
| My work person | Fixed, caret without handler | Viewer by default; `?person=` switcher for director, PM, department head, quality, procurement |
| Task status vs % | "Done" possible at 0 % | Done ⇔ 100 %; % > 0 on a to-do ⇒ in progress; 0 % on a done task ⇒ to do (10 OQ20) |
| Time log | Negative and unbounded hours accepted | 0 < h ≤ 24 |
| Task checklist "Add" | Not wired | Adds the item |
| Task cost note | "$" | "€" (RATES are €/h) |
| CR status | "In review" override stuck; CCB step has no actor, so CRs never reach Approved | Status derived from the chain; the portfolio director records the CCB (P-6) |
| CR justification | Collected, not stored | Stored (X-11, 07 OQ17) |
| Change control Baseline KPI | Static "BL1 / BL2 proposed · CR-009 draft" | From the baseline register |
| Trends | Axis labels such as "+8.649999999999999 d"; literal KPI subs | Whole days; subs and chart title from the snapshots |
| Contingency | "1 draw-downs"; unparsable amount stored as 0; "Linked to" prefilled with the literal "CR / risk / NCR" | Singular; amount must be positive (French comma accepted); placeholder only |
| My approvals | "Oldest" = last pushed item; delivery QC decision throws; "Decided this week" counts every role's ordered POs | Earliest date; previews never throw; only the kinds the viewer decides |
| What-if | Base figures literal; first tile "Baseline finish" shows the forecast | Figures from the data; label "Forecast finish" (05 OQ12) |
| Rate cards | Session-only edits; "Add role" toast; masked values still in the page | Saved; role appended; values never sent to non-director/PM viewers |
| Add skill | Toast | New matrix column, all levels 0 |
| Hours | Import toast "12 lines matched" (constant); analytic code "HAV004"; "Assign" without handler | Real counts; project's own code; Assign routes the hours to a work package (R-6) |
| Notifications | Read state kept for the session only (Delivery 1: sessionStorage) | Per user in the database |
| French | "w/c" left in English, "sept. 28" week labels, leave codes in English, "Demander" (verb) for the request noun, plural-only forms | "sem. du 28 sept.", "28 sept.", translated codes, "Demande" with feminine agreement, singular forms |
| Approvals department | Picked in screen state | In the route `/resources/approvals/[dept]` (X-2) |
| Change control register | 5 requests | 6: CR-005 added from the Budget dataset (11 §7 #2); the Budget chip counts 4. Approver names follow the project; other projects show their own baseline and budget |
| Risks FR | Category names, triggers, response plans and draw-down reasons left in English | Translated |
| New draw-down date | Fixed "30 Sep" | The status date, 25 Sep |
| My approvals chips | No chip highlighted at first (filter state never initialised) | "All" highlighted; an unknown `?filter=` falls back to All |
| My approvals routing | By role | By person: the quality manager also gets RQ-042 (Quality department) and RPT-HLT-014 (next Codex approver); the PM sees POs of his own projects; the client sees deliverables of his organisation; the forced-stage-change row shows who forced it |
| My work | "Manager view" note always; a person outside the pool shows a fake 80 %; status segment for everyone | Note only on someone else's work; "—" and "Not in the resource pool"; read-only viewers see a status tag; a new comment shows "Just now" until the refresh, then its timestamp |
| Dates before 21 Sep | Prototype `dayDate` wrong for negative offsets (calendar previous week showed Thu 10 Sep instead of Tue 15 Sep) | Correct dates (`dayDate` in `src/lib/format.ts`); unchanged from 21 Sep on |
| Requests FR | Month and day rules rewrite typed text ("Mon équipe…" → "lun. équipe…"); seeded notes get "5 oct.." | Typed titles and notes are translated only when the whole text is in the dictionary (`dataText`); seeded notes stay as stored; decimal hours shown "12,5 h" |
| Requests empty status | No empty state | "No request in this status" |
| HR details | Dialog subtitles name the current project; missing reference rate "+Infinity%" | No project in the Rate cards, Skills and Leave dialogs; "—". Leave card header gap 12 px (shared component; prototype 10 px); KPI sub-lines use `text-wrap: pretty` |
| Accessibility additions | — | Heat-map cell tooltips and trend icon names (Risks); approval dots with a state label; Approve / Reject named after their step or item; focus management in the Approvals decide forms |

Kept on purpose although questionable (spec open questions):
- Director, department heads and quality may decide requests of any department (P-8, 08 OQ19).
- Risk EMV is stored, not derived, so "cost if it occurs" moves the wrong way when P changes (Q-1).
- The contingency register's "drawn" (48 k€) differs from Budget's 208 k€ (A-8). Draw-downs do not update Budget.
- Two change-request datasets coexist: Budget's `budget_change_lines` (HCRS) and the Change control register (HLT_CRS_X) (A-4).
- Numbering is global, not per project: R-21, CR-011, RQ-045, T-2341 (Q-7).
- Resources "Labor cost to date" reads the last project used, not a portfolio total (06 OQ2, R-2).
- Capacity is 320 h per person (40 h weeks); leave does not reduce heatmap capacity (R-1).
- Contingency "Linked to" is a placeholder; new risks are numbered globally (Q-7).

### 6.1 Fixed by the fidelity reviews

| Feature | Fix |
|---|---|
| Risks | "What-if levelling" opened Harbor Line's levelling from any project; forged non-text form values crashed "New risk" / "Record draw-down" |
| Changes | CR-005's WBS cell blank (now "—"); approval dots coloured only (now labelled); two identical "Approve" buttons for the director (now named by step); "Submit the request…" hint shown to viewers without a Submit button |
| Resources | "−1 days" (now "−1 day", FR "−1 jour"); "Scenario Scenario C"; empty Capacity vs demand card without a team; new scenarios not audited |
| Requests | FR rules rewrote typed text and half-translated seeded titles (`dataText`); "12.5 h" in FR (`hoursNum` / `hoursText`); focus lost in the decide forms; empty-state row and padding (08 §0.5); stale draft after a project switch ("Invalid request"); malformed department escape crashed the page |
| My work | `#Engineering` in FR lists (now `t()`); "1 sur 1 faits"; dates before 21 Sep; 0 % on a done task took two writes; checklist, comments and time entries not audited; FR flicker of the optimistic Log entry |
| My approvals | "−12 d" (now "-12 d" as on Change control; FR "-12 j"); duplicate row keys with two forced stage changes; unhandled rejection of the inline CR decision; identical button names |
| HR | "Import Lucca" hidden on projects without an import (now shown to editors; the dialog reports that no hours were declared) |

## 7. Open questions blocking the next steps

IDs refer to spec 00 §10. Delivery-1 questions not repeated here are still open (`DELIVERY-1.md` §7).

| ID | Question | Blocks |
|---|---|---|
| P-1, P-2 | Outside-my-workspace stays read-only; ownership rules for depthead, englead, quality, procurement, member | Every screen's gating (see the banner matrix §1) |
| I-2, P-13 | Real identity replacing the persona cookie. Actors now follow the persona; users, departments and heads need a real directory | Authentication, audit trail validity |
| L-1 | What the director does with a forced stage change (validate / revert) | My approvals "Forced stage change" decisions |
| P-6, S-3 | Confirm the director records the CCB; whether re-baseline is a CR-driven workflow | Change control, Schedule re-baseline (`TODO(db)` above) |
| A-4, A-8 | One change-request dataset; one definition of contingency "drawn" | Budget ↔ Change control ↔ Contingency reconciliation |
| Q-1, C-4 | Derive EMV from cost × P/5; draw-down "Linked to" picker and approval step | Risk and contingency figures |
| A-10, R-4, R-6 | Which rate values hours (rate cards vs RATES vs 62 €/h); rate versioning and effective dates; analytic code per project, "Assign" semantics | Hours, task cost note, labour actuals (C-2) |
| A-12, R-1, R-2 | Formulas for unmet demand, peak weeks, avg response, skills ≥4, people above 100 %; capacity basis | Resources, Requests, Skills, What-if KPIs |
| R-3, S-7 | What "Apply" does; what-if per project, levers from allocations, "Select scenario" creating requests | Resources, What-if |
| P-8 | Lock department heads to their own department; contract-hire flow to procurement | Approvals |
| R-8, R-9 | Attach (file storage, X-15), @mentions, real calendar navigation | Task, My work |
| X-6 | Which events notify whom, channels, preferences | Notifications beyond requests |
| I-3 | Lucca API vs file exchange (leave sync, hours import) | Leave, Hours |
| C-5 | Status report content and format | Trends "Generate status report" |
| A-5, P-4 | Billing source of truth; finance rights | Next phase (contract, billing, cash) |

## 8. For the next team

- **Routes**: `screenHref(id, { code, taskId })`. Flip `built: true` in `src/config/screens.ts` when a screen lands.
  `screenHref('approvals')` is `/resources/approvals` (redirects to the viewer's department).
  `src/features/requests/routes.ts` builds department links.
- **Access helpers** (`src/server/project-context.ts`):
  - `getProjectContext(code, screen)` returns `readOnly`, `outside`, `canEdit(screen)`.
  - `getScreenAccess(screen)` returns `viewer`, `outside`, `canEdit` for global screens.
  - `isMineProject(viewer, p)`.
  - Feature rules: `src/features/mywork/permissions.ts` (`canPickPerson`, `canEditTask`, `canCommentTask`), `src/features/requests/permissions.ts`, `canSeeRates` in `src/domain/hr.ts`.
- **Shell APIs (changed in Delivery 2)** (`src/server/dal/shell.ts`):
  - These are now async: `notificationsFor(role)`, `defaultTitleOf(screen, { taskId, role })`, `projectBadges(role, code)`.
  - `crumbExtraOf(screen, { role, code, zone, taskId })` is async.
  - `deepLink(screen, extra, code)` puts `tab`/`view` first.
  - `approvalsCount` and `ALL_NOTIFICATION_IDS` are removed; use `approvalCount` from `@/server/approvals`.
  - `<Notifications items role />` replaces the `allIds` prop.
  - Server Functions in `src/components/app/shell/actions.ts`: `markNotificationReadAction(id)`, `markAllNotificationsReadAction()`, `searchAction`.
- **Adding an approval kind**: add a provider file in `src/server/approvals/` (`ApprovalProvider`: `kind`, `scope`, `source`,
  `items(ctx)`, `decided(ctx)`). Register it in `APPROVAL_PROVIDERS` (inbox order) and the kind in `APPROVAL_KINDS` (`src/domain/approvals.ts`).
  For inline decisions, add a decision mode next to `change-request`. The inbox, badge (`approvalCount`, `approvalCountsByProject`) and
  My projects "Pending decisions" pick it up. Replace each `source: 'prototype'` provider when its module is modelled.
- **DAL** (`src/server/dal/`, server-only):
  - `tasks.ts`: `listTasks`, `getTask` and the task writers.
  - `mywork-data.ts`: `getMyWorkPerson`, `listMyWorkPeople`.
  - `requests.ts`, `requests-screens.ts`: outbox, department queues, request workflow writers, `notifyRequestEvent`.
  - `notifications.ts`: `listNotifications`, `countUnreadNotifications`, `createNotification`, `mark*`, `listActivity` / `addActivity`, `listAudit` / `addAudit`.
  - `resources.ts`: `getResourcePool`, `getProjectTeam`, `getLaborCost`, `getWhatIf` and the scenario writers.
  - `hr.ts`: rate card, skills, leave, hours and their writers.
  - `risks.ts`, `risks-screen.ts`, `risks-badge.ts`: `getRiskRegister`, `getOpenRiskExposure`, `createRisk`, `updateRisk`, `riskBadge(s)`.
  - `contingency.ts`: `getContingency`, `recordContingencyDraw`.
  - `changes.ts`: `getChangeControl`, `listChangeRequestsAwaiting`, `createChangeRequest`, `submitChangeRequest`, `decideChangeStep`, `deriveChangeStatus`.
  - `changes-baselines.ts`: `getBaselineRegister`.
  - `trends.ts`: `getTrends`, `recordStatusReport`, `freezeSnapshot`.
  - `people.ts`: people, owners, departments, capacities.
  - `myapprovals-identity.ts`: `getApproverIdentity`.
  - Approval registry (`src/server/approvals`): `getApprovalInbox(viewer, { projectCode, lang })`, `approvalCount(viewer, code?)`, `approvalCountsByProject(viewer, codes)`.
  - Plan: `getPlanTodos(code)` and `getPlanRequests(code)` are async.
- **DB helpers** (`src/server/db/helpers.ts`):
  - `nextNumber(q, table, column, prefix, pad, floor)` gives the global "PREFIX-nnn" sequence.
  - `writeAudit(q, …)` and `recordActivity(q, …)`: call them inside the writing transaction with the viewer as `who`.
  - `requireProject(q, code)`.
- **Server Functions:**
  - `src/features/mywork/actions.ts`: `setTaskStatusAction`, `markTaskDoneAction`, `toggleTaskDoneAction`, `setTaskProgressAction`, `toggleChecklistItemAction`, `addChecklistItemAction`, `addTaskCommentAction`, `logTaskTimeAction`.
  - `src/features/requests/actions.ts`: `sendResourceRequestAction`, `withdrawRequestAction`, `reRequestAction`, `acceptRescheduleAction`, `approveRequestAction`, `proposeRescheduleAction`, `rejectRequestAction`. The New resource request dialog is `src/features/requests/new-request-launcher.tsx` / `new-request-button.tsx`.
  - `src/features/changes/actions.ts`: `createChangeRequestAction`, `submitChangeRequestAction`, `decideChangeStepAction`, `generateStatusReportAction`.
  - `src/features/myapprovals/actions.ts`: `decideChangeRequestAction`.
  - `src/features/risks/actions.ts`: `createRiskAction`, `updateRiskAction`, `recordDrawDownAction`.
  - `src/features/resources/actions.ts`: `setWhatIfPriority`, `toggleWhatIfLever`, `autoLevelWhatIf`, `selectWhatIfScenario`, `createWhatIfScenario`.
  - `src/features/hr/actions.ts`: `setBaseRateAction`, `setMultiplierAction`, `addRateRoleAction`, `addSkillAction`, `syncLuccaAction`, `importHoursAction`, `assignHoursAction`.
- **APIs changed by the fidelity reviews** (all backward compatible except `MyApprovalsBody`):
  - `src/server/dal/tasks.ts`: `toggleChecklistItem(number, position, actorName?)`, `addChecklistItem(number, text, actorName?)`,
    `LogTimeInput.actorName?`. `setTaskProgress` applies the domain rules (`applyStatus`, `applyProgress`) in one
    transaction, so 0 % on a done task gives "To do". `TaskSheetData.defaultLogNote` is new; view-model `labels` are translated.
  - `src/server/dal/resources.ts`: `createScenario(projectCode, input, actorName?)` writes the audit row.
  - `src/features/requests/i18n.ts`: `dataText(s, lang)`, `hoursNum(h, lang)`, `hoursText(h, lang)`.
  - `src/features/myapprovals/i18n.ts` (new): `inboxT`, `daysFr`. `MyApprovalsBody` now needs a `lang` prop.
  - `src/domain/change-control.ts`: `ChainDot.state` (`string | null`). `StepDecisionButtons` takes an optional `stepLabel`.
  - `src/lib/format.ts`: `dayDate` is correct for negative offsets.
- **Reusable logic** (`src/domain/`, pure, golden-tested):
  - `tasks` (status ⇄ %, due texts, groups, KPIs).
  - `requests` (load impact, stepper, routing, department slugs).
  - `resources` (load bands, capacity vs demand).
  - `risk` (score, level, heat map, form parsing).
  - `contingency`, `change-control` (derived status, step decider), `trends`, `whatif`, `hr`, `approvals` (inbox view model, CR routing).
- **Retiring a `TODO(db)`**: same recipe as Delivery 1:
  1. Schema in `src/server/db/schema/<domain>.ts` and a seeder.
  2. `npm run db:generate` (it will create `0002_*`).
  3. Switch the DAL or provider block, and keep the golden tests and `scripts/db-check.ts` green.
