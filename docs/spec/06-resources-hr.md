# 06 — Resources, rates, skills, leave & hours (HR / capacity area)

Source of truth: `design/Keystone PM v8.dc.html` (template lines quoted below are identical in `design/_extracted/template-annotated.html`, where `{{ T.kN }}` is replaced by «English text»). Logic lives in `class Component` → `renderValsEN()`; line numbers below refer to the prototype file.

| Screen | Route key (`state.screen`) | Template flag | Template lines | Logic lines | Nav location | `startScreen` option |
|---|---|---|---|---|---|---|
| Resources (portfolio pool) | `resources` | `isResources` (and not `isPResources`) | 573–637 | 3866–3886 | Sidebar › **Resources** › "Resources" | yes (`resources`) |
| Project resources | `presources` | `isResources` + `isPResources` | 573–637 (same block) | 3866–3886 | Sidebar › **Project** › *Steering* › "Project resources" | yes (`presources`) |
| Rate cards | `rates` | `isRates` | 1420–1450 | 4381–4389 | Sidebar › **Resources** › "Rate cards" | yes (`rates`) |
| Skills matrix | `skills` | `isSkills` | 1451–1476 | 4390–4396 | Sidebar › **Resources** › "Skills matrix" | yes (`skills`) |
| Leave & working calendar | `leave` | `isLeave` | 1477–1503 | 4398–4404 | Sidebar › **Resources** › "Leave & calendar" | yes (`leave`) |
| Hours — Lucca reconciliation | `hours` | `isHours` | 932–947 | 5008–5018 | Sidebar › **Project** › *Steering* › "Hours (Lucca)" | **no** (not in the `startScreen` enum) |

Also covered: the shared data constants `PEOPLE`, `ROLES`, `DEPTS`, `DEPT_OF`, `RATES`, `RATE_ROLES`, `MULTS`, `SKILLS`, `SKILL_LV`, `CERTS`, `LEAVE`, `LEAVE_DAYS`, `HOLIDAYS`, `HOURS`, `ENTRIES`, the Lucca connector row in `CONNECTORS`, and the formulas for load, capacity, availability and hours variance.

---

## 0. Things every screen in this area shares

### 0.1 Page shell (template 75–135, logic 5109, 5137, 5162–5177)

- Main column: `<main>` flex column, `gap:18px`, `padding:20px 28px 40px`, on the app background `radial-gradient(1200px 600px at 70% -10%, var(--color-accent-900), transparent 60%), var(--color-bg)`. Sidebar is 232px (grid `232px minmax(0,1fr)`).
- Header: breadcrumb (`crumb`, 12px, `--color-neutral-400`), then `<h2>` title at 26px, then on the right the global search, the FR/EN segmented control, a **"Export"** secondary button (`ph ph-export`, **no handler**) and the page primary button (`btn btn-primary`, always with icon `ph ph-plus`, label `primaryAction`).
- Title (`titles` map, line 5109) and breadcrumb (`crumbOf()` + `CRUMB_EXTRA`, line 5162–5163):

| Screen | Title (EN) | Title (FR) | Breadcrumb (EN) | Project picker in header (`showProjectPicker`) | Primary button (EN / FR) → handler |
|---|---|---|---|---|---|
| resources | "Resources" | "Ressources" | "Resources · all projects" | no | "Request resource" / "Demander une ressource" → `openNr` |
| presources | "Project resources" | "Ressources du projet" | "Project · Steering" + `/` + project picker | yes | "Request resource" → `openNr` |
| rates | "Rate cards" | "Grilles de taux" | "Resources" | no | "Add role" / "Ajouter un rôle" → `afOpen('rates')` |
| skills | "Skills matrix" | "Matrice de compétences" | "Resources" | no | "Add skill" / "Ajouter une compétence" → `afOpen('skills')` |
| leave | "Leave & working calendar" | "Congés et calendrier de travail" | "Resources · Lucca" | no | "Sync Lucca" / "Synchroniser Lucca" → `afOpen('leave')` |
| hours | "Hours — Lucca reconciliation" | "Heures — rapprochement Lucca" | "Project · Steering" + project picker | yes | "Import Lucca" / "Importer Lucca" → `afOpen('hours')` |

- `hasPrimary` (line 5177) = primary label and handler exist **and** `!outside` **and** not (`projReadOnly` and screen ∈ list that includes `presources` and `hours`). So on a project the current persona does not own (read-only scope), Project resources and Hours hide their primary button and the header shows a `tag tag-outline` "Read-only" (FR "Consultation") with `ph ph-eye`.
- "Outside my workspace" (line 5155–5156, template 126–128): if the current role's `ROLE_SCREENS` list does not contain the screen (reachable via global search or quick-jump), a banner `Outside my workspace · Read-only · <persona title>` with a ghost "Home" button (`goHome`) is shown, the nav shows a temporary "Outside my workspace" section, and the primary button is hidden.

### 0.2 Role visibility (`ROLE_SCREENS`, line 3465–3466; `PERSONAS`, line 3747)

`director: null` means every screen. Lists below include the `.push(...)` additions on line 3466.

| Screen | director (Marie Lefebvre, Portfolio director) | pm (Romain Aubert) | depthead (Marion Kerviel, Head of engineering) | member (Julien Wagner) | englead (Antoine Girard) | quality (Gabriel Comte) | procurement (Fabien Bertrand) | client (Nadia Bensaïd) |
|---|---|---|---|---|---|---|---|---|
| resources | ✓ | – | ✓ | – | – | – | ✓ | – |
| presources | ✓ | ✓ | – | – | – | – | – | – |
| rates | ✓ | ✓ | – | – | – | – | – | – |
| skills | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| leave | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| hours | ✓ | ✓ | ✓ | – | – | – | – | – |

Switching persona (bottom-left role menu, `roleOptions` line 5102) sets `{role, roleMenu:false, screen:'home'}`. Rate values are additionally gated by `canSeeRates = ['director','pm'].includes(role)` (line 4382).

### 0.3 KPI tile (identical markup on all six screens)

`div.card.elev-sm` with `gap:3px; padding:12px 14px`:
- label: 10.5px, `letter-spacing:0.08em`, uppercase, `--color-neutral-400`
- value: 22px, weight 500, `letter-spacing:-0.02em`, `color: k.color`
- sub: 11.5px, `--color-neutral-400` (Hours adds `text-wrap:pretty`)

Tile grid: `display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px` on Resources, `minmax(150px,1fr)` on Rates / Skills / Leave / Hours.

Colour constants (line 3135): `LO = 'var(--color-accent-300)'` (needs attention), `OK = 'var(--color-text)'`.

### 0.4 Generic action-form dialog (template 138–158, logic 5111–5136, defs `AF` 3674–3700, toasts `AF_RESULT` 3701)

Used by "Add role", "Add skill", "Sync Lucca", "Import Lucca".
- `dialog-backdrop` (`z-index:50; align-items:start; padding-top:8vh`) › `.dialog` `width:min(640px,100%); gap:14px; max-height:84vh; overflow:auto`.
- Header: `dialog-title` = `AF[key].title`; subtitle `"{projectName} · Required fields are marked · *"` (asterisk in `--color-accent`). The subtitle always shows the current project, even on portfolio-level screens (Rates/Skills/Leave).
- Body grid `repeat(2,minmax(0,1fr))`, gap 12px. Field spans full width (`1 / -1`) if it is a textarea or its id is `title`, `name`, `progress`, `reason` or `why`; otherwise one column.
- Field kinds: `text` → `input.input`; `number` → `input.input[type=number]` tabular; `select` → `select.input` whose first option is the default.
- Validation (`afValid`): every field flagged required (5th tuple item = 1) must be non-blank; selects always pass. Submit button `disabled` until valid.
- Buttons: "Cancel" (`btn-secondary`, `afClose`) and submit (`btn-primary`; icon `ph ph-play` when `kind==='run'`, else `ph ph-check`).
- On submit: dialog closes, toast shown bottom-right for 4 s (`showToast`, `card elev-lg`, `border:1px solid var(--color-accent-800)`, `ph ph-check-circle` icon, close ×). In FR the toast is translated segment by segment on " · ".

### 0.5 i18n

The app boots in French (`state.lang:'fr'`, line 3774). `renderVals()` (line 3776) runs `deepTr()` over every string value except keys in `SKIP_KEYS` (colours, widths, `initials`, `h`, `availColor`, `avgColor`, `varColor`, `barBg`, `dW`, `cL`, …). Translations come from `FR_DICT` (exact match) then `FR_RULES` (regex) then month/day substitution. French labels given in this spec are the `FR_DICT` / `FR_RULES` values. Where none exists the English string is displayed as-is in FR (noted "no FR").

