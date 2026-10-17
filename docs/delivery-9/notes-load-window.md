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

**What-if.** Its horizon is always the current window (no navigation): its levers, saved scenarios and the requests "Apply"
drafts are computed without the page's parameter, and a past horizon cannot be levelled.

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

1. Previous / next on the what-if too (one horizon carried through every action)?
2. Step: one week per click (rolling) or a full 8-week page? The ±52-week bound is a Keystone default.
3. Move the other load readers (Home, alerts, Approvals, My work, Site conflicts) to the current window — with R-084?
4. "Capacity vs demand" keeps its stored totals until R-084.
5. Settings public holidays exist for 2026 only: a 2027 window shows none.
