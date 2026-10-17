# Delivery 9 — lot "load-window" (R-085): load plans over 8 rolling weeks

Owner decision R-7 ★ "8 semaines glissantes depuis la semaine en cours". Unblocked by the business clock (R-013).

## 1. What was built

Resources, Project resources and Leave show 8 weeks starting on the Monday of the business date's week (a Saturday or
Sunday belongs to the week that began the Monday before), with **Previous week · Current week · Following week** links and
the range shown ("Sep 21 – Nov 9, 2026" / « 21 sept. – 9 nov. 2026 »). The window slides one week per click, up to ±52 weeks;
`?week=YYYY-MM-DD` is validated on the server (snapped to its Monday; a malformed or out-of-range value gives the current
window). Allocations, absences and weekday public holidays are read for any week — a week without rows shows zero. Outside
the current window the titles read "8 weeks" instead of "next 8 weeks". The exports of these screens follow the window shown.

| Piece | Where |
|---|---|
| Pure rule | `src/domain/load-window.ts` (`loadWindow`, `parseLoadWeekParam`, bounds, links) |
| Readers | `getLoadWindow(week?)`, `getResourcePool(weeks?)`, `getProjectTeam(code, weeks?)` (`src/server/dal/resources.ts`), `getLeaveCalendar(country, weeks?)` (`hr.ts`) |
| UI | `src/features/resources/window-nav.tsx`; pages `/resources`, `/projects/[code]/resources`, `/resources/leave` |
| French | `src/i18n/extra/d9-load-window.json` |

**What-if.** At first its horizon was always the current window (no navigation). Replaced by the owner's answer (b), §5.

**Not changed (R-084, single capacity source):** readers called without a window keep the stored allocation weeks — Home
(department head), portfolio over-allocation alerts, Approvals team loads, My work, Site conflicts, search, db-check; the
"Capacity vs demand" bars (stored 8-week department totals).

## 2. Values that change on the demo data set (25 Sep 2026)

| Screen | Before (seeded window 28 Sep – 16 Nov) | Now (21 Sep – 9 Nov; `?week=2026-09-28` gives the former values) |
|---|---|---|
| Resources | team utilization 83 % | 75 % (the 21 Sep week is empty); over-allocated, unmet demand, cost unchanged |
| Leave | availability 85 %, 43 leave days; Armistice in column 6 | 87 %, 37 days; column 7 |
| What-if HLT-026 | over by week [0,1,2,3,2,0,1,0] | [0,0,1,2,3,2,0,1]; peak, levers, scenarios, auto-level unchanged |
| Suggested rebalancing | "load −40 h" | "−44 h" (all the relief falls inside the horizon) |

## 3. Tests

`src/domain/load-window.test.ts` (window, weekends, year change, parsing, bounds, links), `src/server/dal/load-window.test.ts`
(8, demo database: default and moved windows, empty weeks, project team, Leave columns, page, CSV exports); prototype-golden
tests pass `?week=2026-09-28` explicitly (R-085 comments).

## 4. Open questions for the owner

1. ~~Previous / next on the what-if too?~~ Answered 17 Oct 2026: yes (§5 b).
2. ~~Step: one week or a full 8-week page?~~ Answered 17 Oct 2026: both views, both steps (§5 a). The ±52-week bound stays a
   Keystone default.
3. Move the other load readers (Home, alerts, Approvals, My work, Site conflicts) to the current window — with R-084?
4. "Capacity vs demand" keeps its stored totals until R-084 — on Resources also in the week view (see §5 a).
5. Settings public holidays exist for 2026 only: a 2027 window shows none.

## 5. Owner answers 17 Oct 2026

### a) "Il faut les deux : une vision à la semaine et une vision à 8 semaines."

Resources, Project resources and Leave have a view switch **Week · 8 weeks** (links, `?view=week`; the 8-week view is the
default and carries no parameter; anything else in `?view=` is the 8-week view). `?week=` keeps its rules (snapped to its
Monday, ±52 weeks, malformed = current). The switch keeps the week shown (8 weeks from the selected week, or the first week
of the 8 shown).