---

## 1. Resources (`resources`) and Project resources (`presources`)

### 1.1 Key, nav, audience
- `isResources = screen==='resources' || screen==='presources'`; `isPResources = screen==='presources'` (line 5174). Local alias in logic: `isPRes` (line 3869).
- Resources: sidebar section **Resources** (FR "Ressources"), item "Resources" icon `ph ph-users-three`. Project resources: sidebar **Project** › sub-group *Steering* (FR "Pilotage"), item "Project resources" (FR "Ressources du projet"), icon `ph ph-user-list`.
- Seen by director, depthead, procurement (Resources) and director, pm (Project resources) — see 0.2.

### 1.2 Purpose
Resources is the department heads' / director's view of the whole shared engineering & site pool: who is loaded at what % over the next 8 weeks, where demand exceeds capacity by department, and suggested rebalancing to protect the critical path (here the Harbor Line steel slip, stage *Fabrication & Assemblage*). Project resources is the same view restricted to the team of the selected project, for the project manager.

### 1.3 Layout (template 573–637)
```
column (gap 14px)
├─ [presources only] info banner                                         (line 575)
├─ KPI grid: repeat(auto-fit,minmax(160px,1fr)), gap 10px — 5 tiles      (576–584)
└─ flex-wrap row (gap 14px, align-items:flex-start)                       (585–635)
   ├─ Allocation card   flex: 2 1 560px; min-width:0; overflow:auto       (586–607)
   └─ right column       flex: 1 1 280px; column gap 14px                 (608–634)
      ├─ Capacity vs demand card                                          (609–620)
      └─ [showSuggestions] Suggested rebalancing card                     (621–633)
```
All cards: `card elev-sm`, `padding:14px 16px`, gap 10px (suggestions card gap 6px). Responsive: the two flex children wrap below each other when the row is narrower than ~840px (560 + 280 bases); the allocation card scrolls horizontally inside itself.

### 1.4 Components

**a) Project banner (presources only, line 575)** — flex row, gap 8px, 12.5px, `--color-neutral-300`, `padding:10px 12px`, `border-radius:var(--radius-md)`, background `--color-neutral-900`; icon `ph ph-users-three` in `--color-accent`. Text: "Only people assigned to" + `projectName` (in `--color-text`, e.g. "#026 · Harbor Line Terminal Expansion") + "— the whole pool is under Resource management." FR: "Uniquement les personnes affectées à … — l’ensemble du vivier se trouve dans Gestion des ressources."

**b) KPI tiles — `resourceKpis` (line 3877–3882)**

| # | Label (EN / FR) | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Resources: "Team utilization" / "Taux d’occupation"; Project: "Project team load" / "Charge de l’équipe projet" | `round(tot / people.length)` + "%" where `tot` = Σ of each person's 8-week average | Resources: "Target 85–95%" (FR "Cible 85–95 %"); Project: "N person assigned" / "N people assigned" (FR "N personne affectée" / "N personnes affectées") | always OK |
| 2 | "Over-allocated" / "Surchargés" | count of people whose **max** weekly value > 110, + " person"/" people" | "Peak weeks 41–43" (FR "Pointe semaines 41–43") — hard-coded on both screens | LO if count > 0 |
| 3 | "Unmet demand" / "Demande non couverte" | Resources: **hard-coded `240` h**; Project: Σ over department bars of `max(0, demand − capacity)` + " h" | Resources: "Mostly engineering" (FR "Surtout ingénierie"); Project: "Next 8 weeks, by department" (no FR) | always LO |
| 4 | "Labor cost to date" / "Main-d’œuvre à date" | `f(laborRow[2])` — actual cost of the current project's first cost category matching `/labor|staff/i` | `round(laborRow[2]/laborRow[1]*100)` + "% of labor budget" (FR rule "N % du budget main-d’œuvre") | OK |
| 5 | "Open requests" / "Demandes ouvertes" | count of `state.requests` with `status==='pending'` (Project: and `project === PD.p3`) | Resources: "Across all projects" (FR "Tous projets"); Project: "Awaiting department approval" (FR "En attente d’approbation du service") | OK |

`f(k,signed)` = `this.money(k,signed)` (line 3775): input in k€. EN: ≥1000 → `€1.42M`, else `€340k`; FR + EUR: `1,42 M€` / `340 k€`; signed adds `+`; negatives use `−` (U+2212). Currency prop `EUR|USD` (default EUR).

**c) Allocation heatmap — "Allocation — next 8 weeks"** (FR "Affectation — 8 prochaines semaines"), subtitle "% of available hours per person" (FR "% des heures disponibles par personne").
- Legend (right of title, 11px `--color-neutral-400`): "Under" (FR "Sous") · five 16×10 swatches radius 2px: `--color-neutral-900`, `--color-accent-900`, `--color-accent-800`, `--color-accent-600`, `--color-accent-400` · "Over" (FR "Sur").
- Grid: `grid-template-columns: minmax(150px,200px) repeat(8,minmax(0,1fr)) 52px; gap:4px; align-items:center`.
- Header row: "Person" (FR "Personne", 11px uppercase 0.08em), the 8 week labels `weeks` = `['Sep 28','Oct 5','Oct 12','Oct 19','Oct 26','Nov 2','Nov 9','Nov 16']` (line 5182; 11px centred), "Avg" (FR "Moy.", right-aligned).
- One row per person (`people`, line 3869–3871), using `display:contents`:
  - Person cell: `height:40px`, `border-radius:6px`, `cursor:pointer`, hover background `--color-neutral-900`, tooltip "Open their work" (FR "Ouvrir son travail"). 28px avatar circle (`--color-neutral-800` bg, `--color-neutral-200` text, 11px initials) + name (13px) / role (11.5px `--color-neutral-400`).
  - 8 load cells: `height:34px; border-radius:5px`, centred 12px tabular number **without "%"** (`c.v` is the raw integer), `background:c.bg; color:c.fg` from `shade(v)`.
  - Avg cell: right, 13px tabular, `avgText` = `round(mean)+'%'`, colour `LO` if mean > 100 else `OK`.
- Click on person cell → `p.open` = `setState({screen:'mywork', person:name})` (opens My work filtered on that person).
- No sorting; row order = `PEOPLE` order.

`shade(v)` (line 3867) — heat scale, returns `[background, text]`:

| Load v (%) | Background | Text |
|---|---|---|
| v > 115 | `--color-accent-400` | `--color-bg` |
| 100 < v ≤ 115 | `--color-accent-600` | `--color-accent-100` |
| 90 ≤ v ≤ 100 | `--color-accent-800` | `--color-accent-200` |
| 60 ≤ v < 90 | `--color-accent-900` | `--color-neutral-300` |
| v < 60 | `--color-neutral-900` | `--color-neutral-400` |

The same `shade()` is reused for the department team chips on the Approvals screen (line 4141).

**d) "Capacity vs demand"** (FR "Capacité vs demande"), subtitle "Hours by role, next 8 weeks" (FR "Heures par rôle, 8 prochaines semaines"); footer "Tick marks available capacity" (FR "Le repère indique la capacité disponible").
- Source (line 3872): Resources → constant `ROLES` (`[name, capacityH, demandH]`). Project resources → derived per department of the project's team: for each team member `d = DEPT_OF[name] || 'Other'`; `capacity[d] += 320`; `demand[d] += round(parseInt(avgText) * 3.2)` (i.e. 8 weeks × 40 h = 320 h per person; demand = avg% × 320 h). Department order = first appearance in `PEOPLE` order.
- Each row (line 3873–3874): flex label row (12.5px) with name left and `"{dem} / {cap} h"` right (tabular; colour `LO` if dem > cap else `--color-neutral-300`). Bar track: `position:relative; height:8px; border-radius:4px; background:--color-neutral-900`. Fill: `width:dW`, `background: dem>cap ? --color-accent : --color-neutral-600`. Capacity tick: absolute, `top:-3px; width:2px; height:14px; background:--color-neutral-300; left:cL`.
- Geometry: `sc = max(cap, dem) * 1.1`; `dW = pct(dem/sc)`; `cL = pct(cap/sc)`; `pct(v) = round(v*1000)/10 + '%'` (line 3133). So the larger of the two always sits at 90.9 %.

