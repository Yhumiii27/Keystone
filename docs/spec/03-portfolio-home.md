# 03 — Home, My projects, Projects map, Portfolio overview, Projects list, Prioritisation, Cash flow, Client portal

Source of truth: `design/Keystone PM v8.dc.html` (prototype). Template line numbers below refer to that file and to `design/_extracted/template-annotated.html` (same numbering, `{{ T.kN }}` replaced by `«English»`). Logic line numbers refer to the `<script type="text/x-dc">` block (3095–5239). Example values are the **seed values** the prototype computes in its default state (`lang:'en'`, `role:'director'`, `project:'HLT-026'`, no zone filter); they were obtained by evaluating the prototype logic and are given so developers can check their port.

| # | Screen (title, EN / FR) | Route key (`screen`) | Flag | Template lines | Main logic lines |
|---|---|---|---|---|---|
| 1 | Home / Accueil | `home` (default `startScreen`) | `isHome` | 163–195 | 4423–4435 |
| 2 | My projects / Mes projets | `myprojects` | `isMyProjects` | 196–214 | 5063–5070 |
| 3 | Projects map / Mappemonde des projets | `worldmap` | `isWorldMap` | 215–236 (+ `Keystone PM map.html`) | 5072–5081 |
| 4 | Portfolio overview / Vue d’ensemble du portefeuille | `overview` | `isOverview` | 237–285 | 3790–3813 |
| 5 | Projects / Projets (list + lifecycle) | `projects` | `isProjects` | 638–752 (+ dialogs 2972–3069) | 3898–3969, 5183 |
| 6 | Portfolio — prioritisation & capacity / Portefeuille — priorisation & capacité | `portfolio` | `isPortfolio` | 2079–2142 | 4494–4512, 4521 |
| 7 | Cash flow & billing — next 6 months / Trésorerie & facturation — 6 prochains mois | `cash` | `isCash` | 2143–2179 | 4513–4520 |
| 8 | My project — client view / Mon projet — vue client | `client` | `isClient` | 2180–2236 | 4678–4690, 5061 |

---

## 0. Conventions and shared elements used by these screens

### 0.1 Routing, roles, startup

- Routing is a single state key `this.state.screen` (initial `null` → falls back to prop `startScreen` → `'home'`, line 3778). `go(id)` = `setState({screen:id})`. All 8 screens listed above are valid `startScreen` enum values except `client`, `portfolio`, `cash` (the prop enum at line 3095 lists `home, myprojects, worldmap, overview, projects, …`; `client/portfolio/cash` are reachable only via navigation). A rebuild should use real routes, e.g. `/home`, `/my-projects`, `/portfolio/map`, `/portfolio/overview`, `/portfolio/projects`, `/portfolio/prioritisation`, `/portfolio/cash`, `/client`.
- Initial state of interest (line 3767–3774): `lang:'fr'` (**the app opens in French**), `role:'director'`, `project:'HLT-026'`, `projects:initialProjects()`, `statusFilter:null`, `statusMenu:null`, `q:''`, `stageDone` (deep copy of `STAGE_DONE_DEFAULT`), `stageHist` (deep copy of `STAGE_HISTORY`), `force:null`, `forceReason:''`, `stageOpen:null`, `np:{…}` (wizard), `cpTab:'progress'`, `ciNew:''`, `clientIssues:null`, `pfTab:'score'`, `pfSel:null`, `pfWhatif:null`, `pfWeights:null`, `pfZone` (undefined → null), `projView` (undefined → `'health'`).
- Personas (`PERSONAS`, line 3747), switchable in the sidebar footer "View as" menu (`roleOptions`, line 5102; picking one sets `{role, roleMenu:false, screen:'home'}`):

| role key | Name | Title (EN / FR) |
|---|---|---|
| director | Marie Lefebvre | Portfolio director / Directrice de portefeuille |
| pm | Romain Aubert | Project manager / Chef de projet |
| depthead | Marion Kerviel | Head of engineering |
| member | Julien Wagner | Structural engineer |
| englead | Antoine Girard | Engineering lead |
| quality | Gabriel Comte | Quality manager |
| procurement | Fabien Bertrand | Procurement & stock |
| client | Nadia Bensaïd | Client — Port authority |

- Screen access (`ROLE_SCREENS`, line 3465, extended at line 3466: every non-client role also gets `myprojects`; `director` = `null` = everything). Final matrix for this area:

| Screen | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| home | Y | Y | Y | Y | Y | Y | Y | Y |
| myprojects | Y | Y | Y | Y | Y | Y | Y | – |
| worldmap | Y | Y | Y | – | – | – | – | – |
| overview | Y | Y | Y | – | – | – | – | – |
| projects | Y | Y | – | – | – | – | – | – |
| portfolio | Y | Y | – | – | – | – | – | – |
| cash | Y | Y | – | – | – | – | – | – |
| client | Y | – | – | – | – | – | – | Y |

  Not-allowed screens are hidden from the sidebar (`gate`, line 5140). If a user still lands on one (global search, deep link) `outside=true` (line 5161): a banner is shown (§0.5), the page primary button is hidden, and the sidebar shows an extra section "Outside my workspace" containing the current page.
- Sidebar placement (`navs`, line 5145–5155): fixed entries `navHome` = **Home** (`ph ph-house`) + **My projects** (`ph ph-folder-user`) — for role `client` the second entry is **My project** (`ph ph-buildings`, id `client`). Section **Portfolio** (`navPortfolio`): **Overview** (`ph ph-squares-four`, `overview`), **Projects** (`ph ph-folders`, `projects`), **Schedule** (`pfplan`, other spec), **Projects map** (`ph ph-globe-hemisphere-west`, `worldmap`), **Prioritisation** (`ph ph-strategy`, `portfolio`), **Cash flow** (`ph ph-coins`, `cash`). When a zone is selected the Portfolio section sub-label shows the zone name.

### 0.2 Page header (shell, template 76–125)

- `title` = `titles[screen]` (line 5109): home "Home", myprojects "My projects", worldmap "Projects map", overview "Portfolio overview", projects "Projects", portfolio "Portfolio — prioritisation & capacity", cash "Cash flow & billing — next 6 months", client "My project — client view". `h2`, 26px.
- `crumb` = `crumbOf()` (line 5163): `<section label>[ · <group>]` + `CRUMB_EXTRA[screen]` (line 5162). Results: home → "Keystone"; myprojects → "Keystone · {persona title}"; worldmap → "Portfolio · {n} projects located[ · {zone}]"; overview/portfolio/cash → "Portfolio · FY2026[ · {zone}]"; projects → "Portfolio · FY2026 · {n} projects[ · {zone}]" (n = projects in zone); client → "Keystone · read-only except decisions and issues". 12px, `--color-neutral-400`.
- Project picker (`showProjectPicker`, line 5175) is shown on `client` (not on the other 7 screens): "/" + button with `ph-folder-open` + `projectName` (`pname(code,name)` e.g. "#026 · Harbor Line Terminal Expansion") + caret; dropdown "Switch project" with scope segmented "My projects / Whole portfolio" (only when `scopeAvail`), search "Search a project number or name…", options list (name, sub `ana · DAS n · mt · pm`, health tag). Next to the title: project health tag (`projectHealth`, `projectHealthClass`) and, if `projReadOnly`, outline tag `ph-eye` "Read-only".
- Right side: global search, notifications bell, "Status date · 25 Sep 2026" (static `statusDate`), language segmented FR/EN (`langSeg`, writes `lang`), **Export** secondary button (no handler in the prototype), primary button (`primary[screen]`, line 5137) shown when `hasPrimary` = label && handler && !outside:

| Screen | Primary button | Action |
|---|---|---|
| home | "New project" (`ph-plus`) only for `director`, `pm` | `openNp` → New project wizard (§5.8) |
| overview | "New project" | `openNp` |
| projects | "New project" | `openNp` |
| portfolio | "Score a proposal" | action form `AF.portfolio` (§6.6) |
| client | "Download status report" | action form `AF.client` (§8.8) |
| myprojects, worldmap, cash | none | — |

### 0.3 Formatting helpers

- `money(k, signed)` (line 3775) — all amounts in the data are **thousands** (k€). EN or USD: `|k|≥1000` → `{sign}{€|$}{(|k|/1000).toFixed(2)}M`, else `{sign}{€|$}{round(|k|)}k`. FR + EUR: `{sign}{x,xx} M€` / `{sign}{n} k€` (comma decimal, space before unit). `sign` = "−" (U+2212) when negative; "+" when `signed` and positive. Currency = prop `currency` (`'EUR'|'USD'`, default EUR). Examples: 13230 → "€13.23M" / "13,23 M€"; −270 signed → "−€270k" / "−270 k€".
- Percent strings: `Math.round(x*100)+'%'`. Ratios (CPI/SPI) `toFixed(2)` (stay "0.96" in FR — the FR layer does not localise decimals for these).
- Colours: `OK = var(--color-text)`, `LO = var(--color-accent-300)` (line 3135). "LO" is the warning colour throughout (there is no red in Nocturne).
- `pname(code,name)` = `pidOf(code)+' · '+name` (line 3145); `pidOf` returns `PROJ_ID[code].id` (e.g. "#026") or the code itself (e.g. "EWA-051 · Eastbank Warehouse Automation").

### 0.4 Health, status tags, i18n

- **Project health** (two implementations, keep both semantics, see Open questions):
  - Overview (line 3793): `e=budget×progress`, `c=e/actual` (unclamped), `m=min(c, spi)`.
  - `healthOf(p)` (line 3916) used everywhere else: `null` if `!actual || !progress`; else `m=min(budget×progress/actual, spi||1)`.
  - Thresholds: `m<0.90` → **Off track** (FR "Hors trajectoire"), `m<0.97` → **At risk** ("À risque"), else **On track** ("Conforme").
  - Tag class: Off track → `tag tag-accent`; At risk → `tag tag-outline`; On track → `tag tag-neutral`; no health → text "—" with `text-muted`.
- **Status (stage) tag** `statusTag(s)` (line 3917): `Annulé`, `Clos` → `tag tag-neutral`; `Garantie` or pipeline stages (`Initiative`, `APS`, `APD`) → `tag tag-outline`; execution stages → `tag tag-accent`. Stage names are French in both languages.
- Nocturne tag styles: `.tag` 11px, padding 3px 10px, radius 6px; `.tag-accent` bg `--color-accent-800` text `--color-accent-100`; `.tag-neutral` bg `--color-neutral-800` text `--color-neutral-100`; `.tag-outline` 1px `--color-accent` border + accent text.
- i18n: the prototype computes everything in English (`renderValsEN`) then, when `lang==='fr'`, deep-translates every string value (`deepTr` → `trFR` → `FR_DICT` exact match, else `FR_RULES` regexes, else segment-wise on " · ", " — ", " → ", " / ", plus month/day names). Keys in `SKIP_KEYS` (colours, ids, codes, `dates`, `rev`, …) are not translated. Project names are translated too (e.g. "Extension du terminal Harbor Line"). A rebuild should use proper i18n keys; the FR strings quoted in this spec come from `_extracted/fr_dict.json`.

### 0.5 Shared bars on portfolio screens

