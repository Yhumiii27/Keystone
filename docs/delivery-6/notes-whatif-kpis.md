# Delivery 6 — notes: what-if levelling and KPIs (lot B)

Scope: `docs/DELIVERY-6-PLAN.md` §3.3 (whatif) and §3.8 (kpis). These notes feed the what-if and A-12 sections of
`docs/DELIVERY-6.md`. Decisions applied: **S-7 = a** (scenarios saved, "Apply" creates requests), **R-3 = a** (suggested
rebalancing "Apply" drafts a request), **A-12 = a** (hard-coded KPIs become formulas on the data). Where the plan said
"decide with the user", the plan's recommended option was used; each choice is listed below.

## 1. What changed

### What-if (`/resources/what-if`)

| Gap (plan §3.3) | Change |
|---|---|
| Load delta not visible | New result row **"Load change (h)"** (`loadDeltaH`, rounded, signed: "−24", "+16", "0") on every scenario card and in the side-by-side table (`resultRows`, `loadChangeText` in `src/features/resources/whatif-model.ts`). The what-if export (`src/server/export/providers/resources.ts`, `whatIfWorkbook`) gets a matching **"Load change (h)"** column on the Scenarios and Levers sheets (3-line change; asserted in `providers.test.ts`). |
| Basis / Horizon did nothing | **Basis**: "Current plan" (no lever) or **"Selected scenario (copy its levers)"** (`last_approved`): the new scenario starts with the levers and priority of the retained scenario — the selected one, else the one applied last (`retainedScenario` in `src/server/dal/resources.ts`). Refused with a translated error when no scenario is selected or applied. The inert **"Baseline BL1"** basis and the **Horizon** field are removed (see §3). The `basis` / `horizon_months` columns stay (no migration); old rows keep their values. |
| No project selection | Without `?project=`, the page **redirects** to `?project=<viewer's current project>` (`getLastProject()`), so the URL and the header's Export (which reads `?project=`) always name the project shown. The PageHeader shows the **project switcher** on this global screen (new `projectParam` prop); picking a project sets `?project=` instead of swapping the path (`ProjectSwitcher` `param`). The read-only tag follows the project scope. `WHATIF_DEFAULT_PROJECT` is gone; `whatIfHref(code)` builds the link. |
| Double-submit / partial failure | "Select scenario → create requests" and "Auto-level" are **disabled while a Server Function runs** (`useTransition` pending, `aria-busy`). On the server, `applyScenario` runs the duplicate check, the draft inserts, the lever save, `markScenarioApplied` and the activity record in **one transaction**; `applyLever` (suggestion "Apply") too. `createResourceRequest(input, requestedBy, tx?)` now accepts the caller's transaction. PGlite serialises transactions, so a second concurrent apply sees the first one's drafts and skips them; a failure rolls back drafts and stamp together. |
| Dept-head Home constants | See KPIs below (done once for both features). |
| `OPEN_REQUESTS_LEVEL4` fallback | Removed from `src/domain/hr.ts`. The Skills tile shows **"—"** (empty sub) when no computed value is passed; the page always passes `requestsNeedingExperts(...)`. |
| Dead store code | `listScenarioActions`, `replaceScenarioActions`, `saveScenarioResult` deleted from `src/server/dal/whatif-store.ts` (only `markScenarioApplied` remains). `whatif_scenario_actions` has a single writer (`saveScenarioLevers` / `toggleScenarioLever`) and a single params shape: `{ leverCode, resource, from, to, driving, helper }`. |
| Missing tests | `src/features/resources/actions.test.ts` "what-if — fresh data": suggestion Apply creating a fresh draft (RQ-045, 100 h) and the **"Requested · RQ-045" / "Demandée · RQ-045"** tag on the next render; a double-click on Select drafts once; **activities rows unchanged** (DB-level) after select/apply; a fixture (A1320 owned by Julien Wagner, overloaded in weeks 42–44) yields `shift:A1320` and the toast **"… · 1 shift to enter in the plan before the next Reschedule"**; basis copy. `resources-page.test.ts`: redirect and switcher. `chapter4-foundation.test.ts`: stamp + draft in one transaction, rollback on failure. |

### KPIs (A-12)

