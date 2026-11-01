@AGENTS.md

# Keystone PM — instructions for Claude sessions

Keystone PM is EPC2i's project and portfolio management tool. It is a Next.js 16 full-stack rebuild of the Claude Design prototype `design/Keystone PM v8.dc.html`. EPC2i's other apps are Codex (documents), Vigie (QHSE) and Cursus (HR, training, timesheets).

## Where the project stands — read this first

- **Deliveries 1–8 are done and committed.** The shell and all 59 prototype screens are built, with prototype mock data (HLT-026, NDC-031…). Each delivery's status, APIs, deviations and open questions are in `docs/DELIVERY-1.md` … `docs/DELIVERY-8.md`.
- **Ignore older status sources.** Any older handoff or README describing "Home ~70 %, Budget ~30 %, other screens under construction" is the prototype's handoff and is obsolete.
- **Chapter 4 = delivery 6 is done** (`docs/DELIVERY-6.md`): every simulated function is real when Keystone can do it with its own data, and the owner's answers that touch it are applied. `docs/DELIVERY-6-PLAN.md` is the historical plan and audit; the open questions are in `DELIVERY-6.md` §8.
- **Delivery 7 is done** (`docs/DELIVERY-7.md`): production platform (PostgreSQL, production seed, configuration, logs and health, HTTP hardening, job worker, CI and end-to-end tests), Microsoft Entra ID sign-in with real users, rights by named project team, and the owner's answers on cost control, contract and portfolio, operations, quality and site, plus the prototype's technical debt. `docs/DELIVERY-7-PLAN.md` is the plan; each lot's notes are in `docs/delivery-7/`; the open questions are in `DELIVERY-7.md` §8.
- **Delivery 8 is done** (`docs/DELIVERY-8.md`): append-only audit trail and French completeness guard, operations kit (container, backups, antivirus, runbook `docs/EXPLOITATION.md`, role guides `docs/guide/`), the Finance role (9th persona) and the dated rate grid, the sequential change-request chain, purchasing and engineering items, the Keystone side of the Vigie / Cursus / Codex connectors (Cursus events endpoint), client documents and portfolio views, work and meeting notices, one punch list per project and the site sheet. `docs/DELIVERY-8-PLAN.md` is the plan (§4: items left out and why); each lot's notes are in `docs/delivery-8/`; the open questions are in `DELIVERY-8.md` §8.
- **Delivery 9 has started.** Lot "clock" (R-013) is done (`docs/delivery-9/notes-clock.md`): one business clock — `businessToday()` / `businessNow()` (`src/server/clock.ts`), pure rules take `today` as a required parameter (`src/domain/clock.ts`), Client Components use `useToday()` (`src/components/app/clock.tsx`). Never reintroduce a frozen date or a date default; seeds and golden tests use `DEMO_TODAY_ISO` / `isoOfDemoDate`. `KEYSTONE_CLOCK` unset = the real date on every database (owner, 17 Oct 2026); the tests pin Fri 25 Sep 2026 (`vitest.config.ts`, `tests/e2e/run.ts`, `scripts/db-check.ts`).
  - Next: read `docs/RESTE-A-DEVELOPPER.md` (what is left; data with code evidence in `docs/reste-a-developper.json`), `docs/DECISIONS.md` § "À traiter en priorité" and `DELIVERY-8.md` §8 before planning the next lots of delivery 9 (R-013 is done; R-121 and R-085 are now unblocked; R-060 waits for S-4).
