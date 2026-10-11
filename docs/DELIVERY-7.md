# Keystone PM — Delivery 7 (production readiness and the owner's answers)

Delivery 7 builds the 57 items of `docs/RESTE-A-DEVELOPPER.md` that could be built without waiting for anyone: the platform a
production start needs (PostgreSQL, production seed, configuration, logs and health, HTTP hardening, job worker, CI and end-to-end
tests), Microsoft Entra ID sign-in with real users, rights that follow the named project team, and the owner's answers on cost control,
contracts and portfolio, operations, quality and site, plus the technical debt left by the prototype (runtime reads of its data, its
constants, texts translated segment by segment, tablet use). The plan and the defaults taken are in `docs/DELIVERY-7-PLAN.md`; each lot's
detailed notes (rules, edge cases, tests, old → new values) are in `docs/delivery-7/notes-<lot>.md`.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md` … `docs/DELIVERY-6.md`.

## 1. Status at hand-over (11 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (after `npx next typegen` in a fresh clone) | clean |
| `npm run lint` | clean |
| `npm test` | 266 files, 3 313 tests, all passing (Delivery 6: 200 files, 2 786 tests) |
| `KEYSTONE_DIST_DIR=.next-ci npm run build` | succeeds; new Route Handlers `/api/health`, `/api/auth/{sign-in,callback,sign-out}`, `/api/photos`, `/api/photos/[id]`; new page `/sign-in` |
| `npm run db:generate` | "No schema changes". Sixteen migrations; Delivery 7 adds `0007` … `0015` (§3) |
| `scripts/db-check.ts` | "All checks passed" (expectations updated for R-169's CCB approver and the new Settings records) |
| Route matrix on `next start` with a fresh database | 215 routes × 8 personas × FR/EN = 3 440 requests, all 200, no "being built" or error page, nothing but the start-up lines in the server log. The client stays on the 12 routes of their workspace and is sent home (R-042) from the 203 others; `/resources/what-if` adds `?project=` as before |
| End-to-end scenarios (Playwright, `npm run test:e2e`) | 22 scenarios, all passing: the 18 of the platform lot (crawl of the 59 screens under the CSP, error pages, connectors, exports and rate limits, wizard, health threshold, forced stage changes, task files, spares order) and 4 new ones (client refusal, tablet drawer, ITP result and punch photo, contingency draw-down validated by the director); the new file was re-run on its own after a selector fix in the tablet scenario |
| Adversarial reviews | Security / permissions and correctness of the seams between lots: 12 findings, each confirmed by a test, all fixed (§1.1) |

The health-threshold scenario now uses MSR-012: with SPI computed from Keystone's data (R-073), NDC-031 is At risk at the default
threshold.

### 1.1 Fixed at integration and after the reviews

The nine lots were built in parallel on the Delivery 6 code and merged one by one. Integration made them agree with each other:

| Lots | Point | Resolution |
|---|---|---|
| auth × every lot | `users.role` → `users.roles`; `CLIENT_ORG` removed; shell and notification functions take the viewer | every merged lot's new code switched to `viewer.organisation`, `users.roles`, `toPersonIds` (client issues, risks, approvals) |
| rights × cost-control, operations, quality-site | lots written before R-041 checked "PM of record" (`isMine`, `pmPersonId`, `managesProject(…, pmPersonId)`) | PM-only actions use the project lead (`ctx.isLead`, `managesProject(q, actor, project)`: PM of record, co-PM, deputy, director): deliverable creation, client issues, machine registration, stock release |
| rights × quality-site | photo routes are Route Handlers: R-042's redirect does not suit them | the photo gate answers the client 403 (JSON or file) and keeps P-10a / P-10b |
| platform-web × quality-site, operations | new upload / export routes | same-origin check and rate limit (R-008) on the photo upload; errors through `logError` (R-009) |
| platform-data × cost-control, contract-portfolio, operations | seed backfills of the lots | one backfill block in `src/server/db/seed/index.ts`, each guarded and logged |
| contract-portfolio × debt-ux | payment terms became currency + rule + days (C-6); R-148 shows typed fields as typed | contract sheet, crumb and exports show the rule (`paymentTermsText`) and the typed fields through `dataText` |
| platform-web (R-021) × debt-ux (R-020) | R-021 kept "Add connector" (row stays "Not connected"); R-020 removed it (D-7a) | removed: connectors come from IT's connectors file; R-021's real state (live / mock / file / none / disabled) and its channel count (e-mail and Teams only when live) are kept |
| cost-control × operations | both extended `ApprovalKind` / decision modes | one union (`contingency-draw`, `codex-document`) |
| operations × cost-control | stock issues and WP actuals | WP actual = activities + stock issues by WBS code (`stockCostByWorkPackage`) |
| every lot | 9 generated migrations numbered 0007 | each lot's migration dropped and regenerated in merge order (0007 … 0014), compared with the lot's SQL (identical) |

Two adversarial reviews of the integrated branch (security and permissions; correctness of the seams between lots) each
confirmed their findings with a test before reporting. Every finding is fixed, with a test:

| Review | Finding | Fix |
|---|---|---|
| Security | Supplier prices leaked in exports as soon as an order was in another currency (amount columns were plain numbers, not removed by the R-046 mask) | price columns are marked whatever their currency and removed for the roles that may not see prices; amounts in any currency masked in PDF fields and tiles |
| Security | The client's sidebar received internal counts (NCRs, blocked invoices, site "NO GO", internal meetings) | the shell sends a client only the badges of their workspace screens; meetings count external ones; no global badge |
| Security | A production server without `KEYSTONE_AUTH` ran in demo mode silently | refused with `KEYSTONE_SEED=production`; a warning otherwise (the Mac app is a demo) |
| Security | A storekeeping role could issue, reserve or return stock for a project they are not on | reserve, issue and return need the project's team; procurement and the director stay storekeepers for every project (owner to confirm); re-checked in the DAL |
| Security | Several DAL writers trusted their single caller (document decision, budget rate, PO currency, draw-down, CR ↔ activities, stock release / override) | each writer re-checks its rule with the actor (approver of the step, director, project team on the screen; never the client) |
| Correctness | "Reset to defaults" on a production database would bring the prototype's storage locations | the stored defaults carry no location in production |
| Correctness | A non-EUR purchase order fed foreign-currency prices into the BOM valuation, the last purchase price and stock values | ordered prices converted to euros at the project's budget rate for the BOM valuation, the last purchase price and the stock unit cost (receipt values stay in the order's currency for the 3-way match) |
| Correctness | Stock issues reached the work-package actuals but not AC, CPI or EAC | valued issues and returns are AC cost events dated by movement (CPI, EAC, register, alerts, status report follow); work-package EAC includes the stock overlay |
| Correctness | A connector IT disabled in the connectors file still exchanged data | Vigie, Cursus and Codex send nothing and refresh nothing while disabled; entries stay pending |
| Correctness | The Codex outbox had no delivery claim and no redelivery job | claim across processes (migration 0015) and a `codex-outbox` job |
| Correctness | Typed names still went through the segment translator in the other lots' code (change ↔ activity lists, stock issue activities, New deliverable WBS, portfolio alerts, plan drawer, contract and status-report exports) | `dataText`; the already-localised alert texts are no longer translated twice |
| Correctness | Removed demo referents came back at every start | the backfill runs once (recorded in `app_settings`) |
| Integration | "Release" was translated « Libérer » for a guarantee and « Libération » for a stock movement (one dictionary key) | the stock operation has its own label; a test keeps delivery 7 dictionaries consistent |

## 2. How to run

Same as `DELIVERY-6.md` §2, with these changes:
- **New npm dependencies (pinned):** `pg` 8.23.0 (loaded only when `DATABASE_URL` is set); dev `@types/pg` 8.23.1 and
  `@playwright/test` 1.56.1. Sign-in uses `fetch` and WebCrypto (no OIDC library).
- **Configuration:** every variable is documented in `.env.example` and validated at start-up (`src/server/config/parse.ts`, R-007):
  an invalid value stops a production server with one log line naming the variable (never its value).
- **Database (R-002):** unset `DATABASE_URL` → PGlite in `KEYSTONE_DATA_DIR/pg`, migrated and seeded on first use as before. Set →
  PostgreSQL through a pool; `npm run db:migrate` applies migrations (and seeds an empty database, `KEYSTONE_SEED` required) at deploy
  time; the server refuses to start while a migration is pending. `./drizzle` must ship with the server.
- **Seed (R-011, A-15):** `KEYSTONE_SEED=demo` (default) is the prototype data set; `production` loads reference data only.
- **Sign-in (R-038):** `KEYSTONE_AUTH=demo` (default) keeps "View as"; `KEYSTONE_AUTH=entra` with `KEYSTONE_SESSION_SECRET` and the
  `ENTRA_*` variables requires a Microsoft Entra ID session (redirect URI `/api/auth/callback`). Roles come from the token's app roles
  (or groups mapped by `ENTRA_GROUP_ROLES`); the person from the e-mail matched to `persons`.
- **Jobs (R-006):** `npm run worker` (PostgreSQL) or `KEYSTONE_JOBS=inprocess` (PGlite) runs the outbox deliveries (Vigie, Cursus,
  Codex), the plan-trash purge and the orphan-file prune.
- **Health (R-009):** `GET /api/health` → 200 when the database answers and no migration is pending, else 503. Logs are one JSON object
  per line in production (`LOG_LEVEL`, `LOG_FORMAT`).
- **Connectors (R-020):** `KEYSTONE_CONNECTORS_FILE` names IT's JSON file (`config/connectors.example.json`; check one with
  `npx tsx scripts/connectors-check.ts <file>`); `CODEX_API_URL` switches the Codex connector to HTTP (R-124).
- **Tests:** `npm test` (Vitest), `npm run test:e2e` (Playwright on a production build, a free port, never the reserved ones). CI:
  `.github/workflows/ci.yml` runs typecheck, lint, unit tests, build and the end-to-end suite.

## 3. Data

| Migration | Lot | Tables | Columns |
|---|---|---|---|
| `0007_wet_lester.sql` | auth | — | `users`: `roles[]`, `entra_object_id` (unique), `email`, `department_id`, `last_sign_in_at`; `role` nullable (persona of a demo user) |
| `0008_powerful_giant_girl.sql` | platform-data | — | `claimed_at` on the Vigie and Cursus outboxes (one delivery per entry across processes) |
| `0009_dry_layla_miller.sql` | platform-web | `job_locks` | — |
| `0010_neat_hiroim.sql` | cost-control | `change_request_postings` | `risks.cost_keur` (EMV computed); contingency draw-down status, requester, decision |
| `0011_peaceful_millenium_guard.sql` + `0012_contract_payment_terms_backfill.sql` | contract-portfolio | — | currency on contracts, purchase orders, customer and supplier invoices; project budget rate; contract payment rule and days (backfilled from the free text); amendment milestones and "sent for signature" date |
| `0013_glossy_ultimo.sql` | operations | `change_request_activities`, `codex_document_outbox` | stock movement value, unit cost, WBS code and reservation override |
| `0014_slippery_kronos.sql` | quality-site | `deliverable_reviews` | ITP results (date, inspector, client witness, comment), Vigie NCR ↔ inspection, client issue handling, claim diagnosis and closure, intervention report and part, receipt photo file |
| `0015_funny_vision.sql` | review fix | — | `claimed_at` on the Codex outbox (one delivery per entry across processes, R-010) |

Rights (R-041) use the existing `project_members.project_role`; Settings defaults (R-170) are a document in `app_settings`; no other
schema change. A database seeded before Delivery 7 gets the migrations and the backfills (demo users and referents, risk costs, contract
terms, Settings defaults) on its next start; `npm run db:reset` (server stopped) remains the reference.

## 4. What is implemented

Each line is one item of `docs/RESTE-A-DEVELOPPER.md`; the notes file gives the rules, the files and the tests.

### Platform — `notes-platform-data.md`, `notes-platform-web.md`

| Item | What it does now |
|---|---|
| R-002 PostgreSQL | One `DB` type for PGlite and node-postgres; pool, deploy-time migrations under an advisory lock, pending-migration guard |
| R-011 production seed | Reference data only (stages, machine types, calendars, Settings lists, departments, zones); demo artefacts (numbering floors, default PM, default project) on a demo database only; empty Homes without a project |
| R-010 concurrent writes | Every transaction SERIALIZABLE with retry on serialization failure or deadlock (numbering, check-then-write); outbox claims. **Not done:** detecting that a form's data changed under it (needs a UX decision) |
| R-009 logs and health | Structured logs (`log`, `logError`), `/api/health`, start-up checks of configuration and database |
| R-007 configuration | zod-validated environment, `.env.example`, secrets masked |
| R-008 HTTP hardening | CSP with nonce, security headers, same-origin check on state-changing Route Handlers, rate limits (429) |
| R-176 error pages | In-shell error page, global error page, not-found page; browser errors reported to the server log (rate-limited) |
| R-016 CI and end-to-end | GitHub Actions workflow; Playwright suite (crawl of the 59 screens under the CSP, key scenarios) |
| R-006 job worker | `npm run worker` / in-process scheduler with `job_locks`: outbox redelivery, plan-trash purge, orphan-file prune |
| R-021 real connector state | Each connector says how Keystone is linked (live, mock, file, not connected, disabled); "Sync now" only for live and mock (simulated runs labelled); Lucca removed (NEW-CURSUS-4) |

### Sign-in and rights — `notes-auth.md`, `notes-rights.md`

| Item | What it does now |
|---|---|
| R-038 Entra ID | OIDC authorization code + PKCE, sealed session cookie, sign-in page, proxy gate, sign-out, active-role switch; demo mode unchanged |
| R-039 real users | Users with several roles, department and client organisation; notifications and per-user records keyed by the user; personal notices to the person |
| R-041 project team | Write rights follow the named team (PM of record, co-PM, deputy → PM rights; referents and members → their own items); "Project team" card on Project resources |
| R-042 client refusal (P-1, P-10a) | The client is sent home on any screen outside their workspace and on another organisation's project (pages, exports, search, notifications) |
| R-043 P-10b | The client never sees internal meetings, purchasing, NCR or internal approvals of their own project |
| R-045 P-3 | Project creation by the director and the PMs only (the department head loses the button) |
| R-046 rates and supplier prices | Hourly rates for the director and PMs only (task sheet and export included); supplier prices for the director, PMs and procurement, masked `•••` elsewhere on screens and exports |
| R-047 Codex | Deposit and new revision by the project's internal team and the director; "Sync now" by the director (NEW-D3-1) |
| R-048 department heads | A head decides only the requests of the departments they head; the director decides for all (P-8a) |
| R-049 someone else's My work | The director everybody, a head of department their people, a PM the people of the projects they lead (R-9) |
| R-050 minutes | The organiser and the project's PMs and deputies write and send the minutes; the team adds notes and ticks actions (P-9b) |
| R-061 plan structure | WBS and scheduling by the project's PMs, deputies and the director; owners enter the progress of their own activities (Plan added to the member's and procurement's workspace) (P-9a) |

### Cost control — `notes-cost-control.md`

| Item | What it does now |
|---|---|
| R-073 EVM from Keystone data | PV / EV / AC series, SPI, CPI, EAC from the activities, the baseline snapshot and the validated draw-downs at the data date (C-2a); commitments from the open PO lines |
| R-068 approved CRs | One register; an approved CR posts to the work packages' budget and, when contractual, to the contract as an amendment (A-4) |
| R-070 contingency register | The register is the "consumed" figure (A-8) |
| R-071 draw-downs | Linked to a CR, risk or NCR; validated by the portfolio director in My approvals (C-4) |
| R-072 risk cost | Cost if it occurs entered; EMV = cost × P / 5 (Q-1) |

### Contract and portfolio — `notes-contract-portfolio.md`

| Item | What it does now |
|---|---|
| R-075 currencies | Currency per contract, PO and invoice; project budget rate set by the director; amounts shown in their currency, totals in euros (C-9) |
| R-076 invoice due dates | Payment rule (net / end of month) and days per contract; due dates computed (C-6) |
| R-079 amendments | Amendment milestones billable once signed; "sent for signature" step; bond release (NEW-D3-3) |
| R-132 margin at completion | From the EAC (C-10b) |
| R-133 cash remaining | Spread on each milestone's payment date (C-10a) |
| R-129 overview population | Projects in execution; fiscal-year label (A-3) |
| R-130 portfolio alerts | Computed from rules (critical path, cost, over-allocation, approvals waiting) (NEW-D1-1) |
| R-131 status report | Client and internal versions (C-5) |

### Operations — `notes-operations.md`

| Item | What it does now |
|---|---|
| R-105 | The latest frozen or released revision is the reference (E-5) |
| R-097 | The PO PDF is an internal summary (SC-4b) |
| R-055 | A stage change carries its effective date (L-4c) |
| R-098 / R-099 | Stock issues name an activity and charge its work package; reserved stock refused to another project unless released (NEW-D4-2) |
| R-103 | BOM valued at the ordered price, else the last purchase price, else the catalogue (E-2a, A-11) |
| R-062 | Change requests linked to plan activities; approved durations applied at the next Reschedule (NEW-D2-2) |
| R-124 / R-106 | Document approvals and "Validate release" go to Codex through an outbox (P-7b, D-1b, P-7c) |

### Quality and site — `notes-quality-site.md`

| Item | What it does now |
|---|---|
| R-120 | The site Go needs at least one Cursus verdict (NEW-SITE-1) |
| R-112 | ITP results recorded (passed, with reservations, failed); a failure is reported in Vigie with a prefilled link (Q-6a, Q-6b) |
| R-114 / R-115 | A rejected deliverable restarts at the next revision; "New deliverable" for the project's PMs (Q-3a, Q-3b) |
| R-137 | Client issues taken in charge, answered and closed by the PM; the client is notified (L-6) |
| R-143 / R-144 | Warranty claims followed end to end (diagnosis, interventions, closure); machines and their as-built configuration registered at delivery (Q-8, E-8) |
| R-126 | Photos stored by Keystone on receipts, daily reports and punch items (X-15, SC-4a) |

### Technical debt and tablet — `notes-debt-ux.md`

| Item | What it does now |
|---|---|
| R-170 | No page, DAL reader or Server Function reads the prototype JSON (seed, X3 mock and tests only) |
| R-169 | Prototype constants replaced by data or Settings (site premium, award rule, where-used part, PO terms, CCB approver, channels, form dates) |
| R-148 | Texts people typed are shown as typed (exact dictionary entry of the demo data, else the text): `src/i18n/data-text.ts` |
| R-020 | Connectors configured by IT in a JSON file; Configure read-only; no "Add connector" (D-7a) |
| R-146 | Tablet layout up to 1024 px: drawer menu, scrolling tables, 40 px touch targets (X-4) |

## 5. Product-owner decisions applied

I-1a (both database paths), I-2a / I-2b (Entra ID, no client access at launch), A-15 (production seed), P-1, P-2, P-3, P-9a, P-9b, P-10a,
P-10b, P-13, NEW-D2-1, NEW-D3-1, P-8a, R-9 (rights), A-4, A-8, C-4, Q-1, C-2a (cost control), C-9, C-6, NEW-D3-3, C-10a, C-10b, A-3,
NEW-D1-1, C-5 (contract and portfolio), E-5, SC-4b, L-4c, SC-5a, NEW-D4-2, E-2a, A-11, NEW-D2-2, P-7b, P-7c, D-1b (operations),
NEW-SITE-1, Q-6a, Q-6b, Q-3a, Q-3b, L-6, Q-8, E-8, X-15, SC-4a (quality and site), D-7a, NEW-CURSUS-4, X-4, X-6, X-12b, NEW-D1-2 (platform
and debt). The defaults taken where an answer left a point open are listed in each notes file ("Defaults chosen").

## 6. Not done, and why

- **Waiting for the owner or another system** (`DELIVERY-7-PLAN.md` §3): S-4 data date and Friday freeze, NEW-SYS-1 project codes, the
  real Vigie / Cursus / Codex / Sage X3 / PDM APIs, hosting (I-1a), the mail relay, the machine-type standards, the RACI matrix.
- **R-010:** concurrent edits of one record are not detected (§8).
- **R-016:** the 3 520-request route matrix is run by hand, not in CI (§8).
- **R-146:** no phone layout (X-4); no sticky first column on the Gantt and plan grids.
- Not built, by decision: "Expédition & transport", the Cursus timesheet link and the `docs/BACKLOG.md` proposals P1–P8.

## 7. Deliberate deviations and displayed values that change

Each lot's notes list the old → new values on the seed, and every golden test that changed cites the decision. The main ones:

| Area | Before | Now | Decision |
|---|---|---|---|
| HLT-026 orders placed / EVM | prototype constants | computed from the activities, the baseline and the open PO lines | C-2a, A-12 |
| HLT-026 milestones and billing | re-priced on base + amendments | base milestones on the base amount; amendment 1 has its own milestone M6 | NEW-D3-3 |
| Overview KPIs and "Needs attention" | 4 fixed alerts, all projects | projects in execution; computed alerts | A-3, NEW-D1-1 |
| Margins, cash flow | prototype margins, uniform spread | margin at completion, spread on payment dates | C-10a, C-10b |
| Connectors | 9 seeded statuses, "Add connector" | real link per connector, Lucca gone, no "Add connector" | A-15, D-7a, NEW-CURSUS-4 |
| French screens | segment translation of typed text ("dim. Valley Farm") | typed text as typed, or its exact demo entry | X-12b, NEW-D1-2 |
| Client persona | read-only on every screen | sent home outside the workspace and on other organisations' projects | P-1, P-10a |
| Non-team members | edit any project their role allows | read-only on projects they are not on the team of | P-2 |

## 8. Open questions

Grouped from the lots' notes (each notes file has the detail and the default built).

| Lot | Question |
|---|---|
| auth | Who can sign in first in production (the people come from the Cursus import, R-027, or a first list)? E-mail domain of the demo personas; default role order; 12 h session and no "sign out everywhere"; matching rule for B2B guests when clients are opened |
| rights | Procurement and the director as storekeepers who reserve, issue and return stock for any project (others: the project's team); deputies' workspace; director and minutes; Plan for members and procurement; CR PM step routing to every PM; Codex "administrator" role; department heads off their teams; refusal message for the client; task sheet restriction; demo referents; place of the Project team card |
| platform-data | Reference data of a production start (warehouses, machine-type standards); draft PO numbering (Q-7 / R-014); stale-form detection (R-010); external alerts on connector failure; Vigie authentication (V-3); imports' default PM |
| platform-web | Rate-limit values; HSTS scope; camera permission; IT notification of incidents; mock "Sync now"; job intervals and retry limit; a bundled worker for a slim image; route matrix in CI |
| cost-control | PO-1052 list prices (orders placed €3.95M on HLT-026); selling price of a contractual CR; CRs on projects without a contract; internal CRs shown to the client; auto-validation of the director's own draw-down; category actuals until R-074; working-day spread; CRs on the WBS root; forecast consumption; dropping `risks.emv_keur`; weekly snapshot from `getProjectEvm` |
| contract-portfolio | Alert thresholds in Settings; fiscal year = calendar year?; who sets the budget rate, dated rates; supplier invoice currency from X3; withdrawing an amendment sent for signature; R-077 blocking share check; EVM in other currencies; live EAC vs snapshot EAC in the status report |
| operations | Director override of a reservation; returns without an activity; Codex mock acceptance; director deciding for an approver without account; Freeze / Propose release through the outbox; Codex endpoints (D-1); CR-008 → A1250 link on existing databases; automatic stage advance date |
| quality-site | Vigie `/signaler` parameters and echo (V-3, V-1); PM recording results, punch items from reservations; automatic restart after rejection; place of client issues and reopening; after-sales manager role, chargeable claims; machine registration trigger and per-machine BOM, warranty start; thumbnails (`sharp`), HEIC, client seeing site photos |
| debt-ux | PDM run date (A-12); wizard default PM; `DEFAULT_PROJECT` fallback; job titles as vocabulary; CCB next meeting; PO terms default; demo note "New"; sticky first column on tablets |

Questions of earlier `DELIVERY-*.md` not repeated here are still open (V-1…V-3, C-1…C-3, S-4, D-1…).

## 9. For the next team

- **Remaining work:** `docs/RESTE-A-DEVELOPPER.md` (generated from `docs/reste-a-developper.json` by `npm run remaining:page`) shows
  what Delivery 7 closed and what is left; keep it current after each development.
- **Viewer and rights:** `getViewer()` (`src/server/session.ts`) returns the signed-in user or the demo persona; project rights come from
  `getProjectContext` / `getProjectScope` / `projectAccessResolver` (`src/server/project-context.ts`) over `projectAccess`
  (`src/domain/rights.ts`). Use `ctx.isLead` for PM rights, `ctx.isMine` for team membership, `refuseClient()` for the client.
- **Data access:** `managesProject(q, actor, project)` and `leadsProject` (`src/server/dal/ops-common.ts`, `project-team.ts`);
  transactions may run more than once (R-010): never accumulate into outer variables inside a callback.
- **Typed text:** show it with `dataText` / `projectLabelText` / `fieldsText` (`src/i18n/data-text.ts`), Keystone's vocabulary with `t()`.
- **Route Handlers:** `isSameOriginRequest`, `hitRateLimit`, `tooManyRequestsResponse` (`src/server/http/request-guard.ts`); errors with
  `logError` (`src/server/log.ts`).
- **Connectors:** state rules in `src/domain/connectors.ts`; IT's file in `src/server/integrations/connectors-file.ts`; outboxes delivered
  by the jobs in `src/server/jobs/`.
