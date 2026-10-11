# Delivery 7 — lot platform-web: HTTP hardening, error pages, CI and end-to-end tests, job worker, real connector state

Working notes for `docs/DELIVERY-7.md`. Items: R-008, R-176, R-016, R-006, R-021 (`docs/RESTE-A-DEVELOPPER.md`). Defaults of
`docs/DELIVERY-7-PLAN.md` §1 applied (R-006: `npm run worker`, no Friday freeze while S-4 is open). Owner answers used: A-15 (real
data only), D-7a (connectors configured by IT), NEW-CURSUS-4 (Lucca unplugged), X-6 (no mail sent today).

## 1. What changed, per item

### R-008 — HTTP hardening

- **Content-Security-Policy with a nonce** (`src/proxy.ts` → `src/server/http/proxy-security.ts`, policy in
  `src/server/http/security-headers.ts`). Every page, Route Handler and Server Function response gets a fresh nonce:
  - `script-src 'self' 'nonce-…' 'strict-dynamic'` (+ `'unsafe-eval'` in `next dev` only). Next.js reads the nonce from the request
    header and puts it on its own scripts; every route is dynamic (the root layout reads cookies), so every page gets it.
  - `style-src 'self' 'unsafe-inline'`: React renders data-driven `style` attributes (bars, positions) that no nonce can cover.
  - `img-src 'self' data: blob:`, `font-src 'self' data:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
    `form-action 'self'`, `frame-ancestors 'none'`; `upgrade-insecure-requests` only when the request came over HTTPS
    (X-Forwarded-Proto), so `http://localhost` runs (Mac app, e2e) keep loading their assets.
  - Verified: the e2e suite crawls all 59 screens under the CSP with no violation or browser error; `next dev` hydrates with it too.
- **Static headers on every response** (`next.config.ts` `headers()`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera kept for Keystone itself — site photos from a
  tablet; microphone, geolocation, payment, USB, display capture closed), `Cross-Origin-Opener-Policy: same-origin`,
  `Strict-Transport-Security: max-age=31536000` in production builds only (browsers ignore it over plain HTTP). `X-Powered-By` off.
- **Same origin on every state-changing Route Handler** (`isSameOriginRequest`, `src/server/http/request-guard.ts`): task-file upload,
  import, the logged exports (`/api/export/…` writes `export_log`) and the MS Project XML export (audit + connector stamp). Refused
  (403): `Sec-Fetch-Site: cross-site` or `same-site`, or an `Origin` naming another host (or "null"). Requests with neither header
  (scripts, tests) pass, as Next does for Server Functions. The task-access helper `isSameOrigin` and the import route's inline
  check are replaced by it.
- **Rate limits** (sliding window per viewer and address — the last `X-Forwarded-For` hop, set by the TLS proxy or by Next.js from
  the socket): uploads 30 / min (task attachments, transcript import), imports 10 / min, exports 60 / min (screen files, MS Project
  XML, audit CSV), transcript analyses 10 / min (Claude is billed per call), browser-error reports 20 / min. Answer: 429 with
  `Retry-After`, « Trop de requêtes — patientez une minute puis réessayez ». Refusals for rights still come first (a 403 stays 403).
  In-process memory, at most 5 000 clients remembered.
- Not done here: session cookies `httpOnly` / `secure` belong to the auth lot (R-038). The preference cookies (`ks-nav`,
  `ks-project`, plan collapse) are written by client code and cannot be `httpOnly`; `ks-role` is the demo "View as".

### R-176 — Error and "page not found" pages

- `src/app/(app)/error.tsx` (inside the shell: the sidebar stays usable), `src/app/error.tsx` (the shell itself failed),
  `src/app/global-error.tsx` (the root layout failed: own `<html>`, Nocturne CSS, Inter, language from the `ks-lang` cookie) share
  one card (`src/features/errors/`): « Une erreur est survenue », the text, the **incident ID**, « Réessayer » (Next's `retry`) and
  « Retour à l'accueil » (a full page load). French by default through the i18n layer; English when the viewer chose it.
- **Incident ID**: for a server error, Next's `digest` — the hash Next prints with the error in the server log (and that R-009's
  `onRequestError` line carries as `err.digest`). For a browser error (no digest), a `C-xxxxxxxx` identifier made in the browser and
  reported once to `reportClientIncidentAction`, which writes one JSON line to the server log (`msg: "Browser error"`, incident,
  path without query, message ≤ 300 characters, role). Input validated, rate-limited, nothing stored.