**e) "Suggested rebalancing"** (FR "Rééquilibrage suggéré"), icon `ph ph-sparkle` accent. Shown when `showSuggestions = screen==='resources' || project==='HLT-026'` (line 5174) — i.e. always on Resources, and on Project resources only for Harbor Line. Static list `suggestions` (line 3883–3886):

| title | impact |
|---|---|
| "Move steel QA checks from Julien Wagner to Hélène Sauvage in weeks 41–42" | "Julien 130% → 105% · no cost" |
| "Bring in a contract structural engineer for 3 weeks" | "Recovers ~12 days float · " + `f(18,true)` (= "+€18k" / "+18 k€") |
| "Shift paving prep 1 week later to free Amélie Ollivier" | "Site lead 120% → 100% · off critical path" |

Each item: `border-top:1px solid --color-neutral-900`, `padding:9px 0`; title 13px; impact 11.5px `--color-neutral-400`; "Apply" (FR "Appliquer") `btn btn-secondary` 12px, `padding:3px 10px` — **no onClick** (see Open questions). Suggestion titles have no FR dictionary entry.

### 1.5 Interactions & state
| Element | Handler | State read/written | Effect |
|---|---|---|---|
| Person cell | `p.open` | writes `screen='mywork'`, `person` | navigates to My work for that person |
| "Request resource" (header) | `openNr` (4157) | `nr.open=true` | opens the "New resource request" dialog (template 3071–3091; logic 4146–4156). Fields: Task (text), Activity chips (`NR_ACTS` A1250/A1260/A1320/A1420/A1430), Person or role chips (8 `PEOPLE` + "Contract role"), Week seg (w/c 28 Sep / 5 Oct / 12 Oct), Duration seg (2 days / 1 week / 2 weeks), Hours, Priority seg (Low / Medium / High), Note; routing hint "Goes to {head} ({dept}) for approval · {first} is at {load}% that week. …". "Send request" prepends a `pending` request (id `RQ-0{45+n}`, pm "R. Aubert", project "HLT") and navigates to `requests`. Fully specified in the Requests/Approvals spec. |
| "Apply" | none | – | no-op in prototype |
| Project picker (presources) | header picker | writes `project` | recomputes `PD`, team, banner, roles, KPIs, `showSuggestions` |

No local state is specific to these screens; everything is derived on each render.

### 1.6 Data & formulas
- `PEOPLE` (line 3123–3131): `[name, role, load[8]]`, load = % of available hours per week for the 8 weeks starting w/c 28 Sep 2026 (status date 25 Sep 2026; `TODAY=4` = Fri 25 Sep in the day index used by `dayDate`).
- `PD.team` (`projectData()`, line 3310): `DEFS[code].team` (HLT-026 = all 8 people). `projectData` falls back to the Harbor Line dataset for unknown codes.
- Person average: `avg = Σ load / 8`. Utilisation KPI = mean of the persons' averages (unweighted). Over-allocation threshold: any week > 110 %. Average colour threshold: > 100 %.
- Reference values (Resources, all 8 people):

| Person | Role | Dept (`DEPT_OF`) | Weekly load | Avg | Max > 110? |
|---|---|---|---|---|---|
| Amélie Ollivier | Site lead | Site operations | 100 110 120 120 100 90 90 80 | 101% (LO) | yes |
| Julien Wagner | Structural engineer | Engineering | 90 100 130 125 110 100 80 60 | 99% | yes |
| Pauline Noguès | MEP lead | MEP | 80 90 100 110 115 100 100 90 | 98% | yes |
| Thomas Kerbrat | Crane operations | Site operations | 60 100 100 100 80 40 20 20 | 65% | no |
| Léa Marchand | Cost controller | Controls & planning | 70 70 70 80 80 70 70 70 | 73% (72.5 → JS round 73) | no |
| Damien Roux | Planner | Controls & planning | 90 90 95 90 85 85 80 80 | 87% | no |
| Hélène Sauvage | QA / QC | Quality | 40 50 60 80 90 100 110 100 | 79% | no (110 is not > 110) |
| Fabien Bertrand | Procurement | Controls & planning | 100 95 80 60 50 50 40 40 | 64% | no |

→ "Team utilization" 83 %, "Over-allocated" 3 people, "Open requests" 4 (RQ-041…044), "Labor cost to date" for HLT-026 = `f(1420)` = "€1.42M", sub "77% of labor budget" (from `HCATS` Labor row `[1850 budget, 1420 actual]`).

- Global `ROLES` bars: Engineering 1110 / 960 h (over), Site operations 690 / 640 (over), MEP 510 / 480 (over), Controls & planning 560 / 640, Quality 370 / 320 (over).
- Project resources per project (derived; for QA):

| Project | Team size | Team load | Over-allocated | Unmet demand | Labor cost to date (sub) | Open requests | Suggestions card |
|---|---|---|---|---|---|---|---|
| HLT-026 | 8 | 83% | 3 | 0 h | €1.42M (77%) | 4 | yes |
| NDC-031 | 4 | 80% | 1 | 0 h | €340k (49%) | 0 | no |
| RCF-019 | 3 | 93% | 2 | 3 h (Site operations 323/320) | €430k (90%) | 0 | no |
| ERP-202 | 2 | 80% | 0 | 0 h | €162k (43%) — row "Internal staff" | 0 | no |
| WSA-044 | 4 | 82% | 2 | 0 h | €160k (26%) | 0 | no |
| MSR-012 | 3 | 77% | 0 | 0 h | €160k (89%) | 0 | no |

(For non-HLT projects `CATS` actual = `round(budget × progress / cpi)`, `cpi = clamp(BAC×progress/actual, 0.7, 1.25)`, line 3311/3333.)

### 1.7 Cross-links
My work (person row), Resource requests (after "Send request"), Approvals ("Team capacity" primary button on Approvals → `go('resources')`, line 5137), department-head Home (reuses `resourceKpis[0..2]` and lists team rows from `people` filtered by `DEPT_OF===dept`, each → `resources`, line 4428), global search (a person hit → `resources`, line 4699), What-if levelling (same 8-week horizon and labels).

---

## 2. Rate cards (`rates`)

### 2.1 Key, nav, audience
`isRates = screen==='rates'`. Sidebar **Resources** › "Rate cards" (FR "Grilles de taux"), icon `ph ph-currency-eur`. Visible to director and pm. Values are masked for every other role (`canSeeRates`, line 4382).

### 2.2 Purpose
Holds the hourly **cost** rate per role and the premium multipliers (overtime, Saturday, Sunday/holiday, night, on-call). Lucca exports hours by type; Keystone values them with these rates to produce actual labour cost on the project budget ("Labor" category, source "Timesheets × role rate").

### 2.3 Layout (template 1420–1449)
```
column gap 14px
├─ KPI grid minmax(150px,1fr) — 5 tiles (rateKpis)
├─ [ratesMasked] lock banner
└─ flex-wrap row gap 14px
   ├─ "Cost rates by role" card   flex: 2.4 1 560px; overflow:auto; gap 8px
   └─ "Multipliers" card          flex: 1 1 260px; gap 10px
```

### 2.4 Components

**a) KPIs — `rateKpis` (line 4389)**

| Label (EN / FR) | Value | Sub (EN / FR) | Colour |
|---|---|---|---|
| "Standard week" / "Semaine standard" | "35 h" (static) | "Overtime beyond 8 h/day" / "Heures sup. au-delà de 8 h/jour" | OK |
| "Average internal rate" / "Taux interne moyen" | `eur(avgRate)+'/h'`, or "•••" if masked | "Cost rate · 9 roles" / "Taux de coût · 9 rôles" | OK |
| "Contractor premium" / "Surcoût prestataire" | `'+' + round((rates['Contractor — structural (external)'] / rates['Structural engineer'] − 1)×100) + '%'`, or "•••" | "vs internal structural engineer" / "vs ingénieur structure interne" | OK |
| "Weekend multiplier" / "Majoration week-end" | `'×' + mults.sun` (shown even when masked) | "Sunday / public holiday" / "Dimanche / jour férié" | OK |
| "Visibility" / "Visibilité" | "Full" / "Complète" or "Masked" / "Masquée" | "Directors and project managers" / "Directeurs et chefs de projet" | OK if full, LO if masked |

`avgRate` = Σ base rates of roles not matching `/external/` ÷ `(RATE_ROLES.length − 1)` (= 9). `eur(v)` (line 4383) = `v` rounded to 2 decimals, formatted with **`fr-FR` locale regardless of UI language**, 0–2 decimals, suffix " €" → e.g. "72,33 €/h", "106,25 €".
Default values: Average internal rate "72,33 €/h"; Contractor premium "+39%"; Weekend "×2".