| Gap (plan §3.8) | Change |
|---|---|
| (1) Average cycle never counted Keystone RFQs | `rfqKpiFacts` (`src/server/dal/kpis.ts`) takes the send date from the earliest audit entry that is either `status: Draft → Open` (Send to suppliers) **or** `RFQ sent to %` (New RFQ creates it Open). Writes test in `src/features/procurement/model.test.ts`: create → two quotes → compare → award → cycle "9 d" (audit and award instants pinned because the writers use the real clock). The award date still falls back to `reply_due_on` when `awarded_at` is null (seed only). |
| (2) "Last vault sync" always said "today" | `vaultSyncDayText(syncedAt, asOf)` in `src/domain/drawings.ts`: same Paris day as the data date → "today", the day before → "yesterday", otherwise the run's date ("26 Sep"); FR "aujourd’hui" / "hier" / "26 sept." (new FR key `read-only` → "lecture seule"). |
| (3) Dept-head Home constants | `deptHeadHome` gets the pool's week starts and the department capacity rows (`src/server/dal/home.ts`) and computes **"Peak weeks 42–44"** and **"280 h · Mostly engineering"** exactly as Resources does. `peakWeeksText` / `shortfallText` moved from `src/features/resources/model.ts` to `src/domain/resources.ts` (re-exported by the feature); Home uses Txt templates `peakWeeksTxt` / `shortfallTxt` (FR in `src/i18n/extra/ch4-kpis.json`). Goldens overridden in `src/server/dal/home.test.ts` with an "A-12" comment (`DEPTHEAD_A12`); the prototype golden JSON is untouched. |
| (4) NCR from another quarter | New case in `src/server/dal/delivery5.test.ts`: a closed HLT-026 NCR whose Vigie closure is moved to 15 Jun 2026 drops out of "N closed this quarter" (restored afterwards). |
| (5) Literals | Member Home "Next week" sub = `spanText(nextWeekEnd() − 4, nextWeekEnd())` and the bucket uses `nextWeekEnd()`; "of 40 h" = `weekHoursOf()` (standard calendar 5 × 8 h, S-2). Same displayed values. `capacityModel` takes the 8 pool weeks **from the data date's week** (`weekMondayOf(asOf)`, default `DEFAULT_DATA_DATE`) instead of the first 8 allocation weeks; same weeks on the seed. The static capacity options of Portfolio finance were left alone (no data to derive them). |

## 2. What-if rules (for `DELIVERY-6.md`)

Pure logic in `src/domain/whatif.ts`; formatting in `src/features/resources/whatif-model.ts`; DB in `src/server/dal/resources.ts`.

**Levers derived from the data** (one row each, shared by every scenario card of the project):
- **Overtime** — a *critical* activity (total float ≤ 0) with labour assignments: the driving assignment (most units × h/d)
  goes to 10 h/d, or +2 h when already there, never above 12 h/d — only when it shortens the remaining duration.
- **Extra resource** — on a critical activity's driving assignment: +1 unit (a crew gets one more unit; a named person gets
  the least-loaded colleague of a non-overloaded department who stays ≤ 100 %, else a contractor at the rate card's
  external rate). Also as **relief** (duration unchanged, work shared) on the assignment of an *overloaded* person (a
  horizon week > 100 %) or of a person of an overloaded department (8-week demand > capacity).
- **Shift** — a *not started, non-critical* activity with total float ≥ 1 d (no constraint or SNET) whose assignee/owner
  is above 100 % while it runs: SNET later by min(float, 5) working days.

**`WHATIF_RULES`**: normal 8 h/d; overtime 10 h/d (+2 h step, max 12); +1 unit; shift ≤ 5 working days; owner without
assignment loads 2 h/d; 40 h week; overloaded > 100 %; helper ≤ 100 %; overtime factor 1.25 when the rate card has no "ot";
default rate €60/h; external premium ×1.4; critical TF ≤ 0; display thresholds from the prototype (cost alert > 12 k€,
peak > 115 %, bars > 100 %, full bar 140 %).

**Duration model**: remaining R' = ⌈R × (u·h) / (u'·h')⌉ on the driving assignment, CPM rerun on an in-memory copy of the
network at the data date (the plan is never written).
**Load model**: each assignment loads its person with units × h/d over the remaining span (owners without assignment 2 h/d);
deltas per horizon week ÷ 40 h → % load; "Load change (h)" = Σ hour deltas of the team over the horizon.
**Cost model**: labour of the remaining work at the rate card (internal by job title, external role, overtime premium above
8 h/d × (factor − 1)); equipment and material not costed.
**Auto-level**: protect the date → levers that gain days; protect the budget → levers that cost nothing and gain days or
relieve; protect people → extra resources and shifts that relieve overloaded people without putting anyone else above 100 %.

