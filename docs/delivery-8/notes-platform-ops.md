# Delivery 8 — lot platform-ops: container and Coolify kit, backups and restore, dependency watch, antivirus on uploads, runbook and role guides

Working notes for `docs/DELIVERY-8.md`. Items: R-003, R-004, R-174, R-175, R-177 (`docs/RESTE-A-DEVELOPPER.md`). Brief:
`docs/delivery-8/lot-briefs.md` § platform-ops; defaults of `docs/DELIVERY-8-PLAN.md` §2 applied (R-003 Coolify compose, demo beta
behind basic auth; R-004 off unless `KEYSTONE_BACKUP_DIR`, 10 min, 48 h / 30 d / 12 m, empty-target restore; R-174 high/critical
gate, weekly Dependabot, uuid 11.1.1; R-175 ClamAV fail-closed, explicit with the production seed; R-177 French Markdown, no
in-app help). No owner answer asks for R-175: it is a platform-hardening default, like R-008.

The branch was forked from `95412b5` by the workflow; it was moved to `e41c309` (the required base, no work lost) before anything
was written.

## 1. What changed, per item

### R-003 — container and Coolify deployment (partly buildable)

- **`Dockerfile`** (replaces PR #1's single container, which stays open for the owner): `node:22-bookworm-slim`; PostgreSQL 16
  client tools from the PGDG apt repository (bookworm ships 15, which cannot dump a 16 server) and `tzdata` (TZ needs it), curl
  removed again; `npm ci` **keeping the development dependencies** (tsx runs `db:migrate`, the worker, backup and restore);
  build arguments **only** `NEXT_PUBLIC_CODEX_URL` / `NEXT_PUBLIC_CURSUS_URL` / `NEXT_PUBLIC_VIGIE_URL`, unset when empty
  (client code reads them with `||` defaults); `next build` then the build-time `.data` removed; `ENV NODE_ENV=production
  KEYSTONE_DATA_DIR=/data TZ=Europe/Paris LOG_FORMAT=json PORT=3000 HOSTNAME=0.0.0.0`; non-root user `node` owning `/data`,
  `/backups` (a named volume mounted there takes the image's ownership) and `.next`; `HEALTHCHECK` with `node -e fetch(…/api/health)`
  (no curl or wget in the slim image); `EXPOSE 3000`; `CMD next start -H 0.0.0.0 -p 3000`.
- **`.dockerignore`**: PR #1's list + `.artifacts`, `test-results`, `playwright-report`, `.claude`, `design`, `docs`, `.next-ci`,
  `tsconfig.tsbuildinfo`, `*.log`.
- **`deploy/compose.yaml`** (Coolify "Docker Compose" resource): `db` postgres:16 (`pg_isready` health check, volume
  `keystone-db`); `migrate` one-shot `npm run db:migrate` (`KEYSTONE_SEED` required by interpolation, `exclude_from_hc: true`,
  health check disabled, `pull_policy: never`); `app` builds the image (`keystone-pm:local`, the three build args) and starts
  once the migration completed (`service_completed_successfully`), volume `keystone-data:/data`; `worker` `npm run worker` with
  the same environment plus `KEYSTONE_BACKUP_DIR=/backups` and volumes `keystone-data`, `keystone-backups`; an optional
  `clamav` service under the `antivirus` profile. One YAML anchor carries every runtime variable of `.env.example` (empty =
  unset). `docker compose config` validates the file once Coolify's own `exclude_from_hc` key is removed (plain Compose rejects
  it — said in the file and the runbook).
- **CI** (`.github/workflows/ci.yml`, new job `image`): `docker build`, `docker run` with PGlite, `KEYSTONE_SEED=demo`,
  `KEYSTONE_AUTH=demo`, `KEYSTONE_FILE_SCAN=off`, `KEYSTONE_JOBS=inprocess` on `127.0.0.1:3080`, waits for `/api/health` 200,
  then `/` 200, checks the image user is `node`, prints the server log; nothing pushed.
- **Docs**: `docs/EXPLOITATION.md` § 2 and § 12 (single French runbook — the item scope's `docs/DEPLOYMENT.md` was folded into
  it, as the brief's file list says) and a French "Mise en ligne" section in `README.md`. The demo beta behind Coolify basic
  auth, the Entra section marked as waiting, the "Production target" left for I-1a.
- **Not buildable now**: a beta for real users with Entra and the production seed, and any bootstrap or import of people
  (D-7a, D-7b, the open auth question, R-027). **Not verified here**: no Docker daemon runs in the sandbox, so the image was
  not built locally; the CI job is the check (it runs on a pull request or a push to `main`).

### R-004 — backups and restore (partly buildable)

- **Off unless `KEYSTONE_BACKUP_DIR` is set** (never on the Mac app or a development machine by itself).
- **Snapshot** (`src/server/backup/snapshot.ts`) into `<dir>/<UTC stamp>/` (written as `<stamp>.partial`, renamed once complete):
  1. the database, consistent with its file list and row counts:
     - PostgreSQL: one `REPEATABLE READ READ ONLY` transaction exports its snapshot; `pg_dump --format=custom --snapshot=…` dumps
       exactly that state while the same transaction reads `stored_files` and every table's row count. The password goes in
       `PGPASSWORD`, never on the command line;
     - PGlite: inside one PGlite transaction (every other query of the process waits), the list and counts are read, a
       `CHECKPOINT` is taken and `dumpDataDir('gzip')` written (verified: CHECKPOINT runs inside a transaction block; the tarball
       loads into a new folder);
  2. the files of that list, copied once into the content store `<dir>/content/<aa>/<sha256>` (verified hash; a file deleted
     meanwhile → `missing`, a file whose content no longer matches its record → `mismatch`, never stored under the wrong name);
  3. `manifest.json`: format, name, Keystone version (package.json), start / finish / duration, driver, database file + bytes +
     sha256, applied migrations, seed, row counts, every file's id, path, sha256, size and status.
  Folders `0700`, files `0600` (a snapshot holds the whole database).
- **Pure rules** (`src/domain/backup.ts`): `backupDue` (tick vs interval), `backupStale`, `backupsToPrune` (every snapshot 48 h,
  then the newest of each UTC day for 30 days, then of each UTC month for 12 months, always the newest; "newest of its day /
  month" judged over every snapshot so the rule is stable run after run), `blobsToCollect` (garbage collection by reference
  from the kept manifests; `missing` / `mismatch` entries keep nothing), `parseBackupRetention`, snapshot stamps.
- **Folder** (`src/server/backup/store.ts`): listing, manifest reading, a folder lock (`backup.lock`, taken over after 3 h) so
  only one writer prunes / collects at a time, also across hosts sharing the folder; retention then garbage collection; stale
  `.partial` folders and `.part` blobs removed after 3 h.
- **Job `backup`** (`src/server/backup/job.ts`, under the platform-ops markers of `src/domain/jobs.ts` and
  `src/server/jobs/definitions.ts`): wakes every 5 min (lease 3 h) and takes a snapshot when the last one started at least
  `interval − tick/2` ago, so `KEYSTONE_BACKUP_EVERY_MIN` (5–1440, default 10) is honoured within half a tick and never a tick
  longer — the JOB_SCHEDULES entry is static, this keeps the configurable interval without touching code outside the marker.
  In the worker on PostgreSQL, in-process on PGlite. A tick while another backup holds the folder is "skipped". Monitoring:
  the runner's JSON line and `job_locks` outcome; an error line **"Backups are stale: the last good snapshot is too old"** when
  the last good snapshot is older than 30 min (or twice the interval when it is longer); no e-mail (R-036).
- **`npm run backup`** (`scripts/backup.ts`): PostgreSQL at any time; PGlite only with `KEYSTONE_WORKER_PGLITE=exclusive` (the
  worker's guard) and the same lock file — opened as it is, no migration, no seed. The worker's PGlite lock moved to
  `src/server/db/pglite-lock.ts` (shared by `scripts/worker.ts` and `scripts/backup.ts`, same file name, same behaviour).
- **`npm run restore -- <snapshot> --target <empty DB URL | new data folder> [--data-dir <folder>] [--from <dir>]`**
  (`scripts/restore.ts`, `src/server/backup/restore.ts`, arguments in `src/server/backup/cli.ts`): refuses a non-empty target, a
  snapshot of the other kind and a damaged database file before writing anything; `pg_restore --no-owner --no-acl
  --exit-on-error` or a new PGlite folder from the tarball; files copied after their hash is checked; then every `stored_files`
  row must have its file with its sha256 (rows the snapshot listed as `missing` are reported, not failed) and every table its
  recorded row count; pending migrations reported with the next step (`npm run db:migrate`); elapsed time printed; exit 0 / 1 / 2.
- **Configuration**: `KEYSTONE_BACKUP_DIR` (resolved against the working directory; an error when inside `<data>/files` or
  `<data>/pg`, or when it contains the data directory — the orphan prune would delete it), `KEYSTONE_BACKUP_EVERY_MIN`
  (warning above 15: RPO), `KEYSTONE_BACKUP_RETENTION` (`48h,30d,12m`); settings without a folder warn. `.env.example` and the
  runbook (§ 13: what the host must provide, restore steps, quarterly drill).
- **Stays en_cours**: the RPO holds only once the folder is copied off the host (I-1a); managed PITR, the off-site target and
  real-volume RTO proof wait for hosting.

### R-174 — security process (partly buildable)

- **`.github/dependabot.yml`**: npm and github-actions, weekly (Monday 06:00 Europe/Paris), minor + patch grouped, a `nextjs`
  group (`next`, `eslint-config-next`, `@next/*`) so they move together, labels, commit prefixes; reviewed, never auto-merged.
- **`.github/workflows/audit.yml`** (separate, light): `npm audit --omit=dev --audit-level=high --package-lock-only` on pull
  requests, pushes to `main`, Mondays 05:17 UTC and by hand; a second step reports every advisory without failing.
- **`docs/SECURITY.md`**: update policy as defaults to confirm (high/critical in 7 days, monthly minor updates, Next.js patches
  followed), how to triage a new advisory (update, override, dated risk acceptance — never removing the check), reporting
  contact placeholder, the known advisories table (12 Oct 2026), and the penetration-test scope (Entra mode only, test
  accounts from IT, every Route Handler including the connectors lot's Cursus events endpoint, rights role × named team,
  client refusal, uploads and antivirus, rate limits, CSP and headers, error pages, health).
- **`package.json` `overrides: { "uuid": "11.1.1" }`** (exact, CommonJS-compatible) and the lockfile updated with
  `npm install --package-lock-only` (the shared `node_modules` was not touched). `npm audit --omit=dev` now reports **0**
  vulnerabilities (was 2 moderate: uuid through exceljs). The xlsx export and import tests (6 files, 212 tests) pass with
  uuid 11.1.1 loaded through a test-only resolve hook, and an exceljs workbook with a data-bar conditional format (the only
  exceljs code that calls `uuid.v4`) round-trips.
- **Remaining dev advisories** (not gated by `--omit=dev`, listed in SECURITY.md): 5 high (braces, micromatch, fast-glob,
  @next/eslint-plugin-next, eslint-config-next — fixed by a Next.js bump) and 4 moderate (esbuild chain through drizzle-kit).
- **Stays en_cours**: the files act only on `main` (R-001); the owner turns on Dependabot alerts and security updates; the
  external penetration test waits for the beta host and a provider.

### R-175 — antivirus on uploads (buildable; platform default, owner to confirm)

- **Scanner** (`src/server/storage/scan.ts`): `clamdScan` over `node:net` (TCP or unix socket), `zINSTREAM` with 64 KB chunks
  and 4-byte big-endian lengths, NUL-terminated replies parsed by the pure `parseClamdReply` (`src/domain/file-scan.ts`):
  `stream: OK` → clean, `stream: <sig> FOUND` → infected, anything else (including `INSTREAM size limit exceeded. ERROR`, a reset
  or EPIPE while writing, a silent close, an unexpected reply) → unavailable. Connect timeout 5 s, scan timeout 30 s.
  `clamdPing` (zPING / PONG) for the health report.
- **`scanUpload`** returns the bytes as **one `Uint8Array` marked in a WeakMap** (`src/server/storage/scan-mark.ts`); `storeFile`
  reads the mark, records `scan_status` / `scanned_at`, and **refuses unmarked bytes while scanning is on** (a new upload path
  that forgot the scan stores nothing). An ArrayBuffer is normalised once by `scanUpload`, so the copy `storeFile` would make
  never loses the mark. `storeUploadedFile` (unused, an unscanned path) removed.
- **Called before the transaction** in `attachTaskFile` (`dal/task-files.ts`), `addPhoto` (`dal/photos.ts`, the scan call only),
  `importTranscript` (`dal/meetings-transcripts.ts`, uploaded files only — a pasted text is not a file) and `startImport`
  (`interchange/jobs.ts`). Rights are checked before (route gates, Server Function gates, import refusal): a refused viewer's file
  never reaches clamd nor the quarantine (tested for every persona).
- **Outcomes**: `FileRejectedError` (moved to `src/server/storage/file-errors.ts`, re-exported by `files.ts`) gains `infected`
  and `scan_unavailable`; `uploadRefusalStatus` maps them to **422** and **503** in the task and photo upload routes (only the
  error mapping changed in the photo route); the import route and `importTranscriptAction` already surface the message.
  Generic messages, never the signature: "The file was refused by the antivirus", "The antivirus check is unavailable, try
  again later" (French in `src/i18n/extra/d8-platform-ops.json`). Infected → quarantine copy + `.json` note under
  `<data dir>/quarantine` (outside the files folder; `0700` / `0600`), a warning log line with the signature, an audit entry
  (area `Files`, "upload refused by the antivirus: <name>"). Unavailable → an error log line IT can alert on.
- **Schema** (`stored_files`): `scan_status` (default `'unscanned'`), `scanned_at`, `scan_signature` — one generated migration.
- **Blocked files**: `readStoredFile`, `readStoredText`, `streamStoredFile` (and `getTaskFile`, `readPhoto`) return
  `{ blocked: true, meta }` for an `infected` file — never its bytes; the task-file, photo and transcript download routes answer
  **410** "This file was blocked by the antivirus"; the import `fileOf` refuses to parse it.
- **Daily job `files-rescan`** (`src/server/storage/rescan.ts`): purges quarantine copies of uploads refused more than 30 days
  ago; with scanning on, rescans (pure `filesToRescan`, max 2 000 a run) never-scanned files first, then flagged ones, then those
  of the last 30 days. Newly flagged → `infected` (blocked), a quarantine note (no copy: the bytes stay in `files/`), warning log,
  audit "file blocked by the antivirus: <name>" by "Keystone antivirus" — **kept until IT acts**. A flagged file clamd now
  passes (IT allowed the signature) is released (audited). clamd down → the run stops, warning. Scanning off → reads nothing.
- **Configuration**: `KEYSTONE_FILE_SCAN` (`clamav` | `off`), `CLAMAV_HOST` + `CLAMAV_PORT` (**no default port**: 3310 is the
  Mac smoke-test port) or `CLAMAV_SOCKET` (absolute path). Production with `KEYSTONE_SEED=production` → error unless set
  explicitly; other production runs → warning; off in development and tests; clamd settings without `clamav` → warning;
  messages never print values. `parse.test.ts:135-136` now expects `['KEYSTONE_AUTH', 'KEYSTONE_FILE_SCAN']` (R-175 comment);
  three other production expectations set `KEYSTONE_FILE_SCAN: 'off'` explicitly; `startup.test.ts` lists the new warning.
- **Health** (optional item, done): with scanning on, `/api/health` adds `checks.fileScan: ok | unavailable` (clamd PING, 2 s)
  **without changing the status** (an antivirus outage must not make the platform restart a working server) and logs an error
  when clamd does not answer.
- **Runbook for IT** (`docs/EXPLOITATION.md` § 14): StreamMaxLength ≥ 21M, MaxFileSize / MaxScanSize, AlertExceedsMax yes,
  AlertEncrypted left to IT, OLE2 macro heuristics off, freshclam, the clamd sidecar (compose profile `antivirus`), never on the
  Mac or port 3310, the false-positive procedure (allow in clamd, rerun `files-rescan`).
- **E2E**: kept with scanning off — `tests/e2e/run.ts` now blanks `KEYSTONE_FILE_SCAN` and `KEYSTONE_BACKUP_DIR` whatever the shell
  sets.

### R-177 — documentation (partly buildable)

French Markdown only, no help page or link in the app:

- **`docs/EXPLOITATION.md`** — the single runbook: prerequisites, build and start (with and without a container, single-container
  PGlite variant), every `.env.example` variable by group, database and seed, upgrades (backup → build → migrate → restart →
  health), Entra app registration (redirect `https://<host>/api/auth/callback`, app roles incl. `Keystone.Finance` of R-044),
  **"Premiers utilisateurs"** stating openly that a production-seeded base has no person and no supported way to add one (only a
  demo-seeded beta can be signed into), jobs, health and logs (lines to alert on), connectors file and check script, sibling URLs
  and keys, data directory, Coolify (R-003), backups / restore / quarterly drill (R-004), antivirus for IT (R-175), and a table of
  placeholders "à compléter après I-1a" (production target, off-site copy, object storage R-005, alerting, sizing, support
  contact, training, beta calendar).
- **`docs/guide/`**: `README.md` (getting started, rights rules common to every role — named team R-041, project creation P-3,
  hourly rates, supplier prices NEW-D2-1, minutes P-9b, plan P-9a, department heads P-8a —, what stays in Vigie / Cursus / Codex,
  beta limits, glossary), one guide per internal role (`directeur.md`, `chef-de-projet.md`, `chef-de-service.md`,
  `membre-equipe.md`, `responsable-ingenierie.md`, `qualite.md`, `achats.md`) built from `src/config/role-screens.ts` and the
  current behaviour, a short `finance.md` (R-044, entirely « à vérifier après intégration »), and `recette-beta.md` (scenarios per
  role with steps and expected results from `tests/e2e/01–08` and spec 00 §5.3 / §8.14 on the demo data set, plus a feedback
  template). Journeys other delivery-8 lots change are marked « à vérifier après intégration » (R-069, R-080, R-081, R-077, R-140,
  R-095, R-034, R-102, R-104, R-108, R-109, R-111, R-116, R-117, R-057, R-118, R-119, R-122, R-096, R-031, R-087, R-088, R-089,
  R-090, R-149, R-150, R-152, R-067, R-044, R-139). Owner-pending parts (purchasing procedure, RACI, Friday freeze, Finance rate
  role) are not described.
- **`README.md`**: links to the guides, the runbook and SECURITY.md; a French deployment section.
- **Stays en_cours**: training, support channel, beta calendar and the I-1a sections are placeholders; screenshots deferred
  until the beta build is frozen; the guides need a pass once delivery 8 is integrated.

## 2. Rules and defaults chosen (owner / IT to confirm)

| Point | Default | Why |
|---|---|---|
| Backup interval | 10 min on a 5-min tick (`KEYSTONE_BACKUP_EVERY_MIN`, 5–1440) | RPO ≤ 15 min (I-1b) with the run time and the tick |
| Retention | 48h,30d,12m (newest per UTC day / month) | plan §2; ~288 snapshots in 48 h — size the volume |
| Stale alert | error log line after 30 min (or 2 × interval) | no mail relay (R-036) |
| Backups in the Coolify kit | ON (`KEYSTONE_BACKUP_DIR=/backups` on the worker, volume `keystone-backups`) | the kit deploys PostgreSQL; the volume must be replicated off-site (I-1a) |
| Restore | empty target only, never over data | RTO procedure without risk to the live base |
| Antivirus | ClamAV, fail-closed (422 / 503), explicit with the production seed | platform default like R-008 |
| Quarantine | refused uploads 30 days; flagged stored files kept, blocked (410) until IT acts | a false positive must not destroy a business record |
| Rescan | daily: never scanned, flagged, last 30 days; max 2 000 files a run | new signatures; bounded run |
| Health | `fileScan` line only with clamav on; status unchanged | avoid restart loops on a clamd outage |
| Dependency gate | high/critical production advisories; weekly schedule only for the audit workflow | Actions minutes; dev highs tracked in SECURITY.md |
| Update policy | high/critical in 7 days; monthly minor updates; Next.js patches followed | default to confirm |
| Documentation | French Markdown under `docs/`, no in-app help | no new tools |

## 3. Displayed values, old → new (demo seed)

None on any screen. Behaviour changes, all off by default:

| Where | Before | Now | Decision |
|---|---|---|---|
| Production start (`NODE_ENV=production`) without `KEYSTONE_FILE_SCAN` | — | warning "KEYSTONE_FILE_SCAN is not set: uploaded files are not checked by an antivirus…"; **error** with `KEYSTONE_SEED=production` | R-175 default |
| Upload with `KEYSTONE_FILE_SCAN=clamav` | stored | infected → 422 « Le fichier a été refusé par l’antivirus » ; clamd down → 503 « Le contrôle antivirus est indisponible, réessayez plus tard » | R-175 |
| Download of a flagged file | 200 | 410 « Ce fichier a été bloqué par l’antivirus » | R-175 |
| `/api/health` with clamav on | `checks.database` | + `checks.fileScan` | R-175 |
| Job list | 5 jobs | + `backup` (5-min tick) and `files-rescan` (daily); both do nothing while their feature is off | R-004, R-175 |

Tests updated with a decision comment: `src/domain/jobs.test.ts` (two jobs added), `src/server/config/parse.test.ts` (R-175),
`src/server/startup.test.ts` (R-175 warning), `src/server/storage/files.test.ts` (`storeUploadedFile` removed, `{ blocked }`
narrowing), `src/server/dal/chapter4-foundation.test.ts` and `src/server/dal/meetings-transcripts.test.ts` (`{ blocked }`
narrowing only).

## 4. Migration

`drizzle/0016_faulty_electro.sql` (generated by `npm run db:generate`): `stored_files.scan_status text not null default
'unscanned'`, `scanned_at timestamptz`, `scan_signature text`. No custom SQL. The integrator regenerates it in merge order (it is
independent of the other lots' tables).

## 5. Checks

- `npm run typecheck` clean; eslint clean on every touched file.
- New test files (all passing): `src/domain/backup.test.ts` (10), `src/domain/file-scan.test.ts` (5),
  `src/server/config/parse-platform-ops.test.ts` (9), `src/server/storage/scan.test.ts` (11, fake clamd on a random port —
  never 3310 — and on a unix socket: OK, FOUND with the EICAR string built at run time, ERROR, size limit while writing,
  timeout, reset, silent close, PING), `src/server/storage/antivirus-jobs.test.ts` (7: import upload, rescan job, release, clamd
  down, runner and lease, quarantine purge, health), `src/features/mywork/task-files-antivirus.test.ts` (3, every persona),
  `src/features/photos/photos-antivirus.test.ts` (2, every persona), `src/features/meetings/transcript-antivirus.test.ts` (2,
  every persona), `src/server/backup/backup.test.ts` (14 + 1 opt-in: PGlite round trip with identical DAL reads and file hashes,
  missing / mismatch, refusals, older snapshot → pending migration, retention + garbage collection, lock, job, command lines).
  Persona loops iterate `PERSONAS` (a 9th persona with R-044 is covered).
- The PostgreSQL variant of the backup test (`KEYSTONE_TEST_DATABASE_URL`) was **not run**: the sandbox refuses to start a
  private server (no `runuser`); the delivery-7 parity test pattern is reused, and the PGlite path is fully exercised.
- uuid 11.1.1: see R-174. `npm audit --omit=dev --audit-level=high --package-lock-only`: 0 vulnerabilities.
- `docker compose -f deploy/compose.yaml config` (with `exclude_from_hc` removed) validates; the image itself was not built (no
  Docker daemon) — the CI `image` job builds and starts it.
- `npm run lint` clean; `npm run db:generate` → "No schema changes"; `scripts/db-check.ts` → "All checks passed".
- Full `npx vitest run` (beside another lot on 4 shared CPUs): 276 files, 3 382 tests — 7 failed, **all "Test timed out"**
  (`src/server/dal/shell.test.ts` ×4, `home.test.ts` ×1, `src/features/meetings/meetings.golden.test.ts` ×1, and this lot's
  `backup.test.ts` ×1, since given load-tolerant timeouts). Re-run alone they pass, except
  `meetings.golden.test.ts › MTG-119 transcript analysed…`, which sits at the 5 s default timeout **on the base commit too**
  (4.88 s on `e41c309` vs 4.97 s here, same machine, same load) — pre-existing, not caused by this lot; the integrator may
  give it a longer timeout.

## 6. For the integrator

- **Shared files touched** (each in its own place):
  - `src/domain/jobs.ts` and `src/server/jobs/definitions.ts`: only under the `platform-ops` markers (`backup`, `files-rescan`;
    the run functions import their modules dynamically so no import line moves). `src/domain/jobs.test.ts` line 12–16: the
    connectors and docs-client-portfolio lots also add jobs to this expected list — merge the rows.
  - `src/server/config/parse.ts`: backup variables after `KEYSTONE_DATA_DIR` in `VARS`; antivirus variables after them; the
    backup rule after the database block, the antivirus rule **after the Entra block** (so production warnings append at the
    end). `parse.test.ts:135-136` changed. The connectors lot adds `CURSUS_EVENTS_KEY` / `CURSUS_DIRECTORY` and the AI/DPA
    warning: adjacent but separate hunks. `KeystoneConfig` gains `backup` and `fileScan`.
  - `.env.example`: two new blocks after the data directory; the connectors lot edits the Cursus and Anthropic blocks.
  - `src/server/config/index.ts`: two type re-exports.
  - `src/app/api/photos/route.ts` (error mapping) and `src/app/api/photos/[id]/route.ts` (410 line): the site-quality lot changes
    the photo gate in the same files — different statements.
  - `src/server/dal/photos.ts`: only `addPhoto`'s first lines (scan call).
  - `src/server/health.ts` (+ `fileScan`); `scripts/worker.ts` (lock moved to `src/server/db/pglite-lock.ts`); `tests/e2e/run.ts`
    (two env lines); `.github/workflows/ci.yml` (new job appended); `package.json` (scripts `backup`, `restore`; `overrides`);
    `package-lock.json` (uuid entry only).
  - `README.md`: links and a deployment section (no other lot is listed on it).
- **Merge order**: after audit-i18n-shell. Its `writeAudit` changes (actor user, before/after) keep the signature: the three
  audit calls of this lot (refused upload, file blocked, file released) pass `actorName` / `actorPersonId` only; "Keystone
  antivirus" is a system actor (no user). Audit rows are only inserted, never updated.
- **i18n**: three keys in `d8-platform-ops.json`, no override of an existing key.
- **Integration follow-ups**:
  - after roles-rates-hr (R-044) merges, update `docs/guide/finance.md`, the procurement guide (Contract leaves its menu) and
    the Entra app-role list if the value differs from `Keystone.Finance`;
  - after the connectors lot merges, add its `CURSUS_EVENTS_KEY` / `CURSUS_DIRECTORY` to the compose anchor
    (`deploy/compose.yaml`) and to the runbook variable table;
  - after every lot merges, re-read the « à vérifier après intégration » passages of `docs/guide/*.md` and `recette-beta.md`;
  - suggested progress (the integrator edits `docs/reste-a-developper.json`): **R-175 fait** once integrated and verified;
    **R-003, R-004, R-174, R-177 en_cours** (beta image not yet built by CI on `main`; off-site backups and PITR wait for I-1a;
    Dependabot / audit act only on `main` and the pentest waits for the host; training, support and I-1a sections are
    placeholders).

## 7. Open questions for the owner and IT

| Item | Question | Default built |
|---|---|---|
| R-003 | Close PR #1 in favour of this Compose kit? (changes the Coolify resource type if one was already created) | kit built, PR #1 left open |
| R-003 | Is a large image acceptable (full node_modules with the dev dependencies kept for tsx), or should the worker and scripts be bundled (R-006)? | dev deps kept |
| R-003 / auth | Who signs in first on a production-seeded base (first list of people, or the Cursus directory R-027)? | only a demo-seeded beta can be used |
| R-004 | Interval 10 min, retention 48h,30d,12m, stale alert 30 min — confirm; volume size for ~288 snapshots in 48 h | as listed |
| R-004 | Off-site copy of the backup volume, managed PITR (WAL) in production, quarterly drill owner | à compléter après I-1a |
| R-004 | PGlite backups pause the server's queries for the dump (single-container beta only) — acceptable for the beta? | yes, PostgreSQL for production |
| R-174 | Update deadlines (7 days high/critical, monthly minors) and the vulnerability-report contact | placeholders |
| R-174 | Turn on Dependabot alerts and security updates in the repository settings (owner) | — |
| R-175 | Antivirus at all, fail-closed (an outage blocks every upload), mandatory choice with the production seed | built as the default |
| R-175 | Purge of refused uploads after 30 days; flagged stored files kept until IT acts; automatic release when clamd later passes a flagged file | as listed |
| R-175 | Should the lists (task attachments, photo galleries) show that a file is blocked? Today only the download answers 410 (no new UI state, no-new-tools rule) | download only |
| R-177 | Support contact, training plan, beta calendar and testers | placeholders |