**b) Masked banner (line 1423)** when `ratesMasked = !canSeeRates`: same banner style as 1.4a, icon `ph ph-lock-simple`, text "Rates are visible to directors and project managers only — switch role (bottom-left) to see and edit them." (FR "Les taux ne sont visibles que par les directeurs et les chefs de projet — changez de rôle (en bas à gauche) pour les voir et les modifier.")

**c) "Cost rates by role" table** (FR "Taux horaires par rôle"), subtitle "Base €/h is editable · multiplied rates update live · hours come from Lucca" (FR "Le taux de base €/h est modifiable · les taux majorés se recalculent · les heures viennent de Lucca"). `table.table`, 13px.

| Column (EN / FR) | Align | Content |
|---|---|---|
| "Role" / "Rôle" | left | role name; if `/external/` matches, a `tag tag-outline` (10.5px) "External" / "Externe" after it |
| "Base €/h" / "Base €/h" | right | if visible: `input.input[type=number]` value `rates[role]`, `width:84px; min-height:30px; padding:2px 8px; text-align:right; tabular`; onChange `setRate(role)`. If masked: "•••" in `--color-neutral-500` |
| "Overtime" / "Heures sup." | right | `eur(base × mults.ot)` |
| "Saturday" / "Samedi" | right | `eur(base × mults.sat)` |
| "Sun / holiday" / "Dim. / férié" | right | `eur(base × mults.sun)` |
| "Night" / "Nuit" | right | `eur(base × mults.night)` |
| "On-call" / "Astreinte" | right | `eur(base × mults.oncall)` (per hour on call) |

Multiplied cells: tabular, `--color-neutral-300`, "•••" when masked. Rows = `RATE_ROLES` order (10 rows). No sorting, no row actions. Table rows use the Nocturne `.table` faded row rules.

Default rendered values:

| Role | Base | Overtime ×1.25 | Saturday ×1.5 | Sun/holiday ×2 | Night ×1.3 | On-call ×0.35 |
|---|---|---|---|---|---|---|
| Project manager | 92 | 115 € | 138 € | 184 € | 119,6 € | 32,2 € |
| Structural engineer | 85 | 106,25 € | 127,5 € | 170 € | 110,5 € | 29,75 € |
| MEP lead | 82 | 102,5 € | 123 € | 164 € | 106,6 € | 28,7 € |
| Planner | 74 | 92,5 € | 111 € | 148 € | 96,2 € | 25,9 € |
| Cost controller | 70 | 87,5 € | 105 € | 140 € | 91 € | 24,5 € |
| Site lead | 68 | 85 € | 102 € | 136 € | 88,4 € | 23,8 € |
| Crane operations | 62 | 77,5 € | 93 € | 124 € | 80,6 € | 21,7 € |
| QA / QC | 60 | 75 € | 90 € | 120 € | 78 € | 21 € |
| Procurement | 58 | 72,5 € | 87 € | 116 € | 75,4 € | 20,3 € |
| Contractor — structural (external) | 118 | 147,5 € | 177 € | 236 € | 153,4 € | 41,3 € |

**d) "Multipliers" card** (FR "Majorations"), subtitle "Applied to the base rate · 35 h week" (FR "Appliquées au taux de base · semaine de 35 h"). One row per `MULTS` entry: grid `minmax(0,1fr) 84px`, gap 10px, `padding:6px 0`, `border-top:1px solid --color-neutral-900`; left: label 13px + hint 11px `--color-neutral-400` ("× base rate" / "× taux de base"; for on-call "× base, per hour on call" / "× base, par heure d’astreinte"); right: `input.input[type=number] step=0.05`, `min-height:30px`, right-aligned, value `mults[key]`, onChange `setMult(key)`.

| key | Label (EN / FR) | Default |
|---|---|---|
| ot | "Overtime > 8 h/day" / "Heures sup. > 8 h/jour" | 1.25 |
| sat | "Saturday" / "Samedi" | 1.5 |
| sun | "Sunday / public holiday" / "Dimanche / jour férié" | 2 |
| night | "Night shift" / "Travail de nuit" | 1.3 |
| oncall | "On-call" / "Astreinte" | 0.35 |

Footer note (11.5px): "Lucca sends hours by type (normal, overtime, Saturday, Sunday, night, on-call); Keystone values them with these rates to produce actual labor cost." (FR given in dictionary.)

**e) "Add role" dialog — `AF.rates` (line 3686)**: title "Add role", kind create, submit "Add role".

| id | Label (EN / FR) | Type | Required | Default / options |
|---|---|---|---|---|
| role | "Role" / "Rôle" | text | yes | '' |
| rate | "Hourly rate (€)" / "Taux horaire (€)" | number | yes | '' |
| cc | "Cost center" / "Centre de coût" | select | – | Engineering, Site, Automation, Project management |
| grade | "Grade" / "Niveau" | select | – | Junior, Confirmed, Senior, Expert |

Submit → toast "Role added to the rate card" (FR "Rôle ajouté à la grille de taux"). **No row is added** (no branch for `rates` in `afSubmit`).

### 2.5 Interactions & state
- `state.rates` — `{[role]: number}` initialised from `RATE_ROLES` (line 3774). `setRate(r)` (4384): `parseFloat(e.target.value)`; NaN → 0. All multiplied cells and the average/premium KPIs recompute live.
- `state.mults` — `{ot,sat,sun,night,oncall}` from `MULTS`. `setMult(k)` (4385) same parsing. The multiplier inputs are **not gated** by `canSeeRates` (editable by any role that reaches the page).
- No persistence, no undo, no save button (edits are immediate, session-only).

### 2.6 Data
`RATE_ROLES` (3454), `MULTS` (3455). Note a second, unrelated table `RATES` (3262) is used only by the Task screen cost note — see Data entities.

### 2.7 Cross-links
Settings shows the static sentence "Labor rates and multipliers are edited on the **Rate cards** page (directors and PMs)." (template 1581; the "Rate cards" span is not a link). Budget labour category source "Timesheets × role rate" (`SRC_OF.Labor`). Hours screen variance uses a flat 62 €/h, not these rates.

---

## 3. Skills matrix (`skills`)

### 3.1 Key, nav, audience
`isSkills = screen==='skills'`. Sidebar **Resources** › "Skills matrix" (FR "Matrice de compétences"), icon `ph ph-certificate`. Visible to director, pm, depthead, member, englead.

### 3.2 Purpose
Shows each person's level (1–5) across 10 skill families plus held certifications, and flags single points of failure (skills with fewer than two experts) — used when staffing work packages, sending people to site (FAT, Chantier, Mise en service & SAT) and when a request needs level ≥4.

### 3.3 Layout (template 1451–1475)
```
column gap 14px
├─ KPI grid minmax(150px,1fr) — 4 tiles (skillKpis)
├─ filter bar: [icon + "Skill"] [chips…]  ……  "Filter shows people at level ≥3" (margin-left:auto)
└─ flex-wrap row gap 14px
   ├─ matrix card     flex: 2.4 1 680px; overflow:auto; gap 8px
   └─ coverage card   flex: 1 1 260px; gap 6px
```

### 3.4 Components

**a) KPIs — `skillKpis` (line 4396)**

| Label (EN / FR) | Value | Sub | Colour |
|---|---|---|---|
| "Skill families" / "Familles de compétences" | `SKILLS.length` (10) | "Levels 1–5 · certifications noted" | OK |
| "Single-expert skills" / "Compétences à expert unique" | count of `coverage` with `gap` (8) | "Fewer than 2 people at level ≥4" | LO if any gap |
| "Certifications" | `Object.keys(CERTS).length` (5) | "Tracked with expiry in Lucca" / "Suivies avec échéance dans Lucca" | OK |
| "Open requests needing level ≥4" / "Demandes exigeant un niveau ≥4" | **hard-coded "2"** | "Structural · Quality" | OK |

**b) Skill filter chips** (line 1454): label `FL.skill` = "Skill" (FR "Compétence") with `ph ph-certificate` accent icon; chips from `chips()` helper (line 4110): options "Everyone" (`v:null`, FR "Tout le monde") + one per skill (`v:index`). Chip style: `padding:4px 10px; border-radius:var(--radius-md); 12px`; selected → bg `--color-accent-900`, border `--color-accent-700`, text `--color-accent-200`; unselected → transparent, border `--color-neutral-800`, text `--color-neutral-300`; hover bg `--color-neutral-900`. Click → `setState({skillFilter:v})`. Right-aligned hint "Filter shows people at level ≥3" (FR "Le filtre affiche les personnes de niveau ≥3").