**`LEGACY_LEVERS`** (seeded scenarios A/B kept the prototype's lever codes until edited): overtime → overtime;
contractor → extra resources that are not an internal colleague; move → internal colleagues; delay → shifts; split → none.
Once a scenario is saved (`whatif_scenario_actions` rows or `computed_at`), its own rows win.

**Draft-request flow**: "Select scenario → create requests" marks the scenario selected, then (one transaction) turns its
enabled levers into **DRAFT** resource requests through the requests DAL — overtime → the extra hours of the assignee (or
the crew as a contract role); extra resource → the added unit, colleague or contractor; shifts create no request (the
toast asks to enter them in the plan). Levers already requested from this scenario (open status) are skipped; the scenario
is stamped applied (audit + activity) when something was drafted. Drafts are invisible to the department until "Send" in
Resource requests; the plan changes only at the next Reschedule. A suggestion "Apply" drafts one lever with no scenario and
skips it when any open request of the project already matches.

## 3. Choices made

- **Basis**: "Baseline" was **not** implemented. The levers are derived from the current plan and shared by every card,
  and a baseline snapshot has dates but no progress or remaining durations, so a baseline-based scenario would need its
  own lever set and its own "current" column — a different screen. "Last approved" was implemented as "copy the retained
  scenario" (selected, else last applied), which is what a PM can act on.
- **Horizon**: removed. The resource pool has 8 allocation weeks (≈ 2 months), shorter than every option (3/6/12 months),
  so the field could only lie. If the pool gets more weeks, `ctx.weeks` is the single place to cut or extend.
- **Project selection**: redirect + switcher (both plan options). The sidebar entry opens the current project.
- **Load delta**: shown (recommended option); `overloadDeltaH` is not shown (it feeds auto-level and the suggestion ranking).

## 4. A-12 KPI old → new (seed, data date Fri 25 Sep 2026)

| Screen · tile | Prototype | Now | Rule |
|---|---|---|---|
| Portfolio finance · Portfolio margin | 18 % | **8 %** | Σ (contract − EAC) / Σ contract of active client projects |
| Cash flow · Lowest cumulative point | −€490k Nov | **−€521k Oct** | billing plan in, cost forecast out, from the data date |
| Prioritisation · capacity gap (Westfield) | 1 560 h | **151 h** | pool allocations × 40 h, demand per €1M of active portfolio |
| Sourcing · Savings vs list | €12k | **€0k** | (list − awarded) × qty of RFQs awarded in the quarter |
| Sourcing · Average cycle | 9 d | **—** on the seed; RFQs created or sent in Keystone now count (test: 9 d) | mean sent → award |
| Deliveries · On-time deliveries | 83 % | **100 %** | receipts by the PO expected date, last 90 days |
| Resource requests · Average response (heads) | 1.4 d | **1.0 d** | working days sent → decision |
| Approvals (Engineering) · Average response | 0.9 d | **—** | nothing decided yet in Engineering |
| Site · Man-days planned | 168 | **179** | Σ rotation crew × working days |
| Site · Client decisions logged | 3 | **2** | change requests with a decided client step |
| ECO · Released this month | 2 · €10,360 | **1 · €9,400** | released ECOs of the data date's month |
| Team · Interfaces due within 30 days | 2 | **1** | open interfaces needed within 30 days |
| My work / member Home · Logged this week | 14.0 h | **7.0 h** | time entries of the week |
| Activity & integrations · Events today | 6 | **5** | events of the data date (Paris day) |
| Drawings · Last vault sync (sub-line) | "SolidWorks PDM · today · read-only" | **"SolidWorks PDM · 26 Sep · read-only"** | day of the latest run vs the data date (the seeded PDM connector run is 26 Sep 07:40) |
| Resources · Unmet demand | 240 h | **280 h** · Mostly engineering | Σ max(0, demand − capacity) of the department bars |
| Resources · Over-allocated sub | Peak weeks 41–43 | **Peak weeks 42–44** | ISO weeks with someone > 110 % |
| Home (department head) · Over-allocated sub | Peak weeks 41–43 | **Peak weeks 42–44** | same as Resources |
| Home (department head) · Unmet demand | 240 h · Mostly engineering | **280 h** · Mostly engineering | same as Resources |
| Skills · Open requests needing level ≥4 | 2 · Structural · Quality | **3 · Structural · Procurement · Quality / QA-QC** | pending requests naming a person whose top skill is ≥ 4 |
| Unchanged | | 0 incident (Vigie HSE), 2 rotations, Drawings in vault 1 248, Last vault sync 07:40, NCR "N closed this quarter", Client "CR to approve", My approvals "Oldest", Obsolete revisions withdrawn, member Home "Next week 28 Sep – 2 Oct" and "of 40 h" (now computed) | |

`docs/DELIVERY-5.md` still lists "Unmet demand 240 h" (l. 367), "Client decisions logged 3" and the "1 248 drawings"
volume (l. 386–387) as constants; `DELIVERY-6.md` should point to this table instead.

## 5. Open questions

1. **Seeded PDM run after the data date.** The prototype's connector row says "26 Sep 07:40" while the status date is Fri
   25 Sep, so the computed sub-line reads "26 Sep" instead of "today". Should the seed date it 25 Sep (then "today"
   again), or is the date the right display?
2. **Scenario vs suggestion duplicates.** A scenario only skips levers already requested *from that scenario*; a lever
   drafted from a suggestion (no scenario) is drafted again when a scenario containing it is selected (and two scenarios
   with the same lever each draft it). Should Select skip any open request of the project for the same lever?
3. **"Last approved" wording.** Implemented as "the selected scenario, else the last applied". Is a formal approval step
   (e.g. by the department head) wanted before a scenario counts as approved?
4. **Baseline-based scenarios.** Wanted later? It needs per-scenario lever sets and a baseline "current" column.
5. **Horizon.** If Cursus/Lucca provide loads beyond 8 weeks, re-introduce the horizon on `ctx.weeks`.
6. **Supplier quotes** have no writer in Keystone (the cycle test inserts them directly); confirm they come from
   suppliers/Sage before building one.
