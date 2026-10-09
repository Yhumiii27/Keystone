# Keystone PM — Delivery 5

Delivery 5 builds the last 17 screens of the prototype (spec 00 §9, phases 7 and 8 and the administration part of phase 9):
the engineering register (synthesis and four disciplines), P&ID validation, Quality (NCR and deliverables), the inspection & test
plan with its punch list, commissioning and the handover dossier, the site (chantier), lessons learned and closure, the client
portal, the installed base, warranty claims and interventions, Settings, Machine types, and Activity, integrations & audit.
All 59 registry screens are now built. Three system boundaries decided by the user override the prototype and the spec (§5):
**Vigie** owns the non-conformities and the site HSE register, **Cursus** owns individual site clearances and the people Go / No Go,
**Codex** owns the documents. The shell badges and search, the Home and every My approvals kind now read the database or a connector mirror.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md` … `docs/DELIVERY-4.md`.

## 1. Status at hand-over (9 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 164 files, 2 206 tests, all passing (Delivery 4: 124 files, 1 654 tests). Golden values are computed from the prototype logic. |
| `KEYSTONE_DIST_DIR=.next-ci npm run build` | succeeds (Next 16.4 / Turbopack), 62 routes, all dynamic (15 new: 14 pages and the `audit.csv` Route Handler) |
| `npm run db:generate` | "No schema changes". Five migrations: `0000_living_gateway.sql` (40 tables), `0001_colorful_speedball.sql` (35 tables, 3 columns), `0002_amazing_lester.sql` (35 tables, 1 column), `0003_jittery_nextwave.sql` (31 tables) and `drizzle/0004_curved_scarlet_spider.sql` (52 new tables, 3 new columns on `machine_types`) |
| `scripts/db-check.ts` | "All checks passed", including the new "Delivery 5 tables (golden row counts)" and "Delivery 5 data (DAL vs prototype)" blocks and the Delivery 5 writes in "Numbering & writes" |
| Golden generators | The nine Delivery 5 generators (§2) were re-run at the final integration; every output is byte-identical to the committed file |
| Route matrix on `next start` with a fresh DB | 214 distinct routes × 8 personas × FR/EN = 3 424 requests, all 200, no "being built" page, no error page, nothing but the start-up lines in the server log; re-run after the writes below, same result |
| Feature reviews | Eight fidelity reviews (eng, pid, quality, itpcom, site, rexclient, aftersales, admin) re-ran the prototype's own logic (design lines 3095–5239) in node:vm, in EN and FR, for every persona, and compared it with the rebuild's view models on a seeded database and with the template's inline styles. English matches the prototype; the French differences and the defect fixes are the deliberate ones in §7. They fixed the deviations listed in §7.1. |

**Route matrix** (final integration; server `next start` on 127.0.0.1:3310 from `.next-ci`, log `/tmp/ks-d5-final.log`; ports 3000,
3100, 3110, 3200, 3210, 3217 and 5173 untouched; `.data` and `.next-ci` deleted afterwards). Cookies `ks-role` × `ks-lang`; a response
counts as good when it is 200, is not the "being built" page and carries no error page.
- **Delivery 5 (25 routes, 400 requests):** `/`, `/projects/HLT-026/engineering` (and `/process`, `/mechanical`, `/electrical`,
  `/automation`), `/projects/HLT-026/{pid, quality, quality?tab=dlv, itp, itp?view=punch, commissioning, site, closure, client}`,
  `/after-sales/{fleet, claims}`, `/admin/{settings, machine-types, integrations}`, `/projects/NDC-031/quality`, `/projects/EWA-051/site`,
  `/my/approvals`, `/reference/eco`, `/portfolio/projects`.
- **Delivery 5 deep links and empty states (56 routes, 896 requests):** discipline chips `?status=open|resolved|sent_back`; P&ID `?tag=LT-101`
  (and `lt-101`, unknown `XX-999`), `?status=unmapped&scope=keystone`, `?part=EL-PLC-S7`, `?q=pump`; Quality `?ncr=NCR-029` (and `ncr-026`,
  unknown `NCR-999`), `?filter=critical`, `?tab=dlv&dlv=D-014`, `?dlv=D-016`, `?tab=dlv&status=submitted`, unknown `?tab=`; unknown ITP
  `?view=`; Site `?tab=team|exec` and unknown; client portal `?tab=decisions|invoices|issues|docs`, ERP-202 invoices, NDC-031 and EWA-051;
  closure of NDC-031, EWA-051, RCF-019; engineering, P&ID, quality, ITP (both views) and commissioning of EWA-051; engineering, P&ID, ITP,
  commissioning and site of NDC-031; WSA-044 quality; claims `?view=interventions|costs` and unknown; machine types `?type=EMP` and
  unknown; integrations `?view=connectors|imports|audit`, `?source=stock`; `/my/approvals?filter=ncr|deliverable`.
- **Delivery 1 (14 routes, 224 requests)**, **Delivery 2 (22 + 16 routes, 608 requests)**, **Delivery 3 (20 + 23 routes, 688 requests)** and
  **Delivery 4 (25 + 34 routes, 944 requests)**: the matrices and deep links of `DELIVERY-1.md` §1 (without `/dev/components`),
  `DELIVERY-2.md` §1, `DELIVERY-3.md` §1 and `DELIVERY-4.md` §1.

**Extra routes:** `/projects/HLT-026/engineering/nope` (unknown discipline), `/projects/HLT-026/quality/extra` (sub-path of a built
screen), `/projects/XXX-999/quality`, `/projects/XXX-999/site`, `/admin/nope`, `/after-sales/nope`, `/reference/nope`, `/my/tasks/T-9999`,
`/dev/components` → 404. `/resources/approvals` → 307 to the viewer's department; `/projects/HLT-026` → 307 to Plan.
`/admin/integrations/audit.csv` → 200 for the director and the PM, 403 for everyone else (the screen is outside their workspace).
The catch-all pages return 404 for a built screen, so the "being built" page can no longer be reached.

**Outside-my-workspace banner** (EN and FR renders agree; `O` = banner, read-only). The Delivery 1–4 routes give the same matrix as
`DELIVERY-2.md` §1, `DELIVERY-3.md` §1 and `DELIVERY-4.md` §1; deep links and empty states follow their screen.

| Route | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| `/projects/*/engineering` and the 4 discipline pages, `/projects/*/closure` | | | O | O | | | O | O |
| `/projects/*/pid` | | O | O | O | | | O | O |
| `/projects/*/quality` (both tabs), `/projects/*/itp` (both views), `/projects/*/commissioning` | | | O | O | | | O | |
| `/projects/*/site` | | | | | O | O | O | O |
| `/projects/*/client` | | O | O | O | O | O | O | |
| `/after-sales/fleet`, `/after-sales/claims` | | | O | O | O | | | O |
| `/admin/settings` | | | | O | | | | O |
| `/admin/machine-types` | | | O | O | | | O | O |
| `/admin/integrations` | | | O | O | O | O | O | O |

**Writes tested at the final integration** (fresh DB, Server Functions posted to `next start` by action ID; results read back from the
rendered pages; the whole route matrix was re-run afterwards with the same result):

| Area | Action | Result |
|---|---|---|
| NCR progress (Vigie mock) | client, then team member, moves NCR-030 | refused ("Only the project team records this progress", "Quality is read-only for you") |
| NCR progress (Vigie mock) | PM moves NCR-030 to Containment, twice | "NCR-030 · Containment requested · Pending sync with Vigie", status stays Vigie's; the second is refused |
| NCR progress (Vigie mock) | quality requests Verification on NCR-026; PM, then quality, verifies it | requested, pending sync; verification refused ("Only the quality manager verifies and closes NCRs"; Vigie still reports Corrective action) |
| Deliverables (PV) | PM accepts D-014; client accepts D-014 twice; client rejects D-016 | refused; accepted (drawer "N. Bensaïd"), then refused ("no longer pending"); rejected |
| Punch list | team member adds an item; PM adds A-item P-10, starts it, closes it, closes it again | refused; added, started, closed; the second close refused ("already closed"). Listed on `?view=punch` |
| ITP / commissioning | engineering lead adds an inspection; PM plans the SAT of Hoist mechanisms on 17 Dec 2026 | "Inspection added to the plan"; "SAT planned · invitation sent to the client" |
| Daily report | quality (read-only) saves one; team member saves one; a report dated after the status date | refused; DR-003, listed on `?tab=exec`; refused |
| Cursus (mock) | PM reminds Thomas Kerbrat twice; confirms prerequisite 3; Sync Cursus | "Reminder sent via Cursus", then refused; confirmed; "Cursus sync · 5 approvals received" |
| Lessons, client issues | client adds a lesson; PM adds one; client raises an issue on HLT-026, then on NDC-031 (another organisation) | refused; LL-10; CI-08; refused ("Only the project's client raises issues here") |
| After-sales | team member opens a claim; quality opens one; procurement adds a machine | refused; WC-020; MCH-050 |
| Settings | team member sets a threshold; director sets At risk 0.92, then Off track 0.95; adds "Welding", then "welding"; Reset | refused; saved; refused (must stay below At risk); added; duplicate refused; "Settings reset to defaults" |
| Machine types, connectors | team member, then director (twice) creates TST; dept head, then director, adds a TIA Portal connector; Sync Vigie | refused; created, then "Code already used"; refused, then listed; "Vigie synced · 0 sent · 2 pending · 0 refreshed" |
| Engineering | client, then engineering lead, resolves C-01 (Electrical) | refused; resolved |
| P&ID | PM unlinks LT-101; engineering lead unlinks it, then links it to FD-DET-OPT | refused (read-only); "Tag unlinked · LT-101"; "Tag linked · LT-101 → FD-DET-OPT" |

## 2. How to run

Same as `DELIVERY-1.md` §2, with these changes:
- **No new npm dependency.**
- **Database:** migration `0004` adds 52 tables and 3 columns. A fresh `./.data` is seeded completely. A database seeded before Delivery 5
  gets `0004` on the next start and then the Delivery 5 modules once, when its Settings lists are empty (`seedDelivery5`,
  `src/server/db/seed/index.ts`). That backfill is not covered by the tests or the route matrix; `npm run db:reset` (server stopped)
  remains the reference. The Mac app keeps its own data in `~/Library/Application Support/Keystone/data` (README: quit the app and delete
  that folder for a fresh demo database).
- **Verification builds:** `KEYSTONE_DIST_DIR=.next-ci npm run build` and `KEYSTONE_DIST_DIR=.next-ci npx next start -p <port> -H 127.0.0.1`
  never touch `.next`. Such a build rewrites the gitignored `next-env.d.ts` to `.next-ci/types`, and its page-data step creates an empty
  `./.data/pg`; point `next-env.d.ts` back to `.next/types` (or run `next dev`) after deleting `.next-ci`, or `tsc` fails.
- **Vigie:** `NEXT_PUBLIC_VIGIE_URL` (default `http://localhost:3200`) is the Vigie web app the links open. `VIGIE_API_URL` (server only) now
  switches both Vigie connectors (ECOs, and NCR / HSE) from the mock to HTTP. Leave it unset until Vigie publishes its API (§5.1).
