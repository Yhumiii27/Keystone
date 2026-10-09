# Keystone PM — Delivery 6 (chapter 4)

Delivery 6 is chapter 4 of the rebuild: **every function of the 59 screens that was simulated, or only said "coming soon", is now real
whenever Keystone can do it with its own data**. It also applies the product owner's answers of 9 Oct 2026 (`docs/DECISIONS.md`,
the "chapter-5 questionnaire") wherever they change chapter-4 behaviour (§5). Only external-system placeholders remain, each naming
its system (§6). The plan, acceptance criteria and audit this delivery closes are in `docs/DELIVERY-6-PLAN.md`; the detailed
working notes of each part (rules, edge cases, tests) are in `docs/delivery-6/notes-*.md`.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md` … `docs/DELIVERY-5.md`.

## 1. Status at hand-over (9 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (after `npx next typegen` in a fresh clone) | clean |
| `npm run lint` | clean (run it with `--ignore-pattern '.claude/**'` when agent worktrees exist under `.claude/worktrees`) |
| `npm test` | STATUS_TESTS |
| `KEYSTONE_DIST_DIR=.next-ci npm run build` | succeeds (Next 16.4 / Turbopack), all routes dynamic; new Route Handlers `/api/export/[screen]`, `/api/import`, `/api/interchange/mspdi/[code]`, `/api/meetings/[number]/transcript`, `/api/tasks/…` |
| `npm run db:generate` | "No schema changes". Seven migrations; chapter 4 adds `0005_sloppy_talos.sql` and `0006_square_lilith.sql` (§3) |
| `scripts/db-check.ts` | "All checks passed", including the new "Chapter 4 writes" block |
| Route matrix on `next start` with a fresh DB | 220 routes × 8 personas × FR/EN = 3 520 requests, all 200, no "being built" or error page, nothing but the start-up lines in the server log |
| End-to-end scenarios (Playwright, `next start`) | 14 scenarios of the plan (§5 step 2), all passing, no page error, console error or 5xx (below) |
| Adversarial reviews | Security / permissions and correctness (CPM, calendars, KPIs, what-if, trash, baselines, seeded displays): every headline value recomputed by hand matches; the findings and their fixes are in §1.1 |

**End-to-end scenarios** (Playwright 1.56 with the preinstalled Chromium on the production server above, plus `fetch` for the routes):
Reschedule HLT-026 twice (second run "no change"); Set baseline → change request "New baseline BL3" → chain approved → BL3 current with 21
activities (and CR-009 → BL2); relationship added, cycle and duplicate refused; work package 1.7 removed → Undo → plan CSV identical, then
A1520 removed → "Recently deleted" → Restore; what-if scenario → "2 draft requests created", second Select "already exist", plan unchanged,
redirect without `?project=`; FR transcript → local analysis → "Ajouter au CR"; CSV / XLSX for 12 screens, the 8 PDF reports and the
PO, goods receipt, plan, Gantt, client planning, status report, spares and minutes PDFs, the member export without rates; wizard EEP-045
(EMP, Le Havre / France: Next disabled without a location) opening on its plan; "At risk below" 0.99 → NDC-031 At risk on Projects,
Overview and the CSV, then restored; two forced stage changes, one approved, one rejected (reverted); task attachment up / down
(byte-identical; PM 403, `.exe` 415); spares POs PO-1100 / PO-1101 (Draft); imports hidden, Configure read-only, `POST /api/import` 403;
Site "Client communication log" → Meetings › Decisions › With the client (EN and FR).

### 1.1 Fixed after the reviews and the end-to-end run

| Source | Finding | Fix |
|---|---|---|
| Security | P&ID import pasted a workbook relationship id into a RegExp (a crafted 1 KB file could block the server for minutes) | the id is compared as a string |
| Security | Upload routes only checked `Content-Length`; a chunked 60 MB body was buffered before the 413 | `readFormDataCapped` reads the body with a byte cap (`src/server/storage/files.ts`) |
| Security | A client could export another organisation's task, and internal cost data outside their workspace (budget, plan, MS Project XML) | P-1 applied to exports: a client gets 403 outside their workspace and on the MS Project XML export; the header Export button is hidden there; the task export filters by organisation |
| Security | A PM could change the lifecycle stage of a project they do not manage | `moveStageAction` / `setDeliverableAction` require the project's PM or the director; the register hides the controls on other rows |
| Security | The Plan drawer let any Plan editor tick someone else's task | the assignee, the director or the project's PM only (as My work) |
| Security | Audit CSV cells starting with `= + - @` were written raw | neutralised with a leading quote |
| Security | A client's change request could propose a baseline | `proposeBaseline` honoured only for the project's PM or the director |
| Correctness | Undo could fail for good when two removed to-dos were renumbered onto the same number | the renumbering skips the numbers the other restored to-dos keep |
| Correctness | An imported remaining duration kept overriding later % complete / duration edits in the CPM | a new % or duration clears it |
| Correctness | Schedule Re-baseline naming a closed change request while snapshots are free left the baseline proposed for ever | only an open request that proposes no baseline is linked |
| Correctness | What-if "protect the budget" took a +€40 lever shown as "0.0 k€"; relief hours were wrong for more than one added unit | unrounded cost; helper share × added units |
| Correctness | Tests would call Vigie / Cursus if their API URLs were exported in the shell | Vitest starts with them (and `ANTHROPIC_API_KEY`) empty |
| End-to-end | Draft resource requests (what-if) could be neither sent nor discarded; they read "Sent Fri 25 Sep · Awaiting …" and counted as sent | Send / Discard row actions (requester, project PM or director), "Draft" tag, "Not sent", excluded from "Requests sent"; exports show Draft with no sent date |
| End-to-end | The change-request drawer always read "Requires re-baseline → BL2" | the baseline the request proposes (BL3…) |
| End-to-end | Export cards said "Drop a file or click to choose" | "Click to choose what to export" |

**Route matrix** (server `next start` on 127.0.0.1:3310 from `.next-ci`, fresh `KEYSTONE_DATA_DIR`; ports 3000, 3100, 3110, 3200, 3210,
3217 and 5173 untouched). Cookies `ks-role` × `ks-lang`; redirects followed; a response is good when it is 200, is not the "being built"
page and carries no error page. Routes: `/`, every global screen of `src/config/screens.ts`, every project screen for HLT-026, NDC-031,
EWA-051, RCF-019, WSA-044 and ERP-202, plus the chapter-4 deep links `/projects/{HLT-026, NDC-031, ERP-202}/client?tab=planning`,
`/projects/HLT-026/meetings?view=decisions` (and `&decisions=client`), `/resources/what-if` (with and without `?project=`),
`/projects/HLT-026/changes?new=1&baseline=1`, `/admin/integrations?view=imports|connectors`, `/portfolio/projects?new=1`.

## 2. How to run

Same as `DELIVERY-1.md` §2, with these changes:
- **New npm dependencies (pinned):** `@anthropic-ai/sdk` 0.128.0, `zod` 4.6.5, `exceljs` 4.4.0, `pdfkit` 0.20.2, `fast-xml-parser` 5.11.1;
  dev `@types/pdfkit`. `next.config.ts` lists the server-only ones in `serverExternalPackages`.
- **Fresh clone:** `npm ci`, then `npx next typegen` before `npm run typecheck` (it generates `LayoutProps` / `PageProps`; `next-env.d.ts`
  is gitignored).
- **Database:** migrations `0005` and `0006` (§3). A fresh `./.data` is seeded completely (calendars, BL1 activity snapshots so every
  display is unchanged, assignment quantities). A database seeded before chapter 4 gets the migrations and the backfill on the next start.
  `npm run db:reset` (server stopped) remains the reference.
- **Meeting analysis by Claude (opt-in):** only when `ANTHROPIC_API_KEY` is set (server only). The transcript is then sent to Anthropic;
  the UI says « Analyse par Claude (Anthropic) » and explains that the data leaves Keystone. Without the key a local rule-based analyser
  runs and nothing leaves Keystone. `KEYSTONE_AI_MODEL` overrides the model (default `claude-opus-5-5`); `KEYSTONE_AI_FALLBACKS=off`
  disables the server-side fallback. Tests mock the SDK (no network).
- **Codex:** `NEXT_PUBLIC_CODEX_URL` (default `http://localhost:3100`) is the Codex web app the "Download zip" toast links to.
- **Files:** uploads (task attachments, meeting transcripts, import files) are stored under the data directory by
  `src/server/storage/files.ts` (20 MB, type allowlist, content sniffing).

