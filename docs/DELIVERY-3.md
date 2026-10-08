# Keystone PM — Delivery 3

> **Delivery 4 has landed.** This file describes Delivery 3 as handed over; for the current status, data, `TODO(db)` list and APIs, read `docs/DELIVERY-4.md`.

Delivery 3 adds documents, contract and collaboration (spec 00 §9, phase 5): the Codex index, contract, billing, cash
flow, prioritisation, meetings and stakeholders. It also brings forward three screens of other phases: the Interface
register (phase 7), the Portfolio schedule (phase 2) and the Projects map (phase 1). The shell badges and crumbs of these
modules, Budget › Cash & recovery and the Codex kind of My approvals now read the database.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md`, `docs/DELIVERY-2.md`.

## 1. Status at hand-over (8 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 91 files, 1172 tests, all passing (Delivery 2: 63 files, 668 tests). Golden values are computed from the prototype logic. |
| `npm run build` | succeeds (Next 16.4 / Turbopack), all 39 routes dynamic (11 new pages) |
| `npm run db:generate` | "No schema changes". Three migrations: `0000_living_gateway.sql` (40 tables), `0001_colorful_speedball.sql` (35 tables, 3 columns) and `drizzle/0002_amazing_lester.sql` (35 new tables, 1 new column) |
| `scripts/db-check.ts` | "All checks passed", including the new "Delivery 3 tables", "Delivery 3 data (DAL vs prototype)" blocks and the Delivery 3 writes in "Numbering & writes" |
| Route matrix on `next start` with a fresh DB | 94 routes × 8 personas × FR/EN = 1 504 requests, all 200, no "being built" page, nothing but the start-up lines in the server log |
| Feature reviews | Seven fidelity reviews (docs, contract, pfinance, meetings, team, pfplan, worldmap) re-ran the prototype's own logic (design lines 3095–5239) in node:vm and compared its render values with the rebuild's view models on a seeded database, in EN and FR, for every persona. English matches the prototype; the French differences are the deliberate ones in §6. They fixed the deviations listed in §6.1 and extended the golden tests. |

**Route matrix** (final integration; server on port 3110, log `/tmp/ks-d3-final.log`; port 3100 untouched; `.data` deleted before and after):
- **Delivery 3 (20 routes, 320 requests):** `/`, `/projects/HLT-026/documents` (and `?scope=all`), `/admin/document-types`,
  `/projects/HLT-026/{contract, billing, meetings, stakeholders, interfaces, plan}`, `/projects/NDC-031/contract`,
  `/projects/EWA-051/meetings`, `/portfolio/{cash, prioritisation, schedule, map, projects}`, `/projects/HLT-026/budget?tab=cash`,
  `/my/approvals`, `/resources`.
- **Delivery 3 deep links and empty states (22 routes, 352 requests):** `?doc=PID-HLT-026`, `?doc=RPT-HLT-014`, `?deposit=1`,
  an unknown `?view=` (falls back to All), `/admin/document-types` with a stray query; documents, billing, contract, stakeholders and interfaces of
  NDC-031 and EWA-051; NDC-031 meetings; meetings `?view=decisions|actions` and an unknown `?filter=`;
  `/portfolio/prioritisation?tab=capacity` (with and without `&project=WSA-044`); `/portfolio/schedule?filter=exec|pipe`.
- **Delivery 1 (14 routes, 224 requests)** and **Delivery 2 (22 routes, 352 requests)**: the matrices of `DELIVERY-1.md` §1
  (without `/dev/components`) and `DELIVERY-2.md` §1.
- **Delivery 2 deep links (16 routes, 256 requests):** `changes?cr=CR-008`, `risks?risk=R-03` / `r-03`, `/my/tasks?view=board|calendar`,
  `/my/tasks?person=Julien Wagner`, `what-if?project=HLT-026|NDC-031`, `hours?view=unassigned`, `changes?new=1`, `trends?kpi=spi`,
  and the EWA-051 risks, trends, resources, contingency and hours empty states.

**Extra routes:** `/dev/components` → 404 in production. `/admin/settings` and `/projects/HLT-026/quality` → 200 "This module is
being built" (catch-all routes). `/admin/foo`, `/portfolio/nope`, `/projects/XXX-999/documents` and `/my/tasks/T-9999` → 404.
`/resources/approvals` → 307. An unknown `?doc=` → 200 without a drawer.

**Outside-my-workspace banner** (EN and FR renders agree; `O` = banner, read-only). The Delivery 1 and 2 routes give the
same matrix as `DELIVERY-2.md` §1.

| Route | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| `/projects/*/documents`, `/projects/*/meetings` | | | | | | | | |
| `/admin/document-types` | | | O | O | O | | O | O |
| `/projects/*/contract` | | | O | O | O | O | | O |
| `/projects/*/billing`, `/projects/*/stakeholders` | | | O | O | O | O | O | O |
| `/projects/*/interfaces` | | | O | O | | O | O | O |
| `/portfolio/cash`, `/portfolio/prioritisation`, `/portfolio/schedule` | | | O | O | O | O | O | O |
| `/portfolio/map` | | | | O | O | O | O | O |

**Mutations tested at integration** (fresh DB, Server Functions posted to `next start` by action ID; badges and queues read back
from the rendered pages; the route matrix was re-run after them with the same result):

| Feature | Action | Result |
|---|---|---|
| Documents | member, then PM, approves RPT-HLT-014 before their turn | refused ("You are not the approver of this step") |
| Documents | quality approves RPT-HLT-014 | leaves the quality manager's My approvals queue, enters the PM's |
| Documents | PM approves the last step | released; Documents badge 1 → none |
| Documents | deposit (Material certificate) | CER-HLT-042; an unknown type or an empty title is refused |
| Documents | download, Sync now | logged (invalid format refused); "414 records" |
| Contract | add amendment as member, as client, on NDC-031 | refused; retention 150 % refused by validation; procurement's sheet edit accepted (P-4) |
| Billing | add a late milestone, then issue its invoice | Billing badge none → 1 → none; a duplicate invoice number is refused |
| Billing | mark paid twice | the second is refused; Budget › Cash shows 1,72 M€ received |
| Meetings | create MTG-130, add a note | Meetings badge 1 → 2 |
| Meetings | send minutes | MIN-HLT-027 in the Codex index, a task for J. Wagner, badge 2 → 1; a second send is refused |
| Meetings | PM on EWA-051 (another PM's project) | refused; the director creates MTG-131 there and adds a note: EWA-051 badge = 1 |
| Meetings | englead analyses the transcript, "Add to minutes" | accepted |
| Stakeholders | add as member; invalid e-mail; valid add | refused; refused; accepted |
| Interfaces | create; freeze IF-02 (not received); IF-07 received then frozen; quality edits | IF-10; refused; Interfaces badge 1 → none; refused |
| Prioritisation | weight 0.5; weight 3; unknown axis; score a pipeline project; a non-pipeline project; depthead | accepted; refused; refused; saved; refused; refused (outside) |

## 2. How to run

Same as `DELIVERY-1.md` §2, with two changes:
- **Run `npm install`.** The Projects map adds `d3-geo`, `d3-selection`, `d3-zoom`, `topojson-client` and `world-atlas`
  (plus their `@types`). The world geometry is self-hosted (`world-atlas/countries-110m.json`, loaded as a separate chunk); no CDN, no iframe.
- **Run `npm run db:reset` once (server stopped).** An existing `./.data` from Delivery 2 gets migration `0002` on the next start,
  but its tables stay empty because the seed only runs on an empty database.

Golden generators (each one runs the prototype logic in node:vm and rewrites a committed JSON; re-running them must leave the files unchanged):

| Script | Output |
|---|---|
| `npx tsx scripts/proto-golden-d3.ts` | `src/server/dal/delivery3.golden.json` (EN render values of every Delivery 3 screen) |
| `npx tsx scripts/proto-golden-docs.ts` | `src/features/docs/docs.golden.json` |
| `TZ=UTC npx tsx scripts/proto-golden-contract.ts` | `src/features/contract/contract.golden.json` |
| `npx tsx scripts/proto-golden-pfinance.ts` | `src/features/pfinance/pfinance.golden.json` |
| `npx tsx scripts/proto-golden-pfplan.ts` | `src/domain/pfplan.golden.json` (with stage-change and new-project scenarios) |
| `npx tsx scripts/proto-golden-worldmap.ts` | `src/domain/worldmap.golden.json`, `src/features/worldmap/worldmap.golden.json` (incl. tooltip texts) |

Meetings compares with the prototype at test time instead (`src/features/meetings/prototype-harness.ts`, used by
`meetings.golden.test.ts` and `src/domain/meetings.test.ts`).

## 3. Data

### Newly modelled (migration `0002`, schema in `src/server/db/schema/`, seeders in `src/server/db/seed/`)

| Schema file | Tables | Seeded from |
|---|---|---|
| `documents.ts` | `document_types`, `document_type_circuit_steps`, `document_approver_assignments`, `documents`, `document_revisions`, `document_approvals`, `document_links`, `document_acknowledgements`, `document_downloads`, `document_deposits`, `document_index_syncs` | DOC_TYPES, DOC_WHO, the 42 DOCS. The history the prototype synthesises at render time (one revision every 21 days, approval dates, two download entries per released document, logic 5020–5047) is materialised as rows. Codex sync state "08:02 · 412 records" |
| `contract.ts` | `contracts`, `contract_amendments`, `contract_bonds`, `billing_plans`, `payment_milestones`, `customer_invoices`, `portfolio_cash_forecasts` | CONTRACTS (HLT-026: 2 amendments, 2 bonds, 5 milestones, invoices INV-2026-001…003); BILLING of the projects without a contract, migrated into payment milestones (A-5 resolved as 11 §7 #3); CASH_M |
| `collaboration.ts` | `meetings`, `meeting_participants`, `meeting_agenda_points`, `meeting_lines`, `meeting_transcripts`, `meeting_transcript_proposals`, `client_questions`, `stakeholders`, `raci_matrices`, `raci_columns`, `raci_rows`, `raci_cells` | MEETINGS, MTG_DONE, MTG_TRANSCRIPTS and the pre-baked analysis (logic 4840), MTG_EXCHANGE, STAKEHOLDERS, RACI |
| `operations.ts` | `project_interfaces` | INTERFACES (HLT-026 × 7). A seeded "Late" is stored as open; lateness is derived from the need date |
| `prioritisation.ts` | `score_axes`, `portfolio_scores`, `score_weights`, `capacity_demand_rates` | SCORE_AXES; SCORES with the obsolete keys EWA-041, RBR-038, CER-045 remapped to EWA-051, RBR-048, CER-047 (11 §7 #12); hours per €1M by department (logic 4506) |

New column: `project_controls.orders_placed_keur` (Cash & recovery "orders placed": 713 k€ for HLT-026 until purchase orders are modelled, 04 Q11).

New codes and time model in `src/server/db/codes.ts`: `PG_NOW` (8.97), `NOW_ISO` ("30 Sep"), `CODEX_TODAY_ISO` ("29 Sep"),
`monthIndexOfIso`, `beforePgNow`, `shortDateYearOfIso`, and the codecs of the new enums (document family, service, status,
confidentiality, link kind, saved view, approver role; contract type, amendment, bond, milestone and invoice statuses,
billing model; score axis; meeting type, status, series, line type; stakeholder type, RACI codes; interface status, Keystone side).

Billing source of truth: the contract is authoritative. A project with a contract derives its billing plan from it
(value = base + signed amendments; milestone amount = round(value × share / 100)). Projects without a contract keep their
legacy plan. Cash flow, Prioritisation margins, Budget › Cash & recovery and the Billing badge read the same rows.

### Writes that persist (new in Delivery 3)

Every write validates its raw input and checks the viewer server-side, including the outside-workspace and project read-only
rules. It records the viewer as the actor in `audit_entries` / `activity_events` and revalidates the affected screens and badges.

- **Documents (Codex index):**
  - Deposit in Codex: a simulated hand-off that creates the index record (`count + 40` numbering, e.g. CER-HLT-042) with the typed title.
  - New revision of a record (resets it to Draft; the revision letter does not move, D-1).
  - Approve a circuit step: only the step's named approver or the portfolio director. The last step releases the record and withdraws the previous revision.
  - Client acknowledgement, download log (PDF / Native), Sync now (real HH:MM, record count).
- **Contract:** contract-sheet fields (saved one by one), add amendment, add bond or guarantee, add payment milestone.
- **Billing:** issue invoice (next number = highest + 1; due date = issue date + payment terms in calendar days), mark paid.
- **Prioritisation:** score weights (per user, 0–1, an empty field saves 0); "Score a proposal" (the three axes, the viewer as scorer).
- **Meetings:**
  - New meeting (MTG-130…, organizer and default invitees follow the viewer).
  - Minutes lines (note, decision, action with owner and due); tick an action.
  - Analyse a transcript (simulated) and add its proposals to the minutes.
  - Send minutes: creates the MIN record in the Codex index (project's own code, e.g. MIN-HLT-027) and one task per action owner in the resource pool.
- **Stakeholders:** add stakeholder (e-mail checked).
- **Interfaces:** new interface (numbered per project, IF-10…), mark received, freeze (received interfaces only).

### Still not modelled (read from the prototype JSON, marked `TODO(db)`)

- ECOs, parts, drawings, installed base.
- Purchase orders, goods receipts, supplier invoices, RFQs.
- NCRs, client deliverables.
- Stock, claims, connectors, punch list, ITP, commissioning, engineering checks, P&ID, site.
- The Lucca connector. The Codex connector is simulated (deposits, sync); Outlook sync is a label (meetings).

## 4. What is implemented

34 of the 59 registry screens are built: 23 from Deliveries 1–2 plus 11 new ones, all `built: true` in `src/config/screens.ts`.
The other 25 still render the "This module is being built" page.

### Documents — Codex index — `/projects/[code]/documents` (spec 10 §4)
- Vault of the current project plus the QMS records; `?scope=all` widens to every project.
- KPI tiles: Documents in scope, Awaiting approval, Client acknowledgments pending, Obsolete revisions withdrawn (a count of withdrawn revisions).
- Saved views (`?view=all|bpe|audit|client|pending|obsolete`), family chips (`?fam=`), status chips (`?status=`), search (`?q=`); unknown values fall back to All.
- Record drawer `?doc=<number>`: identity, revisions, approval proof (who actually signed), distribution and client acknowledgement, download log, relations.
  Actions: Approve (named approver or director), Download, Open / Edit in Codex (toast; Edit hidden outside the workspace), New revision.
- Deposit wizard `?deposit=new|<number>` (+ `dtype`, `po`, `part` from another screen's context): 3 steps, type proposed from the file name, real title, numbering preview.
- Primary "Deposit in Codex". Every persona has the screen and may deposit, as in the prototype. Sidebar badge = records awaiting approval, all projects.

### Document types register (Codex) — `/admin/document-types` (spec 10 §5)
- Read-only mirror of the Codex register ("Synced from Codex"): code, kind, family, approval circuit, retention, ISO process, client deliverable, "In Codex" count.
- "Edit in Codex" (toast) for director, PM and quality; the others get the banner.

### Contract — `/projects/[code]/contract` (spec 04 §3)
- Contract value and terms, the editable contract sheet (12 fields), amendments, bonds & guarantees, the payment schedule; Codex links to the contract and amendment documents.
- Primary "Add amendment"; "Add guarantee" and "Add payment milestone" in the cards.
- Editable by the director, the project's PM and procurement. Disabled outside the workspace or on a read-only project. "No contract registered" on projects without one.
- Breadcrumb extra = the contract reference as stored.

### Billing & payments — `/projects/[code]/billing` (spec 04 §4)
- Receivables KPIs, billing progress and retention, milestones to invoice (late ones flagged), invoices with due dates and Mark paid.
- Primary "Issue invoice" while a milestone is Planned. Editable by the director and the project's PM.
- Sidebar badge = late milestones; breadcrumb extra = payment terms.

### Cash flow & billing — `/portfolio/cash` (spec 03 §7)
- Zone screen: projects in execution with a billing plan (the contract when one exists), KPI tiles, the 6-month forecast chart scaled to the zone's share of contract value (the scale grows above €1.5M).
- Margins are masked ("•••") for viewers other than the director and PMs and are never sent to their browser.

### Portfolio — prioritisation & capacity — `/portfolio/prioritisation` (spec 03 §6)
- Display segment: Prioritisation (KPI tiles, ranking of 10 projects, weights recomputed live) and Capacity what-if (`?tab=capacity`, candidate `?project=`).
- `?sel=` keeps the selected ranking row; changing zone clears the selection and the what-if candidate.
- Primary "Score a proposal". Closed and cancelled projects are excluded from the ranking.

### Meetings & minutes — `/projects/[code]/meetings` (spec 05 §5)
- Register with status chips (`?filter=todo|upcoming|sent`), views (`?view=meetings|decisions|actions`), selected meeting `?meeting=` (default: first of the sorted list).
- Detail: agenda and minutes lines, preparation pack (previous meeting's actions, client questions), transcript analysis, read receipts, Send minutes.
- Primary "New meeting". Edit controls are hidden outside the workspace or on a read-only project, and refused server-side.
- Sidebar badge = meetings with notes in progress. Projects without meetings show the empty register.

### Stakeholders & RACI — `/projects/[code]/stakeholders` (spec 05 §6)
- KPIs, register with relationship owner and last contact (stale after 30 days), RACI matrix (read-only).
- Primary "Add stakeholder". Empty register and no RACI card on projects without data.

### Interface register — `/projects/[code]/interfaces` (spec 07 §2.5)
- KPIs (incl. "Blocking commissioning"), register with need / provided dates, derived Late status, "in n d" / "n d late".
- Primary "New interface"; row actions "Mark received" (focus moves to the new "Freeze" button) and "Freeze".
- Open to director, PM and engineering lead (prototype code). Sidebar badge = Late count.

### Portfolio schedule — `/portfolio/schedule` (spec 05 §3)
- 24-month Gantt of the zone's live projects: pipeline stage gates and group boards, execution bars with progress, baseline finish and forecast slip, `→ <finish>` clipping.
- Stage filter `?filter=exec|pipe`; 4 KPI tiles. A project opens its Plan when it has data, else `/portfolio/projects?q=<code>`. Read-only for everyone.

### Projects map — `/portfolio/map` (spec 03 §3)
- In-app d3 map (no iframe): layers, clustered markers, labels, tooltip (pinned on click, Esc closes, focus returns to the map), view buttons, legend; zone re-framing.
- KPI tiles and the "Sites" list grouped by city (the site header zooms the map, each row opens the project). Breadcrumb extra "n projects located".

### Shell and earlier screens (now read from the database)
- **Sidebar badges:** Documents (`docsBadge()`), Meetings (`meetingsToWriteByProject()`), Interfaces (`lateInterfacesByProject()`) and
  Billing (`lateBillingMilestonesByProject()`). They follow the database on every project, including projects without seed data.
- **Breadcrumb extras:** Contract and Billing (`getContractHeader`), Projects map (`getProjectsMap` + `mapCrumbExtra`).
- **My approvals, Codex documents kind:** reads the Codex index (`source: 'db'`, `codexVaultItems`). It follows the circuit: once
  G. Comte has signed RPT-HLT-014, the record moves to the PM's queue.
- **Budget › Cash & recovery** reads the contract, its invoices and payments from the database (`getCashContract`).

### Platform
- Domain modules with golden tests: `documents`, `contract`, `portfolio-finance`, `meetings`, `team`, `pfplan`, `worldmap`.
- Charts (`src/components/charts/`): `cash-flow-bars`, `capacity-demand-bar`, `portfolio-gantt`, `projects-map`.
- i18n: `src/i18n/extra/{docs,contract,pfinance,meetings,team,pfplan,worldmap}.json`; feature `i18n.ts` helpers for the parameterised French sentences.

## 5. Known gaps — `TODO(db)` and placeholders

`grep -rn "TODO(db)" src` (32 markers). Retired in Delivery 3: Budget's contract (`budget.ts`), the Codex kind of My approvals,
and the documents, meetings, interfaces and contract/billing blocks of the shell.

| Where | What is still read from the prototype / not persisted |
|---|---|
| `src/server/dal/shell.ts:9, 53, 392, 399, 426` | Badges, crumbs and search hits of unmodelled modules: ECOs, supplier invoices, stock, claims, connectors, punch list, engineering checks, P&ID, site, NCRs, POs, deliveries, parts, drawings, installed base |
| `src/server/dal/home.ts:6, 41, 51` | ECOs, parts, drawings, POs, client deliverables (Harbor Line only) |
| `src/server/dal/home.ts:57` | Client Home "Milestone 4 invoice €640k · 15 Oct" is the prototype literal; wiring it to the billing plan would change today's Home values (A-5) |
| `src/server/dal/team.ts:31, 38` | Interfaces "Blocking commissioning" reads the prototype COMMISSIONING grid until commissioning steps are modelled |
| `src/domain/home.ts:266, 453` | ECO effectivity lock; "Unmet demand 240 h" constant (A-12) |
| `src/server/dal/plan.ts:149` | Template index (DEFS idx) of a project is not stored |
| `src/features/plan/drawer-model.ts:127` | Activity ↔ change request link (CRs link to work packages only) |
| `src/features/schedule/actions.ts:14` | Re-baseline should write a `baselines` row (proposed, linked to a CR) |
| `src/features/hr/actions.ts:94, 117`, `src/features/hr/leave-view.tsx:30`, `src/app/(app)/projects/[code]/hours/page.tsx:32` | Lucca connector |
| `src/features/hr/skills-view.tsx:37` | "Open requests needing level ≥4" KPI is a prototype constant (06 OQ4, A-12) |
| `src/server/approvals/{purchase-orders, delivery-qc, invoices, rfq-awards, ecos, ncr-verification, deliverables}.ts:2`, `types.ts:26` | My approvals kinds still on prototype data (decisions are previews) |
| `src/domain/approvals.ts:83, 85` | Item builders of those kinds; the PO / receipt submitter is the prototype buyer literal |
| `src/server/prototype/index.ts:4` | Rule: prototype reads must be marked `TODO(db)` |

Other gaps:
- **25 screens not built:**
  - Client view.
  - Engineering (5 screens), P&ID, BOM, Quality, ITP, Site, Commissioning, REX.
  - PLM, ECO, Drawings, Procurement, Orders, Deliveries, Stock, Installed base, Warranty claims.
  - Settings, Machine types, Activity & integrations.
- **MVP scope** (phases 0–4) is complete except Settings and Machine types. Phase 5 is complete except the real Codex and Outlook connectors.
- **Coming-soon toasts and inert controls (new):**
  - Documents: "Download zip", both "Export register (xlsx)" buttons, and the Deliverable, Purchase order and Punch item relations (10 OQ15).
    The Article relation opens `/reference/parts?part=`, which is not built yet.
  - "Open in Codex" / "Edit in Codex" are toasts (no Codex deep link yet).
- **Constants kept from the prototype** (A-12; no formula or source yet):
  - Cash "Portfolio margin 18 %" (`src/domain/portfolio-finance.ts:19`) and "November — before M3 payment lands"
    (`src/features/pfinance/model.ts:321`; the real low point is Jan ’27, −€490k).
  - The 6-month cash plan (`portfolio_cash_forecasts`), the capacity numbers and the hours-per-€1M rates (`capacity_demand_rates`): seeded data with no source.
  - Codex sync "08:02 · 412 records" at seed time; dates "29 Sep" (downloads, deposits, withdrawals) and "30 Sep" (invoices, payments, minutes, records) from `CODEX_TODAY_ISO` / `NOW_ISO`.
- **Left open by the reviews** (no code change):
  - Documents: the Codex hand-off is simulated; a new revision does not move the revision letter (D-1, 10 OQ14). "Sync now"
    stamps the real clock time. A record released in Keystone gets no download entries (the prototype showed two fake ones).
    A PM can deposit in another project's vault (EWA-051 → CER-EWA-040) until P-1/P-2 are settled.
  - Contract: typed contract-sheet text goes through the prototype translation in French ("Mar works" → "mars works"); exact-match
    translation would leave the seeded scope and governing-law fields in English. After "Mark paid" or issuing an invoice from a row,
    focus drops to the page body. A signed amendment re-prices milestones already invoiced (stored invoice amounts keep their value). Payments are dated 30 Sep.
  - Prioritisation: "Editable · the ranking recomputes live" also shows to read-only viewers. Whether Garantie projects leave the
    ranking is open (none has scores). `priorityScore` and `marginPct` exist both in `src/domain/portfolio-finance.ts` and in
    `src/server/dal/prioritisation.ts` / `cashflow.ts` (same results).
  - Meetings: new tasks are due today + 3 whatever due date was typed (05 OQ17); read receipts are never updated
    (`recordMinutesRead` has no caller, S-11); transcript analysis is simulated (S-10); the client sees internal meetings (P-10,
    05 OQ14); the Decisions and Actions views show a bare table when empty, as the prototype does.
  - Interfaces: "Due within 30 days" counts every open interface with a future date (IF-05, 45 days, 07 OQ6); "Mark received" does not
    fill the Provided date (07 OQ10). The stakeholder avatar's initials are read aloud before the name (shared `Avatar`).
  - Projects map: markers are not keyboard-reachable (the Sites list offers the same actions); the legend still says "Closed / on hold"
    and the tooltip status tag follows health (L-7, 02 Q-2); projects created with the wizard have no site and count as "without location".
  - French names typed in the New project wizard are rewritten by the month/day rules on the portfolio screens ("Sun Valley Farm" →
    "dim. Valley Farm"), as in the prototype: `projectName` in `src/features/portfolio/view.tsx`, `t(p.client)` on Projects,
    `t(r.pmLine)` on the Portfolio schedule. Requests, Contract and Meetings each have a local `dataText`; the fix belongs in one shared helper.

## 6. Deliberate deviations from the prototype

Delivery 1 and 2 deviations still apply (`DELIVERY-1.md` §6, `DELIVERY-2.md` §6). New in Delivery 3:

| Area | Prototype | Rebuild |
|---|---|---|
| Hard-coded actors (00 §7.16) | Meeting organizer and default invitees fixed | The viewer; the viewer is also recorded as scorer, signer and author in the audit trail |
| Harbor Line fallback | HLT-026 meetings, stakeholders and interfaces on every project | Empty states ("No meeting in this view", empty registers, no RACI card) |
| Document approval (10 OQ12) | Any persona approves any step; proof names the `DOC_WHO` approver | Only the step's named approver or the director, server-side too; the proof shows who actually signed |
| Documents KPI "Obsolete revisions withdrawn" (10 OQ16) | Sum of revision letters | Count of withdrawn revisions (identical on the seed) |
| Documents history | "A.3" for every working version; approval and download dates made up from the document date; client always "Port authority · N. Bensaïd" | "D.3"; real Keystone dates; the project's own client |
| Deposit dialog (10 OQ14) | One step, hard-coded title, demo PO-2026-118 / CR-RAIL-A100, project not reset | 3 steps, current project, real title, empty links, "Type proposed" until a file name matches; new revision keeps the record's type and confidentiality |
| Documents FR | Approver roles and types left in English, "Punch item", "1 sélectionnés" | Translated ("Direction", "Réserve"), singular |
| Documents details | "Native" downloads logged as PDF; change-request relation inert | Logged as Native; opens Change control. "Edit in Codex" hidden outside the workspace |
| Contract sheet (04 Q7) | Editable outside the workspace | Disabled outside the workspace; header "Add amendment" hidden without a contract |
| Invoice due dates (04 Q12) | `days × 86 400 000 ms` (DST: M3 shows 9 Nov) | Calendar days (10 Nov); dates checked when typed |
| Invoice numbering | Count + 1 | Highest + 1 |
| Contract wording | "2.5 %" in FR; "0 signed amendment" in EN | "2,5 %"; "0 signed amendments"; seeded amendment and milestone labels translated only on an exact dictionary match |
| Prioritisation margin (A-5) | HLT-026 11 % (BILLING €5.40M) | 13 % (contract €5.52M, as on Cash) |
| Prioritisation ranking (00 §7.16) | Scores under obsolete codes; closed and cancelled projects ranked (status compared with English labels) | Codes remapped; excluded by code; 10 rows |
| Masked margins | Coloured, which leaks the under-15 % ones | Not coloured; never sent to the browser |
| Weights | Sum shows 100 % when every weight is 0; session only | 0 %; saved per user; values outside 0–1 refused |
| Score a proposal | Toast "Score saved", nothing stored | Saves the three axes (a new project gets 1 on the other two), audit row |
| Cash chart / capacity | Overflows above €1.5M; empty capacity tab | Scale grows; "No pipeline project to absorb" |
| Pfinance FR | Pipeline sub-line in English; "1 projets clients" | Translated; singular |
| Meetings typed content | Half-translated in FR ("Teams" → "Équipes", "20 oct..") | Exact-match translation only; new titles as typed |
| Meetings selection | First meeting of the unsorted list, nothing highlighted | First of the sorted list, highlighted |
| Meetings rights (P-9) | Composer and "Send minutes" open to everyone | Hidden for read-only and outside viewers, refused server-side |
| Meetings numbering (05 OQ15) | Per-project MTG, "MIN-HLT-" for every project | Global MTG-130…; MIN with the project's own code (MIN-NDC-025) |
| Meetings details | Note lost without an agenda; "1 actions"; fixed layout | First agenda point created; singular; one column below 760 px; due dates typed in EN or FR |
| Interfaces "Blocking commissioning" | Always "HV cell · anti-collision zones", counts IF-02 / IF-05; attention colour only when Open | Only the blockers still open; attention also when Late |
| Interfaces / Stakeholders validation | E-mail and need date free text; owner as full name; row buttons for read-only viewers | E-mail and date checked; short owner name (05 §6.5); hidden and refused |
| Team FR / EN | "> 30 d" in FR; "Reçu" / "Gelé"; "Registre" button; "1 authorities"; "Org · " with no role | "> 30 j"; "Reçue" / "Gelée"; "Enregistrer"; singular; organisation alone |
| Dates outside 2026 | "14 Jan" for a 2027 need date | "14 Jan 2027" (FR "14 janv. 2027") |
| Projects map FR | Names and clients in English; health compared on translated labels, so every active marker showed at risk | Translated; tags and markers from codes |
| Projects map | Iframe + postMessage (Q-17); language switch re-frames the map | In-app component; the view and tooltip are kept; reduced motion respected |
| Crumbs | "1 projects located" | Singular |

Kept on purpose although questionable (spec open questions):
- Every persona, the client included, can deposit, start a new revision and run "Sync now" on Documents, as in the prototype (P-1, P-2).
- Interfaces is open to director, PM and engineering lead as in the prototype code; spec 07 §1.1 says director only (07 OQ15).
- Procurement may edit every contract field (P-4, 04 Q7).
- Projects created with the wizard fall in the Europe & North America zone on the map, as in the prototype.

### 6.1 Fixed by the fidelity reviews and the final integration

| Feature | Fix |
|---|---|
| Docs | Type code shown twice ("Acceptance minutes (PV) (PV)", `typeWithCode`); FR "Open in Codex" toast "rev D" → "rév. D"; the new-revision hand-off kept the saved view and filters; the approval proof named the `DOC_WHO` approver instead of the signer; missing FR "PLC variable table" |
| Contract | A database error in Add amendment / guarantee / milestone escaped as a raw server error; "0 signed amendment" in EN; Codex links now use the Documents helper; the page loaded every document number; golden tests for all 8 personas and a server-side gate test per action |
| Pfinance | Changing zone kept `?sel=` and `?project=`; an empty weight field raised an error instead of saving 0 (`weightOnLeave`) |
| Meetings | New meetings listed newest first; detail-card and composer styles depended on stylesheet order; missing 8 px when the preparation grid is empty; organizer got a read receipt when invited under his full name; composer lost Owner and Due after a failed add |
| Team | Need, provided and last-contact dates outside 2026 lost their year; duplicated Late / days-to-need / initials / stale rules in the DAL (now `src/domain/team.ts`); focus lost after "Mark received"; unlabelled last columns ("Actions", "Notes") |
| Pfplan | No deviation; scenario tests added (stage changes, New project wizard) and the banner check for 8 personas |
| Worldmap | Esc did not close the hover tooltip and focus was lost when a pinned tooltip closed; category rule moved to the domain (`mapCategoryOf`); tooltip texts golden-tested |
| Integration | My approvals Codex kind on the database; Documents, Meetings, Interfaces and Billing badges and Contract, Billing and Map crumbs on the database |
| Final integration | `scripts/proto-golden-d3.ts` injected the host's built-ins into the sandbox, which silently disabled the prototype's French translation (`deepTr`); the sandbox now keeps its own intrinsics. The regenerated golden file is byte-identical (EN only) |

## 7. Open questions blocking the next steps

IDs refer to spec 00 §10 unless a spec number is given. Questions of `DELIVERY-1.md` §7 and `DELIVERY-2.md` §7 not repeated here are still open.

| ID | Question | Blocks |
|---|---|---|
| D-1, 10 OQ13–15 | Codex hand-off contract (deep link vs API, numbering, revision bump, project defaulting); real index sync (revisions, approvals, downloads); targets of "Download zip", "Export register", Deliverable / PO / Punch item relations | Documents beyond the simulated hand-off; every module that deposits documents |
| A-5 | Billing source of truth confirmed as the contract? The ranking margin moves from 11 % to 13 % on HLT-026; the client Home's "Milestone 4 invoice" literal | Prioritisation, Cash, client portal, Home |
| P-4, 04 Q7 | Who edits contract terms, issues invoices, marks them paid; is a finance role needed (procurement edits everything today) | Contract, Billing |
| 04 Q11, Q12, Q14 | Real status date vs `PG_NOW` / "30 Sep" / "29 Sep"; due-date rule (calendar days vs "fin de mois"); retention basis (paid vs invoiced) | Billing, Cash, Documents dates |
| A-12 | Sources for "Portfolio margin 18 %", the cash low-point text, the 6-month cash plan, capacity figures and hours-per-€1M rates | Cash, Prioritisation KPIs |
| P-9, P-10, 05 OQ14 | Meetings rights (who may write and send minutes); client visibility of internal meetings, transcripts and Q&A | Meetings, client portal |
| S-10, S-11, 05 OQ16–18 | Transcript source and analysis (LLM, human review); Outlook sync direction (read receipts, invitations); action → task due date and external owners | Meetings |
| 05 OQ19, OQ20 | Stakeholder influence / interest / attitude, derived "last contact"; RACI editor and its columns | Stakeholders |
| 07 OQ6, OQ10, OQ11, OQ15 | "Due within 30 days" filter; "Mark received" stamping the Provided date; commissioning model; who sees Interfaces | Interfaces, Commissioning |
| L-7, 02 Q-2 | Map legend "Closed / on hold"; tooltip tag colour (health or stage); keyboard access to markers | Projects map |
| 05 OQ22 | Portfolio schedule horizon (fixed Jan 2026 – Dec 2027) | Portfolio schedule |
| P-1, P-2 | Outside-workspace and ownership rules: depositing in another project's vault, every persona depositing | Documents, every screen's gating |

## 8. For the next team

- **Routes:** `screenHref(id, { code })`; flip `built: true` in `src/config/screens.ts` when a screen lands.
  - Documents links (`src/features/docs/links.ts`): `documentsHref(project, query)`, `docHref(number, project)`,
    `depositHref(project, { type, po, part, revisionOf }, keep?)` / `openDepositHref` (deposit hand-off from another screen's context).
    Contract exports its own `docHref(code, ref)` with the arguments in the opposite order (same URL).
  - `<DocumentLink code project? />` (`src/features/docs/document-link.tsx`) renders a Codex record link.
- **Access helpers:** unchanged (`getProjectContext(code, screen)`, `getScreenAccess(screen)`). Every Delivery 3 action uses `ctx.canEdit(screen)`
  or `getScreenAccess(...).outside`; follow the same pattern.
- **DAL** (`src/server/dal/`, server-only):
  - `documents.ts`: `listDocumentTypes`, `getApproverDirectory`, `listVaultDocuments`, `listProjectDocuments`, `listSharedDocuments`,
    `countDocumentsAwaitingApproval`, `getDocumentRecord`, `getCodexSyncState`, `previewDepositNumber`, `depositInCodex`,
    `createMinutesDocument`, `freezeDocument`, `proposeDocumentRelease`, `approveDocumentStep`, `acknowledgeDocument`,
    `logDocumentDownload`, `syncCodexIndex`. `docs-badge.ts`: `docsBadge()`.
  - `contract.ts`: `getContract`, `getContractHeader`, `getCashContract`, `lateBillingMilestonesByProject`, `updateContractSheet`,
    `addAmendment`, `addBond`, `addPaymentMilestone`, `issueInvoice`, `markInvoicePaid`.
  - `cashflow.ts`: `listBillingPlans`, `getBillingPlan`, `marginPct`, `getPortfolioCashForecast`, `getCashFlow`.
  - `prioritisation.ts`: `listScoreAxes`, `getScoreWeights`, `setScoreWeight`, `resetScoreWeights`, `listPortfolioScores`, `priorityScore`,
    `getPrioritisation`, `getCapacityWhatIf`, `saveProposalScore`. `pfinance.ts`: `getPrioritisationScreen`, `getCapacityScreen`,
    `listProposalOptions`, `getCashScreen`.
  - `meetings.ts`: `listMeetings`, `getMeeting`, `meetingsToWriteByProject`, `listClientQuestions`, `createMeeting`, `addMeetingLine`,
    `toggleMeetingAction`, `analyseTranscript`, `applyTranscriptToMinutes`, `sendMinutes`, `recordMinutesRead` (for the Outlook sync),
    `createdSortOrder`, `durationText`. `meetings-screen.ts`: `getMeetingsScreen`, `ensureFirstAgendaPoint`.
  - `stakeholders.ts`: `getStakeholderRegister`, `addStakeholder`. `interfaces.ts`: `listInterfaces`, `lateInterfacesByProject`,
    `createInterface`, `markInterfaceReceived`, `freezeInterface`. `team.ts`: `teamOwnerOptions`, `commissioningBlockers`,
    `getStakeholdersScreen`, `getInterfacesScreen`. `InterfaceRow.neededText` / `providedText` and `StakeholderRow.lastText` carry the year outside 2026.
  - `pipeline.ts`: `getPortfolioSchedule(zone)`. `geo.ts`: `getProjectsMap(zone)`, `MapCategory`.
  - `budget.ts`: `getBudgetContract` now reads the contract module.
- **Server Functions:**
  - `src/features/docs/actions.ts`: `depositInCodexAction`, `approveDocumentAction`, `logDownloadAction`, `syncCodexAction`, `acknowledgeDocumentAction`.
  - `src/features/contract/actions.ts`: `updateContractFieldAction`, `addAmendmentAction`, `addBondAction`, `addPaymentMilestoneAction`, `issueInvoiceAction`, `markInvoicePaidAction`.
  - `src/features/pfinance/actions.ts`: `setScoreWeightAction`, `scoreProposalAction`.
  - `src/features/meetings/actions.ts`: `createMeetingAction`, `addMinutesLineAction`, `toggleMeetingActionAction`, `analyseTranscriptAction`, `applyTranscriptAction`, `sendMinutesAction`.
  - `src/features/team/actions.ts`: `addStakeholderAction`, `createInterfaceAction`, `markInterfaceReceivedAction`, `freezeInterfaceAction`.
- **Components:** `CashFlowBars`, `CapacityDemandBar`, `PortfolioGantt` / `PortfolioGanttLegend`, `ProjectsMap` (`src/components/charts/`).
  `DisplaySeg({ tab, zone? })` and `PrioritisationBoard({ data, canEdit, initialSel, zone? })` (`src/features/pfinance/`).
  The RACI grid (`RaciCard`) is internal to `src/features/team/stakeholders-view.tsx`; export it for the deliverables screen.
- **Reusable logic** (`src/domain/`, pure, golden-tested):
  - `documents` (views, KPIs, `typeWithCode`, revision texts), `contract` (billing roll-up, due dates in calendar days, retention).
  - `portfolio-finance` (score, margin, cash bars, capacity bar, `PORTFOLIO_MARGIN_PCT`), `pfplan` (`portfolioScheduleModel`).
  - `meetings` (sorting, overdue, carry-over, prep pack), `team` (Late, days to need, stale contact, initials).
  - `worldmap` (`mapCategoryOf`, `tooltipTitle`, `markerLabelText`, `mapCrumbExtra`).
  - `approvals`: `codexVaultItems(docs, viewerShort, currentCode)` builds the Codex inbox items from the index.
- **Time model:** use `PG_NOW`, `NOW_ISO`, `CODEX_TODAY_ISO`, `beforePgNow` and `shortDateYearOfIso` (`src/server/db/codes.ts`) for
  anything the prototype computes against its "now"; never the real clock (except "Sync now").
- **Adding an approval kind backed by the database:** follow the Codex provider (`src/server/approvals/codex-documents.ts`, `source: 'db'`).
- **Retiring a `TODO(db)`:** same recipe as before: schema in `src/server/db/schema/<domain>.ts` and a seeder; `npm run db:generate`
  (it will create `0003_*`); switch the DAL, shell block or provider; keep the golden tests and `scripts/db-check.ts` green.
