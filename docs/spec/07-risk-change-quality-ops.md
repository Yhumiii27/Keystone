# 07 — Risks, change control, quality / NCR, ITP, interfaces, commissioning, REX, installed base, after-sales

Source of truth: `design/Keystone PM v8.dc.html` (prototype). Template line numbers below match `design/_extracted/template-annotated.html` (same numbering as the prototype). Logic line numbers refer to the prototype file (`class Component`, `renderValsEN()`).

## 0. Screens covered

| Screen id (`state.screen`) | Flag | Template lines | Logic lines | Page title (EN / FR) | Nav label (EN / FR) | Nav icon | `startScreen` option? |
|---|---|---|---|---|---|---|---|
| `risks` | `isRisks` | 1771–1832 | 4570–4590 | Risk register / Registre des risques | Risk register / Registre des risques | `ph ph-shield-warning` | yes |
| `changes` | `isChanges` | 1833–1882 | 4591–4609 | Change control & baselines / Contrôle des modifications et références | Change control / Contrôle des modifications | `ph ph-git-pull-request` | yes |
| `quality` | `isQuality` (+ `qIsNcr`, `qIsDlv`) | 1883–1971 | 4612–4644 | Quality — NCR & deliverables / Qualité — NCR et livrables | Quality & deliverables / Qualité et livrables | `ph ph-seal-check` | yes |
| `itp` | `isItp` (+ `itpIsPlan`, `itpIsPunch`) | 880–892 | 4938–4951 | Inspection & test plan · punch list / Plan d’inspection et d’essais · réserves | Inspections & punch list / Inspections & réserves | `ph ph-clipboard-text` | no |
| `interfaces` | `isInterfaces` | 893–899 | 4952–4957 | Interface register / Registre des interfaces | Interfaces / Interfaces | `ph ph-arrows-left-right` | no |
| `commissioning` | `isCommissioning` (+ `hasComm`, `noComm`) | 910–920 | 4969–4977 | Commissioning & handover dossier / Mise en service & dossier de transfert | Commissioning & handover / Mise en service & transfert | `ph ph-key` | no |
| `rex` | `isRex` | 921–931 | 4997–5006 | Lessons learned & project closure / Retours d’expérience & clôture du projet | Lessons learned & closure / REX & clôture | `ph ph-graduation-cap` | no |
| `fleet` | `isFleet` | 948–955 | 4979–4995 | Installed base / Parc installé | Installed base / Parc installé | `ph ph-crane-tower` | no |
| `sav` | `isSav` (+ `savIsClaims`, `savIsIv`, `savIsCosts`) | 956–971 | 4979–4995 | Warranty claims & interventions / Réclamations & interventions | Warranty claims & interventions / Réclamations & interventions | `ph ph-wrench` | no |

Related, documented elsewhere but tightly coupled: `contingency` (Contingency register, template 900–909, logic 4959–4967 — reads open-risk EMV), `myapprovals` (unified approvals inbox — CR, deliverable, NCR verification items), `client` (client portal decisions — CR + deliverables), `budget` (cost profile uses `REX_FIN`), `eco` (ECO dispositions per machine feed the installed-base "Configuration" column), `settings` (risk categories list `ST.riskCats`).

---

## 1. Shared conventions used by all screens in this area

### 1.1 Shell integration (from the global header / sidebar)

* **Title**: `titles[screen]` (logic 5109). `<h2>` 26 px in the page header (template 97).
* **Breadcrumb** (`crumbOf()`, logic 5162–5163) = `<section label> · <group label>` + optional `CRUMB_EXTRA[screen]`:

  | Screen | Crumb (EN) |
  |---|---|
  | risks | `Project · Control · 5×5 + EMV` |
  | changes | `Project · Control` |
  | quality | `Project · Control · ISO 9001` |
  | itp | `Project · Control` |
  | interfaces | `Project · Team & exchanges` |
  | commissioning | `Project · Site & handover` |
  | rex | `Project · Project review` |
  | fleet, sav | `Warranty & after-sales` (+ `· <zone name>` when a zone is selected) |

* **Sidebar placement** (`buildSecs`, logic 5160): section **Project** (label = current project name `#026 · Harbor Line Terminal Expansion`), sub-groups:
  * *Team & exchanges* (FR « Équipe & échanges »): meetings, stakeholders, **interfaces**
  * *Control* (FR « Maîtrise »): **risks, changes, quality, itp**
  * *Site & handover* (FR « Chantier & transfert »): site, **commissioning**
  * *Project review* (FR « Bilan »): trends, **rex**
  * Section **Warranty & after-sales** (FR « Garantie & SAV »), with the zone name as sub-label when filtered: **fleet, sav**.
* **Nav badges** (logic 5146–5149), string count shown only when > 0:

  | Nav item | Badge value |
  |---|---|
  | risks | # open risks with score ≥ 15 |
  | changes | # CRs with status `In review` |
  | quality | # open NCRs with severity `Critical` |
  | itp | # open punch items of category A (`itpBadge`) |
  | interfaces | # interfaces whose effective status is `Late` (`ifcBadge`) |
  | sav | # non-closed claims with severity Major or Critical (`savBadge`, all zones) |
  | commissioning, rex, fleet | none |

  With HLT-026 seed data: risks `1`, changes `1`, quality `1`, interfaces `1`, sav `2`, itp empty.
* **Project picker**: `showProjectPicker` is true for risks, changes, quality, itp, interfaces, commissioning, rex (all project-scoped; current project = `state.project`, default `HLT-026`). It is **false for fleet and sav**, which are portfolio-wide and filtered by **zone** (`zoneBar` true for fleet/sav; see §2.8).
* **Primary header button** (`primary` map, logic 5137) — `btn btn-primary` with `ph ph-plus` icon, opens the generic action-form dialog (§3):

  | Screen | Label (EN / FR) | Form key |
  |---|---|---|
  | risks | New risk / Nouveau risque | `risks` |
  | changes | New change request / Nouvelle demande de modification | `changes` |
  | quality | New NCR / Nouvelle NCR (also shown on the Deliverables tab) | `quality` |
  | itp | Add inspection / Ajouter une inspection (plan view) — Add punch item / Ajouter une réserve (punch view) | `itp` / `punch` |
  | interfaces | New interface / Nouvelle interface | `interfaces` |
  | commissioning | Plan SAT / Planifier la SAT | `commissioning` (run-only) |
  | rex | Add lesson / Ajouter un REX | `rex` |
  | fleet | Add machine / Ajouter une machine | `fleet` |
  | sav | New claim / Nouvelle réclamation | `sav` |

  `hasPrimary` (logic 5177) hides the button when the screen is **outside the role's workspace** (`outside`) or when the project is **read-only** for the role (`projReadOnly`) and the screen is in the read-only list (includes risks, changes, quality, itp, interfaces, commissioning, rex — not fleet/sav).
* **Roles that see these screens in the sidebar** (`ROLE_SCREENS`, constant line 3465; `director: null` = everything):

  | Screen | director | pm | depthead | member | englead | quality | procurement | client |
  |---|---|---|---|---|---|---|---|---|
  | risks | ✓ | ✓ | – | – | – | ✓ | – | – |
  | changes | ✓ | ✓ | – | – | – | – | – | ✓ |
  | quality | ✓ | ✓ | – | – | ✓ | ✓ | – | ✓ |
  | itp, interfaces, commissioning, rex, fleet, sav | ✓ | – | – | – | – | – | – | – |

  A role reaching a screen not in its list (via search, notification, deep link) gets the "Outside my workspace · Read-only · <persona title>" banner (FR « Hors de mon périmètre · Consultation · … ») and an extra sidebar section "Outside my workspace"; the primary button is hidden. Row-level buttons are **not** disabled (see Open questions).
  Personas (`PERSONAS`, line 3747): director Marie Lefebvre (Portfolio director), pm Romain Aubert (Project manager), englead Antoine Girard, quality Gabriel Comte (Quality manager), procurement Fabien Bertrand, client Nadia Bensaïd (Client — Port authority).

### 1.2 Reusable building blocks (identical markup across screens)

| Block | Markup / styles | Notes |
|---|---|---|
| Screen root | `div` flex column, `gap:14px` | every screen |
| KPI row | grid `repeat(auto-fit,minmax(150px,1fr))`, `gap:10px`; each tile `.card.elev-sm`, `gap:3px`, `padding:12px 14px`; label 10.5 px, uppercase, `letter-spacing:0.08em`, `--color-neutral-400`; value 22 px, weight 500, `letter-spacing:-0.02em`, colour from data; sub 11.5 px `--color-neutral-400` (some screens add `text-wrap:pretty`) | Value colour is either `LO` = `var(--color-accent-300)` (attention) or `OK` = `var(--color-text)` (constants line 3135); a few tiles use `--color-neutral-200` |
| Filter chips (`chips()`, logic 4110) | Leading label: `ph ph-funnel` (or `ph ph-warning`) icon 15 px accent + `FL.<name>` text 12 px neutral-400. Each chip: `button`, inline-flex, `gap:8px`, `padding:4px 10px`, `border-radius:var(--radius-md)`, 12 px; selected → bg `--color-accent-900`, border `--color-accent-700`, text `--color-accent-200`; unselected → transparent, border `--color-neutral-800`, text `--color-neutral-300`; hover bg `--color-neutral-900`. Count after label: 11 px tabular neutral-400 (shows `0` too). First chip is "All" (value `null`). Clicking the selected chip again re-selects it (no toggle-off). | A right-aligned workflow hint (`margin-left:auto`, 12 px, neutral-400) follows the chips |
| Segmented control (`seg()`, logic 3889) | `.seg` flex (wrap allowed); options `.seg-opt` 12 px, `padding:4px 10px`, optional Phosphor icon; active → text `--color-accent` + `box-shadow: inset 0 0 0 1px var(--color-accent)`; inactive → `--color-neutral-300`; options after the first get `border-left:1px solid var(--color-divider)`. Leading label `ph ph-eye` + `FL.view` ("Display") or `FL.register` ("Register"). | |
| Register card | `.card.elev-sm`, `padding:14px 16px`, `gap:8px`, `overflow:auto`; header row: `.card-title` (17 px) + right/below helper text 12 px neutral-400 | tables inside use Nocturne `.table` at 13 px (risks, changes, quality) or 12.5 px (others) |
| Row id cell | stacked: id 12 px weight 500 tabular, colour `--color-accent-300` when the row is the open one, else `--color-neutral-300`; title below with `text-wrap:pretty`; optional third line 11.5 px neutral-400 | rows with a drawer are `cursor:pointer`, click toggles selection |
| Right drawer | Overlay `position:fixed; inset:0; z-index:60; background: color-mix(in srgb, var(--color-bg) 60%, transparent)` (click = close). Panel `.card.elev-lg`, fixed `top:0; right:0; bottom:0; z-index:61; width:min(640px,100vw)`, `overflow:auto`, `border-radius:0`, `padding:18px 22px`, `gap:12px`, `border-left:1px solid var(--color-neutral-800)`. Header row: id/meta 12 px neutral-400 tabular (`margin-right:auto`) + tags + close `btn btn-icon btn-ghost` with `ph ph-x`. Then `.card-title` with the record title. | Selection state persists in `state` — leaving and returning to the screen re-opens the drawer |
| Drawer section heading | 10.5 px uppercase `letter-spacing:0.08em`, `--color-accent`, `margin-bottom:4px` | |
| Drawer key/value list | rows `display:flex; justify-content:space-between; gap:10px; font-size:12.5px; padding:3px 0; border-bottom:1px solid var(--color-neutral-900)`; key neutral-400; value right-aligned tabular, colour from data | |
| Stepper (NCR, deliverable drawers) | inline-flex wrap 11.5 px; each step = 10 px dot (accent when reached, `--color-neutral-700` otherwise) + label (text colour when reached, neutral-500 otherwise) + 22 × 1 px connector `--color-neutral-800` except after the last | |
| Empty state (inline) | `span` 12.5 px neutral-500, `padding:8px 0` | risks, changes, quality |
| Empty state (panel) | `div` 12.5 px neutral-400, `padding:14px`, centred, `border-radius:var(--radius-md)`, bg `--color-neutral-900` | itp, interfaces, commissioning |
| Zone empty notice | flex, 12.5 px neutral-300, `padding:10px 12px`, radius md, bg neutral-900, icon `ph ph-globe-hemisphere-east` accent, text "No project in this zone for this view" (FR « Aucun projet dans cette zone pour cette vue ») | fleet, sav |