## 3. Data

### Newly modelled

| Migration | Tables | Columns |
|---|---|---|
| `0005_sloppy_talos.sql` | `calendars`, `calendar_exceptions`, `baseline_activities`, `schedule_runs`, `whatif_scenario_actions`, `client_communications`, `import_jobs`, `import_job_rows`, `stored_files`, `export_log` | `projects` data date, displayed baseline, planned start / finish; activity calendar, remaining days, early / late dates, free float, scheduled at, external UID; assignment hours, units, h/d, department, external UID; driving links; WBS dates; baseline source, comment, data date, author, approver, scope; resource request scenario; task attachment file, mime, size; task origin; what-if scenario author, result, computed / applied; transcript file, language, analyser and model, notice, importer; proposal status, speaker, quote, reviewer, applied reference; connector enabled, config, configured at / by; stage-transition decision comment and reverted transition |
| `0006_square_lilith.sql` | `plan_trash` (removed work packages / activities, restorable for 30 days) | — |

### Writes that persist (new in chapter 4)

Every write validates its raw input and checks the viewer server-side (role, project ownership, read-only, outside-workspace and client
rules), writes through a DAL writer, records `audit_entries` / `activity_events` and revalidates the affected screens.
- **Plan / Schedule:** Reschedule (CPM at the data date), Set baseline (up to BL1), baseline proposal through a change request, Baseline
  chip, project calendar and per-activity override, relationships (add / remove, no self link, duplicate or cycle), to-dos, removal with
  Undo / Restore, Re-baseline against an open change request.