**c) Matrix — "People × skills · level 1–5"** (FR "Personnes × compétences · niveau 1–5")
- Grid `minmax(150px,210px) repeat(10,minmax(48px,1fr))`, gap 4px.
- Header: empty cell, then 10 skill names (`skillCols[].name`, 10.5px, centred, `line-height:1.2`, `text-wrap:balance`). (`skillCols[].short` is computed but unused.)
- Rows (`skillRows`, line 4393): `PEOPLE` filtered by `skillFilter == null || SKILL_LV[name][skillFilter] >= 3`. Person cell `height:44px`: 28px avatar, name 13px, certification line 11px `--color-neutral-400` ellipsis (`CERTS[name]` or "—").
- Skill cell: `height:36px; border-radius:5px; background:--color-neutral-900`, centred row of **5 dots** (7×7px circles, gap 2px). Dot d (1..5) is filled with `lvColor(level)` if `d ≤ level`, else `--color-neutral-900` (same as the cell, so empty dots are invisible). Tooltip `title` = "{Skill} · level {n}".
- `lvColor(v)` (line 4392): ≥4 → `--color-accent-400`; 3 → `--color-accent-600`; 2 → `--color-accent-800`; 1 → `--color-neutral-800`; 0 → transparent (no dots).
- Empty state: if the filter matches nobody the grid shows only the header (no message). With current data every skill has ≥1 person at level ≥3.

**d) "Coverage"** (FR "Couverture"), subtitle "Experts = level 4–5 · flagged under 2" (FR "Experts = niveau 4–5 · signalé sous 2"). One row per skill (`coverage`, line 4394): flex space-between, 12.5px, `padding:6px 0`, `border-top:1px solid --color-neutral-900`; left skill name, right `"{experts} expert(s) · {able} at level ≥3"` (FR rule "N expert(s) · M au niveau ≥3"), colour `LO` when `experts < 2`, else `--color-neutral-300`.

Default coverage (from `SKILL_LV`):

| Skill (EN / FR) | Experts (≥4) | ≥3 | Gap? |
|---|---|---|---|
| Structural / Structure | 1 (Julien) | 1 | yes |
| Electrical / HV / Électricité / HT | 1 (Pauline) | 1 | yes |
| MEP / CVC-élec | 1 (Pauline) | 1 | yes |
| Automation & controls / Automatisme et contrôle-commande | 0 | 1 | yes |
| Crane & lifting / Grues et levage | 2 | 3 | no |
| Civil & site / Génie civil et chantier | 1 | 3 | yes |
| Planning & cost control / Planification et contrôle des coûts | 2 | 2 | no |
| Procurement / Achats | 1 | 2 | yes |
| Quality / QA-QC / Qualité / QA-QC | 1 | 2 | yes |
| Software / IT / Logiciel / IT | 0 | 2 | yes |

**e) "Add skill" dialog — `AF.skills` (line 3697)**: title "Add skill", create, submit "Add skill". Fields: `name` "Skill" (text, required, full width); `cat` "Category" select [Engineering, Site, Automation, Management, Safety]; `levels` "Levels" select ['1–4', '1–3', 'Yes / No']. Toast "Skill added" / "Compétence ajoutée". **No state change** (matrix columns come from the `SKILLS` constant).

### 3.5 Interactions & state
`state.skillFilter: number|null` (default null). Only chips write it. No editing of levels in the prototype.

### 3.6 Cross-links
Member Home "This week" row "Skills & certifications" (`CERTS[person]`, tag "View") → `skills` (line 4429). Engineering-lead Home "Watchlist" lists each gap skill as "Single expert — {text}" with tag "Skill gap" (FR "Compétence à risque") → `skills` (line 4430). Settings › "Skills & levels" list (`settings.skills`, seeded from `SKILLS`, subtitle "Skill families rated 1–5 in the matrix") — edits there do **not** feed the matrix.

---

## 4. Leave & working calendar (`leave`)

### 4.1 Key, nav, audience
`isLeave = screen==='leave'`. Sidebar **Resources** › "Leave & calendar" (FR "Congés et calendrier"), icon `ph ph-calendar-check`. Breadcrumb "Resources · Lucca". Visible to every internal role (director, pm, depthead, member, englead, quality, procurement); not client.

### 4.2 Purpose
Read-only mirror of Lucca (French HRIS): paid leave (CP), RTT, sick leave, training and French public holidays, converted into available hours per person per week (35 h basis). That availability is the capacity that the allocation heatmap is meant to be measured against.

### 4.3 Layout (template 1477–1502)
```
column gap 14px
├─ KPI grid minmax(150px,1fr) — 5 tiles (leaveKpis)
└─ card (padding 14px 16px; gap 10px; overflow:auto)
   ├─ header: title + subtitle (left) · lock note (right)
   ├─ grid 200px repeat(8,minmax(60px,1fr)) 60px 60px; gap 4px; min-width:820px
   └─ legend line
```

### 4.4 Components

**a) KPIs — `leaveKpis` (line 4403)**

| Label (EN / FR) | Value | Sub (EN / FR) | Colour |
|---|---|---|---|
| "Lucca sync" / "Synchro Lucca" | "06:30" (static) | "Today · leave, RTT, sick, training" / "Aujourd’hui · congés, RTT, maladie, formation" | OK |
| "Team availability" / "Disponibilité de l’équipe" | `round(mean of rows' avail %)` + "%" | "Next 8 weeks · 35 h basis" / "8 prochaines semaines · base 35 h" | OK |
| "Leave days" / "Jours de congés" | Σ rows' leave days | "Approved in Lucca" / "Approuvés dans Lucca" | OK |
| "Public holidays" / "Jours fériés" | `Object.keys(HOLIDAYS).length` (1) | "11 Nov · France" / "11 nov. · France" | OK |
| "Weeks under 60% team capacity" / "Semaines sous 60 % de capacité" | number of weeks where Σ available hours ÷ (35 × people) < 0.6 | "Capacity feeds the allocation heatmap" / "La capacité alimente la carte d’affectation" | OK |

**b) Card header**: title "Availability — next 8 weeks" (FR "Disponibilité — 8 prochaines semaines"); subtitle "Read from Lucca · 35 h week · 7 h per leave day · public holidays removed" (FR "Lu depuis Lucca · semaine de 35 h · 7 h par jour d’absence · jours fériés retirés"). Right: `ph ph-lock-simple` + "Leave is requested and approved in Lucca" (FR "Les congés se demandent et s’approuvent dans Lucca"), 12px `--color-neutral-400`.

**c) Grid**
- Header row: "Person", 8 week labels (`weekLabels`, same values as `weeks`), "Leave" (FR "Congés"), "Avail." (FR "Dispo."). Right columns right-aligned.
- "Public holidays" row (`holRow`, line 4404): label cell "Public holidays" (12px); 8 cells `height:26px; border-radius:5px; 11px; --color-neutral-300`; holiday weeks show the date part of `HOLIDAYS[i]` ("11 Nov") on `--color-neutral-800`, other weeks transparent/empty; two empty trailing cells.
- Person rows (`leaveRows`, line 4400–4401): person cell `height:42px` (avatar + name + role 11.5px). 8 week cells `height:36px; border-radius:5px`, column-centred: line 1 `c.label` 11.5px in `c.fg`; line 2 `c.hours` 10.5px tabular `--color-neutral-400` (e.g. "35 h"). Then "Leave" = `"{days} d"` (13px tabular `--color-neutral-300`) and "Avail." = `"{pct}%"` coloured `availColor`.

Cell rules per week i (`t = LEAVE[name][i]`, `hol = HOLIDAYS[i] ? 1 : 0`):

| Situation | label | background | text colour |
|---|---|---|---|
| t = "Sick" | "Sick" | `--color-accent-800` | `--color-accent-200` |
| t = CP / RTT / Training | t ("Training" → FR "Formation"; CP/RTT unchanged) | `--color-accent-900` | `--color-accent-200` |
| no leave, holiday week | "Hol." | `--color-neutral-800` | `--color-neutral-400` |
| nothing | '' | `--color-neutral-900` | `--color-neutral-400` |

Leave and holiday in the same week → leave label wins, but both are deducted.

Formulas: `daysOff_i = LEAVE_DAYS[t] + hol`; `availH_i = max(0, 5 − daysOff_i) × 7`; row `days` = Σ `LEAVE_DAYS[t]` (holidays excluded); `avail% = round(Σ availH_i / (8 × 35) × 100)`; `availColor = LO` if ratio < 0.70 else `--color-neutral-300`. Team availability = mean of the rounded row percentages.