Tag classes (Nocturne): `tag tag-accent` = bg `--color-accent-800` / text `--color-accent-100`; `tag tag-outline` = 1 px `--color-accent` border, accent text; `tag tag-neutral` = bg `--color-neutral-800` / text `--color-neutral-100`. Base `.tag` 11 px, `padding:3px 10px`, radius `calc(var(--radius-md)*0.75)`.

### 1.3 Money formatting (`money(k, signed)`, logic ~3770)
All amounts are stored in **k€** (thousands). EN + EUR: `€120k`, `€4.60M` when |k| ≥ 1000; FR + EUR: `120 k€`, `4,60 M€`; USD prop → `$`. Negative sign is U+2212 `−`; `signed=true` prefixes `+` on positives. Called `f(k, signed)` below.

### 1.4 Mock "today"
Status date is fixed: `statusDate:'25 Sep 2026'`; month-index helper `mIdx(str)` (line 3672) converts `'15 Oct'`, `'13 Dec 2027'` into a fractional month index from Jan 2026 (`(y-2026)*12 + month + (day-1)/30`), and `PG_NOW = 8.97` (≈ 30 Sep 2026) is "now" for interface lateness and warranty-end proximity. Records created from forms are stamped `'30 Sep'` / `'30 Sep 2026'`. Real implementation: use the server date.

### 1.5 i18n
The logic computes everything in English (`renderValsEN`), then `deepTr()` translates every string value (except keys in `SKIP_KEYS` such as `id`, `tagClass`, `color`, `act`, `rev`, `slotId`) via `FR_DICT` / `FR_RULES` when `state.lang==='fr'` (default `lang:'fr'`). Status comparisons must therefore be done on the canonical EN enum values; translation is a display concern. Toast messages are translated segment-by-segment (`showToast`, logic 5116).

### 1.6 Overrides pattern (prototype persistence)
Seed data is immutable; user edits are stored as override maps in component state and merged at render: `riskOv`, `crOv`, `ncrOv`, `dlvOv`, `punchOv`, `ifcOv`, `lessonOv`, `closureOv`; new records go into `state.added.<bucket>` (initial state, logic 3767). Nothing is persisted across reloads (except sidebar open/closed state in `localStorage['keystone-nav-open']`). The real app replaces this with API persistence + optimistic updates.

---

## 2. Screens

### 2.1 Risk register — `risks`

**Purpose.** Project risk register scored on a 5 × 5 probability × impact matrix with Expected Monetary Value (EMV), owner, response strategy (Avoid / Mitigate / Transfer / Accept), trigger and link to a schedule activity. Reviewed weekly with the trend snapshot; open-risk EMV is the exposure compared with the contingency reserve.

**Layout (template 1771–1832)**
1. KPI row (`riskKpis`, 5 tiles).
2. Filter bar: `FL.category` ("Category" / « Catégorie »), chips `riskChips`; right hint "Score = probability × impact (1–5) · EMV = probability × cost impact · reviewed weekly with the snapshot" (FR « Score = probabilité × impact (1–5) · EMV = probabilité × impact coût · revu chaque semaine avec l’instantané »).
3. Flex row `flex-wrap:wrap; gap:14px; align-items:flex-start`:
   * **Register card** `flex:2.4 1 1015px; min-width:0; overflow:auto` — title "Register" (« Registre »), helper "Click a risk to score it and edit its response".
   * **Heat-map card** `flex:1 1 260px; min-width:0`, `gap:10px` — title "Heat map — open risks" (« Carte de chaleur — risques ouverts »), sub "Impact ↑ · probability →".
   On viewports narrower than ≈ 1290 px of content the heat map wraps below the register.
4. Risk drawer (`showRisk`).

**KPI tiles (`riskKpis`, logic 4582)** — `openRisks = risks.filter(status==='Open')`, `rScore = p*i`.

| # | Label (EN / FR) | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Open risks / Risques ouverts | `openRisks.length` | `<n closed> closed` | OK |
| 2 | Critical / high / Critiques / élevés | # open with score ≥ 8 | "Score ≥ 8 on 5×5" | LO if any |
| 3 | Exposure (EMV) / Exposition (EMV) | `f(Σ open emv)` | `<round(emv/PD.recon.cont*100)>% of contingency <f(cont)>` | LO if EMV > 80 % of contingency |
| 4 | On critical path / Sur le chemin critique | # open risks whose linked activity has total float `tf ≤ 0` (`ALL_BYID[act].tf`) | "Risks tied to critical activities" | OK |
| 5 | Trending up / En hausse | # open with `trend==='up'` | "Since last review" | LO if any |

HLT-026 seed values: 7 · 5 · €340k (227 % of €150k, LO) · 2 · 2.

**Chips (`riskChips`, logic 4583).** "All" (count = all risks incl. closed) + one chip per category in **Settings order** `ST.riskCats` (`SETTINGS0.riskCats`: Technical, Supplier / delivery, HSE (safety), Contractual / client, Financial / currency, Regulatory / permits, Resources / skills) **that has at least one risk**. State: `riskFilter` (null = all).

**Register table** (`riskRows`, logic 4579) — rows = risks filtered by category, **sorted by score descending** (stable), closed risks included.

| Column (EN) | Content / format |
|---|---|
| Risk / Risque | id (12 px, 500, accent-300 if selected) over title (`max-width:300px`) |
| Category / Catégorie | `cat`, 12 px neutral-300, nowrap |
| P | probability 1–5, right, tabular |
| I | impact 1–5, right, tabular |
| Score | `p*i`, right, tabular, weight 500 |
| Level / Niveau | tag: `Critical` (score ≥ 15) → `tag-accent`; `High` (≥ 8) → `tag-outline`; `Medium` (≥ 4) / `Low` → `tag-neutral` |
| Response / Réponse | `resp` 12 px neutral-300 |
| Owner / Responsable | full name 12 px nowrap |
| EMV | `f(emv)` or `—` when 0, right, tabular |
| Linked activity / Activité liée | `A1250 · Steel erection — Bays 3–4` (id + `ALL_BYID[id].n`) or `—`; 12 px neutral-400, `max-width:180px`, single-line ellipsis |
| Trend / Tendance | icon 15 px: up `ph ph-trend-up` (LO colour), down `ph ph-trend-down`, flat `ph ph-minus` (neutral-400) |
| Status / Statut | `Open` → `tag-outline`; `Closed` → `tag-neutral` |

Row click → `select()` toggles `state.risk` (same id again closes). Empty: "No risk in this category" (« Aucun risque dans cette catégorie ») when `riskRows` empty.

**Heat map (`matrix`, logic 4580)** — CSS grid, not SVG: `grid-template-columns:18px repeat(5,1fr); gap:4px`. Five rows for impact **5 → 1** (top to bottom); first cell of each row = impact label (11 px neutral-400, centred). Five cells per row for probability 1 → 5: `aspect-ratio:1; border-radius:5px; font-size:10.5px; padding:2px;` centred, tabular, `line-height:1.2`; content = space-separated ids of **open** risks with that exact (p, i). Bottom axis row: empty cell + labels `1…5` (`matrixCols`).
Cell background by `p*i`: ≥ 15 `--color-accent-500`; ≥ 8 `--color-accent-700`; ≥ 4 `--color-accent-900`; else `--color-neutral-900`. Text: `--color-accent-100` when `p*i ≥ 8`, else `--color-neutral-300`.
Legend (template 1812), 11 px neutral-400, 10 × 10 px swatches radius 2: "Critical ≥ 15" (accent-500), "High ≥ 8" (accent-700), "Medium ≥ 4" (accent-900). Low has no legend entry.
HLT seed placement: R-03 at (P4, I4); R-07 and R-12 at (P2, I5); R-11 (P4, I3); R-09 (P3, I3); R-14 (P2, I3); R-15 (P3, I2). R-05 is closed → not plotted.

**Risk drawer (`riskVals`, logic 4586)**

| Element | Content |
|---|---|
| Header | `<id> · <category>`; level tag showing `<Level> · <score>` (e.g. `Critical · 16`); close button |
| Title | risk title |
| Two-column grid `repeat(auto-fit,minmax(160px,1fr))`, gap 12 | **Probability** (« Probabilité ») segmented 1–5 (`pSeg`) and **Impact** segmented 1–5 (`iSeg`). Clicking writes `riskOv[id].p` / `.i` → score, level, tag, heat-map position and table order update immediately |
| Response strategy (« Stratégie de réponse ») | segmented `RESPONSES` = Avoid / Mitigate / Transfer / Accept (FR Éviter / Atténuer / Transférer / Accepter), wraps; writes `riskOv[id].resp` |
| Response plan (« Plan de réponse ») | read-only text `plan`, 13 px, `line-height:1.5` |
| Assessment (« Évaluation ») key/values | Owner · Trigger (« Déclencheur ») · Linked activity · EMV (P × cost impact) = `f(emv)` or `—` · Contingency draw if it occurs (« Tirage sur la provision s’il survient ») = `f(round(emv / (p/5)))` or `—` |
| Actions | `btn btn-secondary` "Open activity" (`ph ph-tree-structure`, only if `act`) → `setState({screen:'plan', sel:act, selOpen:true, risk:null})`; `btn btn-secondary` "What-if levelling" (`ph ph-scales`) → screen `whatif`; `btn btn-ghost` toggle label "Close risk" (« Clore le risque ») when Open / "Reopen" (« Réouvrir ») when Closed → `riskOv[id].status` |

**Data.** `risks = [...state.added.risks (proj===project), ...base]` then merged with `riskOv[id]` (logic 4572).
* `HLT-026`: base = `RISKS_HLT` (8 risks).
* Any other project: `RISKS_HLT.slice(0,4)` re-labelled `R-01…R-04`, `owner = proj.pm`, `act=''`, `emv = round(emv * BAC / 4800)` (scaled to the project budget).
* Contingency reference for KPI 3 = `PD.recon.cont` (HLT: 150 k€; other projects: `DEFS[code].cont`).

**Cross-links.** Open activity → Plan (activity drawer). What-if levelling → `whatif`. Global search hits "Risk" → `{screen:'risks', risk:id}`. Contingency screen uses `openRisks` EMV as "Exposure". Trends screen has a `risk` (EMV) snapshot series. Settings → "Risk categories" list drives chips.

---

### 2.2 Change control & baselines — `changes`

**Purpose.** Register of change requests (CR) affecting budget, scope and/or schedule, each routed through a 4-step approval chain (Project manager → Portfolio director → Client / sponsor → Change control board). Approved CRs revise budget, schedule and WBS; a re-baseline is itself a CR (BL2 via CR-009).

**Layout (template 1833–1882)**
1. KPI row (`crKpis`, 5 tiles).
2. Filter bar: `FL.type` ("Type"), chips `crChips`; right hint "Draft → in review (PM → director → client → change control board) → approved · approved changes revise budget, schedule and WBS" (FR « Brouillon → en revue (CP → directeur → client → comité de contrôle) → approuvée · les modifications approuvées révisent budget, planning et WBS »).
3. Card "Change requests" (« Demandes de modification ») + helper "Click a request for its impact and approval chain".
4. Card "Baselines" (« Références ») + helper "A re-baseline is itself a change request — BL2 becomes current when CR-009 is approved".
5. CR drawer (`showCR`).