- **Cursus:** `NEXT_PUBLIC_CURSUS_URL` (default `http://localhost:5173`, Cursus's dev web app) is the address the links open.
  `CURSUS_API_URL` (server only, e.g. `http://localhost:3210`) switches the Cursus connector to HTTP; `CURSUS_API_KEY` is sent as `X-Api-Key`
  (default `demo-keystone`, Cursus's `KEYSTONE_API_KEY`). Unset, the mock is used: tests and the default run never need Cursus running.

Golden generators (each one runs the prototype logic in node:vm and rewrites a committed JSON; re-running them must leave the files unchanged):

| Script | Output |
|---|---|
| `npx tsx scripts/proto-golden-d5.ts` | `src/server/dal/delivery5.golden.json` (EN render values behind every Delivery 5 screen, the NCR and deliverable drawers, the two new My approvals kinds) |
| `npx tsx scripts/proto-golden-eng.ts` | `src/features/eng/eng.golden.json` (synthesis, four disciplines, chips, import wizard presets / steps / tools, 17 replayed actions, EN and FR) |
| `npx tsx scripts/proto-golden-pid.ts` | `src/features/pid/pid.golden.json` (KPIs, chips, scopes, steps, 24 tag rows and drawers, overlay, map / unlink scenarios) |
| `npx tsx scripts/proto-golden-quality.ts` | `src/features/quality/quality.golden.json` (both registers, filters, drawers, row actions, My approvals items) |
| `npx tsx scripts/proto-golden-itpcom.ts` | `src/domain/itpcom.golden.json` (ITP and punch list, commissioning grid and dossier, forms, 7 projects) |
| `npx tsx scripts/proto-golden-site.ts` | `src/domain/site.golden.json` (three tabs, header, NO GO badge, empty state) |
| `npx tsx scripts/proto-golden-rexclient.ts` | `src/domain/rexclient.golden.json` (lessons and closure, client portal tabs, transitions) |
| `npx tsx scripts/proto-golden-aftersales.ts` | `src/domain/aftersales.golden.json` (4 zones × 3 claims views, installed base, add-forms) |
| `npx tsx scripts/proto-golden-admin.ts` | `src/features/admin/admin.golden.json` (Settings, Machine types, Activity & integrations, replayed edits) |

## 3. Data

### Newly modelled (migration `0004`, schema in `src/server/db/schema/`, seeders in `src/server/db/seed/`)

| Schema file | Tables | Seeded from |
|---|---|---|
| `quality.ts` | `deliverables`, `deliverable_raci` | HLT_DELIVS (HLT-026: 10) and the prototype's generated D-110…D-113 for the five other projects with data: 30 deliverables, 150 RACI-B rows. The `acc` text is split into dates and people |
| `vigie.ts` (extended) | `vigie_ncrs`, `vigie_ncr_progress`, `vigie_hse_items` | The **read-only mirror** of Vigie: HLT_NCRS (15 NCRs: 5 on HLT-026, 2 on each other project with data) and SITE_HSE (5 items), through `prototype-snapshot.ts`; `vigie_ncr_progress` is the outbox (empty at seed) |
| `operations.ts` (extended) | `itp_plans`, `itp_inspections`, `punch_items`, `commissioning_systems`, `commissioning_steps`, `sat_plans`, `handover_items`, `lessons_learned`, `closure_items`, `satisfaction_scores` | ITP (1 plan, 13 inspections), PUNCH and SITE_PUNCH (8 items in two registers), COMMISSIONING (6 systems, 30 steps, 8 handover items), LESSONS (4), CLOSURE (10), SATISFACTION (5); HLT-026 only, as in the prototype |
| `aftersales.ts` | `machines`, `machine_part_revisions`, `warranty_claims`, `interventions` | FLEET (8), AS_MAINT (31 part revisions on 6 machines), CLAIMS (8), INTERVENTIONS (6; "Corrective · WC-014" split into type and claim) |
| `site.ts` | `site_sheets`, `site_equipment`, `site_prerequisites`, `site_rotations`, `site_collisions`, `mission_cost_lines`, `daily_reports` | SITE (HLT-026), SITE_EQUIP (8), SITE_PREREQ (6), SITE_ROTATION (6), SITE_COLLISIONS (4), SITE_COSTS (6), SITE_REPORTS (DR-001, DR-002). `site_sheets.cursus_chantier_id` (null in the seed) is the site's id in Cursus |
| `cursus.ts` | `cursus_clearances`, `cursus_requests`, `cursus_sync_runs` | The **mirror** of Cursus's approvals: SITE_DOCS (5 people, visa / vaccination / clearance, verdict) as received at "26 Sep 07:00"; `cursus_requests` is the outbox (reminders, travel requests) |
| `client.ts` | `client_issues`, `client_document_categories` | CLIENT_ISSUES (3, scoped to HLT-026, the client persona's organisation), CLIENT_DOCS (5 categories) |
| `engineering.ts` | `eng_disciplines`, `eng_inputs`, `eng_consistency_rules`, `eng_checks`, `eng_outputs`, `eng_changes`, `eng_import_tools`, `eng_column_mappings`, `eng_import_deltas`, `eng_imports`, `pid_sheets`, `pid_tags`, `pid_validation_steps` | ENG_* of HLT-026 (4 disciplines, 12 inputs, 6 rules, 10 checks, 6 outputs, 4 changes, 4 tools, 6 mappings, 4 deltas; the deliverables ENG_DOCS are Codex records in `documents`), PID (1 sheet rev C, 24 tags, 5 validation steps) |
| `portfolio.ts` (extended) | `machine_type_phases`, `machine_type_cost_categories`, `machine_type_itp_systems`; `machine_types` + `name`, `description`, `calendar` | NP_TEMPLATES and ITP_TEMPLATES (28 phases, 25 cost categories, 17 ITP systems) |
| `settings.ts` | `reference_values`, `app_settings`, `connectors`, `connector_sync_runs`, `import_formats` | SETTINGS0 (60 list entries; stock locations stay in `storage_locations`), health thresholds 0.97 / 0.9, CONNECTORS (9 plus Vigie), IMPORTS (6) |

New codes in `src/server/db/codes.ts`: NCR severity, source, status and flow (`ncrNextStatus`), verification decisions and verifier roles; HSE
kinds and statuses; deliverable types and statuses (`DELIVERABLE_ACCEPTANCE_DAYS = 10`); ITP point types, stages, results; punch
categories, sources, statuses, registers and owner parties; commissioning steps and cell statuses; handover item statuses; lesson
themes and statuses; closure item statuses; claim statuses and coverage; intervention types and statuses; client issue statuses;
Cursus visa / vaccination / clearance / verdict and request kinds and sync states; equipment sources, confirmation, collision kinds,
weather, HSE incidents; disciplines, check severities and statuses, input and output states, import deltas; P&ID tag kinds, PLC
types, roles, step states and tag statuses; connector kinds, statuses and directions; import-format directions; Settings list keys;
health defaults; `D5_SCREEN_ROLES` / `inWorkspace` (the workspace rule the Delivery 5 writers check).

Rules settled in the data layer:
- **NCRs and HSE items:** never written by Keystone except through the connectors' refresh (`upsertNcrMirror`, `upsertHseMirror`). Progress
  goes to the outbox and the NCR keeps Vigie's status until Vigie reports the change (§5.1).
- **Deliverable acceptance (PV):** only a client contact of the project's client organisation; the viewer and the status date are stamped;
  "Accept by" is the submission date + 10 days.
- **Punch items:** one entity, two registers (`itp` A/B/C, `site` owner party and NCR), numbered per register (A-6 still open).
- **Year-less seed dates** (`seed/dates.ts`): read as 2026, except forward-looking dates more than six months before the status date,
  which are 2027 (D-021 "14 Jan" → 2027-01-14).
- **Client issues:** per project, `CI-nn` zero-padded (CI-08 … CI-10). **Invoices** on the client portal and the client Home come from
  the contract billing plan (A-5).
- **Installed base:** a machine's zone is its site city's zone; an added machine's warranty status follows its end date
  (`addedWarrantyStatus`). Configuration counts are the ECO effectivity targets of the Vigie ECO mirror.
- **Engineering deliverables** are Codex records (`documents`): their statuses are shared with the Documents screen. An import freezes the
  revision as input, refreshes the P&ID input and closes the checks it resolves.
- **Settings:** lists and thresholds are company-wide; "Reset to defaults" restores SETTINGS0 and 0.97 / 0.9 for everyone (A-14).
- **Connectors:** Codex, Vigie and Cursus rows show the mode and state of Keystone's connector layer; "Sync now" runs those three for
  real (the Codex index sync, the Vigie and Cursus connectors, mock or HTTP) and records a simulated run for the others.

### Writes that persist (new in Delivery 5)

Every write validates its raw input and checks the viewer server-side, including the outside-workspace and project read-only rules
(`requireWorkspace`, `src/server/dal/ops-common.ts`). It records the viewer as the actor in `audit_entries` / `activity_events` and
revalidates the affected screens and badges.
- **Quality:** NCR step request and the quality manager's verification (sent to Vigie, §5.1); deliverable Start → To internal review →
  Submit to client; client Accept / Reject (with comments); link the issued Codex document.
- **ITP / commissioning:** Add inspection (I-20…), Add punch item (P-10…), punch Start / Close, Plan SAT (dates the system's SAT step).
- **Site:** prerequisite Confirm / Sign, equipment Confirm, Daily report (DR-003…), Remind in Cursus and Sync Cursus (§5.2).
- **Closure and client portal:** Add lesson (LL-10…), Validate / Mark applied, closure checklist cycle; client decisions on change
  requests (through the change-control DAL) and deliverables, Raise issue (CI-08…), Acknowledge shared document, Download status report
  (request recorded, no file).
- **After-sales:** Add machine (MCH-050…), New claim (WC-020…).
- **Engineering:** Confirm input, Resolve / Send back check, deliverable steps up to Validate release (PM), Generate output, Import a list.
- **P&ID:** Map / Unlink a tag, Import P&ID tags (staged preview, then apply).
- **Administration:** Settings list entries (add / remove), health thresholds, Reset to defaults; machine-type fields, phases, ITP
  systems, cost categories, REX references, New machine type; Add connector, Sync now; audit CSV export.
- **My approvals inline decisions:** NCR verification and deliverable acceptance are decided for real.

### Still not modelled

- Lucca (leave and hours), Sage X3 stock import (mock snapshot), the P&ID ImportJob, re-baseline rows, the activity ↔ change-request
  link, a project's template index (§6).
- Real connectors: Vigie API (ECO, NCR, HSE), Cursus reminders (no endpoint), Codex, Sage X3, SolidWorks PDM, Lucca, Outlook / mail.
- Files: P&ID sheet image (X-15), daily-report photos, generated reports (status report, PV, 8D).

## 4. What is implemented

All 59 registry screens are built (`built: true` in `src/config/screens.ts`; `src/config/screens.test.ts` checks that each has its own
`page.tsx` and that `screenHref` and `matchScreen` agree).

### Engineering synthesis — `/projects/[code]/engineering` (spec 09 §7)
- KPI tiles (Blocking inconsistencies, Outdated inputs, Deliverables released, Outputs ready), the "Who is waiting for what" matrix,
  discipline cards, the gate "Plans & BOM frozen", recent changes with impacts. Document ids open their record on the Documents screen.
- Primary "Import a list" (wizard `?import=&doc=&tool=`) for viewers who may edit the project. Empty state on projects without a register.

### Engineering disciplines — `/projects/[code]/engineering/{process|mechanical|electrical|automation}` (spec 09 §8)
- Header line, KPI tiles (Inputs up to date, Deliverables released, Open inconsistencies, Outputs ready), inputs (Confirm), own
  deliverables (Freeze, Propose release, Validate release (PM) for the project's PM or the director), generated outputs (Generate xlsx),
  consistency checks with chips `?status=open|sent_back|resolved` (Resolve here, Send back to tool).
- Import wizard: the discipline's preset, "Import new rev", three steps (Source, Column mapping, Check & import) and the import itself.
- Sidebar badges: blocking checks per discipline (`engNavBadgesByProject`). Unknown discipline → 404.

### P&ID — tags, overlay & process validation — `/projects/[code]/pid` (spec 09 §6)
- KPI tiles (P&ID, Tags in our scope, Linked to a BOM reference, Unmapped tags, Reference issues), status chips `?status=`, scope
  segment `?scope=`, search `?q=`, the 5 validation steps, the tag register, the overlay list, the sheet card (Codex revision and status).
- Tag drawer `?tag=` (case-insensitive) with the record and up to 8 BOM candidates: Link / Unlink; "Part record" opens `<PartDrawer/>`
  (`?part=`) over the screen; "Add reference to project BOM" opens the BOM with the part drawer for editors.
- Primary "Import P&ID tags": "Check tags" (preview, nothing written), then "Import tags". Editors: director, engineering lead, quality
  (not the PM: the screen is outside their workspace). Sidebar badge = tags in scope not linked to a valid reference (HLT-026: 9).

### Quality — NCR & deliverables — `/projects/[code]/quality` (spec 07 §2.3, **Vigie owns the NCRs**)
- Registers `?tab=ncr|dlv`. NCR log: KPI tiles (Open NCRs, Critical, Cost of non-quality, Overdue actions, From goods receipt), severity
  chips `?filter=`, rows with the progress segments, the step the viewer may request and the sync line; drawer `?ncr=` with Vigie's
  causes, actions and costs read-only, "Open in Vigie", "8D report" and "Manage in Vigie". "New NCR" opens Vigie's report form.
- Deliverables: KPI tiles (Deliverables, Awaiting client acceptance, Due in 30 days, Without backup (B), Rejected), status chips `?status=`,
  register, drawer `?dlv=` with the step indicator, RACI-B, the issued Codex document (link or deposit), the client's PV.
- The client sees no Vigie link and no NCR step; only the project's client contact accepts or rejects. Nav badge = open critical NCRs.

### Inspection & test plan · punch list — `/projects/[code]/itp` (spec 07 §2.4)
- `?view=plan|punch`. KPI tiles (Inspections passed, Hold points ahead, Open punch items, Template). Plan grouped by template system
  (hold / witness / review / surveillance points, results read-only, record documents linked to the Documents record or a vault search);
  punch list A blocking / B before SAT / C cosmetic with the Start / Close step.
- Primary "Add inspection" or "Add punch item". Nav badge = open category-A punch items. Empty states on projects without a plan.

### Commissioning & handover dossier — `/projects/[code]/commissioning` (spec 07 §2.6)
- KPI tiles (Systems handed over, Steps completed, Blocking punch items (A), Handover dossier), the grid systems × Mechanical
  completion → Pre-commissioning → Commissioning → SAT → Handover, "Blocking A" per system, the dossier completeness (Codex documents).
- Primary "Plan SAT" (system, date not before the status date, witnesses defaulting to the project's client contacts).

### Site (chantier) — `/projects/[code]/site` (spec 10 §3)
- `?tab=ready|team|exec`. Readiness & go: KPI tiles (Go chantier, Client prerequisites, Individual go · Cursus, Equipment confirmed,
  Collisions), the five Go conditions, prerequisites (Confirm / Sign), equipment (Confirm), the Cursus card (people, approvals, verdict,
  Remind in Cursus, Sync Cursus, Open Cursus). Team & mobilisation: rotation plan (From / To), collisions, mission costs. Daily execution:
  daily reports, site punch list, Vigie's HSE register ("Declare incident", "Manage in Vigie", co-activity map).
- Primary "Daily report" when the project has a site sheet. Nav badge "NO GO" while Go chantier is not reached.

### Lessons learned & project closure — `/projects/[code]/closure` (spec 07 §2.7)
- KPI tiles (Lessons recorded, To validate, Closure checklist, Customer satisfaction), lessons with Validate / Mark applied, the closure
  checklist (click to cycle), the satisfaction survey. Primary "Add lesson". Projects without REX data show empty lists and "—" tiles.

### My project — client view — `/projects/[code]/client` (spec 03 §8)
- `?tab=progress|decisions|invoices|issues|docs`. KPI tiles (Progress, Forecast handover, Milestones, Awaiting your decision, Open issues),
  progress bars and milestones; change requests and deliverables awaiting the client and decided; invoices from the contract billing plan
  (Contract value, Invoiced, Paid, Approved changes) and the contract summary; issues (Raise issue); released documents shared with the
  client (Codex record, Download, Acknowledge).
- Primary "Download status report". The client and the director work here; only the project's client contact decides and acknowledges.

### Installed base — `/after-sales/fleet` (spec 07 §2.8)
- KPI tiles (Machines in service, In warranty, Warranty ending < 90 days, Machines with open claims), the machine register filtered by the
  zone bar, the configuration column (pending / retrofit / pinned counts from the Vigie ECO mirror; the tag opens the Change orders screen,
  the arrow Vigie, never for the client). Primary "Add machine".

### Warranty claims & interventions — `/after-sales/claims` (spec 07 §2.9)
- `?view=claims|interventions|costs`. KPI tiles (Open claims, Interventions planned, Warranty cost YTD, Design-related), claims open first
  with their ECO tag, interventions (column "Type"), costs per machine. Primary "New claim". Nav badge = open Major / Critical claims.

### Settings — `/admin/settings` (spec 10 §1)
- KPI tiles (Stock locations, Skill families, Cost categories, Health rules, Public holidays), the seven reference lists (add / remove,
  duplicates refused), the health thresholds (validated), "Rate cards" link. Primary "Reset to defaults" (with a confirmation).

### Standard machine types — `/admin/machine-types` (spec 09 §9)
- KPI tiles (Machine types, Projects covered, Planning templates, ITP systems, REX patterns), the type list `?type=`, the editor (label,
  description, active, deposit / delivery %, default calendar, phases, cost categories with budgets, ITP systems, REX references).
  Primary "New machine type" (blank or copied from a type). Editors: director, PM, engineering lead, quality.

### Activity, integrations & audit — `/admin/integrations` (spec 10 §2)
- KPI tiles (Events today, Connectors, Unread notifications, Audit entries · 7 days, Channels); `?view=activity|connectors|imports|audit`,
  activity source chips `?source=`; connectors (10, plus those added in Keystone) with Sync now; import / export formats (drop zones staged);
  audit trail with the ISO 9001 CSV export `audit.csv` (director and PM). Primary "Add connector". Nav badge "!" when a connector needs attention.

### Shell, Home and My approvals (now read from the database)
- **Sidebar badges** (`src/server/dal/shell.ts`): Engineering and the four disciplines, P&ID, Quality, Inspections, Site, Warranty claims and
  Activity & integrations. The shell reads no prototype data except reference constants (zones, cities).
- **Global search:** NCR hits come from the Vigie mirror of the current project.
- **Zone bar:** the Installed base / Warranty claims counts come from the installed base.
- **Client Home:** deliverables from the register (being produced, submitted, rejected, accepted in the last 30 days); the invoice row is
  the contract's open invoice ("INV-2026-003 · M3 Structure topped out · €1.38M · due 10 Nov"), as on the portal's Invoices tab (A-5).
- **My approvals:** every kind reads the database (`source: 'db'`); the prototype item builders, the `preview` decision mode and the
  `'prototype'` source are gone. New kinds: NCR verification (quality manager, Approve → Closed / Reject → Corrective action, sent to
  Vigie, with "Open in Vigie") and Deliverable acceptance (the project's client contact).
- **Also switched to the database:** supplier scorecard NCR counts (Vigie mirror), Interfaces "Blocking commissioning" (commissioning grid),
  installed base in the part drawer and the ECO effectivity machines (`machines.ts`).

### Platform
- Domain modules with golden tests: `engineering`, `pid`, `pid-import`, `quality`, `itpcom`, `site`, `rexclient`, `aftersales`, `admin`.
- Integrations: `src/server/integrations/vigie/quality-*` (NCR / HSE), `src/server/integrations/cursus/` (§5).
- i18n: `src/i18n/extra/{eng,pid,quality,itpcom,site,rexclient,aftersales,admin}.json`; feature `i18n.ts` helpers for parameterised French.

## 5. System boundaries

Keystone mirrors what the other EPC2i applications own, links to them and records the viewer's own progress through an outbox. No
Keystone Server Function creates or edits a Vigie NCR / HSE item, a Cursus clearance or a Codex document. Vigie and Cursus were not
modified by this delivery.

### 5.1 Vigie — non-conformities and site HSE (ECOs: `DELIVERY-4.md` §5)

**What Keystone shows.** The project's NCRs as Vigie reports them (Quality log and drawer, My approvals, global search, the Quality nav
badge, the supplier scorecard NCR counts, the Site punch list's NCR column) and the site HSE register (prevention plans, inductions,
permits, near-miss register) on the Site screen. Status, severity, causes, 8D, actions, costs and due dates are Vigie's values; Keystone
derives only KPIs, chips, progress segments and texts (`src/domain/quality.ts`).

**What progress Keystone records** (`recordNcrProgressEntry`, `src/server/integrations/vigie/quality-progress.ts`):
- **Step:** exactly the next step of Vigie's status, never Closed, by a viewer whose workspace includes Quality (not the client); one request
  waiting for Vigie per NCR.
- **Verification:** the quality manager only, on an NCR in Verification: Approve → Closed, Reject → back to Corrective action (My approvals
  and the drawer).
- Each entry goes to `vigie_ncr_progress` with the actor and a sync state; the UI shows "Pending sync with Vigie" and the NCR keeps Vigie's
  status until Vigie reports it. Creation ("New NCR" / "Report in Vigie"), severity, causes, actions and HSE items are managed in Vigie.

**Connector** (`quality-connector.ts`, interface `VigieQualityConnector`: `listNcrs`, `getNcr`, `recordNcrProgress`, `listHse`, `sync`;
`getVigieQualityConnector()`): **mock** by default (mirror seeded from HLT_NCRS / SITE_HSE, progress stays pending); **http** when
`VIGIE_API_URL` is set (`TODO(vigie)`): refreshes both mirrors at most once a minute with prune, 5 s timeout, stale mirror when Vigie is
unreachable; `GET /api/ncrs?source=keystone`, `GET /api/hse?source=keystone`, `POST /api/ncrs/:project/:number/progress` are proposals.

**URL patterns** (`src/server/integrations/vigie/links.ts`, the only place Keystone builds Vigie URLs; all `VIGIE_LINK_ATTRS`, `target=_blank`),
chosen from Vigie's real routes (README, `src/app`):
- `vigieNcrUrl` → `/evenements?etat=tous&sel=<Vigie event id>`; without a Vigie id (the seed) → `/evenements?etat=tous&type=NC&q=NCR-029`
  (finds nothing today: **OPEN QUESTION V-3**, Vigie has no field for Keystone's NCR number). `vigieNcrListUrl` → `/evenements?type=NC`.
- `vigieReportNcrUrl` → `/signaler?type=NC&projet=&article=&activite=&titre=&lieu=&source=keystone` (Vigie reads only `lieu` today; the others
  are proposals, V-3). `vigieReportIncidentUrl` → `/signaler?projet=&lieu=&source=keystone`.
- `vigieHseUrl` → `/prevention?plan=PP-…`, `/prevention?onglet=permis&permis=PF-…`, register → `/evenements?etat=tous&type=PA`;
  `vigieHseListUrl` → `/prevention`; `vigieCoactivityUrl` → `/prevention/carte`.
- Vigie's events carry its own project ids ("K-2025-042"), not Keystone codes: no link can filter on a Keystone project yet (V-3).

### 5.2 Cursus — individual clearances and the people Go / No Go

**What Keystone shows.** On the Site screen: each person's visa, vaccinations, clearances and badges, the Cursus verdict and when it was
received, the KPI "Individual go · Cursus" and the Go chantier condition built on it; the Site nav badge reads it too.

**What Keystone records.** "Remind in Cursus" (one reminder per person whose verdict is not GO) and travel requests (connector method only,
no screen: the missions tool P5 is not validated) go to the outbox `cursus_requests` ("Pending sync with Cursus"). "Sync Cursus" refreshes
the verdicts and delivers the outbox.

**Connector** (`src/server/integrations/cursus/`, interface `CursusConnector`: `getGoNoGo`, `sync`, `remind`, `requestTravel`;
`getCursusConnector()`):
- **mock** (default): the mirror seeded from SITE_DOCS; requests stay pending.
- **http** (`CURSUS_API_URL` set): Cursus's existing contract, `GET /api/integrations/keystone/chantiers/:id/go-no-go` (refresh at most once
  a minute per project, 5 s timeout; a failed refresh is retried after the same minute and logged as a failed sync run, the mirror is used
  meanwhile) and `POST /api/integrations/keystone/demandes` for travel requests, header `X-Api-Key`. A site without `cursus_chantier_id`
  is not refreshed. Cursus has no reminder endpoint, so reminders stay pending (`TODO(cursus)`).
- Links (`cursus/links.ts`, `CURSUS_LINK_ATTRS`): `cursusChantierUrl` → `/chantiers?chantier=<id>`, `cursusClearancesUrl` → `/habilitations`,
  `cursusTravelUrl` → `/voyages`.

Open questions (written `C-1`…`C-3` in the code comments; not spec 00 §10's cost questions of the same ids): **C-1** Cursus has no
parameter selecting a site or an employee (the `chantier` parameter is a proposal it ignores); **C-2** no reminder endpoint; **C-3**
matricule ↔ Keystone person and project ↔ Cursus site mapping (who fills `cursus_chantier_id`).

### 5.3 Codex — documents (`DELIVERY-3.md`)

Keystone keeps the index and links: engineering deliverables are Codex records whose statuses the Documents screen shares; the Quality
deliverable drawer links or deposits the issued document (`depositHref`, `docHref`); ITP records and the handover dossier resolve
against the index (`/projects/<code>/documents?doc=`, else a vault search); the client portal lists released documents shared with the
client (Download, Acknowledge); the Codex connector row shows its mode and last sync. P&ID: the sheet shows the Codex revision (rev D
released) next to the registered P&ID revision (rev C) — which one is the source is A-9.

## 6. Known gaps — `TODO(db)` and placeholders

`grep -rn "TODO(db)" src` (12 markers). Retired in Delivery 5: every badge, crumb and search hit of the shell, the client Home deliverables
and invoice literal, the NCR and deliverable kinds of My approvals and their prototype builders, the installed base (part drawer, ECO
effectivity, `machines.ts`), the supplier scorecard NCR counts and the Interfaces "Blocking commissioning" column.

| Where | What is still read from the prototype / not persisted |
|---|---|
| `src/app/(app)/projects/[code]/hours/page.tsx:32`, `src/features/hr/actions.ts:94, 117`, `src/features/hr/leave-view.tsx:30` | Lucca connector |
| `src/features/hr/skills-view.tsx:37` | "Requests needing level ≥4" constant (06 OQ4, A-12) |
| `src/domain/home.ts:528` | "Unmet demand 240 h" constant (A-12) |
| `src/features/schedule/actions.ts:14` | Re-baseline should write a `baselines` row |
| `src/features/plan/drawer-model.ts:127` | Activity ↔ change request link |
| `src/server/dal/plan.ts:149` | Template index (DEFS idx) of a project is not stored (read at `plan.ts:151`) |
| `src/server/dal/stock.ts:312` | Sage X3 stock import: the mock returns the seed snapshot |
| `src/server/dal/pid-import.ts:9` | The staged P&ID import is not stored as an ImportJob (11 §3.12) |
| `src/server/prototype/index.ts:4` | Rule: prototype reads must be marked `TODO(db)` |

Prototype reads that are reference constants, not gaps: zones (`src/server/dal/shell.ts:65`), project identity (`src/components/app/shell/page-header.tsx:63`),
the SETTINGS0 locations "Reset to defaults" restores (`src/server/dal/settings.ts:166`).

Other markers: `TODO(vigie)` in `src/server/integrations/vigie/eco-connector.ts:10, 46, 72, 89` (V-2) and `quality-connector.ts:9, 53, 78, 96`
(V-3); `TODO(cursus)` in `src/server/integrations/cursus/connector.ts:12, 159` (C-2); `TODO(X3)` in `src/server/dal/orders.ts:5` and
`src/domain/orders.ts:167`.

Other gaps:
- **Coming-soon toasts and inert controls (new):** P&ID "Open in PDM" and "Export overlay list"; Site "Client communication log"; client portal
  "Download statement"; connector "Configure"; import drop zones (file received, import not built) and export cards. "Download status
  report" records the request but produces no file; "SAT planned · invitation sent to the client" sends nothing (no mail connector, X-6).
- **Constants kept from the prototype** (A-12, 10 OQ7): Site "Client decisions logged 3" and the site premium "×1.5 / ×2"; the "1 248 drawings"
  PDM volume; the Cursus row's frequency "Real time (webhooks)" (the connector refreshes on read, at most once a minute).
- **Settings not wired yet** (A-13, A-14): Project health does not read the Settings thresholds; the risk register's category chips do not
  read Settings › Risk categories. Fixing either means editing the health and risks code.
- **Left open by the reviews** (no code change):
  - Engineering: French keeps "0 bloquantes" after 0; LST-IO-026 rev B flagged outdated against rev A (09 OQ12); "Validate release" bypasses
    the Codex approval circuit (P-7); imported file contents are simulated; focus is not moved when a row action removes its own button;
    on phone widths the "Impacts" column squeezes the change text (as in the prototype).
  - P&ID: no sheet image (X-15); after unlinking LT-101 its seeded mapping to EL-PLC-S7 cannot be restored (not a compatible candidate, as in
    the prototype); candidate search limited to 8 parts (E-6).
  - Quality: Vigie links without a Vigie id find nothing (V-3); "Without backup (B)" subtitle is static (RACI cannot be edited); rejected
    deliverables are terminal (07 OQ9); outside viewers (not the client) still see "Open in Vigie" / "Manage in Vigie", as on the ECO screen.
  - ITP / commissioning: editable commissioning steps (Q-5); recording ITP results and raising an NCR in Vigie on a failure (Q-6); merging the
    two punch lists (A-6); "Handover" is « Livraison » (spec 11 suggests « Transfert »); IF-02 / IF-05 in blocked cells are plain text.
  - Site: the HSE tile counts the incidents of Keystone's daily reports, not Vigie's; "Individual go · Cursus" reads Ready when Cursus has sent
    no verdict yet (decision needed); tables of a site sheet without rows have no empty-row message (only HLT-026 has a sheet).
  - Client portal: clients of another organisation can open the portal read-only and download the status report (P-10); due dates of older
    billing plans without invoice records; the client Home invoice row of legacy monthly billing reads "Sep · €260k".
  - After-sales: "Warranty cost" keeps the literal "20 k€" suffix in English (Q-8); the zone notice says "No project in this zone for this view"
    on machine lists (X-16); "Warranty cost YTD" adds every year; "< 90 days" uses the original warranty end, not an extension; claims have no
    drawer, status change or ECO link (07 OQ20); the cost-bar column's accessible name repeats "Warranty cost".
  - Administration: "Sync now" on SolidWorks PDM and Lucca simulates a run (not linked to Drawings' "Sync vault" or the Lucca sync); the texts the
    DAL writes for connector runs and additions stay in English in French.
  - Refusal messages: a repeated Cursus reminder says "This step is not available any more" and a PM deciding a deliverable "This decision is
    not waiting for you any more", instead of the real reason.

## 7. Deliberate deviations from the prototype

Delivery 1–4 deviations still apply (`DELIVERY-1.md` §6, `DELIVERY-2.md` §6, `DELIVERY-3.md` §6, `DELIVERY-4.md` §7). New in Delivery 5:

| Area | Prototype | Rebuild |
|---|---|---|
| NCR ownership (user decision, overrides 07 §2.3) | NCRs created and managed in Keystone (form, severity, steps, closure) | Vigie owns them; Keystone shows the mirror, opens Vigie ("New NCR", "8D report", "Manage in Vigie") and records the viewer's step and the quality verification, sent to Vigie (§5.1); severity read-only |
| Site HSE (user decision) | HSE register in Keystone | Vigie's register (mirror); "Declare incident" and "Manage in Vigie" open Vigie |
| Cursus (user decision) | Static approvals, "Sync" toast | Cursus connector mirror; reminders and sync through the outbox (§5.2); links open Cursus |
| Deliverable acceptance (07 OQ14) | Any client-role viewer; acceptance text "Accept by 10 days" | Only a client contact of the project's organisation; PV stamped with the viewer and the status date; "Accept by 5 Oct" |
| Quality KPIs (07 OQ5) | Literal dates for "Due in 30 days" and "Overdue actions" | Computed from the status date (overdue as of the next weekly review, status date + 7) |
| Harbor Line fallback (00 §7.16) | HLT-026's NCRs, ITP, site, REX, register and P&ID on every project | Empty states with their own messages ("No non-conformance reported for this project", "No punch item yet", …) |
| My approvals (NCR, deliverable) | Preview decisions on prototype data | Decided for real on the database (§4) |
| ITP / punch / SAT | Labels stored; edits keyed by text; "Plan SAT" toast | Codes stored, edits per record; Plan SAT saved (date not before the status date, witnesses from the client contacts); the first inspection on a project without a plan creates it from its machine type |
| Site (10 OQ5–OQ11, 00 §7.16) | Late prerequisites from two fixed dates; literal rotations, man-days, incidents, collisions; GO tag always accent; rotation plan columns showing dates under "Issued by / Recipients"; Daily report toast dated after the status date | J-15 rule; counted figures; GO neutral / NO GO accent (10 OQ9); columns "From / To"; Daily report saved (DR-003…, not after the status date); "Reminder sent" only once a reminder exists |
| Client portal (00 §7.16, 03 OQ2, OQ6, OQ16) | Issue id "CI-010"; issues global; static invoices "F-2026-1nn", "Due 15 Oct"; Documents tab bound to the engineering register's keys | CI-08 … CI-10 per project; invoices from the contract billing plan (A-5: INV-2026-00n, €5.52M, "Due 10 Nov"); "Reference" column, "Released documents shared with you" / "No document shared with you yet"; only the client contact decides and acknowledges |
| Installed base / claims (00 §7.16, 07 OQ7, 07 A.1, OQ20) | Interventions column headed "Project" showing the type; zone notice testing the machine list; every added machine "In warranty"; claim ECO tag inert | Column "Type"; notice tests the list on show; warranty status from the end date; the claim's ECO opens Keystone's Change orders screen when Vigie reports it, else Vigie; configuration tags add "Open in Vigie"; no Vigie link for the client |
| Engineering (09 OQ11) | "Validate release (PM)" for every role; an import by a discipline not yet consuming the document stored but never listed; the synthesis button reuses the last wizard | PM or director only; a new input row; the wizard's initial choice; document ids link to the Documents record; "Generated 2 Oct · xlsx" for earlier days |
| P&ID | "Unknown ref" has no chip; unlink only with a resolved part; badge "0"; silent in-memory mapping; one-step import at rev "E"; sheet label hard-coded "PID-HLT-026"; "Open in PDM" / "Export overlay list" without handler | Own chip; unlink allowed; no "0" badge; saved mapping with a toast; "Check tags" then "Import tags", default rev = the one after the registered revision (D); the P&ID's own number; coming-soon toasts |
| Administration (10 OQ2, A-14, P-14, E-9) | Reset without confirmation, in memory; any parsed threshold; duplicates accepted; remove buttons outside the workspace; "1 ITP systems"; 9 connectors | Confirmation, saved company-wide; thresholds in ]0, 2] with Off track < At risk; duplicates refused; remove hidden outside the workspace; singulars; 10 connectors (Vigie added; Codex, Vigie, Cursus show their mode); audit CSV export (ISO 9001) |
| Client Home (A-5) | "Milestone 4 invoice €640k · due 15 Oct"; deliverables of Harbor Line | The contract's open invoice; deliverables from the register; "Accept by 2 Oct"; D-017 "In progress" |
| Catch-all | "This module is being built" for any screen | 404 for a built screen (unknown paths 404, `/projects/<code>` → Plan) |
| French texts | Plurals after 1; English left in place ("Under review", ISO 9001 clause titles, the step in "Move to …", "Close"); « Fiche » on the Add lesson button | Singular forms; translated texts and the official clause titles; « Enregistrer »; « rév. »; decimals « 4,0 » |
| Dates | "02 Sep"; year-less | "2 Sep"; the year when outside 2026 or more than six months from the status date ("14 Jan ’27") |

Kept on purpose although questionable: French "0 bloquantes" after 0; the prototype's "latest revision" rule (09 OQ12); the "20 k€" suffix
(Q-8); the zone notice wording (X-16); "Warranty cost YTD" over every year; the Cursus row frequency text; « Livraison » for "Handover";
outside viewers other than the client see Vigie links; text coming from Vigie or Cursus is translated only on an exact dictionary match.

### 7.1 Fixed by the fidelity reviews and the final integration

| Feature | Fix |
|---|---|
| Engineering | Document pills in the "Who is waiting for what" matrix wrap inside their cell (long FR labels spilled into the next column); legend and tool dots no longer squashed |
| P&ID | Tooltips on the truncated part-name, activity and candidate-name cells |
| Quality | Empty states of projects without data ("No non-conformance reported for this project", "No deliverable registered for this project"; filter-emptied lists keep the prototype's message); the severity control spans the NCR drawer; French for "Quality reference" and the three ISO 9001 clause titles; a leftover review test removed |
| ITP / commissioning | Punch step carries the status it starts from (test aligned); boxed empty panel "No punch item yet"; the punch reference column has an accessible name "Reference" |
| Site | "Remind in Cursus" sends the name as Cursus stores it (was keyed on the translated name); French agreement for 1 ("1 non confirmé", "1 condition sur 5 ouverte", …); "Recorded" → « Enregistré »; "1 collision" |
| Client portal / closure | Internal project ERP-202 shows the €0k contract rows instead of "no client billing"; Documents sub-title "Released documents shared with you"; "Add lesson" submit « Enregistrer » |
| After-sales | No Vigie link for the client; added machines with a past warranty end are Out of warranty; the nav badge queries the claims directly and `listMachines` reuses the domain's "ending" rule |
| Administration | Add-form sub-lines name the current project; "Rate cards" footnote laid out as three items; hover wins over the selection in the machine-type list; the calendar select holds the new value while saving; "No audit entry yet"; French connector volumes and activity texts; audit area "Integrations" translated inside the feature |
| Integration | 17 screens flagged built, `screens.test.ts`, catch-all 404 for built screens; shell badges, search and zone bar, the client Home, My approvals (prototype builders, `preview` mode and `'prototype'` source removed), supplier NCR counts, Interfaces "Blocking commissioning" and the installed base on the database or the mirrors |
| Final integration | No code change needed (every check passed on the reviewed tree); no stray file left in the repository (the reviews' scratch folders were removed); `next-env.d.ts` pointed back to `.next/types` after the verification build |

## 8. Open questions blocking the next steps

IDs refer to spec 00 §10 unless a spec number is given. Questions of earlier `DELIVERY-*.md` not repeated here are still open (V-1, V-2, A-11, E-3, E-7, P-5, SC-2…SC-7, A-1, I-3, P-2, …).

| ID | Question | Blocks |
|---|---|---|
| V-3 (new) | Vigie's NCR and HSE API (payloads, progress endpoint, acknowledgement, authentication); a Vigie field for Keystone's NCR number; Vigie project ids ↔ Keystone codes; the report form's prefill parameters | HTTP quality connector; every NCR / HSE link (`links.ts`) |
| C-1, C-2, C-3 (Cursus, new) | Selecting a site / an employee in Cursus links; a reminder endpoint; matricule ↔ person and project ↔ Cursus site mapping | Cursus links, reminders, the HTTP refresh of real sites |
| Q-5, Q-6 | Which commissioning steps are editable; recording ITP results, and raising an NCR in Vigie on a failed inspection | Commissioning, ITP |
| A-6 | One punch list or two (ITP and Site) | ITP, Site |
| A-9, X-15, E-6 | P&ID revision source (rev C registered vs rev D in Codex); sheet image storage; candidate search beyond 8 parts | P&ID |
| 09 OQ11, OQ12, P-7 | Who validates a release; the "latest revision" rule; Codex approval circuit for engineering releases | Engineering |
| 07 OQ5, OQ9, OQ20 | Overdue-actions reference date; re-submitting a rejected deliverable; claim drawer, statuses and ECO link | Quality, Warranty claims |
| A-13, A-14 | Settings thresholds and risk categories feeding Project health and the risk register; company-wide vs per-user reset | Settings, Health, Risks |
| A-5 | Due dates of billing plans without invoice records; legacy monthly billing on the client Home | Client portal, Home |
| P-10 | External client access: scoping a client to their own projects, confidentiality | Client portal |
| X-6 | Mail / notification connector (SAT invitations, client notifications) | Commissioning, client portal |
| X-16, Q-8 | Wording: Documents sub-title, zone notice on machine lists; the "20 k€" suffix | Client portal, after-sales |
| A-12 | Sources for the remaining constants (client decisions logged, site premium, PDM volume, unmet demand, skills requests) | KPI tiles |
| Site (new) | Should "Individual go · Cursus" require at least one received verdict; should the HSE tile read Vigie's incidents | Site Go chantier |

## 9. For the next team

- **Routes:** `screenHref(id, { code })`; every screen is built.
  - Engineering (`src/features/eng/links.ts`): `synthesisHref`, `disciplineHref`, `importHref`. P&ID (`src/features/pid/links.ts`): `pidHref`, `pidTagHref`.
  - Quality (`src/features/quality/links.ts`): `qualityHref`, `ncrHref`, `deliverableHref`, `planActivityHref`. ITP: `itpHref(code, view)`, `itpViewOf`
    (`src/features/itpcom/model.ts`). Site (`src/features/site/links.ts`): `siteHref(code, tab, hash?)`, `qualityNcrHref`.
  - Client portal: `clientHref(code, tab)` (`src/features/rexclient/model.ts`). After-sales (`src/features/aftersales/links.ts`): `fleetHref`, `savHref(view)`, `ecoHref`.
  - Administration (`src/features/admin/links.ts`): `settingsHref`, `machineTypesHref(type?)`, `integrationsHref({ view, source })`, `auditExportHref`.
- **Integrations:**
  - Vigie: `getVigieQualityConnector()` (`quality-connector.ts`); `vigieNcrUrl`, `vigieNcrListUrl`, `vigieReportNcrUrl`, `vigieReportIncidentUrl`, `vigieHseUrl`,
    `vigieHseListUrl`, `vigieCoactivityUrl` (`links.ts`). Never write `vigie_ncrs` / `vigie_hse_items` outside `upsertNcrMirror` / `upsertHseMirror`.
  - Cursus: `getCursusConnector()` (`connector.ts`), `cursusChantierUrl`, `cursusClearancesUrl`, `cursusTravelUrl`, `CURSUS_LINK_ATTRS` (`links.ts`),
    `cursusPublicUrl`, `cursusApiUrl`, `cursusConnectorMode` (`config.ts`). `upsertClearances` is the only writer of `cursus_clearances`.
- **DAL** (`src/server/dal/`, server-only):
  - `quality.ts`: `listNcrs`, `getNcr`, `advanceNcr`, `verifyNcr`, `ncrVerificationQueue`, `criticalOpenNcrsByProject`, `listProjectNcrRefs`, `listDeliverables`,
    `getDeliverable`, `moveDeliverable`, `decideDeliverable`, `linkDeliverableDocument`, `deliverableAcceptanceQueue`, `submittedDeliverablesByProject`,
    `acceptanceTextOf`. `quality-screen.ts`: `getQualityScreen`.
  - `itp.ts`: `getItpPlan`, `listItpSystems`, `templateSystemsOf`, `addItpInspection`, `listPunchItems(code, register?)`, `addPunchItem`,
    `advancePunchItem(code, number, actor, on?, expected?)`, `openPunchAByProject`, `projectMachineTypeLabel`. `commissioning.ts`: `getCommissioning`,
    `planSat`, `commissioningBlockingRefs` (Interfaces), `listCommissioningSystems`, `listSatSystems`.
  - `site.ts`: `getSite`, `goConditions`, `siteBadgeByProject`, `advancePrerequisite`, `confirmEquipment`, `saveDailyReport`, `remindInCursus`, `syncCursus`.
  - `rex.ts`: `getRex`, `addLesson`, `advanceLesson`, `cycleClosureItem`. `client.ts`: `getClientPortal` (`contract` null only without a billing plan),
    `listClientIssues`, `raiseClientIssue`, `countOpenClientIssues`.
  - `fleet.ts`: `listMachines`, `getMachine`, `machinesByZone`, `machinesFittedWith`, `addMachine`, `listMachineOptions`. `claims.ts`: `listClaims`,
    `listInterventions`, `claimCostsByMachine`, `savNavBadge`, `openClaim`. `aftersales.ts`: `getFleetScreen`, `getSavScreen`.
  - `engineering.ts`: `getEngineeringRegister`, `engBlockingByProject`, `confirmEngInput`, `closeEngCheck`, `generateEngOutput`, `freezeEngDeliverable`,
    `proposeEngRelease`, `validateEngRelease`, `importEngList`. `eng-screen.ts`: `getEngScreen`, `engNavBadges`, `engNavBadgesByProject`, `engNavBadgesOf`.
  - `pid.ts`: `getPidValidation`, `pidCandidates`, `mapPidTag`, `pidBadgeByProject`. `pid-import.ts`: `stagePidImport`, `applyPidImport`.
  - `settings.ts`: `getSettings`, `listReferenceValues`, `referenceLists`, `getHealthThresholds`, `setHealthThresholds`, `addReferenceValue`,
    `removeReferenceValue`, `addLocation`, `removeLocation`, `resetSettings`, `activeStatusCodes`. `mtypes.ts`: `listMachineTypes`, `getMachineType`,
    `updateMachineType`, `setMachineTypePhases`, `setMachineTypeItpSystems`, `setMachineTypeCostCategories`, `removeRexReference`, `createMachineType`.
    `integrations.ts`: `listConnectors`, `syncConnector`, `addConnector`, `listImportFormats`, `getPlumbingCounts`, `plumbingNavBadge`.
    `admin-connectors.ts`: `listAdminConnectors`, `syncAdminConnector`.
  - `ops-common.ts`: `requireWorkspace`, `projectOf`, `whoIs`, `isClientContactOf`, `managesProject`, `trace` (shared by the Delivery 5 writers).
- **Server Functions:**
  - `src/features/quality/actions.ts`: `advanceNcrAction`, `verifyNcrAction`, `moveDeliverableAction`, `decideDeliverableAction`,
    `rejectDeliverableWithCommentsAction`, `linkDeliverableDocumentAction`.
  - `src/features/itpcom/actions.ts`: `addInspectionAction`, `addPunchItemAction`, `advancePunchItemAction(code, number, from)`, `planSatAction`.
  - `src/features/site/actions.ts`: `advancePrerequisiteAction`, `confirmEquipmentAction`, `remindInCursusAction(code, person)`, `syncCursusAction`, `saveDailyReportAction`.
  - `src/features/rexclient/actions.ts`: `addLessonAction`, `advanceLessonAction`, `cycleClosureAction`, `decideClientChangeAction`,
    `decideClientDeliverableAction`, `raiseClientIssueAction`, `acknowledgeSharedDocumentAction`, `downloadStatusReportAction`.
  - `src/features/aftersales/actions.ts`: `addMachineAction`, `openClaimAction` (select values are codes and machine numbers).
  - `src/features/eng/actions.ts`: `confirmInputAction`, `closeCheckAction`, `deliverableStepAction`, `generateOutputAction`, `importListAction`.
  - `src/features/pid/actions.ts`: `mapPidTagAction`, `unlinkPidTagAction`, `stagePidImportAction`, `applyPidImportAction`.
  - `src/features/admin/actions.ts`: `addSettingsEntryAction`, `removeSettingsEntryAction`, `setHealthThresholdAction`, `resetSettingsAction`,
    `updateMachineTypeAction`, `setMachineTypePhasesAction`, `setMachineTypeItpSystemsAction`, `setMachineTypeCostCategoriesAction`,
    `removeRexReferenceAction`, `createMachineTypeAction`, `syncConnectorAction`, `addConnectorAction`.
- **Reusable logic** (`src/domain/`, pure, golden-tested): `quality` (NCR and deliverable KPIs, chips, steps, approval items), `itpcom` (plan groups,
  punch step, commissioning "Blocking A", dossier completeness, form parsing), `site` (Go chantier rule, late prerequisites, KPI tiles),
  `rexclient` (REX and portal rows, `parseClientTab`), `aftersales` (warranty state, `addedWarrantyStatus`, configuration tags, zone filters),
  `engineering` (`deriveRegister`, `planImport`, `engBadges`), `pid` / `pid-import` (tag status, candidates, staging), `admin` (lists, thresholds,
  machine types, connectors, audit CSV). Keep type-only imports of `@/domain/approvals` in domain modules (a value import breaks `scripts/db-check.ts`).
- **Components / props:** `fleetView` and `savView` take an optional last argument `{ vigie: boolean }`; `NewMachineTypeButton` and
  `AddConnectorButton` take an optional `context` (current project name); `auditAreaT` (`src/features/admin/i18n.ts`).
- **Time model:** unchanged (`PG_NOW`, `NOW_ISO`, `CODEX_TODAY_ISO`, `STATUS_ISO`); only "Sync now", the outboxes and connector refreshes use the real clock.
- **Not built, by decision:** the "Expédition & transport" module and the other `docs/BACKLOG.md` proposals (P1–P8) wait for the user's validation.
