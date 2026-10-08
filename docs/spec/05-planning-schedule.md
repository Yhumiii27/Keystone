# 05 — Planning: Schedule, WBS plan, Portfolio schedule, What-if, Meetings, Stakeholders

Source prototype: `design/Keystone PM v8.dc.html` (template lines quoted from `design/_extracted/template-annotated.html`, which has the same line numbers). Logic lines refer to the `class Component` in the original file. All example values below were obtained by evaluating the prototype logic for project `HLT-026` (Harbor Line Terminal Expansion) unless stated otherwise.

| Screen | Route key (`screen`) | Flag | Template lines | Logic lines | Nav location | Primary action |
|---|---|---|---|---|---|---|
| Schedule (Gantt baseline vs forecast) | `schedule` | `isSchedule` | 485–572 | 3847–3864 | Project › Steering › "Schedule" | "Re-baseline" (AF `schedule`) |
| Plan — WBS & activities (+ activity drawer) | `plan` | `isPlan` | 1024–1166 | 3971–4047 | Project › Steering › "Plan — WBS" | "Add activity" (Structure view) / "Update progress" (Progress view) |
| Portfolio schedule | `pfplan` | `isPfPlan` | 972–1023 | 4523–4555 | Portfolio › "Schedule" | none |
| What-if levelling | `whatif` | `isWhatif` | 1504–1528 | 4406–4419 | Resources › "What-if levelling" | "New scenario" (AF `whatif`) |
| Meetings & minutes | `meetings` | `isMeetings` | 753–813 | 4817–4867 | Project › Team & exchanges › "Meetings & minutes" (badge) | "New meeting" (AF `meetings`) |
| Stakeholders & RACI | `stakeholders` | `isStakeholders` | 870–879 | 4930–4936 | Project › Team & exchanges › "Stakeholders & RACI" | "Add stakeholder" (AF `stakeholders`) |

---

## 0. Conventions shared by every screen in this area

### 0.1 Page frame (template 76–162, logic 5105–5177)

Every screen renders inside the common header, documented in the frame spec. The parts that matter here:

- **Crumb** (`crumbOf()`, 5163). It shows the nav section, then the group, then an extra part. Examples: Schedule and Plan give "Project · Steering" (FR "Projet · Pilotage"). Meetings and Stakeholders give "Project · Team & exchanges" (FR "Projet · Équipe & échanges"). Portfolio schedule gives "Portfolio · FY2026", and adds " · <zone name>" when a zone filter is on (`zoneCrumb`, 3903). What-if gives "Resources".
- **Project picker** (`showProjectPicker`, 5175). It is shown for `schedule`, `plan`, `meetings` and `stakeholders`. It is not shown for `pfplan` or `whatif`. Next to the title sits a project health tag (`projectHealthClass`), plus a "Read-only" tag when `projReadOnly`.
- **Title** (`titles[screen]`, 5109):

| Key | Title (EN) | FR |
|---|---|---|
| schedule | Schedule | Planning |
| plan | Plan — WBS & activities | Plan — WBS et activités |
| pfplan | Portfolio schedule — projects in progress & pipeline | Planning du portefeuille — projets en cours & pipe |
| whatif | What-if levelling | Lissage what-if |
| meetings | Meetings & minutes | Réunions & CR |
| stakeholders | Stakeholders & RACI | Parties prenantes & RACI |

- **Primary button** (`primary` map, 5137). It is a `btn btn-primary` with a `ph-plus` icon. It is hidden when `outside`. It is also hidden when `projReadOnly` and the screen is project-scoped (schedule, plan, meetings, stakeholders).
- **Action-form dialog** ("AF", template 138–157, logic 5111–5135). It is a generic modal: `dialog` width `min(640px,100%)`, top padding 8vh, `max-height:84vh`, scrollable. The fields sit in a 2-column grid. Textareas and the fields with id `title|name|progress|reason|why` span both columns (`1 / -1`). The subtitle reads "<project name> · Required fields are marked · *". Required fields carry an accent `*`. The submit button is disabled until every required text or number field is non-blank (`afValid`); selects always pass. Buttons are "Cancel" (secondary) and submit (primary). The icon is `ph-play` for `kind:'run'` and `ph-check` for `kind:'create'`. On submit the dialog closes and a toast shows `AF_RESULT[key]`, prefixed per key.
- **Toast** (template 159–161). It is a fixed card at bottom-right (22px offset) with a `ph-check-circle` accent icon and an `accent-800` border. It auto-hides after 4 s (`showToast`, 5116). In FR, each " · " segment is translated with `frSeg`.

### 0.2 Language, colours, formatting

- **Default language is French.** The initial state has `lang:'fr'`. The EN/FR toggle is in the header (`langSeg`). All strings are authored in EN and translated at render time (`renderVals` → `deepTr`). The rebuild should use real i18n keys. The FR column in this spec gives the dictionary value where one exists.
- Two colour constants are used throughout:
  - `LO = 'var(--color-accent-300)'` means "attention/bad".
  - `OK = 'var(--color-text)'` means neutral/good.
  - Nocturne has no red. "Late" or "bad" is always rendered with the lighter accent `accent-300`.
- Tag classes (Nocturne):
  - `tag tag-accent` has an `accent-800` background with `accent-100` text. It is used for "hot", e.g. Late or Behind.
  - `tag tag-outline` is an accent outline, used for pending or at-risk states.
  - `tag tag-neutral` has a `neutral-800` background and is used for done or inert states.
  - `text-muted` is plain dimmed text.
- **Money** is formatted by `money(k, signed)` (3775); values are in k€.
  - EN + EUR: `€280k`, `€4.65M`, signed `+€18k`, negative `−€…` (U+2212).
  - FR + EUR: `280 k€`, `4,65 M€`.
  - USD (prop `currency`) uses `$`.
- `pct(v)` (3133) returns `Math.round(v*1000)/10 + '%'`, which is the geometry unit for every Gantt bar.
- **KPI tile** (identical on all six screens):
  - Container: `card elev-sm`, gap 3px, padding 12px 14px.
  - Label: 10.5px, uppercase, letter-spacing .08em, `neutral-400`.
  - Value: 22px, weight 500, letter-spacing −0.02em, coloured by `k.color`.
  - Sub-line: 11.5px, `neutral-400`, `text-wrap:pretty`.
  - Grid: `repeat(auto-fit,minmax(160px,1fr))` on Schedule and `minmax(150px,1fr)` elsewhere; gap 10px.
- **Segmented control** (`seg()`, 3889): `.seg` with `.seg-opt` buttons at 12px and padding 4px 10px. The active option has `color: accent` and `box-shadow: inset 0 0 0 1px accent`. Each option after the first has `border-left: 1px solid var(--color-divider)`. An optional Phosphor icon precedes the label.
- **Filter chips** (`chips()`, 4110):
  - Button with padding 4px 10px, radius `--radius-md` and 12px text, followed by a count in 11px `neutral-400`.
  - Active chip: background `accent-900`, border `accent-700`, text `accent-200`.
  - Inactive chip: transparent background, border `neutral-800`, text `neutral-300`.
  - Hover: background `neutral-900`.
- Filter-row prefix `FL.*` (5210): a `ph-eye` or `ph-funnel` icon in accent, then a 12px `neutral-400` label. Labels: "Display" (FR "Vue"), "Stage" ("Étape"), "Status" ("Statut").

### 0.3 Dates and "now"

The prototype mixes several hard-coded "now" values. The rebuild should derive them all from one **data date** per project and the current date.

| Constant | Value | Meaning / used by |
|---|---|---|
| Header `statusDate` | "25 Sep 2026" | Global status date (header) |
| Plan "Data date" chip and Progress header | "25 Sep 2026" (hard-coded string) | Plan screen |
| `PD.tNow` | 8.8 (months from project start, HLT start = Jan 2026), i.e. about 25 Sep 2026 | Gantt "Today" line, generated progress |
| `PG_NOW` | 8.97 months from 1 Jan 2026, i.e. about 30 Sep 2026 | Portfolio Gantt today line, meeting/stakeholder staleness, action overdue |
| `TODAY` | 4 (day offset), i.e. Fri 25 Sep 2026 (`dayDate`) | To-dos (due texts) |

Date helpers (data section 3133–3306 and 3672, 3761–3762):

- `mIdx("12 Jan 2026")` returns a fractional month index from Jan 2026: `(y-2026)*12 + month + (day-1)/30`. `"Dec 2026"` gives 11. `"—"` or empty gives null. A string without a year (e.g. `"05 Oct"`) gives **NaN**; see 2.4.
- `dateOf(m)` → "D Mon" (+ " ’27" when m ≥ 12). The day is `max(1, round(frac*30))`.
- `monthDate(m)` → Date. `fmtD(dt)` → "D Mon" (+ " ’27" if year > 2026). `fmtDY(dt)` → "D Mon YYYY". `monthLabels(start,n)` → "Jan", …, with "Jan ’27" at a year wrap.
- `wbsParseDate(s)` parses "D Mon [YYYY]" into a Date (year defaults to 2026). It returns null when invalid. It does **not** parse the "’27" short-year suffix.
- `wbsFmtDate(d)` → "DD Mon" with a 2-digit day, plus " ’YY" when the year ≠ 2026. Both helpers are used only by the "Add activity" form.

### 0.4 Role visibility (`ROLE_SCREENS`, 3465–3466)

| Persona (state `role`) | schedule | plan | pfplan | whatif | meetings | stakeholders |
|---|---|---|---|---|---|---|
| director — Marie Lefebvre, Portfolio director (`null` = everything) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| pm — Romain Aubert, Project manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| depthead — Marion Kerviel, Head of engineering | – | – | – | ✓ | ✓ | – |
| member — Julien Wagner, Structural engineer | – | – | – | – | ✓ | – |
| englead — Antoine Girard, Engineering lead | – | ✓ | – | – | ✓ | – |
| quality — Gabriel Comte, Quality manager | – | ✓ | – | – | ✓ | – |
| procurement — Fabien Bertrand, Procurement & stock | – | – | – | – | ✓ | – |
| client — Nadia Bensaïd, Client — Port authority | – | – | – | – | ✓ | – |

When a persona reaches a screen outside its list (through search, a deep link or a cross-link), `outside=true` (5155):

- A banner shows "Outside my workspace · Read-only · <persona role>" with a "Home" button.
- The nav adds a section "Outside my workspace".
- The primary action is hidden.
- `planCanEdit` becomes false.

`projReadOnly` (4173) applies when the persona has a "My projects" scope and the current project is not theirs; for the PM persona, every DEFS project except HLT-026. It only hides the primary action and adds the "Read-only" tag. **The inline WBS inputs are still editable.** Row `canEdit` and `canEditName` only check `role==='client'`, and the Owner, Dur, Budget and Predecessors inputs are not gated at all. See Open questions.

`startScreen` prop (data-props, line 3095): the enum contains `plan`, `schedule` and `whatif`, but not `pfplan`, `meetings` or `stakeholders`.

### 0.5 Project data provider `projectData(code, proj)` (3310–3339)

Schedule and Plan read everything from `PD = projectData(project, proj)`. For `HLT-026` it returns the hand-authored `HLT_PD` (3308). For the other projects listed in `DEFS` (NDC-031, RCF-019, ERP-202, WSA-044, MSR-012) it **generates** the data and caches it in `PD_CACHE`. The rebuild replaces this with real persisted data. The generation rules are given here so the demo data can be reproduced.

Inputs:

- `DEFS[code]` = {idx, start (month offset from Jan 2026), dur (months), cont, phases[4], team[], pk[[name, budget k€, baselineStart m, baselineEnd m, critical?]], cats[]}
- Project fields: `budget`, `actual`, `progress`, `spi`

Generated values:

- `cpi = clamp(budget*progress/actual, 0.70, 1.25)`
- `tNow = 8.8 − D.start`
- `floatDays = round((spi−1)*180)`
- `slip (months) = max(0, −floatDays/30)`
- **TASKS** (one per package): `as = bs + (bs>tNow ? slip : slip*0.5)`, `ae = be + slip`, `pc = clamp((tNow−as)/(ae−as),0,1)*100`. The owner is `team[i % team.length]`, abbreviated "P. Noguès".
- **MILES**: the packages at odd index, plus the last package. Name = "<package> complete", baseline = `be`, forecast = `be + slip`. Status:
  - "Done" if `fc ≤ tNow`
  - else "Late" if `slip > 0.4`
  - else "At risk" if `be < tNow+2`
  - else "On track"
- **ACTS** (WBS):
  - Root row: `{w:'1', lv:0, s, f, bl, tf:floatDays}`.
  - Per package `pi`: a WP header `{w:'1.'+(pi+1), lv:1}` followed by 4 activities, one per phase. Shares are `[.25,.25,.35,.15]` of the package's forecast span.
  - Activity id = `'A' + D.idx + (pi+1) + (ai+1) + '0'` (e.g. A3110).
  - Duration (working days) = `max(3, round(spanMonths*21))`.
  - Start gets an " A" suffix (actual) when started; finish gets " A" when complete. Baseline finish = finish − slip. Variance `v = −round(slip*30)`.
  - Predecessors: within a package, an FS chain from the previous phase, with lag 5 on the 3rd phase. The first phase of a package is linked SS to the first activity of the previous package, with lag `round((bs−prevBs)*21)`.
  - TF: null if complete; `floatDays` if the package is critical; else `((pi*7 + ai*11) % 25) + 5`.
  - Cost: budget `b0 = round(pkgBudget*share)`; actual `round(b0*pc/100/cpi)`; EAC = started ? `round(b0/cpi)` : `b0`.
  - Owner = initials of the package's team member (via `INIT_OF`), default "RA".
- `chartMonths = monthLabels(D.start,12)`; `ganttMonths = monthLabels(D.start,13)`.
- Display strings:
  - `finishText` / `baselineText` = fmtDY of (start+dur+slip) / (start+dur).
  - `floatText` = "±N days"; `floatShort` = "±N d".
  - `critText` = "N of M packages critical".
  - `milesText` = "done of total".
  - `milesSub` = "Complete · X on baseline date". X = the number of done milestones when there is no slip, and "0" when there is slip.
  - `baselineSet` = fmtDY(start+0.3).
- PV/EV/AC cash curves are generated as well; they are owned by the Budget area. Schedule uses them only for SPI and the progression chart.

HLT values (from `HLT_PD`):