**KPI tiles (`crKpis`, logic 4604)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Change requests | `allCRs.length` | `<n> in review · <n> draft` | OK |
| 2 | Approved budget changes / Modifications budgétaires approuvées | `f(Σ amt of Approved, signed)` or `—` | `BL1 <f(PD.recon.orig)> → BAC <f(BAC)>` | OK |
| 3 | Pending value / Montant en attente | `f(Σ amt of In review, signed)` or `—` | "Awaiting director · client · CCB" | LO if > 0 |
| 4 | Schedule changes / Modifications de planning | # CRs whose `types` includes `schedule` | `Net <Σ days of non-rejected CRs> d on handover` | OK |
| 5 | Baseline / Référence | `BL1` (static) | "BL2 proposed · CR-009 draft" (static) | OK |

HLT seed: 5 (1 in review · 1 draft) · +€200k (BL1 €4.60M → BAC €4.80M) · +€85k (LO) · 2 (Net 27 d) · BL1.

**Chips (`crChips`, logic 4602).** All + `CR_TYPES` = `budget` "Budget", `scope` "Scope" (« Périmètre »), `schedule` "Schedule" (« Planning »); count = CRs whose `types` contains the key (a CR can be in several). State: `crFilter`.

**CR table (`crRows`, logic 4599)** — source order (added first, then seed).

| Column | Content / format |
|---|---|
| Request / Demander (sic — dictionary entry is the verb) | id; title (`max-width:320px`); third line `<by> · <date>` 11.5 px neutral-400 |
| Type | types mapped through `CR_TYPES`, joined ` · ` (e.g. `Scope · Budget`) |
| Budget | `f(amt, signed)` or `—`; colour LO if `amt > 0`, else neutral-300 |
| Schedule / Planning | `+12 d` / `-12 d` / `—`; colour LO if > 0 (delay), `--color-accent-300` if < 0 (gain), neutral-400 if 0 |
| WBS | `wbs.join(', ')` 12 px tabular neutral-300 |
| Baseline | `bl` (`BL1` / `BL2`) |
| Approval chain / Chaîne d’approbation | 4 mini-indicators (gap 8): 8 px dot + first word of the step label (`Project`, `Portfolio`, `Client`, `Change`), 11 px neutral-400. Dot: `ok` → `--color-accent`; `rejected` → `--color-neutral-100`; `n/a` → transparent with `box-shadow: inset 0 0 0 1px var(--color-neutral-700)`; `pending` → `--color-neutral-700` |
| Status / Statut | tag: Approved → neutral; Rejected → outline; In review → accent; Draft → outline |
| (actions) | when `status==='Draft'`: `btn btn-primary` "Submit for review" (« Soumettre en revue »), 12 px, `padding:3px 10px`; `stopPropagation`, sets `crOv[id].status='In review'` |

Empty: "No change request of this type" (« Aucune demande de ce type »).

**Baselines table (`blRows`, logic 4605)** — static from `BASELINES`.

| Column | Content |
|---|---|
| Baseline | id, weight 500 tabular |
| Name / Nom | e.g. Proposal estimate, Approved baseline, Recovery re-baseline |
| Set on / Fixée le | date or `Pending CR-009` (neutral-300) |
| BAC | `f(bac)` right |
| Finish / Fin | finish date |
| State / État | tag: `Current` (« Actuel ») → accent; `Proposed` (« Proposée ») → outline; `Superseded` (« Remplacée ») → neutral |

**CR drawer (`crVals`, logic 4607)**

| Element | Content |
|---|---|
| Header | `<id>` + `tag tag-neutral` with types + status tag + close |
| Title | CR title |
| "Raised by <by> · <date>" | 12 px neutral-400 |
| Impact (section) key/values | **Budget**: `f(amt,signed) → BAC f(BAC + (Approved ? 0 : amt))` or `None`, value in LO colour when `amt > 50`; **Schedule**: `+N days on handover` or `None`; **WBS impacted**: each WBS code + summary name from `PD.ACTS` (e.g. `1.4 · Steel structure`), joined ` · `; **Baseline**: `Requires re-baseline → BL2` if `bl==='BL2'` else `Within BL1`; **Contingency**: when `amt > 0` → `Funded from contingency · <round(amt/PD.recon.cont*100)>% of reserve`, else `—` |
| Approval chain (section) | one row per `CHAIN` step: grid `minmax(0,1fr) auto`, `padding:6px 0`, bottom border neutral-900. Left: step label 12.5 px + approver 11 px neutral-400. Right: when actionable → `btn btn-ghost` "Reject" + `btn btn-primary` "Approve" (`ph ph-check`), then state tag: `Approved` (neutral) / `Rejected` (outline) / `Not required` (neutral, for `n/a`) / `Pending` (accent) |
| Hint (11.5 px neutral-400) | Draft: "Submit the request to start the approval chain."; In review and current role not an approver: "Switch to Project manager, Portfolio director or Client (bottom-left) to decide."; otherwise empty |
| Actions | "Submit for review" (`btn-primary`, `ph ph-paper-plane-tilt`, Draft only) · "Open plan" (`ph ph-tree-structure`) → `plan` · "Open budget" (`ph ph-chart-line-up`) → `budget` |

`CHAIN` (logic 4598): `pm` Project manager — Romain Aubert; `director` Portfolio director — Marie Lefebvre; `client` Client / sponsor — Nadia Bensaïd; `ccb` Change control board — "Monthly · next 8 Oct".
A step is actionable when `status==='In review' && chain[k]==='pending' && crRoleKey===k`, where `crRoleKey` = `pm` / `director` / `client` for those roles, `null` otherwise. No role maps to `ccb`. Approve → `crOv[id].chain[k]='ok'`; Reject → `'rejected'`. Steps are not sequential (any pending step whose owner is the current role can act).

> **Rebuild (delivery 8, R-069 — owner answers P-6b, P-6c):** the chain is sequential PM → director → client → change control board: a step is actionable only when every earlier step is approved or not required (`currentStep`, `canDecideStep` in `src/domain/change-control.ts`, one rule for Change control, My approvals and the client portal); a later step answers "Not yours to decide yet". The steps are fixed when the request is submitted: the client step is "Not required" when the request's contractual impact is "None (internal)", the board step when |amount| is not strictly above the Settings threshold (`change.ccbThreshold`, default 50 k€). The board's decision is recorded by the portfolio director (P-6a).

**Derived CR status (logic 4593):** `status = crOv[id].status || (any non-n/a step rejected ? 'Rejected' : all non-n/a steps ok ? 'Approved' : seed status)`.

**Data.** `allCRs = [...state.added.crs (proj===project), ...(HLT ? HLT_CRS_X : [])]`. Non-HLT projects start empty.

**Cross-links.** My approvals inbox (pm/director/client) lists "Change request" items with Approve/Reject/Open; client portal "Awaiting your decision" + decided list; Home "Approvals across the portfolio" links to `CR-008`; notification `n1` "CR-008 awaits your approval" (director, client) → `{screen:'changes', cr:'CR-008'}`; global search "Change request" hits; audit log line `CR-008 status: Draft → In review`. Budget screen shows a separate CR list (`HCRS`) — see Open questions.

---

### 2.3 Quality — NCR & deliverables — `quality`

**Purpose.** ISO 9001 quality control for the project: (a) **non-conformance reports** (NCR) raised from site inspections, goods receipts, surveys and audits, driven through an 8D-style flow to closure (§8.7); (b) **deliverables register** with RACI-B and client acceptance (PV de réception), §8.6.

**Layout (template 1883–1971)**
1. Register switch: `ph ph-eye` + `FL.register` ("Register"), segmented `qSeg`: `ncr` "Non-conformances (NCR)" (« Non-conformités (NCR) ») | `dlv` "Deliverables register (RACI-B)" (« Registre des livrables (RACI-B) »). State `qTab` (default `'ncr'`).
2. When `qIsNcr`: NCR KPIs → severity chips + hint → "Non-conformance log" card → NCR drawer.
3. When `qIsDlv`: deliverable KPIs → status chips + hint → "Deliverables register" card → deliverable drawer.

#### 2.3.a NCR view

**KPI tiles (`ncrKpis`, logic 4622)**, `openNCRs = status !== 'Closed'`:

| # | Label (EN / FR) | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Open NCRs / NCR ouvertes | `openNCRs.length` | `<n Closed> closed this quarter` | LO if any open |
| 2 | Critical / Critique | # open Critical | "Stop-work until containment" | LO if any |
| 3 | Cost of non-quality / Coût de non-qualité | `f(Σ cost of all NCRs)` | "Rework, scrap, re-inspection" | OK |
| 4 | Overdue actions / Actions en retard | # open NCRs whose `due` ∈ {`30 Sep`, `2 Oct`} (hard-coded) | "Corrective action past due date" | OK |
| 5 | From goods receipt / Issues des réceptions | # NCRs with `src==='Goods receipt'` | "Supplier-caused · feeds supplier rating" | OK |

HLT seed: 4 · 1 · €44k · 2 · 3.

**Chips (`ncrChips`)**: `FL.severity` ("Severity") with `ph ph-warning` icon; All + `NCR_SEV` Minor / Major / Critical (FR Mineure / Majeure / Critique). State `ncrFilter`. Hint: "Open → containment → root cause → corrective action → verification → closed · ISO 9001 §8.7".

**NCR log table (`ncrRows`, logic 4620)** — source order. Card title "Non-conformance log" (« Journal des non-conformités »), helper "Raised from site inspections, goods receipts, surveys and audits".

| Column | Content / format |
|---|---|
| NCR | id; title (`max-width:300px`); third line `<raised> · <date>` |
| Severity / Gravité | tag: Critical → accent; Major → outline; Minor → neutral |
| Source | `src` 12 px neutral-300 (Site inspection, Goods receipt, Survey, Workshop, Client, Audit) |
| Linked activity | `A1250 · Steel erection — Bays 3–4` or `—`, ellipsis, `max-width:200px` |
| Owner | name |
| Action due / Action due | `due` |
| Cost / Coût | `f(cost)` or `—`, right |
| Progress / Avancement | 6 segments (one per `NCR_FLOW` step), each 14 × 5 px, radius 2, gap 3; filled `--color-accent` up to and including current step index, else `--color-neutral-800` |
| Status | tag: Closed → neutral; Open → accent; any intermediate step → outline |
| (action) | if not Closed: `btn btn-secondary` "→ <next step>" (e.g. `→ Verification`), `stopPropagation`, advances one step |

Empty: "No non-conformance at this severity".

**NCR drawer (`ncrVals`, logic 4624)**

| Element | Content |
|---|---|
| Header | `<id> · <src>` + severity tag + status tag + close |
| Title | NCR title |
| Stepper | the 6 `NCR_FLOW` steps (Open, Containment, Root cause, Corrective action, Verification, Closed — FR Ouverte, Confinement, Cause racine, Action corrective, Vérification, Clôturée) |
| Severity | segmented Minor / Major / Critical → `ncrOv[id].sev` |
| Root cause (« Cause racine ») | read-only text |
| Containment & corrective action (« Confinement et action corrective ») | read-only text (`action`) |
| Record (« Fiche ») key/values | Raised by `<name> · <date>` · Owner · Source · Linked activity · Part (`part` or `—`) · Deliverable impacted (`deliv` or `—`) · ISO 9001 clause (`iso`, e.g. `8.7 Control of nonconforming outputs`) · Cost of non-quality (`f(cost)` / `—`) · Action due |
| Actions | `btn-primary` "Move to <next>" (`ph ph-arrow-right`, FR « Passer à … ») if not Closed · "Open activity" (`ph ph-tree-structure`) → plan with `sel` · "Part record" (`ph ph-cube`, if `part`) → `{screen:'plm', part, ncr:null}` · ECO button (`ph ph-git-branch`, label = ECO id) when an open ECO (`ecoOpenFor(part)`: first ECO not Released/Rejected listing that part) exists → `{screen:'eco', eco:id}` · `btn-ghost` "8D report" (`ph ph-file-pdf`) — **no handler in prototype** |