- Legend line (11.5px `--color-neutral-400`, text only, no swatches): "CP · paid leave" (FR "CP · congés payés"), "RTT · reduced working time" (FR "RTT · réduction du temps de travail"), "Sick · sick leave" (FR "Sick · arrêt maladie"), "Training" (FR "Formation"), "Hol. · public holiday" (FR "Hol. · jour férié").

Default rendered values:

| Person | Week hours (Sep 28 … Nov 16) | Leave | Avail. |
|---|---|---|---|
| Amélie Ollivier | 35 35 0(CP) 0(CP) 35 35 28(Hol.) 35 | 10 d | 73% |
| Julien Wagner | 35 35 35 35 35 35 21(RTT) 35 | 1 d | 95% |
| Pauline Noguès | 14(Training) 35 35 35 35 0(CP) 28(Hol.) 35 | 8 d | 78% |
| Thomas Kerbrat | 35 35 35 35 0(CP) 0(CP) 28(Hol.) 35 | 10 d | 73% |
| Léa Marchand | 35 28(RTT) 35 35 35 35 28(Hol.) 28(RTT) | 2 d | 93% |
| Damien Roux | 35 35 35 35 35 35 28(Hol.) 35 | 0 d | 98% |
| Hélène Sauvage | 35 35 35 21(Sick) 35 35 28(Hol.) 35 | 2 d | 93% |
| Fabien Bertrand | 35 35 35 35 35 35 0(CP) 0(CP) | 10 d | 75% |

→ KPIs: Team availability 85 %, Leave days 43, Public holidays 1, Weeks under 60 % = 0. No row is below 70 %, so no LO colouring with the mock data.

**d) "Sync Lucca" dialog — `AF.leave` (line 3698)**: title "Sync Lucca", kind run (▶ icon), submit "Synchronise" / "Synchroniser". Fields: `period` "Period" / "Période" select [Next 3 months, Next 6 months, Full year]; `teams` "Teams" / "Équipes" select [All teams, Engineering, Site]. No required fields. Toast "Lucca synchronised · 14 absences updated" / "Lucca synchronisé · 14 absences mises à jour". No state change (the "Lucca sync 06:30" KPI does not update).

### 4.5 Interactions & state
None besides the dialog; the screen is read-only by design ("Leave is requested and approved in Lucca").

### 4.6 Cross-links
Settings › "Public holidays 2026 — France" list (`settings.holidays`, 11 entries, subtitle "Removed from capacity · Lucca stays the source for leave") — **not** wired to this grid, which reads the `HOLIDAYS` constant. Site screen "Collision detection" mentions "Lucca leave" among collision types (`SITE_COLLISIONS`). Activity & integrations lists the Lucca connector.

---

## 5. Hours — Lucca reconciliation (`hours`)

### 5.1 Key, nav, audience
`isHours = screen==='hours'` (line 5207). Sidebar **Project** › *Steering* › "Hours (Lucca)" (FR "Heures (Lucca)"), icon `ph ph-clock-countdown`. Project-scoped (header project picker). Visible to director, pm and depthead. Not a `startScreen` option.

### 5.2 Purpose
Monthly import of hours that people declared in Lucca on the project's analytic code (e.g. `HAV004` for HLT-026), matched to resource × work package from the schedule, to compare declared vs planned hours and to route hours booked without a planned task. Feeds actual labour cost.

### 5.3 Layout (template 932–947)
```
column gap 14px
├─ [hasHours]
│  ├─ "Group by" bar: icon + label + segmented control (hrSeg)
│  ├─ KPI grid minmax(150px,1fr) — 4 tiles (hrKpis)
│  ├─ [hrIsGrouped] "Lucca declared vs planned" card (overflow:auto, gap 8px)
│  └─ [hrIsUnassigned] "Hours without a planned task" card
└─ [noHours] empty state
```

### 5.4 Components

**a) Group-by segmented control** (line 935): label `FL.group` "Group by" (FR "Regrouper par") with `ph ph-rows` accent icon; `div.seg` of buttons built by `seg()` (line 3889): 12px, `padding:4px 10px`, selected → text `--color-accent` + `box-shadow: inset 0 0 0 1px var(--color-accent)`; others `--color-neutral-300`; separators `border-left:1px solid var(--color-divider)` from the second option.

| value | Label (EN / FR) | Icon |
|---|---|---|
| `resource` (default) | "By resource" / "Par ressource" | `ph ph-user` |
| `wp` | "By work package" / "Par lot" | `ph ph-tree-structure` |
| `unassigned` | "To assign" / "À affecter" | `ph ph-question` |

Writes `state.hoursView`.

**b) KPIs — `hrKpis` (line 5016)**

| Label (EN / FR) | Value | Sub | Colour |
|---|---|---|---|
| "Declared in Lucca · September" / "Déclaré dans Lucca · septembre" | `(Σ declared + Σ unassigned) + ' h'` → "779 h" | "analytic code {code} · imported {date}" — date = `HOURS[p].imported` ("29 Sep 2026") or "30 Sep 2026" once `hoursImported` (FR rule "code analytique … · importé le …") | OK |
| "Planned (schedule)" / "Planifié (planning)" | Σ planned + " h" → "740 h" | "{n} resource × work package lines" → "10 …" | `--color-neutral-200` |
| "Variance" / "Écart" | `(+)` Σdeclared − Σplanned + " h" → "+12 h" | `round(var/planned×100) + ' % · ≈ ' + f(round(var × 62 / 1000)) + ' labour cost'` → "2 % · ≈ €1k labour cost" (FR "2 % · ≈ 1 k€ de main-d’œuvre") | LO if variance > 5 % of planned |
| "To assign" / "À affecter" | Σ unassigned + " h" → "27 h" | "{n} lines without a planned task" → "2 …" | LO if > 0 |

`hrRate = 62` €/h (line 5015) is a flat valuation rate, independent of Rate cards.

**c) "Lucca declared vs planned"** card (FR "Déclaré Lucca vs planifié"), subtitle "Hours are imported from Lucca on the project analytic code and matched to resource × work package from the schedule". Shown when `hoursView !== 'unassigned'`; `hrGroups = hoursView==='wp' ? hrByWp : hrByRes` (line 5018).

Group header row: grid `32px minmax(0,1fr) 80px 80px 90px 140px`, gap 10px, 13px, `padding:8px 0`, `border-top:1px solid --color-neutral-900`:

| Col | Content |
|---|---|
| 1 | 28px circle avatar, 10.5px: person initials (by resource) or WP number e.g. "1.3" (by WP, `wp.split(' ')[0]`) |
| 2 | label (weight 500) + sub (11px `--color-neutral-400`, nowrap ellipsis). By resource: label = person, sub = their WP labels joined " · ". By WP: label = WP ("1.3 · Foundations"), sub = people as "J. Wagner · H. Sauvage". |
| 3 | `"{planned} h"`, 12px tabular right, `--color-neutral-400` |
| 4 | `"{declared} h"`, 12px tabular right |
| 5 | `varText` = `(d−p>0?'+':'') + (d−p) + ' h'` (negative uses ASCII "-"), 12px right, `varColor` |
| 6 | progress bar: track `height:6px; border-radius:3px; --color-neutral-800; overflow:hidden`; fill `width:barW; background:barBg` |

Then one detail line per underlying record (`g.lines`): same grid, 12px `--color-neutral-400`; col 1 empty; col 2 `"{wp} · {res}"` with `padding-left:6px`; cols 3–5 as above at line level; col 6 empty.

Formulas (lines 5010–5012), for a line or a group with planned p and declared d:
- `varColor`: `d − p > 0.1 × p` → `LO` (accent-300); `d − p < 0` → `--color-accent-300`; otherwise `--color-neutral-300`. (Both "over by > 10 %" and "under" render in the same accent-300.)
- `barW = min(100, round(d / max(p,1) × 100)) + '%'`.
- `barBg = d > 1.1 × p ? --color-accent-700 : --color-accent`.
- Group order = first appearance in `HOURS[p].lines` (no sorting).

Default groups (HLT-026):

| By resource | Planned | Declared | Var. | Bar |
|---|---|---|---|---|
| Julien Wagner (1.3, 1.4) | 280 | 303 | +23 h | 100 %, accent |
| Amélie Ollivier (1.2, 1.7) | 100 | 90 | -10 h | 90 % |
| Thomas Kerbrat | 96 | 88 | -8 h | 92 % |
| Pauline Noguès | 110 | 97 | -13 h | 88 % |
| Hélène Sauvage (1.3, 1.4) | 100 | 115 | +15 h (LO) | 100 %, accent-700 |
| Damien Roux | 30 | 28 | -2 h | 93 % |
| Léa Marchand | 24 | 31 | +7 h (LO) | 100 %, accent-700 |

