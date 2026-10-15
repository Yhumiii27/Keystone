# Delivery 8 — lot "roles-rates-hr" (notes)

Items: R-044 Finance role, R-139 "View as client" entry, R-083 dated rate grid and one valuation of hours, R-178 production
reference multipliers, R-086 portfolio labour cost by zone, R-087 one skill scale and two indicators, R-088 adjustable
hours-variance threshold. Owner decisions applied: P-4, P-11 (a), P-12 (c), C-9, A-10, R-2 (a), R-4a, R-4b, R-5a, R-5b, R-6b,
A-3, A-14, A-15 (`docs/DECISIONS.md`), with the defaults of `docs/DELIVERY-8-PLAN.md` §2.

Built: every item as scoped by the brief, except the parts that need the owner or another system (§6). R-044, R-139, R-083 and
R-178 stay partly open by design; R-086, R-087 and R-088 are complete.

Migrations (in this order — see §4): `drizzle/0016_tense_guardian.sql` (generated), `drizzle/0017_rate_versions_backfill.sql`
(custom, `drizzle-kit generate --custom --name rate_versions_backfill`), `drizzle/0018_wild_dark_phoenix.sql` (generated).

Where the brief and the code disagreed, the code was followed:

- The brief places Léa Marchand on the NDC-031 and ERP-202 teams only; the seed also has her on **HLT-026's** team. Tests use
  RCF-019 for "a project whose team Finance is not on".
- `ROLE_PRIORITY` / `ROLE_LABEL` live in `src/domain/auth.ts`, not in `src/config/screens.ts` (only `RoleKey` is there).
- The FR strings go to `src/i18n/extra/d8-roles-rates-hr.json` (the brief's item scope mentions a `d8-finance.json`, which does
  not exist; the lot file is pre-registered).
- `HOURS_VARIANCE_DEFAULT` and its bounds are a domain rule (`src/domain/hr.ts`); only the app_settings key
  `APP_SETTING_HOURS_VARIANCE` sits in `src/server/db/codes.ts`, next to `APP_SETTING_HEALTH`.

## 1. Changes per item

### R-044 — Finance role (P-4, P-12 c, C-9)

- **Role plumbing.** `'finance'` in `RoleKey` (`src/config/screens.ts`), `ROLE_PRIORITY` after procurement and before the team
  member, `ROLE_LABEL.finance = 'Finance'` (`src/domain/auth.ts`). The Entra app role `finance` / `Keystone.Finance` and an
  `ENTRA_GROUP_ROLES` mapping to `"finance"` are accepted by `isRoleKey` / `roleOfAppRole`; `.env.example` lists the role values
  and tells IT to create the app role.
- **Persona.** Léa Marchand, "Cost controller", Controls & planning, `lea.marchand@epc2i.fr` (`src/config/personas.ts`, 9
  personas). Her demo user is created apart from the prototype's PERSONAS loop by `seedFinanceUser` (`src/server/db/seed/users.ts`,
  called by `seedOrganisation`), and once on a demo database seeded before delivery 8 under the roles-rates-hr marker of
  `seedIfEmpty` (`financeUserToBackfill`). Idempotent; never creates a second user for a person who already has one (a real
  Entra account). `users.role` is text: no migration.
- **Workspace** (`src/config/role-screens.ts`): home, my projects, documents, overview, cash flow, contract, billing, budget,
  hours, rates, plan (own activities' % only, P-9a), my work / task, leave, meetings. No Prioritisation (scoring and weights
  undecided for Finance), no My approvals. Home = the director's (default branch of `getHomeView`).
- **Contract (P-4).** `canEditContract(role, access)` (`src/domain/rights.ts`) = the director, Finance on every project, or a
  lead of the project (PM of record, co-PM, deputy) whose workspace has the Contract — a member-role deputy gets no editing.
  Used by `getProjectContext().canEdit('contract')` (every contract Server Function goes through it) and by `PageHeader`
  (primary and "Read-only" tag). Procurement loses the Contract screen.
