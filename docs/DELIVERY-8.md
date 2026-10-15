# Keystone PM — Delivery 8 (the items buildable after delivery 7)

Delivery 8 builds the items of `docs/RESTE-A-DEVELOPPER.md` that could be built after delivery 7 without waiting for the product
owner or another system. A triage workflow (11–12 Oct 2026) examined the 103 remaining items not "à décider": 90 came out buildable
or partly buildable, 13 blocked; the plan kept 67 items in nine parallel lots and excluded the rest (`docs/DELIVERY-8-PLAN.md` §4).
The plan, the 76 defaults taken where an answer left a point open, and the integration rules are in `docs/DELIVERY-8-PLAN.md`; each
lot's brief is in `docs/delivery-8/lot-briefs.md` and its notes (rules, edge cases, tests, old → new values, open questions) in
`docs/delivery-8/notes-<lot>.md`.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md` … `docs/DELIVERY-7.md`.

## 1. Status at hand-over (15 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (after `npx next typegen` in a fresh clone) | clean |
| `npm run lint` | clean |
| `npm test` | @@TESTS@@ (Delivery 7: 266 files, 3 313 tests) |
| `KEYSTONE_DIST_DIR=.next-ci npm run build` | succeeds; new Route Handler `POST /api/integrations/cursus/events` (R-029); no new page |
| `npm run db:generate` | "No schema changes". 33 migrations; Delivery 8 adds `0016` … `0032` (§3) |
| `scripts/db-check.ts` (`npx tsx --conditions=react-server`) | "All checks passed" (new blocks: audit trail append-only, dated rate grid, two leave types, sourcing task P-8b, delivery-8 table counts) |
| Route matrix on `next start` with a fresh database | @@MATRIX@@ |
| End-to-end scenarios (Playwright, `npm run test:e2e`) | @@E2E@@ |
| Adversarial reviews | Two rounds, each finding confirmed by an independent verifier with a reproduction: lots 1–8 (security and rights, data and migrations, seams between lots, rules against the decisions) — 17 confirmed findings, 15 distinct; lot 9 and the first round's fixes — 9 confirmed. All fixed with a regression test (§1.1) |

### 1.1 Fixed at integration and after the reviews

The nine lots were built in parallel (lots 1–8 on the plan base `e41c309`, lot 9 on the integration of lots 1–7) and merged one by one
in the plan's order; every lot's migrations were dropped and regenerated in merge order (custom SQL re-created with identical
content, each regenerated file compared with the lot's). Integration made the lots agree with each other:

| Lots | Point | Resolution |
|---|---|---|
| audit-i18n-shell × every lot | `audit_entries` is append-only (trigger) and its project FK is NO ACTION; the French completeness guard and the one-translation-per-key dictionaries test | a backup test now builds its older snapshot from migrations only; the Finance backfill test detaches the seeded audit row as R-168's data migrations do; « Transfert » and « Échéance de l’action » followed in the cash-flow and NCR tests; French rules for the dated rate grid's texts (R-083); "Qualification" and "Cursus" on the reviewed same-in-French list; "Warranty cost YTD" listed as a deliberate override (NEW-D5-2) |
| roles-rates-hr × cost-change, supply-engineering, connectors, work-planning, site-quality | the 9th persona (Finance, R-044) and P-4 (procurement loses the Contract) | the persona tests of the later lots list Finance; the milestone tests follow P-4 (Finance edits the contract, procurement no longer does) |
| roles-rates-hr × cost-change | both add a Settings threshold next to the health rules | both kept: hours variance (R-088) and change control board (R-069), in the seeds, the stored defaults, Reset and the export (`app_settings` 6 rows) |
| platform-ops × connectors × docs-client-portfolio | new scheduled jobs | first runs staggered (backup 25 s, rescan 30 s, Cursus directory 35 s, events purge 40 s, Codex index 45 s); the runbook lists every job; the compose file and the runbook list `CURSUS_EVENTS_KEY` and `CURSUS_DIRECTORY` |
| platform-ops × connectors | production configuration warnings | the connectors' configuration tests set the antivirus mode explicitly (R-175) |
| supply-engineering × docs-client-portfolio | the DAL reached the screen registry from `scripts/db-check.ts` (purchasing → orders, prioritisation), whose icon import fails under `tsx` | the registry has no icon any more (`src/config/screen-icons.ts`, read by the sidebar); a guard test keeps it so |
| docs-client-portfolio | a constant exported from a `'use server'` file broke `next build` | moved to `src/features/docs/i18n.ts`; `src/server/use-server-exports.test.ts` refuses any such export |
| work-planning × db-check | P-8b: an approved request for a contract role becomes a "Find and name" task for procurement | the RQ-043 check expects the sourcing task |
| cost-change × e2e | the client now approves last (P-6b) and is sent home from the Plan | the BL3 scenario opens the Plan as the PM |

Review findings, all fixed with a regression test (notes: "Integration review fixes" in each lot's notes):

| Finding | Fix |
|---|---|
| Internal meeting minutes (released, type MIN, confidentiality internal) were shared with the client: portal Documents, R-138 categories, client vault, register export, download hand-off, acknowledgement (P-10b; the rule predates delivery 8) | a record is shared with the client only when its type is a client deliverable, it is released **and** its confidentiality is Client — one rule for every path |
| Contract milestone Edit / Remove: the DAL re-check used the team rule (Finance off the team refused, a 'pm'-role plain member accepted) | the DAL applies P-4 like the screen (`editsContract`: director and Finance on every project, else a lead whose workspace has the Contract) |
| Rate-grid edits wrote their €/h values in the activity feed, which every internal role reads and exports (R-046) | values only in the audit row; Activity & integrations and its export mask the rate audit rows and older events for roles without `canSeeRates` |
| Codex index read: a record skipped for an unknown project or type was never read again; a first fix (holding the read mark) made every read re-apply Codex's state over Keystone-local transitions and close undelivered outbox decisions | the mark always moves; skipped records wait in `codex_index_awaiting` and are re-read alone, applied only if not indexed yet, once their project / type exists |
| Index read of a new revision with an unchanged Released status: the previous revision never withdrawn, no audit | the revision change is audited and the previous revision withdrawn |
| Antivirus rescan: status update and audit row in two statements | one transaction per file (row locked) |
| Site sheet: a contractor crew typed with an internal person's name escaped the department head's arbitration and the leave / other-site checks; "Add a rotation" offered people off the team; conflict keys carried Cursus's whole note; stale "Confirm" clicks could land on another line; a cancelled project's rotation kept a conflict open | a known person's name is refused as a crew; the forms offer the team only (a line keeps its own person); keys hash the note; steps carry the row stamp; rotations of closed or cancelled projects are ignored |
| Notices and texts: sourcing-task notice kept an English date in French; the director fallback of a sourcing task was not announced; CR drawer highlighted at a fixed 50 k€; the first live Vigie refresh would announce closed NCRs; stale texts (Cursus row "no personal data", client-visibility comment, runbook jobs) | fixed: French date, notice to the director, the Settings board threshold, only open NCRs announced, texts corrected |
| Persona loops written for 8 roles; dead code left by one lot after another replaced it (`laborCost`, `openingCodexProjectText`) | loops over `PERSONAS` (9); dead code removed |

## 2. How to run

Same as `DELIVERY-7.md` §2, with these changes:
- **Deployment kit (R-003):** `Dockerfile` (non-root user) and `deploy/compose.yaml` (PostgreSQL, a one-shot migration, the app, the worker,
  clamd and their volumes)
  for Coolify; runbook in French: `docs/EXPLOITATION.md`; security policy: `docs/SECURITY.md`; dependency watch:
  `.github/dependabot.yml`, `.github/workflows/audit.yml`.
- **Backups (R-004):** `KEYSTONE_BACKUP_DIR` turns on the `backup` job (snapshot every `KEYSTONE_BACKUP_EVERY_MIN` = 10 min, retention
  `KEYSTONE_BACKUP_RETENTION` = 48 h / 30 days / 12 months, files stored once by content); `npm run backup` and `npm run restore` (refuses to overwrite a live database; reports pending
  migrations of an older snapshot).
- **Antivirus (R-175):** `KEYSTONE_FILE_SCAN=clamav` with `CLAMAV_HOST`/`CLAMAV_PORT` or `CLAMAV_SOCKET`: every upload is scanned before
  it is stored (422 infected, 503 scanner down — fail-closed), a daily `files-rescan` job re-checks stored files (410 for a blocked file).
  Required explicitly with `KEYSTONE_SEED=production`; `off` explicitly otherwise.
- **Cursus (R-027, R-029, R-031):** `POST /api/integrations/cursus/events` takes Cursus's events (absences, verdicts, hours) with the key
  `CURSUS_EVENTS_KEY` (separate from `CURSUS_API_KEY`; production refuses the demo key; without a key the endpoint answers 503 and Cursus
  retries); `CURSUS_DIRECTORY=on` imports the staff directory daily once Cursus exposes it.
- **Codex (R-033):** with `CODEX_API_URL`, the `codex-index` job reads Codex's index every hour.
- **Entra ID:** the app role `finance` / `Keystone.Finance` (R-044).
- **Jobs:** `backup`, `files-rescan`, `cursus-directory`, `cursus-events-purge`, `codex-index` join the delivery-7 jobs (`npm run worker`
  or `KEYSTONE_JOBS=inprocess`).
- **Scripts:** `scripts/db-check.ts` runs again under `tsx` (`npx tsx --conditions=react-server scripts/db-check.ts`).

## 3. Data

| Migration | Lot | Tables | Columns / content |
|---|---|---|---|
| `0016_low_shen.sql` + `0017_audit_append_only.sql` | audit-i18n-shell | — | audit user, before / after, reason, message key; activity message key; audit project FK NO ACTION. Custom: backfill of the audit user, then triggers refusing UPDATE / DELETE / TRUNCATE (SQLSTATE 23001) |
| `0018_tranquil_chat.sql` | platform-ops | — | scan status, date and signature of stored files |
| `0019_sparkling_toxin.sql` + `0020_rate_versions_backfill.sql` + `0021_striped_bruce_banner.sql` | roles-rates-hr | `rate_role_rates`, `rate_multiplier_rates` | `persons.rate_role_id`; custom backfill of the first versions and the persons' grid role; then `job_title_rates` and the undated rate columns dropped |
| `0022_clever_wolf_cub.sql` | cost-change | — | contractual impact and cost category of a change request |
| `0023_mute_archangel.sql` | supply-engineering | — | PO cancellation (reason, by, at); part validation (validated at / by, export reviewed, HS not applicable) |
| `0024_curious_lady_deathstrike.sql` + `0025_leave_types_simple.sql` | connectors | `cursus_events` | persons' matricule, directory team and sync date; leave source default; custom: two leave types (Leave, Absence), absences mapped, the others removed |
| `0026_faulty_zuras.sql` | docs-client-portfolio | — (drops `document_downloads`, `client_document_categories`) | `document_index_syncs.source` |
| `0027_exotic_chimera.sql` | work-planning | — | `meeting_lines.activity_id` |
| `0028_punch_unified_renumber.sql` + `0029_bent_psylocke.sql` + `0030_itp_plan_systems_backfill.sql` | site-quality | `itp_plan_systems`, `site_conflict_arbitrations` | custom: site punch items renumbered after the ITP ones (HLT-026: P-01…P-03 → P-06…P-08) before the unique key moves to (project, number); custom backfill of every plan's frozen ITP systems |
| `0031_curved_annihilus.sql`, `0032_past_cammi.sql` | review fixes | `codex_index_awaiting` | `document_index_syncs.next_since` |

The custom migrations must stay in this order (each lot's notes say why). A database seeded before Delivery 8 gets the migrations and
the backfills (Finance user, production rate multipliers, change-request impacts of the demo) on its next start; audit rows can no
longer be updated or deleted (a data migration that must rewrite them disables the trigger as the table owner inside one transaction,
`notes-audit-i18n-shell.md` §1). `npm run db:reset` (server stopped) remains the reference.

## 4. What is implemented

Each line is one item of `docs/RESTE-A-DEVELOPPER.md`; the notes file gives the rules, the files and the tests. "Partly" means the
buildable part is done and the rest waits for the owner or another system (the remaining-work page says what).

### Audit trail, French and shell — `notes-audit-i18n-shell.md`

| Item | What it does now |
|---|---|
| R-168 (partly) | Audit rows carry the user, before / after, the reason; append-only (trigger); ISO 9001 CSV with User, Reason, Before, After. Writers other than sign-in and `trace` fill before / after later; REVOKE waits for the hosting (I-1a) |
| R-184 | French completeness guard over every `t()` literal, one translation per key, keyed system messages; activity feed and audit trail in the viewer's language |
| R-052 | Global search over the whole portfolio (X-5), current project first; the client finds the change requests of their own projects |
| R-151 | A collapsed section keeps its group header (X-8) |
| R-167 | Day offsets correct before the start date |
| R-156 | The Handover step reads « Transfert » in French (NEW-D5-3) |

### Platform — `notes-platform-ops.md`

| Item | What it does now |
|---|---|
| R-003 (partly) | Container kit for Coolify (Dockerfile, compose with PostgreSQL, worker and clamd); the beta host waits for I-1a |
| R-004 (partly) | Scheduled snapshots with retention and a checked restore; off-site copies and PITR wait for the hosting |
| R-174 (partly) | Security policy, Dependabot and dependency audit in CI; the penetration test waits for the host |
| R-175 | Antivirus on uploads and on stored files (fail-closed, quarantine, release) |
| R-177 (partly) | French runbook, role guides (`docs/guide/`) and beta acceptance scenarios; support contact and training plan are placeholders |

### Roles, rates and HR — `notes-roles-rates-hr.md`

| Item | What it does now |
|---|---|
| R-044 (partly) | Finance role and persona (Léa Marchand): contract on every project (P-4), read-only Budget, Hours and Billing, rates, margins; issuing invoices stays the PMs' and the director's |
| R-139 (partly) | "View as client" for the director and the project's leads, with a preview banner on the portal (P-11 a) |
| R-083 (partly) | Dated rate grid (roles and multipliers by effective date) and one valuation of hours by the person's grid role (A-10); the production source of a person's grid role is open |
| R-178 (partly) | Production multipliers as placeholders and the reference-data sheet `docs/referentiels-a-fournir.md`; EPC2i's real values awaited |
| R-086 | Labour cost to date by zone on Resources (R-2 a) |
| R-087 | One 1–5 skills scale and two indicators: no expert, single expert (R-5a, R-5b) |
| R-088 | Hours-variance threshold in Settings (10 %, inclusive, symmetric, distinct over / under looks) (R-6b) |

### Change control and cost — `notes-cost-change.md`

| Item | What it does now |
|---|---|
| R-069 | Sequential change-request chain: PM, portfolio director, client when the contractual impact needs it, change control board above the Settings threshold (50 k€) (P-6b, P-6c) |
| R-015 (part) | Change-request notices (X-6a); other notices by the connectors and work-planning lots |
| R-081 | Cost-category amounts frozen after BL1; the category is posted at approval (C-3a, A-4) |
| R-077 | Invoicing blocked while a milestone group exceeds 100 %; planned milestones edited and removed (C-7, C-7a) |
| R-080 | Budget KPI colours on the Settings thresholds; signed variance bars (C-1) |
| R-054 | « Planning BL1 posé » ticked by the real BL1 (L-2) |
| R-140 | The justification in the drawer and on the client portal (X-11) |

### Purchasing and engineering — `notes-supply-engineering.md`

| Item | What it does now |
|---|---|
| R-095 (partly) | Cancel a purchase order not yet placed, with a reason (SC-3a, P-5c); placed orders wait for the arbitration |
| R-034 (partly) | Sage X3 actions say they are simulated on a demo database and are refused in production; the real connector waits for the X3 extracts |
| R-102 | Part validation by the engineering lead or the director; export restriction confirmed explicitly (E-1a, E-1b) |
| R-104 | Substitutions priced between revisions (E-2b): +€19,942 per crane |
| R-108 / R-109 | P&ID: the whole catalogue searched for a tag's part; revision gap with Codex flagged, re-import offered (E-6, A-9) |
| R-110 / R-111 | Installed-base pins only for fitted parts (E-4); possible duplicate EQ-CRN-250T / ASM-RMG-250 flagged (NEW-D4-5) |
| R-145 | Warranty cost of the calendar year; extension in force counted (NEW-D5-2) |
| R-155 / R-153 | Zone notice of the machine lists (X-16); no project sub-line on fleet-wide forms (X-10) |

### Vigie and Cursus connectors — `notes-connectors.md`

| Item | What it does now |
|---|---|
| R-023 / R-024 / R-025 (partly) | Keystone side of the Vigie connector (mirror pruning, contract `docs/integrations/vigie-contract.md`, project-filtered links); Vigie's API and ECO module wait for Vigie |
| R-096 | Rejected receipt: prefilled Vigie supplier NCR and buyer notice (NEW-D4-3, SC-3b) |
| R-015 (part) | Receipt, invoice and dormant Vigie notices |
| R-027 (partly) | Staff directory import (matricule ↔ person), dormant until Cursus exposes it (NEW-CURSUS-2) |
| R-029 | Events endpoint for Cursus (key, idempotence, retention job) (NEW-CURSUS-7); contract `docs/integrations/cursus-contract.md` |
| R-031 (partly) | Absences received from Cursus in two types, Leave and Absence; "Sync Lucca" removed (NEW-CURSUS-4) |
| R-173 (partly) | GDPR: no absence reason kept, AI processing reminder, minimised request decisions; the register and retention durations wait for the owner |

### Documents, client portal and portfolio — `notes-docs-client-portfolio.md`

| Item | What it does now |
|---|---|
| R-033 (partly) | Codex connector, Keystone side: links, real state, hourly index read with records waiting for Keystone data; Codex's API (D-1), deposit form (R-125) and files wait |
| R-127 | The history stays in Codex: record, current revision, current circuit; Keystone's download log removed (D-2) |
| R-128 | Deliverable, order and punch-item relations clickable (the punch rows have anchors since R-117) |
| R-138 | Client document categories computed from the Codex index (L-9); two categories wait for the owner |
| R-134 / R-135 / R-136 | Proposal scored on the 5 ranking axes (L-5a); projects map with stage colours, legend and keyboard markers (L-7); portfolio schedule on a sliding 24-month window (L-8) |

### Work, meetings and plan — `notes-work-planning.md`

| Item | What it does now |
|---|---|
| R-149 / R-150 | @mentions in task comments with notices (R-8b); board drag-and-drop (R-8c) |
| R-015 (part) | Task-assigned and meeting-task notices |
| R-067 | Meeting follow-up tasks with the typed due date (S-12) |
| R-037 (partly) | Truthful Outlook / Teams labels and read receipts in Keystone (S-11, X-6b); the Outlook sync waits for IT (Graph) |
| R-089 (partly) | A contract-role request becomes a "Find and name" task for procurement (P-8b); creating a new person waits for R-027 |
| R-090 / R-152 / R-116 | Re-request a withdrawn request (P-8c); missing confirmation toasts (X-9, L-1); an interface's received date (Q-4) |
| R-064 (partly) / R-172 (partly) | Plan trash positions after a restore (S-5 values to confirm); owner names on the Plan (the P&ID import stays off, D-7b) |

### Quality and site — `notes-site-quality.md`

| Item | What it does now |
|---|---|
| R-117 | One punch list per project (inspection and site origins), numbered across the project (A-6) |
| R-057 | ITP systems frozen in the plan at its creation (E-9) |
| R-118 | The project's leads prepare and fill the site sheet from Études (D-3); Cursus site creation (R-028) and typed actuals (R-074) are not built |
| R-119 | Site-team conflicts computed from the rotation plan, the pool load, Cursus clearances and absences; arbitrated by the department head (D-6b) |
| R-122 | Daily report without the HSE incident box; a prefilled Vigie link instead (NEW-SITE-2) |
| R-032 (partly) | Cursus employee link from the Site (NEW-CURSUS-3); the route is a proposal to agree with Cursus |

## 5. Product-owner decisions applied

X-5, X-8, NEW-D5-3, NEW-D1-2, X-12b (audit, French, shell); I-1a interim choices of the kit (platform); P-4, P-11 a, P-12 c, C-9, A-10,
R-2 a, R-4a, R-4b, R-5a, R-5b, R-6b (roles and rates); P-6b, P-6c, X-6a, C-3a, A-4, C-7, C-7a, C-1, L-2, X-11 (change control and cost);
SC-3a, P-5c, A-15, E-1a, E-1b, E-2b, E-6, A-9, E-4, NEW-D4-5, NEW-D5-2, X-16, X-10 (purchasing and engineering); V-2, V-3a, V-3b,
NEW-D4-1, NEW-VIGIE-1, NEW-D4-3, SC-3b, NEW-CURSUS-2, NEW-CURSUS-4, NEW-CURSUS-7, R-1 (connectors); I-3a, D-1a, D-2, L-9, L-5a, L-7, L-8
(documents and portfolio); P-8c, X-9, L-1, Q-4, S-5, R-8b, R-8c, S-12, S-11, X-6b, I-3c, P-8b (work and plan); A-6, E-9, D-3, D-6b,
NEW-SITE-2, NEW-CURSUS-3 (quality and site). The defaults taken where an answer left a point open are in `DELIVERY-8-PLAN.md` §2 and
each notes file.

## 6. Not done, and why

- **Excluded from this delivery** (`DELIVERY-8-PLAN.md` §4): R-094 (purchasing procedure), R-074 (actual costs from Cursus hours and
  Sage X3), R-082 (Sage analytics), R-125 (Codex deposit form), R-107 (engineering imports, D-7b), R-022 (project codes, NEW-SYS-1),
  R-026 (supplier grades), R-035 (PDM), R-060 (data date, S-4), R-005 (object store), R-012 (schedule takeover), R-019 (Mac app),
  R-058 (RACI), R-001 (merge into `main`: owner's approval), R-013 (real clock — its own lot after this delivery), R-085, R-084, R-014,
  R-093, R-030, R-180 (Cursus timesheet link, not validated).
- **Partly built items** (§4): what is left waits for the hosting (I-1a), Vigie, Cursus, Codex, Sage X3, IT (Microsoft Graph) or an
  owner's answer; each item's note on the remaining-work page says which.
- Not built, by decision: "Expédition & transport", the Cursus timesheet link and the `docs/BACKLOG.md` proposals P1–P8.

## 7. Deliberate deviations and displayed values that change

Each lot's notes list the old → new values on the seed, and every golden test that changed cites the decision. The main ones:

| Area | Before | Now | Decision |
|---|---|---|---|
| Change requests | parallel chain; director and board on CR-008 at once | sequential chain; CR-008 reaches the client after the director; no board step at or below 50 k€ | P-6b, P-6c |
| Client portal HLT-026 › Awaiting your decision | 3 | 2 (CR-008 after the director) | P-6b |
| Personas | 8 | 9 (Finance, Léa Marchand); procurement loses the Contract | R-044, P-4 |
| Rate cards, task cost notes | one rate per role, job-title rates on tasks | dated grid; tasks valued by the person's grid role (T-2314: 95 → 60 €/h) | A-10, R-083 |
| Hours tones | over and under flagged at different rules | symmetric 10 % threshold, inclusive, distinct looks | R-6b |
| Skills tiles | single-expert count only | "Skills without an expert" and "Single-expert skills" | R-5b |
| Revision comparison B → C | +€19,180 per crane | +€19,942 (substitutions priced) | E-2b |
| Global search | current project only | the whole portfolio, current project first, project code on each hit | X-5 |
| French | « Livraison » for the Handover step; English activity feed | « Transfert »; feed and audit trail in French | NEW-D5-3, NEW-D1-2 |
| ISO audit CSV | 6 columns | 10 (User, Reason, Before, After) | R-168 |
| HLT-026 punch list | ITP P-01…P-05 and site P-01…P-03 apart | one list: site items renumbered P-06…P-08 | A-6 |
| Site conflicts | 4 seeded collisions | 8 computed conflicts | D-6b |
| Leave types | CP, RTT, sick leave, training… | Leave, Absence (no reason kept) | NEW-CURSUS-4 |
| Client documents | typed categories, download log in Keystone | categories computed from Codex; the log stays in Codex | L-9, D-2 |

## 8. Open questions

Grouped from the lots' notes (each notes file has the detail and the default built).

| Lot | Question |
|---|---|
| audit-i18n-shell | REVOKE / table owner on the hosting; GDPR purge of audit rows; French of the demo's typed names; « MT » for total float; 3 search hits per kind; client sees every CR of their projects |
| platform-ops | PR #1 vs the Compose kit; image size; who signs in first on a production base; backup interval, retention, off-site copy, PITR; update deadlines and Dependabot; antivirus fail-closed and purge; support, training, beta calendar |
| roles-rates-hr | Finance on every project or its teams; Finance and invoices; budget rate; Finance's Home; who sets a person's grid role in production; backdated rate changes; real coefficients; a crew role; labour cost population; symmetric Variance KPI; "Raise issue" in the client preview |
| cost-change | Real board threshold; "None (internal)" chosen by the client; dates-only amendments; PM step routing; client step without client accounts; CRs without a category; block per group; TCPI alert; frozen-amount import rows |
| supply-engineering | Who cancels someone else's draft; the director as part validator; revision banner after release; "Extended" label; zone texts; Sage X3 extracts |
| connectors | Progress on records Vigie no longer lists; who is "l'acheteur"; notice recipients; Cursus directory endpoint and matching; event envelope and hosting reachability; absence fields and cancellation; who sees whose absences, retention, DPAs; `heures.validees` waits for the timesheet link |
| docs-client-portfolio | Deposits refused when Codex is connected (until R-125); Codex endpoints (D-1) and project key (NEW-SYS-1); how a client gets a file; dropping the demo download log; demo PO relations; two client categories; scoring labels; grey map marker; schedule window bounds |
| work-planning | "@" suggestion list and who can be mentioned; follow-up owners outside the pool and due years; read receipts until Microsoft 365; which buyer gets the sourcing task, its title language; re-request dates; correcting a received date; S-5 values |
| site-quality | Stage window and rights of the site sheet; NO GO badge from J-30; progress on site (`done_days`); sheet defaults; contractor arbitration and `site_collisions`; 110 % load threshold; renumbered site items; client sees site-origin items; Cursus and Vigie routes |
| integration | While a Codex record waits for a project or type that never comes, it stays in `codex_index_awaiting` (re-read only when its project / type exists): should IT see that list? A changed Cursus travel label reopens a certificate arbitration (Cursus keeps only the joined note in the mirror) |

Questions of earlier `DELIVERY-*.md` not repeated here are still open (V-1…V-3, S-4, D-1, …).

## 9. For the next team

- **Remaining work:** `docs/RESTE-A-DEVELOPPER.md` (generated from `docs/reste-a-developper.json` by `npm run remaining:page`) shows
  what Delivery 8 closed and what is left; keep it current after each development. Next, by the plan: R-013 (real clock) as its own lot,
  then the items waiting for the owner (`docs/DECISIONS.md` § "À traiter en priorité").
- **Audit:** never update or delete `audit_entries` rows (trigger); to date a test row, insert it with `writeAudit({ occurredAt })`.
  New system messages go in `src/domain/system-messages.ts`; readers render them in the viewer's language.
- **French:** every new `t()` literal needs a French entry that differs, a FR rule, or a reviewed place on
  `src/i18n/same-in-french.json` (`src/i18n/completeness.test.ts`); a deliberate override of a prototype key is listed in
  `src/i18n/extra/dictionaries.test.ts`.
- **Personas:** nine (Finance included); persona tests loop over `PERSONAS`.
- **Server code and scripts:** import the role rules from `src/config/role-screens.ts` and keep `src/config/screens.ts` free of client
  components (`screen-icons.ts` holds the icons); a `'use server'` file exports async functions only (guard test).
- **Client sharing:** a document is shared with the client only when it is a client deliverable, released and of Client confidentiality
  (`sharedWithClient`, `src/server/dal/documents.ts`).
- **Integration of parallel lots:** drop each lot's migrations and regenerate them in merge order (custom SQL identical, compared);
  run the full suite with `--testTimeout=60000` on a loaded machine; build, db-check, route matrix and end-to-end tests before pushing.