| By work package | Planned | Declared | Var. |
|---|---|---|---|
| 1.3 · Foundations | 160 | 184 | +24 h (LO) |
| 1.4 · Steel structure | 220 | 234 | +14 h |
| 1.2 · Site preparation | 80 | 76 | -4 h |
| 1.7 · Paving & yard | 20 | 14 | -6 h |
| 1.5 · Crane installation | 96 | 88 | -8 h |
| 1.6 · MEP systems | 110 | 97 | -13 h |
| 1.1 · Design & permits | 54 | 59 | +5 h |

**d) "Hours without a planned task"** (FR "Heures sans tâche planifiée"), shown when `hoursView==='unassigned'`. Rows (`hrUnassigned`, line 5013): grid `32px minmax(0,1fr) 70px minmax(200px,260px) auto`, gap 10px, `padding:8px 0`, top border, 12.5px:
1. avatar initials;
2. person (weight 500) + reason `why` (11px), e.g. "Declared on HAV004 · no planned task this month" (FR "Déclaré sur HAV004 · aucune tâche planifiée ce mois");
3. `"{h} h"` right;
4. `select.input` (`min-height:32px; 12px`) listing `PD.ACTS` level-1 WBS rows as "1.1 · Design & permits" … "1.8 · Commissioning & handover";
5. "Assign" / "Affecter" `btn btn-secondary` 12px.
Neither the select nor the button has a handler.

Default rows: Fabien Bertrand 18 h, Pauline Noguès 9 h.

**e) Empty state** (`noHours = !HOURS[project]`, line 945): 12.5px `--color-neutral-400`, `padding:14px`, centred, `border-radius:var(--radius-md)`, background `--color-neutral-900`: "No Lucca import for this project yet" (FR "Pas encore d’import Lucca pour ce projet"). Only HLT-026 has data; all other projects show this state (and no KPIs or segmented control).

**f) "Import Lucca hours" dialog — `AF.hours` (line 3677)**: title "Import Lucca hours" (FR "Importer les heures Lucca"), kind run (▶), submit "Import".

| id | Label (EN / FR) | Type | Default / options |
|---|---|---|---|
| period | "Period" / "Période" | select | September 2026, August 2026, Q3 2026 |
| code | "Analytic code" / "Code analytique" | text (not required) | "HAV004" (hard-coded, not taken from the project) |
| mode | "Matching" / "Rapprochement" | select | "Resource × work package (planning)", "Resource only" |

Submit → `setState({hoursImported:true})` (line 5128) and toast "Lucca hours imported · 12 lines matched · 2 to assign" (FR "Heures Lucca importées · 12 lignes rapprochées · 2 à affecter"). The only visible effect is the KPI sub date switching to "30 Sep 2026".

### 5.5 Interactions & state
| State key | Default | Written by |
|---|---|---|
| `hoursView` | `'resource'` | segmented control |
| `hoursImported` | `false` | Import dialog submit |
| `project` | `'HLT-026'` | header project picker |

### 5.6 Cross-links
Plan — WBS (work-package labels come from `HACTS` level-1 rows); Budget & cost (Labor category "Timesheets × role rate"); Rate cards (conceptually the valuation source, but not wired); member Home "Hours logged — Read from Lucca · N h this week" (line 4429, computed from task logs, not from `HOURS`); Activity & integrations (Lucca connector).

---

## 6. Time entries (`ENTRIES`) — timesheet data used by the Task screen

Not a screen of this area, but the per-task timesheet data and its valuation live here.
- `ENTRIES` (line 3260): `{[taskId]: [dateLabel, hours, note][]}`, e.g. `'T-2314': [['Wed 23 Sep', 2.5, 'Set-up & columns C1–C6'], ['Thu 24 Sep', 3.5, 'Columns C7–C12 readings']]`; `'T-2305'` has two entries. Copied into `state.entries` (line 3771).
- Task screen "Time" block (template 2952–2958): logged / estimate bar, entry list (grid `96px minmax(0,1fr) auto`: date, note ellipsis, "{h} h"), inputs `logH` ("h" placeholder, 72px) and `logNote` ("What did you work on?"), "Log" button → `logTime` (line 4106): ignores if `parseFloat(logH)` is falsy; appends `[dayLabel(TODAY) = 'Fri 25 Sep', h, logNote || 'Work on ' + task.title]`, adds `h` to the todo's `logged`, clears the inputs.
- Cost note (line 4103): `"{logged} h × ${rate}/h = ${logged×rate} actual cost → Labor · WP {w} {pkg}"` where `rate = RATES[person's role] || 100` — uses the **`RATES`** table and a "$" sign regardless of the currency prop.

---

## Data entities

| Entity | Constant / state | Fields (type) | Example |
|---|---|---|---|
| Person (resource) | `PEOPLE` (3123) | `name` string · `role` string (job title) · `load` number[8] (% of available hours, weeks w/c 28 Sep → 16 Nov 2026) | `['Julien Wagner','Structural engineer',[90,100,130,125,110,100,80,60]]` |
| Department capacity | `ROLES` (3132) | `name` string (department) · `capacityH` number (8 wks) · `demandH` number (8 wks) | `['Engineering',960,1110]` |
| Department | `DEPTS` (3268) | key dept name → `[headName, headTitle]` | `'MEP': ['Sophie Renard','Head of MEP']` (also Engineering/Marion Kerviel, Site operations/Olivier Blanc, Quality/Gabriel Comte, Controls & planning/Ines Duarte) |
| Person → department | `DEPT_OF` (3269) | key person → dept name | `'Fabien Bertrand': 'Controls & planning'` |
| Project team | `DEFS[code].team` (3285–3300) | string[] of person names | NDC-031: Pauline Noguès, Damien Roux, Léa Marchand, Fabien Bertrand |
| Rate role | `RATE_ROLES` (3454) → `state.rates` | `role` string · `baseRate` number (€/h cost) · external flag derived from `/external/` | `['Contractor — structural (external)',118]` |
| Multiplier | `MULTS` (3455) → `state.mults` | `key` 'ot'\|'sat'\|'sun'\|'night'\|'oncall' · `label` string · `factor` number | `['oncall','On-call',0.35]` |
| Legacy task rate | `RATES` (3262) | key job title → €/h (different values: QA/QC 95, Structural engineer 120, Site lead 105, Crane operations 98, Cost controller 90, Planner 92, MEP lead 115, Procurement 88) | used only by Task cost note |
| Skill family | `SKILLS` (3456) | string[10] (index = column) | 'Crane & lifting' |
| Skill levels | `SKILL_LV` (3457) | key person → number[10], 0 = none, 1–5 | `'Thomas Kerbrat': [2,2,0,2,5,3,1,0,2,0]` |
| Certification | `CERTS` (3458) | key person → free text | `'Thomas Kerbrat': 'Crane operator G1 · rigging CACES'` (5 people have one) |
| Leave | `LEAVE` (3459) | key person → `{[weekIndex 0–7]: 'CP'\|'RTT'\|'Sick'\|'Training'}` | `'Pauline Noguès': {0:'Training',5:'CP'}` |
| Leave length | `LEAVE_DAYS` (3460) | type → working days lost in that week | `{CP:5, RTT:1, Sick:2, Training:3}` |
| Public holiday | `HOLIDAYS` (3461) | weekIndex → "date · name" | `{6: '11 Nov · Armistice'}` |
| Hours import | `HOURS` (3735) | key project code → `{imported: string, code: string (analytic code), lines: [res, wpLabel, plannedH, declaredH][], unassigned: [res, hours, why][]}` | HLT-026: imported '29 Sep 2026', code 'HAV004', 10 lines, 2 unassigned |
| Time entry | `ENTRIES` (3260) → `state.entries` | key task id → `[dateLabel, hours, note][]` | see §6 |
| Resource request (referenced) | `REQUESTS` (3270) → `state.requests` | `id, pm, project (3-letter), person, dept, title, act, hours, start/due (day index), prio 'low'\|'med'\|'high', status, sent, note, response, propStart, propDue, todoId` | RQ-043 "Steel connection checks — second crew", 40 h, pending |
| Lucca connector | `CONNECTORS` row (3570) | `[system, scope, frequency, status, lastSync, volume]` | `['Lucca','Hours, leave, RTT, sick leave','Daily 06:30','OK','26 Sep 06:30','312 h · 8 people']` |
| Persona / role | `PERSONAS` (3747), `ROLE_SCREENS` (3465) | role key → `[name, title]`; role key → allowed screen ids (null = all) | see §0.2 |
| Settings lists (not wired) | `SETTINGS0.skills`, `SETTINGS0.holidays` (3467) | string[] | 11 French 2026 holidays, "1 Jan · Jour de l’an" … "25 Dec · Noël" |