- **Zone bar** (template 130–136; `zoneBar` true on `overview, projects, pfplan, worldmap, portfolio, cash, fleet, sav`, line 5211). Row (gap 12px, wrap, margin-top −4px): label `ph-globe-hemisphere-east` (accent) + "Zone" (12px neutral-400); segmented `zoneSeg` (line 4995) with options "All zones" / "Europe & North America" / "Africa" / "Asia Pacific" (FR "Toutes zones / Europe & Amérique du Nord / Afrique / Asie Pacifique"), each followed by a count (11px neutral-400 tabular) = number of projects (all statuses) in that zone (`zoneCount`); then `ph-user-circle` + "Zone managers" + "O. Castel · A. Diallo · S. Nguyen" or, when a zone is selected, "Zone manager" + full name (e.g. "Aïcha Diallo"). Selecting a zone: `setState({pfZone, pfSel:null, pfWhatif:null, statusMenu:null, stageOpen:null})` (line 3902).
  - Zone of a project: `zoneOf(code)` = `GEO[code].zone || COUNTRY_ZONE[GEO[code].country]` || `'euna'` (line 3173). `inZone(code)` = no zone selected or equal.
  - Zone-empty notice (each screen has its own flag: `zoneEmptyOv/Pr/Pf/Cash/Map`): row 12.5px neutral-300, padding 10px 12px, radius md, bg neutral-900, `ph-globe-hemisphere-east` accent, text "No project in this zone for this view" (FR "Aucun projet dans cette zone pour cette vue").
- **Outside banner** (template 126–128): 12.5px neutral-300, padding 9px 12px, bg neutral-900 with inset 1px neutral-800 ring, `ph-eye` accent; text "Outside my workspace · Read-only · {persona title}"; ghost button `ph-house` "Home" → `go('home')`.
- **Toast** (template 159–161): fixed bottom 22px right 22px, `card elev-lg`, 1px `--color-accent-800` border, `ph-check-circle` accent 18px, text, close ×. `showToast(msg)` (line 5116) auto-clears after 4000 ms.

### 0.6 KPI tile (used by every screen here)

`div.card.elev-sm` (gap 3px, padding 12px 14px, bg `--color-surface`, shadow `0 0 0 1px #3f424d`): label 10.5px uppercase, letter-spacing .08em, neutral-400; value weight 500, letter-spacing −0.02em, colour `k.color`; sub neutral-400. Grid `repeat(auto-fit, minmax(W,1fr))`, gap 10px.

| Screen | min tile width W | value size | sub size | extra |
|---|---|---|---|---|
| Home | 170px | 24px | 12px | — |
| Overview | 160px | 24px | 12px | sub prefixed by icon `k.icon` |
| My projects, Projects map | 160px | 22px | 11.5px | — |
| Prioritisation, Cash, Client | 150px | 22px | 11.5px | — |

### 0.7 Segmented control helper

`seg(opts, current, set)` (line 3889) produces `{label, icon, onClick, color, shadow, bl}`: selected → colour `--color-accent` + `box-shadow: inset 0 0 0 1px var(--color-accent)`; others `--color-neutral-300`; separator `border-left:1px solid var(--color-divider)` on all but the first. Rendered as `.seg` > `button.seg-opt` (12px, padding 4px 10px). "Display" label (`FL.view`, FR "Vue") with `ph-eye` precedes view switchers.

---

## 1. Home (`home`, `isHome`)