- `floatDays −27`, `finishText "14 Jan 2027"`, `baselineText "18 Dec 2026"`, `floatText "−27 days"`, `floatShort "−27 d"`
- `critText "4 of 8 packages critical"`, `milesText "2 of 6"`, `milesSub "Complete · 0 on baseline date"`
- `baselineSet "12 Mar 2026"`, `pct 64`, `p3 "HLT"`
- `ganttMonths` = Jan…Dec + "Jan ’27"
- `PV = HPV` (cumulative k€): [162, 349, 733, 1133, 1573, 2290, 2622, 2975, 3420, 4151, 4569, 4800]
- `EV = HEV` = [170, 390, 700, 1060, 1450, 1880, 2300, 2710, 3080]; `AC = HAC` = [175, …, 3360]; `BAC = 4800`

---

## 1. Schedule — `screen:'schedule'` (`isSchedule`)

### 1.1 Identity

- Route key `schedule`. It is a valid `startScreen`. Nav: Project section › group "Steering" › "Schedule" (icon `ph-calendar-dots`). Project-scoped (project picker shown).
- Roles: director, pm (see 0.4).
- Prop `showBaseline` (boolean, default `true`, editor section "Schedule") toggles the baseline geometry.

### 1.2 Purpose

The schedule screen is a read-only, package-level schedule. It shows one bar per work package against the approved baseline (BL1), the project milestones, the cumulative planned-vs-actual progression, and SPI. It answers whether the project will hit its contractual finish (handover) and which packages drive the slip.

### 1.3 Layout (template 485–572)

There is a vertical stack with gap 14px, made of 3 regions:

1. **KPI row** (487–494): 5 tiles, `minmax(160px,1fr)`.
2. **Gantt card** (496–539): `card elev-sm`, padding 14px 16px, gap 10px, `overflow:auto`, so it scrolls horizontally on narrow screens.
3. **Bottom grid** (540–569): `repeat(auto-fit,minmax(min(100%,400px),1fr))`, gap 14px. It holds the "Schedule progression" card and the "Milestones" card.

### 1.4 Components

#### KPI tiles — `scheduleKpis` (3859–3864)

| # | Label (FR) | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | SPI | `spi = EV[n−1]/PV[n−1]` to 2 decimals (HLT 0.90) | "Earning {round(spi*100)}¢ of planned work per $1" (FR: "90 ¢ de travail prévu acquis par € dépensé") | LO if spi < 0.97 |
| 2 | Complete (Avancement) | `round(ev/BAC*100)%` (64%) | "Planned {round(pv/BAC*100)}% by today" (71%) | OK |
| 3 | Forecast finish (Fin prévisionnelle) | `PD.finishText` (14 Jan 2027) | "Baseline {PD.baselineText}" | LO if `PD.floatDays < 0` |
| 4 | Critical path float (Marge du chemin critique) | `PD.floatText` (−27 days) | `PD.critText` | LO if floatDays < 0 |
| 5 | Milestones (Jalons) | `PD.milesText` (2 of 6) | `PD.milesSub` | OK |

#### Gantt card (496–539)

- **Header row:**
  - `card-title` "Schedule — baseline vs forecast" (FR "Planning — référence vs prévision").
  - Right-aligned legend (12px, `neutral-300`), 4 items:
    - "Critical path": 16×8 swatch, radius 2, background `accent-800`, `inset 0 0 0 1px accent`.
    - "Task": 16×8 swatch, `neutral-800`, inset `neutral-600`.
    - "Baseline": 16×4 swatch, `neutral-600`.
    - "Milestone": 8×8 square rotated 45°, `accent`.
- **Grid:** `grid-template-columns: 230px 56px 64px minmax(560px,1fr)`, `min-width: 900px`. Rows use `display:contents`.
- **Header line** (11px uppercase, .08em, `neutral-400`, padding 6px 0, bottom border `neutral-800`):
  - "Work package" (Lot de travaux)
  - "Done" (Terminé), right-aligned
  - "Slip" (Glissement), right-aligned with padding-right 12px
  - Timeline header: an inner grid `repeat(13,1fr)` with one cell per `ganttMonths` label (11px `neutral-400`, padding 6px 0 6px 6px, left border `neutral-900`)
- **Task rows** — `sc-for tasks` (515–526). Each cell is 44px high with a bottom border `neutral-900`:
  - Col 1: name (13px), plus a `ph-lightning` icon (accent, 12px) when `t.critical`. Owner below (11.5px `neutral-400`).
  - Col 2: `t.pctText` (13px, tabular).
  - Col 3: `t.slipText`, coloured `t.slipColor`.
  - Col 4: timeline cell, `position:relative`. The background `repeating-linear-gradient(to right, neutral-900 0 1px, transparent 1px calc(100%/13))` draws month gridlines. It contains, in order:
    - Baseline bar (only when `showBaseline`): absolute, `top:31px; height:4px; radius 2px; background neutral-700; left:bL; width:bW`.
    - Forecast bar: absolute, `top:10px; height:16px; radius 4px; overflow:hidden; left:aL; width:aW; background:barBg; box-shadow:barEdge`. Its inner fill is `height:100%; width:pctText; background:fillBg`.
    - Today line: absolute full height, 1px, `accent`, opacity .7, `left:todayL`.
- **Milestone row** (527–537):
  - Label "Milestones" (13px `neutral-300`), then two empty cells, then a timeline cell with the same gridlines and no bottom border.
  - For each milestone:
    - If `showBaseline`: a baseline diamond, 9×9, `top:17px`, margin-left −4.5px, rotated 45°, `box-shadow: inset 0 0 0 1px neutral-600` (outline only), at `m.bL`.
    - A forecast diamond, 11×11, `top:16px`, margin-left −5.5px, rotated 45°, `background: m.bg`, at `m.fL`. A native `title` attribute gives the milestone name as tooltip.
  - Today line, plus a "Today" label (FR "Aujourd’hui"): `top:-2px`, 10px, `accent-300`, padding 0 4px, background `surface`, radius 3px, `translateX(-50%)`, at `todayL`.

**Geometry** (3848–3853). The timeline spans `S = 13` months starting at the project start month. `pos(m) = pct(m/13)`. Task tuple: `[name, owner, bs, be, as, ae, pct, crit]` (months from project start).

| Binding | Formula |
|---|---|
| `bL`, `bW` | `pos(bs)`, `pos(be−bs)` |
| `aL`, `aW` | `pos(as)`, `pos(ae−as)` |
| `slip` (days) | `round((ae−be)*30)` → `slipText` "+{slip}d" or "—" if ≤ 0; `slipColor` LO if slip > 14 else `neutral-300` |
| `barBg` / `barEdge` / `fillBg` | critical: `accent-900` / `inset 0 0 0 1px accent-600` / `linear-gradient(90deg, accent-700, accent-500)`; non-critical: `neutral-900` / `inset 0 0 0 1px neutral-700` / `neutral-700` |
| `todayL` | `pos(PD.tNow)` → HLT 67.7% |
| milestone `bL`, `fL` | `pos(b)`, `pos(fc)` |
| milestone `bg` | Done → `neutral-400`, else `accent` |

The legend swatch colours (`accent-800`, `neutral-800`) differ slightly from the bar colours (`accent-900`, `neutral-900`). Use the bar values for bars.

HLT task data (`HTASKS`, 3113–3121) and the rendered values:

| Package | Owner | BL start→end (m) | Fcst start→end (m) | % | Crit | Slip |
|---|---|---|---|---|---|---|
| Design & permits | R. Aubert | 0→2.5 | 0→3.0 | 100 | – | +15d |
| Site preparation | A. Ollivier | 2→4 | 2.5→4.8 | 100 | – | +24d |
| Foundations | J. Wagner | 3.5→6 | 4.5→7.2 | 100 | ✓ | +36d |
| Steel structure | J. Wagner | 5.5→8.5 | 7→9.8 | 72 | ✓ | +39d |
| Crane installation | T. Kerbrat | 7→9 | 8→10.1 | 55 | ✓ | +33d |
| MEP systems | P. Noguès | 7.5→10.5 | 8→11 | 40 | – | +15d |
| Paving & yard | A. Ollivier | 9→11 | 9.5→11.6 | 10 | – | +18d |
| Commissioning & handover | H. Sauvage | 10.5→11.6 | 11.2→12.45 | 0 | ✓ | +25d |

#### "Schedule progression" card (541–557)

- Title "Schedule progression" (Progression du planning). Sub "Cumulative % complete · SPI per month" (% d’avancement cumulé · SPI par mois). Legend: "Planned" (10×10 `neutral-700`) and "Actual" (10×10 `accent`).
- Chart: a grid of `repeat(12,1fr)`, gap 8px, height 170px, aligned to the end, padding-top 8px. It is built from divs, not SVG. Per month (`progression`, 3857–3858):
  - Top label `spiText` (10.5px, tabular), coloured `spiColor`.
  - A 120px area with two flex bars, gap 2px, radius `2px 2px 0 0`: planned (`neutral-700`, height `planH`) and actual (`accent`, height `actH`).
  - Bottom label = month (10.5px `neutral-400`).