Advance logic: `next = NCR_FLOW[min(5, indexOf(status)+1)]`; writes `ncrOv[id].status`.

**Data.** `allNCRs = [...added.ncrs (proj), ...(HLT ? HLT_NCRS : HLT_NCRS.slice(1,3) re-labelled NCR-040, NCR-041 with act/part/deliv cleared)]` merged with `ncrOv`.

#### 2.3.b Deliverables view (RACI-B, PV de réception)

**KPI tiles (`dlvKpis`, logic 4637)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Deliverables / Livrables | count | `<n Accepted> accepted by client` | OK |
| 2 | Awaiting client acceptance / En attente d’acceptation client | # Submitted | "10-day acceptance window" | LO if any |
| 3 | Due in 30 days / Échéance sous 30 jours | # with `due` ∈ {`25 Sep`, `30 Sep`} and not Accepted (hard-coded) | "Not yet accepted" | OK |
| 4 | Without backup (B) / Sans backup (B) | # with empty `raci.B` | "RACI-B complete on every line" (static) | OK |
| 5 | Rejected / Refusé | # Rejected | "Resubmission needed" | LO if any |

HLT seed: 10 (3 accepted) · 2 · 3 · 0 · 0.

**Chips (`dlvChips`)**: `FL.status`; All + `DELIV_FLOW2` (Planned, In progress, Internal review, Submitted, Accepted, Rejected). State `dlvFilter`. Hint: "Planned → in progress → internal review → submitted → accepted by the client · RACI-B: R produces, A signs off, C consulted, I informed, B backup".

**Register table (`dlvRows`, logic 4635)** — card "Deliverables register" (« Registre des livrables »), helper "Types come from Settings · each line is tied to a WBS element".

| Column | Content |
|---|---|
| Deliverable / Livrable | id over title (`max-width:280px`) |
| Type | ellipsis, `max-width:150px` |
| WBS | code, tabular |
| Due / Échéance | date |
| Rev | revision letter or `—` |
| R, A, C, I, B | 26 px circle avatar, bg `--color-neutral-800`, text neutral-200 10 px, initials of the person (`initialsOf`: first letters of each word, max 3); `title` attribute = full name |
| Acceptance / Acceptation | `acc` text (e.g. `12 Mar · N. Bensaïd`, `Accept by 2 Oct`) 12 px neutral-400 |
| Status | tag: Accepted → neutral; Rejected → accent; Submitted → accent; Planned → neutral; In progress / Internal review → outline |
| (actions) | Planned: `btn-secondary` "Start" (« Démarrer ») → In progress · In progress: "To internal review" (« Vers revue interne ») → Internal review · Internal review: `btn-primary` "Submit to client" (`ph ph-paper-plane-tilt`) → Submitted, `acc='Accept by 10 days'` · Submitted **and role === client**: `btn-primary` "Accept" (`ph ph-check`) → Accepted, `acc='25 Sep · N. Bensaïd'` + `btn-ghost` "Reject" → Rejected, `acc='25 Sep · comments issued'`. All stop propagation. |

Empty: "No deliverable in this status".

**Deliverable drawer (`dlvVals`, logic 4639)**

| Element | Content |
|---|---|
| Header | `<id> · <type>` + status tag + close |
| Stepper | first 5 steps of `DELIV_FLOW2` (Planned … Accepted); when status is `Rejected` every dot is grey |
| RACI-B | 5 rows grid `26px minmax(0,1fr) auto`: letter badge 26 px circle bg `--color-accent-900` text `--color-accent-200` 11 px 500; role description (R "Responsible — produces it", A "Accountable — signs it off", C "Consulted", I "Informed", B "Backup — takes over if R is absent"); person name |
| Record | WBS (`1.5 · Crane installation`) · Due · Revision · Acceptance · Linked NCRs (ids of NCRs whose `deliv` = this id, or `None`) · Quality reference "ISO 9001 · 8.6 Release of products and services" |
| Document | `<image-slot id="dlv-<id>" shape="rounded" radius="8" fit="contain">` in a 16:7 box, placeholder "Drop the issued document (PDF preview)" (« Déposer le document émis (aperçu PDF) »). In the real app: file upload/preview linked to the Codex document. |
| Hint | when Submitted and role ≠ client: "Switch to the Client role (bottom-left) to accept or reject." |
| Actions | "Submit to client" (Internal review) · "Accept (PV)" (« Accepter (PV) ») + "Reject with comments" (« Refuser avec commentaires ») when Submitted and role = client · "Open plan" → `plan` |

**Data.** `allDlv = HLT ? HLT_DELIVS : HLT_DELIVS.slice(0,4)` re-labelled `D-110…D-113` with `raci.R = proj.pm`; merged with `dlvOv`. No form to add deliverables.

**Cross-links (quality).** My approvals: quality role gets "NCR verification" items for NCRs in `Verification` (Approve → Closed; Reject → back to Corrective action); client role gets "Deliverable acceptance" items. Client portal decisions (Accept (PV)). Notification `n3` NCR-029 → `{screen:'quality', qTab:'ncr', ncr:'NCR-029'}` for pm/quality/englead. Site daily reports linking to `NCR-…` open the NCR. Procurement "Suppliers" tab counts goods-receipt NCRs per supplier. Stage gate "Mise Service & SAT" requires "SAT — PV de réception signé" (lifecycle spec). Audit log "D-015 status: Submitted → Accepted (PV)".

---

### 2.4 Inspection & test plan · punch list — `itp`

**Purpose.** Per-project ITP (inspection & test plan) built from the machine-type template (`ITP_TEMPLATES[mt]`) — hold / witness / review / surveillance points across Workshop, FAT, Site and SAT — plus the punch list (réserves) categorised A blocking / B before SAT / C cosmetic.

**Layout (template 880–892)**
1. View switch: `ph ph-eye` + `FL.view` ("Display"); segmented `itpSeg`: `plan` "Inspection & test plan" (`ph ph-clipboard-text`) | `punch` "Punch list" (`ph ph-list-checks`). State `itpView` (default `'plan'`). The header primary button changes with the view.
2. KPI row (`itpKpis`, 4 tiles) — shown in both views.
3. `itpIsPlan`: card "Inspection & test plan" with one block per system; or empty panel "No inspection plan for this project yet · pick a template when creating the project".
4. `itpIsPunch`: card "Punch list" + sub "A blocking · B before SAT · C cosmetic".

**KPI tiles (`itpKpis`, logic 4948)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Inspections passed / Inspections réussies | `<n Passed> / <total>` | `<n Failed> failed · NCR raised` | LO if any Failed |
| 2 | Hold points ahead / Points d’arrêt à venir | # type Hold and status ≠ Passed | "client presence required" | OK |
| 3 | Open punch items / Réserves ouvertes | # punch not Closed | `A <n> · B <n> · C <n>` (open only) | LO if any open A |
| 4 | Template / Gabarit | `itpD.tpl` or project machine type or `—` | with ITP: `<n systems> systems · <n> custom lines` (custom = added items + seed `custom`); else "standard template for this machine type" | `--color-neutral-200` |

HLT seed: `3 / 13` (1 failed, LO) · 5 · 4 (A 0 · B 2 · C 2) · EMP (6 systems · 2 custom lines).

**ITP plan (`itpBySys`, logic 4943)** — one group per system of the template that has ≥ 1 item, in template order. Group header: flex, `padding:10px 0 4px`, 10.5 px uppercase `letter-spacing:0.08em` neutral-400: system name + `<passed> / <count>` (tabular, neutral-500, no letter-spacing) + a flex-1 1 px rule `linear-gradient(90deg, var(--color-neutral-800), transparent)`. Then a `.table` (12.5 px) **without header row**:

| Cell | Content |
|---|---|
| id | `I-01`, tabular neutral-400, width 52 px |
| name | inspection / test, `min-width:220px` |
| type tag (10.5 px) | Hold (« Point d’arrêt ») → accent; Witness (« Témoin ») → outline; Review / Surveillance → neutral |
| stage | Workshop / FAT / Site / SAT, 12 px neutral-300 |
| reference | standard (e.g. `ISO 5817 · level B`), 11.5 px neutral-400, ellipsis `max-width:200px` |
| date | planned/actual date |
| status tag | Passed (« Conforme ») → `tag-neutral` + text `--color-accent-300`; Failed (« Non conforme ») → `tag-accent` + text accent-300; Scheduled (« Planifiée ») → outline + neutral-400 text; Planned → outline + neutral-400 text (inline `color` overrides the tag colour) |
| doc | if `doc`: `btn btn-ghost` 11.5 px with `ph ph-file-text` + doc ref → `setState({screen:'docs', dv:{...dv, open:doc}})` (opens the document in Codex) |

HLT groups: Structure 2/4, Hoist mechanisms 0/2, Travel (gantry) 0/1, Electrical HV/LV 1/2, Automation & safety 0/2, Anti-collision 0/2.
Inspection status is **read-only** (no action to record a result).

**Punch list (`punchRows`, logic 4946)** — table 12.5 px:

| Column | Content |
|---|---|
| (id) | `P-01`, tabular neutral-400 |
| Item / Élément | text; colour neutral-500 when Closed |
| System / Système | `loc` (e.g. `Structure · Bay 4`) 12 px neutral-300 |
| Cat. | tag 10.5 px: A → accent; B → outline; C → neutral |
| Raised by / Émise par | source (`src`: Client inspection, ITP I-03, Site walk) |
| Owner | name |
| Due | date |
| Status | Closed → neutral; In progress → outline; Open → accent |
| (action) | not Closed: `btn-secondary` "Start" (Open → In progress) / "Close" (In progress → Closed); writes `punchOv[id]` |

No empty-state message for the punch list.

**Data.** `ITP[project]` (only `HLT-026`), `ITP_TEMPLATES[PROJ_ID[project].mt] || ITP_TEMPLATES.AUTRE`, added `state.added.itp` (id `I-<20+i>`, status Planned, no doc), `PUNCH[project]` + `state.added.punch` (id `P-<10+i>`, category = first letter of the selected option, status Open).

**Cross-links.** Docs (Codex) via doc buttons. Commissioning reads open A punch items (`punchOpen`) for its "Blocking A" column and KPI. Machine types screen (`mtypes`) defines the ITP systems per type. REX lesson LL-03 "Applies to: ITP template EMP".

---

### 2.5 Interface register — `interfaces`

**Purpose.** Trace data owed by the client or third parties (civil works, HV supply, terminal operating system, permits…) against the date Keystone needs it; late inputs cost schedule days and block commissioning.

**Layout (template 893–899):** KPI row (4) → card "Interface register" (« Registre des interfaces ») + sub "Late data from the client or third parties costs schedule days · keep the trace here" → table; empty panel "No interface registered".

**KPI tiles (`ifcKpis`, logic 4956)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Interfaces | count | `<n Frozen> frozen · <n Received> received` | OK |
| 2 | Open / Ouverte | # effective status Open | `<n open with a future need date> due within 30 days` (see Open questions) | OK |
| 3 | Late / En retard | # Late | late ids joined ` · ` or `—` | LO if any |
| 4 | Blocking commissioning / Bloquent la mise en service | # of **IF-02 and IF-05** (hard-coded) not Frozen/Received | "HV cell · anti-collision zones" | LO if either is Open |

HLT seed: 7 (2 frozen · 2 received) · 2 (2 due within 30 days) · 1 (IF-07) · 2.

**Table (`ifcRows`, logic 4955)** — 12.5 px:

