# Delivery 7 — lot platform-data notes: PostgreSQL, production seed, concurrent writes, logs and health, configuration

Scope: `docs/DELIVERY-7-PLAN.md` §2, lot **platform-data** — R-002, R-011, R-010, R-009, R-007 (defaults of §1 applied:
`DATABASE_URL` → PostgreSQL else PGlite; `KEYSTONE_SEED=demo` default, `production` = reference data only).
One migration: `drizzle/0007_dapper_carnage.sql` (§6). New dependencies: `pg` 8.23.0 and `@types/pg` 8.23.1 (§7).

## 1. What changed per item

### R-002 — PostgreSQL server

| Before | After |
|---|---|
| `DB = PgliteDatabase` (`src/server/db/types.ts`) | `DB = PgDatabase<KeystoneQueryResultHKT, schema>`, `Tx = PgTransaction<…>`: one type for both drivers. `db.execute()` results expose `rows` on both. Both driver handles are assignable without a cast (checked by `tsc`). |
| `getDb()` always opened PGlite, migrated and seeded on first access | `src/server/db/client.ts` reads the configuration: `DATABASE_URL` set → `openPostgres()` (`src/server/db/postgres.ts`: `pg.Pool` with `DATABASE_POOL_MAX` (default 10), idle 30 s, connect timeout 10 s, `application_name=keystone`, pool `error` events logged). The app **never migrates nor seeds** a server database; it refuses to open one with pending migrations (`PendingMigrationsError` → start-up fails in production). Unset → PGlite in `KEYSTONE_DATA_DIR/pg`, migrated and seeded on open as before. |
| No deploy-time migration | `npm run db:migrate` (`scripts/db-migrate.ts` → `src/server/db/migrate-command.ts`). PostgreSQL: pending migrations, then the seed of an **empty** database, all under a session advisory lock (`pg_advisory_lock(727154007)`) so two deploys never interleave. An empty server database requires `KEYSTONE_SEED` to be set explicitly (`SeedChoiceRequiredError`, A-15 guard). PGlite: opens / migrates / seeds `KEYSTONE_DATA_DIR`. It loads the `.env*` files with Next's precedence (`src/server/config/env-files.ts`) and checks the configuration strictly. Exit code 0 / 1. |
| — | `src/server/db/migrations.ts`: `pendingMigrations(db)` (journal of `./drizzle` vs `drizzle.__drizzle_migrations`, same rule as drizzle's migrator), used by `getDb()` and `GET /api/health`. |

`pg` is imported dynamically, only on the PostgreSQL path (it is in Next's default `serverExternalPackages`): development, tests and the
Mac app never load it.

### R-011 — production seed (A-15)

- `KEYSTONE_SEED=production` seeds `src/server/db/seed/reference.ts` only:
  - lifecycle stages, transitions and stage deliverables;
  - machine types with their payment pattern, phases, cost categories, ITP systems and the New project templates (no REX
    reference projects);
  - the 4 built-in calendars;
  - the Settings lists, health thresholds, import / export formats;
  - the connectors, listed **Ready, never synced** (no prototype sync state);
  - document types and approval circuits (no approver: people come from sign-in);
  - departments without heads, zones without managers, countries, cities;
  - leave types, public holidays, skills (matrix columns), what-if levers, scoring axes, departments' demand rates;
  - engineering disciplines (lead "—"), consistency rules, import tools and column mapping.

  No project, person, user, client, supplier, part, storage location, rate, document, notification or audit row. The test
  `src/server/db/seed/production-seed.test.ts` asserts the exact list of non-empty tables, so a future demo table cannot
  leak into production.
- The seed modules were split so both seeds share one source per reference table (`seedPortfolioReference`, `seedDepartments`,
  `seedGeography`, `seedDocumentTypes`, `seedResourceReference`, `seedPrioritisationReference`, `seedEngineeringReference`,
  `seedSettings({ demo })`). The demo seed inserts exactly the same rows as before.
- **Seed record.** `app_settings` key `keystone.seed` = `{ mode, seededAt }` (`src/server/db/seed/mode.ts`). A database keeps
  the data set it was created with, whatever `KEYSTONE_SEED` says later (a warning is logged when they differ). A database
  seeded before delivery 7 has no record: it is treated as demo and adopts the record on its next open. Production databases
  never run the demo backfills (Delivery 4/5/chapter-4), which would load prototype data.
- **Demo artefacts in code paths:**
  - **Numbering floors** (`demoFloor(q, floor)`) apply to a demo database only. Covered: R-20, T-2340, CR-010, RQ-044, MTG-129,
    WC-019, MCH-049, LL-09, IF-09, I-19, P-09, MIN floor 24, receipts BL-2026-0599, Codex deposit preview +40. On a
    production database the first numbers are R-01, CR-001, T-0001…
  - **The prototype's default PM** (S. Perrin) in the New project wizard and its writer: demo database only. A production
    project without a chosen PM has none ("—").
  - **Current project** (`src/server/dal/current-project.ts`, `session.getCurrentProject()`): the last project used when it
    still exists, else `DEFAULT_PROJECT` when the database has it (demo, unchanged), else the first project of the register,
    else none. A client's fallback is a project of their organisation. `getLastProject()` keeps its string signature for its
    20 callers: it returns the current project, or `DEFAULT_PROJECT` while the database has no project at all (those links
    then 404).
  - **Home**: the Homes built around a project (director, project manager, quality, procurement, client) show an empty Home
    (`src/domain/home-empty.ts`: greeting, no KPI, "No project yet") when there is none.
  - **Deliveries**: `getPutAwayOptions()` returned the central warehouse or threw. It now returns `''` when no storage location
    is configured. Announcing still refuses with "No Central warehouse configured".

### R-010 — concurrent writes

- **SERIALIZABLE everywhere** (`src/server/db/transactions.ts`). Every `db.transaction()` of both drivers runs
  `isolation level serializable` (unless the caller asks otherwise). It is run again from the start after a serialization
  failure (40001) or a deadlock (40P01): up to 6 attempts, jittered exponential back-off of 10–400 ms. Savepoints
  (`tx.transaction`) are unchanged. This covers, without touching the writers:
  - the business numbering (`max + 1` over the table — `nextNumber` and the direct `nextBusinessNumber` call sites);
  - every "check then write" made inside a writer's transaction: status transitions, approvals, stock quantities,
    what-if drafts…
- **Consequence for writers:** a transaction callback may run more than once, so it must not accumulate into outer
  variables. An AST scan of the 175 transaction sites found one: `rescheduleProject`'s `changed` list, which is now reset at
  the start of the callback. Files stored inside a transaction become orphans when an attempt rolls back; they are pruned
  later.
- **S-3** (DELIVERY-6 §6): `createBaselineSnapshot(…, { enforcePolicy: true })` re-checks the rule inside its transaction. A
  current snapshot or one without change request needs the project below BL1, and a change request carries one proposed
  baseline. `setBaselineAction` (Plan) and `rebaselineSchedule` (Schedule) use it and map `BaselinePolicyError` to their
  existing messages. Two "Set baseline" at BL0 now give BL1 and a refusal, instead of BL1 and BL2.
- **Connector outboxes** (Vigie ECO / NCR progress, Cursus requests): a delivery claims an entry before its HTTP call. The claim
  is one conditional UPDATE on the new `claimed_at` column: not sent, and not claimed within the last 2 minutes. The result
  clears the claim. Two deliveries at once (users, a worker, instances) no longer send an entry twice. `attempts` is
  incremented in SQL (it was read, then written).
- **globalThis state:**
  - The connectors' refresh throttles stay per process (with several instances, each refreshes at most once a minute, which
    bounds the load on Vigie / Cursus). Concurrent reads of one process now share the refresh in flight instead of each
    calling the API.
  - `__ksDb` (singleton), `__ksExportProviders` (static registry) and `__ksFilesRoot` (test override) are safe.
- **Orphan files:** `pruneOrphanFiles()` keeps files younger than 1 h (`ORPHAN_GRACE_MS`). `storeFile` writes the bytes before
  its transaction commits, so a prune running at the same moment deleted a file about to be recorded.
- **Checked, left as is:** `projects.ts createProject` (numbering read before its transaction) is only used by
  `scripts/db-check.ts`; the wizard's `createWizardProject` allocates inside its transaction.

### R-009 — logs and health

- **`src/server/log`:**
  - `log.debug/info/warn/error(msg, fields)`, `log.child(bindings)`, `logError(where, err, fields)`, `logWarning`,
    `logRequestError`.
  - One JSON object per line in production (`time`, `level`, `msg`, fields, `err: { type, message, code, status, digest,
    stack, cause }`), readable text otherwise (`LOG_FORMAT`). `LOG_LEVEL` default `info`. Lines are written through `console.*`
    (stdout for debug/info, stderr for warn/error).
  - **No secrets:** fields named like password / token / api key / authorization / cookie / session / credential are
    replaced by `[redacted]`. The configured secret values (API keys, the database password) are masked wherever they
    appear, as are URL credentials and bearer tokens. Depth, array and string sizes are capped and cycles are cut.
- **Every `console.*` of a Server Function, Route Handler, connector, seed backfill, approvals provider and the Claude
  analysis now goes through the logger.** Outside tests and prototype harnesses no `console.*` is left
  in `src`.
- **`src/instrumentation.ts`:**
  - `register()` runs the start-up check on Node.js (configuration, then, in production, the database).
  - `onRequestError` writes one line per error Next catches: method, path without the query string, route, route type and
    error. Headers are never logged.
- **`GET` / `HEAD /api/health`** (`src/server/health.ts`):
  - 200 `{ status: "ok", checks: { database: { status, latencyMs } }, time }` when the database answers within 5 s and has no
    pending migration;
  - else 503 with status `timeout`, `error` or `migrations_pending` (and the count).
  - No host, driver, version or error text in the body; the cause is logged. `Cache-Control: no-store`.

### R-007 — configuration

- **`src/server/config`:**
  - `parse.ts` (pure zod schema, one schema per variable) and `index.ts` (`getConfig()`, `configResult()`, `ConfigError`,
    `assertValidConfig()`; cached per variable values, so tests that stub a variable see it).
  - Variables: `NODE_ENV`, `KEYSTONE_DATA_DIR`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `KEYSTONE_SEED`, `LOG_LEVEL`, `LOG_FORMAT`,
    the three `NEXT_PUBLIC_*_URL`, `CURSUS_API_URL`, `CURSUS_API_KEY`, `KEYSTONE_API_KEY`, `VIGIE_API_URL`, `VIGIE_API_KEY`,
    `ANTHROPIC_API_KEY`, `KEYSTONE_AI`, `KEYSTONE_AI_MODEL`, `KEYSTONE_AI_FALLBACKS`.
- **Rules:**
  - Blank means unset.
  - An invalid value is an error naming the variable, never its value.
  - **Production stops at start-up on any error** (exit 1, one log line).
  - Development logs the errors and uses the defaults.
  - Production refuses the Cursus demo key: `CURSUS_API_URL` requires `CURSUS_API_KEY` (or `KEYSTONE_API_KEY`), and
    `demo-keystone` is rejected. The connector also refuses to call Cursus without a key and records the failure.
  - Exception: a Cursus on the same machine (loopback URL `localhost`, `127.x`, `::1`) may keep the demo key, with a
    warning. This covers the Mac app (`NODE_ENV=production`) next to a local Cursus.
  - Production warns when the `NEXT_PUBLIC_*` URLs are unset (links to localhost), and when Vigie has no key (V-3).
- **Integration settings split:**
  - `cursus/config.ts` and `vigie/config.ts` keep only the public URL (safe in client components).
  - The API URL, key and connector mode moved to the server-only `cursus/connection.ts` and `vigie/connection.ts`, which read
    `getConfig()`.
  - `VIGIE_API_KEY` (optional, provisional until V-3) is sent as `X-Api-Key`.
- `KEYSTONE_DATA_DIR` is read through the configuration by the database and the file storage.
- `.env.example` documents every variable, including the build-time and tooling ones: `KEYSTONE_DIST_DIR`,
  `KS_DEV_GALLERY`, `PORT`, `HOSTNAME`, `KEYSTONE_AI_ALLOW_IN_TESTS`.

## 2. Rules and defaults chosen

| Point | Default |
|---|---|
| Isolation | SERIALIZABLE + automatic retry (rather than per-table advisory locks): it also covers every check-then-write inside a transaction. A lock taken mid-transaction would not refresh a SERIALIZABLE snapshot, so locks were not added on top. |
| Outbox lease | 2 minutes (HTTP calls time out after 5 s). |
| Seed of a server database | Explicit `KEYSTONE_SEED` required when the database is empty (refused otherwise), so a deploy never loads the demo by omission. PGlite keeps the plan's default (demo). |
| Production reference data | What the screens need to start (list in §1). Clients, suppliers, storage locations, rates and people are entered by EPC2i or arrive through sign-in and connectors. |
| Health | Readiness (database + schema). Public, no detail. |
| Start-up in production | Configuration errors, an unreachable database or pending migrations stop the process (exit 1). The Mac app (`NODE_ENV=production`, PGlite) is unaffected while its configuration is valid; it logs 3 warnings (links to localhost), which are expected there. |

## 3. Old → new displayed values

**None on the demo seed.** Floors, default project, default PM, connectors and put-away are all kept on a demo database. Golden
tests are unchanged except `scripts/db-check.ts` (`app_settings` 1 → 2: the seed record, R-011 / A-15). Behaviour changes:
- a second simultaneous "Set baseline" / "Re-baseline" is refused (R-010, S-3);
- a remembered project that no longer exists falls back to the current project (it was used as is);
- production stops on an invalid configuration;
- server log lines are structured.

## 4. Verification

- `npm run typecheck` clean; `npx eslint --ignore-pattern '.claude/**' src scripts` clean.
- **Vitest.**
  - `src/features src/domain src/components src/app src/config src/lib src/i18n`: 168 files, 2108 tests pass.
  - Final run after the last fixes, on `src/server` plus the features deliveries, home, plan and schedule, and `src/app`,
    `src/domain`, `src/i18n`: 108 files and 1712 tests pass. The Postgres integration test is skipped without its variable;
    it was run against a real server (below).
  - New tests: config (parse, env, .env files), logger, transactions, production seed, production start, outbox and
    concurrency, baseline race (Plan + Schedule; it fails if `enforcePolicy` is removed), health, start-up and db:migrate,
    getDb from the configuration, empty Home.
- **`src/server/db/postgres.integration.test.ts`** (opt-in: `KEYSTONE_TEST_DATABASE_URL`). Run against a private PostgreSQL 16
  on a unix socket:
  - db:migrate (refused seed, then migrations + demo seed, idempotent, two at once under the lock);
  - **driver parity**: 17 DAL reads (projects, project data, stage history, cost, plan, schedule, changes, risks, contract,
    meetings, orders, site, stock, tasks, resource pool, overview, the 8 Homes) are identical on PostgreSQL and PGlite;
  - **concurrency on separate connections**: 8 parallel `createRisk` → R-21…R-28, 6 parallel to-dos → distinct, 4
    simultaneous snapshots at BL0 → one BL1 and 3 `BaselinePolicyError`.

  The same concurrency tests fail under READ COMMITTED (duplicate R-21, unique violation on baselines), which confirms what
  they measure.
- `scripts/db-check.ts`: all checks passed.
- **Route crawls** of `next start` built from this branch, port 3316, FR, the 8 personas, 200 and no error page required:
  - empty production database: 232 requests, all OK;
  - production database with one project created by the wizard: 504 requests (global screens + the 30 project screens),
    all OK after the put-away fix;
  - **demo data served from PostgreSQL** (`npm run db:migrate` then `DATABASE_URL`): 1720 requests (global screens + the 6
    projects with data + deep links), all OK, no error line in the log;
  - production start with `LOG_LEVEL=bogus`: exit 1 with one JSON line; on an unmigrated PostgreSQL: exit 1, "8 pending
    migrations".

## 5. Integration notes

- `pg` 8.23.0 and `@types/pg` 8.23.1 must be in `package.json` (they are already in the shared `node_modules`).
- The auth lot's sign-in gate (`proxy.ts`) must let `GET /api/health` through.
- Lots adding environment variables (auth: `KEYSTONE_AUTH`, Entra) should add them to `src/server/config/parse.ts` `VARS`
  and to `.env.example`.
- Lots reworking the connectors' delivery loops (platform-web: worker, R-021) should keep the `claim…Delivery` call before
  each send.
- The Server Functions now call `logError` where they called `console.error`: expect one-line conflicts in the feature
  `actions.ts` files touched by other lots.
- A Turbopack build inside an agent worktree whose `node_modules` is a symlink needs `turbopack.root` (used temporarily for
  the crawls, not committed).
- `./drizzle` must ship with the server: PGlite already needed it, and now `getDb()` on PostgreSQL and `/api/health` read its
  journal to detect pending migrations. This matters for a `standalone` output or a slim image.

## 6. Migration

`drizzle/0007_dapper_carnage.sql`: `claimed_at timestamptz` (nullable) on `vigie_eco_progress`, `vigie_ncr_progress` and
`cursus_requests`. No data change. The integrator regenerates one combined migration.

## 7. Open questions for the owner

1. **Reference data of a production start.** Is the list in §1 right? In particular: machine-type payment patterns, phases and
   ITP systems are the prototype's until the owner supplies the machine-type standards. Storage locations, rates and suppliers
   are not seeded. Should EPC2i's real warehouses be seeded?
2. **Draft purchase order numbers** keep the prototype's range PO-1100…1999 in production; this depends on Sage X3 numbering
   (Q-7 / R-014). Year prefixes INV-2026-, RFQ-2026-, BL-2026- follow the frozen clock (R-013).
3. **Concurrent edits of one record** (two people editing the same risk or task form, the last save winning) are not
   detected. Transactions are safe, but the form does not know its data is stale. A version check needs a UX decision:
   which message, reload or merge.
4. **External alerts** (e-mail / Teams) when a connector fails or an outbox stays pending wait for the mail relay (R-036) and
   the target channel. Today the logs and the Integrations badge carry them.
5. **Vigie authentication (V-3).** `VIGIE_API_KEY` is sent as `X-Api-Key` as a provisional choice.
6. **Static portfolio alerts** ("Harbor Line — critical path slip"…, `src/domain/portfolio.ts`) still show on a production
   database until R-130 (contract-portfolio lot) generates them from rules.
7. **Imports' default PM** "S. Perrin" (`src/server/interchange/defaults.ts`) is left as is while imports are off (D-7b).
8. **Hosting (I-1a).** `npm run db:migrate` runs with `tsx` (a dev dependency): run it in the build or deploy stage, not in a
   runtime image without dev dependencies. Secrets belong in the platform's secret store.