- `src/app/(app)/not-found.tsx` (unknown screens, projects, records — inside the shell) and `src/app/not-found.tsx` (outside):
  « Erreur 404 · Page introuvable », HTTP 404.

### R-016 — CI and versioned end-to-end tests

- `.github/workflows/ci.yml` on pull requests and pushes to main: `npm ci`, `npx next typegen`, typecheck, lint, vitest, build with
  `KEYSTONE_DIST_DIR=.next-ci`, Playwright Chromium, `npm run test:e2e`; the report is uploaded when it fails.
- `npm run test:e2e` (`tests/e2e/run.ts`, config `playwright.config.ts`): builds into `.next-ci` when no build is there, starts
  `next start` on a free port of 127.0.0.1 (never 3000, 3100, 3110, 3200, 3210, 3217, 3310, 5173) with a temporary data directory and
  no connector URL or Claude key, waits for the first page, runs Playwright (one worker: the scenarios share the database, in file
  order), stops the server, removes the data, and fails if the server logged an error (`test-results/e2e-server.log`).
- 18 scenarios, all passing (≈ 1.7 min): security headers and nonce CSP; every screen under the CSP; the French 404; honest
  connectors; Reschedule twice (11 activities, then « no change »); relationships (loop and duplicate refused, one added then removed);
  work package 1.7 removed → Undo → plan CSV identical, A1520 removed → Recently deleted → Restore; BL3 through a change request
  approved by PM, client, director and CCB (current, 21 activities); what-if drafts created once, one sent, one discarded; French
  transcript → local analysis → « Ajouter au CR »; CSV / Excel of 12 screens, the 8 PDF reports, document PDFs, MS Project XML, client
  refusals (P-1), the export rate limit, a cross-site export refused; New project wizard (location required, opens on its plan);
  « At risk below » 0.99 → NDC-031 At risk on Projects and in the CSV, then restored; forced stage changes approved / rejected
  (reverted); task attachment byte-identical, PM 403, `.exe` 415, cross-site 403; spares purchase order (draft) from the BOM.
- `@playwright/test` 1.56.1 was already pinned and installed; no new dependency.
- Lint ignores `.claude/**` (agent worktrees) and the e2e outputs, so `npm run lint` needs no `--ignore-pattern`. A checkout whose
  `node_modules` is a symlink (agent worktrees) builds with `KEYSTONE_TURBOPACK_ROOT` set to the common parent (`run.ts` sets it).

### R-006 — Job worker

- Jobs (`src/server/jobs/definitions.ts`, rules in `src/domain/jobs.ts`):
  | Job | Every | What a run does |
  |---|---|---|
  | `vigie-outbox` | 5 min | ECO and NCR progress not yet sent → Vigie (HTTP mode); the mock sends nothing and reports what waits |
  | `cursus-outbox` | 5 min | travel requests not yet sent → Cursus (HTTP mode); reminders stay pending (no Cursus endpoint, C-2) |
  | `plan-trash-purge` | 1 h | every project: trash entries older than 30 days or beyond the 20 newest deleted, their attachment files too |
  | `orphan-files-prune` | 24 h | files under `<data>/files` without a `stored_files` record and older than 24 h removed |
  Each job is idempotent (only undelivered entries are sent and marked; what is purged is gone; a second run does nothing).
  Not built: the Friday freeze (S-4 open), the e-mail digest (X-6b: no mail connector), Sage / PDM jobs (connectors absent).
- **Leases** in the new table `job_locks` (migration `0007_left_whirlwind.sql`): one upsert on the database clock takes the lease when
  it is free and the job has not started less than 90 % of its interval ago, so two workers never run a job at once and N workers run
  it about once per interval; a crashed worker's lease expires (15 min, 1 h for the prune); the last outcome (ok, summary, error,
  count) is kept on the row. One JSON log line per run (`component: "jobs"`, job, holder, duration, counts; warning when a delivery
  failed, error when a run failed — a failure never stops the worker).
- **`npm run worker`** (`scripts/worker.ts`, tsx with the react-server condition): `--once` runs every (or `--job …`) job now and
  exits (1 when one failed); otherwise the scheduler runs until SIGINT / SIGTERM and waits for the runs in progress. It needs
  PostgreSQL (`DATABASE_URL`, R-002): the embedded PGlite folder can only be opened by one process, so with PGlite it refuses unless
  `KEYSTONE_WORKER_PGLITE=exclusive` (the server is stopped — a maintenance run; a lock file keeps a second worker out).