| Column | Content |
|---|---|
| (id) | `IF-01` tabular neutral-400 |
| Interface | title, `min-width:200px` |
| Keystone side / Côté Keystone | discipline (Process, Mechanical, Electrical, Automation, Site) |
| Other party / Autre partie | e.g. `Client · civil works`, `Navis · third party`, `DREAL · authority` |
| Data expected / Donnée attendue | 12 px neutral-400 wrap, `max-width:200px` |
| Needed by / Requis pour le | date (tabular) + sub line 11 px: Late → `<n> d late`; Open with known date → `in <n> d`; colour LO when Late, `--color-accent-300` when Open and ≤ 30 days, else text |
| Provided / Fournie le | date or `—` |
| Status | Frozen → neutral; Received → neutral; Late → accent; Open → outline |
| Owner | name |
| (actions) | Open or Late: `btn-secondary` "Mark received" → `ifcOv[id]='Received'`; Received: `btn-primary` "Freeze" (« Geler ») → `'Frozen'` |

Effective status: `st = ifcOv[id] || seed status`; if `st==='Open'` and `mIdx(needed+' 2026') < PG_NOW` → `Late`. `days = round((mIdx(needed) - PG_NOW) * 30)`.

**Data.** `INTERFACES[project]` (HLT only) + `state.added.interfaces` (id `IF-<10+i>`, provided `—`, status Open).

**Cross-links.** Commissioning grid shows `Blocked · IF-02` / `Blocked · IF-05` (static text). Sidebar badge = Late count.

---

### 2.6 Commissioning & handover dossier — `commissioning`

**Purpose.** Track each system through Mechanical completion → Pre-commissioning → Commissioning → SAT → Handover (Mise en service & SAT stage), and the completeness of the handover dossier (DOE: as-built, O&M manuals, spare-parts list, training, CE declarations, SAT reports, warranty certificate, test records).

**Layout (template 910–920)** — when `hasComm`:
1. KPI row (4).
2. Card "Commissioning by system" (« Mise en service par système »): CSS grid `grid-template-columns:200px repeat(5,minmax(130px,1fr)) 90px; gap:6px; min-width:1000px` (card scrolls horizontally). Header row: empty, 5 step labels (10.5 px uppercase `letter-spacing:0.06em` neutral-400, `padding:4px 6px`), "Blocking A" (« Réserves A ») right-aligned. One row per system: name (13 px, `padding:6px`), 5 status cells, punch-A count (13 px tabular neutral-300, right).
3. Card "Handover dossier" (« Dossier de transfert ») table.
Else: empty panel "No commissioning plan yet · systems come from the inspection template".

**Status cell (`cmStatus`, logic 4971)** — seed strings `"<Status> · <date or ref>"`; cell `min-height:40px`, radius md, `padding:6px 8px`, gap 7, 12 px; icon + status + second line 10.5 px opacity .8.

| Status | Background | Border | Text | Icon |
|---|---|---|---|---|
| Done (« Terminé ») | `--color-accent-800` | 1px solid `--color-accent-700` | `--color-accent-100` | `ph ph-check` |
| In progress (« En cours ») | `--color-accent-900` | 1px solid `--color-neutral-800` | `--color-accent-300` | `ph ph-circle-half` |
| Blocked (« Bloquée ») | transparent | 1px **dashed** `--color-accent` | LO | `ph ph-lock-simple` |
| Planned (« Planifié ») | transparent | 1px solid `--color-neutral-800` | `--color-neutral-400` | `ph ph-circle-dashed` |

Steps (FR): Mechanical completion « Fin de montage », Pre-commissioning « Pré-mise en service », Commissioning « Mise en service », SAT, Handover « Livraison ».
"Blocking A" per system = open punch items with category A whose `loc` starts with the system's first word.

**KPI tiles (`cmKpis`, logic 4977)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Systems handed over / Systèmes transférés | `<# rows with Handover Done> / <# systems>` | `SAT planned <row0 SAT date> · handover <row0 Handover date>` | OK |
| 2 | Steps completed / Étapes terminées | `<# Done cells> / <# cells>` | `<# Blocked> blocked by interfaces` | LO if any Blocked |
| 3 | Blocking punch items (A) / Réserves bloquantes (A) | # open A punch items | "must be closed before SAT" | LO if any |
| 4 | Handover dossier / Dossier de transfert | `round((Ready + 0.5 × Partial) / items × 100) %` | `<# Missing> items missing` | LO if any Missing |

HLT seed: 0 / 6 (SAT planned 10 Dec · handover 14 Jan) · 1 / 30 (2 blocked, LO) · 0 · 19 % (4 items missing, LO).

**Handover dossier table (`cmDossier`)**: Item / Élément · Document type (code `MAN`, `LST`, `REC`, `COC`, `RPT`, `CTR`; 12 px tabular neutral-400) · Status tag (Ready → neutral; Partial → outline; Draft → outline; Missing → accent) · doc button (`ph ph-file-text` + ref, opens Codex as in ITP) when a document is linked.

**Interactions.** Grid and dossier are read-only. Primary "Plan SAT" opens a `run` form (§3) that only shows the toast "SAT planned · invitation sent to the client".

**Data.** `COMMISSIONING[project]` (HLT only): `{systems, steps, grid, dossier}`.

**Cross-links.** Punch list (Blocking A), Interfaces (blocked cells reference IF ids), Docs (dossier items), Stage lifecycle "Mise Service & SAT" / "Garantie".

---

### 2.7 Lessons learned & project closure — `rex`

**Purpose.** REX (retour d’expérience) register feeding company templates and procedures, the project closure checklist (final account, retention invoice, as-built, warranty start, archiving, financial close in Sage X3…) and the customer-satisfaction survey (5 criteria).

**Layout (template 921–931)**
1. KPI row (4).
2. Card "Lessons learned" (« Retours d’expérience ») table.
3. Grid `repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:14px; align-items:start` with two cards: "Closure checklist" and "Customer satisfaction".

**KPI tiles (`rexKpis`, logic 5006)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Lessons recorded / REX enregistrés | count | `<n Applied> applied to templates & procedures` | OK |
| 2 | To validate / À valider | # Proposed | "REX workshop · engineering lead + quality" | `--color-accent-300` if any |
| 3 | Closure checklist / Checklist de clôture | `round((Done + 0.5 × In progress) / n × 100) %` or `—` | `<d> done · <p> in progress · <n> not started` | OK |
| 4 | Customer satisfaction / Satisfaction client | `<avg 1 decimal> / 5` or `—` | `lowest · <criterion>` or "survey not received" | LO if avg < 3.5 |

HLT seed: 4 (1 applied) · 1 · 25 % (1 done · 3 in progress · 6 not started) · 4.0 / 5 (lowest · Schedule adherence).

**Lessons table (`llRows`, logic 5000)** — 12.5 px:

| Column | Content |
|---|---|
| (id) | `LL-01` tabular neutral-400 |
| Theme / Thème | `tag tag-neutral` 10.5 px (Engineering, Procurement, Site, Client, Planning, Quality, HSE) |
| What happened / Ce qui s’est passé | `min-width:200px` |
| Impact | 12 px neutral-300, `min-width:140px` |
| Recommendation / Recommandation | `min-width:220px`, neutral-200 |
| Applies to / S’applique à | 12 px neutral-300 |
| Status | Applied (« Appliqué ») → neutral; Validated (« Validé ») → outline; Proposed (« Proposée ») → accent |
| (action) | not Applied: `btn-secondary` "Validate" (Proposed → Validated) / "Mark applied" (Validated → Applied); writes `lessonOv[id]` |

**Closure checklist (`clRows`, logic 5002)** — sub "Click to cycle · not started → in progress → done". Each row is a full-width `button`: grid `20px minmax(0,1fr) auto auto`, gap 10, `padding:7px 4px`, top border neutral-900, 12.5 px, left-aligned, hover bg neutral-900, radius md. Cells: icon 17 px (Done `ph ph-check-square` accent-300; In progress `ph ph-minus-square` accent; Not started `ph ph-square` neutral-500) · item (neutral-500 when Done) · owner 11.5 px neutral-400 · status 11.5 px in the icon colour, `min-width:80px`, right. Click cycles Not started → In progress → Done → Not started, stored in `closureOv[index]`.

**Customer satisfaction (`satRows`, logic 5004)** — header: title + sub "Survey · 5 criteria" + average at right (26 px weight 500 + " / 5" 13 px neutral-400). Rows: grid `minmax(0,1fr) 120px 36px`, gap 10, `padding:6px 0`, top border neutral-900: criterion · 6 px bar (track neutral-800 radius 3, fill `--color-accent`, width `v/5 × 100 %`) · score `x.x` right tabular. Read-only.

**Data.** `LESSONS[project]` + `state.added.lessons` (id `LL-<10+i>`, status Proposed, impact `—` default), `CLOSURE[project]`, `SATISFACTION[project]` (all HLT only). No empty states: non-HLT projects show empty tables/cards and `—` KPIs.

**Cross-links.** Lessons point to templates (ITP template EMP, purchasing procedure, engineering gate checklist, Stakeholder & RACI template) — no navigation. Closure items relate to Billing (retention invoice), Installed base (warranty start), Docs (archiving), Resources (release), Purchase orders.

---

### 2.8 Installed base — `fleet`

**Purpose.** Portfolio-level register of delivered machines (gantry cranes, overhead cranes, rail spur sets…) with warranty dates, open claims, configuration status vs. engineering change orders, and warranty cost — the hand-off from project ("Garantie" stage) to after-sales.

**Zone filter.** `zoneBar` shows above the content (template 130–136): `ph ph-globe-hemisphere-east` + "Zone"; segmented `zoneSeg` = "All zones" + `ZONES` (Europe & North America / Africa / Asia Pacific); on fleet/sav the counts are **machines** per zone (`machineZone`); right side "Zone managers <initial-abbreviated names>" or "Zone manager <name>". State `pfZone` (shared with portfolio screens). Machine zone = `COUNTRY_ZONE[CITY_COUNTRY[<city before ' · ' in site>]]`, fallback zone of the project code, default `euna`. Seed: euna 6, afr 1 (Tanger Med), apac 1 (Perth).

**Layout (template 948–955):** KPI row (4) → zone-empty notice (when a zone has no machine) → card "Installed base" (« Parc installé ») table.

**KPI tiles (`fleetKpis`, logic 4993)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Machines in service / Machines en service | # rows | `<# distinct clients> clients` | OK |
| 2 | In warranty / Sous garantie | # status exactly `In warranty` | `<# status starting "Extended"> extended` | OK |
| 3 | Warranty ending < 90 days / Garantie finissant < 90 j | # rows with `wendSub` | ids joined ` · ` or `—` | LO if any |
| 4 | Machines with open claims / Machines avec réclamations ouvertes | # rows with open claims | "see warranty claims" | OK |

Seed (all zones): 8 (6 clients) · 6 (1 extended) · 1 (MCH-035) · 4.

**Table (`fleetRows`, logic 4985)** — 12.5 px:

| Column | Content |
|---|---|
| (id) | `MCH-041` tabular neutral-400 |
| Machine | name (500) + sub 11 px `<type> · <client> · <gen>` (gen from `AS_MAINT`, may be empty) |
| Status | `In warranty` → neutral; `Extended → <date>` → accent; `Out of warranty` → outline |
| Project / Projet | project code (e.g. `QFR-015`, `—`) 12 px tabular neutral-300 |
| Site | `Le Havre · quay 2` |
| Delivered / Livré | date |
| Warranty end / Fin de garantie | date (tabular) + sub `ends in <n> d` when end is in the future and ≤ 3 months away; both LO in that case |
| Open claims / Réclamations ouvertes | `<n> open` (accent-300) or `—` (neutral-500) |
| Configuration | if the machine is targeted by ECOs: clickable group of tags — `<n> pending` (accent), `<n> retrofit` (outline), `<n> pinned` (neutral), 10.5 px; click → `{screen:'eco', eco:<first ECO id>, part:null, dwg:null}` |
| Warranty cost / Coût garantie | Σ cost of the machine's claims whose coverage ≠ Chargeable, rendered `<n> k€` (literal suffix) |