- **Change control:** approval fills and makes current the proposed baseline (activity snapshot on the project data date).
- **What-if:** scenarios (create, rename, delete, select), levers, Select scenario → DRAFT resource requests, suggestion Apply, Auto-level.
- **Meetings:** transcript import (paste or file), analysis (local or Claude), proposal review and "Add to minutes / tasks / risks".
- **Exports:** every screen (CSV / Excel / PDF), logged in `export_log`.
- **Settings:** list entries driving the modules, thresholds, budget categories; machine types; New project wizard (template, PM, site).
- **Misc:** task attachments, My work to-dos and checklists, spares purchase order (DRAFT), My approvals decisions on resource requests
  and forced stage changes.

### Still not modelled / kept

- `client_communications` (COM-nnn) and its DAL are kept but no longer reachable from the UI (D-5, §5); deleting them waits for the owner.
- Imports (MSPDI, XER, Excel/CSV) are built and tested but switched off (D-7b, §5).
- Calendar exceptions have a DAL writer but no editor; they only arrive through imports.
- `projects.data_date` has no writer: every reader falls back to the status date (S-4 open, §8).

## 4. What is implemented

### Planning — Plan `/projects/[code]/plan` and Schedule `/projects/[code]/schedule` (S-1, S-2, S-3, S-5, S-8, A-7)

- **CPM engine** (`src/domain/cpm.ts`): forward / backward pass, FS/SS/FF/SF with lags (negative included), constraints SNET, SNLT, FNET,
  FNLT, MSO, MFO, progress at the data date with retained logic, total and free float, critical = TF ≤ 0, driving predecessors, cycle
  detection. **Calendars** (`src/domain/calendar.ts`): Standard 5d · 8h, Atelier 5d · 8h, Chantier 6d · 10h (Mon–Sat), Continu 24h / 7d;
  French public holidays (Easter-based included) plus the Settings holidays.
- **Reschedule** (PM of the project or director; manual, like F9 in P6): runs the CPM at the data date, persists dates, floats, critical
  flags and constraint violations, toasts the new finish and the number of changed activities. A second run changes nothing.
- **Baselines** (S-3 = a, L-2 = a; `src/domain/baseline-policy.ts`): "Set baseline" snapshots freely only up to BL1 (set at APD) and the
  snapshot is current at once. From then on the button links to the change-request form ("New baseline · change request", pre-filled
  "New baseline BL3"); the request creates an empty proposed BLn. **Approving the request** fills the baseline's activity snapshot (if
  empty), makes it current and dates it on the project data date. Schedule "Re-baseline" after BL1 requires an open change request.
  Both rules are enforced server-side.
- **Baseline chip** switches the displayed baseline (variance columns, Gantt baseline bars). **Calendar chip** sets the project calendar;
  the activity drawer offers a per-activity override.
- **Relationships** in the drawer (type, lag; no self link, duplicate or cycle — the cycle is named) and link removal; **to-dos** in the
  drawer, shown in My work.
- **Removal and Undo** (S-5): the confirmation stays. Removing a work package or an activity moves it, with its activities, links,
  assignments, Plan to-dos and Schedule bar, into `plan_trash` in one transaction; references from other modules are cleared and
  remembered. The toast offers **Undo** (8 s); the Plan shows **Recently deleted** (5 newest) with Restore. Restore puts every row back
  with its original id (refused if the code was reused or the parent package is gone). Entries older than 30 days, or beyond 20 per
  project, are purged at the project's next removal. Tasks managed in My work or with logged hours are only unlinked and re-linked.
  Removal and restore are limited to the project's PM and the director (see §7).
- **Schedule** bars and milestones are WBS roll-ups (A-7); critical path from the floats; baseline bars from the displayed baseline.