- **`KEYSTONE_JOBS=inprocess`**: the same scheduler inside the web server (`src/instrumentation.ts`), the way to run the jobs with
  PGlite (single-container beta, Mac app). Verified on `next start`. Off by default.
- `pruneOrphanFiles` gained a grace period (an upload writes its bytes before its record commits); the plan-trash purge rule is the
  pure `trashEntriesToPurge`, shared by the removal-time purge (keeps 19 + the new one) and the job (keeps 20).

### R-021 — Real connector state

- Rule (`src/domain/connectors.ts`): each row's real link — **live** (Vigie / Cursus with their API URL), **mock** (Vigie / Cursus
  without it, Codex: Keystone's index, no Codex API yet), **file** (MS Project: XML export, imports off by D-7b), **none** (Sage X3,
  SolidWorks PDM, Outlook / Exchange, Microsoft Teams, e-mail SMTP, connectors added in Keystone). Lucca is retired (NEW-CURSUS-4):
  not listed, not offered by "Add connector", its sync refused as unknown.
- What a row shows: live → its status, last sync and volume, "Sync now"; mock → « Simulé » / "Mock", no last sync, the mirror's
  content and outbox, "Sync now" whose toast and audit line say the run is simulated (no sync date recorded); file → « Prêt », its last
  export, no "Sync now"; none → « Non connecté », no last sync, no volume, no "Sync now" (and `syncConnector` refuses it); disabled by
  IT → « Désactivé ». The mode line: « Connecteur réel · API HTTP », « Connecteur simulé · miroir local », « Échange de fichiers · pas
  de connexion directe ». Same values in the screen's Excel / CSV export.
- KPI tiles count what is really connected; the nav badge "!" only flags a live connector that failed.
- Documents (Codex): the banner shows the index count without a sync time; "Sync now" says the run is simulated. Drawings "Sync
  vault" (PDM): the toast says the run is simulated (PDM not connected).

## 2. Displayed values, old → new (seed, director)