`machineCfg(mid)` (logic 4197) iterates non-rejected ECOs whose targets (`ecoTargets(e).mchs`, machines in `FLEET` having an affected part in `AS_MAINT[mid].parts`) include the machine: disposition `pinned` → pinned; `retrofit` → retrofit; no disposition and ECO not Released → pending.

**Data.** `fleetAll = [...FLEET, ...state.added.fleet]` (added: id `MCH-<50+i>`, project `—`, status `In warranty`, delivered/warranty from form or `—`). `AS_MAINT` (configuration per machine), `CLAIMS` (+ added).

**Cross-links.** ECO screen (configuration), PLM part drawer "fleet use" list (`fleetUse`, logic 4302) links back to `fleet`; warranty claims screen.

---

### 2.9 Warranty claims & interventions — `sav`

**Purpose.** After-sales (SAV): warranty claims per machine (severity, coverage, cost, next step, link to design ECO), field interventions planning, and warranty vs. chargeable cost per machine.

**Layout (template 956–971)**
1. View switch `FL.view` + `savSeg`: `claims` "Claims" (`ph ph-warning-circle`) | `interventions` "Interventions" (`ph ph-wrench`) | `costs` "Costs per machine" (`ph ph-currency-eur`). State `savView` (default `'claims'`).
2. KPI row (4) — same in all views.
3. Zone-empty notice (when `pfZone` set and no machine in zone).
4. One of three cards.

Zone filter as in §2.8: claims and interventions are kept only for machines in the selected zone (`inFleetZ`).

**KPI tiles (`savKpis`, logic 4992)**

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | Open claims / Réclamations ouvertes | # claims not Closed | `<# Major or Critical> major` | LO if any Major/Critical open |
| 2 | Interventions planned / Interventions planifiées | # Planned | `next · <earliest planned date>` | OK |
| 3 | Warranty cost YTD / Coût garantie cumulé | `f(Σ cost, coverage ≠ Chargeable)` | `<f(Σ Chargeable)> chargeable` | `--color-neutral-200` |
| 4 | Design-related / Liées à la conception | # claims with an ECO | "claims linked to an ECO" | OK |

Seed (all zones): 5 (2 major, LO) · 4 (next · 6 Oct 2026) · €34k (€6k chargeable) · 1.

**Claims table (`claimRows`, logic 4987)** — **open claims first**, then Closed (stable).

| Column | Content |
|---|---|
| (id) | `WC-014` |
| Machine | machine name (neutral-500 when Closed) + sub `<machine id> · <client>` |
| Reported issue / Problème signalé | issue text (`min-width:200px`), plus `tag tag-outline` 10 px with the ECO id when linked |
| Severity | Critical → accent; Major → outline; Minor → neutral (10.5 px) |
| Date | |
| Status | Closed → neutral; Open → accent; Diagnosed / Intervention planned → outline |
| Coverage / Couverture | Chargeable (« Facturable ») → outline; Warranty / Extended warranty → neutral |
| Cost | `f(cost)` or `—`, right |
| Owner | |
| Next step / Prochaine étape | 11.5 px neutral-400, `max-width:220px` |

No row click, no transitions in the prototype.

**Interventions table (`ivRows`, logic 4988)**: (id) · Machine (name + `<id> · <site>`) · Date · Technician / Technicien · column headed "Project" showing the intervention **type** (e.g. `Corrective · WC-015`) · Duration / Durée · Status (Done → neutral; Planned → outline).

**Costs per machine (`savCostRows`, logic 4989)** — only machines with ≥ 1 claim: (id) · Machine (name 500 + `<client> · <status>`) · Claims count · Warranty cost `f(Σ non-chargeable)` right · Chargeable `f(Σ chargeable)` right neutral-400 · bar cell width 160 px: 6 px bar, track neutral-800, fill accent, width `min(100, warrantyCost / 25 × 100) %` (25 k€ = full bar).

**Data.** `CLAIMS` + `state.added.claims` (id `WC-<20+i>`, machine id = part before ` · ` of the selected option, date `30 Sep 2026`, status Open, cost 0, next = description or `—`), `INTERVENTIONS`, `fleetAll`.

**Cross-links.** Installed base; ECO screen (claims linked to ECO via the outline tag — not clickable); notification/approvals: none.

---

## 3. Action forms (`AF` — page-level primary buttons) for these modules

Generic dialog (template 138–158, logic 5110–5135): `.dialog-backdrop` (z 50, `align-items:start; padding-top:8vh`) + `.dialog` `width:min(640px,100%)`, `gap:14px`, `max-height:84vh`, scroll. Header: `.dialog-title` = form title; sub `"<project name> · Required fields are marked · *"` (accent asterisk); close icon button. Body: 2-column grid `repeat(2,minmax(0,1fr))`, gap 12; full-width (`grid-column:1 / -1`) for textareas and fields with id `title`, `name`, `progress`, `reason`, `why`. Field types: `text` → `.input`; `number` → `.input type=number` tabular; `textarea` → rows 3, `min-height:72px`, vertical resize; `select` → `.input` select. Footer: "Cancel" (secondary) + submit (`btn-primary`, icon `ph ph-check` for `create`, `ph ph-play` for `run`), disabled while invalid.

* **Defaults**: array option lists default to their first element; dynamic lists (`TEAM`, `ACT`, `RCAT`, `ITPSYS`, `FLEET`…) default to `''` and display/submit the first option.
* **Validation (`afValid`)**: every field flagged required (5th tuple element `1`) must be non-blank; selects always pass. No numeric validation beyond clamping noted below.
* **Submit (`afSubmit`)**: appends the record, closes the dialog, toast (4 s auto-dismiss, bottom-right card with `ph ph-check-circle`, z 80).

Dynamic option sources (`afOpts`, logic 5117): `TEAM` = `DEFS[project].team` or all `PEOPLE` names; `ACT` = first 12 activities with an id from `PD.ACTS` as `A1010 · Detailed design`; `RCAT` = distinct `RISKS_HLT` categories; `ITPSYS` = `ITP_TEMPLATES[project machine type]` (fallback AUTRE); `FLEET` = `FLEET` as `MCH-041 · Gantry crane 45 t — quay 2` (seed only).

| Key | Title (EN / FR) | Submit label | Kind | Fields (id · label · type · default · required) | On submit | Toast |
|---|---|---|---|---|---|---|
| `risks` | New risk / Nouveau risque | Register risk | create | title · Title · text · – · **req**; cat · Category · select RCAT; p · Probability (1–5) · number · 3; i · Impact (1–5) · number · 3; owner · Owner · select TEAM; resp · Response · select [Mitigate, Accept, Transfer, Avoid]; emv · EMV (k€) · number · ''; plan · Response plan · textarea | `added.risks` prepend `{id:'R-'+pad2(20+n+1), p,i clamped 1–5 (default 3), emv int or 0, plan or '—', act:'', trig:'—', status:'Open', trend:'flat', proj}` (n = total added risks, all projects) | `R-21 · Risk registered` |
| `changes` | New change request | Submit for review | create | title · Title · **req**; type · Type · select [Scope, Budget, Schedule, Scope + budget]; amt · Amount (k€) · number · 0; days · Delay (days) · number · 0; wbs · WBS · text · `1.3`; why · Justification · textarea · **req** | `added.crs` prepend `{id:'CR-0'+(10+n+1), types (Scope + budget → [scope,budget]), amt, days, wbs:[wbs or '1'], status:'In review', by: persona short name (e.g. R. Aubert), date:'30 Sep', chain all pending, bl:'BL1', proj}` — `why` is **not stored** | `CR-011 · Change request submitted for review` |
| `quality` | New NCR / Nouvelle NCR | Raise NCR | create | title · **req**; sev · Severity · [Minor, Major, Critical]; src · Source · [Site inspection, Goods receipt, Workshop, Client, Audit]; act · Activity · select ACT; part · Part · text; owner · Owner · TEAM; desc · Description · textarea | `added.ncrs` prepend `{id:'NCR-0'+(30+n+1), act: id part of selection, raised: persona full name, date:'30 Sep', status:'Open', root:'—', action: desc or '—', due:'—', cost:0, deliv:'', iso:'8.7 Control of nonconforming outputs', proj}` | `NCR-031 · NCR raised` |
| `itp` | Add inspection | Add to plan | create | name · Inspection / test · **req**; system · System · ITPSYS; type · Type · [Hold, Witness, Review, Surveillance]; stage · Stage · [Workshop, FAT, Site, SAT]; ref · Standard / reference; date · Planned date | `added.itp` append (generic record + `proj`, `date2`) → rendered as `['I-'+(20+i), system, name, type, stage, ref, date, 'Planned', '']` | Inspection added to the plan |
| `punch` | Add punch item | Add item | create | item · Item · **req**; loc · System / location; cat · Category · [A — blocking, B — before SAT, C — cosmetic]; src · Source · [Site walk, Client inspection, ITP, SAT]; owner · TEAM; due · Due | `added.punch` → `['P-'+(10+i), item, loc, cat[0], src, owner, due, 'Open']` | Punch item added |
| `interfaces` | New interface | Register | create | title · Interface · **req**; a · Keystone side · [Process, Mechanical, Electrical, Automation, Site]; b · Other party · **req**; data · Data expected · **req**; needed · Needed by · **req**; owner · TEAM | `added.interfaces` → `['IF-'+(10+i), title, a, b, data, needed, '—', 'Open', owner]` | Interface registered |
| `commissioning` | Plan SAT | Plan & invite | run | system · System · ITPSYS; date · Date · `10 Dec 2026` · **req**; client · Client witnesses · `N. Bensaïd, K. Doucouré`; note · Prerequisites · textarea · `Punch A items closed · pre-commissioning reports issued` | nothing stored | SAT planned · invitation sent to the client |
| `rex` | Add lesson learned | Record | create | theme · Theme · [Engineering, Procurement, Site, Client, Planning, Quality, HSE]; what · What happened · textarea **req**; impact · Impact · text; reco · Recommendation · textarea **req**; apply · Applies to · [WBS template, ITP template, Purchasing procedure, Engineering gate checklist, Stakeholder & RACI template, Other] | `added.lessons` → `['LL-'+(10+i), theme, what, impact or '—', reco, apply, 'Proposed']` | Lesson recorded · to be validated |
| `fleet` | Add machine | Add machine | create | name · Machine · **req**; type · Type · [EMP, MEMU, SPUR, AUTRE]; client · Client · **req**; site · Site; delivered · Delivered; warranty · Warranty end | `added.fleet` → `['MCH-'+(50+i), type, name, client, site, '—', delivered or '—', warranty or '—', 'In warranty']` | Machine added to the installed base |
| `sav` | New warranty claim | Open claim | create | machine · Machine · FLEET; issue · Issue · **req**; sev · Severity · [Minor, Major, Critical]; cover · Coverage · [Warranty, Extended warranty, Chargeable]; owner · Owner · [T. Kerbrat, C. Morvan, S. Haddad, J. Wagner]; desc · Description · textarea | `added.claims` → `['WC-'+(20+i), machineId, issue, sev, '30 Sep 2026', 'Open', cover, 0, '', owner, desc or '—']` | Warranty claim opened |

Generic-bucket records (`itp`, `punch`, `interfaces`, `rex`, `fleet`, `sav`) carry every form field plus `proj` and `date2:'30 Sep 2026'`; ids are generated at render time from the bucket index (per project for project-scoped buckets).

---

## 4. Data entities (field level)

Units: amounts in k€ unless stated; dates are display strings in the prototype (`'14 May'`, `'13 Dec 2027'`) — store ISO dates in the real app.