- Formulas per month `i` of `PD.chartMonths`:
  - `planH = pct(PV[i]/BAC)`
  - `actH = EV[i] != null ? pct(EV[i]/BAC) : '0%'`
  - `spiText = (EV[i]/PV[i]).toFixed(2)`, or '' for future months
  - `spiColor`: LO if SPI < **0.93** (note: a different threshold from the KPI's 0.97), else `neutral-400`
- HLT: Jan 3.4%/3.5% SPI 1.05 … Sep 71.3%/64.2% SPI 0.90. Oct–Dec are planned only.

#### "Milestones" card (559–568)

- `card-title` "Milestones" (Jalons). One row per milestone: grid `minmax(0,1fr) auto auto`, gap 12px, padding 8px 0, top border `neutral-900`, 13px.
  - Col 1: name, plus sub "Baseline {baseDate} · Forecast {fcDate}" (11.5px `neutral-400`).
  - Col 2: `slipText` "+Nd", coloured `slipColor` (LO if > 14).
  - Col 3: status tag.
- `baseDate = dateOf(b + PD.start)`, `fcDate = dateOf(fc + PD.start)`.
- Status → tag: "Done" (Terminé) → `tag-neutral`; "Late" (En retard) → `tag-accent`; "At risk" (À risque) and "On track" (Conforme) → `tag-outline`.

HLT milestones (`HMILES`, 3122):

| Milestone | Baseline (m → date) | Forecast | Status |
|---|---|---|---|
| Permits approved | 2.5 → 15 Mar | 3.0 → 1 Apr | Done |
| Foundations complete | 6 → 1 Jul | 7.2 → 6 Aug | Done |
| Structure topped out | 8.5 → 15 Sep | 9.8 → 24 Oct | Late |
| Cranes operational | 9 → 1 Oct | 10.1 → 3 Nov | Late |
| Systems energised | 10.5 → 15 Nov | 11 → 1 Dec | At risk |
| Handover | 11.6 → 18 Dec | 12.45 → 13 Jan ’27 | At risk |

### 1.5 Interactions and state

- **None on the canvas.** There is no click, hover, drag or resize on bars or diamonds; only native `title` tooltips on milestone diamonds. The Gantt does not draw dependency arrows.
- Project picker → `setState({project})`. All values recompute.
- Primary "Re-baseline" (FR "Nouvelle référence") opens AF `schedule` (3674–3700 block, key `schedule`):

| Field id | Label | Type | Default | Required |
|---|---|---|---|---|
| name | Baseline name | text | "BL2 — after CR-006" | ✓ |
| reason | Reason | textarea | "" | ✓ |
| approver | Approver | select | Marie Lefebvre · Portfolio director / Romain Aubert · Project manager | – |
| scope | Scope | select | Dates & budget / Dates only / Budget only | – |

  - Submit "Freeze new baseline" (Geler la nouvelle référence), `kind:'run'`.
  - Effect: toast "{name} · Baseline frozen". **No data changes**: the baseline stays BL1. The real app must snapshot the dates and budgets of all activities as a new baseline. See the baseline register `BASELINES` in the Change-control area.
- Header "Export" button: no handler (global).

### 1.6 Data

`PD.TASKS`, `PD.MILES`, `PD.PV`, `PD.EV`, `PD.BAC`, `PD.chartMonths`, `PD.ganttMonths`, `PD.tNow`, `PD.start` and the PD display strings (see 0.5).

**Important:** the Schedule screen does **not** read the activity-level WBS (`ACTS`) or any edits made on the Plan screen. Packages, % complete and critical flags are independent static data. In the rebuild, the package bars should be roll-ups of WBS work packages: the earliest start and latest finish of the children, and the budget-weighted %. The "critical" flag should come from the CPM result.

### 1.7 Cross-links

- **Into the Schedule screen:**
  - Overview alerts "Open schedule" (3810, 3813) → `{screen:'schedule', project}`
  - PM home "Re-baseline proposal → Prepare" (4427)
  - Plan drawer "Show in Gantt"
- **Re-used elsewhere:**
  - PM home KPIs `scheduleKpis[0]` (SPI) and `scheduleKpis[3]` (float) (4427)
  - Client home milestone list `milestones` (4433)
  - Client portal progress chart `cpProgress = progression.slice(0,EVn)` (4682)

---

## 2. Plan — WBS & activities — `screen:'plan'` (`isPlan`)

### 2.1 Identity

- Route key `plan`. It is a valid `startScreen`. Nav: Project › Steering › "Plan — WBS" (`ph-tree-structure`). Project-scoped.
- Roles: director, pm, englead, quality. The client can only reach the screen as "outside", where `planRO=true`. `planRO` hides only the name inputs, the row action buttons and the progress inputs. The Owner, Dur, Budget and Predecessors inputs are gated by `r.isAct` alone, so they **stay editable** for every persona (prototype gap).
- This is the **default landing screen when a project is opened** from the Projects list, Overview, the map, My projects, Portfolio schedule rows, machine types, and search.

### 2.2 Purpose

This screen is the project's work breakdown structure: a project root, work packages (WBS level 1) and activities. It has two modes:

- **Structure**: build and maintain the WBS. Rename, reorder, set owners, durations and budgets, and type logic links.
- **Progress**: weekly progress entry at the data date (% complete per activity), with a budget-weighted roll-up.

Clicking an activity opens a detail drawer with relationships, resources and cost, and the team's to-dos.

### 2.3 Layout (template 1024–1166)

Vertical stack, gap 14px:

1. **Toolbar** (1026–1035): a flex-wrap row, gap 8px.
   - "Display" label (`ph-eye`) + seg `planSeg`: "Structure" (`ph-tree-structure`) / "Progress" (`ph-chart-bar`). FR "Structure" / "Avancement".
   - Three `.input`-styled chips (auto width, min-height 32px, 12.5px, padding 4px 10px). **None of them has a handler.**
     - `ph-calendar` "Calendar" / "Site 6d · 10h" + caret-down (FR "Calendrier" / "Chantier 6j · 10h")
     - `ph-flag-banner` "Baseline" / "BL1 · 12 Mar 2026" + caret-down (FR "Référence" / "BL1 · 12 mars 2026")
     - `ph-clock` "Data date" / "25 Sep 2026" (FR "Date de référence"), no caret
   - Right-aligned (`margin-left:auto`): `btn btn-secondary` 13px "Reschedule" (`ph-arrows-clockwise`, FR "Replanifier") and "Set baseline" (`ph-flag-banner`, FR "Fixer la référence"). **No handlers.**
2. **KPI row** (1036–1044): 5 tiles, `minmax(150px,1fr)`. The contents depend on the view (2.4.1).
3. **Structure card** (1045–1070), when `planIsStructure`, **or** **Progress card** (1071–1104), when `planIsProgress` (the default: `state.planView='progress'`).
4. **Activity drawer** (1105–1163), when `selOpen`.

All three values on the Calendar, Baseline and Data date chips are hard-coded strings that do not change per project.

### 2.4 Components

#### 2.4.1 KPI tiles — `planKpis` (4036–4046)

Definitions: `acts` = all activities after edits; `actBehind` = activities with `tf<0` and `pc<100`.

**Structure view:**

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Work packages (Lots de travaux) | number of WBS level-1 headers (8) | "{n} activities · {f(Σ budget)}" ("21 activities · €4.65M") | OK |
| Activities (Activités) | count (21) | "{actBehind} on the critical path" (5); this actually counts behind activities, see Open questions | OK |
| Relationships (Liens) | Σ predecessors (30) | "FS {n} · SS {n} · FF {n}" (25/3/2); SF is not listed | OK |
| Constraints (Contraintes) | activities with a constraint (4) | "{n} violated" (1) | LO if any violated |
| Baseline (Référence) | "BL1" (hard-coded) | "Set {PD.baselineSet} · {n} activities" | OK |

**Progress view:**

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Overall progress (Avancement global) | `round(Σ(b0·pc)/Σb0)` + " %" (63 %) | "weighted by budget · data date 25 Sep 2026" | OK |
| Completed (Terminée) | "{done} / {total}" (10 / 21) | "{f(Σ b0 of done)} earned" | OK |
| In progress (En cours) | 0 < pc < 100 (3) | "{actBehind} behind schedule" | LO if any behind |
| Not started (Non démarré) | pc = 0 (8) | "Next start · {id} · {start}", or "All activities started" | OK |
| Project float (Flottement projet) | `PD.floatShort` (−27 d) | "Finish {PD.finishText} vs BL1 {PD.baselineText}" | LO if floatDays < 0 |

"Next start" sorts not-started activities by `mIdx(s)`. Start strings have no year, so `mIdx` returns NaN, and the sort falls back to WBS order. The rebuild must sort by real start date.

#### 2.4.2 Row model `planRows` (3993–4018)

`ACTS_P` is built from `PD.ACTS` plus the per-project overrides (`wbsOv`, `wbsRm`, `wbsOrd`) and the additions (`added.wps`, `added.acts`); see 2.5. Each element of `ACTS_P` becomes one row, except activities whose WP is collapsed.

| Row kind | Detection | `id` shown | Indent | Weight |
|---|---|---|---|---|
| Project root | `!a.id && a.lv===0` (`isRoot`) | "1" | 0 | 500 |
| Work package (summary) | `!a.id && a.lv===1` (`sum`) | WBS code "1.4" | 18px | 500 |
| Activity | `a.id` (`isAct`) | "A1250" | 36px | 400 |

**Roll-up `roll(w)`** for WP rows (3988):

- `s` = first child's start; `f` = **last child's finish** (in display order, not the maximum date); `bl` = last child's baseline finish
- `pct = round(Σ(b0·pc)/Σb0)`, budget-weighted
- `tf` = min of unfinished children's TF (null counted as 0), or null when all children are complete
- `bud = Σ b0`; `n` = number of children
- `td` / `tdd` = linked to-dos (total / done)
- `v` = null, so the WP variance cell is blank

**Root row**: s/f/bl/tf come from the root ACTS entry; `pct = PD.pct` (64, static); `v = PD.floatDays`; `bud = Σ b0` of all activities; to-dos = all to-dos of the project (`todo.project === PD.p3`).

**Derived per row:**

- `behind = tf != null && tf < 0 && pct < 100`. This is shown as `critical`: a lightning icon and the "Behind" status.
- `statusText` / `statusClass`:
  - 100 → "Completed" (Terminée), `tag-neutral`
  - behind → "Behind" (En retard), `tag-accent`
  - pct > 0 → "In progress" (En cours), `tag-outline`
  - else "Not started" (Non démarré), `text-muted`
- `barColor`: 100 → `neutral-500`; behind → LO; else `accent`.
- `tf` text: "—" if null, else "+N d" / "−N d"; LO if negative. `var` text: "{v}d", LO if negative.
- `preds` (display): "A1240 FS, A1220 FS+10d". `predsText` (input value): raw override text if one exists, else "A1240 FS, A1220 FS+10" (no "d").
- `cons` = the constraint string or "—"; LO if `viol`.
- `dur`: activity "{d}d"; WP "{n} act."; root "21 act.".
- `budget`: activity = raw number string (k€) for the input; WP/root = `f(bud)`.
- `todos` = "done/total", or "" when there are none.
- `mark` = 'new' if added, 'edited' if overridden, else ''. A non-empty mark shows a 6px accent dot after the ID (Structure view only). WP renames do not set `edited`.
- `bg` = `accent-900` when `state.sel === a.id` (the selected activity stays highlighted even when the drawer is closed); otherwise transparent.
- `caret` = `ph-caret-right` if the WP is collapsed, else `ph-caret-down`. Default `collapsed = {'1.1':true,'1.2':true,'1.3':true}`.

#### 2.4.3 Structure card (1045–1070)

- **Header:**
  - Title "Work breakdown structure" (Structure de découpage (WBS)).
  - Sub "Build the WBS · rename, re-order, assign owners, durations and budgets · logic as “A1010 FS+5, A1020 SS”".
  - Right: `btn btn-ghost` 12px "+ Add work package" (Ajouter un lot de travaux), shown only when `planCanEdit` (`!planRO && !outside`), opening AF `wp`.
- **Table:** `min-width:1000px`, built from divs. Grid `72px minmax(220px,1.6fr) 150px 64px 84px minmax(170px,1fr) 100px 92px`, gap 8px. Header 10.5px uppercase `neutral-400`, bottom border `neutral-800`. Rows: min-height 36px, bottom border `neutral-900`, 12.5px, `background:r.bg`.
- All inputs: `.input`, min-height 26px, padding 2px 6px, 12px, full cell width. Each input's `onClick` calls `stopPropagation`.

| Column (FR) | Activity row | WP row | Root row |
|---|---|---|---|
| ID | tabular `neutral-400` 12px; **click → open drawer** (`r.select`); + new/edited dot | WBS code (click does nothing) | "1" |
| Activity (Activité) | text input `value=name`, `onChange → setWbs(id,{n})` | caret toggle button (18×18) + name input (weight 500) | plain text, weight 500, ellipsis |
| Owner (Responsable) | `<select>` of the 9 `OWN` people (value = initials, label = full name), `onChange → {o}` | – | – |
| Dur (Durée) | number input `min=1`, value `d`, `onChange → {d}` | "{n} act." | – |
| Budget k€ | number input `min=0`, value `b0`, `onChange → {b}` | `f(bud)` | `f(bud)` |
| Predecessors (Prédécesseurs) | text input, placeholder "—", `onChange → {pt}` | – | – |
| Constraint (Contrainte) | read-only text, LO if violated | – | – |
| Actions | Move up (`ph-arrow-up`), Move down (`ph-arrow-down`), Remove (`ph-trash`) | Add activity (`ph-plus`, opens AF `plan` prefilled with this WP), Remove | none |

- The action buttons are `btn btn-icon btn-ghost`, 24×24, 13px, `neutral-400`, with native `title` tooltips: "Add activity", "Move up", "Move down", "Remove". They render only when `r.canEdit` (`!planRO`).
- **Predecessor syntax**: comma-separated tokens matching `/^(A\d+)\s*(FS|SS|FF|SF)?\s*([+-]?\d+)?\s*d?$/i`. Examples: "A1010", "A1010 FS+5", "a1020 ss", "A1230 FF 5d". The type defaults to FS and the lag to 0. A token is accepted only if the activity ID exists in this project. **Invalid tokens are dropped silently**: there is no error state, and the raw text stays in the input.
- **No scheduling recompute**: changing duration or predecessors does not move start/finish dates, float or variance. Those are static data.

#### 2.4.4 Progress card (1071–1104)

- **Header:** title "Progress update" (Mise à jour de l’avancement). Sub "Enter % complete per activity · summaries roll up by budget weight · click a row for details". Right: "Data date · 25 Sep 2026".
- **Table:** `min-width:1040px`. Grid `72px minmax(200px,1.4fr) 84px 84px 80px 54px minmax(170px,1fr) 50px 92px 46px 56px`, gap 8. The whole row is clickable (`r.select`; it does nothing on WP and root rows). Hover background `neutral-900`; cursor pointer.

| Column (FR) | Content |
|---|---|
| ID | id / WBS code (tabular `neutral-400`) |
| Activity | indent; caret toggle on WP rows (stops propagation); name (ellipsis, weight per row); `ph-lightning` accent 12px when `r.critical` (behind) |
| Start (FR dictionary gives "Démarrer"; should be "Début") | `r.start` (" A" suffix = actual) |
| Finish (Fin) | `r.finish` |
| BL finish (Fin BL) | `r.bl`, `neutral-400` |
| Var (Écart) | `r.var`, LO if < 0 |
| Progress (Avancement) | inner grid `minmax(0,1fr) 58px 24px`: a 6px bar (radius 3, background `neutral-800`, fill `barColor`, width `pct%`). Activities (if `canEdit`): number input 58px, `min 0 max 100 step 5`, right-aligned, value `pc`, `onChange → setWbs(id,{pc})`, plus a "Mark complete" (Marquer terminée) `ph-check` icon button that sets pc=100. WP rows: the "{pct}%" text. Root row: bar only. |
| TF | `r.tf`, LO if negative |
| Status (Statut) | tag (11px) per 2.4.2 |
| Owner | 24px circle avatar (`neutral-800`, 10px initials), `title` = full name |
| To-dos (À faire) | `ph-check-square` `neutral-500` + "done/total" |

`pc` is clamped with `parseInt` to 0..100. When pc reaches 100, TF becomes null ("—") and the status becomes Completed. Start and finish keep their text (no " A" suffix is added), and neither EV nor the Schedule screen changes.

#### 2.4.5 Activity drawer (1105–1163)

- **Backdrop:** fixed, `inset:0`, z 60, background `color-mix(in srgb, var(--color-bg) 60%, transparent)`. Click → `closeSel`.
- **Panel:** `card elev-lg`, fixed top/right/bottom, z 61, `width:min(640px,100vw)`, radius 0, padding 18px 22px, gap 12px, left border `neutral-800`, scrollable.
- **Header:**
  - ID (12px `neutral-400`) · name (`card-title`) · status tag.
    - `sel.statusText`: "Complete" / "In progress · 72%" / "Not started".
    - `tagClass`: `tag-neutral` / `tag-accent` / `tag-outline`. These are different strings and classes from the table statuses.
  - ✕ (`btn-icon btn-ghost`) → close.
  - `btn btn-secondary` "Show in Gantt" (Afficher dans le Gantt, `ph-calendar-dots`) → `setState({screen:'schedule'})`. `selOpen` is not reset, so the drawer reappears when the user returns to Plan.
- **Body grid:** `repeat(auto-fit,minmax(min(100%,230px),1fr))`, gap 18px. Four sections, each headed by a 10.5px uppercase accent kicker:

1. **General (Général)**: key/value rows (12.5px, bottom border `neutral-900`; the value is tabular and right-aligned).

| Key | Value |
|---|---|
| WBS | "{w} {WP name}" |
| Type | "Task dependent" (constant) |
| Calendar | "Standard 5d · 8h" if `w==='1.1'` or id A1230, else "Site 6d · 10h" |
| Original / remaining | "{d}d / {round(d*(1−pc/100))}d" |
| Start / Finish | display strings |
| BL1 finish | `bl` |
| Finish variance | "{v}d", LO if < 0 |
| Total float | "— (complete)" or "±N d", LO if < 0 |
| Constraint | `c` or "None", LO if violated |
| Owner | full name from `OWN` |

2. **Relationships (Liens)**:
   - "Predecessors" list: grid `52px minmax(0,1fr) auto`. Each line shows id, name and relation text, where `relText(t,l)` = "FS", "FS +10d" or "FS -5d". The **first predecessor is suffixed " · driving" and coloured `accent-300`**; the others are `neutral-300`. Empty: "— No predecessors" (`neutral-500`).
   - "Successors" (Successeurs): all activities whose `p` references this one. Each is coloured LO when that successor's TF < 0. Empty: "No successors".
   - Button "+ Add relationship" (Ajouter un lien, `btn-ghost`): **no handler**.
3. **Resources & cost (Ressources et coûts)**:
   - Resource lines. For A1250 the lines come from `A1250_RES` (4 lines). Otherwise there is one line for the owner: `[name, role+' · lead', units ('6 × 10 h/d' site / '8 h/d'), hours 'round(d*8*pc/100) / d*8 h']`. Each line shows the name and units on the right, with the sub "{sub} · {hours}" below.
   - Three mini KPIs: Budget, Actual, EAC (15px weight 500; EAC in LO when EAC > budget).
   - **Cost bar** (6px track, radius 3, `neutral-900`). The scale max is 1.4× budget:
     - Actual fill `neutral-300`, width `pct(min(actual/budget,1.4)/1.4)`.
     - Budget tick (2×12, `neutral-500`) at `pct(1/1.4)` = 71.4%.
     - EAC diamond (8×8, `accent`, rotated 45°) at `pct(min(eac/budget,1.4)/1.4)`.
   - `costNote`: "Forecast {+€x} over this package’s budget", with " — second crew (CR-008) pending approval" appended for A1250; or "Tracking within budget".
4. **To-dos (À faire)**:
   - Header with count "{done} of {n} done".
   - To-do buttons (`todoLite`): grid `16px minmax(0,1fr) auto`.
     - Status ring 14px: `accent` filled with a `ph-check` when done; `neutral-600` ring otherwise.
     - Title (line-through when done) + meta "{first name} · {due text} · {status}". Due text: "Today", "Overdue · Tue 22 Sep", "Thu 1 Oct" or "Done".
     - 22px initials avatar.
     - Click → `openTask` (screen `task`).
   - Pending resource requests linked to this activity (`requests` with status pending or reschedule): a `ph-hourglass` `accent-300` row with a dashed bottom border. Meta: "{person} · awaiting {dept} approval — not yet in their list", or "{person} · reschedule proposed by {dept head}".
   - Empty: "No to-dos yet — break the activity down for the team".
   - Footer: input "Add a to-do…" + `btn-primary` "Add". **No handler.**

### 2.5 Interactions and state

State keys (initial values from 3767–3774):

| State | Initial | Role |
|---|---|---|
| `planView` | `'progress'` | Structure/Progress seg |
| `collapsed` | `{'1.1':true,'1.2':true,'1.3':true}` | WP collapse map; **global, not per project** |
| `sel` | `'A1250'` | Selected activity id (drawer subject, row highlight) |
| `selOpen` | undefined (false) | Drawer visibility |
| `wbsOv` | `{}` | Per-row overrides keyed `"{project}\|{id or w}"` → `{n, o, d, b, pt, pc}` (raw strings) |
| `wbsRm` | `{}` | Removed rows `"{project}\|{id or w}"` → true |
| `wbsOrd` | `{}` | Activity order within a WP: `"{project}\|{w}"` → [ids] |
| `added.wps` | `[]` | New WPs `{proj, w, n, o, b, desc}` |
| `added.acts` | `[]` | New activities `{proj, id, w, n, d, o, s, f, b, crit, desc}` |

Handlers:

| UI | Handler | Effect |
|---|---|---|
| Seg Structure/Progress | `planSeg` → `setState({planView})` | Switches table, KPIs and primary action |
| WP caret | `r.toggle` | `collapsed[w] = !collapsed[w]`; stops propagation |
| ID cell (Structure) / row (Progress) | `r.select` | Activities only: `{sel:id, selOpen:true}` |
| Inline inputs | `setName/setOwner/setDur/setBudget/setPreds/setPct` → `setWbs(k, patch)` | Merges into `wbsOv[project\|k]`; applied in `applyOv` (3978). Duration: `parseInt` or the original value. Budget: `parseFloat` or 0. EAC becomes `max(origEAC, newBudget)` when the budget is changed. |
| Mark complete | `r.complete` | `setWbs(id,{pc:100})` |
| Move up/down | `moveAct(x,±1)` | Swaps within the WP's children and stores the full order in `wbsOrd` |
| Remove | `rmKey(k)` | `wbsRm[project\|k]=true`. Removing a WP hides the WP **and all its activities**. No confirmation, no undo. Edges that point to removed IDs are dropped from relationship lists but remain inside other activities' `p`. |
| WP "+" | `afOpenWith('plan',{wp:'1.4 · Steel structure'})` | Opens Add activity prefilled |
| "+ Add work package" | `afOpen('wp')` | AF `wp` |
| Primary (Structure) "Add activity" | `afOpen('plan')` | AF `plan` |
| Primary (Progress) "Update progress" | `afOpen('progress')` | AF `progress` |
| Drawer ✕ / backdrop | `closeSel` | `selOpen:false` |
| Drawer "Show in Gantt" | `st({screen:'schedule'})` | Navigates to Schedule |
| Drawer to-do | `openTask(t)` | `{screen:'task', task:id, person}` |
| Reschedule, Set baseline, Calendar, Baseline chips, Add relationship, Add to-do | – | **No behaviour (placeholders)** |

AF forms (definitions in `AF`, 3674–3700; submit logic 5121–5134):

**AF `plan` — "Add activity" (FR "Ajouter une activité"), `kind:'create'`, submit "Create activity" (Créer l’activité)**

| id | Label | Type | Default | Req |
|---|---|---|---|---|
| name | Activity name | text | "" | ✓ |
| wp | Work package | select `WP` = current WP headers "1.1 · Design & permits", … | first | – |
| owner | Owner | select `TEAM` = `DEFS[project].team` (HLT: the 8 `PEOPLE` names; Romain Aubert is not included) | first | – |
| start | Start date | text | "5 Oct 2026" | – |
| finish | Finish | text | "30 Oct 2026" | – |
| budget | Budget (k€) | number | "40" | – |
| critical | Critical path | select No/Yes | No | – |
| desc | Description | textarea | "" | – |

On submit:

- `w` = WP code from the select.
- `id = 'A' + DEFS[project].idx + '9' + NN`, where NN = count of added activities in the project + 1, 2-digit. HLT gives A1901, A1902, …
- `d` = working days = `max(1, round((finish−start)/1 day × 5/7))` when both dates parse and finish > start; otherwise 20.
- `s` / `f` = `wbsFmtDate` of the parsed dates, or the raw text when parsing fails.
- `o` = `INIT_OF[owner]`, defaulting to "RA".
- `b` = `parseFloat(budget)`; `crit` = critical==="Yes".
- Rendered as an activity with `bl = f`, `v = 0`, `tf = crit ? PD.floatDays : 10`, `pc = 0`, `b = [b, 0, b]`, `added:true` (dot).
- Toast: "A1901 · Activity created · 1.1".

**AF `wp` — "Add work package", submit "Create work package" (Créer le lot)**

| id | Label | Type | Default | Req |
|---|---|---|---|---|
| name | Work package name | text | "" | ✓ |
| owner | Owner | select TEAM | first | – |
| budget | Budget (k€) | number | "100" | – |
| desc | Scope | textarea | "" | – |

- New code `w = '1.' + (existing WP count + removed added WPs + 1)`.
- The WP is appended after the existing WPs, with no activities. **Its owner, budget and scope are stored but never displayed.** The WP's budget shows as "—" until it gets activities.
- Toast: "1.9 · {name} · Work package created".

**AF `progress` — "Update progress", `kind:'run'`, submit "Save progress"**

| id | Label | Type | Default | Req |
|---|---|---|---|---|
| act | Activity | select `ACTOPEN` = activities with pc < 100, "A1250 · Steel erection — Bays 3–4" | first | – |
| pc | % complete | number | "50" | ✓ |
| note | Note | textarea | "" | – |

- Effect: `wbsOv[project|id].pc = clamp(pc)`. The note is discarded.
- Toast: "A1250 · 50 % · Progress saved".

### 2.6 Data

- `PD.ACTS` (HLT: `HACTS`, 3196–3226, 21 activities in 8 WPs; shape in Data entities)
- `OWN` (9 people)
- `state.todos` (`TODOS` + to-dos created elsewhere; linked by `act` id)
- `state.requests` (`REQUESTS`; pending/reschedule items linked by `act`)
- `A1250_RES`
- PD display strings

HLT WBS fixture (`HACTS`). Dates are display strings; "A" means actual.

| ID | WBS | Activity | Dur | Start | Finish | BL fin | Var | Preds | Constr | TF | % | Own | Bud/Act/EAC k€ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1010 | 1.1 | Detailed design | 45 | 05 Jan A | 06 Mar A | 06 Mar | 0 | – | – | – | 100 | RA | 210/208/208 |
| A1020 | 1.1 | Permit submission & approval | 30 | 09 Mar A | 24 Apr A | 17 Apr | −7 | A1010 FS | FNLT 17 Apr | – | 100 | RA | 110/110/110 |
| A1110 | 1.2 | Mobilisation | 10 | 27 Apr A | 08 May A | 01 May | −7 | A1020 FS | – | – | 100 | AO | 120/124/124 |
| A1120 | 1.2 | Earthworks & grading | 25 | 11 May A | 12 Jun A | 05 Jun | −7 | A1110 FS | – | – | 100 | AO | 280/296/296 |
| A1130 | 1.2 | Piling (incl. CR-004 additional piles) | 30 | 01 Jun A | 10 Jul A | 26 Jun | −14 | A1120 SS+15 | – | – | 100 | AO | 240/242/242 |
| A1210 | 1.3 | Foundations — Bays 1–2 | 20 | 22 Jun A | 17 Jul A | 10 Jul | −7 | A1120 FS+5 | – | – | 100 | JW | 380/402/402 |
| A1220 | 1.3 | Foundations — Bays 3–4 | 20 | 13 Jul A | 07 Aug A | 31 Jul | −7 | A1130 FS, A1210 SS+15 | – | – | 100 | JW | 360/400/400 |
| A1230 | 1.4 | Steel fabrication & delivery | 60 | 18 May A | 14 Aug A | 31 Jul | −14 | A1010 FS+10 | SNET 18 May | – | 100 | FB | 380/360/360 |
| A1240 | 1.4 | Steel erection — Bays 1–2 | 30 | 20 Jul A | 28 Aug A | 14 Aug | −14 | A1210 FS+10, A1230 FF+5 | – | – | 100 | JW | 260/246/246 |
| A1250 | 1.4 | Steel erection — Bays 3–4 | 40 | 17 Aug A | 09 Oct | 31 Aug | −39 | A1240 FS, A1220 FS+10, A1230 FF+5 | – | −27 | 72 | JW | 280/210/470 |
| A1260 | 1.4 | Roof decking | 25 | 05 Oct | 06 Nov | 25 Sep | −42 | A1250 FS−5 | – | −27 | 0 | JW | 105/0/113 |
| A1310 | 1.5 | Crane rail foundations | 20 | 03 Aug A | 28 Aug A | 21 Aug | −7 | A1220 FS | – | – | 100 | TK | 180/192/192 |
| A1320 | 1.5 | Crane delivery & rigging | 15 | 12 Oct | 30 Oct | 11 Sep | −49 | A1250 FS, A1310 FS | SNET 12 Oct | +20 | 0 | TK | 260/120/300 |
| A1330 | 1.5 | Crane commissioning & load tests | 15 | 02 Nov | 20 Nov | 02 Oct | −49 | A1320 FS | – | +20 | 0 | TK | 180/60/198 |
| A1410 | 1.6 | HV connection & switchgear | 40 | 17 Aug A | 23 Oct | 09 Oct | −14 | A1220 FS+5 | – | +28 | 55 | PN | 320/186/332 |
| A1420 | 1.6 | Lighting & power distribution | 35 | 19 Oct | 04 Dec | 13 Nov | −21 | A1250 FS+5, A1410 SS+20 | – | +10 | 0 | PN | 280/78/294 |
| A1430 | 1.6 | Fire detection & suppression | 30 | 09 Nov | 18 Dec | 20 Nov | −28 | A1260 FS | – | −27 | 0 | PN | 195/32/204 |
| A1510 | 1.7 | Yard drainage & subgrade | 20 | 21 Sep A | 16 Oct | 16 Oct | 0 | A1240 FS+15 | – | +22 | 10 | AO | 140/46/146 |
| A1520 | 1.7 | Heavy-duty paving | 25 | 02 Nov | 04 Dec | 20 Nov | −14 | A1510 FS, A1320 FS | – | +22 | 0 | AO | 220/0/226 |
| A1610 | 1.8 | Systems integration & testing | 10 | 21 Dec | 04 Jan ’27 | 04 Dec | −31 | A1430 FS, A1420 FS, A1330 FS | – | −27 | 0 | HS | 90/0/98 |
| A1620 | 1.8 | Operational readiness & handover | 8 | 05 Jan ’27 | 14 Jan ’27 | 18 Dec | −27 | A1610 FS, A1520 FS | FNLT 18 Dec (**violated**) | −27 | 0 | RA | 60/0/67 |

The WP headers are 1.1 Design & permits, 1.2 Site preparation, 1.3 Foundations, 1.4 Steel structure, 1.5 Crane installation, 1.6 MEP systems, 1.7 Paving & yard and 1.8 Commissioning & handover. The root is "Harbor Line Terminal Expansion": 05 Jan → 14 Jan ’27, BL 18 Dec, TF −27.

### 2.7 Cross-links

- **Into the Plan screen:**
  - Projects list (`open`), Overview rows, My projects, Portfolio schedule rows, the world map (`postMessage` `keystone-map/open`, 3765) and machine type project lists → `{screen:'plan', project}`.
  - Global search "Project" hits, and "Activity" hits → `{screen:'plan', sel, selOpen:true}` (4696–4697).
  - Task detail "open activity" (`openPlan`, 4093) → selects the activity and expands its WP.
  - PO drawer (4337), Risk drawer `openAct` (4589) and NCR drawer `openAct` (4628) → open the drawer on the linked activity.
  - Budget "goPlan".
- **Out of the Plan screen:** Schedule ("Show in Gantt"), Task screen (to-dos).
- Resource requests (`requests.act`) and to-dos (`todos.act`) are linked by activity ID. The same IDs are used in `NR_ACTS` (new resource request), PO lines and risks.

---

## 3. Portfolio schedule — `screen:'pfplan'` (`isPfPlan`)

### 3.1 Identity

- Route key `pfplan`. It is not a `startScreen` option. Nav: Portfolio › "Schedule" (FR "Planning", icon `ph-chart-bar-horizontal`). Not project-scoped.
- The global **zone bar** applies (`zoneBar`, 5211): Zone seg = All zones / Europe & North America / Africa / Asia Pacific, with counts and the zone manager name.
- Roles: director, pm.

### 3.2 Purpose

This is a 24-month (Jan 2026 – Dec 2027) portfolio Gantt with one line per live project. For pipeline projects (stages Initiative → APS → APD) it shows the pre-project stage gates and the **group board** decisions between them. For projects in execution it shows the execution bar with progress fill, the baseline finish and the forecast slip. It answers which board decisions are pending and how long they have waited.

### 3.3 Layout (template 972–1023)

- **Filter row:** `ph-funnel` + "Stage" (Étape) + seg `pgSegCtl`: "All" (Tous) / "In progress" (En cours) / "Pipeline".
- **Zone empty notice** (`zoneEmptyPg`, when a zone is active and has no live project): a `neutral-900` box with radius md, a `ph-globe-hemisphere-east` icon and "No project in this zone for this view".
- **KPI row:** 4 tiles, `minmax(150px,1fr)`.
- **Gantt card:** `card elev-sm`, `overflow:auto`.
  - Header: title "Portfolio schedule" (Planning du portefeuille), plus the sub "One line per project · execution in accent, pipeline (Initiative → APS → APD) in grey, hatched while the group board decides".
  - Legend (11.5px `neutral-400`, 18×8 swatches):

| Legend item (FR) | Swatch |
|---|---|
| In progress (En cours) | `accent-800` + inset `accent-700` |
| Pipeline | `neutral-700` |
| Group decision pending (Décision groupe en attente) | dashed `neutral-600` border, 135° hatch |
| Group board (Board groupe) | 8×8 diamond, `accent` |
| Execution if approved (Exécution si validé) | dashed `accent-700` border |
| Baseline finish (Fin de référence) | 18×3 `neutral-600` |

- **Grid:** `240px 172px 170px minmax(760px,1fr)`, `min-width:1342px`.
- **Header row:**
  - "Project" (Projet) | "Status" (Statut) | "Next decision / Finish" (Prochaine décision / Fin) — bottom-aligned, 11px uppercase.
  - Timeline header: `repeat(24,1fr)`. Each cell has a year line (10px `neutral-500`, shown only in January, min-height 12px) and a month line (10.5px `neutral-400`). The left border is `neutral-700` in January and `neutral-900` otherwise.
- **Group header** per group (`pgGroups`): a full-width row (`grid-column:1/-1`), padding 12px 0 4px, 10.5px uppercase. It holds the label ("In progress" / "Pipeline"), the count (tabular `neutral-500`), and a flex line `linear-gradient(90deg, neutral-800, transparent)`.
- **Project rows** (44px high, bottom border `neutral-900`):
  1. A button with the name `pname` ("#026 · Harbor Line Terminal Expansion") at 13px, plus "{pm} · {client}" at 11.5px `neutral-400`. Both are ellipsised at max-width 230px. Hover colour `accent-300`. Click → `r.onClick`.
  2. Status tag (10.5px) using `statusTag(status)`:
     - Annulé/Clos → `tag-neutral`
     - Garantie or a pipeline stage → `tag-outline`
     - otherwise → `tag-accent`
  3. Gate column: `r.gate` (12.5px, ellipsis) + `r.gateSub` (11.5px tabular, colour `r.gateColor`).
  4. Timeline (gridlines `calc(100%/24)`), with:
     - **stage segments and board diamonds** (`r.segs`)
     - the **baseline line** (`r.hasBase`): top 34px, height 3px, `neutral-600`
     - the **execution bar** (`r.hasExec`): top 12px, height 18px, radius 4px, background `exBg`, border `exBorder`, shadow `exEdge`, with an inner accent fill of width `exFill`
     - a **clip label** (`r.clipped`): absolute right 4px, top 14px, 10.5px `neutral-400` on `surface`, text "→ {finish}"
     - the **today line** at `pgTodayL` (`pgPct(PG_NOW)` = 37.38%)

### 3.4 Geometry and row model — `pgRow(p)` (4529–4548)

The horizon is `PG_MONTHS = 24`, month 0 = Jan 2026. `pgPct(m) = clamp(m,0,24)/24*100` (2 decimals). `pgSeg(a,b)` clips the segment to [0,24] and returns null when the result is empty.

Rows come from `pgLive` = projects in the zone whose status is not Clos/Annulé. A row is a pipeline row when `status ∈ PIPE_STAGES ['Initiative','APS','APD']`.

- `startM = mIdx(p.start)`, or PG_NOW. `finM = mIdx(p.finish) + 1` (end of the finish month), or null when finish is "—".
- **Stage plan** (an array of `[stage, a, b]`):
  - Pipeline rows: `PIPE_PLAN[code]` (fixture for WSA-044, CER-047, RBR-048, EWA-051, FTU-052). Otherwise a default relative to `startM`: Initiative [−3, −2.2], Board [−2.2, −1.6], APS [−1.6, −0.8], Board [−0.8, −0.4], APD [−0.4, +0.3], Board [+0.3, +0.6].
  - Execution rows: built from `state.stageHist[code]` dates (`STAGE_HISTORY`; HLT and RCF have real history). With i0 = date(Initiative) or startM, a0 = date(APS) or i0+1, d0 = date(APD) or a0+1.1, e0 = date(Etudes) or d0+1.2, the plan is: Initiative [i0, a0−0.25], Board [a0−0.25, a0], APS [a0, d0−0.25], Board [d0−0.25, d0], APD [d0, e0−0.3], Board [e0−0.3, e0].
- `execStart` = end of the last Board segment.
- `ex = pvExtra(p,true)` (execution rows only). `slipM = −ex.floatDays/30` when floatDays < 0, else 0. floatDays comes from `projectData` for DEFS projects, else `round((spi−1)*180)`.
- `base` = finM, or else (pipeline ? execStart+8 : max(execStart+1, PG_NOW)). `fc = (finM known or pipeline) ? base + slipM : base`.

**Segment rendering** (`segs`). `done = b ≤ PG_NOW`; `cur = a ≤ PG_NOW < b`.

| Segment | top / height / radius | Background | Border | Label | Glow |
|---|---|---|---|---|---|
| Stage (Initiative/APS/APD) | 14px / 14px / 4px | done `neutral-600`, else `neutral-700` | 0 | "INI" / "APS" / "APD" only if width > 0.8 month (9.5px, .06em); colour done `neutral-200` else `neutral-300` | none |
| Board | 15px / 12px / 2px | `repeating-linear-gradient(135deg, neutral-600 0 2px, transparent 2px 6px)` | `1px dashed` + (cur ? `accent` : `neutral-600`) | – | cur: `0 0 10px color-mix(accent 45%)` |
| Board diamond (at board end) | 10×10, `top:16px`, `translateX(-5px) rotate(45deg)`, z 2 | done `accent-300`; cur `accent`; planned transparent | planned `neutral-500` border | – | cur: `0 0 10px color-mix(accent 60%)` |

- Tooltips: a stage segment's title is the stage name. A board's title is "Group board · Approved", "Group board · Decision pending" or "Group board · Planned".
- **Execution bar:** `pgSeg(execStart, fc)`. Execution rows use background `accent-800`, inset `accent-700`, and a fill of `round(progress*100)%`. Pipeline rows use a transparent background with `1px dashed accent-700` ("execution if approved") and a 0% fill.
- **Baseline line:** `pgSeg(execStart, base)`. Shown only for execution rows with slip > 0 and a known finish.
- **Gate column:**
  - Pipeline rows: `gate` = "Group board → {next stage}" (Execution after the APD board), or "—". `gateSub` = "Decision pending · {days waiting} d" when a board is currently running, coloured LO if > 21 days else `accent-300`. Otherwise it is the next board's end date `fmtD`, in `neutral-400`.
  - Execution rows: `gate` = "finish not planned" when there is no finish; otherwise `ex.finishForecast` (DEFS projects: `PD.finishText`; others: finish shifted by the slip). `gateSub` = `ex.floatText` ("−27 d"), LO if negative.
- **Row click:** if the code is in DEFS → `{screen:'plan', project:code}`; else `{screen:'projects', q:code, statusFilter:null}`.

### 3.5 KPI tiles — `pgKpis` (4555)

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Projects in progress (Projets en cours) | execution rows (7) | `f(Σ budget)` (€14.35M) | OK |
| Projects in pipeline (Projets dans le pipe) | pipeline rows (5) | `f(Σ budget)` (€13.08M) | `neutral-200` |
| Group decisions pending (Décisions groupe en attente) | pipeline rows whose gateSub starts with "Decision pending" (1) | the codes joined " · " (EWA-051), or "—" | LO if > 0 |
| Average board wait (Attente moyenne du board) | mean `(b−a)*30` of completed Board segments across **all of `PIPE_PLAN`** (28 d) | "target 3 weeks" (cible 3 semaines) | LO if > 21 |

### 3.6 Interactions and state

- `pgFilter` ('all' | 'exec' | 'pipe'; default 'all'): seg → `setState({pgFilter})`. It filters groups.
- `pfZone` (shared with Overview/Projects/Map/Prioritisation/Cash/Fleet/SAV): the zone bar seg.
- Row name click: see above.
- No primary action, no editing, no drag.

### 3.7 Data

- `state.projects` (from `initialProjects()`: `PROJECTS` + `EXTRA`, statuses mapped through `STATUS_MAP_OLD`)
- `state.stageHist` (`STAGE_HISTORY`)
- `PIPE_PLAN`, `PG_MONTHS`, `PG_NOW`
- `pvExtra()` (3924–3932) → `projectData()`

Current rows:

- In progress: HLT-026, NDC-031, RCF-019, ERP-202, MSR-012, PRS-038, ALP-021 (status Garantie, finished Sep 2026)
- Pipeline: WSA-044, EWA-051, FTU-052, RBR-048 (clipped "→ Aug 2028"), CER-047

### 3.8 Cross-links

- Out: Plan (DEFS projects) or Projects (search) on row click.
- Siblings sharing the zone filter: Overview, Projects, Projects map, Prioritisation, Cash flow.
- The board decisions shown here correspond to lifecycle gate changes on the Projects screen (`GATES`, `TRANS`, forced gates).

---

## 4. What-if levelling — `screen:'whatif'` (`isWhatif`)

### 4.1 Identity

- Route key `whatif`. It is a valid `startScreen`. Nav: Resources › "What-if levelling" (`ph-scales`). Crumb "Resources". Not project-scoped (no picker). The content is hard-wired to HLT-026.
- Roles: director, pm, depthead.

### 4.2 Purpose

Compare two resource-levelling scenarios (A and B) for the HLT steel slip. The PM sets each scenario's priority (protect date, budget or people) and toggles levers (delay, contractor, overtime, split, transfer). The screen shows the effect on the finish date, critical-path float, cost, peak load and over-allocation, side by side. Selecting a scenario is meant to turn its levers into resource requests.

### 4.3 Layout (template 1504–1528)

- KPI row (4 tiles).
- Scenario grid: `repeat(auto-fit,minmax(min(100%,380px),1fr))`, gap 14, `align-items:start`. It holds two scenario cards.
- "Side by side" card: a table and a footnote.

### 4.4 Components

**KPI tiles** — `wiKpis` (4418). These are static strings.

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Baseline finish (Fin de référence) | "14 Jan 2027" | "BL1 18 Dec 2026 · float −27 d" | LO |
| Peak load (Charge de pointe) | "130%" | "Julien Wagner · week of 12 Oct" | LO |
| People above 100% (Personnes au-dessus de 100 %) | "3" | "Weeks 41–43" | LO |
| Scenarios (Scénarios) | "2" | "Compared side by side · PM sets the priority" | OK |

The first tile is labelled "Baseline finish" but shows the current forecast (14 Jan 2027); see Open questions.

**Scenario card** (`scenarios[k]`, 4409–4416). Container: `card elev-sm`, padding 14px 16px, gap 12px.

1. Header: `card-title` "Scenario A" / "Scenario B". A `tag tag-accent` "Selected" (Sélectionné) appears when `chosen`.
2. "Priority (set by the PM)" (Priorité (fixée par le chef de projet)) — 11px uppercase label — then a seg `prioSeg`: "Protect date" / "Protect budget" / "Protect people" (Protéger la date / le budget / les personnes).
3. "Levers" (Leviers) label, plus a `btn btn-secondary` 12px "Auto-level for this priority" (Lisser automatiquement selon cette priorité, `ph-sparkle`). Then 5 lever rows, each a full-width button: grid `auto minmax(0,1fr) auto`, padding 7px 0, bottom border `neutral-900`, 13px. Contents: a checkbox icon (`ph-check-square` `accent-300` when on, `ph-square` `neutral-400` when off), the label, and the effect text (11.5px `neutral-400`, nowrap).
4. "Peak load by week" (Charge de pointe par semaine): a flex bar chart, height 64px, gap 4. There are 8 columns. Each bar has radius `2px 2px 0 0`, height `b.h` and background `b.bg`. The label under each bar is the day of month (10px).
5. Results list: key/value rows (12.5px, top border `neutral-900`), with values coloured.
6. `btn btn-primary` "Select scenario → create requests" (Retenir le scénario → créer les demandes, `ph-check`).

**Levers** (`LEVERS`, 3462):

| id | Label (FR) | float (d gained) | cost (k€) | peak (pts) | over (people) | side effect |
|---|---|---|---|---|---|---|
| delay | Delay non-critical activities (Décaler les activités non critiques) | 0 | 0 | −15 | −1 | – |
| contractor | Add contractor / temp (3 weeks) (Ajouter un prestataire (3 semaines)) | 12 | 18 | −20 | −1 | – |
| overtime | Authorise overtime (steel crew) (Autoriser les heures sup. (équipe charpente)) | 8 | 9 | +10 | 0 | – |
| split | Split steel structure activity (Scinder l’activité charpente) | 4 | 2 | −5 | 0 | – |
| move | Move 1 engineer from Westfield Solar (Déplacer 1 ingénieur de Westfield Solar) | 6 | 0 | −10 | −1 | "Westfield SPI −0.02" |

The effect text is `[±float+' d '] [· ±f(cost) ] [· peak ±peak pts]`, giving e.g. "+12 d · +€18k · peak -20 pts". Two prototype quirks: a hyphen-minus is used for negatives, and when float is 0 the text starts with "· ".

**Formulas.** `sum` = component-wise sum over the enabled levers.

- `fl = −27 + sum.float` (critical-path float, days)
- `peak = max(85, 130 + sum.peak)` (%)
- `over = max(0, 3 + sum.over)`
- `finish = new Date(2027, 0, 14 − sum.float)` (14 Jan 2027 minus the gained calendar days)

Results:

| Key (FR) | Value | Colour |
|---|---|---|
| Forecast finish (Fin prévisionnelle) | `fmtDY(finish)` | OK if sum.float ≥ 27, else LO |
| Critical-path float (Marge du chemin critique) | "+N days" / "−N days" | LO if fl < 0 |
| Cost impact (EAC) (Impact coût (EAC)) | `f(sum.cost, signed)` or "—" | LO if cost > 12 |
| Peak load (Charge de pointe) | "{peak}%" | LO if > 115 |
| People above 100% | `over` | LO if > 0 |
| Side effects (Effets de bord) | side texts joined " · ", or "None" (Aucun) | `neutral-300` |

Bars: weeks `['Sep 28','Oct 5','Oct 12','Oct 19','Oct 26','Nov 2','Nov 9','Nov 16']`, base load `[100,110,130,125,110,100,80,60]`.

- `v = max(50, base + sum.peak × (i ∈ 1..4 ? 1 : 0.4))`
- `h = min(100, v/1.4)%`
- `bg`: v > 115 → `accent-400`; v > 100 → `accent-600`; else `neutral-700`

`score {date: fl≥0, budget: cost≤10, people: over===0}` is computed but **not rendered**.

**Side by side** (`wiCompare`):

- Table `.table` 13px with columns "Indicator" | "Scenario A" | "Scenario B" (Indicateur, Scénario A/B). Rows = the 6 result keys, with values coloured as above.
- Footnote: "Selecting a scenario turns its levers into resource requests (contractor, overtime, transfers) that go through department approval before anything reaches a team member."

Default results:

- A (prio date; contractor + overtime): 25 Dec 2026, −7 days, +€27k, 120%, 2, None
- B (prio people; delay + move): 8 Jan 2027, −21 days, —, 105%, 1, "Westfield SPI −0.02"

### 4.5 Interactions and state

| State | Initial |
|---|---|
| `whatif` | `{A:{prio:'date', levers:{contractor:true, overtime:true}}, B:{prio:'people', levers:{delay:true, move:true}}}` |
| `chosen` | `null` |

| UI | Effect |
|---|---|
| Priority seg | `setWI(k,{prio})`. Does **not** change the levers. |
| Lever row click | Toggles `levers[id]` |
| Auto-level | Replaces the lever set with `AUTO[prio]`: date → contractor, overtime, split; budget → delay, split, move; people → delay, move, contractor |
| Select scenario | `setState({chosen:k})`. Shows the "Selected" tag. **No request is created.** |
| Primary "New scenario" | AF `whatif`: name (req), basis select (Current plan / Baseline BL1 / Last approved scenario), horizon (3 / 6 / 12 months), note textarea "Hypotheses"; submit "Create scenario". Effect: toast "Scenario created" only. **No third card.** |

### 4.6 Data

`LEVERS`, `AUTO`, `state.whatif`, the hard-coded base load and `weekLabels`. Nothing is computed from `PEOPLE` loads, even though the Resources heatmap uses the same weekly figures (Julien Wagner 130% w/c 12 Oct).

### 4.7 Cross-links

- In: Risk drawer "open what-if" (`goTo('whatif')`, 4589); Site › Team collisions of kind "Load" (4753).
- Intended out (not implemented): Resource requests (`requests`), department Approvals.

---

## 5. Meetings & minutes — `screen:'meetings'` (`isMeetings`)

### 5.1 Identity

- Route key `meetings`. It is not a `startScreen` option. Nav: Project › Team & exchanges › "Meetings & minutes" (`ph-chats-circle`). The nav badge `mtgBadge` = the number of meetings in "Notes in progress" for the current project. Project-scoped.
- Roles: every persona. **No content filtering for the client persona**: internal meetings, transcripts and internal Q&A are visible.

### 5.2 Purpose

The project meeting register is synced from Outlook (calendar). For each meeting it provides:

- attendance
- a preparation pack: previous decisions, previous actions, and the internal ⇄ client question bridge
- an optional transcript, with simulated AI analysis that proposes decisions and actions
- structured minutes per agenda point (info / decision / action with owner and due)
- sending: a numbered MIN document is issued, actions become owners' tasks, and read receipts are tracked

The screen also has a cross-meeting Decisions register and Actions register.

### 5.3 Layout (template 753–813)

- View seg `mtgViewSeg` ("Display"): "Meetings" (`ph-chats-circle`) / "Decisions" (`ph-gavel`) / "Actions" (`ph-arrow-bend-down-right`). FR "Réunions / Décisions / Actions".
- KPI row (4 tiles).
- **Meetings view** (`mtgIsMeetings`): a two-column grid `minmax(260px,340px) minmax(0,1fr)`, gap 14, `align-items:start`.
  - Left: status chips + meeting list.
  - Right: detail card.
  - There is no responsive breakpoint; the left column has a min of 260px.
- **Decisions view**: one card with a table.
- **Actions view**: one card with a table.

### 5.4 Components

**KPI tiles** — `mtgKpis` (4866):

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Meetings this week (Réunions cette semaine) | meetings with `|mIdx(date) − PG_NOW| ≤ 0.25` (4) | "{n} upcoming" (Scheduled count) | OK |
| Minutes to write (CR à rédiger) | status "Notes in progress" (1) | "send within 24 h" | LO if > 0 |
| Open actions (Actions ouvertes) | action lines not done (6) | "{n} overdue" | LO if any overdue |
| Decisions this month (Décisions ce mois) | decision lines with meeting date ≥ month 8 (Sep 2026) (4) | "{n} with the client" (External meetings) | OK |

**Left column:**

- Chips (`mtgChips`, prefixed "Status"):
  - "All" (Tous) = all
  - "Minutes to write" (CR à rédiger) = Notes in progress
  - "Upcoming" (À venir) = Scheduled
  - "Minutes sent" (CR envoyé) = Minutes sent
  - Each chip carries a count.
- Meeting cards (`mtgList`): each is a button with padding 10px 12px, radius md, `border:1px solid` (`accent-700` if selected, else `neutral-900`) and background (`accent-900` if selected, else transparent). Hover border `accent-700`.
  - Line 1: title (13px, wraps) + type tag 10px. External → `tag-accent` "External" (Externe); Internal → `tag-neutral` "Internal" (Interne).
  - Line 2: sub "{date} · {time} · {n} invited[ · {k} actions]" (11.5px `neutral-400`) + status tag 10px.
  - Status tags: Minutes sent → `tag-neutral`; Notes in progress → `tag-accent`; Scheduled → `tag-outline`. FR: CR envoyé / Notes en cours / Planifiée.
  - Sort: status order (Notes in progress, Scheduled, Minutes sent), then date descending.
  - Click → `setMtg({sel:id, draftPt:0})`.
- Empty: "No meeting in this view" (`neutral-900` box, centred).

**Detail card** (`mtgSel`, shown when a meeting exists; it falls back to the first meeting when `mtg.sel` is not in the project):

1. **Header:** title (`card-title`); meta "{date} · {time} · {dur} · {loc} · {organizer}"; "Synced from Outlook · {series}" (11px `neutral-500`, `ph-calendar-check`); type tag; status tag.
2. **Attendance:** accent kicker "Attendance · {invited.length} Invited" (Participants · … Conviés), then one tag per invitee.
   - When the meeting is Scheduled, every invitee gets `tag-outline`.
   - Otherwise present invitees get `tag-neutral`. Absent invitees get `tag-outline` with the label "{name} · absent" and colour `neutral-500`.
3. **Carried over** (`hasCarried`): a `neutral-900` box.
   - Header "Carried over from {prev meeting id}" and sub "Open points from the previous meeting · tick when closed".
   - Rows: a `ph-square` toggle (`accent-300`), the text, and "{owner} · {due}".
   - Source: the latest **earlier** meeting of the same series (`prevSame`, any status), restricted to its open action lines.
4. **Prep pack** (`mtgPrep`; null when the meeting status is Minutes sent). Grid `repeat(auto-fit,minmax(min(100%,300px),1fr))`, gap 10.
   - **Previous meeting** (`hasPrev`: the latest *sent* meeting of the same series):
     - Kicker "Decisions from the previous meeting" + `prevRef` "{title} · {date}". Decision lines with a `ph-gavel` accent icon.
     - "Actions since the previous meeting" + `closedCount` "x / n".
     - Action rows: toggle icon (`ph-fill ph-check-circle` `accent-300` when done, `ph ph-circle` `neutral-500` otherwise), text, "{who} · {due}", and a tag ("Closed since" `tag-neutral` / "Still open" `tag-accent`; FR Close depuis / Toujours ouverte).
   - **Bridge** (`hasBridge`), from `MTG_EXCHANGE[project]`:
     - Internal meeting: the title is "From the client meeting — questions to prepare". All items are shown, with the sub "Client question · {who} · {owner}".
     - External meeting: the title is "From the internal meeting — answers to bring to the client". Only answered items are shown, with the sub "Answer from {dept} · {owner}".
     - Each item has an icon `ph-arrows-left-right` `accent-300`, a tag ("Answer ready" `tag-neutral` / "Needs an answer" `tag-accent`) and the answer text (12px `neutral-200`) when present.
   - **Transcript** (`hasTranscript`; `MTG_TRANSCRIPTS` exists for MTG-119, MTG-120 and MTG-121). The box has a `neutral-800` border.
     - Kicker "Transcript" (Transcription), plus a `btn-secondary` "Analyse transcript" (Analyser la transcription, `ph-sparkle`) while it has not been analysed.
     - The transcript paragraph is 12px, `max-height:96px`, scrollable.
     - After analysis:
       - "Summary" (Résumé) + summary paragraph
       - draft lines: decisions with `ph-gavel` accent; actions with `ph-arrow-bend-down-right` `neutral-300` and meta "{owner} · {due}"
       - footer text "Review the proposed decisions and actions, then add them to the minutes to edit before sending."
       - `btn-primary` "Add to minutes" (Ajouter au CR, `ph-list-plus`), or the tag "Added to the minutes" (Ajouté au CR) once applied
     - The analysis is **pre-baked** per meeting (4840): MTG-119 and MTG-121 have specific results; any other meeting gets the Nordvolt FAT result.
5. **Agenda & notes** (Ordre du jour & notes), one block per agenda point:
   - Block: padding 8px 10px, radius md. Background `accent-900` when it is the selected draft point and the meeting is editable. Click → `pick` (`draftPt=i`).
   - Header: a 20px numbered circle + the point title (13px 500).
   - Lines: grid `18px minmax(0,1fr) auto`, top border `neutral-900`.
     - Action lines get a checkbox toggle (`ph-check-square` / `ph-square`).
     - Line text gets a type icon: info `ph-info` `neutral-500`; decision `ph-gavel` `accent`; action `ph-arrow-bend-down-right` `accent-300`.
     - Done actions turn `neutral-500`.
     - Under each action: "{owner} · {due}".
     - Right: a type label (10.5px uppercase, type colour).
   - Empty point: "No note yet" (Pas encore de note).
6. **Composer** (`mtgSel.editable` = status ≠ Minutes sent). A box with a `neutral-800` border:
   - "Add a note to the selected agenda point"
   - seg "Info / Decision / Action" (default Action)
   - text input (flex, min 200px; **Enter adds**)
   - when Action: "Owner" input (140px) and "Due" input (110px), both free text
   - `btn-secondary` "+ Add", disabled when the text is blank
   - footer text "Minutes become a numbered document (MIN) · actions go to the owners’ tasks · read receipts are tracked"
   - `btn-primary` "Send minutes to all invitees" (Envoyer le CR à tous les conviés, `ph-paper-plane-tilt`)
7. **Distribution** (`isSent`):
   - Kicker "Distribution & read receipts" (Diffusion & accusés de lecture), `sentText` "Sent {date} · {doc}", and `btn-ghost` "Open minutes" (`ph-file-text`) → Documents.
   - One tag per recipient: "{who} · Read {date}" (`tag-neutral`) or "{who} · Not read yet" (`tag-outline`).

**Decisions view** (`mtgDecisionRows`; sorted by meeting date descending). Card "Decisions register" (Registre des décisions), table 12.5px.

| Header (as authored) | Cell content actually bound |
|---|---|
| Decision | `ph-gavel` + decision text |
| Meeting | title button (hover `accent-300`) → `setMtg({view:'meetings', sel})`; sub "{id} · {date}" |
| Project | **the agenda point** (`d.pt`) |
| Status | **the meeting type tag** (External `tag-accent` / Internal `tag-neutral`) |

**Actions view** (`mtgActionRows`; open actions first). Card "Actions from meetings" (Actions issues des réunions), sub "Tick to close · closed actions leave the carry-over list".

| Column | Content |
|---|---|
| (28px) | checkbox toggle `ph-check-square` / `ph-square`, `accent-300` 17px |
| Action | text (`neutral-500` when done) |
| Owner | `fullName(owner)`: "J. Wagner" → "Julien Wagner" when found in `PEOPLE`, else as typed |
| Due | coloured `dueColor` |
| Meeting | title button → meeting; sub "{id} · {date}" |
| Status | "Done" / "Overdue" / "Open", coloured `dueColor` (done `neutral-500`; overdue = `mIdx(due+' 2026') < PG_NOW` → LO; else `neutral-400`) |

### 5.5 Interactions and state

`state.mtg` (initial): `{sel:'MTG-118', view:'meetings', filter:'all', ov:{}, lines:{}, draft:{type:'action', text:'', owner:'', due:''}, draftPt:0}`. Lazily added keys: `analysed:{}`, `applied:{}`.

| UI | Handler | Effect |
|---|---|---|
| View seg | `setMtg({view})` | Switches view |
| Status chip | `setMtg({filter})` | 'all' / 'todo' / 'upcoming' / 'sent' |
| Meeting card | `setMtg({sel, draftPt:0})` | Selects a meeting |
| Agenda point click | `setMtg({draftPt:i})` | Target point for the composer |
| Any action checkbox (agenda, carried, prev actions, Actions table) | `toggleLine(m,i,j)` | `mtg.ov[m.id].done["{id}\|{i}\|{j}"] = !current`. The seed state comes from `MTG_DONE`. |
| Composer seg / inputs | `setMtg({draft:{…}})` | Edits the draft |
| Add / Enter | `addLine()` (4848) | Appends `[type, text, owner (default = organizer) if action, due (default '—') if action]` to `mtg.lines[id][draftPt]`; resets text/owner/due (keeps type); **Scheduled → Notes in progress** (`ov[id].status`) |
| Analyse transcript | `setMtg({analysed:{…,[id]:true}})` | Shows the summary and draft lines |
| Add to minutes | `mtgPrep.apply` | Appends all proposed decisions and actions to the **last** agenda point; `applied[id]=true`. Does not change the status. |
| Send minutes | `sendMinutes()` (4849) | See below |
| Open minutes | `openDoc` | `{screen:'docs', dv:{…, open: doc}}` |
| Decision/Action meeting link | `setMtg({view:'meetings', sel})` | Jumps to the meeting |
| Primary "New meeting" | AF `meetings` | See below |

**`sendMinutes`** (no confirmation; available even when there are no notes):

1. `docId = 'MIN-HLT-' + pad3(24 + (# meetings already sent) + 1)`. The **prefix is hard-coded to HLT** whatever the project.
2. `read` = every invitee except the organizer → '' (not read).
3. For each action line whose owner resolves to a `PEOPLE` full name, a to-do is created:
   - `{id:'T-24xx' (random), person, title, project:<3-letter>, act:'', status:'todo', prio:'med', start:TODAY, due:TODAY+3, est:2, logged:0, cl:[0,0], labels:['Meeting', meetingId], pct:0}`
   - It is prepended to `state.todos`.
4. A document is prepended to `dv.newDocs`: `{id:docId, type:'MIN', title, proj, svc:'pm', rev:'A', status:'Released', date:'30 Sep', by:organizer, conf: External ? 'Client' : 'Internal', tags:"{id} · {series}", links:[], to:'', isNew:true}`.
5. The meeting override gets `status:'Minutes sent'`, `doc`, `sent:'30 Sep'` and `read`.
6. Toast:
   - EN: "{docId} · minutes sent to {n invited} invitees · {k} actions added to tasks"
   - FR: "{docId} · CR envoyé à {n} conviés · {k} actions ajoutées aux tâches"

**AF `meetings` — "New meeting" (Nouvelle réunion), submit "Create & invite" (Créer & inviter)**

| id | Label (FR) | Type | Default | Req |
|---|---|---|---|---|
| title | Title (Titre) | text | "" | ✓ |
| type | Type | select Internal / External | Internal | – |
| series | Series (Série) | select: Weekly site meeting, Steering committee, Engineering coordination, Supplier review, Kick-off, One-off | first | – |
| date | Date | text | "6 Oct 2026" | ✓ |
| time | Time (dictionary "Temps"; should be "Heure") | text | "09:00" | – |
| loc | Location (dictionary "Emplacement"; should be "Lieu") | text | "Teams" | – |
| invited | Invitees (Conviés) | text, comma-separated | "R. Aubert, L. Fabre, J. Wagner" | ✓ |
| agenda | Agenda (one point per line) | textarea | "" | – |

- Stored in `added.meetings` (with `proj`).
- Rendered as `{id:'MTG-'+(130+i), dur:'1 h', organizer: <current persona short name>, invited: split(','), present:[], status:'Scheduled', doc:'', agenda: lines → {pt, lines:[]}}`.
- Toast: "{title} · Meeting created · invitation synced to the calendar".
- No real calendar sync.

### 5.6 Data

`MEETINGS` (3703–3709), `MTG_DONE`, `MTG_TRANSCRIPTS`, `MTG_EXCHANGE`, `state.added.meetings`, `PEOPLE` (name resolution), `PERSONAS`.

HLT meetings:

| ID | Title | Series | Type | Date | Status |
|---|---|---|---|---|---|
| MTG-119 | Engineering coordination — automation | Engineering coordination | Internal | 1 Oct 2026 | Scheduled |
| MTG-120 | Supplier review — Nordvolt VFD lot 2 | Supplier review | External | 3 Oct 2026 | Scheduled |
| MTG-118 | Weekly site meeting #24 | Weekly site meeting | Internal | 29 Sep 2026 | Notes in progress |
| MTG-117 | Client steering committee — September | Steering committee | External | 25 Sep 2026 | Minutes sent (MIN-HLT-023) |
| MTG-116 | Weekly site meeting #23 | Weekly site meeting | Internal | 22 Sep 2026 | Minutes sent (MIN-HLT-022) |

NDC-031 has MTG-121 "Kick-off — cooling loop" (Notes in progress). The other projects have no meetings.

### 5.7 Cross-links

- Documents (Codex): a MIN document is created and opened.
- My work / Task: action to-dos.
- The client persona sees the same register; there is no separate client view of it.
- Nav badge: `mtgBadge` (5146) counts "Notes in progress" meetings.

---

## 6. Stakeholders & RACI — `screen:'stakeholders'` (`isStakeholders`)

### 6.1 Identity

- Route key `stakeholders`. Nav: Project › Team & exchanges › "Stakeholders & RACI" (`ph-users-four`). Project-scoped.
- Roles: director, pm.

### 6.2 Purpose

This screen holds the register of the people and organisations around the project: client, authorities, suppliers, third parties and internal sponsors. For each it shows the relationship owner and the last contact date, and flags anyone not contacted for more than 30 days. Below sits the project RACI matrix of key responsibilities.

### 6.3 Layout (template 870–879)

Stack: KPI row (4 tiles) → "Stakeholder register" card → "RACI matrix" card (only when the project has a RACI).

### 6.4 Components

**KPIs** — `stkKpis` (4936):

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Stakeholders (Parties prenantes) | count (8) | "{c} client · {a} authorities · {s} suppliers & third parties" | OK |
| Relationship owners (Référents relation) | distinct owners (4) | owners joined " · " | OK |
| RACI responsibilities (Responsabilités RACI) | RACI rows (7) | "{n} roles" | OK |
| No contact > 30 days (Sans contact > 30 j) | stale count (1) | "relationship owner to follow up" | LO if > 0 |

**Register table** (`.table` 12.5px, inside a card with `overflow:auto`):

| Header (FR) | Cell |
|---|---|
| Stakeholder (Partie prenante) | 28px circle avatar (`neutral-800`, initials = first letters of the first two words, e.g. "Port authority HSE" → "Pa") + name (500) + "{org} · {role}" (11px `neutral-400`) |
| Kind (Nature) | tag 10.5px: Client → `tag-accent`; Internal → `tag-neutral`; Authority / Supplier / Third party → `tag-outline` |
| Relationship owner (Référent relation) | owner (12px) |
| Last contact (Dernier contact) | "{last}" or "{last} · > 30 d"; LO when stale |
| Contact | e-mail or "—" (`neutral-300`, nowrap) |
| (no header) | notes, 11.5px `neutral-400`, max-width 260px, wrapping |

- Stale rule: `(PG_NOW − mIdx(last + ' 2026')) × 30 > 30`. The year 2026 is assumed.
- Empty state: "No stakeholder yet" (Aucune partie prenante).
- There are no row actions, sorting or filters.

**RACI matrix** (`raciCols`, `raciRows`):

- Card title "RACI matrix" (Matrice RACI); sub "R responsible · A accountable · C consulted · I informed" (FR "R réalise · A approuve · C consulté · I informé").
- Grid `220px repeat(6, minmax(96px,1fr))`, gap 4px, `min-width:820px`. **The 6 columns are hard-coded**; this must become dynamic.
- Header: an empty cell, then role labels (10.5px uppercase .06em, centred, wrapping).
- Rows: a label cell (12.5px), then cells 32px high, radius md, centred 13px weight 500:

| Value | Background | Text | Border |
|---|---|---|---|
| A | `accent-800` | `accent-100` | `1px solid neutral-800` |
| R | `accent-900` | `accent-300` | `1px solid neutral-800` |
| C | transparent | `neutral-300` | `1px solid neutral-800` |
| I | transparent | `neutral-500` | `1px solid neutral-800` |
| (empty) | transparent | – | `1px dashed neutral-900` |

- The matrix is read-only.

### 6.5 Interactions and state

- Project picker only.
- Primary "Add stakeholder" opens AF `stakeholders`; submit "Add".

| id | Label | Type | Default | Req |
|---|---|---|---|---|
| name | Name | text | "" | ✓ |
| org | Organisation | text | "" | ✓ |
| role | Role | text | "" | – |
| type | Type | select Client / Internal / Supplier / Authority / Third party | Client | – |
| contact | Contact (e-mail) | text | "" | – |
| owner | Relationship owner | select TEAM (full names) | first | – |

- Stored in `added.stakeholders`.
- Rendered with `last:'30 Sep'` and `notes:'New'`. The owner appears as a full name ("Amélie Ollivier") while seeded rows use short names ("R. Aubert"); this needs normalising.
- There is no e-mail validation.
- Toast: "Stakeholder added".

### 6.6 Data

- `STAKEHOLDERS[project]` (HLT only). Tuple: `[name, org, role, type, influence, interest, attitude, contact, owner, lastContact, notes]`. Influence, interest and attitude are always `0, 0, ''` and are not displayed.
- `RACI[project]` (HLT only): roles = Project manager, Engineering lead, Client PM, Port HSE, Site manager, Quality. Rows:
  - Design release (BPE)
  - Site access & permits
  - HV energisation
  - FAT acceptance
  - Change requests
  - Payment milestones
  - SAT & handover

### 6.7 Cross-links

- Meetings: invitees and organizers are the same people; nothing links them in code.
- Interfaces: the "Other party" field.
- Contract / Client portal: the client people.
- `PERSONAS.client` (Nadia Bensaïd) is the client PM listed here.

---

## 7. Scheduling engine features — what exists vs what is implied

| Capability | In the prototype | Rebuild requirement / note |
|---|---|---|
| Critical path | **Not computed.** Schedule uses the static `crit` flag per package (`HTASKS[7]`, `DEFS.pk[4]`). Plan highlights "behind" = `tf < 0 && pc < 100` with a lightning icon. TF values are static data. | Implement CPM (forward/backward pass on working-day calendars, FS/SS/FF/SF + lags, constraints SNET/FNLT…). Critical = TF ≤ 0 (or the longest path). Feed both screens. |
| Dependencies | Stored per activity `p:[[predId, type, lagDays]]`. Editable as text in the Structure view. Listed in the drawer (the first one is labelled "driving"). Counted in KPIs. **No arrows** on any Gantt. | Validate cycles and unknown IDs with visible errors. Compute "driving" from the CPM result, not from list order. |
| Constraints | Read-only strings (`c`: "FNLT 17 Apr", "SNET 18 May", "SNET 12 Oct", "FNLT 18 Dec") + `viol` flag | Editable constraint type and date; violation computed |
| Baseline display | Schedule: baseline bars/diamonds when the `showBaseline` prop is on. Plan: "BL finish" column + variance. Portfolio: baseline finish line. One baseline only (BL1). | Multiple baselines (BL0/BL1/BL2 exist in `BASELINES`, Change-control area); the Baseline chip implies a selector |
| Re-baseline / Set baseline | AF `schedule` → toast only. "Set baseline" button has no handler. | Snapshot activity dates and budgets; approval workflow (approver field) |
| Reschedule | Button only | Run CPM at the data date |
| Calendars | Drawer shows "Site 6d · 10h" or "Standard 5d · 8h" (rule: WBS 1.1 or A1230 = office). Toolbar chip is static. AF duration uses 5/7 working days. `np.cal` in the new-project wizard offers 'Standard 5d · 8h', 'Site 6d · 10h', '24h continuous'. | Calendar entity per project/activity |
| Drag / resize on Gantt | **None** | – |
| Progress entry | Per-activity % (input, step 5) + "Mark complete" + AF "Update progress" | Should drive EV and the Schedule roll-up; actual dates when 100% |
| MS Project import/export | **Not in these screens.** Only in Activity & integrations (`plumbing`): connector row "MS Project — Schedule import / export (XML) — On demand — Ready — 25 Sep 18:02 — HLT-026 exported · BL1" (`CONNECTORS`, 3570). Import cards "MS Project XML — Import a schedule into a new or existing project (WBS, activities, links, calendars, baselines)", "Primavera P6 XER — Schedule import with activity codes and resources", "Export — MS Project XML — Current project schedule with baseline" (`IMPORTS`, 3571). Each card has a "Drop a file or click to choose" zone with no handler. Header "Export" button: no handler. | Field mapping: WBS ↔ `w`, UID ↔ `id`, Duration ↔ `d`, PredecessorLink(Type 0–3 = FF/FS/SF/SS, LinkLag in tenths of minutes) ↔ `p`, ConstraintType/Date ↔ `c`, Baseline0 Start/Finish ↔ BL1, PercentComplete ↔ `pc`, Cost ↔ `b`. See Open questions. |

---

## Data entities

### Activity (WBS row) — `HACTS` / `PD.ACTS`

| Field | Type | Example | Notes |
|---|---|---|---|
| id | string `A\d+` | "A1250" | Absent on summary rows. Generated: `'A'+idx+pkg+phase+'0'`; added: `'A'+idx+'9'+NN` |
| w | string | "1.4" | WBS code; root "1" |
| n | string | "Steel erection — Bays 3–4" | Name |
| lv | 0 \| 1 | 1 | Summary rows only (0 root, 1 WP) |
| d | int (working days) | 40 | Original duration |
| s | string | "17 Aug A" | Start display; " A" suffix = actual. **The rebuild should store ISO dates + an `actualStart` flag.** |
| f | string | "09 Oct" | Finish display; " A" = actual; "’27" = 2027 |
| bl | string | "31 Aug" | BL1 finish |
| v | int (days) | −39 | Finish variance vs baseline (negative = late) |
| p | `[predId, 'FS'\|'SS'\|'FF'\|'SF', lagDays][]` | `[['A1240','FS',0],['A1220','FS',10]]` | Logic links |
| c | string | "FNLT 18 Dec" | Constraint ("" = none) |
| viol | bool? | true | Constraint violated |
| tf | int \| null | −27 | Total float, days; null = complete |
| pc | 0–100 | 72 | % complete |
| o | string (OWN key) | "JW" | Owner |
| b | [budget, actual, EAC] k€ | [280, 210, 470] | |
| pkg | string? | "Survey & design" | Generated projects |
| added / proj / crit / desc | – | – | User-added activities |

Root summary: `{w:'1', n, lv:0, s, f, bl, tf}`. WP header: `{w, n, lv:1}`.

Per-project UI overrides (to become real persisted edits):

- `wbsOv["{proj}|{id|w}"] = {n?, o?, d?, b?, pt?, pc?}`
- `wbsRm` = removed flags
- `wbsOrd["{proj}|{w}"]` = ordered ids

### Work package (schedule bar) — `HTASKS` / `PD.TASKS`

Tuple `[name, ownerShort, baselineStart, baselineEnd, forecastStart, forecastEnd, pctComplete, critical]`. Times are fractional months from the project start, e.g. `['Steel structure','J. Wagner',5.5,8.5,7,9.8,72,true]`.

### Milestone — `HMILES` / `PD.MILES`

Tuple `[name, baselineMonth, forecastMonth, status]`. status ∈ "Done" | "Late" | "At risk" | "On track". Example: `['Handover',11.6,12.45,'At risk']`.

### Project schedule header (PD)

`start` (month offset), `tNow`, `floatDays`, `finishText`, `baselineText`, `floatText`, `floatShort`, `critText`, `milesText`, `milesSub`, `baselineSet`, `pct`, `p3`, `chartMonths[12]`, `ganttMonths[13]`, `PV[12]`, `EV[≤12]`, `AC[≤12]`, `BAC`, `team[]`.

### Owner / person — `OWN`, `PEOPLE`, `INIT_OF`

- `OWN` = `{RA:['Romain Aubert','Project manager'], AO:['Amélie Ollivier','Site lead'], JW:['Julien Wagner','Structural engineer'], TK:['Thomas Kerbrat','Crane operations'], PN:['Pauline Noguès','MEP lead'], FB:['Fabien Bertrand','Procurement'], HS:['Hélène Sauvage','QA / QC'], LM:['Léa Marchand','Cost controller'], DR:['Damien Roux','Planner']}`
- `INIT_OF` = full name → initials
- `PEOPLE` = `[name, role, weeklyLoad%[8]]` (8 people; Romain Aubert is absent)

### To-do (linked to an activity) — `TODOS` → `state.todos`

| Field | Type | Example |
|---|---|---|
| id | string | "T-2314" |
| person | full name | "Hélène Sauvage" |
| title | string | "Survey verticality — Bay 3 columns" |
| project | 3-letter | "HLT" |
| act | activity id | "A1250" |
| status | todo \| doing \| review \| done | "doing" (labels `STATUS_L`: To do / In progress / In review / Done) |
| prio | high \| med \| low | "high" |
| start, due | int day offsets from Mon 21 Sep 2026 (5-day weeks) | 3, 4 |
| est, logged | hours | 8, 6 |
| cl | [done, total] checklist | [2,4] |
| labels | string[] | ['QA','Site'] |
| pct | 0–100 | derived: done → 100, else `min(100, logged/est*100)` |

`CHECKS[todoId] = [[text, done 0|1]]` seeds the per-to-do checklists (`state.checks`; used on the Task screen).

### Resource request (shown in the drawer) — `REQUESTS`

Fields: `id`, `pm`, `project`, `person`, `dept`, `title`, `act`, `hours`, `start`, `due` (week offsets), `prio`, `status` (pending | approved | reschedule | rejected | withdrawn), `sent`, `note`, `response`, `propStart`, `propDue`, `todoId`.

### Activity resource assignment — `A1250_RES`

Tuple `[name, sub, units, progressText]`, e.g. `['Steel erection crew','Subcontractor · 6 ironworkers','6 × 10 h/d','1,840 / 2,400 h']`. In the rebuild: an assignment = {resource (person / crew / equipment / material), units, planned qty, actual qty}.

### Portfolio project (subset used) — `state.projects`

`code`, `name`, `status` (one of `STATUSES`: Initiative, APS, APD, Etudes, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise Service & SAT, Garantie, Clos, Annulé), `pm`, `client`, `start` ("Jan 2026"), `finish` ("Dec 2026" | "—"), `budget` k€, `actual`, `progress` 0–1, `spi`.

- `PROJ_ID[code]` = `{id:'#026', das, mt, ana}`. The display name is `pname` = "#026 · Name".

### Stage history — `STAGE_HISTORY` → `state.stageHist`

`{code: [[stage, 'D Mon YYYY', 'auto'|'forced', reason]]}`.

### Pipeline stage plan — `PIPE_PLAN`

`{code: [[stage ('Initiative'|'Board'|'APS'|'APD'), startMonth, endMonth]]}`. Months are counted from Jan 2026.

### Levelling lever / scenario — `LEVERS`, `AUTO`, `state.whatif`, `state.chosen`

- Lever: `[id, label, {float:int d, cost:int k€, peak:int pts, over:int people, side?:string}]`
- `AUTO`: `{date|budget|people: leverId[]}`
- Scenario: `{prio:'date'|'budget'|'people', levers:{[id]:bool}}`; `chosen: 'A'|'B'|null`

### Deliverable (client view) — `DELIVERABLES`

Tuple `[id, title, type, status ('Submitted'|'Accepted'|'Due'), dueText]`, e.g. `['D-014','Crane rail alignment report','Test & inspection reports','Submitted','Accept by 02 Oct']`. Used on the client Home only.

### Baseline (cross-area) — `BASELINES`

Tuple `[id, name, date, BAC k€, finish, state ('Superseded'|'Current'|'Proposed')]`:

- BL0 Proposal estimate (18 Jan 2026, 4400, 18 Nov 2026, Superseded)
- BL1 Approved baseline (12 Mar 2026, 4600, 18 Dec 2026, Current)
- BL2 Recovery re-baseline (Pending CR-009, 4885, 14 Jan 2027, Proposed)

### Meeting — `MEETINGS` (+ `added.meetings`, + `mtg.ov`, + `mtg.lines`)

| Field | Type | Example |
|---|---|---|
| id | string | "MTG-118" |
| title | string | "Weekly site meeting #24" |
| series | string | "Weekly site meeting" |
| type | Internal \| External | |
| proj | project code | "HLT-026" |
| date | "D Mon YYYY" | "29 Sep 2026" |
| time | "HH:MM" | "08:30" |
| dur | string | "45 min" |
| loc | string | "Site office · Le Havre" |
| organizer | short name | "R. Aubert" |
| invited | short names[] | |
| present | short names[] | |
| status | Scheduled \| Notes in progress \| Minutes sent | |
| doc | MIN document id | "MIN-HLT-023" |
| sent | date text | "26 Sep" |
| read | {name: readDate \| ''} | |
| agenda | `{pt: string, lines: Line[]}[]` | |

- Line = `[type ('info'|'decision'|'action'), text, owner?, due?]`
- Line identity = `"{meetingId}|{agendaIdx}|{lineIdx}"`; done flags live in `MTG_DONE` + `mtg.ov[id].done`
- `MTG_TRANSCRIPTS[id]` = raw transcript text
- `MTG_EXCHANGE[project]` = `[{text, who, dept, owner, state ('open'|'answered'), answer?}]`

### Stakeholder — `STAKEHOLDERS[project]` (+ `added.stakeholders`)

Tuple `[name, org, role, type ('Client'|'Internal'|'Supplier'|'Authority'|'Third party'), influence (0), interest (0), attitude (''), contactEmail, ownerShort, lastContact ('D Mon'), notes]`.

### RACI — `RACI[project]`

`{roles: string[6], rows: [activityLabel, ...('R'|'A'|'C'|'I'|'')[roles.length]]}`.

---

## Status machines / workflows

1. **Activity progress status (Plan table)**, derived from `pc` and `tf`:
   - Not started (pc = 0)
   - In progress (0 < pc < 100)
   - Behind (tf < 0 and pc < 100; takes precedence over In progress and Not started)
   - Completed (pc = 100; tf → null)
   - The drawer variant uses the labels "Not started" / "In progress · n%" / "Complete".
2. **Milestone status**: On track → At risk (baseline within 2 months of now) → Late (slip > 0.4 month) → Done (forecast ≤ now). Generator rule in 0.5; HLT values are static.
3. **Baseline**: BL0 Superseded → BL1 Current → BL2 Proposed (pending CR-009). Re-baseline AF "Freeze new baseline" is meant to promote a proposal to Current with an approver; the prototype only shows a toast.
4. **Portfolio stage gates**: Initiative → [Group board] → APS → [Group board] → APD → [Group board] → Execution (Etudes …). Each board is Planned → Decision pending (now inside its window; "Decision pending · N d", alert when > 21 d) → Approved (window ended). The full lifecycle is `TRANS`: each stage moves to the next stage or to Annulé; Clos and Annulé are terminal.
5. **Meeting**: (New meeting) → Scheduled → Notes in progress (first manual note via the composer) → Minutes sent (Send minutes: MIN document issued as Released rev A, action to-dos created, read receipts tracked). Any status can be sent; there is no guard.
6. **Meeting action**: Open → Overdue (due < PG_NOW) → Done (checkbox; reversible). Done actions leave the carry-over list of the next meeting in the series.
7. **Client question bridge**: open ("Needs an answer") → answered ("Answer ready"). Answered items are carried to the external meeting's prep.
8. **Transcript analysis**: not analysed → analysed (summary and draft lines) → applied ("Added to the minutes").
9. **What-if scenario**: draft (levers toggled, priority set) → Selected (`chosen`). Intended: → resource requests created → department approval → assignment.

---

## Cross-links

| From | Trigger | To |
|---|---|---|
| Overview alert "Open schedule" | click | Schedule (project HLT-026 or RCF-019) |
| PM Home "Re-baseline proposal → Prepare" | click | Schedule |
| Plan drawer "Show in Gantt" | click | Schedule (same project) |
| Projects / Overview / My projects / Map / Machine types / Search "Project" | click project | Plan (project) |
| Search "Activity", PO drawer, Risk drawer, NCR drawer | open activity | Plan with drawer on that activity |
| Task detail | open activity | Plan, activity selected, WP expanded |
| Budget "goPlan" | click | Plan |
| Plan drawer to-do | click | Task (`screen:'task'`) |
| Plan drawer pending requests | display | Resource requests data |
| Portfolio schedule row | click | Plan (DEFS projects) or Projects filtered by code |
| Risk drawer "what-if", Site collisions "Load" | click | What-if levelling |
| What-if "Select scenario → create requests" | (intended) | Resource requests / Approvals |
| Meetings "Open minutes" | click | Documents (Codex), doc opened |
| Meetings "Send minutes" | submit | Creates a MIN doc in Documents and to-dos in My work |
| Schedule data | reuse | PM Home KPIs (SPI, float), Client Home milestones, Client portal progress chart |
| Plumbing › Imports / Connectors | (intended) | MS Project XML / P6 XER import into Plan; export with baseline |

---

## Open questions

1. **Single source of truth.** The Schedule screen reads the static `TASKS`/`MILES`/`PV`/`EV` and ignores the Plan WBS and its edits. The plan root % (`PD.pct`, 64) differs from the Plan KPI "Overall progress" (63 %). Should package bars, milestones and SPI be roll-ups of the WBS? (Recommended: yes.)
2. **Scheduling engine.** "Reschedule" and "Set baseline" have no behaviour, and editing duration or predecessors does not move dates. Confirm that a CPM engine (calendars, constraints, lag units, SF links) is in scope, and whether "driving" predecessors should be computed.
3. **Critical path definition.** The prototype mixes a static `crit` flag (Schedule) with "TF < 0 and not complete" (Plan "Behind", the lightning icon, and the "Activities" KPI sub "N on the critical path"). Which definition is authoritative?
4. **Calendars.** What are the calendar rules? Today "Site 6d · 10h" vs "Standard 5d · 8h" is decided by a hard-coded rule (WBS 1.1 or A1230). The Calendar and Baseline toolbar chips imply dropdowns; what are the options?
5. **Multiple baselines.** The Baseline chip shows "BL1 · 12 Mar 2026" for every project. Should the user be able to switch the displayed baseline (BL0/BL1/BL2 from `BASELINES`)? Does Re-baseline need an approval workflow (approver field), linked to change requests (BL2 "Pending CR-009")?
6. **Data date vs today.** The prototype uses 25 Sep 2026 (status date, Plan), `tNow` 8.8 and `PG_NOW` 8.97 (~30 Sep). Confirm one data date per project, plus the real current date for overdue and staleness.
7. **Edit permissions.**
   - Inline WBS inputs remain editable for `projReadOnly` projects and for "outside" personas. Only names, row actions and the progress input are blocked, and only for the client; Owner, Dur, Budget and Predecessors are never gated.
   - Meetings composer, send and checkboxes have no role gate (the client can send minutes).
   - Should englead and quality edit the WBS?
8. **Removal semantics.** Removing a WP silently removes its activities, with no confirmation or undo. Links pointing to removed activities remain in other activities' predecessor data. Should a confirmation step and link cleanup be added?
9. **New WP fields.** The Add work package owner, budget and scope are stored but never shown. Should WP-level budget and owner exist, or roll up from activities only?
10. **Predecessor validation.** Unknown IDs and bad syntax are dropped silently. What error UX is wanted, and should cycles be detected?
11. **What-if model.** Effects are static constants and scenarios are fixed to A/B and the HLT steel slip. "New scenario" only shows a toast. "Select scenario → create requests" creates nothing. Should scenarios be persisted per project, levers derived from real allocations, and requests generated?
12. **What-if KPI label.** "Baseline finish" shows the current forecast (14 Jan 2027), and the baseline appears in the sub. Is the label or the value wrong?
13. **Meetings — Decisions register headers.** The "Project" column shows the agenda point and "Status" shows the meeting type (Internal/External). Should the headers be renamed ("Agenda point", "Type") or should the content change?
14. **Meetings — client visibility.** The client persona sees internal meetings, transcripts and internal Q&A. Is confidentiality filtering needed (External meetings only)?
15. **Minutes numbering.** The MIN id is hard-coded "MIN-HLT-" + (24 + sent + 1) for every project, with a fixed send date of "30 Sep". It should come from the Codex numbering rule of the project.
16. **Transcript analysis.** It is simulated with pre-baked results. Confirm the real source (Teams/Outlook transcript) and whether the summary is produced by an LLM. Where is a human review step required?
17. **Action → task mapping.** To-dos are created only for owners resolvable in `PEOPLE`. External owners (e.g. "N. Bensaïd") get none. Due is always TODAY+3 instead of the typed due. `act` is not linked. Is this intended?
18. **Outlook sync.** "Synced from Outlook" and "invitation synced to the calendar" are labels only. What is the sync direction and conflict policy?
19. **Stakeholder fields.** Influence, interest and attitude exist in the data (always 0/0/'') but are not shown. Is a power/interest grid planned? Owners should be normalised (short vs full names). Should "Last contact" be derived from meetings and e-mails?
20. **RACI.** The grid is hard-coded to 6 role columns, and RACI is read-only. Is an editor needed, and which roles (project roles or stakeholders)?
21. **MS Project / P6.** Which version and schema (MSPDI XML 2003+), mapping of calendars and resources, and import mode (new project vs update existing, with ID matching on UID or Activity ID)? Does export include BL1 only or all baselines?
22. **Portfolio schedule horizon.** It is fixed at Jan 2026 – Dec 2027 (24 months), with `→ finish` clipping. Should the horizon scroll or zoom?
23. **FR dictionary errors.** These entries need correcting:
    - "Start" → "Démarrer" (should be "Début")
    - "Time" → "Temps" ("Heure")
    - "Location" → "Emplacement" ("Lieu")
    - "Complete" (KPI) → "Avancement"
    - "Behind", "Late" and "Overdue" all → "En retard"
    - Several dynamic strings are partly untranslated, e.g. "Terminés · 0 on baseline date" and "+15d".
24. **Units.** Slip and float use days ("d"), but month fractions ×30 are calendar days while durations are working days. Which unit applies where?

---

## Addendum (completeness pass)

Traceability for the Meetings and Stakeholders `<sc-if>` flags. Their behaviour is described in §5.4 and §6.4; this table adds the identifiers.

| Flag | Template lines | Logic (render-values line) | Meaning |
|---|---|---|---|
| `mtgIsMeetings` / `mtgIsDecisions` / `mtgIsActions` | 757–804 / 805–807 / 808–810 | `mtgS.view === 'meetings' \| 'decisions' \| 'actions'` (5199) | The three Meetings sub-views chosen with `mtgViewSeg`. |
| `noMeetings` | 763 | `!mtgList.length` (5199) | Empty meeting list: "No meeting in this view" (FR "Aucune réunion dans cette vue"). |
| `hasMtgSel` | 766–802 | `!!mtgSel` (5199); `mtgSel` built at 4857 from the selected meeting `MS` | Right-hand meeting detail card (header "Synced from Outlook · {series}", attendance, agenda, minutes …). |
| `hasMtgPrep` | 771–789 | `!!mtgPrep` (5199); `mtgPrep` (4835) is `null` when no meeting is selected or its status is "Minutes sent", otherwise it is built from the latest earlier meeting of the same `series` with status "Minutes sent" | Preparation block: "Decisions from the previous meeting" (FR "Décisions de la réunion précédente") plus the carried-over actions. |
| `noStk` | 873 | `!stkRows.length` (5201) | Stakeholder register empty: "No stakeholder yet" (FR "Aucune partie prenante"). |
| `hasRaci` | 874–876 | `!!raciRows.length` (5201) | Renders the "RACI matrix" card (FR "Matrice RACI") with legend "R responsible · A accountable · C consulted · I informed". |