- **Week view** — one week, navigation one week at a time (Previous week · Current week · Following week), range "Week 46 ·
  Nov 9, 2026" / « Semaine 46 · 9 nov. 2026 ».
  - *Leave:* day by day, Monday to Friday. `leave_entries` holds one row per week an absence covers, **with its own dates**
    (`start_date` / `end_date` inside the week), so the granularity is the day: each day is Leave, Absence, a public holiday
    (row "Public holidays" names it, from Settings) or worked (7 h). Rule `leaveWeekDays` (`src/domain/load-week.ts`): a
    public holiday is never a day of absence (as `absenceWeeks` when Cursus pushes one), Leave wins over Absence the same
    day. Tiles: availability of the week (35 h basis), leave days, public holidays by name (no "weeks under 60 %" tile:
    one week).
  - *Resources / Project resources:* a table instead of the heatmap — load % (heat colours), hours on the 40 h week the
    capacity bars use (320 h ÷ 8), hours above capacity, over-allocation in the attention colour (> 110 %, the tile's rule)
    and the **split by project** — since the owner's second answer (§6) the hours the projects' schedules assign the person
    that week (activity assignments), e.g. "HLT-026 40 h · 4 h assigned beyond the load"; "—" for a person nobody assigns,
    and the footnote only when the schedules assign no one in the table that week. KPI tiles on that week; the Project resources bars count
    40 h per person ("Week shown, by department", "Hours by role, week shown"); the portfolio bars stay the stored 8-week
    department totals (R-084, unchanged).
- **8-week view** — the R-085 view, now with **Previous 8 weeks** / **Next 8 weeks** (a full page, clamped to the ±52-week
  bound, disabled at it) on top of the one-week steps.
- **Exports** follow the view: one week adds "Hours" and "Above capacity" to the load sheet; Leave exports the week day by
  day (and that week's public holidays).

Pieces: `src/domain/load-window.ts` (`LoadView`, `parseLoadViewParam`, `loadViewWeeks`, `stepWindowStart`, `isPastWindow`,
`workingDaysOf`; `loadWindow(today, week, view)` — the view is a required parameter; `LoadWindow` gains `view`, `end`,
`prevPage`, `nextPage`), `src/domain/load-week.ts` (`weekLoad`, `hoursOfLoad`, `leaveWeekDays`, `HOURS_PER_PERSON_WEEK`),
`getLoadWindow(week, view)` and `getWeekProjectSplit(weekStart)` (`resources.ts`), `getLeaveWeek(country, weekStart)`
(`hr.ts`), `LoadWindowNav` (view switch, page steps), `LeaveWeekView` (`leave-view.tsx`), week table in `resources-view.tsx`
and `model.ts` (`weekRows`, `rolesSub`), `projectDepartmentDemand(people, hoursPerPerson)`.

### b) "What-if : OUI"

The what-if has the same navigation (8 weeks only — no view switch: Previous 8 weeks · Previous week · Current week ·
Following week · Next 8 weeks, `?project=…&week=…`). The horizon is **carried through every action**: the page passes its
window start (`WhatIfData.horizon`) to lever toggles, priority, auto-level, Select → drafted requests, New scenario (the
"selected scenario" basis copies the levers of that horizon), rename and delete. The Server Functions validate it as the page
validates `?week=` (`whatIfWindow`, `resources.ts`): absent = the current window; malformed or out of bounds = **refused**
("Invalid request" — never a silent fallback to another horizon than the screen's); entirely past = refused. The DAL writers
take it too (`toggleScenarioLever`, `autoLevelScenario`, `applyScenario`, `createScenario` — optional last parameter; the
Suggested rebalancing "Apply" on Resources keeps the current horizon). The rates are valued at the horizon start (R-083), as
before.

- **Saved scenarios across horizons.** The levers are derived per horizon (a relief lever exists only where its person is
  overloaded). Saving on one horizon replaces that horizon's lever rows only; rows of levers it does not derive (saved on
  another horizon) are kept (`saveScenarioLevers`). The stored result notes its horizon (`result.horizonStart`, no
  migration). A lever the horizon does not derive cannot be toggled there.
- **Past horizon** (its last day before the business date, `isPastWindow`): read-only — no New scenario, no lever toggles,
  priority, auto-level or Select — with the reason "These weeks are past: the levelling is read-only — levers, auto-level and
  Apply work from the current week on" (new string; no existing one said it). A horizon that ends this week is not past.
- The export follows the page's horizon (`?week=`).

### Values on the demo data set (25 Sep 2026)

Default views unchanged (8 weeks from 21 Sep; the what-if on the current horizon gives the same values as before). New:

| Where | Value |
|---|---|
| What-if HLT-026 `?week=2026-09-28` | over by week [0,1,2,3,2,0,1,0] (the prototype's), levers as current |
| What-if from 16 Nov | no relief lever (Julien Wagner no longer overloaded); "Protect people" auto-level = extra crew; Select drafts 2 requests (overtime, extra crew) instead of 3 |
| What-if from 27 Jul | read-only (past) |
| Leave, week of 9 Nov | Armistice on Wednesday; Fabien Bertrand 4 days of leave (the 8-week grid counts 5 — the prototype's seeded LEAVE_DAYS — the day view does not count the holiday), 0 h either way; Julien Wagner Monday off |
| Resources, week of 12 Oct | Julien Wagner 130 % = 52 h / 40 h, +12 h, over-allocated |

### Tests

`src/domain/load-window.test.ts` (view parsing, week view, page steps and bounds, links with `?view=`, past window, week
load and leave-by-day rules); `src/server/dal/load-window.test.ts` (getLoadWindow with view, getLeaveWeek on 28 Sep, 9 Nov,
an empty week; Leave page week view EN/FR; 8-week page links; Resources and Project resources week view; exports per view;
split by project with inserted rows); `src/features/resources/whatif-horizon.test.ts` (what-if navigation and links, golden
horizon `?week=2026-09-28`, past horizon read-only on page and actions, invalid horizon refused, auto-level / toggle on a
non-current horizon and the other horizon's levers kept, Select drafting that horizon's requests, export horizon). The
prototype-golden comparisons keep `?week=2026-09-28`.

### Open questions (new)

6. Week view on Leave: the seeded weeks counted 5 leave days in the Armistice week (8-week grid); the day view counts 4.
   When Cursus pushes absences, both agree (holidays are removed at reception). Keep as is?
7. ~~Split by project in the week view: from the schedule's assignments, resource requests or a future allocation entry?~~
   Answered 17 Oct 2026 (second round): from the project assignments (§6).
8. Suggested rebalancing on Resources / Project resources stays on the current horizon (it is not the what-if screen) even
   when another window is shown. Follow the window shown?

## 6. Owner answers 17 Oct 2026 — second round

### Split by project: « la répartition projet est à tirer des affectations projets »

The "By project" column of the week view (Resources, Project resources) and of its export now comes from the **activity
assignments of every project's schedule** (`activity_assignments` with a person), not from allocation rows per project.

- **Spreading rule** (`assignmentHoursInWeek`, `src/domain/load-week.ts`): an assignment works on every working day of its
  activity's calendar (its own, else the project's, else Standard 5d · 8h — Settings public holidays and calendar exceptions
  applied) between the activity's start and finish dates as the schedule stores them (actual start, forecast finish; both
  inclusive). The week (Monday–Sunday) receives the working days that fall inside it. Hours per working day = units × hours
  per day per unit ("40 h/wk" → 1 × 8 h) — the rate the what-if levelling loads a person with (`weeklyHours`); when the rate
  is unknown, the planned hours spread evenly over the activity's working days. An undated activity, or an assignment counted
  neither way (equipment days, material tonnes), adds nothing. Crews and other unnamed resources are not pool people: left out.
- **Display — hours**, as the load column next to it ("52 h / 40 h"): projects largest first, then the load no assignment
  covers — "12 h not assigned" / « 12 h non affectées » — or the assignments above the load — "4 h assigned beyond the load" /
  « 4 h affectées au-delà de la charge » (`weekSplitText`, shared by the screen and the export). A person nobody assigns that
  week shows "—" (no "52 h not assigned": nothing to split). Project resources shows each team member's **whole week**, every
  project included (the load is the person's, not the project's).
- **Footnote** only when the schedules assign no one in the table that week: "The projects' schedules assign no one in this
  table this week: no split by project." (replaces the former "The allocations hold one weekly total per person…").
- **Export** of the week view (Resources, Project resources): a "By project" column with the same text.
- **Allocation rows per project dropped** as the split's source: `getWeekProjectSplit(weekStart)` (`resources.ts`) now reads
  the assignments (dated across the week, all projects, calendars per project) and returns hours per project by person.
  Nothing fed `allocations.project_id`, and two sources for one column would disagree; the column stays in the schema (no
  migration) and the pool readers still ignore those rows (`project_id IS NULL`).

### Values on the demo data set (25 Sep 2026)

The demo holds one named assignment: Julien Wagner on HLT-026 A1250 (17 Aug – 9 Oct 2026,
"40 h/wk", Standard 5d · 8h) — 40 h a week from 17 Aug to the week of 5 Oct, nothing from 12 Oct.

| Week view | Julien Wagner — load | By project |
|---|---|---|
| Current week (21 Sep) | 0 % · 0 h / 40 h (no seeded allocation that week) | HLT-026 40 h · 40 h assigned beyond the load |
| 28 Sep | 90 % · 36 h | HLT-026 40 h · 4 h assigned beyond the load |
| 5 Oct | 100 % · 40 h | HLT-026 40 h |
| 12 Oct | 130 % · 52 h | — (footnote: nobody assigned that week) |

Everyone else shows "—"; the footnote no longer shows in the weeks of 17 Aug – 5 Oct.

### Tests

`src/domain/load-week.test.ts` (new: spreading rule — in/out of the activity dates, partial weeks, public holiday, 6-day site
calendar, planned-hours fallback, undated / unmeasured assignments; sums per person and project; cell text EN/FR, not assigned
and beyond the load); `src/domain/load-window.test.ts` (`weekLoad` with hours); `src/server/dal/load-window.test.ts` (the
demo weeks above, a NDC-031 assignment inserted on 14–23 Oct → "NDC-031 18 h · 34 h not assigned" on Resources, Project
resources HLT-026, the CSV export and in French; footnote shown / hidden).

### Open questions (new)

9. A person assigned more than their allocation (Julien Wagner, 21 and 28 Sep): the allocation rows and the schedules
   disagree. Should the week load itself come from the assignments (R-084, single capacity source), or stay the allocation
   with the gap shown as today?
10. Activity owners without an assignment are not counted (the what-if counts them at 2 h/d, `WHATIF_RULES.ownerHoursPerDay`).
    Count them in the split too?