### 4.1 Risk (`RISKS_HLT`, line 3487; added via `risks` form)
| Field | Type | Example | Notes |
|---|---|---|---|
| id | string | `R-03` | |
| title | string | `Steel delivery slips further (mill capacity)` | |
| cat | enum (Settings `riskCats`) | `Supplier / delivery` | Technical, Supplier / delivery, HSE (safety), Contractual / client, Financial / currency, Regulatory / permits, Resources / skills |
| p | int 1–5 | 4 | probability |
| i | int 1–5 | 4 | impact |
| owner | person name | `Fabien Bertrand` | |
| resp | enum `RESPONSES` | `Mitigate` | Avoid, Mitigate, Transfer, Accept |
| plan | text | `Second mill qualified · buffer stock 48 columns at Le Havre` | |
| act | activity id or '' | `A1250` | |
| emv | number k€ | 120 | stored (not recomputed) |
| trig | text | `Mill confirms > 2 weeks delay` | trigger |
| status | `Open` \| `Closed` | | |
| trend | `up` \| `flat` \| `down` | | since last review |
| proj | project code | `HLT-026` | added records only |
Derived: `score = p × i`; `level` = Critical ≥ 15, High ≥ 8, Medium ≥ 4, else Low; `costIfOccurs = round(emv / (p/5))`.

### 4.2 Change request (`HLT_CRS_X`, line 3498; `CR_TYPES` line 3497)
| Field | Type | Example |
|---|---|---|
| id | string | `CR-008` |
| title | string | `Second steel crew — schedule recovery` |
| types | array of `budget`\|`scope`\|`schedule` | `['budget','schedule']` |
| amt | number k€ (signed) | 85 |
| days | int (signed; + = delay on handover) | −12 |
| wbs | string[] | `['1.4']` |
| status | `Draft` \| `In review` \| `Approved` \| `Rejected` | |
| by | string | `R. Aubert` / `Steering committee` |
| date | string | `24 Sep` |
| chain | `{pm, director, client, ccb}` each `ok`\|`pending`\|`rejected`\|`n/a` | `{pm:'ok',director:'pending',…}` |
| bl | `BL1` \| `BL2` | baseline the CR belongs to |
| proj | code | added records |

### 4.3 Baseline (`BASELINES`, line 3504) — tuple `[id, name, setOn, bac(k€), finish, state]`
`['BL1','Approved baseline','12 Mar 2026',4600,'18 Dec 2026','Current']`; state ∈ `Current`, `Proposed`, `Superseded`.

### 4.4 NCR (`HLT_NCRS`, line 3507; `NCR_SEV`, `NCR_FLOW`)
| Field | Type | Example |
|---|---|---|
| id | string | `NCR-029` |
| title | string | `Foundation bolt pattern 12 mm off at Bay 7` |
| sev | `Minor`\|`Major`\|`Critical` | `Critical` |
| src | `Site inspection`\|`Goods receipt`\|`Survey`\|`Workshop`\|`Client`\|`Audit` | `Survey` |
| act | activity id | `A1230` |
| part | PLM part ref or '' | `KS-STL-0450` |
| raised | person | `Thomas Kerbrat` |
| date | string | `24 Sep` |
| owner | person | `Julien Wagner` |
| status | `NCR_FLOW` value | `Root cause` |
| root | text | `Setting-out template rotated · check not signed` |
| action | text (containment & corrective action) | |
| due | string | `30 Sep` |
| cost | number k€ | 28 |
| deliv | deliverable id or '' | `D-015` |
| iso | text | `8.7 Control of nonconforming outputs` (also 8.4, 8.5.6) |

### 4.5 Deliverable (`HLT_DELIVS`, line 3515; `DELIV_TYPES`, `DELIV_FLOW2`)
| Field | Type | Example |
|---|---|---|
| id | string | `D-021` |
| title | string | `Client acceptance — PV de réception provisoire` |
| type | `DELIV_TYPES` | Drawings, Calculation notes, Specifications, Test & inspection reports, Certificates (CE, lifting…), Manuals / as-built, Meeting minutes, Client acceptance (PV de réception) |
| wbs | string | `1.8` |
| due | string | `14 Jan` |
| status | `DELIV_FLOW2` | Planned, In progress, Internal review, Submitted, Accepted, Rejected |
| raci | `{R,A,C,I,B}` person names | `{R:'Romain Aubert',A:'Marie Lefebvre',…}` |
| rev | string | `C` / `—` |
| acc | string (acceptance info) | `12 Mar · N. Bensaïd`, `Accept by 2 Oct` |
(Also `DELIVERABLES` line 3464 — a 4-row summary tuple list used elsewhere.)

### 4.6 ITP (`ITP_TEMPLATES`, `ITP`, lines 3716–3717)
* `ITP_TEMPLATES`: `{EMP:[Structure, Hoist mechanisms, Travel (gantry), Electrical HV/LV, Automation & safety, Anti-collision], MEMU:[Structure, Hoist, Travel, Electrical, Automation], SPUR:[Track, Switches, Signalling, Electrical], AUTRE:[General], 'R&D':[Prototype]}`.
* `ITP[code] = {tpl:'EMP', custom:2, items:[…]}`; item tuple `[id, system, name, type, stage, ref, date, status, docRef]`, e.g. `['I-03','Structure','Paint thickness (DFT)','Surveillance','Workshop','ISO 12944 · C5','24 Sep','Failed','NCR-HLT-031']`. type ∈ Hold, Witness, Review, Surveillance; stage ∈ Workshop, FAT, Site, SAT; status ∈ Planned, Scheduled, Passed, Failed.

### 4.7 Punch item (`PUNCH`, line 3718)
Tuple `[id, item, loc, cat, src, owner, due, status]`, e.g. `['P-04','Handrail height 1.05 m instead of 1.10 m — walkway','Structure · access','B','Client inspection','L. Fabre','20 Oct','In progress']`; cat ∈ A, B, C; status ∈ Open, In progress, Closed. (A separate `SITE_PUNCH`, line 3581, feeds the Site screen.)

### 4.8 Interface (`INTERFACES`, line 3719)
Tuple `[id, title, keystoneSide, otherParty, dataExpected, neededBy, provided, status, owner]`, e.g. `['IF-02','HV supply — port substation cell','Electrical','Client · port authority','Cell availability date + protection settings','15 Oct','—','Open','S. Haddad']`; status ∈ Open, Received, Frozen, Late (Late also derived).

### 4.9 Commissioning (`COMMISSIONING`, line 3721)
`{systems:string[], steps:['Mechanical completion','Pre-commissioning','Commissioning','SAT','Handover'], grid:{[system]: string[5] like 'Done · 12 Sep' | 'In progress' | 'Planned · 20 Oct' | 'Blocked · IF-02'}, dossier:[[item, docTypeCode, docRef, status]]}`; dossier status ∈ Ready, Partial, Draft, Missing. Real model: one record per (system, step) with status enum + date + blocking reference.

### 4.10 Lessons, closure, satisfaction (lines 3732–3734)
* Lesson tuple `[id, theme, what, impact, reco, appliesTo, status]`; status ∈ Proposed, Validated, Applied.
* Closure item `[item, owner, status]`; status ∈ Not started, In progress, Done.
* Satisfaction `[criterion, score 0–5 (0.5 steps)]` — 5 criteria: Communication, Quality of deliverables, Schedule adherence, Change management, Site safety.

### 4.11 Machine (`FLEET`, line 3729) and configuration (`AS_MAINT`, line 3722)
* Tuple `[id, machineType, name, client, site, projectCode, delivered, warrantyEnd, status]`, e.g. `['MCH-022','EMP','Gantry crane 32 t','Retail BU','Marseille · logistics','—','5 Jun 2023','4 Jun 2025','Extended → 4 Jun 2027']`; status ∈ `In warranty`, `Out of warranty`, `Extended → <date>`.
* `AS_MAINT[machineId] = {gen:'Gen 1'|'Gen 2', parts:{partRef: revisionLetter}}` (as-maintained configuration, used by ECO targeting and PLM "fleet use").

### 4.12 Warranty claim (`CLAIMS`, line 3730)
Tuple `[id, machineId, issue, severity, date, status, coverage, cost(k€), ecoId, owner, nextStep]`, e.g. `['WC-013','MCH-041','Anti-collision false alarms in fog','Major','28 Aug 2026','Open','Warranty',12,'ECO-031','C. Morvan','Firmware update + lidar filter · ECO in approval']`; severity ∈ Minor, Major, Critical; status ∈ Open, Diagnosed, Intervention planned, Closed; coverage ∈ Warranty, Extended warranty, Chargeable.

### 4.13 Intervention (`INTERVENTIONS`, line 3731)
Tuple `[id, machineId, date, technician, type, duration, status]`, e.g. `['IV-082','MCH-041','8 Oct 2026','T. Kerbrat + J. Wagner','Corrective · WC-014','2 days','Planned']`; status ∈ Planned, Done.

### 4.14 REX financial patterns (`REX_FIN`, line 3101)
`{[machineType]: {dep:%, deliv:%, acc:%, refs:[[analyticCode, name, year, patternText]]}}`, e.g. `EMP:{dep:30, deliv:60, acc:10, refs:[['HAV001','Terminal Ouest — Dunkerque','2023','29 % deposits · peak M8 · 8 % at SAT'], …]}`. Used by the **Budget** cost profile (`rexCat`, logic 3829: "REX EMP · 2 reference projects · pattern 30 / 60 / 10") and by **Machine types** (`MT_ALL` dep/deliv/acc/refs). Not displayed on the `rex` screen.

### 4.15 Supporting constants
`RESPONSES` (3496), `CR_TYPES` (3497), `NCR_SEV` (3505), `NCR_FLOW` (3506), `DELIV_TYPES` (3513), `DELIV_FLOW2` (3514), `SETTINGS0.riskCats` / `.delivTypes` (3467), `ZONES` / `COUNTRY_ZONE` / `CITY_COUNTRY` (3170–3175), `PERSONAS` (3747), `ROLE_SCREENS` (3465), `AF` / `AF_RESULT` (3674–3701), `NOTIFS` (3545), `AUDIT` (3572), `HLT_PD.recon` (`orig:4600, chg:200, crCount:3, pending:85, cont:150, contUsed:208`, line 3308).

### 4.16 UI state keys (component `state`, logic 3767–3774)
`risk`, `riskFilter`, `riskOv{id:{p,i,resp,status}}` · `cr`, `crFilter`, `crOv{id:{status, chain:{…}}}` · `qTab` (`ncr`|`dlv`), `ncr`, `ncrFilter`, `ncrOv{id:{status,sev}}`, `dlv`, `dlvFilter`, `dlvOv{id:{status,acc}}` · `itpView` (`plan`|`punch`), `punchOv{id:status}` · `ifcOv{id:status}` · `lessonOv{id:status}`, `closureOv{index:status}` · `savView` (`claims`|`interventions`|`costs`) · `pfZone` · `added.{risks,crs,ncrs,itp,punch,interfaces,lessons,fleet,claims}` · `af{open,key,values}` · `toast` · `role`, `project`, `lang`.

---

## 5. Status machines / workflows

