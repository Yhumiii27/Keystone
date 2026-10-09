@AGENTS.md

# Keystone PM — instructions for Claude sessions

Keystone PM is EPC2i's project and portfolio management tool. It is a Next.js 16 full-stack rebuild of the Claude Design prototype `design/Keystone PM v8.dc.html`. EPC2i's other apps are Codex (documents), Vigie (QHSE) and Cursus (HR, training, timesheets).

## Where the project stands — read this first

- **Deliveries 1–5 are done and committed.** The shell and all 59 prototype screens are built, with prototype mock data (HLT-026, NDC-031…). Each delivery's status, APIs, deviations and open questions are in `docs/DELIVERY-1.md` … `docs/DELIVERY-5.md`.
- **Ignore older status sources.** Any older handoff or README describing "Home ~70 %, Budget ~30 %, other screens under construction" is the prototype's handoff and is obsolete.
- **Work in progress: chapter 4 = delivery 6.** It replaces every simulated function with a real one.
  - The plan, acceptance criteria, per-feature status and remaining gaps are in **`docs/DELIVERY-6-PLAN.md`**. That file is the resume point.
  - When the work is finished, write `docs/DELIVERY-6.md` with the same structure as `DELIVERY-5.md`.
- **Product decisions.**
  - The product owner answered the 195 open questions (the "chapter-5 questionnaire"). See **`docs/DECISIONS.md`** (readable) and `docs/decisions/{questions,answers}.json` (raw).
  - The answers override the spec and the chapter-4 defaults where they differ.
  - Chapter-4 defaults are centralised in `src/domain/ch4-defaults.ts`.
  - Answers marked "À discuter" or "Autre réponse" carry notes. Several wait for data the owner will provide: machine-type standards, purchasing procedure, Sage extracts, the RACI matrix.

## Rules from the product owner

- **Language.** Reply to the user in French. Code, identifiers and commit messages stay in English. UI strings are English source strings translated through `src/i18n`; French is the default language.
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
| Keystone | Deliverables and client PV acceptance, ITP and punch list, site readiness and daily reports, commissioning, lessons learned (REX), installed base and claims, client portal, administration |

- **Connectors.** Each connector lives in `src/server/integrations/<app>/`. It has a read-only mirror, an outbox ("pending sync"), deep links, and a mock until the real API exists.

## Conventions

- **Must read first:** `docs/ARCHITECTURE.md`, then the spec in `docs/spec/`: 00 overview and open questions §10, 01–10 by module, 11 data model, 12 coverage.
- **Routing:** `src/config/screens.ts` holds the 59 screens. Use `screenHref`, `canSee` and `ROLE_SCREENS`.
- **Personas:** the "View as" cookie (`ks-role`) stands in for authentication.
- **Data access:**
  - DAL in `src/server/dal/`, Drizzle schema in `src/server/db/schema/`.
  - Migrations in `drizzle/`: generate a new one with `npm run db:generate` and never edit an existing one.
  - The PGlite database is seeded from the prototype constants (`src/server/prototype/*.json`).
- **Pure logic:** lives in `src/domain/`. Golden tests compare it with the prototype's own logic (`scripts/proto-golden-*.ts`). If a deliberate change alters a displayed value, update the test with a comment citing the decision id (for example "A-13").
- **UI:**
  - Nocturne design system: `src/styles/nocturne.css`, `src/components/ds`, `src/components/app`, CSS Modules.
  - Phosphor icons come from `@phosphor-icons/react/dist/ssr`.
- **Server Functions:** each one validates input and permission server-side (role, project ownership, read-only and outside-workspace rules), writes through DAL writers, records audit and activity, then calls `revalidatePath`.

## Setup and checks in a fresh clone

```bash
npm ci
npx next typegen      # generates .next/types (LayoutProps/PageProps); next-env.d.ts is gitignored
npm run typecheck && npm run lint && npm test
npm run dev           # http://localhost:3000 — PGlite DB created and seeded in ./.data
```

- **Production build:** `npm run build`. To keep the regular `.next` untouched, build with `KEYSTONE_DIST_DIR=.next-ci` and point `KEYSTONE_DATA_DIR` at a temporary directory.
- **Meeting analysis by Claude:** only active when `ANTHROPIC_API_KEY` is set. Otherwise a local rule-based analyser runs.
- **On the user's Mac only:**
  - Port 3000 is Keystone (dev server or the `Keystone.app` desktop app, `npm run app`).
  - Codex uses 3100/3110, Vigie 3200, and Cursus 3210/3217/5173. Never use or kill these ports.
  - Smoke tests use port 3310.