- **Read-only on Budget, Hours and Billing** even on its teams: `financeReadOnly` in `getProjectContext().canEdit`, in
  `PageHeader` and in the DAL guard `editsProjectScreen` (`src/server/dal/team-guard.ts`). The billing gate is otherwise
  unchanged (director and PM-role team members).
- **Rates (P-12 c).** `canSeeRates` = director, PMs, Finance (rate card, task cost note, exports — `run.ts` follows);
  `canEditRates` = director, Finance (rate card inputs, "Add role", the three rate Server Functions, and the DAL writers, which
  now take an `Actor` and re-check the role). New refusal "Rates are edited by the portfolio director and Finance"; new banner and
  "Visibility" wording.
- **Budget rate (C-9, default).** `canSetBudgetRate` = director, Finance: `setBudgetRateAction`, `contract/page.tsx` `canSetRate`,
  and the DAL re-check in `setProjectBudgetRate` (`BUDGET_RATE_REFUSED` "Only the portfolio director and Finance set the budget
  rate").
- **Margins (default).** Finance added to `MARGIN_ROLES` (`src/domain/portfolio-finance.ts`): Cash flow, Prioritisation (read),
  the status report and the exports are not masked for Finance. Supplier prices unchanged (director, PMs, procurement — NEW-D2-1).
- Finance has no My approvals kind and no notification audience (counts 0 in the shell tests).

### R-139 — "View as client" (P-11 a)

- `canPreviewClientView(role, access)` (`src/domain/rights.ts`) = not the client, and the director or a lead of the project.
- `PageHeader`: a secondary "View as client" link (Phosphor `Eye`) before Export on every project screen but the portal, linking
  to `/projects/<code>/client`. On tablets (≤ 1024 px) the label is hidden and the icon keeps `title` / `aria-label` (R-146).
- On the portal, for the director and the project's leads, the banner "Client view · preview · read-only" with "Back to project"
  (the project's Plan) replaces the generic outside banner. The PM stays `outside` there: no primary, no edits; deciding and
  acknowledging stay the client's; the director keeps "Raise issue" (open question). Other internal roles keep today's
  read-only outside view (P-1 = a): no redirect, export and route matrix unchanged. The banner is rendered by `PageHeader`
  (it owns the banner styles); `client/page.tsx` only documents it.

### R-083 — dated rate grid and one valuation of hours (A-10, R-4a, R-4b)

- **Schema** (`src/server/db/schema/resources.ts`, `organisation.ts`): `rate_role_rates` (rate role, effective_from, base €/h,
  created by; unique role + date) and `rate_multiplier_rates` (key, effective_from, factor, created by; unique key + date).
  `rate_roles` keeps the identity (role, external flag, cost centre, grade as information); its `base_rate_eur` and
  `effective_from` and `rate_multipliers.factor` are dropped — the versions are the single source. `persons.rate_role_id`
  (FK, `on delete set null`). `job_title_rates` is dropped (with `getJobTitleRates`).
- **Rules** (`src/domain/hr.ts`): `versionAt`, `rateAt(grid, role, date)`, `multiplierAt(grid, key, date)`, `gridOn`,
  `parseEffectiveDate` (real ISO day 2000–2099), `rateChangeText`, `taskLaborCost`, `liveTaskCost`. DAL reader `getRateGrid()`
  (memoised per request) / `readRateGrid(q)` and `getRateCard(on)` (`src/server/dal/hr.ts`).
- **Consumers.**
  - Hours KPI: Σ per line (declared − planned) × the person's role rate on the import's `period_start`; lines without a rate are
    left out and counted ("N lines not valued"). `HOURS_VALUATION_RATE` (62 €/h) is removed. The cost is masked ("•••") for the
    roles that do not see rates (R-046 — a new masking: the flat rate revealed nothing, the grid does).
  - Task cost note and the task export: each time entry at the rate of the person who logged it on the entry's date; logged
    hours without an entry at the assignee's rate in force today; "rate missing" when an hour has no rate. One "€/h" is shown only
    when every valued hour has the same rate ("7.0 h = €545 actual cost" otherwise). Hours logged while the sheet is open are
    valued at today's rate until the server recomputes. The 100 €/h default is gone.
  - What-if: people and helper colleagues through their grid role at the horizon start (first window week); a crew or a
    subcontractor through the grid role of its name; otherwise the isolated, named placeholder `WHATIF_RULES.unratedFallbackEur`
    (60 €/h, was `defaultRateEur`) so a crew's cost is never dropped; the overtime factor is the `ot` multiplier in force.
  - Site weekend premiums: the `sat` / `sun` factors in force on the business date (only `weekendPremium` changed in
    `src/server/dal/site.ts`).
  - Rate KPIs and the rate-card export: the version in force on the card's date (+ a "Rate history" sheet for the roles that see
    rates).
- **Rate cards screen** (`/resources/rates?on=YYYY-MM-DD`): the grid in force on a date (default the business date STATUS_ISO),
  a date field ("Rates in force on · edits take effect from"), each rate's "since <date>" and its other versions ("70 € from 1 Jan
  2025"), "No rate on this date" before a role's first version. An edit writes the version of the chosen date (updates the
  version of that very date, else adds one; no version when the value is already the one in force). "Add role" has an explicit
  "Effective from" field (default: the date shown). Audit and activity "Planner base: 74 → 78 €/h from 1 Nov 2026", "(backdated)"
  before the business date.