**Who:** every role (landing page; also where a role switch lands). **Nav:** sidebar fixed entry "Home". **Purpose:** a role-specific landing page: 4 KPIs plus two "work queues" relevant to the persona (portfolio alerts and approvals for the director, the current project's KPIs and requests for the PM, approval queue for a department head, tasks for an engineer, etc.).

### 1.1 Layout (template 163–195)

- Column, gap 14px.
- Greeting block (gap 2px): `home.greeting` 18px/500 — "Good morning, {first name}" (FR rule → "Bonjour, {first name}"); `home.sub` 12.5px neutral-400 — "{persona title} · Friday 25 Sep 2026" (static date; FR "… · vendredi 25 sept. 2026").
- KPI grid: `home.kpis` (4 tiles, §0.6).
- Two cards, grid `repeat(auto-fit, minmax(min(100%,360px),1fr))`, gap 14px, align start. Each card: `card elev-sm`, padding 14px 16px, gap 4px; `card-title` (17px) + margin-bottom 4px; rows: grid `minmax(0,1fr) auto`, gap 12px, padding 8px 0, top border 1px neutral-900, `cursor:pointer` when the row has an `onClick`. Row left: title 13px, sub 11.5px neutral-400 (both `text-wrap:pretty`); right: optional tag (`r.tagClass`, `white-space:nowrap`). Empty state per card: "Nothing waiting" (FR "Rien en attente"), 12.5px neutral-500.

### 1.2 Content per role (`homes`, line 4425; `home = homes[role] || homes.director`; `homeVals`, line 4435)

Row helper `row(title, sub, tag, tagClass, onClick)`; `goTo(screen, extraState)`.

| Role | KPI tiles (source) | Left card title → rows | Right card title → rows |
|---|---|---|---|
| director | `portfolioKpis[0..3]` (§4: Total budget, Actual cost, Forecast (EAC), Cost perf. (CPI)) | "Needs attention" (FR "Points d’attention") → the Overview `alerts` (§4.4): title, detail, no tag, click = alert action | "Approvals across the portfolio" → 4 rows: "Change requests pending" / "Harbor Line · CR-008 second steel crew · +€85k" / tag "1" accent → `changes` with `cr:'CR-008'`; "Purchase orders awaiting approval" / ids joined (e.g. "PO-1082") or "None" / count, outline → `orders`; "ECOs in approval" / ids (e.g. "ECO-2026-015") / count, outline → `eco`; "Resource requests pending" / "Department heads · {n} open" / count, neutral → `requests` |
| pm | `scheduleKpis[0]` SPI, `budgetKpis[5]` CPI, `budgetKpis[3]` Forecast (EAC), `scheduleKpis[3]` Critical path float — all for the **current project** (`state.project`) | "My resource requests — {project name}" → first 6 `requests` of the current project: title / "{person} · {dept} · {h} h" / tag Pending (outline) · Reschedule proposed (accent) · Approved (neutral) · Rejected (neutral) → `requests` | "Waiting for me" → POs awaiting approval: "{PO id} · {supplier}" / "Purchase order · {value}" / tag "Approve" accent → `orders` (`po`); ECOs in approval where PM approval pending and the project is concerned: "{ECO id}" / title / "Approve as PM" → `eco`; static row "Re-baseline proposal" / "Schedule slip −27 d · BL2 to submit to the change control board" / "Prepare" outline → `schedule` |
| depthead | "Awaiting my approval" (= pending requests of `state.dept`, sub "Resource requests · {dept}", LO if >0), `resourceKpis[0..2]` (Team utilization, Over-allocated, Unmet demand) | "Approval queue — {dept}" → pending requests: title / "{person} · {project} · {hours} · {dates}" / status tag → `approvals` | "Team load — next 8 weeks" → people of the department: name / role / avg load % (accent tag if >100) → `resources` |
| member | `workKpis[0..3]` (Due today, Overdue, Next week, Logged this week) | "My tasks" → first 6 open tasks: title / "{project short name} · due {day}" / status label, accent if due ≤ today → `task` | "This week" → "Hours logged" / "Read from Lucca · {h} h this week" / "Lucca" → `mywork`; "Load" / "Average {n}% over the next 2 weeks" / "{n}%" → `mywork`; "Skills & certifications" / cert text / "View" → `skills` |
| englead | `ecoKpis[0]`, `ecoKpis[1]`, `dwgKpis[2]`, `plmKpis[1]` | "ECOs waiting for engineering" → ECOs not Released/Rejected: "{id} · {type}" / title / status → `eco` | "Watchlist" → skill-coverage gaps ("Single expert — …", tag "Skill gap") → `skills`; up to 3 non-released drawings "{no} · rev {rev}" → `drawings` |
| quality | "ECOs awaiting quality", `plmKpis[2]`, `bomKpis[2]`, "Inspections requested" | "Quality approvals" → ECOs In approval / Impact analysis, tag "To review" or "Approved" → `eco` | "Parts needing action" → up to 6 non-validated parts used in a project: "{ref} · {name}" / "Used in {projects}" / part status → `plm` |
| procurement | `poKpis[3]`, `poKpis[4]` (**undefined — prototype bug**, see Open questions), "BOM not yet ordered", "ECOs touching open POs" | "Purchase orders to act on" → POs not Received/Cancelled: "{id} · {supplier}" / "{part refs} · {value}" / PO status → `orders` | "Still to order — {project}" → BOM shortfall: ref / "{name} · {mfr}" / "{qty} to order" → `orders` |
| client | "Progress" ({EV/BAC}%, "Work completed · {project}"), "Milestones reached" (`PD.milesText`, sub "Next: Structure topped out" static), "Change requests to approve" ("1", "CR-008 · €85k", static, LO), "Deliverables to accept" (count of `DELIVERABLES` Submitted, "Acceptance due within 10 days") | "Milestones" → schedule milestones: name / "Baseline {date} · Forecast {date}" / status tag → `client` with `cpTab:'progress'` | "Waiting for your decision" → static "CR-008 — Second steel crew" / "+€85k · schedule recovery 12 days · submitted 24 Sep" / "Approve / reject" → `client` `cpTab:'decisions'`; one row per `DELIVERABLES` (D-014…D-017): "{id} · {title}" / "{type} · {note}" / status (Submitted accent, Accepted neutral, else outline) → `client` decisions; "Invoices" / "Milestone 4 invoice €640k · due 15 Oct" / "Open" → `client` `cpTab:'invoices'` |

Seed example (director): KPIs "€13.23M · 6 active projects", "€7.43M · 56% of budget spent", "€13.50M · −€270k vs budget" (LO), "0.96 · Earned per $1 spent" (LO). PM: "SPI 0.90 · Earning 90¢ of planned work per $1", "CPI 0.92 · Target ≥ 1.00", "Forecast (EAC) €5.24M · At current CPI", "Critical path float −27 days · 4 of 8 packages critical".

The KPI/row sources of non-portfolio roles are defined by other modules (resources, my work, ECO, PLM, purchasing); this screen only re-uses them.

### 1.3 Interactions
- Row click → `goTo(...)` as listed (sets `screen` and optional selection keys `cr`, `po`, `eco`, `dwg`, `part`, `cpTab`).
- Primary "New project" for director / pm only.

---

## 2. My projects (`myprojects`, `isMyProjects`)

**Who:** all roles except client. **Nav:** fixed sidebar entry "My projects" (`ph-folder-user`). **Purpose:** card wall of the projects the current persona is involved in (or the whole portfolio as a fallback), with health, EVM indices, forecast finish, next milestone and the user's open tasks; entry point to a project.

### 2.1 Layout (template 196–214)
- Column, gap 14px.
- KPI grid `myProjKpis` (4 tiles).
- Fallback notice when `myProjFallback`: info row (`ph-info` accent 16px, 12.5px neutral-300, bg neutral-900, inset ring neutral-800) "No project is assigned to you — the whole portfolio is shown." (FR "Aucun projet ne vous est affecté — tout le portefeuille est affiché.").
- Card grid `repeat(auto-fill, minmax(min(100%,300px),1fr))`, gap 12px. Each card `card elev-sm`, padding 14px 16px, gap 10px, cursor pointer, hover `box-shadow: inset 0 0 0 1px var(--color-accent-700)`; whole card clickable (`p.open`).

Card anatomy, top to bottom:
1. Header: name (14.5px/500, `pname`) + sub 11.5px neutral-400 "{analytic code | code} · {PM} · {client}"; right: health tag.
2. Tag row: status tag (`statusTag`), outline tag with my role (`p.myRole`, if any), and when `p.readOnly` an inline `ph-eye` "Read-only" (11px neutral-500).
3. "Progress" row (11.5px neutral-400, value right tabular in text colour) + 4px bar (track neutral-900, radius 2, fill `linear-gradient(90deg, accent-700, accent-500)`, width = progress %).
4. 3-column metrics (font 12px; labels 10.5px uppercase .06em neutral-500): "SPI" (`spiColor`), "CPI" (`cpiColor`), "Forecast finish" (`finishColor`).
5. "Next milestone" label + milestone name + line `msLine` (11.5px, `msColor`).
6. Footer (top border neutral-900, padding-top 6px): "My open tasks" 12px neutral-400 + count 13px (text colour if >0 else neutral-500) + right "Open project" + `ph-arrow-right` (12px, accent-300).

### 2.2 Data and rules (lines 5063–5070)
- Pool: `pool = projects with DEFS[code]` (the 6 planned projects: HLT-026, NDC-031, RCF-019, ERP-202, WSA-044, MSR-012; line 4165).
- `meName` = persona full name; `meShort` = "R. Aubert" style (`ownerShort`).
- My role on a project (`myProjRole`, first match wins):

| Condition | myRole label (FR) |
|---|---|
| role = director | "Portfolio director" (Directrice de portefeuille) |
| role = client and client = "Port authority" (hard-coded) | "Client" |
| PM short name = `p.pm` | "Project manager" (Chef de projet) |
| `DEFS[code].team` contains my name | "Team member" (Membre de l’équipe) |
| I have open todos whose `project` prefixes the code | "Assigned tasks" (Tâches assignées) |
| role = depthead and a team member belongs to my department (`DEPT_OF`) | "Department involved" (Service impliqué) |
| otherwise | not mine |

- If nothing matches → fallback: whole pool, `myRole = ''` (role tag hidden).
- Per card (`myProjects`): `health = healthOf(p)||'—'`; `ex = pvExtra(p, !!healthOf(p))` (§5.5) gives `spiText/cpiText/colours`, `finishForecast`, `finishColor`, `msName`, `msLine||msDate||'—'`, `msColor`; `progress = round(progress×100)%`; `myOpen` = todos with `person=meName`, status ≠ done, `code.startsWith(t.project)`; `readOnly = role∉{director,client} && p.pm≠meShort`; `open` → `setState({screen:'plan', project:code, projMenu:false})`.
- KPIs (`myProjKpis`): "My projects" = card count, sub `'Whole portfolio'` (fallback) or persona title; "At risk" = cards with health ∉ {On track, —} (LO if >0), sub "{n} off track"; "My open tasks" = all my open todos, sub "Across my projects" / "Nothing assigned"; "Pending decisions" = `apprItems.length` (My approvals queue, line 4721), sub "In my approvals", LO if >0.

Seed (director): 6 cards, KPIs 6 / 3 (1 off track) / 0 / 5. HLT card: "#026 · Harbor Line Terminal Expansion", "HAV004 · R. Aubert · Port authority", Fabrication & Assemblage, At risk, 64%, SPI 0.90, CPI 0.91, Forecast finish 14 Jan 2027, Next milestone "Structure topped out" · "23 Oct · Late". PM: 1 card (role Project manager). englead / quality: fallback (6 cards, read-only).

---

## 3. Projects map (`worldmap`, `isWorldMap`)

**Who:** director, pm, depthead. **Nav:** Portfolio › "Projects map" (`ph-globe-hemisphere-west`). **Purpose:** geographic view of the international portfolio (sites in France, Morocco, Côte d’Ivoire, Canada, Australia, Malaysia), grouped by site, filtered by zone, with health/stage at a glance; opens a project.

### 3.1 Layout (template 215–236)
- Column, gap 14px. KPI grid `mapKpis` (4).
- Two-column grid `minmax(0,1fr) clamp(240px,28%,320px)`, gap 14px, align start:
  - Left: map card (`card elev-sm`, padding 0, overflow hidden, height `clamp(460px,68vh,720px)`, `position:sticky; top:14px`) containing `<iframe ref=mapRef src=mapSrc title="Projects map">` (100%×100%, no border, transparent).
  - Right: list column (gap 10px): heading "Sites · {mapSiteCount}" (10.5px uppercase .08em, accent); zone-empty notice (`zoneEmptyMap`); one card per site group (`card elev-sm`, padding 10px 12px, gap 4px):
    - Header button (full width, transparent, hover colour accent-300): `ph-map-pin` accent, city 13px/500, right "{country} · {count}" 11.5px neutral-400. Click → `g.focus`.
    - One row per project (button grid `minmax(0,1fr) auto`, padding 6px 0, top border neutral-900, 12.5px, hover accent-300): name (`pname`) + sub 11px neutral-400 "{code} · {pm} · {client}"; right column status tag (10.5px) and, if any, health tag. Mouse enter/leave → highlight on map; click → open.
- Footer hint 11.5px neutral-400: "Pan and zoom · click a marker to open the project · hover a project to highlight it on the map".

### 3.2 Data (lines 5072–5081)
- `mapPts` = zone-filtered live projects (`zP`) having `GEO[code]`: `{code, name:pname, city, country, lat, lng, cat, health, status, client, pm}` with `cat` = `pipeline` if status ∈ PIPE_STAGES; `closed` if Clos/Annulé; `active` if `healthOf` not null; else `other`. `health` only kept for `active`.
- `mapGroups`: one per distinct `city|country`, sorted by count desc then city name; `focus` posts `{action:'focus', code:firstItem.code}`.
- KPIs:
  - "Projects located" = `mapPts.length`; sub "{n} without location" if some zone projects lack GEO, else zone name or "Whole portfolio".
  - "Sites" = distinct sites; sub "{n} country/countries".
  - "Active on site" = cat active; sub "{n} in pipeline".
  - "At risk" = points with health ≠ On track (LO if >0); sub "{n} off track".
- Seed: 17 located, 11 sites / 6 countries, 7 active / 5 pipeline, 3 at risk / 1 off track. Groups: Le Havre (3: HLT-026, PRS-038, QFR-015), Lyon (3), Marseille (3), then 8 single-project sites.
- Item open (`p.open`, also used by the iframe message): if `DEFS[code]` → `{screen:'plan', project:code, projMenu:false}` else `{screen:'projects', q:code, statusFilter:null}` (projects list pre-filtered by search).

### 3.3 Map component contract (`Keystone PM map.html`, embedded via iframe)

Rebuild as a React component (d3-geo + topojson) with the same behaviour. Inputs today are passed in the iframe URL hash: `mapSrc = './Keystone PM map.html#' + encodeURIComponent(JSON.stringify({ui, points, zone}))` (line 5076):
- `ui`: labels `{world:'World', europe:'Europe', fit:'Projects', ontrack:'On track', risk:'At risk / off track', pipeline:'Pipeline', closed:'Closed / on hold', open:'Open project', projects:'projects', loading:'Loading map geometry…', failed:'Map geometry could not be loaded.'}` (translated with `trFR` when FR).
- `points`: `mapPts` (country, health, status translated).
- `zone`: `null` or `{label: zone name, bounds: ZONE_BOUNDS[zone]}` (bounds `[west, north, east, south]` in degrees).

Rendering:
- Projection `d3.geoNaturalEarth1()` fitted to the sphere with 6px inset; layers: sphere outline (neutral-800), 10° graticule (neutral-800, opacity .45, 0.5px), countries (fill neutral-900, stroke neutral-700 opacity .7, 0.6px, non-scaling strokes). Background radial gradient `900px 520px at 50% 45%, neutral-900 → transparent`. Geometry fetched from `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` (loading/failed message centred, 12.5px neutral-400). Attribution bottom-right "Natural Earth · world-atlas 2.0.2" (10px neutral-500).
- Zoom/pan: `d3.zoom` scaleExtent [1, 48], double-click zoom disabled; markers are counter-scaled (`scale(1/k)`) so they keep screen size; background click unpins the tooltip.
- Clustering (recomputed on each zoom): points closer than `18/k` projected px merge; cluster centre = mean.
  - Cluster (n>1): circle r 11, fill accent-900, stroke accent 1.5, count text 10.5px/500 accent-100; label "{city}" or "{n} sites".
  - Single marker by `styleOf`: active+On track → r 6 fill accent, stroke accent-200; active+other health ("risk") → r 6 fill accent-300 + dashed ring r 10 (accent-300, dash 3 2); pipeline → r 6 fill `--color-bg`, stroke accent-300 1.5 dashed 2.5 2; closed/other → r 4.5 fill neutral-600. Drop-shadow glow accent 55%.
  - Highlighted code (from list hover) → extra ring r 14 (r 15 for clusters) stroke accent-200 1.5.
  - Labels (11px neutral-200, bg-coloured halo) shown when `k ≥ 2.4` or ≤ 4 clusters.
- View control (top-left `.seg`): "World" (identity), "Europe" — or the zone label when a zone is set — (fits zone bounds, else default box [-12,62,34,34], max k 8), "Projects" (fits all points, max k 10 for one point else 14). Initial/home view: zone → that button; else "World" if longitude span > 90° or latitude span > 60°, else "Projects".
- Legend (bottom-left, 11px, bg 78% `--color-bg`): On track (solid accent dot), At risk / off track (accent-300 dot + dashed outline), Pipeline (dashed ring), Closed / on hold (neutral-600).
- Tooltip (`card elev-md`, 230–320px wide): header (10.5px uppercase accent) "{city · country | n sites} · {n} project(s)" + × when pinned; one row per project (name, sub "code · pm · client", status tag + health tag); footer "Open project →" (11px accent-300). Hover shows it; click pins it; clicking a cluster that is spread enough (`maxD×48 > 22`) zooms to it instead.
- Messages:
  - map → host: `parent.postMessage({type:'keystone-map', action:'open', code}, '*')` when a tooltip row is clicked; host listener in `componentDidMount` (line 3765) routes to plan/projects as in §3.2.
  - host → map: `{type:'keystone-map', action:'highlight', code|null}`, `{action:'focus', code}` (zoom to point ±1 px, max k 12, clears the view toggle), `{action:'view', view}`, `{action:'data', data}`.
  - When the hash changes (zone switch, language switch) the map re-renders and, if points or zone changed, re-applies the home view with animation (650 ms).

---

## 4. Portfolio overview (`overview`, `isOverview`)

**Who:** director, pm, depthead. **Nav:** Portfolio › "Overview" (`ph-squares-four`). **Purpose:** executive EVM snapshot of the six active (planned) projects of FY2026 — budget, actual cost, forecast at completion, CPI/SPI, at-risk count — plus a short list of portfolio alerts.

### 4.1 Layout (template 237–285)
- Column, gap 18px.
- KPI grid `portfolioKpis` (6 tiles, min 160px, value 24px, sub with icon).
- Zone-empty notice (`zoneEmptyOv` = zone set and no project).
- Column (gap 14px) of two cards:
  1. "Active projects" card (`card elev-sm`, padding 14px 16px, gap 8px, overflow auto): header `card-title` "Active projects" (FR "Projets actifs") + right 12px neutral-400 "6 projects · FY2026" (static; FR "6 projets · exercice 2026"); `table.table` 13px; legend row (11.5px neutral-400, gap 16px): 12×5 neutral-300 swatch "Budget spent", 2×10 accent mark "Work earned", text "Spend past the mark = paying more than the work is worth".
  2. "Needs attention" card (padding 14px 16px, gap 10px): grid `repeat(auto-fit, minmax(min(100%,260px),1fr))`, gap 0 24px; each alert: grid `28px minmax(0,1fr)`, gap 10px, padding 10px 0, top border neutral-900; icon tile 28×28 radius 7 bg accent-900 colour accent-300; title 13px/500; detail 12px neutral-400; ghost button 12px "{action}" + `ph-arrow-right`.

### 4.2 KPI tiles (line 3802–3808)

| Label (FR) | Value | Sub | Icon | Colour |
|---|---|---|---|---|
| Total budget (Budget total) | Σ budget | "{n} active projects" / "1 active project" | `ph-briefcase` | OK |
| Actual cost (Coût réel) | Σ actual | "{Σactual/Σbudget}% of budget spent" | `ph-receipt` | OK |
| Forecast (EAC) (Prévision (EAC)) | Σ EACᵢ | "{Σbudget − ΣEAC, signed} vs budget" | `ph-trend-up` | LO always |
| Cost perf. (CPI) (Perf. coût (CPI)) | ΣEV/ΣAC (2 dp) | "Earned per $1 spent" | `ph-gauge` | LO if < 0.97 |
| Schedule perf. (SPI) (Perf. délai (SPI)) | Σ(spiᵢ×budgetᵢ)/Σbudget | "Weighted by budget" | `ph-timer` | LO if < 0.97 |
| Projects at risk (Projets à risque) | "{risk} of {n}" | "{off} off track" | `ph-warning` | LO if risk > 0 |

Seed: €13.23M; €7.43M (56%); €13.50M (−€270k vs budget); 0.96; 0.96; "3 of 6" (1 off track).

### 4.3 "Active projects" table (`projects`, line 3793–3800)

Rows = the static `PROJECTS` seed (6 rows) filtered by zone — **not** the live `state.projects` (see Open questions). Per row: `EV = budget×progress`, `CPI = EV/actual`, `EAC = budget/CPI`, `VAR = budget − EAC`.

| Column (FR) | Content / formatting |
|---|---|
| Project (Projet) | name `pname` 500 weight; second line 11.5px neutral-400 "{pm} · due {due}" |
| Health (Santé) | health tag (§0.4) |
| Progress (Avancement) | 64×5 bar (track neutral-800, radius 3, fill accent width progress%) + "{progress}%" tabular |
| Spend vs earned (Dépensé vs acquis) | 84×5 bar: fill neutral-300 width `actual/budget` %; 2×11 accent marker at `left = progress%`, top −3px; then "{spent}%" 12px neutral-300 |
| CPI | 2 dp, LO if < 0.97 |
| SPI | 2 dp, LO if < 0.97 |
| EAC | money |
| Variance (Écart) | signed money; LO if negative else neutral-300 |

Row click → `setState({screen:'plan', project:code})`. No sorting (seed order). Seed rows: HLT At risk 64%/70% CPI 0.91 SPI 0.90 EAC €5.25M −€450k; NDC On track 51%/49% 1.05/0.98 €2.00M +€100k; RCF Off track 82%/90% 0.91/0.84 €1.48M −€126k; ERP On track 45%/43% 1.05/1.01 €911k +€49k; WSA On track 27%/26% 1.04/1.06 €3.26M +€141k; MSR At risk 91%/89% 1.03/0.95 €604k +€16k.

### 4.4 "Needs attention" (`alerts`, line 3809–3813)

Static list, filtered by zone when it carries a project code:

| Icon | Title | Detail | Action → target |
|---|---|---|---|
| `ph-lightning` | Harbor Line — critical path slip | Steel structure forecast 39 days late; handover moves to 14 Jan 2027. | "Open schedule" → `{screen:'schedule', project:'HLT-026'}` |
| `ph-coins` | Harbor Line — labor overrun | Labor forecast +€160k over its line budget; contingency 139% drawn. | "Open budget" → `{screen:'budget', project:'HLT-026'}` |
| `ph-users-three` | 3 people over 115% in October | Engineering demand exceeds capacity by 150 h across weeks 41–43. | "Rebalance" → `resources` |
| `ph-clock-countdown` | Clinique Pasteur Lyon — SPI 0.84 | Electrical subcontractor three weeks behind; recovery plan due Friday. | "Open schedule" → `{screen:'schedule', project:'RCF-019'}` |

In a real build these should be generated from rules (critical-path slip, cost overrun, over-allocation, SPI threshold).

---

## 5. Projects — list and lifecycle (`projects`, `isProjects`)

**Who:** director, pm. **Nav:** Portfolio › "Projects" (`ph-folders`). **Purpose:** the master register of all projects (pipeline, execution, warranty, closed, cancelled) with their identifiers (project ID, analytic code, DAS, machine type), stage-gate lifecycle management (move to next stage, tick stage deliverables, forced changes with reason), and three analytical views (health, progress, budget). Also hosts the New project wizard.

### 5.1 Layout (template 638–752)
- Column, gap 14px.
- Row 1 (line 640): "Display" + segmented `projViewSeg` (with icons): "Health view" (`ph-heartbeat`, FR "Santé"), "Progress view" (`ph-chart-line-up`, "Avancement"), "Budget view" (`ph-currency-eur`, "Budget"); writes `state.projView` (default `'health'`).
- Row 2 (641–661), flex wrap, gap 6px:
  - Stage slider zone: `flex:1 1 760px; overflow-x:auto`; inner `min-width:780px; padding:0 36px`; the slider itself (§5.2), height 66px.
  - Selected-stage block (min 200px, max 320px): `stSelLabel` 13px/500 (stage name or "All projects"); `stSelSub` 11.5px neutral-400 = "{n} project(s)" + " · " + `LIFE[stage]` description when a stage is selected; `stHint` 11px neutral-500: "Drag the cursor to filter by stage" (no filter) / "Drag the cursor or use ← → to change stage".
  - Search (margin-left auto, min 220px): `ph-magnifying-glass` + input "Search projects" (FR "Rechercher un projet"), min-height 34px → `state.q`.
- Zone-empty notice (`zoneEmptyPr`, line 662).
- Card (`card elev-sm`, padding 14px 16px, gap 8px, `flex:3 1 950px`, overflow auto): header `projectsTitle` = "{stage|All} projects · {row count}" + right hint `projViewHint`: health "Click a status to move it", progress "Forecast from SPI", budget "EAC = budget / CPI". Then one of three tables (13px).

### 5.2 Stage slider (accessible range control) — `stVals`, lines 3905–3915
- 14 stops: index 0 "All" + the 13 `STATUSES`. Short labels `ST_SHORT`: Init., APS, APD, Études, Appro., Fab., FAT, Expéd., Chantier, MES/SAT, Garantie, Clos, Annulé. Position `left = i/13 × 100%`.
- Element: `role="slider"`, `tabIndex=0`, `aria-valuemin=0`, `aria-valuemax=13`, `aria-valuetext=stSelLabel`; focus ring `0 0 0 2px accent-800`; `touch-action:none`, no text selection, radius 6px.
- Track: 2px line at top 11px (neutral-800); fill from 0 to the thumb (accent-700).
- Each tick (60px wide, centred, non-interactive): dot (index 0: 6px square radius 2, margin-top 9px; others: 8px circle, margin-top 8px). Dot colour: selected → accent + ring `0 0 0 4px accent-900`; before the selection → accent-700; has projects → neutral-500; empty → neutral-800. A 1px connector (neutral-800) of height 14px on odd indexes so labels alternate on two rows (odd labels get padding-top 6px). Label 10.5px (selected accent-300/500, has projects neutral-300, empty neutral-600); count below (10.5px tabular neutral-500) = projects of that stage in the current zone.
- Thumb: 16px circle, bg `--color-bg`, `inset 0 0 0 2px accent` + glow `0 0 10px accent 55%`, top 4px, `transition: left .16s ease`.
- Behaviour: pointer down (primary button) captures the pointer and sets the stop nearest to the x position (`round(clamp((x−left)/width) × 13)`); pointer move while dragging updates; pointer up/cancel ends. Keys: →/↑ next, ←/↓ previous, Home → All, End → Annulé. Setting a stop writes `statusFilter` (null for All, else the stage) and closes any status menu.

### 5.3 Row filtering (line 3933)
`zP` (zone-filtered `state.projects`) → keep when (`!statusFilter || status === statusFilter`) and, if `q` (lower-cased) is set, one of: name contains q, code contains q, `PROJ_ID.id` contains q, analytic code contains q, machine type **equals** q. Order = `state.projects` order (new projects are prepended). No column sorting.

### 5.4 Shared "Project" and "Status" cells (all three views)
- **Project cell** (3 lines): line 1 name (`pname`, 500) — clickable only when `DEFS[code]` exists (`canOpen`): cursor pointer, `title="Open project · Plan — WBS"`, trailing `ph-arrow-square-out` accent 13px; click → `{screen:'plan', project:code}`. If `isNew`: accent tag "New" (10px, padding 1px 7px). Line 2 (11.5px neutral-400 tabular): "{analytic code} · DAS {n} · {machine type}" ("—" when unknown). Line 3 (11.5px neutral-400): "{pm} · {client} · {start} → {finish}".
- **Status cell** (position relative): button styled as the status tag (`statusTag`), 11px, padding 3px 8px 3px 10px, trailing caret; click (stopPropagation) toggles `statusMenu = code`. Popover (`elev-md`, z 20, top `calc(100% − 4px)`, left 6px, min-width 240px, bg surface, padding 6px): caption "Move to" (10px uppercase neutral-500; FR "Déplacer vers"); one button per allowed transition `TRANS[status]` (§ Status machines): `ph-arrow-right` accent + target stage + right-aligned gate text `GATES[target]` (11px neutral-400). Clos/Annulé have no transitions (empty popover).
- Transition click (line 3938): if target is `Annulé`, or the current stage has unticked deliverables (`missingOf(code, status)`), open the **Force stage change** dialog (`force = {code, from, to, missing}`); otherwise `advance(code, to, 'auto', '')` (line 3922): set status, clear `isNew`, append `[to, '25 Sep 2026', 'auto', '']` to `stageHist[code]`, close menus.

### 5.5 Derived row metrics (`pvExtra(p, live)`, line 3924)
`live` = `showH` = `healthOf(p)` exists and status ∉ {Initiative, APS, Clos, Annulé}. Non-live rows show "—" for SPI, CPI, milestone, attention, forecast, float, earned, EAC, VAC; spent shows actual if > 0; spent bar neutral-600.

For live rows:
- `cpi = clamp(budget×progress/actual, 0.70, 1.25)` (1 if no actual); `spi = p.spi||1`; `earned = budget×progress`; `eac = budget/cpi`; `vac = budget − eac`.
- If the project has planning data (`HLT-026` or `DEFS[code]`) `pd = projectData(code,p)` supplies `MILES`, `floatDays`, `finishText`, `baselineText`, `start`. Otherwise `floatDays = round((spi−1)×180)`.
- Next milestone = first `MILES` entry not "Done" (else the last). `msDate` = `pd.finishText` if that milestone is the last one, else `fmtD(monthDate(start + forecastMonth))`; `msLine` = "{msDate} · {state}"; `msColor`: Late → LO, At risk → accent-300, else neutral-400.
- `attention` = join(" · ") of: "SPI x.xx" if spi < .97; "CPI x.xx" if cpi < .97; "{milestone} · Late"; "{|floatDays|} d slip" if floatDays < 0; else "—" (FR: each part via `frSeg`, e.g. "27 j de dérive").
- `finishPlanned` = `pd.baselineText` or `p.finish` (or "finish not planned" when finish is "—"); `finishForecast` = `pd.finishText`, else for slipping projects `fmtD(monthDate(mIdx(finish)+1 − floatDays/30))`, else `p.finish`; `finishColor` = LO if floatDays < 0 else neutral-300; `floatText` = "+n d" / "−n d" / "0 d" ("—" when finish is "—").
- `spentPct = actual/budget`; `spentColor` = LO if actual > earned×1.03 else accent.

### 5.6 The three views

**Health view** (`pvHealth`, template 666–687), columns: Project · Status · Health (tag; "—" muted when not live) · SPI (LO <.97) · CPI (LO <.97) · Next milestone (name + `msLine` 12px coloured) · Attention (12px neutral-300, max-width 260px).

**Progress view** (`pvProgress`, 688–721), columns: Project · Status · **Stage deliverables** · Progress (64×5 bar, fill `barColor` = accent, + %) · SPI · Baseline finish · Forecast finish (`finishColor`) · Float (`finishColor`).
- Stage deliverables cell (min 150px): button = 56×5 bar (fill accent width `delivPct`) + "{done} / {total}" (12px neutral-300) + caret; click toggles `stageOpen = code`.
- Popover (`elev-md`, z 20, right-aligned, top `calc(100% + 2px)`, width `min(380px,70vw)`, padding 10px, gap 6px):
  - Caption "Deliverables of the current stage · {status}" (FR "Livrables de l’étape en cours").
  - Checklist of `STAGE_DELIVS[status]`: `ph-check-square` (accent-300) / `ph-square` (neutral-400) 16px + label 12.5px; click (stopPropagation) → `toggleDeliv(code, stage, i)` (line 3923). When the toggle makes **all** deliverables of the project's current stage done and a next stage exists, the project auto-advances (status = next, history `[next,'25 Sep 2026','auto','']`); the popover stays open and now lists the new stage's deliverables.
  - Help 11px neutral-400: "When every deliverable is ticked the project moves to the next stage automatically."
  - Caption "Stage history · {count}" then entries newest first: grid `minmax(0,1fr) auto auto` (12px, top border neutral-900): stage (+ reason 11px neutral-400 when present), date (neutral-400), mode tag 10px ("Forcé" → `tag-accent`, "Auto" → `tag-neutral`; these two labels are French in both languages).

**Budget view** (`pvBudget`, 722–748), columns: Project · Status · Budget (right) · Spent (right) · Earned (right) · CPI · EAC (right) · Variance at completion (right, LO if negative) · Spent vs budget (64×5 bar fill `spentColor` width spent% + %).

Seed examples: HLT "Fabrication & Assemblage", health At risk, SPI 0.90, CPI 0.91, next milestone "Structure topped out · 23 Oct · Late", attention "SPI 0.90 · CPI 0.91 · Structure topped out · Late · 27 d slip", deliverables 2 / 4, baseline 18 Dec 2026, forecast 14 Jan 2027, float −27 d, budget €4.80M, spent €3.36M, earned €3.07M, EAC €5.25M, VAC −€450k, 70%; history 6 entries (Etudes forced with reason). CER-047 (APD, no planning data) shows Off track and CPI 0.70 (clamped). PRS-038 shows "finish not planned".

### 5.7 Force stage change dialog (template 3058–3069, `forceVals` line 3942)
- `.dialog-backdrop` z 55; `.dialog` width `min(560px,100%)`, gap 14px.
- Header: `dialog-title` "Force stage change" (FR "Forcer le changement d’étape"); sub 12.5px neutral-400 "{pname} · {from} → {to}"; close icon button.
- If missing deliverables: box (bg accent-900, padding 10px 12px) "Missing deliverables" (`ph-warning` accent, 13px/500) + one line per missing item (`ph-square`, 12.5px neutral-200).
- If target = Annulé: text 13px neutral-300 "Cancelling a project stops every open request, order and task. The decision is recorded in the stage history."
- Field "Reason for forcing (required)" (input, placeholder "e.g. client pressure on delivery date, deliverable to follow next week") → `forceReason`.
- Note (12.5px neutral-300, `ph-seal-check` accent): "A forced change is applied immediately and sent for validation to the portfolio director — Marie Lefebvre · Directrice de portefeuille. The history keeps the mode (auto / forced) and the reason."
- Actions: "Cancel" (secondary) → `force:null, forceReason:''`; "Confirm and request validation" (primary, `ph-arrow-right`) **rendered only when the trimmed reason is non-empty** (`canConfirm`) → `advance(code, to, 'forced', reason)`.
- Side effect: forced entries dated '25 Sep 2026' appear in the director's "My approvals" as kind "Forced stage change" (line 4726; no approve/reject handlers, opens `projects`).

### 5.8 New project wizard (template 2972–3055; logic 3945–3969, 5184–5185)
Opened by "New project" (home for director/pm, overview, projects): `openNp` = `np.open=true, step=1` (other wizard values are **not** reset).
- `.dialog-backdrop` z 50 (align start, padding-top 6vh); `.dialog` width `min(720px,100%)`, max-height 88vh, scroll.
- Header "New project" + "Guided setup · step {n} of 4" + close (`npClose`).
- Stepper: 4 equal columns; 2px bar (accent if index < step, else neutral-800) + label 11.5px (current step text colour, others neutral-400): "Basics", "Structure", "Budget", "Schedule".
- **Step 1 – Basics** (2-col grid, gap 12px):
  - "Project name" (full width input, placeholder "Eastbank Warehouse Automation") → `np.name`.
  - "Project ID" (read-only box): `nextProjectId()` = "#" + (max numeric id in `PROJ_ID` + 1, 3 digits) — seed "#045"; hint "#000 · auto-incremented".
  - "Analytic code" (read-only): `nextAnalytic(client)` = `clientCode3(client)` + (count of existing analytic codes with that prefix + 1, 3 digits); hint: no client → "3 client letters + incremental number"; known client (`CLIENT_CODES`) → "Client code {XXX} · incremental number"; new client → "New client — code {XXX} proposed" (`clientCode3` = first 3 letters upper-cased, padded with X).
  - "DAS" segmented "DAS 1…DAS 4" (default '2'); "Machine type" segmented EMP / MEMU / SPUR / AUTRE / R&D (default EMP). Changing the type switches the template to that type's template (unless "blank" is selected) and reloads its cost categories.
  - "Project manager" — static display "SP · S. Perrin" with caret (not functional).
  - "Client / sponsor" input (placeholder "Logistics business unit") → `np.client`.
  - "Currency" segmented USD / EUR (default EUR).
  - "Planned start" static "11 Jan 2027"; "Planned finish" static "30 Sep 2027" (calendar icon, caret; not functional).
- **Step 2 – Structure**: "Start from" cards (grid auto-fit min 200px): templates `NP_TEMPLATES` filtered to `blank` + the one of the chosen machine type; card = radio dot (14px, selected = accent fill + inset 3px neutral-900) + name 13.5px/500 + description 12px neutral-400, border accent when selected; click sets `template` and loads its categories. Summary box (bg neutral-900, auto-fit 130px): "WBS", "Activities & logic", "Cost categories" ("{n} categories" or "Define in step 3"), "Calendars", "Baselines" = "Not copied" (neutral-500). If the template has phases: "Standard phases — WBS level 1" + neutral tags "{n} · {phase}" + note "The budget breakdown in the next step follows the same machine type."
- **Step 3 – Budget**: "Cost categories for this project" + right `catSource` ("Start from nothing" / "Budget structure of {template name}"); grid `minmax(0,1.6fr) 130px 110px 32px` with headers Category / Type / Budget (k): name input, type (static display + caret), budget input (right-aligned), remove icon button. "Add category" ghost button adds `{name:'New category', type:'Labor', budget:'0'}`. "Contingency" segmented 5% / 10% / 15% (default 5). "Total budget" (10.5px caption + 18px/500 value) = Σbudget × (1 + cont/100), formatted `€|$` + `(t/1000).toFixed(2)+'M'` if ≥ 1000 else `round(t)+'k'`.
- **Step 4 – Schedule**: "Default calendar" segmented "Standard 5d · 8h" / "Site 6d · 10h" / "24h continuous"; static fields "Progress cycle (data date)" = "Weekly · Fridays", "Baseline policy" = "Set BL1 at Planning → Active", "Working time" = "08:00 – 17:00", "Holidays" = "US federal + site shutdown 24 Dec – 2 Jan". "Will be created" box: `{id} · {analytic} · DAS {n} · {mt} · {name|Untitled project} · status Initiative · {empty WBS | wbs, acts copied} · {n} cost categories with {c}% contingency · {calendar} calendar · weekly data date.`
- Footer: "Back" (step > 1), "Next" + arrow (step < 4), "Create project" + check (step 4). No field validation.
- `npCreate` (line 3969): closes the wizard, clears `statusFilter`, navigates to `projects`, prepends `{code: clientCode3(client)+'-'+idDigits (e.g. "LOG-045"), name||'Untitled project', status:'Initiative', pm:'S. Perrin', client||'—', start:'Jan 2027', finish:'Sep 2027', budget:total, actual:0, progress:0, spi:1, isNew:true}` and registers `PROJ_ID[code] = {id, das, mt, ana}`.

Template catalogue `NP_TEMPLATES` (line 3179): `blank` "Projet blank" (empty), `EMP` "Planning EMP" (6 phases · 14 lots, 38 activités · 52 liens, cal "Standard 5d · 8h + Atelier", 7 categories), `MEMU` (6 phases · 12 lots, 31 activités · 40 liens, 6 categories), `SPUR` (6 phases · 15 lots, 44 activités · 60 liens, "Chantier 6d · 10h", 5 categories), `AUTRE` "Planning standard (Autre)" (5 phases · 8 lots, 4 categories), `R&D` (5 phases · 7 lots, 3 categories). Names/descriptions/phases are French data. Each category `[name, type ∈ Labor|Material|Subcontract|Fees|Equipment, budget k]`.

---

## 6. Portfolio — prioritisation & capacity (`portfolio`, `isPortfolio`)

**Who:** director, pm. **Nav:** Portfolio › "Prioritisation" (`ph-strategy`). **Purpose:** rank active and pipeline projects with a weighted multi-criteria score (strategic fit, margin/NPV, risk, resource fit, client priority), and test whether a pipeline project can be absorbed by current departmental capacity over the next 8 weeks.

### 6.1 Layout (template 2079–2142)
- Column, gap 14px.
- "Display" + segmented `pfSeg`: "Prioritisation" (`score`) / "Capacity what-if" (`capacity`) → `state.pfTab` (legacy value `'cash'` is treated as `score`).
- Zone-empty notice (`zoneEmptyPf` = zone set and no ranked row).
- **Prioritisation tab** (`pfIsScore`): KPI grid `pfKpis` (5); margin-masked notice when `marginMasked` (role ∉ {director, pm}): `ph-lock-simple` "Margins are visible to directors and project managers only."; flex row (wrap, gap 14px): ranking card (`flex:2.6 1 1070px`, overflow auto) + weights card (`flex:1 1 250px`).
- **Capacity tab** (`pfIsCap`, rendered only if a pipeline project exists — `hasWi`): selector row, verdict card, then flex row: demand card (`flex:1.6 1 560px`) + options card (`flex:1 1 260px`).

### 6.2 KPI tiles (`pfKpis`, line 4503)

| Label (FR) | Value | Sub |
|---|---|---|
| Active projects (Projets actifs) | count of zone projects in EXEC_STAGES | "{Σ budget} committed" |
| Pipeline | count in PIPE_STAGES | "{Σ budget} proposed · approved · planning" |
| Top-ranked (Mieux classé) | code of rank 1 | its name |
| Portfolio margin (Marge du portefeuille) | "18%" (hard-coded) or "•••" | "Client projects · weighted by contract" / "Directors and PMs only" |
| Weights sum (Somme des poids) | round(Σw×100)% | "Edit weights on the right"; LO if |Σw − 1| > 0.01 |

Seed: 6 (€13.63M committed), 5 (€13.08M), WSA-044, 18%, 100%.

### 6.3 Ranking table "Ranking — active and pipeline" (`scoreRows`, line 4500)
Header right text: "Score = Σ axis (1–5) × weight · pipeline projects compete with active ones for capacity".
- Rows: zone projects that have an entry in `SCORES` and whose status is not 'Closed'/'Cancelled'. **Correction (completeness pass):** the test compares against the legacy English names `'Closed'`/`'Cancelled'`, but project statuses are the French stage names (`STATUS_MAP_OLD` maps Closed → `Clos`, Cancelled → `Annulé`), so this filter never excludes anything. It has no visible effect today only because no `Clos`/`Annulé` project has a `SCORES` entry. OPEN QUESTION: the rebuild should probably exclude `Clos` and `Annulé` (and maybe `Garantie`).
- `score = Σᵢ (sᵢ/5) × (wᵢ / Σw) × 100`, rounded; sorted descending; `rank` = 1…n.
- Columns: "#" (rank, neutral-400) · Project (name with ellipsis, max 260px; code 11.5px tabular) · Status tag · Score (column width 18%: flexible 6px bar, track neutral-800, fill accent width = score%; number 26px wide right-aligned, 500) · one column per axis — Strategic fit, Margin / NPV, Risk level, Resource fit, Client priority — showing 5 dots 8px (filled `accent-500` up to the value, else neutral-800; `title` = axis label) · Budget (right) · Margin (right): `(contract − budget)/contract` % from `BILLING`; "Internal" when no billing / zero contract; "•••" for roles without margin rights; LO when < 15%.
- Row click toggles `pfSel` (row bg accent-900); no other effect.
- Seed ranking: 1 WSA-044 81 (5 4 3 4 4, 13%), 2 NDC-031 77 (11%), 3 HLT-026 72 (11%), 4 MSR-012 69 (14%), 5 ERP-202 66 (Internal), 6 FTU-052 64 (Internal), 7 RCF-019 54 (10%).

### 6.4 Weights card (`weightRows`, line 4501)
"Weights" + sub "Editable · the ranking recomputes live". One row per axis (grid `minmax(0,1fr) 40px 70px`, top border): label 13px; normalised share `round(w/Σw×100)%` (11.5px neutral-400); number input (`step=0.05 min=0 max=1`, min-height 30px, right-aligned) → `pfWeights[k] = parseFloat || 0` (state initialised lazily from `SCORE_AXES` defaults .25/.25/.20/.15/.15). Footnote: "Axes and scale are defined in Settings · scores are entered at the Proposed stage and reviewed at each gate".

### 6.5 Capacity what-if (lines 4505–4512)
- Selector: "Pipeline project to absorb" + segmented `wiSeg` listing pipeline project **codes** (zone-filtered); default = first pipeline project (`pfWhatif` null → first, seed WSA-044).
- Verdict card (bg accent-900, padding 14px 16px, gap 6px): `ph-scales` accent; name 14px/500; "{budget} · start {start}" 12px neutral-300; status tag right; verdict 14px coloured; "Capacity gap · {gapH} h over 8 weeks" 12px neutral-300.
- Demand model: departments `capBase` = `[Engineering 960/1110, Site operations 640/690, MEP 480/510, Controls & planning 640/560, Quality 320/370]` = [capacity h, current commitment h] (same numbers as `ROLES`); candidate demand per department = round(budget/1000 × {140, 90, 60, 70, 40}) hours. For each department: `tot = cur + add`, `gap = max(0, tot − cap)`, scale `sc = max(cap, tot) × 1.1`.
- Demand card "Demand vs capacity by department — next 8 weeks" + sub "Current commitments + the candidate project · tick = available capacity": per department a header line (name, "+{add} h" neutral-400, "{tot} / {cap} h" LO if over) and an 8px bar (track neutral-900, radius 4): committed segment neutral-600 width `cur/sc`, candidate segment accent width `add/sc`, capacity tick 2×14px neutral-200 at `cap/sc` (top −3px). Legend: Committed / Candidate project / Capacity.
- Verdict rules (`gapH = Σ gap`): 0 → "Can be absorbed with current capacity" (OK); < 300 → "Absorbable with {gapH} h of overtime or one contractor" (accent-300); else "Needs {ceil(gapH/140)} additional people or a later start" (LO).
- Options card (`ph-sparkle` + "Options"), rows 13px with top border: if gap → "Start {first word of name} 6 weeks later — gap closes as Harbor Line demobilises", "Contract {ceil(gapH/280)} engineer(s) for the ramp-up phase"; if no gap → "No action needed", "Keep 10% reserve for Harbor Line recovery"; always "Delay Metro Signage Line B (non-critical) by 2 weeks". Footnote: "Demand is estimated from budget and past projects of the same type until the WBS is planned."
- Seed (WSA-044, €3.40M): Engineering +476 h → 1586 / 960 h … gap 1560 h → "Needs 12 additional people or a later start".

### 6.6 Primary action "Score a proposal" (`AF.portfolio`, line 3690)
Generic action-form dialog (template 138–158): width `min(640px,100%)`, 2-column field grid, required marker `*` accent, Cancel + submit (`ph-play` icon since kind = run; disabled while a required field is empty). Fields: "Proposal" (select of pipeline projects, `pname`), "Strategic fit (1–5)" number default 3 *, "Financial return (1–5)" number 3 *, "Risk (1–5, 5 = low)" number 3 *, "Comment" textarea (full width). Submit "Save score" → closes and toasts "Score saved" (FR "Score enregistré"). Nothing is persisted in the prototype.

---

## 7. Cash flow & billing (`cash`, `isCash`)

**Who:** director, pm. **Nav:** Portfolio › "Cash flow" (`ph-coins`). **Purpose:** for projects in execution, the contract value, invoicing and collection status (milestone, monthly-progress or fixed-price billing), margin, next billable milestone, and a 6-month cash-in vs cash-out projection.

### 7.1 Layout (template 2143–2179)
- Column, gap 14px: zone-empty notice (`zoneEmptyCash`), KPI grid `cashKpis` (5), flex row (wrap, gap 14px): "Billing by project" card (`flex:2.2 1 1010px`, overflow auto) and "Cash flow — next 6 months" card (`flex:1 1 280px`).

### 7.2 Rows (`cashRows`, line 4517)
- Population: live projects with a `BILLING` entry **and** status in EXEC_STAGES, then zone filter (seed: HLT-026, NDC-031, RCF-019, ERP-202, MSR-012; WSA-044 excluded because it is at APD).
- `billingOf(code)` (line 4515): if a `CONTRACTS[code]` exists (only HLT-026), billing is derived from the contract: total = amount + Σ signed amendments (5400 + 120 = 5520); milestones `"{id} {label before ' ('}"`, amount = round(total × pct/100), status = billing override `ctrOv[id]` (set by the project Billing screen) or contract status. Otherwise the static `BILLING` tuple.
- Per row: `invoiced = Σ milestones with status ≠ Planned`; `paid = Σ Paid`; `outstanding = invoiced − paid`; `margin = (contract − budget)/contract`; `next` = first Planned milestone "{label} · {amount}" or "—"; internal when contract = 0.

| Column (FR) | Content |
|---|---|
| Project | name (ellipsis, max 240px) + code 11.5px |
| Billing model (Modèle de facturation) | 12px neutral-300: "Client · milestones" / "Client · monthly progress" / "Client · fixed price" / "Internal · capex" |
| Contract (Contrat) | money or "—" |
| Invoiced · paid (Facturé · payé), width 20% | 6px bar (track neutral-800, radius 3): invoiced overlay neutral-400 width invoiced/contract, paid overlay accent width paid/contract (both from the left) |
| Outstanding (En attente de paiement) | money; accent-300 if > 0 else neutral-400; "—" internal |
| Cost to date (Coût à date) | money(actual) |
| Margin | % (LO if < 15) / "—" / "•••" (no rights) |
| Next milestone | 12px neutral-300 |

Legend under the table: Paid (accent) / Invoiced (neutral-400). Header note: "Client projects bill on milestones or monthly progress · internal projects carry no revenue".

Seed: HLT €5.52M, invoiced €3.04M (55%), paid €1.66M (30%), outstanding €1.38M, cost €3.36M, 13%, next "M4 Cranes operational · €1.10M"; NDC €2.35M / €890k / €630k / €260k / 11% / "—"; RCF €1.50M / €900k / €600k / €300k / 10% / "Handover · €600k"; ERP internal; MSR €720k / €432k / €432k / €0k / 14% / "Line B · €288k".

### 7.3 KPIs (`cashKpis`, line 4520)

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Contract value (Montant du contrat) | Σ contract | "{n} client projects · {m} internal" | OK |
| Invoiced to date (Facturé à date) | Σ milestones ≠ Planned | "Milestones reached or monthly progress" | OK |
| Outstanding receivables (Créances en attente) | Σ milestones = Invoiced | "Invoiced, not yet paid" | accent-300 |
| Net cash · next 6 months (Trésorerie nette · 6 mois) | Σin − Σout (signed) | "Billing plan minus forecast spend" | OK |
| Lowest cumulative point (Point bas cumulé) | min over months of cumulative (in − out) (signed) | "November — before M3 payment lands" (static) | LO |

Seed: €10.09M (4 client · 1 internal), €5.26M, €1.94M, +€365k, −€490k.

### 7.4 Cash-flow chart (`cashBars`, line 4519)
- Months `CASH_M` = Oct, Nov, Dec, Jan ’27, Feb, Mar.
- Series (k€, hard-coded): cash in `[1350, 0, 1080, 0, 1350, 585]`, cash out `[820, 760, 700, 640, 560, 520]`, both multiplied by `zShare` = (contract value of zone projects / contract value of all cash projects) when a zone is selected.
- Rendering: card title "Cash flow — next 6 months" + sub "Billing plan in · forecast spend out"; flex row height 150px, gap 4px, bottom-aligned; each month column: net label 10px tabular ("+530k" / "−760k", colour LO if negative else accent-300 — both resolve to accent-300), bar area 100px with two bars side by side (gap 2px, radius 2px 2px 0 0): in = accent, height `in/1500 × 100%`; out = neutral-600, height `out/1500 × 100%`; month label 10.5px neutral-400. Legend 10px squares "Cash in" / "Cash out"; caption 11px neutral-500 "Net per month above bars". A cumulative value `cum` is computed per month but not displayed.

---

## 8. Client portal — My project, client view (`client`, `isClient`)

**Who:** client persona (Nadia Bensaïd, Port authority) and director. **Nav:** for role client, fixed sidebar entry "My project" (`ph-buildings`); crumb "Keystone · read-only except decisions and issues". **Purpose:** the external client's window on their EPC project: progress vs plan, contractual milestones, decisions they must take (change requests affecting price/date, deliverable acceptance with signed PV), invoices, issues they raise, and released documents to acknowledge.

### 8.1 Layout (template 2180–2236)
- Column, gap 14px. KPI grid `cpKpis` (5). "Display" + segmented `cpSeg`: "Progress & milestones" / "Decisions" / "Invoices" / "Issues" / "Documents" (FR "Avancement et jalons / Décisions / Factures / Incidents / Documents") → `state.cpTab` (default `progress`). Project picker in the header (§0.2) selects the project (`state.project`); for the client role, "My projects" scope = projects whose client is "Port authority" (HLT-026 only) but the "Whole portfolio" scope is also offered.

### 8.2 KPIs (`cpKpis`, line 4681) — for the current project's EVM data `PD`

| Label (FR) | Value | Sub | Colour |
|---|---|---|---|
| Progress (Avancement) | round(EV/BAC) % | "Planned {PV/BAC}% by today" | OK |
| Forecast handover (Livraison prévue) | `PD.finishText` | "Contract date {PD.baselineText}" | LO if float < 0 |
| Milestones (Jalons) | `PD.milesText` ("2 of 6") | "Reached" | OK |
| Awaiting your decision | CRs in review with client step pending + deliverables Submitted | "Change requests and deliverables" | LO |
| Open issues (Incidents ouverts) | issues not Closed | "Raised by you" | OK |

Seed (HLT): 64% (planned 71%), 14 Jan 2027 (contract 18 Dec 2026), 2 of 6, 3, 2.

### 8.3 Progress & milestones tab (`cpIsProgress`)
- Card `flex:1.4 1 560px`: title "Progress to date" + sub "Cumulative % complete · planned vs actual"; legend Planned (neutral-700) / Actual (accent). Chart: flex row height 150px gap 8px; per month up to the status date (`progression.slice(0, EVn)`, seed Jan…Sep) a pair of bars in a 120px area: planned height = `PV[i]/BAC`, actual = `EV[i]/BAC` (as %), radius 2px top; label 10.5px.
- Card "Milestones" (`flex:1 1 280px`): rows grid (name 13px; "Contract {baseDate} · Forecast {fcDate}" 11.5px neutral-400; status tag: Done neutral, Late accent, else outline) from the schedule `milestones` (line 3854).

### 8.4 Decisions tab (`cpIsDecisions`)
Grid `repeat(auto-fit, minmax(min(100%,460px),1fr))`, gap 14px.
- "Waiting for your decision" card, sub "Change requests affect the contract value or the handover date · deliverables are accepted with a signed PV". Rows (`cpDecisions`, line 4683), flex wrap, padding 10px 0, top border:
  - Left (min 220px): outline tag kind ("Change request" / "Deliverable") + "{id} · {when}" 11.5px tabular; title 13px; sub 11.5px — CR: "{types joined ' · '}[ · {±amount} on contract][ · {±days} d on handover]"; deliverable: "{type} · rev {rev} · {acceptance note}".
  - Right: ghost "Reject" (12px) and primary `ph-check` + "Approve" (CR) / "Accept (PV)" (deliverable).
  - Actions: CR approve → `setCR(id, {chain:{client:'ok'}})`, reject → `{chain:{client:'rejected'}}`; deliverable approve → `setDlv(id, {status:'Accepted', acc:'25 Sep · N. Bensaïd'})`, reject → `{status:'Rejected', acc:'25 Sep · comments issued'}`. The item then moves to "Decided".
  - Empty: "Nothing waiting for you".
- "Decided" card (`cpDecided`): CRs whose client step is ok/rejected (state "Approved" neutral / "Rejected" outline, `when` = CR date) and deliverables Accepted/Rejected (`when` = acceptance note); rows: title ellipsis, "{id} · {when}" 11px, state tag. Empty: "No decision yet".
- Seed (HLT): waiting = CR-008 "Second steel crew — schedule recovery" (Budget · Schedule · +€85k on contract · -12 d on handover), D-014, D-016; decided = CR-004, CR-006 (Approved), D-011, D-012, D-015 (Accepted).
- CR status derivation (line 4593): chain merged with overrides; any non-"n/a" step rejected → "Rejected"; all non-"n/a" steps ok → "Approved"; else original status. Other projects (no HLT data) show the generic deliverables D-110…D-113.

### 8.5 Invoices tab (`cpIsInvoices`)
- Card `flex:1.8 1 560px`: "Invoices & payments" + "Milestone billing per contract · 30 days net"; table: Invoice ("F-2026-{101+i}", "—" if no contract) · Milestone · Amount (right) · Payment ("Due 15 Oct" if Invoiced, "Settled" if Paid, "On milestone" if Planned; 12px neutral-300) · Status tag (Paid neutral, Invoiced accent, Planned outline). Source: static `BILLING[project]`. Empty (internal project): "Internal project — no client billing".
- Card "Contract summary" (`flex:1 1 260px`): key/value rows (12.5px, bottom border): Contract value, Invoiced, Paid, Approved changes (`PD.recon.chg`, signed, "—" if 0). Ghost button `ph-file-pdf` "Download statement" (no handler).
- Seed (HLT): F-2026-101 M1 Permits €540k Paid … F-2026-103 M3 Structure €1.35M Invoiced "Due 15 Oct"; summary €5.40M / €2.97M / €1.62M / +€200k.

### 8.6 Issues tab (`cpIsIssues`)
- Card: "Issues you raised" + "Acknowledged within 2 working days · answered by the project manager".
- Input "Describe a new issue or request" (`ciNew`) + primary `ph-plus` "Raise issue" → `raiseIssue` (line 4689): ignores blank; prepends `['CI-0'+(8+len−3), text, 'Raised today', 'Open', 'Acknowledged — response within 2 working days']` to `clientIssues` (initialised from `CLIENT_ISSUES`), clears the input.
- Rows: title 13px, "{id} · {raised}" 11.5px, response 12px neutral-300; status tag Closed neutral / Open accent / other (In progress) outline.
- Issues are global (not filtered by project).

### 8.7 Documents tab (`cpIsDocs`)
- Card "Documents" + sub "Deliverables"; table 12.5px with columns [ID] (header label is the wrong key `T.k747` "Column mapping" — see Open questions) · Title ("{title} · {type label} · {date}") · Rev · Status tag · actions.
- Rows `cpVaultDocs` (line 5061): Codex vault documents (`docRow`, line 5026) where `shared` (document type has the client flag and status Released) and `proj === project`. Actions: icon button `ph-download-simple` → logs a download in `engOv.dl[id]` ("{persona} · rev {rev} · 29 Sep · PDF"); if not yet acknowledged, primary "Acknowledge receipt" → `engOv.ack['{id}|{rev}'] = true`; once acknowledged, neutral tag "Acknowledged". A new release of a client-shared document resets acknowledgement (handled in the Codex module).
- Empty: "Own documents · files stay in the business tool, Keystone holds revision and status".
- Seed (HLT): 7 documents; PID-HLT-026 rev D (26 Sep) awaiting acknowledgement, the 6 others acknowledged.

### 8.8 Primary action "Download status report" (`AF.client`, line 3689)
Action form with selects "Period" (September 2026 / Q3 2026 / Since project start) and "Format" (PDF / PowerPoint); submit "Download" → toast "Report downloaded". No file is produced in the prototype.

---

## Data entities

All money in k€ (thousands). Dates are display strings in the prototype; a rebuild should store ISO dates.

### Project (live record, `state.projects`, built by `initialProjects()` line 3163)
| Field | Type | Example | Notes |
|---|---|---|---|
| code | string | "HLT-026" | internal key `XXX-nnn` |
| name | string | "Harbor Line Terminal Expansion" | |
| status | Stage (see below) | "Fabrication & Assemblage" | seed from `STAGE_OF` (6 main) or `STATUS_MAP_OLD[legacy]` (EXTRA) |
| pm | string | "R. Aubert" | short form "I. Lastname" |
| client | string | "Port authority" | client / sponsor |
| start | string | "Jan 2026" | month-year or "—" |
| finish | string | "Dec 2026" | month-year or "—" |
| budget | number (k) | 4800 | BAC |
| actual | number (k) | 3360 | AC to date |
| progress | number 0–1 | 0.64 | physical % complete |
| spi | number | 0.90 | schedule performance index |
| isNew | boolean? | true | set by wizard, cleared on first stage move |

Seed sources: `PROJECTS` (6 planned projects: `{name, pm, budget, actual, progress, spi, due, open?}`), `META` (name → `[code, client, start]`), `EXTRA` (11 tuples `[code, name, legacyStatus, pm, client, start, finish, budget, actual, progress, spi]`: EWA-051, FTU-052, RBR-048, CER-047, PRS-038, ALP-021, DRR-009, HRM-011, QFR-015, TTR-017, SCP-033), `STATUS_MAP_OLD` (Proposed→Initiative, Approved→APS, Planning→APD, Active→Fabrication & Assemblage, On hold→Approvisionnements, Closing→Garantie, Closed→Clos, Cancelled→Annulé).

### ProjectIdentity (`PROJ_ID`, line 3168) — code → `{id, das, mt, ana}`
| Field | Type | Example |
|---|---|---|
| id | string "#nnn" | "#026" (auto-incremented project number) |
| das | "1".."4" (`DAS_LIST`) | "2" (business area / Domaine d’activité stratégique) |
| mt | machine type ∈ `MACHINE_TYPES` = EMP, MEMU, SPUR, AUTRE, R&D | "EMP" |
| ana | analytic code = client code (3 letters, `CLIENT_CODES`) + 3-digit counter | "HAV004" |

`CLIENT_CODES`: Port authority HAV, Infrastructure BU NGD, Health trust CPL, Finance KEY, Energy BU WFE, Transit BU RTM, Logistics BU LOG, Network BU TLN, Retail BU SGP.

### Geo & zones
- `GEO[code] = {city, country, lat, lng, zone?}` (17 projects).
- `ZONES = [[id, label, manager]]`: `euna` Europe & North America / Olivier Castel; `afr` Africa / Aïcha Diallo; `apac` Asia Pacific / Sophie Nguyen.
- `COUNTRY_ZONE` country → zone id; `ZONE_BOUNDS` zone → `[west, north, east, south]` (euna [-135,72,45,24], afr [-22,40,55,-38], apac [58,52,180,-50]); `CITY_COUNTRY`, `zoneOfSite(site)` for site strings.

### Stage reference data
- `STATUSES` (13): Initiative, APS, APD, Etudes, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise Service & SAT, Garantie, Clos, Annulé. `STAGE_ORDER` = first 12. `PIPE_STAGES` = Initiative, APS, APD. `EXEC_STAGES` = Etudes … Mise Service & SAT (7).
- `LIFE[stage]` — one-line description (FR), e.g. Chantier "Montage et raccordements sur site".
- `GATES[stage]` — entry gate text shown in the Move-to menu, e.g. FAT "Assemblage & câblage terminés", Annulé "Décision direction".
- `STAGE_DELIVS[stage]` — list of exit deliverables (3–4 per stage; Clos 2; Annulé none), e.g. Fabrication & Assemblage: "Structure fabriquée & contrôlée", "Assemblage mécanique terminé", "Câblage & armoires terminés", "NCR majeures clôturées".
- `stageDone[code][stage]` — boolean array aligned with `STAGE_DELIVS[stage]` (seed `STAGE_DONE_DEFAULT`).
- `stageHist[code]` — array of `[stage, date, mode 'auto'|'forced', reason]` (seed `STAGE_HISTORY` for HLT-026 and RCF-019).

### EVM series (per project, `projectData(code, proj)` line 3310; HLT uses constants)
| Field | Type | HLT example |
|---|---|---|
| PV | number[12] cumulative planned value by month | `HPV` = [162,349,733,1133,1573,2290,2622,2975,3420,4151,4569,4800] — built from `HLT_OFFER` payment points (deposit/delivery/acceptance % of each supplier quote placed in its month) + `HLT_STREAMS` monthly cost streams, cumulated |
| EV | number[≤12] cumulative earned value to the status date | `HEV` = [170,390,700,1060,1450,1880,2300,2710,3080] (Jan–Sep) |
| AC | number[≤12] cumulative actual cost | `HAC` = [175,410,745,1130,1560,2030,2490,2950,3360] |
| BAC | number | `HBAC` = 4800 |
| MILES | `[name, baselineMonth, forecastMonth, status]` | `HMILES` (6 milestones: Permits approved … Handover) |
| finishText / baselineText / floatDays / milesText | strings / number | "14 Jan 2027" / "18 Dec 2026" / −27 / "2 of 6" |
| recon.chg | number | 200 (approved changes) |

Formulas: `cpi = EV/AC`, `spi = EV/PV` (at last EV month), `eac = BAC/cpi`, `vac = BAC − eac`, `tcpi = (BAC−EV)/(BAC−AC)`. For non-HLT projects `projectData` synthesises PV from `DEFS[code].pk` packages and `REX_FIN` payment patterns, EV/AC from progress and clamped CPI, milestones every second package with status Done / Late (slip > 0.4 month) / At risk (baseline < now+2) / On track.

### Portfolio scoring
- `SCORE_AXES = [[key, label, defaultWeight]]`: fit "Strategic fit" .25; margin "Margin / NPV" .25; risk "Risk level" .20; res "Resource fit" .15; client "Client priority" .15.
- `SCORES[code] = [fit, margin, risk, res, client]` integers 1–5 (e.g. HLT-026 [5,3,2,3,5]).
- `pfWeights` — editable weights (state).

### Billing & contract
- `BILLING[code] = [model, contractValue, [[label, amount, status ∈ Paid|Invoiced|Planned]]]` (e.g. NDC-031 "Client · monthly progress", 2350, months Jun–Sep; ERP-202 "Internal · capex", 0, []).
- `CONTRACTS[code]` (HLT only): `{ref, client, signed, amount, terms, retention, retentionNote, ld, warranty, type, law, scope, amendments:[[label, amount, status, date, ref]], bonds:[[label, amount, state]], milestones:[[id, label, pct, due, status, invoicedDate, paidDate]]}`.
- `CASH_M` month labels; cash in/out arrays hard-coded in logic (line 4518).

### Capacity
- Department capacity tuple `[name, capacityH, currentDemandH]` (`capBase` = `ROLES`); demand coefficients per €1M budget: Engineering 140 h, Site operations 90, MEP 60, Controls & planning 70, Quality 40.

### Client portal
- Client issue `[id, title, raised, status ∈ Open|In progress|Closed, response]` (`CLIENT_ISSUES`, 3 seed rows CI-04/06/07).
- Change request (as used here): `{id, title, types:['budget'|'scope'|'schedule'], amt, days, wbs, status, by, date, chain:{pm, director, client, ccb: 'ok'|'pending'|'rejected'|'n/a'}, bl}` (`HLT_CRS_X`).
- Deliverable: `{id, title, type, wbs, due, status ∈ DELIV_FLOW2, raci:{R,A,C,I,B}, rev, acc}` (`HLT_DELIVS`).
- `DELIVERABLES` (client home rows) `[id, title, type, status, note]`.
- Vault document (subset used): `{id, title, typeLabel, date, rev, status, stClass, shared, ack}`.
- `CLIENT_DOCS` `[category, description, fileCount]` — defined and exposed as `cpDocs` but not rendered by the template.

### Persona / role
- `PERSONAS[role] = [name, title]`; `ROLE_SCREENS[role] = allowedScreenIds | null`.

### New-project draft (`state.np`)
`{open, step 1–4, name, client, das, mt, cur 'EUR'|'USD', template, cats:[{name, type, budget}], cont 5|10|15, cal}`.

---

## Status machines / workflows

1. **Project lifecycle (stage gate)** — `TRANS` (line 3146):
   `Initiative → APS → APD → Etudes → Approvisionnements → Fabrication & Assemblage → FAT → Expédition → Chantier → Mise Service & SAT → Garantie → Clos`; from any stage except Clos/Annulé also `→ Annulé`. Clos and Annulé are terminal. Only the next stage is offered (no skipping, no going back).
   - **Auto advance**: all `STAGE_DELIVS` of the current stage ticked (via the Progress-view popover) → move to next stage, history mode `auto`.
   - **Manual move without missing deliverables**: Move-to menu → immediate `auto` move.
   - **Forced move**: target Annulé, or deliverables missing → Force dialog → reason mandatory → move applied immediately, history mode `forced` + reason, item queued for the portfolio director's validation (My approvals, informational only in the prototype).
   - Pipeline = Initiative/APS/APD; execution = Etudes…Mise Service & SAT; Garantie = warranty; Clos = closed; Annulé = cancelled.
2. **Project health**: computed, not stored — On track / At risk / Off track (§0.4); not shown for Initiative, APS, Clos, Annulé on the list.
3. **Milestone status** (schedule): Done → (On track | At risk | Late) derived from baseline vs forecast and status date.
4. **Billing milestone**: Planned → Invoiced → Paid (invoice issued from the project Billing screen sets `ctrOv[id]='Invoiced'`).
5. **Change request — client step**: pending → ok | rejected; CR overall: Draft → In review → Approved | Rejected (derived from the chain pm/director/client/ccb; "n/a" steps ignored).
6. **Deliverable acceptance**: Planned → In progress → Internal review → Submitted → Accepted | Rejected (`DELIV_FLOW2`); the client acts only on Submitted.
7. **Client issue**: Open → In progress → Closed (only creation as Open exists in the UI).
8. **Client-shared document**: Released & shared → acknowledgement pending → Acknowledged (per id + revision).
9. **Map marker category**: active / pipeline / closed / other (from stage + health).

---

## Cross-links

| From | Element | To |
|---|---|---|
| Home (director) | alerts | Schedule (HLT-026 / RCF-019), Budget (HLT-026), Resources |
| Home (director) | approvals rows | Change control (`cr:'CR-008'`), Purchase orders, ECO, Resource requests |
| Home (pm) | requests / waiting rows | Resource requests, Purchase orders (`po`), ECO (`eco`), Schedule |
| Home (depthead / member / englead / quality / procurement) | rows | Approvals, Resources, Task (`task`), My work, Skills, ECO, Drawings (`dwg`), PLM (`part`), Purchase orders |
| Home (client) | rows | Client portal tabs progress / decisions / invoices |
| My projects | card | Plan — WBS (`plan`, sets `project`) |
| Projects map | marker tooltip row / list row | Plan (planned projects) or Projects list filtered by code |
| Overview | table row | Plan — WBS of that project |
| Overview | alert buttons | Schedule, Budget, Resources |
| Projects | project name | Plan — WBS |
| Projects | forced stage change | My approvals (director) |
| Projects / Overview / Home | "New project" | New project wizard → Projects |
| Cash | billing status | reflects invoices issued on the project Billing screen (`ctrOv`) and the HLT Contract |
| Client portal | decisions | same CR records as Change control; same deliverables as Quality — deliverables |
| Client portal | documents | Codex documents register (acknowledgement, downloads) |
| Zone bar | `pfZone` | shared with Portfolio schedule, Installed base, Warranty claims |

---

## Open questions

1. **Procurement home KPI bug**: `homes.procurement.kpis` uses `poKpis[4]`, but `poKpis` has 4 items (index 0–3) → the second tile is `undefined`. Which KPI was intended (e.g. "Late deliveries" = `poKpis[2]`)?
2. **Documents tab header**: the ID column header is bound to `T.k747` = "Column mapping" (FR "Correspondance des colonnes") — clearly a wrong key; intended label probably "Reference"/"No.". Also the card sub-title says "Deliverables" for a list of documents.
3. **Scoring data keys**: `SCORES` contains `EWA-041`, `RBR-038`, `CER-045`, which do not match the projects `EWA-051`, `RBR-048`, `CER-047`; those pipeline projects are therefore missing from the ranking (only FTU-052 of the pipeline is ranked besides WSA-044). The ranking filter also excludes legacy statuses 'Closed'/'Cancelled' instead of 'Clos'/'Annulé'. Confirm intended population (active + pipeline only?).
4. **Overview data source**: the Overview table and KPIs read the static `PROJECTS` seed (6 projects), not the live register — stage changes, new projects and the 11 other projects are ignored; header "6 projects · FY2026" is static and the KPI says "6 active projects" although WSA-044 is at APD (pipeline). Which population should the Overview use?
5. **Two CPI/health formulas**: Overview uses unclamped CPI; Projects/My projects clamp CPI to [0.70, 1.25] for display/EAC but use the unclamped value in `healthOf`. Pick one rule.
6. **Billing source of truth**: Cash screen derives HLT billing from `CONTRACTS` (contract €5.52M incl. signed Amendment 1; M3 €1.38M), while the client Invoices tab reads `BILLING` (€5.40M; M3 €1.35M); the client home "Invoices" row says "Milestone 4 invoice €640k · due 15 Oct". These must be reconciled.
7. **Cash projections hard-coded**: monthly cash-in/out arrays are constants scaled by zone share; the "Lowest cumulative point" sub-label "November — before M3 payment lands" is static although the computed minimum falls in Jan ’27 (−€490k). Real rule: cash-in from billing plan dates, cash-out from forecast spend (PV/ETC)?
8. **Portfolio margin KPI** is hard-coded "18%". Formula wanted (contract-weighted margin of client projects)?
9. **Capacity model**: department capacities (`capBase`, duplicated from `ROLES`) and demand coefficients per €1M are hard-coded; every department is already over capacity before adding a candidate, so the "can be absorbed" branch is unreachable with seed data. Source for capacity/demand in production (Resources module, Lucca)?
10. **"Score a proposal"** only shows a toast; its 3 axes (fit, financial return, risk) differ from the 5 `SCORE_AXES`. What is persisted and how does it feed the ranking?
11. **Forced stage change validation**: the director receives an informational item without approve/reject handlers; date is hard-coded "25 Sep 2026" (also for auto moves). Define the validation workflow (approve → keep, reject → revert?).
12. **New project wizard**: PM, planned start/finish, category type, progress cycle, baseline policy, working time and holidays are static displays; currency choice is not stored on the project; no validation (empty name → "Untitled project"); draft values are not reset after creation; created project gets hard-coded PM "S. Perrin", start "Jan 2027", finish "Sep 2027". Confirm required fields and defaults.
13. **Who may create projects**: "New project" is hidden on Home for non-director/PM roles but visible on Overview to the department head (Overview is in its allowed screens). Restrict to director/PM?
14. **Read-only "outside" mode**: when a role opens a screen outside its workspace the banner says read-only but controls (e.g. status menu, deliverable ticks) remain active. Should they be disabled?
15. **Client identity is hard-coded** ("Port authority" in `isMineP` and `myProjRole`); the client can still switch the project picker to "Whole portfolio". Should clients be strictly limited to their own projects?
16. **Client issues** are global (not per project) and the generated id becomes "CI-010" after two additions (string concatenation). Need per-project issue register with proper numbering.
17. **Client home KPIs** "Change requests to approve" = "1" and the CR-008 row are static instead of derived from the CR chain.
18. **Lifecycle vocabulary in French in EN mode** (stage names, `LIFE`, `GATES`, `STAGE_DELIVS`, history reasons, "Forcé"/"Auto", template names) — keep French as domain language, or translate?
19. **Static dates**: greeting "Good morning" + "Friday 25 Sep 2026", "Status date · 25 Sep 2026", acceptance stamps "25 Sep · N. Bensaïd" — to be replaced by the real status (data) date and current user/time.
20. **Map**: legend says "Closed / on hold" but the legacy "On hold" status is mapped to Approvisionnements (PRS-038 shows as active, On track). Map tooltip status-tag colour follows health, not stage. Map geometry and d3/topojson are loaded from public CDNs — self-host in production?
21. **Export** (header) and **Download statement** (client invoices) buttons have no behaviour — define outputs.
22. `CLIENT_DOCS` (document categories with file counts) is computed (`cpDocs`) but not rendered — dropped feature or to be added to the Documents tab?
23. Overview "Spend vs earned" bar is not clamped (spent > 100 % overflows the 84px track; e.g. HRM-011 106 % if ever shown). Clamp or allow overflow marker?
24. Dead code to ignore: `barColor` test on status 'Cancelled', unused `exec` flag in slider ticks, `pfTab:'cash'` legacy value, `NP_TEMPLATES_OLD`.

---

## Addendum (completeness pass)

### A.1 Correction
§6.3: the ranking-row filter `!['Closed','Cancelled'].includes(p.status)` (logic 4500) never excludes anything, because project statuses are French stage names (`Clos`, `Annulé`). The text in §6.3 has been corrected inline and the point is now an OPEN QUESTION there.

### A.2 Client-portal empty-state flags (identifiers not named above)

| Flag | Template line | Logic (5195 / 5198) | Tab | EN text | FR text |
|---|---|---|---|---|---|
| `noDecisions` | 2201 | `!cpDecisions.length` | Decisions → "Awaiting your decision" list | "Nothing waiting for you" | **no FR_DICT entry**, so it renders in English in FR mode |
| `noDecided` | 2206 | `!cpDecided.length` | Decisions → "Decided" list | "No decision yet" | "Aucune décision pour l’instant" |
| `noCpInv` | 2215 | `!cpInvoices.length` | Invoices | "Internal project — no client billing" | "Projet interne — pas de facturation client" |
| `noCpVault` | 2231 | `!cpVaultDocs.length` | Documents | "Own documents · files stay in the business tool, Keystone holds revision and status" | "Documents produits · les fichiers restent dans l’outil métier, Keystone porte révision et statut" |

### A.3 OPEN QUESTION: mis-keyed labels on the client Documents tab
The Documents tab (template 2228–2232) uses three translation keys that belong to the engineering register screen (template ~2431): `T.k731` "Deliverables" (shown as the card sub-title), `T.k732` "Own documents · files stay in the business tool…" (shown as the empty state) and `T.k747` "Column mapping" (shown as the first column header, already listed in Open questions). These look like shifted or mis-assigned keys, not intended copy. The rebuild needs real client-facing strings for the sub-title, the ID column header and the empty state (for example "No document shared with you yet"). Confirm the wording with design.
