# Delivery 9 — lot "planning-load" (R-084, load part): the load from the schedules' assignments

Owner answers of 17 Oct 2026 (third round):

- **(A)** « Oui il faut partir des allocations du planning pour faire les calculs de charge » — a person's load is the hours
  the project schedules assign them, no longer the seeded weekly percentages (`allocations`, the prototype's PEOPLE).
- **(B)** « Il faut les compter par rapport à un métier et non une personne ; si pas de déclaration du tout alors il faut faire
  une alerte » — work no named person carries is demand on a **trade**; an activity with no resource declared at all raises
  an **alert**.

## 1. Values on the demo data set (Fri 25 Sep 2026; default window 21 Sep – 9 Nov)

The demo schedules name **one** person: Julien Wagner on HLT-026 A1250 (17 Aug – 9 Oct, "40 h/wk"). Every other activity
(144 of 145) is carried by its owner only; one unnamed assignment counts hours: the steel erection crew on A1250 (6 × 10 h/d,
no department). **The screens become nearly empty of people load.** No seed change was made (the lead discusses it with the
owner).

| Screen | Before (seeded allocations) | After (schedules) |
|---|---|---|
| Resources — Team utilization | 75 % | **5 %** |
| Resources — Over-allocated | 3 people · Peak weeks 42–44 | **0 people · No week above 110%** |
| Resources — Unmet demand | 280 h · Mostly engineering | **900 h · Mostly steel erection crew** |
| Resources — heatmap | 8 rows, seeded % (Julien Wagner 0 · 90 · 100 · 130 · 125 · 110 · 100 · 80) | 8 rows, all 0 except Julien Wagner **100 · 100 · 100 · 0 · 0 · 0 · 0 · 0** |
| Resources — Capacity vs demand | stored 8-week ROLES totals: Engineering 1110/960, Site operations 690/640, MEP 510/480, Controls & planning 560/640, Quality 370/320 (whatever the window) | the window shown: Engineering **170/960**, Site operations **214/640**, MEP **300/480**, Controls & planning **574/640**, Quality **106/320**, **Steel erection crew 900/0**; note "Of which 2144 h not assigned to a person, counted by trade" |
| Resources — week view, 21 Sep | Julien Wagner 0 % · 0 h / 40 h · "HLT-026 40 h · 40 h assigned beyond the load" | **100 % · 40 h / 40 h · "HLT-026 40 h"** |
| Resources — week view, 12 Oct | Julien Wagner 130 % · 52 h · +12 h · over-allocated | **0 %** (nobody assigned: footnote) |
| Resources — week view, bars | stored 8-week totals | the week (Controls & planning **82/80 h**, steel crew 300/0 h…) |
| Suggested rebalancing | crew unit · crew overtime · relief of Julien Wagner (−44 h) | crew unit · crew overtime (**no relief**) |
| Project resources HLT-026 (`?week=2026-09-28`) | 83 % · 3 people · 0 h unmet | **3 % · 0 people · 600 h unmet** (steel crew); bars Site operations 116/640, Engineering 130/320, MEP 106/320, Controls & planning 0/960, Quality 0/320, Steel erection crew 600/0 |
| Project resources NDC-031 / RCF-019 | 80 % · MEP 314/320, C&P 717/960 / 3 h unmet (Site ops 323/320) | **0 %** · MEP 68/320, C&P 218/960 / **0 h** (Site ops 10/320, MEP 82/320, Quality 44/320) |
| What-if HLT-026 (current horizon) | peak 130 % (Julien Wagner, 12 Oct); people above 100 % [0,0,1,2,3,2,0,1]; 3 levers; Protect people = relief; scenario A +3 d, +1.1 k€, peak 130 % | peak **100 %** (Julien Wagner, 21 Sep); **all 0**; **2 levers** (overtime, crew unit — no relief); Protect people = **none**; scenario A +3 d, +0.1 k€, peak 100 % |
| Home — department head (Engineering) | 83 % · 3 people · Peak weeks 42–44 · 280 h Mostly engineering · Julien Wagner 99 % | **5 % · 0 people · No week above 110% · 900 h Mostly steel erection crew · Julien Wagner 38 %** |
| Home director / Portfolio overview — Needs attention | "3 people over 110%" (Weeks 42–44) | **no over-allocation alert** (7 alerts instead of 8) |
| Approvals — Engineering | Team load w/c 28 Sep 90 % · committed 1110 h · RQ-041 "Julien at 90 % → 120 %" | **w/c 21 Sep 100 % · committed 170 h · "Julien at 100 % → 130 %"** |
| Approvals — Site ops / C&P / Quality | 80 % · 690 h / 87 % · 560 h · RQ-044 100 → 110 % / RQ-042 40 → 60 % | **0 % · 214 h / 0 % · 574 h · 0 → 10 % / 0 → 20 %** |
| My work — Load next 2 wks | Julien Wagner 95 %, Hélène Sauvage 45 % (others 70–105 %) | **100 %**, **0 %** (others 0 %) |
| Site HLT-026 — conflicts | 8 (load: Amélie Ollivier 120 %, Julien Wagner 125 % in the week of 19 Oct) | **6** (no load conflict) |
| Prioritisation — capacity what-if | committed 318 · 532 · 314 · 716 · 252 h; gaps WSA 151 · EWA 86 · FTU 12 · RBR 305 · CER 73 h | committed **170 · 214 · 300 · 574 · 106 h**; gaps **49 · 24 · 0 · 83 · 18 h** (FTU-052 "Can be absorbed") |
| Activities without a declared resource | — | **none** (every demo activity has an owner) |

## 2. Rules

**One source** — `getPlanningLoad(weeks)` (`src/server/dal/planning-load.ts`), pure rule `planningLoad` (`src/domain/planning-load.ts`):
reads every activity dated across the weeks (all projects) with its assignments and its working calendar (its own, else the
project's, else Standard 5d · 8h, Settings public holidays and exceptions applied), and spreads each assignment with the week
split's rule `assignmentHoursInWeek` (units × h/d on each working day between the activity's start and finish as stored; else the
planned hours evenly; equipment and material add nothing). Only work still to do counts: a **complete** activity (100 %) or a
**milestone** (duration 0) adds nothing. Memoised per request (`react` `cache`, keyed on the weeks).

- **People** — named assignments (`activity_assignments.person_id`) → hours per person per week; **load % = round(hours ÷ 40 h ×
  100)** (the capacity basis is unchanged: `HOURS_PER_PERSON_WEEK`). The pool (`PoolPerson`) carries `loads` and `hours`.
- **Trades** (owner answer B) — not counted against a person:
  - an assignment **without a person** → its **department** (`activity_assignments.department_id`, the field the levelling by
    department already uses), else **the resource it names** ("Steel erection crew", typed text, no planned capacity), at the
    same spreading rule;
  - an activity whose **only resource is its owner** (no assignment at all) → the **owner's department** (else "Other"), at
    **2 h per working day** (`WHATIF_RULES.ownerHoursPerDay`, the what-if's coordination rate). The owner is not loaded with it.
- **Why the department is the trade**: it is what the schedule assignments carry (`department_id`), what the owners belong to,
  and where capacity is planned (`department_capacities`, the "Capacity vs demand" bars, Approvals). Rate roles are per person
  (valuation), job titles are free text, and no assignment carries either.
- **Capacity vs demand** (`listDepartments(weeks)`, `getCapacityDemand(weeks)`): demand = the hours the schedules assign the
  department's people (every project) + the department's trade hours; capacity = the stored department capacity **pro rata of the
  weeks shown** (8 weeks → as stored, the week view → ÷ 8). Trades outside the departments (a crew without a department, "Other")
  follow as bars with no capacity — their demand is unmet. The stored `department_capacities.demand_h` (ROLES) is no longer read
  (same concept: R-084's open point). Project resources: the team bars (320 h / 40 h per person, demand from the members' loads)
  + the project's own trade demand (`getProjectTradeDemand`), a trade nobody of the team belongs to making its own bar.
- **Undeclared activities** (`listUndeclaredActivities`, rule `undeclaredActivities`): needs work (not a milestone, not complete),
  no assignment, no owner. An activity with only equipment / material assignments is declared (no alert).

**Readers switched** (all through `getPlanningLoad`): Resources (heatmap, week view, bars, KPIs), Project resources, What-if (team
loads, department overload), Suggested rebalancing, Home (department head: loads, unmet demand), portfolio over-allocation alert
(the 8 weeks from the data date's week), Approvals (team load, capacity · committed, request impact), New request dialog, My work
(person loads; "Load next 2 wks" `loadNextWeeks`), Site conflicts, search (names only), Prioritisation capacity what-if
(`capacityModel`), exports (Resources, Project resources, Approvals, What-if), `scripts/db-check.ts`. Readers called without weeks
now read **the current 8-week window** (they read the seeded allocation weeks before) — `getResourcePool()`, `getProjectTeam(code)`,
`listDepartments()`, `getLeaveCalendar(country)`. The `allocations` table is no longer read anywhere (kept, no migration).

**What-if**: the team's base loads are the schedules'; the context counts owners on their trade (`ownerLoad: 'trade'`, new optional
field of `WhatIfContext`, default 'person' = the chapter-4 rule the golden tests keep): no 2 h/d owner share on a person, and a
shift lever frees an overloaded **assignee** only. Relief and overtime levers depend on the load % — they now follow the schedules
(on the demo data set Julien Wagner is at 100 %, not above: no relief lever). Departments are overloaded when their computed demand
exceeds their capacity over the horizon.

**Week view**: the load IS the schedules' hours, so the split by project covers it exactly ("HLT-026 40 h"); "not assigned" /
"assigned beyond the load" can no longer appear from the screens (the rule `weekLoad` keeps them for another total, its new
optional `hours` argument carries the schedules' hours).

**Alert** (owner answer B): a card "Activities without a declared resource" on Project resources (code · name, link to the activity
on the Plan, `?act=`), and a **morning bell notice to the PM of record** — new daily reminder job `undeclared-resource-alerts`
(`daily: 'reminders'`, 07:00 Paris, `src/domain/jobs.ts`, `src/server/dal/undeclared-alerts.ts`): title "Activity without a declared
resource", sub "A1250 · name", opens the Plan on the activity. **Deduplicated without a migration**: an activity already alerted is
one with a notice of that title on its project for its code (`notifications.target_params.sel`); the job runs under its lease (one
worker at a time). A PM without an active account: counted "without recipient" (job warning), tried again the next morning.
Runbook: `docs/EXPLOITATION.md`.

**UI** (existing components): the bars' note "Of which N h not assigned to a person, counted by trade" (FR « Dont N h non affectées à
une personne, comptées par métier »); a trade outside the departments is shown as typed (`dataText`); the bars' sub-line follows
the window on both screens ("Hours by role, next 8 weeks" / "8 weeks" / "week shown").

| Piece | Where |
|---|---|
| Pure rules | `src/domain/planning-load.ts` (`planningLoad`, `loadPctOfHours`, `undeclaredActivities`, `tradeOfAssignment`, `tradeOfOwner`, `needsWork`); `projectDepartmentDemand(…, trades)`, `unnamedDemand`, `CapacityRow.kind/unnamedH`, `shortfallText` (typed trade) in `src/domain/resources.ts`; `weekLoad(…, hours)`; `WhatIfContext.ownerLoad` |
| DAL | `src/server/dal/planning-load.ts` (`getPlanningLoad`, `listUndeclaredActivities`); `resources.ts` (`poolRows`, `getWeekProjectSplit`, `currentLoadWeeks`, `listDepartments(weeks)`, `getCapacityDemand`, `getProjectTradeDemand`, what-if context); `kpis.ts` (`capacityModel`, `loadNextWeeks`); `hr.ts` (default weeks); `home.ts`; `portfolio-alerts.ts`; `undeclared-alerts.ts` |
| Job | `undeclared-resource-alerts` (`src/domain/jobs.ts`, `src/server/jobs/definitions.ts`) |
| UI | `src/features/resources/model.ts` (`rolesNote`, `undeclared`, `projectTrades`), `resources-view.tsx`; pages `/resources`, `/projects/[code]/resources`; export `src/server/export/providers/resources.ts` |
| French | `src/i18n/extra/d9-planning-load.json` |

## 3. Tests

- New: `src/domain/planning-load.test.ts` (per person and per week across projects, planned-hours fallback, equipment / material,
  unnamed assignments by trade, owner-only activities at 2 h/d on the owner's trade, complete / milestone / undated / holiday,
  undeclared detection); `src/server/dal/planning-load.test.ts` (demo DB: people, trades, pool, departments, capacity vs demand,
  project trade demand, capacity model, load next 2 weeks; undeclared list, Project resources card EN/FR, job run → one notice to the
  PM, second run deduplicated, PM without account → unaddressed then retried); `whatif.test.ts` (`ownerLoad: 'trade'`).
- Fixture `src/features/resources/overload.test-fixture.ts`: Julien Wagner on a second (NDC-031) assignment, so the flows that need
  an overloaded person (relief lever, Protect people, drafted requests, shift lever, load conflict arbitration, over-allocation
  alert) keep their coverage on the new source.
- Changed with an R-084 comment (demo-DB expectations): `load-window.test.ts`, `resources-page.test.ts`, `actions.test.ts`,
  `whatif-horizon.test.ts`, `delivery2/3/5(-writes).test.ts`, `d8-roles-rates-hr.test.ts`, `home.test.ts`, `portfolio(-alerts).test.ts`,
  `requests/model.test.ts`, `requests/drafts.test.ts`, `pfinance/model|render.test.ts`, `mywork-render.test.ts`, `hr.render.test.ts`
  (prototype weeks passed explicitly), `site/render|conflicts.test.ts`, `jobs.test.ts` (both), `scripts/db-check.ts`. Prototype
  golden comparisons of pure functions are unchanged (the what-if fixture keeps the owner rule 'person').

## 4. Open questions for the owner

1. **Demo data set**: one named assignment — every load screen is nearly empty (utilisation 5 %, nobody over-allocated, no relief
   lever, no load conflict). Add named assignments to the demo schedules (a seed change)?
2. **Crews / subcontractors without a department** (the steel erection crew, 6 × 10 h/d): counted as their own trade with no
   capacity, so their hours are "unmet demand" (900 h on Resources, 600 h on HLT-026). Exclude subcontracted crews from the
   unmet demand, or map them to a department?
3. **Owner-only activities**: 2 h per working day on the owner's department (the what-if's coordination rate). Use another rate,
   or the activity's budget hours?
4. **Trade = department** (assignment department, else owner's department). Should trades be finer (job titles, rate roles) — the
   schedules carry none of them today?
5. An activity with **equipment / material only** declares a resource (no alert) but no labour: count its owner on the trade too?
6. **Alert**: once per activity (not again if it becomes undeclared again after being declared), to the PM of record only (not
   the co-PMs / deputies). Keep?
7. An in-progress activity loads its whole span (start → finish), past weeks included; the remaining work is not re-spread over
   the remaining span (the what-if does that on its copy). Keep?
8. **Capacity** is unchanged (40 h a person a week, stored department capacities pro rata): R-084's capacity part (contractual
   hours, validated absences, public holidays) waits for Cursus (R-031) and the contractual-hours source.

Answered on 18 Oct 2026 (fourth round, §5): 1 (named demo assignments: yes), 2 (external crews out of the load plan), 3 (keep
2 h/d, warn the PM at J-15), 4 (department + skills-matrix levels are enough); 5 follows from answer 2 (the owner's 2 h/d count
when an activity has no EPC2i labour). 6–8 stay open.

## 5. Owner answers 18 Oct 2026 — fourth round

| # | Answer | What changed |
|---|---|---|
| 1 | « Les équipes externes ne rentrent pas dans le plan de charge » | External labour is left out of the load plan (no person load, no trade demand, no unmet demand); it stays in the schedule. |
| 2 | « Aucune activité ne devrait être sans affectation, donc laisse 2 h, mais à 15 jours d'une activité sans affectation préviens le chef de projet » | Owner-only activities keep 2 h/d on the owner's department; a J-15 morning notice to the PM of record; a second card on Project resources. |
| 3 | « Le service et les niveaux de compétences de la matrice de compétences sont suffisants » | Trade = department, unchanged. No assignment or role carries a required skill today, so nothing to refine yet (below). |
| 4 | « Ajouter des affectations nominatives aux plannings de démo : oui » | 61 named assignments in the demo seed (`src/server/db/seed/demo-assignments.ts`); the test fixture `overload.test-fixture.ts` is removed. |
| 5 | « Nouveau risque sur un prérequis : ne pas clôturer l'ancien, il peut y avoir plusieurs sources » | Recorded in `notes-prereq-alert.md` §7 (the default stands, no code change). |

### 5.1 External crews (answer 1) — the rule

`src/domain/planning-load.ts`:
- **labour** (`isLabour`) = an assignment that carries hours: units × h/d, else planned hours (the spreading rule's own test).
  Equipment days and material tonnes are not labour.
- **external labour** (`isExternalLabour`) = labour that is not EPC2i staff: **unnamed and without a department** (a crew, a
  subcontractor, an imported labour resource matched to nobody — "Steel erection crew, Subcontractor · 6 ironworkers"), or
  **named after a person whose rate-grid role is external** (`rate_roles.is_external`, R-083: "Contractor — structural
  (external)"; no demo person has one).
- **EPC2i labour** (`isInternalLabour`) = a named staff person, or an unnamed assignment carrying an EPC2i department (a role
  such as "2 electricians · MEP"). Only EPC2i labour loads a person or a department.

The assignments have no type column: the department is what the schedule import and the table import already set from the
matched person (and what the levelling reads); an unnamed assignment without one cannot be placed in any capacity. No migration.
The what-if engine is unchanged: it still costs the crew and can shorten an activity with it (the crew is a lever, not a load).
The trade kind `'resource'` (a named crew as its own trade) is no longer produced by `planningLoad` (kept in the types and UI for
callers that classify any assignment).

### 5.2 Owner-only activities and the J-15 notice (answer 2)

- **Load**: an activity's owner puts 2 h per working day on their department whenever the activity has **no EPC2i labour** —
  owner only (unchanged), but also an external crew only, or equipment / material only (the owner coordinates the subcontractor
  or the hire; before, any assignment cancelled the owner's share — open question 5 of §4).
- **J-15 list** (`unassignedActivitiesAt(activities, assignments, today, days = 15)`, `listUnassignedActivities(today, code?)`):
  needs work (not a milestone, not complete), **has an owner**, **no labour assignment at all**, dated, and **start ≤ business
  date + 15 calendar days** — so an activity already started (or late) and still unassigned is included and warned once.
  Choices: an **external crew counts as an assignment** (the work is staffed, by a subcontractor: no warning); equipment /
  material only does not (nobody is assigned to the work: warned); an activity **without an owner** is the existing
  "undeclared" alert, not repeated here; undated activities are not listed (no date to measure J-15 against).
- **Notice**: the same daily job `undeclared-resource-alerts` (07:00 Paris, one pass for each kind), a **distinct** notice —
  title "Activity without an assignment at J-15" (FR « Activité sans affectation à J-15 »), sub "A1410 · HV connection &
  switchgear · 17 Aug" (code · name as typed · start), opens the activity on the Plan (`sel`), to the **PM of record**.
  Deduplicated without a migration like the undeclared one (a notice of that title on the project for that code = already
  alerted; once per activity, not again if it loses its assignment later). A PM without an active account: "without recipient",
  retried the next morning. The job's counts gain `unassigned`; its summary "… · N without an assignment at J-15 · …".
- **Project resources**: a second card "Activities without an assignment" (« Activités sans affectation ») — sub "Starting within
  15 days or started, owner only: assign the people who will do the work" — code · name (link to the activity on the Plan) and
  the start date ("17 Aug" / « 17 août »), at the business date.
- Runbook: `docs/EXPLOITATION.md` (job table).

### 5.3 Skills (answer 3) — what was possible

The skills matrix is per person (`person_skills`, levels 0–5 on the Settings skills; "Skills without an expert" tiles, R-5b).
No schedule assignment, resource request or rate role carries a **required skill** or a minimum level, so a department × level
demand cannot be derived: the trade stays the department (the assigned person's levels are known, the need is not). To refine
it, the owner would provide — per activity type or per assignment — the skill and the minimum level required (a column on the
assignment, filled by the plan drawer / the imports, i.e. a migration). Nothing built.

### 5.4 Named demo assignments (answer 4) — derivation

`DEMO_ASSIGNMENTS` (person → [project, activity, h/d]), inserted by `seedDemoAssignments` after the chapter-4 seed (fresh demo
database) and, once, on a demo database seeded before (backfill while its schedules name at most the prototype's one person).
Production seed unchanged. Each row: resource = the person's full name, `person_id`, detail = job title, `1 × h/d`, planned
hours = h/d × the activity's original duration, actual = planned × % complete, department = the person's.
- Target: each person's prototype allocation (PEOPLE, % of 40 h for the 8 weeks from w/c 28 Sep), the week of 21 Sep taking
  the first week's value.
- Candidates: the activities they **own** in the window (the prototype's owners, all eight in the pool) plus activities of the
  same projects calling on their department / job title / skills (Julien Wagner — structural 5, crane 4 — on crane delivery &
  rigging and load tests; Hélène Sauvage, QA/QC, on inspections, tests, handovers; Fabien Bertrand on procurement; Thomas
  Kerbrat on the lifts).
- Rates: bounded least squares of Σ h/d × working days in the week against the target, 0.5 h steps in [0.5, 8], then a local
  search keeping who is above 110 % in which week as in the prototype; one manual tweak (Hélène Sauvage A1430 6.5 → 5 h/d).
- **HLT-026 A1410** "HV connection & switchgear" (Pauline Noguès, started 17 Aug) is left owner-only on purpose: it shows the
  J-15 card / notice and the "counted by trade" note (50 h on MEP).

### 5.5 Values on the demo data set (Fri 25 Sep 2026; default window 21 Sep – 9 Nov unless stated)

| Screen | Prototype (seeded allocations) | Third round (schedules, 1 named person) | Fourth round (named demo assignments) |
|---|---|---|---|
| Resources — Team utilization | 75 % | 5 % | **84 %** (prototype window `?week=2026-09-28`: **83 %**, as the prototype) |
| Resources — Over-allocated | 3 people · Peak weeks 42–44 | 0 people · No week above 110% | **3 people · Peak weeks 42–44** (Amélie Ollivier, Julien Wagner, Pauline Noguès) |
| Resources — Unmet demand | 280 h · Mostly engineering | 900 h · Mostly steel erection crew | **102 h · Mostly controls & planning** (prototype window 80 h) |
| Resources — heatmap, Julien Wagner | 0 · 90 · 100 · 130 · 125 · 110 · 100 · 80 | 100 · 100 · 100 · 0 · 0 · 0 · 0 · 0 | **100 · 100 · 106 · 125 · 125 · 108 · 88 · 65** |
| Resources — heatmap, the others | seeded % | all 0 | Amélie 106·100·100·131·106·106·106·85 · Pauline 69·79·108·81·113·113·102·105 · Thomas 56·56·88·110·75·75·56·20 · Léa 69·73·71·75·75·75·81·65 · Damien 88·99·86·96·90·81·94·66 · Hélène 44·44·48·64·76·90·101·76 · Fabien 100·99·95·81·56·56·49·35 |
| Resources — Capacity vs demand | 1110/960 · 690/640 · 510/480 · 560/640 · 370/320 | 170/960 · 214/640 · 300/480 · 574/640 · 106/320 · Steel erection crew 900/0 | **Engineering 327/960 · Site operations 551/640 · MEP 358/480 · Controls & planning 742/640 · Quality 217/320** (no crew bar); note "Of which **50 h** not assigned to a person" (2144 h) |
| Resources — week view 21 Sep | — | Julien 100 % · "HLT-026 40 h", others empty | 79 % · 0 people · 23 h; every person has a split (Julien "HLT-026 40 h") |
| Resources — week view 12 Oct, Julien Wagner | 130 % · 52 h · +12 h | 0 % (footnote "assign no one") | **125 % · 50 h / 40 h · +10 h · over · "HLT-026 40 h · RCF-019 7.5 h · MSR-012 2.5 h"** |
| Suggested rebalancing (portfolio) | relief of Julien Wagner… | crew unit · crew overtime | **Gabriel Comte joins Hélène Sauvage on A1430 (+10 d · −€5k) · Overtime A1430 Hélène Sauvage 5 → 10 h/d · Contract crane operations joins Thomas Kerbrat on A1260** |
| Project resources HLT-026 (`?week=2026-09-28`) | 83 % · 3 people · 0 h | 3 % · 0 people · 600 h | **83 % · 3 people · Peak weeks 42–44 · 34 h**; bars Site ops 521/640, Engineering 320/320, MEP 354/320, C&P 720/960, Quality 240/320; note 40 h; **new card "Activities without an assignment": A1410 · 17 Aug** |
| Project resources NDC-031 (prototype window) | 80 % · 1 person · MEP 314/320, C&P 717/960 | 0 % · MEP 68, C&P 218 | **81 % · 1 person (weeks 43–44) · 0 h · MEP 314/320, C&P 720/960**; 3 suggestions (reliefs of Léa Marchand A3330, Fabien Bertrand A3420 / A3410) |
| Project resources RCF-019 (prototype window) | 3 h · Site ops 323/320 | 0 h · 10 / 82 / 44 | **92 % · 2 people · 6 h · Site ops 326/320, MEP 314/320, Quality 240/320** |
| What-if HLT-026 (current horizon) | peak 130 % (Julien, 12 Oct) · [0,0,1,2,3,2,0,1] | peak 100 % · all 0 · 2 levers | **peak 131 % (Amélie Ollivier, 12 Oct) · [1,0,2,3,3,3,3,1] · "Weeks 42–45" · 23 levers** (A1250's relief, crew overtime, crew unit first; shifts A1320 / A1330 / A1520); scenario A 17 levers (finish 17 Dec 2026, +0 d), B 6 levers (4 Jan 2027, −9 d); auto-level date 6 · budget 7 · people 15 levers |
| What-if NDC-031 | — | no lever | **11 levers** (reliefs) |
| Home — department head | 83 % · 3 people · 42–44 · 280 h · Julien 99 % | 5 % · 0 · 900 h · Julien 38 % | **84 % · 3 people · Peak weeks 42–44 · 102 h Mostly controls & planning · Julien Wagner 102 % (accent)** |
| Home director / Portfolio overview — Needs attention | "3 people over 110%" | no over-allocation alert (7) | **"3 people over 110%" · Weeks 42–44 · Amélie Ollivier, Julien Wagner, Pauline Noguès** (8 alerts, also in every zone) |
| Approvals — Engineering | 90 % · 1110 h · RQ-041 90 → 120 % | 100 % · 170 h · 100 → 130 % | **100 % · Committed 327 h · RQ-041 100 → 130 %** |
| Approvals — Site ops / C&P / Quality | 80 % · 690 h / 87 % · 560 h / RQ-044 100 → 110 % / RQ-042 40 → 60 % | 0 % · 214 h / 0 % · 574 h / 0 → 10 % / 0 → 20 % | **81 % · 551 h / 86 % · 742 h (over capacity, accent) / Fabien 99 → 109 % / Hélène 44 → 64 %; Quality committed 217 h** |
| My work — Load next 2 wks | Julien 95 %, Hélène 45 % | 100 %, 0 % | **Julien 103 % "Over capacity — rebalance", Hélène 46 %** |
| Site HLT-026 — conflicts | 8 | 6 | **7** (Julien Wagner load 125 % in the week of 19 Oct; Amélie Ollivier 106 %, no load conflict) |
| Prioritisation — capacity what-if | committed 318·532·314·716·252 h; gaps 151·86·12·305·73 h | 170·214·300·574·106; 49·24·0·83·18 | **327·551·358·742·217; gaps WSA-044 239 · EWA-051 146 · FTU-052 68 · RBR-048 417 ("Needs 3 additional people or a later start") · CER-047 133 h** |
| Activities without a declared resource | — | none | none |
| Activities without an assignment at J-15 | — | — | **HLT-026 A1410** (card + one morning notice to Romain Aubert) |

### 5.6 Tests

- `src/domain/planning-load.test.ts`: external crews left out; the owner's 2 h/d with equipment / crew only; `isLabour`,
  `isExternalLabour` (external rate role), `unassignedActivitiesAt` (J-15 boundary, started / late, crew = assigned, equipment =
  not, no owner, complete, milestone, undated).
- `src/server/dal/planning-load.test.ts`: the eight people and their loads, trades (only A1410 on MEP), departments, capacity
  model; the J-15 list, the Project resources card EN / FR, the job (one notice, deduplicated), the horizon moving with the date;
  the undeclared tests adapted to the second pass.
- The fixture `src/features/resources/overload.test-fixture.ts` is removed (the seed overloads Julien Wagner, Amélie Ollivier,
  Pauline Noguès); its users read the demo data set: `actions`, `whatif-horizon`, `resources-page`, `drafts`, `d8-roles-rates-hr`,
  `portfolio-alerts`, `site/conflicts`.
- Demo-DB expectations updated (comments cite the owner's answer of 18 Oct 2026): `load-window`, `delivery2(-writes)`,
  `delivery3`, `delivery5(-writes)`, `home`, `portfolio`, `portfolio/render`, `requests/model`, `pfinance/model|render`,
  `mywork-render`, `site/render`, `scripts/db-check.ts` (65 assignment rows, pool, J-15 list, 23 levers, gap 239 h, 7 conflicts).

### 5.7 Open questions

1. **What-if levers on part-time assignments**: the engine derives "overtime" on any critical driving assignment, so a
   2.5 h/d assignment gets "Overtime 2.5 → 10 h/d" (Thomas Kerbrat A1260, Pauline Noguès A1420) and scenario A drafts it as a
   request; on HLT-026 the what-if now lists 23 levers and scenario A 17 (17 draft requests on Select). Restrict overtime to
   assignments at ≥ 8 h/d (a full day), and/or cap the levers shown?
2. Should the J-15 notice also go to the co-PMs / deputies, and be sent again when the activity is still unassigned at J-5?
   Default: once, PM of record only (like the other alerts).
3. External labour: is "no department" the right marker, or should the assignment carry an explicit internal / external type
   (a column filled by the imports)? A subcontractor with a department would count as EPC2i labour today.
4. Skills: which activities / assignments require which skill and level (data the owner provides) before the trade can be
   refined by the skills matrix.