- **Rights**: director and Finance edit, PMs read (R-044).
- **Person → role**: seeded and migrated by exact job title (persons without a matching title — the director, heads of department,
  leads — are "not valued"). No screen sets a person's role (open question).

### R-178 — production reference multipliers (A-10)

- One shared constant `RATE_MULTIPLIER_DEFAULTS` (`src/domain/rate-defaults.ts`): ot "Overtime > 8 h/day" ×1.25, sat "Saturday"
  ×1.5, sun "Sunday / public holiday" ×2, night "Night shift" ×1.3, oncall "On-call" ×0.35 — **placeholders** for the direction
  to confirm — and `RATE_GRID_START` (1 Jan 2026). Equal to the prototype's MULTS (tested).
- `seedRateMultipliers` (`src/server/db/seed/resources.ts`): inserts missing keys with `onConflictDoNothing` and their first
  versions; never overwrites an edited factor. Used by the demo seed, the production seed (`reference.ts`) and the production
  backfill under the roles-rates-hr marker (before the non-demo early return of `seedIfEmpty`, so PostgreSQL gets it through
  `db:migrate`). Not a SQL migration.
- `docs/referentiels-a-fournir.md` (French): every list EPC2i must supply with its current production default, constraints and
  who validates — explicitly not an import template (D-7b).

### R-086 — portfolio labour cost by zone (R-2 a)

- `getPortfolioLaborCost(zone)` (`src/server/dal/resources.ts`): the projects in execution (A-3) of the zone (all zones when
  none), Σ budget and actual of every cost category typed `labor`.
- Resources page: reads the `ks-zone` cookie; value Σ actual; sub-line "70% of labor budget · All zones" (the zone named);
  "—" and the zone name when the zone has no project in execution. The page comment no longer describes 06 OQ2.
- `getLaborCost` (Project resources) now sums the project's `labor`-typed categories (was: the first `/labor|staff/` name).
- Resources export: the same reader, and a "Zone" filter line.

### R-087 — one 1–5 scale and two indicators (R-5a, R-5b)