#### Reschedule of HLT-026 against the prototype (data date Fri 25 Sep 2026)

Pinned in `src/server/dal/reschedule.test.ts`. Rules behind the differences: remaining work is dated on the Standard 5d · 8h calendar with
French public holidays (S-2) from the data date; "BL finish" stays BL1; variances and floats are in **working** days (S-8; the prototype
mixed calendar days); critical = total float ≤ 0 (S-1); driving predecessors come from the engine. Before the first Reschedule the seed is
the prototype (manual recalculation).

| Value | Prototype | After Reschedule |
|---|---|---|
| Forecast finish | 14 Jan 2027 | **18 Jan 2027** |
| Critical path float | −27 days | **−19 working days** |
| Critical packages | 4 of 8 | **3 of 8** (6 critical activities) |
| Activities changed | — | 11 (A1250, A1260, A1320, A1330, A1410, A1420, A1430, A1510, A1520, A1610, A1620) |
| A1250 | var −39, TF −27 | finish 09 Oct, var −29, TF −19 |
| A1320 / A1330 | TF +20 | TF +1 (A1330 finish 23 Nov: 11 Nov off) |
| A1410 | finish 23 Oct, TF +28 | finish 20 Oct, TF +61 |
| A1420 | finish 04 Dec, TF +10 | finish 07 Dec, TF −9 → **now critical** |
| A1430 | finish 18 Dec | finish 21 Dec |
| A1510 / A1520 | finish 16 Oct / 04 Dec | 20 Oct / 07 Dec |
| A1610 | 21 Dec → 04 Jan | 22 Dec → 06 Jan ’27 (25 Dec off) |
| A1620 (FNLT 18 Dec) | 05 → 14 Jan | 07 → 18 Jan ’27, **constraint missed by 19 d** |
| Completed activities | variances in calendar days (−7, −14) | the same slips in working days (−5, −10, −4 when 14 Jul is off) |
| Schedule slips | — | Steel structure +30d, Crane installation +35d, MEP systems +21d, Commissioning & handover +19d |
| Milestones | — | Structure topped out 6 Nov (+30d), Cranes operational 23 Nov (+35d), Systems energised 21 Dec (+21d), Handover 18 Jan ’27 (+19d): Late |

### What-if levelling — `/resources/what-if` (S-7, R-3, A-12)

Pure logic in `src/domain/whatif.ts`, formatting in `src/features/resources/whatif-model.ts`, DB in `src/server/dal/resources.ts`.

- **Levers** come from the data (one row each, shared by every scenario card of the project):
  - **Overtime** — a critical activity (TF ≤ 0) with labour assignments: the driving assignment goes to 10 h/d (or +2 h), never above 12 h/d,
    only when it shortens the remaining duration.
  - **Extra resource** — +1 unit on a critical activity's driving assignment (a crew gets one more unit; a named person gets the least-loaded
    colleague of a non-overloaded department who stays ≤ 100 %, else a contractor at the external rate). Also as relief on the
    assignment of an overloaded person or department.
  - **Shift** — a not-started, non-critical activity with TF ≥ 1 d whose assignee is above 100 % while it runs: SNET later by
    min(float, 5) working days.
- **`WHATIF_RULES`:** normal 8 h/d; overtime 10 h/d (+2 h step, max 12); +1 unit; shift ≤ 5 working days; owner without assignment 2 h/d;
  40 h week; overloaded > 100 %; helper ≤ 100 %; overtime factor 1.25 without an "ot" rate; default rate €60/h; external premium ×1.4.
- **Duration model:** remaining R' = ⌈R × (u·h) / (u'·h')⌉ on the driving assignment; CPM rerun on an in-memory copy of the network at the
  data date (the plan is never written). **Load model:** units × h/d over the remaining span; deltas per week ÷ 40 h; "Load change (h)" =
  Σ hour deltas over the horizon. **Cost model:** remaining labour at the rate card (overtime premium above 8 h/d).
- **Auto-level:** protect the date → levers that gain days; protect the budget → levers that cost nothing; protect people → relief without
  putting anyone else above 100 %.
- **`LEGACY_LEVERS`:** seeded scenarios A/B keep the prototype's lever codes until edited (overtime → overtime; contractor → external
  extra resources; move → internal colleagues; delay → shifts; split → none).
- **Draft requests:** "Select scenario → create requests" and a suggestion's "Apply" create **DRAFT** resource requests through the
  requests DAL, in one transaction with the "applied" stamp (no duplicates on a double-click; a failure rolls back both); shifts create no
  request (the toast asks to enter them in the plan). The plan changes only at the next Reschedule. Drafts are sent (or discarded, with
  a confirmation) from Resource requests by the requester, the project's PM or the director; until then they read "Draft · Not sent",
  are invisible to the department and do not count in "Requests sent".