| Where | Before | Now | Decision |
|---|---|---|---|
| Activity & integrations · Connectors tile | 10 · 8 healthy · 1 warning | **9** · 1 connected · 3 mock · 5 not connected (« 1 connecté · 3 simulés · 5 non connectés ») | A-15, NEW-CURSUS-4 |
| · Channels tile | 3 · In-app · e-mail · Teams | **1** · In-app · e-mail and Teams not connected | A-15, X-6 |
| · Connectors table | 10 rows, prototype statuses and volumes (« OK · 18 stock lines · 6 invoices », « Warning · Token expires in 3 days », « 9 sent today », Lucca « 312 h · 8 people ») | 9 rows: Cursus, Codex, Vigie « Simulé » (last sync —); Sage X3, PDM, Outlook, Teams, SMTP « Non connecté » (— / —, no Sync now); MS Project « Prêt » 25 Sep 18:02 · HLT-026 exported · BL1 | A-15, D-7a, NEW-CURSUS-4 |
| · Vigie row | OK · 25 Sep 07:30 | Simulé · — (same volume) | A-15 |
| Sidebar badge of Activity & integrations | « ! » (Outlook's seeded Warning) | none | A-15 |
| "Sync now" toast (Vigie mock) | Vigie synced · 0 sent · 0 pending · 0 refreshed | Vigie · simulated sync (mock connector) · 0 sent · 0 pending · 0 refreshed | A-15 |
| "Add connector" toast / duplicate | Connector added · first sync scheduled / « X is already connected » | Connector added · not connected until IT sets it up / « X is already listed » | A-15, D-7a |
| Documents · Codex banner | Last sync 08:02 · 412 records | Mock index · 412 records (« Index simulé · 412 fiches ») | A-15 |
| Documents · Sync now toast | Codex sync · index up to date · 414 records | Codex · simulated sync (mock connector) · 414 records | A-15 |
| Drawings · Sync vault toast | Vault synchronised · 0 drawings updated | Simulated vault sync (SolidWorks PDM not connected) · 0 drawings updated | A-15 |

Tests updated with the decision ids: `src/domain/admin.test.ts`, `src/features/admin/{actions,model,render}.test.ts`,
`src/features/docs/{actions,render}.test.ts`, `src/features/eco/actions.test.ts`, `src/server/dal/{delivery5,delivery5-writes,shell}.test.ts`.

## 3. Migration

`drizzle/0007_left_whirlwind.sql`: table `job_locks` (job PK, holder, locked_until, last started / finished, last ok, summary,
error, run count). Nothing else in the schema changed. The integrator regenerates one combined migration.

## 4. Checks

- `npm run typecheck` clean; eslint clean on every touched file and the e2e suite.
- vitest on the touched folders: `src/server/{http,jobs,storage,integrations,dal,export}`, `src/features/{errors,admin,docs,eco,meetings,mywork}`,
  `src/domain`, `src/components/app/shell` — 103 files, 1 681 tests, all passing (new: 8 files, 63 tests; plus the cases added to existing files).
- `KEYSTONE_DIST_DIR=.next-ci npm run build` (Turbopack) succeeds; `npm run test:e2e`: 18 / 18; `npm run worker -- --once` on a
  temporary PGlite (exclusive) and `KEYSTONE_JOBS=inprocess` on `next start`: every job runs and logs; `next dev` hydrates under the CSP.

## 5. For the integrator (other lots of delivery 7)

- **`src/proxy.ts`** is also created by the auth lot (R-038). Merge: keep its sign-in checks and return `nextWithCsp(request)`
  (`src/server/http/proxy-security.ts`) wherever it lets a request through (`NextResponse.next()`); redirects and 401 need no CSP.
  Its matcher (`/((?!_next/static|_next/image).*)`) suits both.
- **`src/instrumentation.ts`** is also created by platform-data (R-009 / R-007): keep its `register()` (configuration and database
  checks) and `onRequestError`, then start the in-process jobs when `jobsInProcess(process.env)`.
- Worker database guard (`src/server/jobs/cli.ts` `workerDatabaseGuard`) reads `DATABASE_URL` / `KEYSTONE_WORKER_PGLITE` directly:
  switch it to R-007's `getConfig().database.driver` once merged; `getDb()` opens PostgreSQL only with R-002.
- Log lines (`src/server/jobs/log.ts`, `reportClientIncidentAction`) are JSON on stdout / stderr: route them through R-009's `log`.
- The rate-limit key uses the viewer's name: with R-038 / R-039, use the signed-in user's id.
- New env variables to document in `.env.example` (R-007): `KEYSTONE_JOBS`, `KEYSTONE_WORKER_PGLITE`, `KEYSTONE_TURBOPACK_ROOT`,
  `E2E_PORT` (optional, e2e).
- `CLAUDE.md` "Setup and checks" can now list `npm run test:e2e` and `npm run worker`, and drop the lint `--ignore-pattern` note;
  `docs/reste-a-developper.json` (progress of R-006, R-008, R-016, R-021, R-176) is left to the final delivery write-up.

## 6. Open questions for the owner

| Id | Question | Default built |
|---|---|---|
| R-008 | Rate-limit values (uploads 30, imports 10, exports 60, analyses 10 a minute per person) and per-instance counting until a shared store exists | as listed |
| R-008 | HSTS for one year on Keystone's host only; add `includeSubDomains` / preload once the production domain is known? | host only |
| R-008 | Camera allowed to Keystone itself (tablet photos, R-126); microphone, geolocation closed — confirm | camera self |
| R-176 | Should IT be notified (mail / Teams) of each incident, or is the log enough until R-009's alerts exist? | log only |
| R-021 | Mock connectors (Vigie / Cursus without API, Codex) keep "Sync now" with a "simulated" toast: keep it for demos, or hide it? | kept, labelled |
| R-021 | "Add connector" records a row that stays « Non connecté » (D-7a: IT configures connectors) — remove the button (debt-ux R-020)? | kept |
| R-021 | MS Project shows the seeded last export (25 Sep 18:02); Drawings' "Last vault sync" still reads the seeded PDM row and simulated runs — show « Non connecté » there too? Leave / Hours screens still name Lucca (NEW-CURSUS-4 / C-2b, later) | unchanged |
| R-006 | Intervals (outboxes 5 min, purge hourly, prune daily) and how long a failing delivery is retried (today: every run, no limit) | as listed |
| R-006 | Hosting (I-1a): the worker runs with tsx (dev dependencies) — a bundled worker for a slim image? With PGlite, run the jobs in the server (`KEYSTONE_JOBS=inprocess`) | tsx |
| R-006 | The web server still delivers an entry right after it is recorded (HTTP mode); a worker run at the same moment may send it twice — Vigie and Cursus should ignore a repeated `keystoneId` (V-2, C-2) | — |
| R-016 | Version the 3 520-request route matrix (8 personas × FR/EN) as a nightly job? The e2e crawl covers each screen once (director) | crawl only |
| S-4 | Friday freeze and data-date writer (unchanged: waits for S-4) | not built |