- "Add skill": the "Levels" field, `SkillScale` and `SKILL_SCALES` are removed (`src/features/hr/forms.ts`).
- `skillCoverage` adds `noExpert` / `singleExpert`; `skillKpis` returns both (seed: 2 and 6); the coverage text names the case
  ("No expert · 1 at level ≥3"). The Home's `skillCoverage` now delegates to the Skills matrix's (one definition).
- Skills matrix: five tiles — Skill families; Skills without an expert (LO when > 0); Single-expert skills (LO when > 0);
  Certifications with a neutral sub-line ("People with a certification noted", no Lucca); Open requests needing level ≥4.
- Engineering-lead Home watchlist: "No expert — 1 at level ≥3" when no one is at level ≥ 4; "Single expert — 1 expert · …"
  unchanged; tag "Skill gap".

### R-088 — hours-variance threshold (R-6b)

- Settings key `hours.variance` = `{ pct }`, an integer 1–50, default 10 (`HOURS_VARIANCE_DEFAULT`). Light reader
  `src/server/dal/hours-variance.ts` (memoised, falls back to 10 when the row is missing or invalid — databases seeded earlier
  have none). Seeded by `seedSettings`; OPTIONAL `hours` in `SettingsDefaults` (absent from stored documents = valid; present
  and invalid = refused, like the thresholds); `fallbackSettingsDefaults` and `settingsDefaultsDocument` carry 10;
  `resetSettings` writes it.
- Setter `setHoursVariance(pct, actor)` (`src/server/dal/settings.ts`, director only through `ST`, range check, read inside the
  transaction, audit "±10 % → ±7 %" and activity), Server Function `setHoursVarianceAction` (`settingsEditor`).
- Settings view: its own card "Hours variance" (not inside the A-13 sentence) with "Hours variance threshold (%)", saved on blur /
  Enter, read-only for non-directors; Settings export: one more KPI row.
- `hoursVariance(planned, declared, pct)`: integer arithmetic on hundredths of hours — over when declared − planned ≥ planned ×
  pct / 100, under when planned − declared ≥ planned × pct / 100, 0 / 0 ok, a plan of 0 with hours declared over; the bar's
  accent-700 follows "over". `hoursKpis` uses the same threshold, both ways, for the Variance tile (was: over 5 % only).
- Hours page: reads the threshold; over = accent-300 + ▲, under = neutral-400 + ▼, each with visually hidden words ("Over plan",
  "Under plan") — not colour alone.

### Rights re-checked in the DAL (defense in depth)