- **Basis:** "Current plan" or "Selected scenario (copy its levers)". The inert "Baseline BL1" basis and the Horizon field were removed
  (the pool has 8 weeks of load data, shorter than every horizon option). A "Load change (h)" result row was added (cards, comparison,
  export).
- **Project:** without `?project=` the page redirects to the viewer's current project; the header shows the project switcher.

### Meeting transcripts — `/projects/[code]/meetings` (S-10)

- Paste text or upload `.txt` / `.vtt` / `.srt` (stored); VTT voice tags give speakers; SRT, plain text and Teams copy handled; language
  detected. The uploaded file can be downloaded again (`GET /api/meetings/<MTG>/transcript`, same access as the screen). A paste is limited
  by its UTF-8 size, with "The transcript is too long".
- Analyser: local rule-based (default, FR + EN cues, deterministic) or Claude when `ANTHROPIC_API_KEY` is set (structured output, server-side
  fallback, refusal / max_tokens handled, typed errors fall back to local with a notice). The model actually served is recorded.
- Proposals (decisions, actions with owner and due date, risks, client questions) are reviewed by a person; nothing reaches the minutes,
  tasks or risks without a click. A risk is created and its proposal marked added in one transaction.
- Meetings › Decisions has scope chips **All / With the client** (`?decisions=client`, D-5).

### Exports — every screen (X-3 = view_all, S-9a)

- The header **Export** menu offers CSV / Excel (+ PDF when the screen has a report) on all 59 screens; each has a registered provider
  (`src/server/export/providers/`) that exports the main tables with the current filters, tab, zone and search, labels in the viewer's
  language, real numbers and dates in Excel, CSV with BOM and `;` + decimal comma in French. Rights as on screen: rates masked for the roles
  that cannot see them; a client exports only their organisation's projects (a foreign `?code=` on a global screen falls back to one of
  their own projects) and nothing outside their workspace (P-1: 403, and no Export button there). Every export is logged.
- **Header PDF reports (8 screens):** budget (cost report), billing (account statement), meetings (minutes), risks (register), trends (status
  report), client (status report), **plan (detailed plan, landscape)** and **schedule (Gantt drawn in the PDF: baseline vs forecast bars,
  progress, critical path, data-date line, milestones)**.
- **Document PDFs:** purchase order, goods receipt, account statement, status report, deliverable acceptance PV, P&ID overlay list, BOM
  spares list, minutes, client **planning** (Gantt). Docs "Export register (xlsx)"; Administration export cards (MS Project XML, Excel, PDF).
- Sober branded PDFs (Keystone, project, date, page x/y), French by default.

### Client portal planning — `/projects/[code]/client?tab=planning` (S-9a)

A read-only **Schedule** tab (« Planning ») after "Progress & milestones": the Schedule screen's Gantt (work packages, baseline vs forecast,
milestones), forecast and baseline finish, the milestone list and "Download PDF" (the same Gantt). Work-package owners and the SPI / float
tiles are left out. Clients have no access at launch (I-2b = c); internal people preview the client view (P-11).

### Settings, wizard and health (A-13, A-14, A-2, L-3)

- **One health rule** everywhere (Overview, Projects, My projects, portfolio, Home): min(CPI clamped [0.70, 1.25], SPI) against the Settings
  thresholds. CPI / SPI colours and the SPI / CPI attention items now also follow the Settings "At risk below" threshold (default 0.97: no
  seeded value changes).
- **Settings lists drive the modules:** risk categories, cost categories, statuses, skills, holidays (calendars), deliverable types. In-use
  values are deactivated, not deleted; director-only editing; audited; duplicates refused (a second holiday on an already-listed date too);
  "Off track below" < "At risk below".