| Object | States | Transitions (who / trigger) |
|---|---|---|
| Risk | Open ⇄ Closed | Any user: drawer "Close risk" / "Reopen". Level is derived from P × I (Critical ≥ 15 / High ≥ 8 / Medium ≥ 4 / Low). |
| Change request | Draft → In review → Approved \| Rejected | Draft → In review: "Submit for review" (row or drawer; new CRs are created directly In review). In review: per-step decision by the matching role — pm (Project manager), director (Portfolio director), client (Client / sponsor); CCB step has no actor. Status auto-derives: any rejected step → Rejected; all non-`n/a` steps ok → Approved. Decisions also possible from My approvals and the client portal. |
| CR approval step | pending → ok \| rejected; `n/a` fixed | as above |
| Baseline | Proposed → Current → Superseded | Static in prototype (intended: BL2 becomes Current when CR-009 is approved). |
| NCR (`NCR_FLOW`) | Open → Containment → Root cause → Corrective action → Verification → Closed | Any user: "→ <next>" (row) / "Move to <next>" (drawer), one step at a time. Quality role in My approvals: Verification → Closed (approve) or → Corrective action (reject). Severity editable any time (Minor/Major/Critical). |
| Deliverable (`DELIV_FLOW2`) | Planned → In progress → Internal review → Submitted → Accepted \| Rejected | Start / To internal review / Submit to client: any user. Accept (PV) / Reject (with comments): **client role only** (register row, drawer, My approvals, client portal). Rejected is terminal in the prototype. |
| ITP inspection | Planned / Scheduled / Passed / Failed | No transitions in UI (seed data only). Failed is expected to raise an NCR. |
| Punch item | Open → In progress → Closed | Any user: "Start", "Close". |
| Interface | Open → (Late, derived when needed date < today) → Received → Frozen | "Mark received" (Open or Late), "Freeze" (Received). |
| Commissioning step | Planned / In progress / Done / Blocked | Static. |
| Handover dossier item | Missing / Draft / Partial / Ready | Static. |
| Lesson learned | Proposed → Validated → Applied | "Validate", "Mark applied" (any user; KPI hint: REX workshop · engineering lead + quality). |
| Closure checklist item | Not started → In progress → Done → (Not started) | Click cycles. |
| Warranty claim | Open / Diagnosed / Intervention planned / Closed | Static; new claims Open. |
| Intervention | Planned / Done | Static. |
| Machine warranty | In warranty / Extended → date / Out of warranty | Static; "ending < 90 days" derived. |
| 8D / PV de réception | – | 8D: only a dead "8D report" button on the NCR drawer and the NCR-028 root cause text "supplier 8D requested"; Settings import/export lists "Export — PDF: Status report, PO, goods receipt, 8D, PV de réception". PV de réception = acceptance of deliverables ("Accept (PV)"), deliverable type "Client acceptance (PV de réception)" (D-021 "PV de réception provisoire"), stage-gate deliverable "SAT — PV de réception signé". |

---

## 6. Cross-links

| From | To | Mechanism |
|---|---|---|
| Risk drawer "Open activity" / NCR drawer "Open activity" | `plan` | `{screen:'plan', sel:<act>, selOpen:true}` + closes drawer |
| Risk drawer "What-if levelling" | `whatif` | `goTo('whatif')` |
| CR drawer "Open plan" / "Open budget" | `plan` / `budget` | `goTo` |
| Deliverable drawer "Open plan" | `plan` | `goTo` |
| NCR drawer "Part record" | `plm` | `{screen:'plm', part}` |
| NCR drawer ECO button / Fleet "Configuration" | `eco` | `{screen:'eco', eco:id}` |
| ITP doc button / Commissioning dossier doc button | `docs` (Codex) | `{screen:'docs', dv:{...dv, open:docRef}}` |
| Global search (header) | risks / changes / quality | hits "Risk" `{risk}`, "Change request" `{cr}`, "NCR" `{qTab:'ncr', ncr}` (current project) |
| Notifications | changes (`n1` CR-008), quality (`n3` NCR-029) | `{screen, ...extra}` |
| My approvals | changes, quality | CR items (pm/director/client), Deliverable acceptance (client), NCR verification (quality) — inline approve/reject + open |
| Client portal (`client`) | CR + deliverables | "Awaiting your decision" KPI, decision list (Approve / Accept (PV)), decided list |
| Home (director) | changes | "Change requests pending" row → `CR-008` |
| Site daily reports | quality | report links starting with `NCR` → `{qTab:'ncr', ncr}` |
| Contingency | risks | "Exposure (open risks EMV)" uses `openRisks` EMV; draw-downs reference CR-004, R-03, NCR-026 (text) |
| Procurement / suppliers | quality | goods-receipt NCR count per supplier and in KPI |
| Commissioning | itp (punch), interfaces | Blocking A count; blocked cells cite IF-02 / IF-05 |
| PLM part drawer "fleet use" | fleet / eco | machine rows open ECO or `fleet` |
| Budget cost profile, Machine types | `REX_FIN` | payment-term pattern by machine type |
| Settings | risks, quality | "Risk categories" list drives risk chips; "Deliverable types" list (not used by logic) |
| Trends | risks | weekly `risk` (EMV) snapshot series |

---

## 7. Open questions

1. **CR status stuck after submit (likely bug).** Submitting a Draft writes `crOv[id].status='In review'`, and `status = crOv.status || derived`, so a submitted CR (e.g. CR-009) never becomes Approved/Rejected even when all steps are decided. Expected behaviour: derive status from the chain once In review.
2. **CCB step has no actor.** No role maps to `ccb`, so any CR with a pending CCB step (CR-008, CR-009, new CRs) can never reach Approved. Who records the Change control board decision (monthly meeting, next 8 Oct)?
3. **Sequential or parallel CR approval?** The hint text implies PM → director → client → CCB, but any pending step can be decided in any order. — *Answered (P-6b, P-6c; built in delivery 8, R-069): sequential, client step only for a contractual change, board only above the Settings threshold.*
4. **EMV vs probability.** EMV is stored and not recomputed when P is changed in the drawer, while "Contingency draw if it occurs" = EMV / (P/5) changes inversely. Should cost impact be the stored field and EMV derived (= cost × P/5)?
5. **Hard-coded dates.** NCR "Overdue actions" uses `due ∈ {30 Sep, 2 Oct}`; deliverable "Due in 30 days" uses `due ∈ {25 Sep, 30 Sep}`; acceptance stamps `25 Sep · N. Bensaïd`; created records `30 Sep`; `PG_NOW = 8.97`. All must be computed from the real current date and current user.
6. **Interfaces "due within 30 days"** counts every Open interface with a future date (IF-05 is 45 days away). Intended filter is presumably ≤ 30 days.
7. **Interventions table header "Project"** displays the intervention type (`Corrective · WC-015`). Rename to "Type", or add a project column?
8. **NCR content editing.** Root cause, corrective action, due date, cost and owner are read-only; the "8D report" button has no handler. Is an 8D form/report (D1–D8) expected, and what does it export?
9. **Deliverable rejection loop.** Rejected has no follow-up action (resubmit / new revision). Expected: back to In progress with revision increment?
10. **Interface "Mark received"** does not fill the Provided date; should it stamp today?
11. **Commissioning is static** (grid, dossier, Plan SAT form stores nothing). Which steps are editable, by whom, and should statuses derive from ITP results / interfaces / punch list?
12. **ITP results cannot be recorded**; Failed inspections reference a document `NCR-HLT-031` that does not match the NCR id scheme (`NCR-0xx`). Should recording a Failed result auto-create an NCR?
13. **Override keys are not project-scoped** (`riskOv`, `ncrOv`, `dlvOv`, `punchOv`, `ifcOv`, `lessonOv` by id; `closureOv` by row index). Non-HLT projects reuse ids (R-01…, NCR-040/041, D-110…), so edits leak across projects. Real app: per-record persistence.
14. **Read-only enforcement.** Inline actions (advance, submit, approve, freeze, cycle checklist…) are not disabled when `projReadOnly` or `outside`; only the header primary button is hidden. Confirm intended permissions per role.
15. **Role visibility of new modules.** `ROLE_SCREENS` grants itp, interfaces, commissioning, rex, fleet and sav to the director only; PM, quality, englead and procurement reach them only as "outside my workspace". Intended?
16. **Duplicate datasets.** Budget screen CRs (`HCRS`: CR-005 exists, CR-007 title "MEP routing rework…", CR-008 −18 d) differ from change control (`HLT_CRS_X`: CR-007 "Yard drainage re-routing", CR-008 −12 d, CR-009). Site punch (`SITE_PUNCH`, P-01 Open) differs from ITP punch (`PUNCH`, P-01 Closed). A single source of truth is needed.
17. **CR form** "Justification" (required) is not stored; WBS is free text; type "Scope + budget" is the only combination offered.
18. **Baselines are static**; the BL2 → Current switch on CR-009 approval and the "Baseline" KPI (`BL1`, "BL2 proposed · CR-009 draft") are hard-coded.
19. **Quality primary button** is "New NCR" on both tabs; there is no way to add a deliverable. Settings "Deliverable types" is not used by the register.
20. **Fleet / SAV.** The claim form's machine list contains seed machines only (not added ones); added machines get project `—`; the fleet "Warranty cost" column appends a literal `k€` regardless of currency/lang; claims have no drawer or status transitions; ECO tags in claims are not clickable.
21. **Risk categories.** Chips come from Settings (`ST.riskCats`) but the form's category list comes from seed risks (`RCAT`); a category removed in Settings hides its chip while its risks remain.
22. **Added-record numbering** is global across projects for risks (`R-21`…), CRs (`CR-011`…) and NCRs (`NCR-031`…), but per project for ITP/punch/interfaces/lessons. Define the real numbering scheme (per project? prefixed with project id?).
23. **NCR KPI "closed this quarter"** counts all closed NCRs regardless of date; "From goods receipt" sub says "feeds supplier rating" but supplier grades are static.
24. **REX empty states.** Non-HLT projects show empty lessons/closure/satisfaction cards without an empty-state message; KPI shows "survey not received".

---

## Addendum (completeness pass)

### A.1 Flag index (identifiers not named above)

| Flag | Template lines | Logic (render-values line) | Meaning / EN text | FR text |
|---|---|---|---|---|
| `noItp` | 885 | `!itpRows.length` (5202) | ITP plan view empty: "No inspection plan for this project yet · pick a template when creating the project" | "Pas encore de plan d’inspection · choisissez un gabarit à la création du projet" |
| `noIfc` | 896 | `!ifcRows.length` (5203) | Interface register empty: "No interface registered" | "Aucune interface enregistrée" |
| `zoneEmptyFleet` | 951 | `!!pfZone && !fleetRows.length` (5211) | Installed base, zone filter set and no machine in that zone: icon `ph-globe-hemisphere-east` + `zoneEmptyText` "No project in this zone for this view" | "Aucun projet dans cette zone pour cette vue" |
| `zoneEmptySav` | 960 | `!!pfZone && !fleetRows.length` (5211). **It tests the machine list (`fleetRows`), not the claims list.** | Warranty claims & interventions: same notice and text as above | same |
| `noRisks` | 1799 | `!riskRows.length` (5218) | "No risk in this category" | "Aucun risque dans cette catégorie" |
| `noCRRows` | 1857 | `!crRows.length` (5219) | "No change request of this type" | "Aucune demande de ce type" |
| `noNcr` | 1910 | `!ncrRows.length` (5216) | "No non-conformance at this severity" | "Aucune non-conformité de cette gravité" |
| `showNcr` | 1912–1924 | `!!ncrVals` (5216); close `closeNcr` → `setState({ncr:null})` | NCR drawer (§2.3.a) | — |
| `noDlv` | 1953 | `!dlvRows.length` (5216) | "No deliverable in this status" | "Aucun livrable dans ce statut" |
| `showDlv` | 1955–1967 | `!!dlvVals` (5216); close `closeDlv` → `setState({dlv:null})` | Deliverable drawer (§2.3.b) | — |

On Installed base and Warranty, the zone-empty text says "project" even though the rows are machines. OPEN QUESTION: use a machine-specific message in the rebuild?

### A.2 Drawer shell geometry (NCR, deliverable, risk and CR drawers share it)
The backdrop is a `div` at `position:fixed; inset:0; z-index:60; background:color-mix(in srgb, var(--color-bg) 60%, transparent)`, and clicking it calls the close handler. The panel is `.card.elev-lg` at `position:fixed; top:0; right:0; bottom:0; z-index:61; width:min(640px,100vw); overflow:auto; border-radius:0; padding:18px 22px; gap:12px; border-left:1px solid var(--color-neutral-800)`. The header row has the id line (12 px neutral-400, tabular, `margin-right:auto`), then the tags, then a close button `btn btn-icon btn-ghost` with `ph ph-x` in neutral-400.
