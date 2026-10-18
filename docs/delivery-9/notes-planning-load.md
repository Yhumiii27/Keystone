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