UI state keys used by this area: `screen`, `project`, `role`, `lang`, `person` (set by heatmap click), `rates`, `mults`, `skillFilter`, `hoursView`, `hoursImported`, `af` (dialog), `toast`, `nr` (resource request dialog), `requests`.

Derived helpers: `shade(v)` (3867), `pct(v)` (3133), `f()/money()` (3775/3785), `eur(v)` (4383), `lvColor(v)` (4392), `chips()` (4110), `seg()` (3889), `initials(n)` (3891), `loadAt(person, day)` (4118: `PEOPLE[...].load[clamp(floor(day/5)−1, 0, 7)]`), `dayDate(o)` (3266: day index 0 = Mon 21 Sep 2026, 5 working days per week).

## Status machines / workflows

1. **Leave (Lucca-owned)** — no workflow in Keystone. Types: CP (congés payés), RTT, Sick (arrêt maladie), Training (formation), plus public holiday. Requests and approvals happen in Lucca; Keystone shows approved absences only ("Approved in Lucca") and refreshes on the daily 06:30 sync or the manual "Sync Lucca" run.
2. **Hours import & reconciliation** — `not imported` (`noHours`, empty state) → `imported` (`HOURS[project]` present; `hoursImported` flips the import date to 30 Sep 2026). Each Lucca line is either **matched** (resource × work package, compared planned vs declared; flagged when declared > planned + 10 % or below planned) or **to assign** (declared on the analytic code with no planned task) → intended **assigned** via the WP select + "Assign" (not implemented).
3. **Rate visibility** — `Full` (director, pm: base editable, multiplied rates shown) vs `Masked` (all other roles: "•••", lock banner). Multipliers editable in both states in the prototype.
4. **Resource request** (started from Resources / Project resources "Request resource"; screens owned by the Requests/Approvals spec): `pending` → `approved` (department head approves; a todo is created in the person's list) | `reschedule` (head proposes +1/+2/+3 weeks) → `approved` when the PM accepts, or `withdrawn` | `rejected` (with note). `rejected`/`withdrawn` → `pending` via "Re-request" (`resend`). `REQ_STATUS` labels: "Pending review", "Approved · assigned", "Reschedule proposed", "Rejected", "Withdrawn".
5. **Load bands** (not a workflow, but the shared classification): < 60 % under-used · 60–89 % · 90–100 % nominal · 101–115 % stretched · > 115 % over-allocated; "over-allocated person" = any week > 110 %.

## Cross-links

- Resources person row → **My work** (`screen:'mywork'`, `person`).
- Resources / Project resources "Request resource" → **New resource request** dialog → **Resource requests** screen.
- **Approvals** primary "Team capacity" → Resources; department-head **Home** KPIs and "Team load — next 8 weeks" rows → Resources.
- **Global search** person hits → Resources.
- **What-if levelling** reuses the 8 week labels and a load profile (peak 130 %, 3 people above 100 %).
- Member **Home** "Skills & certifications" → Skills matrix; engineering-lead **Home** watchlist "Skill gap" rows → Skills matrix.
- **Settings**: "Skills & levels", "Public holidays 2026 — France" lists, and the sentence pointing to Rate cards.
- **Activity & integrations** (plumbing): Lucca connector status row.
- **Site (chantier)**: collision detection mentions Lucca leave and certificate expiry; site rotation/team.
- **Plan — WBS**: level-1 work packages feed the Hours "To assign" select and WP grouping.
- **Budget & cost**: Labor category "Timesheets × role rate"; Resources KPI "Labor cost to date" reads the current project's labour category.
- **Task** screen: time log (`ENTRIES`, `logTime`) and labour cost note (`RATES`).

## Open questions

1. **Unmet demand on Resources** is hard-coded to "240 h", while the `ROLES` data gives Σ max(0, demand − capacity) = 150 + 50 + 30 + 50 = 280 h. Which is correct, and should the global screen compute it like Project resources does?
2. **"Labor cost to date" on the portfolio Resources screen** reads the *currently selected project's* labour category (default Harbor Line), not a portfolio total. Intended?
3. **Capacity basis is inconsistent**: Project resources uses 320 h per person (8 × 40 h), the Leave screen and Rate cards use a 35 h week, and the global `ROLES` capacities are static. Should capacity = Leave availability (35 h minus absences), as the KPI sub "Capacity feeds the allocation heatmap" claims? Today leave does not affect the heatmap.
4. "Peak weeks 41–43" (Over-allocated sub) and "Open requests needing level ≥4 = 2" are static text; should they be computed?
5. **"Apply" on Suggested rebalancing** has no handler. Expected behaviour (create a resource request like RQ-043, open What-if, update loads)? Suggestions are static strings with no FR translation.
6. **Rate cards**: edits to base rates and multipliers are session-only with no save, audit or effective date. Is versioning by date needed (rates change yearly)? Should multipliers also be locked for non-director/PM roles (today they are editable when rates are masked)?
7. **Three different rate sources**: `RATE_ROLES`/`state.rates` (Rate cards), `RATES` (Task cost note, different values and a "$" sign), and a flat `hrRate = 62` €/h (Hours variance). Which one should value Lucca hours?
8. **"Add role" / "Add skill" / "Sync Lucca"** only show a toast; nothing is added or refreshed. Define persistence and the meaning of "Cost center" and "Grade" (one rate per role × grade?). The "Add skill" Levels options ("1–4", "1–3", "Yes / No") conflict with the 1–5 matrix.
9. **Hours "Assign"** button and WP select have no handler; define the outcome (create a planned line? move hours into the WP actuals?). The import toast says "12 lines matched" while the data has 10 lines; the dialog's analytic code defaults to "HAV004" whatever the project; on projects without data the import changes nothing.
10. Hours variance colouring uses accent-300 for both "over by > 10 %" and "under plan"; is a distinct colour wanted for under-declaration? Exactly +10 % is not flagged (strict >).
11. Skills: "Single-expert skills" also counts skills with **zero** experts (Automation & controls, Software / IT). Rename or split? Settings › Skills list is not linked to the matrix columns.
12. Leave: `HOLIDAYS` constant vs `settings.holidays` list (11 dates) — which drives capacity? Only Armistice (11 Nov) falls in the window. Leave types "CP", "RTT", "Sick" and "Hol." are not translated in FR (FR legend literally reads "Sick · arrêt maladie").
13. FR week labels: `'Sep 28'` becomes "sept. 28" via month substitution (French order would be "28 sept."). Same for the allocation heatmap and the What-if bars.
14. The action-form dialog subtitle shows the current project name on portfolio-level screens (Rates, Skills, Leave), which is misleading.
15. Week columns are fixed to w/c 28 Sep → 16 Nov 2026 in two places (`weeks`, `weekLabels`); `PEOPLE.load` and `LEAVE` are indexed by position. A real build needs a date-based weekly series.

---

## Addendum (completeness pass)

| Flag | Template line | Logic (render-values line) | Meaning |
|---|---|---|---|
| `ratesVisible` | 1433 | `canSeeRates` (5225) = `['director','pm'].includes(role)` (4382) | In the "Cost rates by role" table, the Base €/h cell shows the editable `input[type=number]` only when `ratesVisible`. The sibling `<sc-if r.hidden>` on the same cell shows "•••" (neutral-500) when the rates are masked. The complementary flag `ratesMasked = !canSeeRates` drives the lock banner (template 1423). |

Coverage check (completeness pass): every constant this area uses (`PEOPLE`, `ROLES`, `DEPTS`, `DEPT_OF`, `RATES`, `RATE_ROLES`, `MULTS`, `SKILLS`, `SKILL_LV`, `CERTS`, `LEAVE`, `LEAVE_DAYS`, `HOLIDAYS`, `HOURS`, `ENTRIES`) is documented. The What-if levelling constants `LEVERS`, `AUTO` and `A1250_RES` are documented in `05-planning-schedule.md` §4. The KPI seeds in §2 and §3 were re-computed from source and match: average internal rate 72,33 €/h, contractor premium +39 %, 8 single-expert skills, coverage table.