- **Remaining-work page — keep it current (user's standing rule).** After every development (a delivery started, a lot merged, an item finished), update `docs/reste-a-developper.json`: each item's `progress` (`{ state: 'a_faire' | 'en_cours' | 'fait', delivery, note }`), a line in `history`, and `updated`. Then run `npm run remaining:page` (regenerates `docs/RESTE-A-DEVELOPPER.md` and `.artifacts/reste-a-developper.html`), commit, and republish the HTML with the Artifact tool to the same page, https://claude.ai/artifact/NmH1NN5BjedvgHRjKaPpGc (pass it as `url`). Mark an item "fait" only once it is integrated and verified on the branch.
- **Product decisions.**
  - The product owner answered the 195 open questions (the "chapter-5 questionnaire"). See **`docs/DECISIONS.md`** (readable) and `docs/decisions/{questions,answers}.json` (raw).
  - The answers override the spec and the chapter-4 defaults where they differ.
  - Chapter-4 defaults are centralised in `src/domain/ch4-defaults.ts`.
  - Answers marked "À discuter" or "Autre réponse" carry notes. Several wait for data the owner will provide: machine-type standards, purchasing procedure, Sage extracts, the RACI matrix.
- **Multi-equipment projects (owner's note, 15 Oct 2026; R-185, `docs/BACKLOG.md` §1 ter).** A project can supply several machines of different types and quantities (e.g. one EMP and several MEMU). Today a project has one machine type (creation template, ITP plan, reference budget). Frame the project approach with the owner before building it, and do not add new features that assume one machine type per project.

- **CAPEX application (owner, 22 Oct 2026; `docs/dig-prodi/`).** The subsidiaries' plant CAPEX (DIG-PRODI method: 4 phases, gates G1/G2/G3, living dossiers) is a separate sibling app, not Keystone. Data are shared through the EPC2I PostgreSQL server (one schema per tool, `pub_` views); Keystone owns the machine catalogue, the answers to machine needs and the EPC2i projects, and publishes progress views for the CAPEX app. Keystone-side work: R-185 to R-194 (`docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md`). Do not build CAPEX-level features (subsidiary profiles, DIG-PRODI gates) in Keystone.

## Rules from the product owner

- **Language.** Reply to the user in French. Code, identifiers and commit messages stay in English. UI strings are English source strings translated through `src/i18n`; French is the default language.
- **Merging into `main` (owner, 17 Oct 2026: « l’outil est une immense bêta, on fusionne tout »).** Every verified lot goes to `main`: push it on the working branch, open a PR, and merge it once CI is green.
- **No new tools without approval.** Build nothing that is absent from the prototype until the user has validated it. `docs/BACKLOG.md` lists:
  - the requested "Expédition & transport" module, whose scope must be refined with the user first;
  - the Cursus timesheet link;
  - proposals P1–P8, still awaiting validation.
- **System boundaries.** Keystone shows the other apps' records, opens them in their own app through deep links, and records progress through a connector outbox. Creation and full management stay in the owning app. Never modify the sibling projects.

| Owner | What it owns |
|---|---|
| Vigie | ECOs, project NCRs (8D, action plans), site HSE |
| Cursus | People's site clearances and Go/No-Go; timesheets (hours are no longer in Lucca) |
| Codex | Documents (Keystone keeps the index and links) |
| CAPEX app (name to choose) | Subsidiaries' CAPEX, DIG-PRODI phases and gates, living dossiers, machine needs (demand side), ramp-up |
| Keystone | Deliverables and client PV acceptance, ITP and punch list, site readiness and daily reports, commissioning, lessons learned (REX), installed base and claims, client portal, administration |

- **Cross-repo rules (owner, 22 Oct 2026).** This chat owns `Yhumiii27/Keystone` only; Matrix, Cursus, Arche, Crucible, Vigie, Codex are read-only sources. Other apps file requests to Keystone in `REQUESTS.md` (repo root): at the start of each session read it and report the OPEN entries to the owner; handle them only after the owner's approval. The only write allowed elsewhere is a new entry in another repo's `REQUESTS.md` (or the status of an entry Keystone created), and only after presenting a detailed note (target repo, exact request, why, what happens without it) and getting the owner's explicit « validé ».
- **Connectors.** Each connector lives in `src/server/integrations/<app>/`. It has a read-only mirror, an outbox ("pending sync"), deep links, and a mock until the real API exists.

## Conventions

- **Must read first:** `docs/ARCHITECTURE.md`, then the spec in `docs/spec/`: 00 overview and open questions §10, 01–10 by module, 11 data model, 12 coverage.
- **Routing:** `src/config/screens.ts` holds the 61 screens (Shipments, R-158, is the 61st). Use `screenHref`, `canSee` and `ROLE_SCREENS`. The registry imports no component (icons are in `src/config/screen-icons.ts`) so server code and `tsx` scripts can load it; server rules take `canSee` from `src/config/role-screens.ts`.
- **Viewer:** `getViewer()` (`src/server/session.ts`). `KEYSTONE_AUTH=demo` (default, tests and development): the "View as" cookie (`ks-role`) picks a persona. `KEYSTONE_AUTH=entra`: Microsoft Entra ID sign-in (R-038), the user's roles and person from the database; `ks-role` is ignored.
- **Project rights (R-041):** `getProjectContext` / `projectAccessResolver` (`src/server/project-context.ts`) over `projectAccess` (`src/domain/rights.ts`): `isLead` for PM rights (PM of record, co-PM, deputy, director), `isMine` for team members; a client is sent home outside their workspace (`refuseClient`).
- **Typed text (R-148):** what people typed (names, titles, notes) is shown with `dataText` / `projectLabelText` / `fieldsText` (`src/i18n/data-text.ts`), never through `t()`, which is for Keystone's own vocabulary.
- **French completeness (R-184):** every new `t()` literal needs a French entry that differs from the English, a FR rule, or a reviewed place on `src/i18n/same-in-french.json` (`src/i18n/completeness.test.ts`); one French translation per key across the dictionaries (`src/i18n/extra/dictionaries.test.ts` lists the deliberate overrides).
- **Audit trail (R-168):** `audit_entries` is append-only (database trigger) — never update or delete audit rows, in code or tests; date a test row with `writeAudit({ occurredAt })`.
- **Personas:** ten, Finance (R-044) and Logistics (R-158: edits the Shipments of every project, reads the BOM, Site, Schedule and Deliveries) included; persona tests loop over `PERSONAS` (`src/config/personas.ts`).
- **Data access:**
  - DAL in `src/server/dal/`, Drizzle schema in `src/server/db/schema/`.
  - Migrations in `drizzle/`: generate a new one with `npm run db:generate` and never edit an existing one.
  - PostgreSQL (shared EPC2I server, owner 18 Oct 2026): tables, `pub_` views and journal in schema `keystone` (role `keystone_app`); schema files keep `pgTable`, the server migrator (`applyServerMigrations`, `src/server/db/migrations.ts`) rewrites `"public".` → `"keystone".` and every connection sets `search_path=keystone`; server transactions take the write lock `hashtext('keystone.ecritures')`. PGlite stays in `public`. Write raw SQL and views unqualified. `pub_` views (`drizzle/0035_share.sql`) are contracts: never drop or rename a column they read (recreate the view first).
  - The PGlite database is seeded from the prototype constants (`src/server/prototype/*.json`).
- **Pure logic:** lives in `src/domain/`. Golden tests compare it with the prototype's own logic (`scripts/proto-golden-*.ts`). If a deliberate change alters a displayed value, update the test with a comment citing the decision id (for example "A-13").
- **UI:**
  - Nocturne design system: `src/styles/nocturne.css`, `src/components/ds`, `src/components/app`, CSS Modules.
  - Phosphor icons come from `@phosphor-icons/react/dist/ssr`.
- **Server Functions:** each one validates input and permission server-side (role, project ownership, read-only and outside-workspace rules), writes through DAL writers, records audit and activity, then calls `revalidatePath`. A `'use server'` file exports async functions only (`src/server/use-server-exports.test.ts`).

## Setup and checks in a fresh clone

```bash
npm ci
npx next typegen      # generates .next/types (LayoutProps/PageProps); next-env.d.ts is gitignored
npm run typecheck && npm run lint && npm test
npm run dev           # http://localhost:3000 — PGlite DB created and seeded in ./.data
npm run test:e2e      # Playwright on a production build (.next-ci), free port, fresh data directory
```

- **Configuration:** every environment variable is in `.env.example`, validated by `src/server/config/parse.ts` (R-007). PostgreSQL with `DATABASE_URL` (`npm run db:migrate` at deploy), else PGlite; `KEYSTONE_SEED=production` for reference data only; scheduled jobs with `npm run worker` or `KEYSTONE_JOBS=inprocess`.

- **CI and Actions minutes (owner, 22 Oct 2026):** a change to documentation only (`docs/`, `design/`, `.artifacts/`, Markdown; `docs/EXPLOITATION.md` excepted) runs no CI; a push to `main` runs the fast checks only (typecheck, lint, unit tests); pull requests and "Run workflow" run everything. The dependency audit runs when `package.json` / `package-lock.json` change and weekly. Keep it so: the private repository's Actions minutes are counted.
- **Production build:** `npm run build`. To keep the regular `.next` untouched, build with `KEYSTONE_DIST_DIR=.next-ci` and point `KEYSTONE_DATA_DIR` at a temporary directory.
- **Meeting analysis by Claude:** only active when `ANTHROPIC_API_KEY` is set. Otherwise a local rule-based analyser runs.
- **On the user's Mac only:**
  - Port 3000 is Keystone (dev server or the `Keystone.app` desktop app, `npm run app`).
  - Codex uses 3100/3110, Vigie 3200, and Cursus 3210/3217/5173. Never use or kill these ports.
  - Smoke tests use port 3310.