- Rate writers (`setBaseRate`, `setMultiplier`, `addRateRole`) take an `Actor` and refuse anyone but the director and Finance.
- Hours writers (`markHoursImported`, `assignUnassignedHours`) take an `Actor` and re-check `editsProjectScreen(…, 'hours')` (the
  team rule, and Finance's read-only).
- `setProjectBudgetRate`: director and Finance. `setHoursVariance`: the Settings rule (director).

## 2. Defaults taken (owner to confirm)

| Point | Default built | Why |
|---|---|---|
| Finance edits contracts | On **every** project (departs from P-2's named team; only the director was exempt) | P-4 names Finance for the contract without a team condition |
| Finance on Budget / Hours / Billing | Read only, even on its teams | P-4 gives Finance the contract only; billing gate unchanged |
| Budget rate | Director and Finance | C-9 + P-12 (c); DELIVERY-7 §8 question |
| Margins | Visible to Finance | A cost controller without margins cannot read Cash flow |
| Finance workspace | No Prioritisation, no My approvals; Plan / My work / Leave / Meetings for its own work | Scoring undecided; P-9a pattern |
| Rate editors | Director and Finance; PMs read | P-12 (c) |
| Effective date | Explicit; default = business date STATUS_ISO (25 Sep 2026) until R-013 | R-4a; an earlier date revalues past hours, so the date is always visible |
| Seed grid date | 1 Jan 2026 (versions created by the migration: the role's former date, else 1 Jan 2026) | A-10 |
| Person → role | Exact job title; no match = not valued | R-4a "never an invented rate" |
| What-if unrated resources | Isolated named 60 €/h placeholder (crews, subcontractors, people without a role) | Brief: do not drop crew cost |
| Hours variance cost | Masked for the roles that do not see rates | R-046: a grid-valued cost reveals rates |
| Reference multipliers | Seeded in production as placeholders (×1.25 / 1.5 / 2 / 1.3 / 0.35) | R-178 data sheet, A-10 |
| Labour cost population | Projects in execution (A-3) of the zone chosen on the zone screens | R-2 (a) + the Overview's population |
| Variance KPI | Same symmetric threshold as the lines (was over 5 % only) | R-6b "one threshold" |
| "View as client" | Director and the project's leads (incl. a member-role deputy); director keeps "Raise issue" | P-11 (a); I-2b |

## 3. Displayed values that change on the seed (tests cite the decision)

| Where | Old | New | Decision |
|---|---|---|---|
| "View as" personas, users | 8 | 9 (Léa Marchand, Finance) | R-044 |
| Procurement sidebar / Contract screen | Contract in the workspace, editable on team projects | outside banner, read-only | P-4 |
| Rate cards for a PM | editable inputs | values read-only + "Rates are edited by the portfolio director and Finance" | P-12 c |
| Rate cards "Visibility" sub / masked banner | "Directors and project managers" / "…directors and project managers only — … see and edit them." | "Director, project managers and Finance" / "Rates are visible to the director, project managers and Finance only — … see them." | R-044 |
| Rate cards | no date | "Rates in force on" date field; "since 1 Jan 2026" under each rate and multiplier | R-083 |
| Settings rate note | "page (directors and PMs)." | "page (director and Finance)." | P-12 c |
| Budget rate refusal | "Only the portfolio director sets the budget rate" | "Only the portfolio director and Finance set the budget rate" | C-9 / R-044 |
| Task cost notes (job-title rate → grid rate) | QA / QC 95, Structural engineer 120, Site lead 105, Crane operations 98, Cost controller 90, Planner 92, MEP lead 115, Procurement 88 €/h | 60, 85, 68, 62, 70, 74, 82, 58 €/h (T-2314 "6.0 h × 95 €/h = 570 €" → "× 60 €/h = 360 €"; T-2302 €428 → €270; T-2305 €840 → €595) | A-10 |
| Hours "Variance" sub (HLT-026) | ≈ 12 h × 62 €/h = €744 → "€1k" | Σ (d − p) × grid rate = €955 → "€1k" (unchanged text) | A-10 |
| Hours tones (lines) | Julien Wagner 1.3 +12/120 ok; under-declarations always flagged | +12/120 over ▲ (inclusive); Amélie Ollivier 1.2 −4/80, Thomas Kerbrat −8/96, Damien Roux −2/30 → ok | R-6b |
| Hours tones (groups) | Thomas Kerbrat, Damien Roux, WP 1.2, WP 1.5 under | ok; Amélie Ollivier −10/100 stays under (inclusive) | R-6b |
| Hours over / under look | both accent-300, no glyph | over accent-300 ▲, under neutral-400 ▼ (+ words for screen readers) | R-6b |
| Skills tiles | "Single-expert skills 8 · Fewer than 2 people at level ≥4"; "Certifications 5 · Tracked with expiry in Lucca"; 4 tiles | "Skills without an expert 2 · No one at level ≥4", "Single-expert skills 6 · Exactly one person at level ≥4", "Certifications 5 · People with a certification noted"; 5 tiles | R-5b, R-087 |
| Skills coverage | "0 experts · 1 at level ≥3" | "No expert · 1 at level ≥3" (Automation & controls, Software / IT) | R-5b |
| Engineering-lead Home watchlist | "Single expert — 0 experts · 1 at level ≥3" (FR "Expert unique — 0 experts · …") | "No expert — 1 at level ≥3" (FR "Aucun expert — 1 au niveau ≥3") | R-5b |
| Add skill form | Skill · Category · Levels | Skill · Category | R-5a |
| Add role form | Role · Hourly rate · Cost center · Grade | + Effective from | R-083 |
| Resources "Labor cost to date" | €1.42M · 77% of labor budget (current project HLT-026) | €2.51M · 70% of labor budget · All zones (EU/NA €2.17M · 75 %, Africa €340k · 49 %, Asia Pacific "—") | R-2 a |
| Settings | — | "Hours variance" card, threshold 10 % | R-6b |
| Project headers (director, project leads) | — | "View as client" button; preview banner on the portal | P-11 a |

What-if costs and the site premiums are unchanged on the seed (the grid roles carry the former job-title internal rates).

## 4. Migration

Three files, in this order (the custom one must run between the two generated ones — it reads the old columns and fills the
new tables):

1. `0016_tense_guardian.sql` (generated): creates `rate_role_rates`, `rate_multiplier_rates`, adds `persons.rate_role_id` and the
   foreign keys. Nothing is dropped yet.
2. `0017_rate_versions_backfill.sql` (custom): the current base rates / factors become first versions (`coalesce(effective_from,
   '2026-01-01')` for roles, 1 Jan 2026 for multipliers), persons get the role named as their job title. Idempotent; no-op on a
   new database.
3. `0018_wild_dark_phoenix.sql` (generated): drops `job_title_rates`, `rate_multipliers.factor`, `rate_roles.base_rate_eur` and
   `rate_roles.effective_from`.

To regenerate at integration: (a) schema with the new tables and `persons.rate_role_id` but the old columns and
`job_title_rates` still present → `npm run db:generate`; (b) `npx drizzle-kit generate --custom --name rate_versions_backfill`
with the same SQL; (c) the final schema → `npm run db:generate`. `src/server/db/migration-rate-versions.test.ts` finds the
migrations by the backfill's tag, migrates a database to just before them, fills old-shaped rows, migrates to the end and
checks the conversion. The R-178 multipliers are seed data (not a migration). The Finance user and the hours-variance row need
no migration (seed + backfill / reader fallback).

## 5. Tests

- New: `src/domain/d8-roles-rates-hr.test.ts` (rights of the 9 personas — contract, Finance read-only, budget rate, margins,
  rates, "View as client"; dated grid; task valuation; multipliers = MULTS; skills indicators; hours variance boundaries — every
  threshold 1–50 % on every plan 1–200 h, 7 % on 100 h, 110 → 121 h, 0 / 0 —; Settings defaults with and without `hours`),
  `src/server/dal/d8-roles-rates-hr.test.ts` (Finance user and backfill, Finance's Home, project context, the rate / budget-rate /
  Hours / Settings Server Functions for the 9 personas with the real session, malformed input, stale role, DAL re-checks, dated
  edits and backdating, valuations, site premium, production multipliers and backfill),
  `src/components/app/shell/page-header-d8.test.ts` (the real PageHeader: entry and banner per persona, deputy, portal; Finance
  and procurement on Contract / Budget / Hours / Billing), `src/server/db/migration-rate-versions.test.ts`.
- Updated (each change commented with its decision): `domain/hr.test.ts`, `domain/auth.test.ts`,
  `domain/settings-defaults.test.ts`, `features/hr/{actions,forms,hr.render}.test.ts`, `features/contract/{gate,actions,contract.render}.test.ts`,
  `features/orders/currency-actions.test.ts`, `features/admin/render.test.ts`, `features/mywork/mywork-render.test.ts`,
  `features/resources/{resources-page,model}.test.ts`, `server/dal/{delivery2,delivery2-writes,d7-debt-ux,shell,home,users}.test.ts`,
  `server/db/seed/production-seed.test.ts`, `scripts/db-check.ts` (row counts, 9 users).
- Checks: `npm run typecheck`, eslint on the changed files, `npx tsx --conditions=react-server scripts/db-check.ts` (all checks
  passed), the whole suite (`npx vitest run`, see the hand-over report).

## 6. Not built, and why (owner or another system)

- Finance's rights to **issue invoices and mark them paid** (P-4 is silent; R-182 Sage X3): Billing stays the director's and the
  PM-role team members'.
- A **production source for person → rate role**: Cursus's directory (R-027) carries matricule, name, e-mail and team, not a
  role; nothing in Keystone writes `persons.job_title` or `rate_role_id`. Until the owner decides, everyone is "not valued" in
  production.
- **Actual cost from Cursus hours** (R-074) and the real EPC2i grid / coefficients (R-178 waits for the direction's data and D-7b).
- No "remove a version", no department editor, no "add multiplier" (absent from the prototype — no new tools).

## 7. Open questions for the owner

1. P-4 vs P-2: may Finance edit the contract of **every** project, or only on the projects whose team it is on?
2. Finance and invoices: issue / mark paid, or read only (today)?
3. Budget rate: director and Finance (default) — confirm (DELIVERY-7 §8).
4. Finance sees margins (default) and has no Prioritisation (scoring and weights) — confirm.
5. Finance's Home is the director's, whose approvals rows link to screens Finance cannot act on: keep, or a Finance Home?
6. **Who sets a person's rate role in production** (no source; R-027 has no role)?
7. Effective dates: the default is the business date (25 Sep 2026 until R-013); a backdated change revalues past hours — should
   backdating be refused, or limited to Finance?
8. PMs no longer edit rates (P-12 c): confirm the interim (director and Finance only).
9. The five coefficients are placeholders (×1.25, ×1.5, ×2, ×1.3, ×0.35): EPC2i's real values and their effective dates?
10. What-if: crews and people without a grid role are valued at an isolated 60 €/h placeholder — add a crew role to the grid?
11. R-086 population: the projects in execution of the zone (A-3), or every project of the zone (R-2 "tous les projets")? Resources
    is not a zone screen: should it get the zone bar? Department heads and procurement now see a zone-wide labour total.
12. R-088: the Variance KPI now uses the same symmetric threshold (the prototype flagged over 5 % only) — confirm, or keep a separate
    KPI rule.
13. R-139: P-11 "en lecture seule" vs the director's "Raise issue" (I-2b: today the only internal way to record a client issue) —
    keep? Should other internal roles be refused the portal (P-1 = a keeps the outside view)?
14. The hours variance's labour cost is masked for the roles that do not see rates (department head on Hours): confirm.

## 8. Notes for the integrator

**Shared files touched (sections only):**

- `src/config/role-screens.ts`: the `finance` entry in `base` and the procurement push without `contract` (work-planning adds its own
  `base.procurement.push('mywork')` line next to the P-9a block).
- `src/domain/rights.ts`: new sections R-044 and R-139 before R-042; one comment line in R-046.
- `src/domain/home.ts`: `skillCoverage` (delegates to `domain/hr.ts`), new `skillGapSub`, the `engLeadHome` watchlist row; one import.
- `src/server/dal/team-guard.ts`: `editsProjectScreen` adds `!financeReadOnly(…)` (affects every writer that uses it — Finance has
  none of those screens except Hours).
- `src/server/dal/site.ts`: only `weekendPremium` and the imports (`inArray`, `rateMultipliers` removed; `multiplierAt`,
  `getRateGrid` added). `getSite` is untouched (the function defaults to STATUS_ISO).
- `src/server/dal/tasks.ts`: `TaskDetail.costNote` (replaces `costRate`), the cost computation in `getTask`, imports.
  `src/features/mywork/model.ts` (`costNote`), `task-sheet.tsx` (the cost-note line; `laborCost` import removed),
  `src/features/mywork/i18n.ts` (`costNoteText(loggedH, cost, target, project, t, lang)` — **signature changed**; work-planning
  edits other parts of these files).
- `src/server/export/providers/my.ts`: the task export's rate / cost rows.
- `src/features/contract/actions.ts`: `setBudgetRateAction` body, its doc comment, the header comment line, one `KNOWN_ERRORS`
  string; `actions.test.ts` (two expectations), `contract.render.test.ts`, `gate.test.ts` — cost-change owns the rest.
- Settings plumbing (cost-change adds `change.ccbThreshold` next to it): `codes.ts` (`APP_SETTING_HOURS_VARIANCE` next to
  `APP_SETTING_HEALTH`), `domain/settings-defaults.ts` (optional `hours`, `defaultHoursVariance`), `dal/settings.ts`
  (`SettingsData.hoursVariance`, `HOURS_VARIANCE_RANGE`, `setHoursVariance` before `readSettingsDefaults`, `resetSettings` writes
  it), `seed/settings.ts` (row + document), `features/admin/actions.ts` (`setHoursVarianceAction` before `resetSettingsAction`),
  `model.ts` (`SettingsView.hoursVariance`), `settings-view.tsx` (a card after the health card; the rate note now says "director
  and Finance"), `export/providers/admin.ts` (one KPI row). `app_settings` seed count 4 → 5 in db-check (cost-change's CCB threshold row, if seeded, adds one more).
- `src/i18n/fr-rules.ts`: two R-5b rules, next to `^(\d+) experts? · …` and `^Single expert — (.+)$`.
- `src/server/db/seed/index.ts`: under the roles-rates-hr markers only (demo: Finance user backfill; production: multipliers
  backfill).
- `src/server/db/schema/organisation.ts`: `persons.rate_role_id` after `is_contract_role` (connectors adds matricule columns next
  to it; schema/organisation.ts now imports `rateRoles` from `./resources`).
- `src/server/db/seed/production-seed.test.ts`: `REFERENCE_TABLES` + `rate_multipliers`, `rate_multiplier_rates`; `rate_role_rates`
  in the empty list.
- `scripts/db-check.ts`: D2 counts (`rate_role_rates` 10, `rate_multiplier_rates` 5, no `job_title_rates`), D5 `app_settings` 5,
  "9 users (personas)".
- `tests/e2e/helpers.ts`: `Role` includes `finance` (no e2e scenario added; the route matrix must run with 9 personas).

**Dictionaries.** All FR in `d8-roles-rates-hr.json`; no prototype key overridden. "Enter a valid effective date" reuses
d7-operations' translation (not repeated). The prototype key "page (directors and PMs)." is no longer used (new key
"page (director and Finance).").

**Follow-ups.**

- The contract DAL writers (`dal/contract.ts`) take an actor name and do not re-check P-4 (pre-existing since delivery 7; the
  Server Functions check it). Same for the budget-category writers. A re-check needs the actor's role in their signatures —
  cost-change rewrites these writers in this delivery.
- `laborCost` (`src/domain/tasks.ts`) is no longer used by the app (still covered by its prototype golden) — R-171 sweep.
- The other features' "8 personas" rights tests loop over a fixed list without `finance` (they still pass); extend when touched.

**Progress suggestions for `docs/reste-a-developper.json`** (integrator only): R-086, R-087, R-088 → fait; R-044, R-139, R-083 →
en_cours (built part merged; §6–§7 open); R-178 → en_cours (placeholders and the data sheet; real lists awaited).

## Integration review fixes

- R-046 / R-083: a rate-grid change writes its values in the audit row only (activity "Rate card · Planner base changed from
  1 Nov 2026"); Activity & integrations and its export mask the "Rate card" audit changes and older feed events with values
  ("•••") for the roles without `canSeeRates` (`ratesMaskedAudit` / `ratesMaskedActivity` in `src/domain/hr.ts`;
  `src/features/admin/d8-rate-audit-mask.test.ts`, 9 personas).