- **Budget** "Add category" / "Edit category" are real.
- **New project wizard:** machine type → the template is instantiated on creation (work packages, activities, FS links, cost categories,
  ITP plan); PM chosen from people; calendar and currency stored; **required: name, client, PM, type, planned start and site (city +
  country from `countries`)** (L-3b). The site becomes a `project_sites` row whose zone comes from the country; coordinates are copied from
  a known site of the same city and country, else left empty. The planned finish is optional and comes from the plan (30 working days per
  template activity until the owner's standard per machine type arrives). The created project opens on its plan.
- **Machine types** edit / remove gated server-side (P-14).

### KPIs computed from the data (A-12)

Every former prototype constant listed in the plan is a pure formula in `src/domain/kpis.ts` (formula comment, unit tests), fed by
`src/server/dal/kpis.ts` at the data date. Old → new values on the seed (data date Fri 25 Sep 2026):

| Screen · tile | Prototype | Now | Rule |
|---|---|---|---|
| Portfolio finance · Portfolio margin | 18 % | **8 %** | Σ (contract − EAC) / Σ contract of active client projects |
| Cash flow · Lowest cumulative point | −€490k Nov | **−€521k Oct** | billing plan in, cost forecast out, from the data date |
| Prioritisation · capacity gap (Westfield) | 1 560 h | **151 h** | pool allocations × 40 h, demand per €1M of active portfolio |
| Sourcing · Savings vs list | €12k | **€0k** | (list − awarded) × qty of RFQs awarded in the quarter |
| Sourcing · Average cycle | 9 d | **—** on the seed (RFQs created or sent in Keystone count) | mean sent → award |
| Deliveries · On-time deliveries | 83 % | **100 %** | receipts by the PO expected date, last 90 days |
| Resource requests · Average response (heads) | 1.4 d | **1.0 d** | working days sent → decision |
| Approvals (Engineering) · Average response | 0.9 d | **—** | nothing decided yet in Engineering |
| Site · Man-days planned | 168 | **179** | Σ rotation crew × working days |
| Site · Client decisions logged | 3 | **2** | decisions of the project's meetings with the client (D-5) |
| ECO · Released this month | 2 · €10,360 | **1 · €9,400** | released ECOs of the data date's month |
| Team · Interfaces due within 30 days | 2 | **1** | open interfaces needed within 30 days |
| My work / member Home · Logged this week | 14.0 h | **7.0 h** | time entries of the week |
| Activity & integrations · Events today | 6 | **5** | events of the data date (Paris day) |
| Drawings · Last vault sync (sub-line) | SolidWorks PDM · today · read-only | **SolidWorks PDM · 26 Sep · read-only** | day of the latest run vs the data date |
| Resources and department-head Home · Unmet demand | 240 h | **280 h** · Mostly engineering | Σ max(0, demand − capacity) per department |
| Resources and department-head Home · Over-allocated sub | Peak weeks 41–43 | **Peak weeks 42–44** | ISO weeks with someone > 110 % |
| Skills · Open requests needing level ≥ 4 | 2 · Structural · Quality | **3 · Structural · Procurement · Quality / QA-QC** | pending requests naming a person whose top skill is ≥ 4 |
| Unchanged (now computed) | | 0 incident (Vigie HSE), 2 rotations, 1 248 drawings in vault, last sync 07:40, NCR "N closed this quarter", client "CR to approve", My approvals "Oldest", obsolete revisions withdrawn, member Home "Next week 28 Sep – 2 Oct" and "of 40 h" | |

This table replaces the "constants kept" entries of `DELIVERY-5.md` §6 ("Unmet demand 240 h", "Client decisions logged 3", the "1 248
drawings" volume).

### Interchange — `/admin/integrations` (D-7a, D-7b)

- MS Project XML (MSPDI) and Primavera P6 XER importers, Excel / CSV imports of budget lines, BOM, parts catalogue and resource assignments
  (column mapping, preview, explicit confirmation, transactional write) are **built and tested but switched off** (`IMPORTS_ENABLED =
  false` in `src/domain/ch4-defaults.ts`): the import cards are hidden, `POST /api/import` answers 403 and every import step refuses.
- "Export — MS Project XML" of a project with its displayed baseline stays (exporting is not importing).
- The connector "Configure" dialog is **read-only** (IT configures connectors outside Keystone); its save action refuses. A disabled
  connector shows "Disabled" and "Sync now" refuses it on every path.

### Misc

- Task sheet **Attach**: real attachments (upload, list, download, delete; 20 MB, allowlist, sniffing).
- My work to-dos and checklists are real; Plan drawer to-dos appear in My work.
- BOM **Create spares purchase order**: DRAFT PO from the selected spare lines, preferred supplier, link to it.
- My approvals: no "coming soon" left; resource requests decided inline; forced stage changes approved (kept) or rejected (reverted to the
  previous stage), audited and notified (L-1).
- Site "Client communication log" opens Meetings › Decisions › With the client (D-5).
- The toast accepts an optional link (`{ href, label }`) and an optional action (`{ action: { label, onClick } }`, used by Undo).

## 5. Product-owner decisions applied

| Id | Answer | Applied |
|---|---|---|
| S-1, S-2, S-8, A-7 | confirmed | CPM engine with manual Reschedule; 4 calendars and French holidays; working days; Schedule rolled up from the WBS |
| S-3 | successive baselines; a new baseline goes through a change request | free up to BL1, then through a change request; approval fills the snapshot (§4) |
| S-5 | confirmation **and** undo | trash table, Undo toast, Recently deleted, 30-day purge |
| S-7, R-3 | confirmed | scenarios saved; Apply / Select create draft requests |
| S-9a | clients see the plan in the portal; plan and Gantt PDF are enough for now | plan and schedule PDF reports; client portal Schedule tab with its PDF |
| S-10 | confirmed | transcripts, local or Claude analysis, human review |
| A-12, A-13, A-14 | confirmed | KPI formulas; one health rule with Settings thresholds (colours included); Settings lists drive the modules |
| L-1 | confirmed | forced stage change approved or reverted by the portfolio director |
| L-3b | name, client, PM, type, start **and location** required | wizard site (city + country), planned finish from the plan |
| D-5 | use the project's meetings and decisions | dedicated client log retired from the UI (data kept); button → Meetings › Decisions › With the client; tile counts those decisions |
| D-7a | connectors configured by IT outside the app | Configure read-only |
| D-7b | do nothing about imports for now | imports off behind `IMPORTS_ENABLED` (code and tests kept) |
| X-3 | view_all | Export on every screen as described |

Answers for later deliveries (Finance role P-4 / P-12, Cursus hours NEW-CURSUS-5/6 and C-2b, Sage extracts I-3b, project codes NEW-SYS-1,
NIM codes S-6, RACI grid S-13b, A-2 / L-3a standards per machine type, S-9b one-time import): see `docs/DECISIONS.md` § "À traiter en
priorité".

## 6. Remaining placeholders (external systems only)

`grep -rn "coming soon" src` finds only the SolidWorks PDM placeholder; every other external placeholder names its system:
- **SolidWorks PDM:** "Open in PDM — coming soon" (Drawings, P&ID), vault sync (simulated run, previous count copied).
- **Codex:** "Download zip" (toast naming Codex with an "Open Codex" link to the Codex home; per-document deep links are D-1), Open / Edit
  in Codex.
- **Sage X3:** push of supplier invoices / X3 references.
- **The remote side of each connector** (Vigie, Cursus, Lucca, Outlook…): mocks until the real APIs exist (V-3, C-1…C-3).
- **Mail:** SAT invitations and client notifications send nothing (X-6).

### Minor points left as they are

- The New project wizard's template descriptions are the prototype's French texts, also in English.
- On a new wizard project the plan export's Owner column shows the owner code ("SP") until the team has owner names.
- A forced stage move in the Projects register shows no success toast (errors are toasted).
- "Set baseline" (free up to BL1) re-checks the rule outside the snapshot transaction: two simultaneous submits on a project at BL0 could
  create BL2 without a change request (the button is disabled while pending).
- Expired trash entries (and their attachment files) are purged only at the project's next removal.
- The local transcript analyser misses second-person French actions ("Julien, tu vas envoyer…").

## 7. Deliberate deviations and behaviour changes

Delivery 1–5 deviations still apply. New in chapter 4:

| Area | Before | Now |
|---|---|---|
| Plan "Set baseline" | always available, proposed BLn that never became current | free (and current) up to BL1; then a link to a change request (S-3) |
| Change-request approval | proposed baseline made current without activities (chip disabled) | snapshot filled, dated on the project data date |
| Plan removal rights | any plan editor (engineering lead, quality…) | the project's PM and the director only — the people who can undo it (S-5) |
| Displayed values | prototype constants | the A-12 table (§4) and the HLT-026 Reschedule table (only after a Reschedule) |
| What-if form | Basis (current / baseline / last approved) and Horizon, both inert | Basis current plan / copy the selected scenario; Horizon removed |
| Site client log | dedicated drawer (COM-nnn) | Meetings › Decisions › With the client (D-5) |
| Imports, Configure | working import cards, editable connector settings | hidden / read-only (D-7a, D-7b) |
| Wizard | name and client required, finish required (30 Sep 2027) | + PM, type, start and site required; finish optional, from the plan (L-3b) |
| Client portal | no planning view | Schedule tab with Gantt and PDF (S-9a) |
| Client exports (P-1) | any screen the client could open read-only | only the client's workspace screens (Home, My approvals, client portal, Trends, Change control, Quality); MS Project XML refused |
| Projects register | any PM could move any project's stage | the project's PM or the director (another PM's project is read-only, 01 §5.2) |
| Resource requests | — | drafts from the what-if: Send / Discard |

## 8. Open questions

| Id | Question | Blocks |
|---|---|---|
| S-4 | What moves the per-project data date (Friday job, PM action, Reschedule) and what the Friday freeze records | a `projects.data_date` writer |
| S-3 | Should a rejected baseline proposal be removed or shown as rejected? Should Schedule "Re-baseline" become the same link as Plan after BL1? | baselines |
| L-2 | Should setting BL1 tick the stage deliverable "Planning BL1 posé"? | lifecycle |
| S-5 | Purge horizon (30 days, 20 entries) and whether only the PM and director may remove plan rows | Plan |
| D-5 | Delete `client_communications` and its data? Is a "client decision" any external meeting (a supplier review would count) or does a meeting need a "client present" flag? | Site, Meetings |
| L-3b | Geocoding source for new sites (else missing from the world map); per-phase durations from the machine-type standard (A-2 / L-3a) | wizard, world map |
| S-7 | Should Select skip a lever already requested from a suggestion or another scenario? Formal approval of a scenario? Baseline-based scenarios, horizon beyond 8 weeks? | what-if |
| A-12 | The seeded PDM run is dated 26 Sep, after the data date (the sub-line reads "26 Sep" instead of "today"): fix the seed? Supplier quotes have no writer in Keystone | Drawings, Sourcing |
| S-9a | Portal tab name and position; should clients see the detailed activity plan; should the PDF Gantt extend to the forecast finish instead of the screen's 13 months; an internal plan PDF with costs? | client portal, exports |
| D-1 | Codex deep link for a document selection (zip) | Docs |
| D-7b / S-9b | When imports come back: schedule imports only, or the Excel / CSV table imports too? | interchange |
| P-1 | P-1 is applied to exports only; the client can still open outside-workspace screens read-only (I-2b: no client access at launch). Apply it to the screens before opening client access | client access |
| A-12 | Prioritisation's capacity gap (151 h) counts the 8 resource-pool people × 40 h, while Resources and what-if use `department_capacities` (e.g. Engineering 320 h vs 960 h over the same 8 weeks): which source is the capacity? | Prioritisation, Resources |
| S-3 | Approving an older request after a newer one makes its baseline current (CR-009 / BL2 after CR-011 / BL3): latest approval wins, or keep the highest BLn? | baselines |
| S-7 | Drafts: should a PM's Resource requests list include drafts others made on their projects? Should the person who sends a draft become the requester? Procurement can draft (Resources "Apply") but not send — acceptable? A "Drafts" filter? | Resource requests |

Questions of earlier `DELIVERY-*.md` not repeated here are still open (V-1…V-3, C-1…C-3, A-6, Q-5, Q-6, X-6, X-15, P-10…).

## 9. For the next team

- **Defaults:** every chapter-4 rule a questionnaire answer may change is in `src/domain/ch4-defaults.ts` (re-exporting the health, settings
  and template defaults). `IMPORTS_ENABLED` and `CONNECTOR_SETTINGS_BY_IT` live there; the trash limits are in `src/server/dal/plan-trash.ts`.
- **Planning:** `rescheduleProject`, `showProjectBaseline` (`src/server/dal/schedule.ts`); `createBaselineSnapshot`, `snapshotIntoBaseline`,
  `createProposedBaseline` (`baselines.ts`); `canSnapshotFreely` (`src/domain/baseline-policy.ts`); `trashPlanRow`, `restorePlanTrash`,
  `listPlanTrash` (`plan-trash.ts`); `loadScheduleNetwork`, `recordScheduleRun` (`schedule-network.ts`); calendars in `calendars.ts`.
- **What-if:** `getWhatIf`, `applyScenario`, `applyLever` (`src/server/dal/resources.ts`); `createResourceRequest(input, by, tx?)`.
- **Exports:** register a provider with `registerExportProvider` (`src/server/export/registry.ts`); `currentProjectCode` and `projectFilter`
  (`providers/scope.ts`) apply the client rules; `PDF_REPORT_SCREENS` (`src/features/exports/catalog.ts`) must match the providers.
- **Files:** `storeFile`, `streamStoredFile`, `fileResponse`, `deleteStoredFile` (`src/server/storage/files.ts`).
- **Meetings:** analysers in `src/server/ai/transcripts/`; config in `src/server/ai/config.ts`.
- **Toast:** `showToast(message, { href, label })` for a link, `{ action: { label, onClick }, durationMs }` for an action.
- **Interchange:** `src/server/interchange/` (MSPDI, XER, tables, jobs). Turn `IMPORTS_ENABLED` on to bring imports back; tests enable it with
  `vi.mock`.
- **Not built, by decision:** "Expédition & transport", the Cursus timesheet link (C-2b removes hour entry in Keystone at that point) and
  the `docs/BACKLOG.md` proposals P1–P8 wait for the owner's validation.
