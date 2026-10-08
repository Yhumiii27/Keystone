# 04 — Cost control, trends, contract, billing & contingency

Source prototype: `design/Keystone PM v8.dc.html` (template lines quoted from `design/_extracted/template-annotated.html`, which has the same line numbers; logic lines from the original file).
All labels are quoted in English as authored; French is given where the prototype's FR layer (`FR_DICT` / `FR_RULES` / `trFR`) produces it. **The prototype boots in French** (`state.lang:'fr'`, line 3774) and as the `director` role.

| # | Screen | Flag / route id | `startScreen` option | Nav label (FR) | Nav group | Template lines | Main logic lines |
|---|---|---|---|---|---|---|---|
| 1 | Budget & cost | `isBudget` / `budget` | yes (`budget`) | "Budget & cost" ("Budget et coûts") | Project › Steering ("Pilotage") | 286–484 | 3784–3845, 3829–3833, 4048–4056, 4904–4928, 5178–5186, 5229 |
| 2 | Trends & status report | `isTrends` / `trends` | yes (`trends`) | "Trends & status" ("Tendances et état") | Project › Project review ("Bilan") | 1737–1770 | 4556–4568, 5217 |
| 3 | Contract | `isContract` / `contract` | no | "Contract" ("Contrat") | Project › Contract ("Contrat") | 814–840 | 4869–4889, 5200 |
| 4 | Billing & payments | `isBilling` / `billing` | no | "Billing" ("Facturation") + badge | Project › Contract | 841–869 | 4890–4903, 5112, 5127, 5200 |
| 5 | Contingency register | `isContingency` / `contingency` | no | "Contingency" ("Provision pour aléas") | Project › Steering | 900–909 | 4959–4967, 5204 |

Also documented here because they are owned by this area's data: constants `HCATS, HCAT_ROWS, HCRS, HWPS, HLT_OFFER, HLT_STREAMS, offerPoints, HPV, HEV, HAC, HBAC, REX_FIN, HLT_SNAPS, SNAP_WEEKS, BASELINES, BILLING, CASH_M, CONTRACTS, CONTINGENCY` and the per-project generator `projectData()` (lines 3308–3339). `BASELINES`, `BILLING` and `CASH_M` are rendered by screens owned by other spec areas (Changes, Client portal, Portfolio cash) — their consumers are listed in §7.

---

## 0. Conventions shared by the five screens

### 0.1 Shell integration (shared header, not re-specified here)
- Page title = `titles[screen]` (line 5109): `budget` → "Budget & cost" ("Budget et coûts"); `trends` → "Trends & status report" ("Tendances et rapport d’état"); `contract` → "Contract" ("Contrat"); `billing` → "Billing & payments" ("Facturation & encaissements"); `contingency` → "Contingency register" ("Registre de la provision pour aléas").
- Breadcrumb (`crumbOf`, line 5163) = `<project label> · <nav group>` + `CRUMB_EXTRA[screen]` (line 5162): contract appends `CT.ref` (e.g. "CTR-HLT-001"), billing appends `CT.terms` (e.g. "Net 45 days").
- All five screens show the **project picker** in the header (`showProjectPicker` list, line 5175). The screen always renders the currently selected project (`state.project`, default `'HLT-026'`).
- Header **primary button** (`primary` map, line 5137, rendered `btn btn-primary` with `ph ph-plus` icon, template line 123):

| Screen | Primary label (FR) | Handler | Visible when |
|---|---|---|---|
| budget | "Change request" ("Demande de modification") | `st({budgetTab:'setup'})` — only switches to the *Structure & changes* tab | `hasPrimary` |
| trends | "Generate status report" ("Générer le rapport d’état") | `afOpen('trends')` | `hasPrimary` |
| contract | "Add amendment" ("Ajouter un avenant") | `afOpen('amendment')` | `hasPrimary` |
| billing | "Issue invoice" ("Émettre la facture") | `afOpen('billing')`, **null when no Planned milestone** (`ctrToInvoice.length===0`) → button hidden | `hasPrimary` |
| contingency | "Draw-down" ("Prélèvement") | `afOpen('contingency')` | `hasPrimary` |

  `hasPrimary = !!label && !!handler && !outside && !(projReadOnly && screen ∈ project screens)` (line 5177).
- A secondary "Export" button (`ph ph-export`) sits next to it; it has **no handler** in the prototype.
- Status date shown in header: `statusDate:'25 Sep 2026'` (line 5228).

### 0.2 Role access (`ROLE_SCREENS`, lines 3465–3466; `PERSONAS` line 3747)

| Role key | Persona | budget | trends | contract | billing | contingency |
|---|---|---|---|---|---|---|
| `director` | Marie Lefebvre · Portfolio director | ✓ (null = all screens) | ✓ | ✓ | ✓ | ✓ |
| `pm` | Romain Aubert · Project manager | ✓ | ✓ | ✓ (pushed) | ✓ (pushed) | ✓ (pushed) |
| `procurement` | Fabien Bertrand · Procurement & stock | – | – | ✓ (pushed) | – | – |
| `client` | Nadia Bensaïd · Client — Port authority | – | ✓ | – | – | – |
| `depthead`, `member`, `englead`, `quality` | | – | – | – | – | – |

- Nav items are filtered by `gate()` (line 5139). A role reaching a non-allowed screen (deep link, alert) renders it in **outside mode** (`outside`, line 5155): banner "Outside my workspace · Read-only · <persona title>", primary hidden, `ctrCanEdit=false`.
- **Project scope read-only** (`projReadOnly`, line 4173): for non-director roles with a mixed portfolio, projects that are not "mine" (`isMineP`, line 4164: pm → `p.pm===meShort`; client → `p.client==='Port authority'`) are read-only. Effects in this area: contract fields `disabled`, `ctrCanEdit=false` (hides Add/Issue/Mark-paid buttons), primary hidden.

### 0.3 Money formatting — `money(k, signed)` (line 3775), aliased `f`
All amounts in the data are **k€ (thousands)**. Prop `currency` (`'EUR'|'USD'`, default `'EUR'`, line 3095).

| Condition | |a| ≥ 1000 | |a| < 1000 |
|---|---|---|
| `lang==='fr'` and EUR | `"4,80 M€"` (`(a/1000).toFixed(2)` with comma) | `"336 k€"` (`Math.round`) |
| otherwise | `"€4.80M"` / `"$4.80M"` | `"€336k"` / `"$336k"` |

Sign: negative → U+2212 "−" prefix; `signed=true` and positive → "+"; zero → no sign. Examples below use EN/EUR.

### 0.4 Colour helpers (line 3135) and other helpers
- `LO = var(--color-accent-300)` (#d2cefd) — "attention / adverse" colour. `OK = var(--color-text)` (#e9e9ed). There is **no red/green**: adverse = light accent, neutral = text/grey.
- `pct(v) = (Math.round(v*1000)/10)+'%'` (line 3133) — CSS width/left strings, e.g. `0.714 → "71.4%"`.
- `seg(opts, cur, set)` (line 3889) — segmented control item: selected → `color: var(--color-accent)`, `box-shadow: inset 0 0 0 1px var(--color-accent)`; others `--color-neutral-300`; each non-first item `border-left: 1px solid var(--color-divider)`. Buttons are `.seg-opt`, 12px, padding 4px 10px, inside `.seg` (1px divider border, radius-md).
- `st(patch)` (line 3890) — returns `() => setState(patch)`.
- Month index convention: `m = 0` ⇔ Jan 2026; `mIdx("14 Dec 2026") = (y−2026)*12 + month + (day−1)/30` (line 3672). "Now" constants: `PG_NOW = 8.97` (≈ 30 Sep 2026, line 3671), `NOWD = new Date(2026,8,30)` (line 4892), and mutations stamp the literal `'30 Sep'` / `'30 Sep 2026'`.

### 0.5 Repeated visual patterns (Nocturne DS)
- **KPI tile**: `.card.elev-sm` (surface #232532, `--shadow-sm` = 1px #3f424d ring, radius-md 8px), `gap:3px; padding:12px 14px`. Label 10.5px, uppercase, letter-spacing 0.08em, `--color-neutral-400`; value 22px / 500 / letter-spacing −0.02em, colour from data; sub 11.5px `--color-neutral-400` (`text-wrap:pretty`). Grid: `repeat(auto-fit, minmax(150px,1fr))`, gap 10px (Budget performance uses `minmax(140px,1fr)`).
- **Section card**: `.card.elev-sm`, `padding:14px 16px`, gap 8–12px, `overflow:auto` when it holds a table. Title `.card-title` (Inter 500, 17px); subtitle 12px `--color-neutral-400`.
- **Table**: `.table` (row rules are fading gradient strips; th 11px uppercase 60 % text), font-size overridden to 12.5–13px; numeric cells `text-align:right; font-variant-numeric:tabular-nums`.
- **Status tags**: `tag tag-accent` (bg accent-800 #423a6a, text accent-100), `tag tag-outline` (1px accent border, accent text), `tag tag-neutral` (bg neutral-800, text neutral-100).
- **Empty state**: 12.5px `--color-neutral-400`, padding 14px, centred, radius-md, bg `--color-neutral-900`.
- **Row list (non-table)**: CSS grid rows, `padding:6–9px 0`, `border-top:1px solid var(--color-neutral-900)`, 12.5px.
- SVG hex colours map to tokens: `#292b31` neutral-900 (grid), `#9397ab` neutral-500 (axis text), `#595d6c` neutral-700, `#b2b6ca` neutral-400, `#75798c` neutral-600, `#5d5294` accent-700 (today line), `#b5abfc` accent-400 (today label), `#9184d9` accent (primary series), `#e4e7f5` neutral-200 (actuals), `#161826` bg (marker fill).

### 0.6 Generic action-form dialog (`AF`, line 3674; render lines 138–158)
Used by Trends, Contract, Billing, Contingency. Backdrop `.dialog-backdrop` (z 50, top padding 8vh), `.dialog` width `min(640px,100%)`, max-height 84vh. Header: `afForm.title` + "<project name> · Required fields are marked · *" + close (×). Body: 2-column grid; a field spans both columns when it is a textarea or its id is `title|name|progress|reason|why`. Footer: "Cancel" (`btn-secondary`) + submit (`btn-primary`, icon `ph ph-play` for `kind:'run'`, `ph ph-check` for `kind:'create'`, disabled while invalid).
- Field tuple `[id, label, type, default, required]`. Initial value: array default → first option; magic list keys (`MSPLAN` etc.) → `''`; else the literal default (so a default string is a **pre-filled value, not a placeholder**).
- Validation `afValid` (line 5120): every required field non-empty after trim; selects always valid.
- On submit (`afSubmit`, lines 5121–5135): applies the per-key mutation, closes the dialog, shows a toast (`AF_RESULT[key]`, line 3701) bottom-right for 4 s (`showToast`, line 5116).

### 0.7 i18n notes for the rebuild
- `renderVals()` runs `deepTr` on **every string** in the view model (except keys in `SKIP_KEYS`, line 3757), so data values (statuses, contract terms, select option values) are translated too. Consequence in FR: select option *values* become French (e.g. amendment status "Signé"), and `afSubmit` stores the French string — the "Signed" test (`a[2]==='Signed'`) then fails. Rebuild with stable enum keys + translated labels.
- Untranslated in FR (fall through `trFR` unchanged): "Performance", "Structure & changes", "Original budget", "Current budget (BAC)", "Materials", "Subcontractors", "Permits & fees", "Contingency (unallocated)", category "Actuals from" sources ("Timesheets × role rate", …), "No schedule impact", `PD.note`, amendment/milestone/draw-down free texts. "Reserve" is mistranslated "Réservation" (should be "Réserve").

---

## 1. Budget & cost — `isBudget` (template 286–484)

### 1.1 Route, nav, roles
- `screen==='budget'` (line 5174). Nav: `nav('budget','Budget & cost','ph ph-chart-line-up')` in group **Steering** (Pilotage) of the *Project* section, order: plan, schedule, **budget**, hours, contingency, presources (line 5160).
- Roles: director, pm (§0.2). `startScreen:'budget'` supported.
- Inbound links: portfolio alert "Harbor Line — labor overrun" → "Open budget" (`setState({screen:'budget',project:'HLT-026'})`, line 3811); Change-request detail panel → `openBudget: goTo('budget')` (line 4610).

### 1.2 Purpose
Cost control of one EPC project with the earned-value method: planned value (PV) built from the commercial offer's payment terms (deposits / delivery / acceptance) plus other cost streams, compared with earned value (EV) and actual cost (AC); budget structure (categories, change requests, WBS work packages); and cash recovery (client receipts vs committed cost), i.e. whether Keystone is financing the project.

### 1.3 Layout
Root: `flex column, gap 14px` (line 287).
1. **View bar** (line 288): eye icon (`ph ph-eye`, 15px, accent) + `FL.view` = "Display" ("Vue") + segmented control `budgetSeg` + helper text 12px neutral-400 "Budget structure, cost categories and change requests are defined per project" ("Structure budgétaire, catégories de coûts et demandes de modification sont définies par projet"). Row wraps.
2. One of three tab bodies (`budgetPerf` / `budgetSetup` / `budgetCash`).

`budgetSeg` (line 5186):

| value | label | state |
|---|---|---|
| `perf` (default) | "Performance" | `budgetTab` |
| `setup` | "Structure & changes" | |
| `cash` | "Cash & recovery" ("Trésorerie & recouvrement") | |

`state.budgetTab` is global (not per project) and survives project switches.

### 1.4 Tab "Performance" (lines 289–378)

**Region A — KPI row** (lines 291–299), grid `repeat(auto-fit,minmax(140px,1fr))`, 7 tiles `budgetKpis` (lines 3834–3841):

| # | Label (FR) | Value | Sub | Colour | HLT-026 example |
|---|---|---|---|---|---|
| 1 | "Budget (BAC)" | `f(BAC)` | "Approved baseline" ("Référence approuvée") | OK | €4.80M |
| 2 | "Actual cost" ("Coût réel") | `f(ac)` | `round(ac/BAC*100)+'% of budget'` | OK | €3.36M · 70% of budget |
| 3 | "Earned value" ("Valeur acquise") | `f(ev)` | "Work completed" | OK | €3.08M |
| 4 | "Forecast (EAC)" ("Prévision (EAC)") | `f(eac)` | "At current CPI" | **LO always** | €5.24M |
| 5 | "Variance (VAC)" ("Écart (VAC)") | `f(vac,true)` | `round(vac/BAC*1000)/10+'% of budget'` | **LO always** | −€436k · −9.1% of budget |
| 6 | "CPI" | `cpi.toFixed(2)` | "Target ≥ 1.00" | **LO always** | 0.92 |
| 7 | "TCPI" | `tcpi.toFixed(2)` | "Needed to hit BAC" | **LO always** | 1.19 |

> Colours 4–7 are hard-coded LO regardless of value (OPEN QUESTION Q1).

**Region B — two cards side by side** (line 301, `flex-wrap`, gap 14px, `align-items:stretch`):

**B1. "Budget vs cost" card** (lines 302–334), `flex: 3 1 560px; min-width:0`, padding 14px 16px, gap 10px.
- Header: title "Budget vs cost" ("Budget vs coûts"), subtitle "Cumulative, earned-value method" ("Cumulé, méthode de la valeur acquise"); right-aligned legend (12px neutral-300, 14px swatches with 2px top border): "Planned (PV)" dashed neutral-500; "Earned (EV)" solid accent; "Actual (AC)" solid neutral-100; "Forecast" ("Prévision") dotted neutral-100.
- SVG `viewBox="0 0 760 290"`, `width:100%; height:auto` (scales; no min width). Geometry (lines 3816–3828):

```
W=760, H=290, L=52, R=16, T=14, B=30
ymax  = BAC * 1.17
gstep = first of [100,200,250,500,1000,2000] with ymax/gstep <= 6.5 (else 2000)
grid values = 0, gstep, 2·gstep … ≤ ymax
x(m) = L + m/12 · (W − L − R)            // m = month boundary, 0 = start of month 0
y(v) = T + (1 − v/ymax) · (H − T − B)
path(a) = "M" + [(0,0), (1,a[0]), (2,a[1]) …].map(x,y).join(" L")   // value i plotted at END of month i
```
  | Element | Spec |
  |---|---|
  | `<defs>` | `linearGradient#evfill` vertical, `#9184d9` opacity 0.28 → 0 |
  | Grid | for each grid value: line x 52→744 at `y(v)`, stroke #292b31; label at x=44, `y(v)+4`, 11px, `text-anchor:end`, fill #9397ab, text `v ? f(v).replace('.00','') : '0'` (EN "€1M", "€2M"…; FR keeps "1,00 M€") |
  | Month labels | `PD.chartMonths[i]` at `x(i+0.5)`, y=282, 11px, middle-anchored (12 labels) |
  | BAC line | horizontal at `y(BAC)`, stroke #595d6c, dasharray 2 4; label at x=56, `y(BAC)−6`: "Budget at completion · " + `f(BAC)` ("Budget à l’achèvement ·"), 11px, #b2b6ca |
  | Today line | vertical at `x(EVn)` (EVn = number of EV points) from y 10→262, stroke #5d5294; label "Today" ("Aujourd’hui") at `x(EVn)+6`, y=22, #b5abfc |
  | EV area | `path(EV) + " L x(EVn) y(0) Z"` filled `url(#evfill)` |
  | PV | `path(PV)`, stroke #75798c, width 2, dasharray 5 4 |
  | Disbursement steps | one circle per `offerPoints(PD.OFFER)` point: `cx=x(p.m+1)`, `cy=y(PV[p.m])`, r 3.5, fill #161826, stroke #9397ab 1.5; native tooltip `<title>`: `sys · deposit|delivery|acceptance pct % · f(amt) · chartMonths[m]` (e.g. "Structural steel — columns, beams, purlins · deposit 30 % · €192k · Mar") |
  | AC | `path(AC)`, stroke #e4e7f5, width 2 |
  | Forecast | straight segment from `(x(EVn), y(ac))` to `(x(12), y(eac))`, stroke #e4e7f5 width 2, dasharray 1 4, round caps |
  | EV | `path(EV)`, stroke #9184d9, width 2.5 (drawn last, on top) |
  | EAC marker | circle at `(x(12), y(eac))` r 4, fill #161826, stroke #e4e7f5 2; label "EAC " + `f(eac)` at `(x(12)−10, y(eac)−10)`, end-anchored, #e4e7f5 |

  HLT example: ymax 5616 → gstep 1000 → grid 0…5000; today x = 571; BAC y ≈ 49.7; EAC y ≈ 30.6.
- Footer strip (line 333): top border neutral-900, padding-top 8px, 12px neutral-400; icon `ph ph-steps`; text "Planned value follows the disbursement profile · " + `costProfile.sourceText` + " · " + `costProfile.rexText`; ghost button "See profile" ("Voir le profil") + `ph ph-arrow-right` → `goBudgetSetup` (= `st({budgetTab:'setup'})`).

**B2. "Variance" card** ("Écart", lines 335–351), `flex: 1 1 280px`, gap 12px.
- 2-column grid: "Cost (EV−AC)" → `cvText = f(ev−ac, true)` (HLT −€280k); "Schedule (EV−PV)" → `svText = f(ev−pv, true)` (HLT −€340k). Label 11px uppercase neutral-400; value 20px/500 accent-300 (always).
- Caption "Cumulative cost variance by month" ("Écart de coût cumulé par mois").
- Bar strip: flex row gap 6px, height 110px, `align-items:start`, top border neutral-800 — bars **hang from the top line** (negative-variance metaphor). Each bar (`cvBars`, line 3843): `cv_i = EV[i] − AC[i]`; `h = max(3, |cv_i| / max(1, max|cv|) · 80) + '%'`; fill `linear-gradient(accent-700, accent-500)`, radius `0 0 3px 3px`; label = first letter of `chartMonths[i]` (10px). HLT cv: −5, −20, −45, −70, −110, −150, −190, −240, −280 → heights 3 %…80 %. Sign is not encoded (OPEN QUESTION Q2).
- Note box (line 350): bg neutral-900, radius-md, padding 10px 12px, 12.5px neutral-300: `budgetNote` (= `PD.note`) + " To finish on budget the remaining work needs a CPI of " + `<accent-300>tcpiText</>` + ".". HLT note: "Overrun is widening ~$40k a month, led by steel labor." (hard-coded, `$` even in EUR, untranslated).

**Region C — "Cost breakdown" card** (lines 353–376), `overflow:auto`. Header: title "Cost breakdown" ("Ventilation des coûts") + right caption "Bar spans 140% of each line's budget · tick = budget". Table 13px, rows `categories` (lines 3844–3845) from `CATS` tuples `[name, budget, actual, committed, forecast]`:

| Column (FR) | Content |
|---|---|
| "Category" ("Catégorie") | `name`, weight 500 |
| "Budget" (right) | `f(b)` |
| "Actual" ("Réel", right) | `f(a)` |
| "Committed" ("Engagé", right, neutral-400) | `c ? f(c) : '—'` |
| "Forecast" ("Prévision", right) | `f(fc)` |
| "Actual · committed · forecast" (width 30 %) | bullet bar, see below |
| "Variance" ("Écart", right) | `f(b−fc, true)`, colour LO if `b−fc<0` else neutral-300 |

Bullet bar: track 10px high, radius 3, bg neutral-900, `overflow:visible`; children in flex row: actual segment (neutral-300, radius `3px 0 0 3px`, width `aW = pct(a/b/1.4)`) then committed segment (neutral-700, width `cW = pct(c/b/1.4)`); budget tick absolutely positioned `left: bL = pct(1/1.4) = 71.4%`, top −3px, 2×16px, neutral-500; forecast diamond `left: fL = pct(min(fc/b,1.4)/1.4)`, 8×8px, margin-left −4px, top −4px, `transform: translateY(5px) rotate(45deg)`, bg accent. `aW`/`cW` are not clamped (can overflow past 100 % of the track).

HLT rows (`HCATS`): Labor 1850/1420/180/2010 (−€160k); Materials 1320/960/240/1460 (−€140k); Equipment 780/540/120/820 (−€40k); Subcontractors 560/330/150/610 (−€50k); Permits & fees 140/62/0/128 (+€12k); Contingency 150/48/0/208 (−€58k). Budgets sum to BAC 4800, forecasts to 5236 (= EAC). No sorting, no row actions.

### 1.5 Tab "Structure & changes" (lines 379–447)

**Card 1 — "Cost profile — basis of the planned value"** ("Profil de coûts — base du prévu (PV)", lines 381–389). Subtitle: `costProfile.sourceText · costProfile.rexText`.
- Section kicker (10.5px uppercase, accent): "Commercial offer · long-lead systems with deposits" ("Offre commerciale · systèmes à long délai avec acomptes"). Table 12.5px from `costProfile.offer` (line 3832):

| Column (FR) | Content |
|---|---|
| "System" ("Système") | `q.sys` (500) |
| "Supplier" ("Fournisseur") | `q.sup` (neutral-300) |
| "Amount" ("Montant", right) | `f(q.amt)` |
| "Payment terms" ("Conditions de paiement") | `q.terms + ' %'` e.g. "30 / 60 / 10 %" |
| "Order → delivery → acceptance" | `chartMonths[order] → chartMonths[deliv] (→ chartMonths[acc])` e.g. "Mar → Jun → Sep" |
| "Lead time" ("Délai d’approvisionnement", right) | `q.lead + ' wk'`; prefixed by `ph ph-hourglass-high` (accent) when `lead ≥ 26` (`q.late`) |

- Below, grid `repeat(auto-fit,minmax(min(100%,300px),1fr))` gap 14px with two lists:
  - "Financial REX · same product category · " + `rexMt` (line 386): rows grid `64px | 1fr | 44px`: ref id (neutral-400), name + pattern (11.5px neutral-400), year (right).
  - "Other cost streams" ("Autres flux de coûts", line 387): rows flex space-between: stream name | basis text (neutral-400). HLT: Labor — "Timesheets × role rate, per activity"; Site materials & consumables — "Monthly call-offs"; Subcontract — piling & earthworks / Subcontract — MEP — "Certified monthly claims"; Permits & fees — "On filing"; Contingency — "Spread pro rata". Non-HLT projects show the 3 generic streams of line 3336.
- `costProfile` (lines 3829–3833):
  - `sourceText = OFFER.length + ' quotes from the commercial offer · ' + f(Σamt) + ' · ' + round(Σamt/BAC·100) + ' % of BAC'` (HLT: "4 quotes from the commercial offer · €1.71M · 36 % of BAC").
  - `rexText = 'REX ' + mt + ' · ' + n + ' reference project(s) · pattern ' + dep + ' / ' + deliv + (acc ? ' / ' + acc : '')` (HLT: "REX EMP · 2 reference projects · pattern 30 / 60 / 10"). `mt = PROJ_ID[project].mt`, fallback `REX_FIN.AUTRE`.

**Card 2 — "Budget reconciliation"** ("Réconciliation budgétaire", lines 390–399). Right caption "Original baseline → approved changes → current budget". Flex-wrap row of 5 blocks (`recon`, line 4051); each block: padding 10px 14px, radius-md, min-width 150px, bg `r.bg` (default neutral-900), box-shadow `r.edge`; label 10.5px uppercase; value 20px/500 coloured; sub 11.5px. An arrow `ph ph-arrow-right` (neutral-600) follows blocks 0 and 1 (`arrow: i<2`).

| # | Label | Value | Sub | Style | HLT |
|---|---|---|---|---|---|
| 0 | "Original budget" | `f(RC.orig)` | `'BL1 · ' + PD.baselineSet` | default | €4.60M · BL1 · 12 Mar 2026 |
| 1 | "Approved changes" ("Modifications approuvées") | `RC.chg ? f(chg,true) : '—'` | `crCount + ' change request(s)'` | accent-300 if chg else neutral-400 | +€200k · 3 change requests |
| 2 | "Current budget (BAC)" | `f(BAC)` | "Basis for CPI / EAC" | bg accent-900, `inset 0 0 0 1px accent-700` | €4.80M |
| 3 | "Pending" ("En attente") | `pending ? f(pending,true) : '—'` | `RC.pendingSub` | neutral-300 | +€85k · CR-008 · review 30 Sep |
| 4 | "Contingency" | `f(RC.cont)` | `round(contUsed/cont·100)+'% drawn'` + (`contUsed>cont` ? `' · ' + f(contUsed−cont,true) + ' over'`) | LO if over | €150k · 139% drawn · +€58k over |

**Cards 3 & 4** in grid `repeat(auto-fit,minmax(min(100%,420px),1fr))` gap 14px:

*Card 3 — "Cost categories"* ("Catégories de coûts", lines 402–411). Subtitle "Defined per project · actuals map in by rule" ("Définies par projet · les réels s’imputent par règle"). Ghost button "Add category" (`ph ph-plus`) — **no handler**. Table 13px from `catRows` (line 4052, source `CAT_ROWS = [code, name, type, source, budget]`):

| Column | Content |
|---|---|
| "Code" | 12px neutral-400 tabular, e.g. "C01" |
| "Category" | name (500) |
| "Type" | `tag tag-neutral` with type: Labor / Material / Equipment / Subcontract / Fees / Reserve |
| "Actuals from" ("Réels issus de") | 12px neutral-300; `SRC_OF[type]` (line 3302): Labor → "Timesheets × role rate", Material → "Purchase orders + receipts", Equipment → "Plant hire invoices", Subcontract → "Certified payment claims", Fees → "Direct invoices", Reserve → "Drawn by change request" |
| "Budget" (right) | `f(b)` |
| (action) | icon button `ph ph-pencil-simple` 28×28 neutral-400 — **no handler** |

*Card 4 — "Change requests"* ("Demandes de modification", lines 413–424). Subtitle "Approved changes revise the budget baseline". Primary button "New change request" (`ph ph-plus`) — **no handler** (OPEN QUESTION Q4). Rows (`changeRequests`, line 4053, source `PD.CRS`, HLT = `HCRS`), grid `58px | minmax(0,1fr) | auto | auto`, gap 12px, padding 9px 0, top border neutral-900:
  - col 1: `id` 12px neutral-400;
  - col 2: `title` 13px + `meta` 11.5px neutral-400;
  - col 3 (right-aligned): amount `f(amt,true)` 13px, colour LO if `amt>0` else neutral-300; under it `days ? (days>0?'+':'') + days + ' days' : 'No schedule impact'` 11.5px;
  - col 4: status tag — Approved → `tag tag-accent`; Pending → `tag tag-outline`; other (Rejected) → `tag tag-neutral`.
  - Order = data order (not sorted). Empty state (`noCRs = !CRS.length`): "No change requests raised — the current budget equals the original baseline".
  - HLT rows: CR-004 +€120k +12 days Approved "14 May · R. Aubert"; CR-006 +€65k no impact Approved "02 Jul · Steering committee"; CR-007 +€15k +3 days Approved; CR-008 +€85k −18 days Pending "Review 30 Sep · Steering committee"; CR-005 −€40k Rejected "11 Jun · Client". All non-HLT projects have `CRS: []` → empty state.

**Card 5 — "Budget by work package"** ("Budget par lot de travaux", lines 426–445), `overflow:auto`. Subtitle "Mapped to the WBS — every activity carries its share". Ghost button "Open plan" ("Ouvrir le plan") + arrow → `goPlan = st({screen:'plan'})`. Table 13px from `wpRows` (lines 4054–4056), source `WPS = [wbs, name, orig, chg, actual, eac]`, plus a **Total** row (sums of the four numbers):

| Column (FR) | Content |
|---|---|
| "WBS" | 12px neutral-400 |
| "Work package" ("Lot de travaux") | name |
| "Original" ("Initial") | `f(o)` |
| "Changes" ("Modifications") | `c ? f(c,true) : '—'`, accent-300 if c else neutral-500 |
| "Current" ("Actuel") | `f(o+c)` |
| "Actual" | `f(a)` |
| "EAC" | `f(e)` |
| "Actual · tick = current · ◆ EAC" (22 %) | track 8px neutral-900 radius 3; actual fill neutral-300 `actW = pct(min(a/cur,1.4)/1.4)`; tick 2×14px neutral-500 at `curW = 71.4%`; diamond 8×8 accent at `eacW = pct(min(e/cur,1.4)/1.4)`, `translateY(3px) rotate(45deg)` |
| "Variance" | `f(cur−e,true)`, LO if negative else neutral-300 |

Row font-weight 400; total row 500. HLT totals: Original €4.60M, Changes +€200k, Current €4.80M, Actual €3.36M, EAC €5.24M, Variance −€436k.

### 1.6 Tab "Cash & recovery" (lines 448–481)
Rendered only if the project has a contract (`hasRec = !!recChart`, i.e. `CONTRACTS[project]` exists — only HLT-026 in the mock). Otherwise empty state "No contract registered for this project" ("Aucun contrat enregistré pour ce projet").

**KPI row** (line 451), 6 tiles `recKpis` (lines 4922–4927):

| Label (FR) | Value | Sub | Colour | HLT |
|---|---|---|---|---|
| "Client payments received" ("Encaissements client") | `f(ctrPaid)` | `n paid + ' milestones paid · ' + round(ctrPaid/ctrTotal·100) + ' % of contract'` | OK | €1.66M · 2 milestones paid · 30 % of contract |
| "Committed to date" ("Engagé à date") | `f(ac+openCommit)` | `f(ac) + ' actual cost · ' + f(openCommit) + ' orders placed'` | OK | €4.07M · €3.36M actual cost · €713k orders placed |
| "Recovery" ("Recouvrement") | `f(recNow,true)` | `<0` → "we are financing the project" / else "the client is financing the project" | LO if <0 | −€2.42M |
| "Coverage" ("Couverture") | `round(ctrPaid/(ac+openCommit)·100) + ' %'` | "received ÷ committed" | LO if ratio < 0.8 | 41 % |
| "Next receipt" ("Prochain encaissement") | `nextI≥0 ? f(recP[nextI]) : '—'` | `recWhat[nextI] + ' · ' + month + ' · ' + CT.terms` or "nothing outstanding" | OK | €1.38M · M3 · Nov · Net 45 days |
| "Lowest point" ("Point bas") | `f(recov[lowI],true)` | `month + (lowI<=todayM ? ' · already passed' : ' · still ahead')` | LO if <0 | −€2.50M · Oct · still ahead |

**"Cash recovery" chart card** (lines 452–473), `overflow:auto`. Subtitle "Client payments received against what the project has committed · a negative gap is financed by Keystone". Legend: "Client receipts (cumulative)" solid accent; "Committed (actual + orders placed)" solid neutral-100; "Forecast" dotted neutral-100. SVG `viewBox 0 0 760 290`, **`min-width:560px`** (horizontal scroll on narrow screens). Geometry (lines 4905–4921):

```
rcMonths = Jan…Dec 2026, 'Jan ’27','Feb ’27','Mar ’27'      (RCN = 15)
todayM   = EVn − 1                                          (HLT: 8 = Sep)
rcMax    = max(ctrTotal, …cumCom) · 1.08
step     = first of [200,250,500,1000,2000] with rcMax/step <= 6.5
rcX(m)   = 52 + m/15 · 692 ;  rcY(v) = 14 + (1 − v/rcMax) · 246
```
| Element | Spec |
|---|---|
| Grid / labels | as Budget chart (x 52→744, label at x 44); month labels `l.replace(' ’27','’27')` at `rcX(i+.5)`, y 282, **10.5px** |
| Today | vertical at `rcX(EVn)`, label "Today" at +6 |
| Committed (actual) | `rcLine(cumCom.slice(0,EVn))` — line from origin, value i at `rcX(i+1)`; #e4e7f5 width 2 |
| Committed (forecast) | `M rcX(EVn) rcY(cumCom[todayM])` then `L rcX(EVn+i+1) rcY(cumCom[EVn+i])`; dotted (1 4, round caps) |
| Receipts | **step path** `rcStep(cumRec)`: for month i, vertical jump at `rcX(i)` (start of month) then horizontal to `rcX(i+1)`; #9184d9 width 2.5 |
| Gap bar | vertical at `rcX(EVn)` from `rcY(cumCom[todayM])` to `rcY(cumRec[todayM])`, #b5abfc width 3, opacity 0.6, round cap; label `f(recNow,true)` at `(todayLabelX, mid+4)`, #b5abfc |
| Lowest point | circle at `(rcX(lowI+1), rcY(cumRec[lowI]))`, r 4, fill #161826, stroke accent 2, tooltip "Lowest point" |

**"Monthly schedule" table** ("Échéancier mensuel", lines 474–477), 12.5px, one row per `rcMonths` (`recRows`, line 4928):

| Column (FR) | Content |
|---|---|
| "Month" ("Mois") | month label |
| "Receipts" ("Encaissements", right) | `recA+recP ? f(recA+recP) : '—'`; neutral-400 when only projected (`recP && !recA`), else text |
| "Milestones" ("Jalons") | `recWhat[i]` milestone ids joined " · " (12px neutral-400) |
| "Commitments" ("Engagements", right) | monthly delta `f(cumCom[i] − cumCom[i−1])` (i=0: `cumCom[0]`); in the today row a 2nd line "incl. " + `f(openCommit)` + " orders placed" (11px) |
| "Recovery (cumulative)" ("Recouvrement (cumul)", right, 500) | `f(recov[i],true)`, LO if negative |

Row bg = accent-900 for the today row (`isNow`), else transparent. HLT rows: Jan −€175k … Apr receipt €552k (M1) … Aug €1.10M (M2) … **Sep (today)** commitments €1.12M incl. €713k orders placed, cumulative −€2.42M; Oct −€2.50M (lowest); Nov €1.38M (M3, projected) … Mar ’27 €1.38M (M5) → +€655k.

**Cash recovery formulas** (lines 4905–4913):
- `termsM = max(1, round(ctrTermsDays/30))` where `ctrTermsDays` = first integer in `CT.terms` (default 45) → 45 d → 2 months.
- For each payment milestone `m` (from Contract/Billing, §3–4, amount `m.amt`):
  - Paid → actual receipt `recA[min(mAt(m.paid) ?? todayM, todayM)] += amt`.
  - Invoiced → projected receipt at `mAt(m.inv) + termsM`; Planned → at `mAt(m.due) + termsM`; if that index ≤ todayM it is pushed to `todayM+1`; dropped if ≥ 15.
  - `mAt(s)` = `floor(mIdx(s))` (two-token dates get " 2026" appended).
- `cumRec[i] = Σ_{j≤i} (recA[j] + recP[j])`.
- `openCommit` = HLT: **713** (hard-coded); other projects: `max(0, round((PV[min(11,EVn)] − PV[todayM]) · 0.6))` (60 % of next month's planned value assumed already ordered).
- `cumCom[i] = AC[i]` for `i<todayM`; `ac + openCommit` at `todayM`; for `i>todayM`: `max(ac+openCommit, round(ac + ((i<=11 ? PV[i] : BAC) − PV[todayM]) / cpi))`.
- `recov[i] = cumRec[i] − cumCom[i]`; `recNow = recov[todayM]`; `lowI = argmin(recov)`; `nextI = first i with recP[i] > 0`.

### 1.7 Interactions & state (Budget)

| Control | Handler | State read/written | Effect |
|---|---|---|---|
| Segmented "Performance / Structure & changes / Cash & recovery" | `budgetSeg[i].onClick` | writes `budgetTab` | switch tab |
| "See profile" (perf footer) | `goBudgetSetup` | `budgetTab='setup'` | switch tab |
| Header "Change request" | `st({budgetTab:'setup'})` | `budgetTab` | switch tab (does not create a CR) |
| "Open plan" | `goPlan` | `screen='plan'` | navigate to Plan — WBS |
| Step circles | native SVG `<title>` | – | hover tooltip |
| "Add category", pencil, "New change request" | none | – | inert in prototype |
| Project picker (shell) | `project` | recomputes all data | |

No toasts, no editing on this screen.

### 1.8 Data & formulas (Budget)

**EVM core** (lines 3784–3788), computed for every screen from `PD = projectData(project, proj)`:
```
EVn = EV.length          // months elapsed incl. current
ev = EV[EVn−1]; ac = AC[EVn−1]; pv = PV[EVn−1]
CPI  = ev / ac           SPI = ev / pv
EAC  = BAC / CPI         VAC = BAC − EAC
TCPI = (BAC − ev) / (BAC − ac)
CV = ev − ac             SV = ev − pv
```
HLT-026: PV[8]=3420, EV=3080, AC=3360 → CPI 0.917, SPI 0.901, EAC 5236.4, VAC −436.4, TCPI 1.194, CV −280, SV −340.

**HLT-026 planned value** — `HPV` (line 3100):
```
offerPoints(offer):  for each quote q, t = q.terms.split('/').map(parseInt)
   for (k, month) in [('order',q.order), ('deliv',q.deliv), ('acc',q.acc)] at index i:
      if month != null and t[i]:  point { m: min(11, month), k, pct: t[i],
                                          amt: round(q.amt · t[i]/100), sys, sup }
monthly[m] = Σ offer points in m + Σ HLT_STREAMS[s][2][m]
HPV[m] = round(cumulative sum of monthly)
```
Result HPV = 162, 349, 733, 1133, 1573, 2290, 2622, 2975, 3420, 4151, 4569, **4800** (= BAC; offer 1710 + streams 1850+390+260+300+140+150). EV/AC are literal arrays `HEV`, `HAC` (9 months, Jan–Sep 2026). `HLT_PD` (line 3308) also fixes `tNow:8.8, pct:64, floatDays:-27, chartMonths:MO, baselineSet:'12 Mar 2026', recon:{orig:4600,chg:200,crCount:3,pending:85,pendingSub:'CR-008 · review 30 Sep',cont:150,contUsed:208}, note`.

**Other projects** — `projectData(code, proj)` (lines 3310–3339, cached in `PD_CACHE`). Inputs: `DEFS[code]` (start month, contingency `cont`, phases, packages `pk=[name, budget, startMonth, endMonth, critical?]`, cost categories `cats=[name,type,budget]`) and the project record (`budget`, `actual`, `progress`, `spi`).
```
BAC = proj.budget; prog = proj.progress
CPI = clamp(BAC·prog / proj.actual, 0.70, 1.25)       (1 if actual = 0)
tNow = 8.8 − D.start ; floatDays = round((spi − 1)·180) ; slip = max(0, −floatDays/30)
rex = REX_FIN[PROJ_ID[code].mt] ?? REX_FIN.AUTRE
eqShare = Σ budget of cats typed Material|Equipment / Σ cats budget
for each package (b, bs, be):
   eq = b·eqShare ; lin = b − eq
   m0 = clamp(floor(bs),0,11) ; m1 = max(m0, min(11, ceil(be)−1))
   lin spread evenly over m0..m1
   + eq·dep% at m0, eq·deliv% at m1, eq·acc% at min(11,m1+1)
   if eq ≥ 40 → OFFER row {sys: name+' — equipment & materials', sup:'Per offer quotes',
        amt: round(eq), terms: [dep,deliv,acc] without zeros joined ' / ',
        order:m0, deliv:m1, acc: rex.acc ? min(11,m1+1) : null, lead: max(4, round((m1−m0)·4.3)) }
PV[i] = round(BAC · cum[i] / cum[11])          // rescaled so PV[11] = BAC (contingency spread pro rata)
tm = clamp(floor(tNow),0,11)
EV[i] = round(BAC·prog · PV[i]/PV[tm]) ; AC[i] = round(EV-share / CPI)    for i = 0..tm
CATS = cats.map(n,t,b → [n, b, round(b·prog/CPI), round(b·0.08·(1−prog)), round(b/CPI)])
       + ['Contingency', cont, round(cont·prog·0.6), 0, contUsed]
contUsed = round(cont · (CPI<1 ? 1.15 : 0.85))
WPS = per package [ '1.'+(i+1), name, b, 0, Σ activity actual, Σ activity EAC ]   (activity split 25/25/35/15 % across 4 phases)
      + ['—','Contingency (unallocated)', cont, 0, round(cont·prog·0.6), contUsed]
CAT_ROWS = [...cats, ['Contingency','Reserve',cont]] → ['C0'+(i+1), name, type, SRC_OF[type], budget]
recon = {orig:BAC, chg:0, crCount:0, pending:0, pendingSub:'No change requests raised', cont, contUsed}
chartMonths = monthLabels(D.start, 12)      // e.g. NDC-031: Apr … Dec, Jan ’27, Feb, Mar
note = CPI<0.97 ? 'Spending is running ahead of earned value (CPI x.xx); the forecast at completion exceeds the budget.'
                : 'Cost performance is healthy (CPI x.xx); the forecast at completion sits within budget.'
CRS = []
```
Example NDC-031 (BAC 2100, progress 0.51, actual 1020, start Apr): CPI 1.05; PV 53, 234, 365, 559, 654, 802, 1214, 1348, 1688, 1760, 1973, 2100; EV (6 months) ends at 1071; AC ends at 1020. Note: the synthetic EV/PV ratio (1.34) ignores `proj.spi` (0.98) — OPEN QUESTION Q3.

`projectData` returns `HLT_PD` for HLT-026 **and for every project not in `DEFS`** (the `EXTRA` portfolio projects) — those screens therefore show Harbor Line data (OPEN QUESTION Q5).

### 1.9 Cross-links (Budget)
Plan (WBS activities carry `b:[budget, actual, eac]`), Changes & baselines (CR workflow, `BASELINES`), Contract/Billing (milestones feed Cash & recovery), Contingency (separate draw-down register), Portfolio overview alerts, Trends (EAC/CPI history).

---

## 2. Trends & status report — `isTrends` (template 1737–1770)

### 2.1 Route, nav, roles
`screen==='trends'` (line 5217); nav `nav('trends','Trends & status','ph ph-chart-line')`, group **Project review** ("Bilan") with `rex` (line 5160). Roles: director, pm, **client**. `startScreen:'trends'` supported.

### 2.2 Purpose
Weekly status snapshots (every Friday status date) of the project's key control indicators — CPI, SPI, EAC, critical-path float, risk exposure, milestone slip — to show drift over the last quarter ("what did we forecast in July?") and to generate the steering/client status report.

### 2.3 Layout (root flex column gap 14px)
1. KPI row (line 1739) — 5 tiles `trendKpis`.
2. Indicator card grid (lines 1740–1748) — `repeat(auto-fit,minmax(190px,1fr))` gap 10px, 6 clickable cards `trendCards`.
3. Chart card (lines 1749–1760).
4. "Snapshot history" table card (lines 1761–1768).

### 2.4 Components

**KPI row** `trendKpis` (line 4568):

| Label (FR) | Value | Sub | Colour | HLT |
|---|---|---|---|---|
| "Snapshots" ("Instantanés") | `SNAP_WEEKS.length` (13) | "Weekly · Fridays · since 3 Jul" | OK | 13 |
| "CPI trend" ("Tendance CPI") | `(±) abs(cpi[12] − cpi[8]).toFixed(2)` | "Last 4 weeks" ("4 dernières semaines") | LO if cpi[12] < cpi[8] | −0.01 |
| "EAC drift" ("Dérive de l’EAC") | `f(eac[12] − eac[0], true)` | "Since first snapshot" | LO if increased | +€386k |
| "Float lost" ("Marge perdue") | `(float[12] − float[0]) + ' d'` (plain hyphen) | "W27 → W39" | LO if decreased | -31 d |
| "Next status report" ("Prochain rapport d’état") | "2 Oct" (hard-coded) | "One-page PDF + live dashboard link" | OK | |

**Indicator cards** `trendCards` (line 4565), definitions `TKPI` (line 4559) `[key, label, format, target, targetText]`:

| key | Label (FR) | Format | Target (dashed line) | Target text |
|---|---|---|---|---|
| `cpi` (default) | "CPI" | `v.toFixed(2)` | 1 | "≥ 1.00" |
| `spi` | "SPI" | `v.toFixed(2)` | 1 | "≥ 1.00" |
| `eac` | "EAC" | `f(v)` | BAC | `'BAC ' + f(BAC)` |
| `float` | "Critical-path float" ("Marge du chemin critique") | `(v≥0?'+':'−') + |v| + ' d'` | 0 | "≥ 0" |
| `risk` | "Risk exposure (EMV)" ("Exposition aux risques (EMV)") | `f(v)` | none | `'Contingency ' + f(PD.recon.cont)` |
| `slip` | "Milestone slip" ("Glissement des jalons") | `v + ' d'` | 0 | "0 d" |

Card = `<button class="card elev-sm">`, gap 6px, padding 12px 14px, left-aligned, no border; bg `var(--color-accent-900)` + `inset 0 0 0 1px var(--color-accent-700)` when selected (`key === state.trendKpi`), else `var(--color-surface)`. Content: top row label (10.5px uppercase) ↔ target text (no transform); value 22px/500 + sparkline SVG 120×32 (`viewBox 0 0 120 32`, stroke #9184d9 1.5, right-aligned); delta line 11.5px.
- `last = a[12]`, `prev = a[8]` (4 weeks earlier). `worse` = for eac/risk/slip `last > prev`, else `last < prev`. Delta text: cpi/spi `(±)|d|.toFixed(2)`; eac/risk `f(d,true)`; float/slip `(±)|d| + ' d'`; suffix " · 4 wk". Colour LO if worse else neutral-300.
- Sparkline `mini(arr)` (line 4564): `x(i) = i/(n−1)·120`, `y(v) = hi===lo ? 16 : 2 + (1 − (v−lo)/(hi−lo))·28`.
- HLT deltas: CPI −0.01, SPI −0.02, EAC +€76k, Float −9 d, Risk +€50k, Slip +13 d (all LO).
- Click → `setState({trendKpi:key})`.

**Chart card** (lines 1749–1760). Title `trendLabel + ' — 13 weekly snapshots'` ("— 13 instantanés hebdomadaires"); subtitle "Status date every Friday · dashed line = target " + `trendTarget`. SVG `viewBox 0 0 760 220`, width 100 %. `spark(arr, 760, 220, target)` (lines 4561–4563):
```
L=48, R=16, T=14, B=26
lo = min(arr ∪ {target}), hi = max(arr ∪ {target}); pad = (hi−lo)·0.15 || 1; lo −= pad; hi += pad
x(i) = 48 + i/12 · 696 ;  y(v) = 14 + (1 − (v−lo)/(hi−lo)) · 180
```
- `linearGradient#trfill` #9184d9 0.25 → 0. 5 grid lines at `y = 14 + t·180`, t ∈ {0, .25, .5, .75, 1}, x 48→744, stroke #292b31; labels at x 42, end-anchored, `dominant-baseline:middle`, 10.5px, text = selected format of `hi − t·(hi−lo)`.
- Week labels `SNAP_WEEKS[i]` at `x(i)`, y 212, 10.5px.
- Target line (if target ≠ null) at `y(target)`, stroke #75798c, dash 5 4.
- Area = series path + `L x(12) 194 L 48 194 Z`; line stroke #9184d9 width 2.5; last-point marker r 4 fill #161826 stroke accent 2.

**Snapshot history** (lines 1761–1768). Header "Snapshot history" + caption "Frozen at each status date — “what did we forecast in July?”". Table 12.5px, `snapRows` (line 4567) **reversed** (W39 first):

| Column (FR) | Content | Colour |
|---|---|---|
| "Week" ("Semaine") | W27…W39 | |
| "Status date" ("Date d’état") | `SNAP_DATES` 3 Jul … 25 Sep (Fridays) | neutral-300 |
| "CPI" | toFixed(2) | LO if < 0.97 |
| "SPI" | toFixed(2) | LO if < 0.97 |
| "EAC" | `f()` | |
| "Float" ("Marge") | ±n d | LO if < 0 |
| "Risk exposure" | `f()` | |
| "Milestone slip" | n d | |

### 2.5 Interactions & state
| Control | Handler | State |
|---|---|---|
| Indicator card | `c.onClick` | writes `trendKpi` (default `'cpi'`, line 3774) |
| Header "Generate status report" | `afOpen('trends')` | opens AF dialog (below) |

Dialog `AF.trends` — title "Generate status report", `kind:'run'`, submit "Generate PDF" ("Générer le PDF"):

| id | Label (FR) | Type | Options / default | Req |
|---|---|---|---|---|
| period | "Period" ("Période") | select | September 2026 / Q3 2026 / Since project start | |
| audience | "Audience" ("Destinataires") | select | Steering committee / Client / Internal | |
| sections | "Sections" | select | Full report / Summary + KPIs / KPIs only | |
| note | "Manager note" ("Note du chef de projet") | textarea | '' | |

Submit → no data change; toast "Status report generated · PDF ready" ("Rapport d’avancement généré · PDF prêt"). No file is produced (OPEN QUESTION Q9).

### 2.6 Data
- HLT-026: `HLT_SNAPS` (line 3486) — 13-value arrays `cpi, spi, eac, float, risk, slip`; labels `SNAP_WEEKS` (line 3485) and local `SNAP_DATES` (line 4566).
- Other projects (line 4558): linear series over 13 points, `g(end, start)[i] = start + (end−start)·i/12` (3 decimals): cpi from `min(1.02, cpi+0.04)` to `cpi`; spi from `min(1.02, spi+0.03)` to `spi`; eac from BAC to EAC (rounded); float from `max(0, floatDays+20)` to `floatDays`; risk 60 → 90; slip 0 → `max(0, −floatDays)`. (`cpi/spi/eac` here are the EVM values of §1.8.)
- Current-week values equal the live EVM values for HLT (0.917 / 0.90 / 5236 / −27 d / 340 / 39 d).

### 2.7 Cross-links
Budget (CPI/SPI/EAC), Schedule (float, milestone slip), Risks (EMV exposure; target text uses budget contingency), Client portal ("Download status report" is a separate action there).

---

## 3. Contract — `isContract` (template 814–840)

### 3.1 Route, nav, roles
`screen==='contract'` (line 5200); nav `nav('contract','Contract','ph ph-file-text')`, first item of group **Contract** ("Contrat") in the Project section. Roles: director, pm, procurement. Not a `startScreen` option. Crumb extra = contract reference.

### 3.2 Purpose
Single source of the client contract's commercial terms (EPC lump sum, payment terms, retention, liquidated damages, warranty, governing law, scope), its amendments (avenants), bonds/guarantees and the contractual payment-milestone schedule that Billing invoices against.

### 3.3 Layout
Root flex column gap 14px. If `hasContract` (`CONTRACTS[project]` exists — HLT-026 only):
1. KPI row (line 817) — 4 tiles `ctrKpis`.
2. "Contract sheet" card (lines 818–831).
3. Grid `repeat(auto-fit,minmax(min(100%,360px),1fr))` gap 14px `align-items:start` (lines 831–834): "Amendments" card | "Bonds & guarantees" card.
4. "Payment milestones" card (line 835).
Else (line 837) empty state "No contract registered for this project".

### 3.4 Components

**KPI row** `ctrKpis` (line 4883) — the sub-texts are built with an explicit FR branch:

| Label (FR) | Value | Sub (EN / FR) | Colour | HLT |
|---|---|---|---|---|
| "Contract value" ("Montant du contrat") | `f(ctrTotal)` | `f(CT.amount) + ' base · ' + n + ' signed amendment(s)'` / `' de base · ' … ' avenant(s) signé(s)'` | OK | €5.52M · €5.40M base · 1 signed amendment |
| "Amendments pending" ("Avenants en attente") | count not Signed | `f(Σ) + ' awaiting signature'` / "all amendments signed" | accent-300 if > 0 | 1 · €260k awaiting signature |
| "Guarantees in force" ("Garanties en vigueur") | `live + ' / ' + total` | `f(Σ live) + ' outstanding'` (FR "en vigueur") | OK | 1 / 2 · €540k outstanding |
| "Liquidated damages" ("Pénalités de retard") | `CT.ld.split(' · ')[0]` | `CT.ld.split(' · ')[1] + ' · ' + CT.warranty` | OK | 0.5 % per week · cap 10 % · 24 months from SAT |

`ctrTotal = CT.amount + Σ amount of amendments with status 'Signed'` (line 4877). Live bond = state not starting with "Released".

**Contract sheet** (lines 818–831). Header: title "Contract sheet" ("Fiche contrat"), subtitle "Fill in the terms once · billing, change control and the client portal read from here" ("Renseignez les conditions une fois · la facturation, la maîtrise des changements et le portail client s’en servent"); ghost button "Open contract" ("Ouvrir le contrat", `ph ph-file-text`) → `openCtrDoc` = `setState({screen:'docs', dv:{…dv, open: CT.ref}})` (opens the document CTR-HLT-001 in Documents · Codex).
Form grid `repeat(auto-fit,minmax(min(100%,230px),1fr))`, gap 10px 14px; `.field` with `<label>` + control; textarea spans `1 / -1`, `rows=2`, `min-height:56px`, resize vertical. Fields `CTR_FIELDS` (line 4873):

| key | Label (FR) | Control | HLT value |
|---|---|---|---|
| ref | "Reference" ("Référence") | text | CTR-HLT-001 |
| client | "Client" | text | Port authority |
| type | "Contract type" ("Type de contrat") | select: Lump sum (EPC) / Unit rates / Cost plus / Framework agreement (FR: Forfait (EPC) / Bordereau de prix unitaires / Régie / Accord-cadre) | Lump sum (EPC) |
| signed | "Signed on" ("Signé le") | text | 14 Jan 2026 |
| amount | "Base amount (k€)" ("Montant de base (k€)") | number | 5400 |
| terms | "Payment terms" | text | Net 45 days |
| retention | "Retention (%)" ("Retenue (%)") | number | 5 |
| retentionNote | "Retention release" ("Libération de la retenue") | text | Released at final acceptance + 12 months |
| ld | "Liquidated damages" | text | 0.5 % per week · cap 10 % |
| warranty | "Warranty" ("Garantie") | text | 24 months from SAT |
| law | "Governing law" ("Droit applicable") | text | French law · Commercial court of Le Havre |
| scope | "Scope summary" ("Résumé du périmètre") | textarea (full row) | Terminal extension: steel structure, two 250 t gantry cranes, HV connection and yard works — design, supply, erection and commissioning. |

- `onChange = setCtr(k)` (line 4872): writes `state.ctrInfo[project][k] = e.target.value` (string, immediate, no save button, no validation). `CT` merges `ctrInfo` over `CONTRACTS[project]`; `amount` and `retention` are `parseFloat(...) || 0`.
- `disabled = projReadOnly` (note: not disabled in *outside* mode — OPEN QUESTION Q7).
- Changing `amount` instantly recomputes contract value, every milestone amount, Billing KPIs and Cash & recovery; changing `terms` changes the due-date offset (first integer = days); changing `ld` re-splits the KPI tile.

**Amendments card** (line 832). Title "Amendments" ("Avenants"); ghost "Add amendment" (`ph ph-plus`) when `ctrCanEdit` → `addAmendment = afOpen('amendment')`. Rows `ctrAmend` (line 4884), grid `1fr | auto | auto`, gap 10px:
- col 1: label (pretty-wrapped) + date 11px neutral-400 (`date || '—'`);
- col 2: `f(amt)`;
- col 3: status tag (`Signed` → `tag tag-neutral`, anything else → `tag tag-accent`) + optional icon button `ph ph-file-text` (when `doc`) → `setState({screen:'docs', dv:{…, open: doc}})`.
- HLT: "Amendment 1 — anti-collision lidar (CR-004)" €120k Signed 8 Jul 2026 [CTR-HLT-002]; "Amendment 2 — crane upgrade 250 t (CR-006)" €260k Awaiting signature —.

**Bonds & guarantees card** (line 833). Title "Bonds & guarantees" ("Cautions & garanties"); ghost "Add guarantee" when `ctrCanEdit` → `afOpen('bond')`. Rows `ctrBonds` (line 4885), grid `1fr | auto | auto`: label | `f(amt)` | state text 11.5px (neutral-500 if starts with "Released", else neutral-300). HLT: Performance bond €540k "Valid → 30 Jun 2027"; Advance payment bond €540k "Released 12 Sep 2026".

**Payment milestones card** (line 835). Title "Payment milestones" ("Jalons de paiement"), subtitle "Contractual schedule · invoicing is tracked on the Billing page"; ghost "Add payment milestone" when `ctrCanEdit` → `afOpen('milestone')`. Table 13px from `ctrMs` (line 4878):

| Column (FR) | Content |
|---|---|
| "Milestone" ("Jalon") | `id + ' · ' + label` (500) |
| "Share" ("Part", right) | `pct + ' %'` |
| "Amount" (right) | `f(round(ctrTotal · pct/100))` |
| "Contractual date" ("Date contractuelle") | `due` as stored |
| "Condition" | `cond || '—'` (12px neutral-400) |

Footer **Total** row (top border neutral-700, 500): Σ share (`round(x·10)/10 + ' %'`), Σ amount, empty, hint. `ctrSchedTotal` (line 4887): colour text if `|Σpct − 100| < 0.01`, else LO with hint "Shares must total 100 %" ("Les parts doivent totaliser 100 %"). Status is not shown in this table (it is on Billing).
HLT: M1 Permits approved 10 % €552k 12 Mar 2026; M2 Foundations complete 20 % €1.10M 15 Jul 2026; M3 Structure topped out (80 % erected) 25 % €1.38M 26 Sep 2026; M4 Cranes operational 20 % €1.10M 14 Dec 2026; M5 Handover (SAT) 25 % €1.38M 14 Jan 2027 → Total 100 % €5.52M.

### 3.5 Dialogs (Contract)

`AF.amendment` — "Add amendment", submit "Register amendment" ("Enregistrer l’avenant"):

| id | Label (FR) | Type | Default | Req |
|---|---|---|---|---|
| label | "Subject" ("Objet") | text | '' | ✓ |
| cr | "Linked change request" ("Demande de modification liée") | text | '' | |
| amt | "Amount (k€)" | number | '0' | ✓ |
| status | "Status" | select | Draft / Sent for signature / Awaiting signature / Signed | |
| date | "Signature date" ("Date de signature") | text | '' | |
| doc | "Document reference" ("Référence du document") | text | '' | |

Submit → append `{label, cr, amt, status, date, doc, proj, date2:'30 Sep 2026'}` to `state.added.amendments`; rendered as `[label + (cr ? ' (' + cr + ')' : ''), parseFloat(amt)||0, status, date, doc]`. A **Signed** amendment immediately increases the contract value and every milestone amount. Toast `label + ' · Amendment registered'`.

`AF.bond` — "Add guarantee", submit "Register guarantee":

| id | Label (FR) | Type | Options/default | Req |
|---|---|---|---|---|
| label | "Type" | select | Performance bond / Advance payment bond / Retention bond / Warranty bond / Parent company guarantee | |
| amt | "Amount (k€)" | number | '0' | ✓ |
| issuer | "Issuer" ("Émetteur") | text | '' | ✓ |
| valid | "Valid until" ("Valable jusqu’au") | text (free date) | '' | ✓ |

Rendered `[label + ' · ' + issuer, amt, 'Valid → ' + valid]` (always "in force"). Toast `label + ' · Guarantee registered'`.

`AF.milestone` — "Add payment milestone", submit "Add milestone" ("Ajouter le jalon"):

| id | Label (FR) | Type | Default | Req |
|---|---|---|---|---|
| label | "Milestone" ("Jalon") | text | '' | ✓ |
| pct | "Share of contract (%)" ("Part du contrat (%)") | number | '10' | ✓ |
| due | "Contractual date" | text (free date "14 Dec 2026") | '' | ✓ |
| cond | "Condition" | textarea | '' | |

Appended to `added.milestones`; id = `'M' + (base count + i + 1)` (M6, M7…), status Planned. No check that shares stay ≤ 100 % — only the red total hint. Toast "Payment milestone added".

### 3.6 Interactions & state (Contract)
| Control | Handler | State |
|---|---|---|
| Any field | `setCtr(k)` | `ctrInfo[project][k]` |
| Open contract | `openCtrDoc` | `screen='docs'`, `dv.open=CT.ref` |
| Amendment doc icon | `a.openDoc` | `screen='docs'`, `dv.open=doc` |
| Add amendment / header primary | `afOpen('amendment')` | `af`, then `added.amendments` |
| Add guarantee | `afOpen('bond')` | `added.bonds` |
| Add payment milestone | `afOpen('milestone')` | `added.milestones` |

`ctrCanEdit = !projReadOnly && !outside` controls the three "Add" buttons.

---

## 4. Billing & payments — `isBilling` (template 841–869)

### 4.1 Route, nav, roles
`screen==='billing'`; nav `{...nav('billing','Billing','ph ph-receipt'), badge: ctrBadge}` in group **Contract** after Contract. `ctrBadge` (line 4888) = number of **late** milestones (status Planned and `mIdx(due) < PG_NOW`), empty string when 0. Roles: director, pm. Crumb extra = `CT.terms`.

### 4.2 Purpose
Invoice the contractual payment milestones, follow receivables (awaiting / overdue / collected) and the retention held by the client.

### 4.3 Layout
Root flex column gap 14px; if `hasContract`:
1. KPI row (line 844) — 5 tiles `billKpis`.
2. Grid `minmax(min(100%,360px),1fr)` gap 14px `align-items:start`: "Billing progress" card | "To invoice" card.
3. "Invoices" card (table).
Else empty state "No contract registered for this project".

### 4.4 Components

**KPI row** `billKpis` (line 4899):

| Label (FR) | Value | Sub | Colour | HLT |
|---|---|---|---|---|
| "Invoiced" ("Facturé") | `f(ctrInvoiced)` | `round(inv/total·100) + ' % of contract'` | OK | €3.04M · 55 % of contract |
| "Collected" ("Encaissé") | `f(ctrPaid)` | `round(paid/inv·100) + ' % of invoiced'` (FR "% du facturé") | OK | €1.66M · 55 % of invoiced |
| "Outstanding receivables" ("Créances en attente") | `f(inv − paid)` | `n + ' invoice(s) awaiting payment · ' + CT.terms` | accent-300 if > 0 | €1.38M · 1 invoice awaiting payment · Net 45 days |
| "Overdue receivables" ("Encours en retard") | `f(Σ overdue)` | `n + ' invoice(s) past due date'` / "no late payment" | LO if any | €0k · no late payment |
| "Next to invoice" ("Prochain jalon à facturer") | first Planned id or '—' | `label · due · f(amt)` / "all milestones invoiced" | LO if that milestone is late | M4 · Cranes operational · 14 Dec 2026 · €1.10M |

`ctrInvoiced = Σ amt of milestones with status ≠ Planned`; `ctrPaid = Σ amt with status Paid` (line 4879).

**Billing progress card** (lines 846–853). Header baseline-aligned: title "Billing progress" ("Avancement de la facturation") + right "Contract value · " + `ctrBill.total` (text colour). Stacked bar: height 10px, radius 5, bg neutral-800, overflow hidden: paid segment accent (`paidW = paid/total`), invoiced-unpaid segment accent-700 (`invW = (inv−paid)/total`), widths clamped 0–100 %, `toFixed(1)+'%'`. Legend rows (grid `12px | 1fr | auto | auto`): dot, label, share (11.5px neutral-400, `toFixed(1) + ' %'`), amount (min-width 72px, right):
- "Collected" — dot accent — €1.66M — 30.0 %
- "Invoiced, awaiting payment" ("Facturé, en attente de paiement") — dot accent-700 — €1.38M — 25.0 %
- "Not yet invoiced" ("Reste à facturer") — dot neutral-700 — €2.48M — 45.0 %
- Retention row: icon `ph ph-lock-key`, "Retention held by client" ("Retenue de garantie") + note `retention + ' % · ' + retentionNote` (11px), amount `f(round(ctrPaid · retention/100))` → €83k. (Retention is computed on *collected* amounts.)

**To invoice card** (lines 854–858). Title "To invoice" ("À facturer"), subtitle "Planned milestones in contractual order · a date already passed is flagged". Rows `ctrToInvoice = ctrMs.filter(status==='Planned')` (grid `1fr | auto | auto`, padding 7px 0): `id · label` (500) + line 2 (11px, LO if late else text) `due · pct %` + " · Late" ("En retard") when late; `f(amt)`; button "Issue invoice" (`btn btn-secondary`, 12px) when `ctrCanEdit` → `m.issue` = `afOpenWith('billing', {ms: id + ' · ' + label})` (dialog pre-selects the milestone). Empty: "All milestones invoiced" (12.5px neutral-500).

**Invoices card** (lines 860–864). Title "Invoices" ("Factures"). Table 13px, rows `ctrInvoices` (line 4896) = milestones with status ≠ Planned, in milestone order:

| Column (FR) | Content |
|---|---|
| "Invoice" ("Facture") | `ctrInv[id].no` or generated `'INV-2026-' + seq(3 digits)` (seq counts invoiced milestones in order) |
| "Milestone" ("Jalon") | `msId · label`; optional 2nd line = invoice note (11px) |
| "Issued on" ("Émise le") | `fmtInvD(parseD(m.inv))` (year shown only if ≠ 2026) |
| "Amount" (right) | `f(amt)` |
| "Payment due" ("Échéance de paiement") | `issued + ctrTermsDays` days; LO if overdue |
| "Paid on" ("Payé le") | `m.paid` (neutral-300) |
| "Status" ("Statut") | tag: Paid → `tag tag-neutral`; Overdue → `tag tag-accent`; Awaiting payment → `tag tag-outline` |
| (action) | "Mark paid" ("Marquer payé", `btn btn-primary` 12px) when status Invoiced **and** `ctrCanEdit` → `inv.pay` |

`overdue = status==='Invoiced' && dueDate < NOWD (30 Sep 2026)`. Empty: "No invoice issued yet".
HLT: INV-2026-001 · M1 · 12 Mar · €552k · 26 Apr · 2 Apr · Paid; INV-2026-002 · M2 · 15 Jul · €1.10M · 29 Aug · 29 Aug · Paid; INV-2026-003 · M3 · 26 Sep · €1.38M · 10 Nov · — · Awaiting payment · [Mark paid]. (The prototype adds `45 × 86 400 000 ms`, which shows "9 Nov" in a Europe/Paris browser because of the DST change — use calendar-day arithmetic.)

### 4.5 Dialog `AF.billing` — "Issue invoice" (`kind:'run'`, submit "Issue invoice")

| id | Label (FR) | Type | Options / default | Req |
|---|---|---|---|---|
| ms | "Milestone" ("Jalon") | select | `MSPLAN` = Planned milestones `id · label`; preselected when opened from a row; otherwise first option | |
| no | "Invoice number" ("Numéro de facture") | text | pre-filled `ctrNextInvNo = 'INV-2026-' + (invoices+1)` (via `AF_DYN`, line 5112) → HLT "INV-2026-004" | ✓ |
| date | "Invoice date" ("Date de facture") | text | "30 Sep 2026" | ✓ |
| note | "Note on the invoice" ("Mention sur la facture") | textarea | '' | |

Submit (line 5127): `msId = ms.split(' · ')[0]`; `ctrOv[msId] = 'Invoiced'`; `ctrInv[msId] = {no: no.trim() || ctrNextInvNo, date: date || '30 Sep 2026', note}`. Toast `no + ' · ' + msId + ' · Invoice issued · sent to the client'`. The milestone then shows `inv = ctrInv[id].date` and leaves "To invoice"; Cash & recovery moves its projected receipt to `invoice month + termsM`.

### 4.6 Interactions & state (Billing)
| Control | Handler | State |
|---|---|---|
| Header "Issue invoice" (only if a Planned milestone exists) | `afOpen('billing')` | `af` |
| Row "Issue invoice" | `m.issue` | `af` with `ms` preset |
| "Mark paid" | `inv.pay = setSt('Paid')` | `ctrOv[id] = 'Paid'`; displayed paid date becomes "30 Sep"; no toast, no confirmation |

---

## 5. Contingency register — `isContingency` (template 900–909)

### 5.1 Route, nav, roles
`screen==='contingency'` (line 5204); nav `nav('contingency','Contingency','ph ph-piggy-bank')`, group **Steering**, after "Hours (Lucca)". Roles: director, pm.

### 5.2 Purpose
Track the project's contingency provision (provision pour aléas): initial amount, draw-downs with justification and approver, and compare consumption with project progress and with the open-risk exposure (EMV) it must still cover.

### 5.3 Layout
Root flex column gap 14px: KPI row (line 902, 4 tiles) → grid `repeat(auto-fit,minmax(min(100%,560px),1fr))` gap 14px `align-items:start`: "Contingency use vs project progress" card (line 904) | "Draw-downs" card (line 905). No empty state: projects without `CONTINGENCY` data get `initial = round(BAC·0.03)` and no draws.

### 5.4 Components

**KPI row** `cgKpis` (line 4966):

| Label (FR) | Value | Sub | Colour | HLT |
|---|---|---|---|---|
| "Initial provision" ("Provision initiale") | `f(initial)` | `round(initial/BAC·100) + ' % of budget'` | neutral-200 | €150k · 3 % of budget |
| "Drawn" ("Consommé") | `f(used)` | `usedPct + ' % used · project ' + progPct + ' % complete'` | LO if usedPct > progPct | €48k · 32 % used · project 64 % complete |
| "Remaining" ("Reste") | `f(initial − used)` | `n + ' draw-downs'` | OK | €102k · 3 draw-downs |
| "Exposure (open risks EMV)" ("Exposition (EMV des risques ouverts)") | `f(Σ emv of open risks)` | "exceeds remaining provision" / "covered by remaining provision" | LO if exposure > remaining | €340k · exceeds remaining provision |

`usedPct = round(used/initial·100)`; `progPct = round(proj.progress·100)`; open risks = `risks.filter(status==='Open')` from the Risk register (line 4578; HLT `RISKS_HLT` EMVs 120+60+45+36+40+24+15 = 340, plus risks added in-session).

**"Contingency use vs project progress" card** (line 904):
- Row "Drawn" ↔ `cgUsedPct` ("32 %"); track 8px radius 4 bg neutral-800, overflow hidden, two absolute layers: exposure layer width `cgBarEmv = min(100, round((used+EMV)/initial·100)) %` with hatch `repeating-linear-gradient(135deg, var(--color-accent-800) 0 3px, transparent 3px 7px)`; drawn layer width `cgBarUsed = min(100, usedPct) %`, solid accent, radius 4.
- Row "Project progress" ("Avancement projet") ↔ `cgProgPct`; track 8px; fill neutral-400 width `min(100, progPct) %`.
- Legend 11.5px: hatched swatch 14×8 + "Exposure (drawn + open risks EMV)" ("Exposition (consommé + EMV des risques ouverts)").
- HLT: drawn 32 %, exposure 259 % → clamped 100 %, progress 64 %.

**"Draw-downs" card** (line 905). Table 12.5px `cgRows` (line 4964) = draws **most recent first** (reverse of stored order):

| Column (FR) | Content |
|---|---|
| "Date" | as stored ("12 Sep"); added ones "30 Sep" |
| "Amount" ("Montant", right) | `f(amt)` |
| "Reason" ("Motif") | text, min-width 220px |
| "Linked to" ("Lié à") | reference text or '—' (12px neutral-300, no link behaviour) |
| "Approved by" ("Approuvé par") | name |

HLT: 12 Sep €12k "Re-weld K-12 splice — NCR-026" NCR-026 R. Aubert; 30 Jul €14k "Second mill qualification — steel supply risk R-03" R-03 R. Aubert; 18 Jun €22k "Soft ground at Bay 4 — additional piling (part not covered by CR-004)" CR-004 M. Lefebvre.

### 5.5 Dialog `AF.contingency` — "Contingency draw-down" ("Prélèvement sur provision"), submit "Record draw-down"

| id | Label (FR) | Type | Options / default | Req |
|---|---|---|---|---|
| amount | "Amount (k€)" | number | '' | ✓ |
| reason | "Reason" ("Motif") | textarea (full row) | '' | ✓ |
| link | "Linked to" ("Lié à") | text | **pre-filled "CR / risk / NCR"** (literal value, OPEN QUESTION Q8) | |
| approver | "Approved by" | select | "R. Aubert · Project manager" / "M. Lefebvre · Portfolio director" | |

Submit → `added.draws` += `{amount, reason, link, approver, proj, date2}`; rendered `['30 Sep', parseFloat(amount)||0, reason, link, approver.split(' · ')[0]]`. No check against remaining provision; no approval workflow. Toast "Draw-down recorded" ("Prélèvement enregistré").

---

## 6. Data entities (field level)

Units: amounts in k€ (number); months as index 0 = Jan 2026; dates are display strings in the mock ("14 Dec 2026", "12 Sep").

**ProjectFinancials (`PD` = `projectData()` / `HLT_PD`)**

| Field | Type | Meaning / example |
|---|---|---|
| `PV` | number[12] | cumulative planned value by month end; HLT `HPV` (…4800) |
| `EV` | number[EVn] | cumulative earned value to date; HLT `HEV` = 170…3080 |
| `AC` | number[EVn] | cumulative actual cost; HLT `HAC` = 175…3360 |
| `BAC` | number | current budget = original + approved CRs (HLT 4800) |
| `OFFER` | OfferQuote[] | commercial-offer quotes |
| `STREAMS` | [name, basis][] | other cost streams (display only) |
| `CATS` | [name, budget, actual, committed, forecast][] | cost breakdown |
| `CAT_ROWS` | [code, name, type, source, budget][] | category set-up |
| `WPS` | [wbs, name, original, changes, actual, eac][] | budget per work package |
| `CRS` | [id, title, amount, days, status, meta][] | budget change requests |
| `start`, `tNow`, `pct`, `floatDays` | number | project start month, "now" in months since start (8.8), progress %, float |
| `chartMonths` | string[12] | x-axis labels |
| `baselineSet` | string | "12 Mar 2026" |
| `recon` | {orig, chg, crCount, pending, pendingSub, cont, contUsed} | reconciliation tiles |
| `note` | string | narrative under the variance card |

**OfferQuote (`HLT_OFFER`, line 3097)** — `{sys: string, sup: string, amt: number, terms: "30 / 60 / 10" (deposit / delivery / acceptance %), order: month, deliv: month, acc: month|null, lead: weeks}`. HLT: Structural steel 640 (Keystone Steelworks, 30/60/10, 2→5→8, 14 wk); Crane rails A100 + fixings 290 (Halvorsen Cranes, 30/70, 3→9, 26 wk); 11 kV switchgear + 2 MVA transformers 420 (Nordvolt, 20/70/10, 1→9→11, 34 wk); Crane drives, VFDs & control cabinets 360 (Halvorsen Cranes, 30/60/10, 4→10→11, 26 wk).

**DisbursementPoint (`offerPoints()`, line 3099)** — `{m: month (≤11), k: 'order'|'deliv'|'acc', pct, amt: round(q.amt·pct/100), sys, sup}`.

**CostStream (`HLT_STREAMS`, line 3098)** — `[name, basis, monthly[12]]`: Labor 1850; Site materials & consumables 390; Subcontract — piling & earthworks 260; Subcontract — MEP 300; Permits & fees 140; Contingency 150 (12/13 per month).

**RexFinancialPattern (`REX_FIN`, line 3101)** — keyed by machine type (`EMP`, `MEMU`, `SPUR`, `AUTRE`, `R&D`): `{dep, deliv, acc: %, refs: [id, name, year, patternText][]}`; e.g. EMP 30/60/10 with HAV001 "Terminal Ouest — Dunkerque" 2023 and ANT002 "Quai 7 — Antwerp" 2024; SPUR 20/70/10; R&D 50/50/0. Also consumed by Machine types (line 5085).

**CostCategory (`HCAT_ROWS` line 3192 + `HCATS` line 3112)** — code `C01…`, name, type ∈ {Labor, Material, Equipment, Subcontract, Fees, Reserve}, actuals source (`SRC_OF`), budget, actual, committed, forecast. Settings list `SETTINGS0.costCats` (line 3467) holds the default category names.

**BudgetChangeRequest (`HCRS`, line 3193)** — id, title, amount (k€, signed), days (schedule impact, signed), status ∈ {Approved, Pending, Rejected}, meta ("date · decider").

**WorkPackageBudget (`HWPS`, line 3194)** — wbs ("1.1"…, "—" for unallocated contingency), name, original, changes, actual, EAC. HLT originals sum 4600, changes 200 (1.2 +120, 1.4 +65, 1.6 +15).

**Baseline (`BASELINES`, line 3504; rendered by the Changes screen, line 4605)** — `[id, name, date, bac, finish, state]`, state ∈ {Superseded, Current, Proposed} → tags neutral / accent / outline. BL0 Proposal estimate 18 Jan 2026 4400 18 Nov 2026 Superseded; BL1 Approved baseline 12 Mar 2026 4600 18 Dec 2026 Current; BL2 Recovery re-baseline "Pending CR-009" 4885 14 Jan 2027 Proposed.

**SnapshotSeries (`HLT_SNAPS`, line 3486; `SNAP_WEEKS` line 3485; `SNAP_DATES` line 4566)** — per week W27…W39 (Fridays 3 Jul…25 Sep 2026): `cpi`, `spi` (ratio), `eac` (k€), `float` (days, signed), `risk` (EMV k€), `slip` (days). A real implementation should persist one frozen snapshot record per status date: `{projectId, weekId, statusDate, cpi, spi, eac, floatDays, riskEmv, milestoneSlipDays}`.

**Contract (`CONTRACTS`, line 3713; editable overlay `state.ctrInfo[project]`)**

| Field | Type | HLT |
|---|---|---|
| ref | string | CTR-HLT-001 (also a Codex document id) |
| client | string | Port authority |
| signed | date string | 14 Jan 2026 |
| amount | k€ | 5400 (base) |
| terms | string; first integer = days | Net 45 days |
| retention | % | 5 |
| retentionNote | string | Released at final acceptance + 12 months |
| ld | string "rate · cap" | 0.5 % per week · cap 10 % |
| warranty | string | 24 months from SAT |
| type | enum | Lump sum (EPC) / Unit rates / Cost plus / Framework agreement |
| law | string | French law · Commercial court of Le Havre |
| scope | text | … |
| amendments | Amendment[] | |
| bonds | Bond[] | |
| milestones | PaymentMilestone[] | |

**Amendment** — `[label, amount k€, status, signatureDate, docRef]`; status ∈ {Draft, Sent for signature, Awaiting signature, Signed}; added ones carry `cr` (appended to label in parentheses).
**Bond** — `[label, amount, state]`; state "Valid → <date>" or "Released <date>"; added ones carry `issuer`, `valid`.
**PaymentMilestone** — `[id, label, sharePct, contractualDue, status, invoiceDate, paidDate]` + `cond` for added ones; status ∈ {Planned, Invoiced, Paid}; overrides `state.ctrOv[id]` (status) and `state.ctrInv[id] = {no, date, note}` (invoice meta). Amount is derived: `round(contractValue · share/100)`.
**Invoice (derived)** — `{no, msId, label, issued, amount, due = issued + termsDays, paid, status ∈ {Awaiting payment, Overdue, Paid}, note}`.

**ContingencyRegister (`CONTINGENCY`, line 3720)** — `{initial: k€, draws: [date, amount, reason, linkRef, approvedBy][]}`; in-session additions in `state.added.draws`. Default when absent: `initial = round(BAC·0.03)`.

**Legacy billing plan (`BILLING`, line 3541)** — `{projectCode: [model, contractValue, [name, amount, status ∈ Paid|Invoiced|Planned][]]}` for HLT-026, NDC-031, RCF-019, ERP-202 (internal capex, value 0), WSA-044, MSR-012. Consumers: Portfolio prioritisation margin (line 4500), Portfolio cash `billingOf()` (line 4515, which prefers `CONTRACTS` + `ctrOv` when a contract exists), Client portal invoices (line 4685–4687, reads `BILLING` directly, invoice numbers `F-2026-101…`).

**`CASH_M` (line 3542)** — 6 month labels "Oct, Nov, Dec, Jan ’27, Feb, Mar" for the Portfolio cash 6-month bars, with hard-coded `cashIn = [1350,0,1080,0,1350,585]` and `cashOut = [820,760,700,640,560,520]` scaled by the zone share; bar heights `v/1500·100 %` (lines 4518–4520).

**UI state keys (this area)** — `budgetTab` ('perf'|'setup'|'cash'), `trendKpi` ('cpi'|'spi'|'eac'|'float'|'risk'|'slip'), `ctrInfo`, `ctrOv`, `ctrInv`, `added.amendments`, `added.bonds`, `added.milestones`, `added.draws`, `af` ({open, key, values}), `toast`, `project`, `role`, `lang`.

---

## 7. Status machines / workflows

- **Payment milestone** (Contract/Billing): `Planned → Invoiced` (Issue invoice dialog: `ctrOv[id]='Invoiced'`, `ctrInv[id]={no,date,note}`) `→ Paid` ("Mark paid": `ctrOv[id]='Paid'`, paid date = "30 Sep"). Derived flag **late** = Planned and contractual date < status date (red sub-text, "· Late", nav badge count on Billing). No backward transitions, no cancel.
- **Invoice** (derived from milestone): `Awaiting payment → Overdue` (computed when due date < 30 Sep 2026) `→ Paid`. Tags: outline / accent / neutral.
- **Amendment**: status chosen at creation among Draft / Sent for signature / Awaiting signature / Signed; no transition UI. Only `Signed` amendments add to the contract value (tag neutral); all others are "pending" (tag accent) and summed in "Amendments pending".
- **Bond**: Valid → Released (data only; no UI transition). Released bonds are excluded from "Guarantees in force".
- **Budget change request** (Budget tab, read-only): Pending / Approved / Rejected (tags outline / accent / neutral). Approved amounts are reflected in `recon.chg` and WP "Changes"; Pending in `recon.pending`. The live CR workflow (Draft → In review → Approved/Rejected with PM / director / client / CCB approval chain) lives on the Changes screen with a different dataset (`HLT_CRS_X`, line 3498) — see Q6.
- **Baseline**: Superseded / Current / Proposed (BL0 → BL1 → BL2 via CR-009 re-baseline; Changes/Schedule screens).
- **Contingency draw-down**: append-only, recorded with an approver name (select), no approval step.
- **Status report**: one-shot "run" action, no persisted state.

---

## 8. Cross-links

| From | To | Mechanism |
|---|---|---|
| Budget › Performance "See profile" / header "Change request" | Budget › Structure & changes | `budgetTab='setup'` |
| Budget › Structure "Open plan" | Plan — WBS (`plan`) | `screen='plan'` |
| Portfolio alert "Open budget" | Budget (HLT-026) | `setState({screen:'budget', project:'HLT-026'})` (line 3811) |
| Changes › CR detail "Open budget" / "Open plan" | Budget / Plan | `goTo('budget')`, `goTo('plan')` (line 4610) |
| Contract "Open contract" / amendment doc icon | Documents · Codex (`docs`) | `screen='docs'`, `dv.open = ref` |
| Contract milestones | Billing (To invoice, Invoices), Budget › Cash & recovery (receipts), Portfolio cash (`billingOf`) | shared `ctrMs` / `ctrOv` |
| Contract terms (`terms`) | Billing due dates, Cash recovery receipt lag | first integer of `terms` |
| Billing "Issue invoice" | AF dialog `billing` | `afOpenWith('billing', {ms})` |
| Contingency exposure | Risk register (open risks EMV, incl. risks added in-session) | `openRisks` |
| Contingency draw-down "Linked to" | CR / risk / NCR ids (text only, no navigation) | – |
| Trends risk target | Budget reconciliation contingency (`PD.recon.cont`) | – |
| Client portal invoices / KPIs | `BILLING` (not `CONTRACTS`) and `PD.recon.chg` | lines 4685–4687 |
| Map iframe / project picker | any of these screens for the chosen project | `state.project` |

---

## 9. Open questions

1. **Q1 — KPI colouring.** Budget KPIs "Forecast (EAC)", "Variance (VAC)", "CPI", "TCPI" are always LO (accent-300) whatever the value; Variance-card values are always accent-300. Should colours be threshold-based like elsewhere (`< 0.97` → LO)?
2. **Q2 — Variance bars sign.** `cvBars` use `|EV−AC|` and always hang downward; a positive cost variance would look identical to an overrun. Intended rendering of positive months?
3. **Q3 — Synthetic EVM for non-HLT projects.** EV is shaped on PV and scaled to `BAC·progress`, so EVM SPI (e.g. NDC-031: 1.34) contradicts the project's `spi` field (0.98) and the trend series. In the real app EV/AC come from progress and actuals — confirm the source systems (timesheets "Lucca", purchase orders/receipts "Sage X3", certified claims).
4. **Q4 — Dead controls.** "Add category", category pencil, "New change request" (Budget › Structure) and header "Export" have no handler; header "Change request" only switches tab. Should they open the category editor / the Changes screen's "New change request" dialog (`afOpen('changes')`)?
5. **Q5 — Projects without `DEFS`.** `projectData` returns Harbor Line data for every project not in `DEFS` (the extra portfolio projects). Expected behaviour: empty state, or generated data?
6. **Q6 — Two inconsistent change-request datasets.** Budget uses `HCRS` (CR-007 "MEP routing rework around crane rails" +3 d; CR-008 −18 d "Pending"; CR-005 Rejected) while Changes uses `HLT_CRS_X` (CR-007 "Yard drainage re-routing" 0 d; CR-008 −12 d "In review"; CR-009 Draft; no CR-005). WP changes map CR-004 to 1.2 although `HLT_CRS_X` says WBS 1.3. Contract amendments cite CR-004 as "anti-collision lidar" (€120k) and CR-006 as €260k vs €65k budget. Which is authoritative? A single CR entity should feed Budget reconciliation, WP changes, Contract amendments and the client portal.
7. **Q7 — Edit rights.** Contract fields are disabled only when `projReadOnly`, not in *outside* mode, while the Add buttons use `ctrCanEdit` (both). Procurement (no "mine" projects) can edit every contract field. Who may edit contract terms, issue invoices and mark them paid (finance role?)?
8. **Q8 — Contingency "Linked to" default.** The dialog pre-fills the literal value "CR / risk / NCR" (meant as a placeholder?). Should it be a placeholder or a picker of existing CR / risk / NCR ids?
9. **Q9 — Status report output.** "Generate PDF" only toasts. Report content/layout per audience (Steering committee / Client / Internal) and sections is undefined.
10. **Q10 — Contingency figures disagree.** Budget reconciliation and the portfolio alert show "139% drawn · +€58k over" (`contUsed` 208 = forecast), while the Contingency register shows €48k drawn (32 %). Draw-downs recorded on the register do not update Budget (`recon`, Contingency category/WP rows). Which figure is "drawn"?
11. **Q11 — Hard-coded "now".** Status date 25 Sep 2026, `PG_NOW` 8.97, `NOWD` 30 Sep 2026, literal "30 Sep" for invoice/payment/draw dates, `openCommit = 713` for HLT, "Next status report 2 Oct". Confirm the rule for the real status date (weekly Friday freeze?) and for "orders placed" (open PO value from procurement).
12. **Q12 — Due-date arithmetic.** Invoice due date adds `days × 86 400 000 ms` (DST-sensitive: 26 Sep + 45 d shows 9 Nov in Paris). Also, should due dates use calendar days from invoice date or end-of-month rules ("45 jours fin de mois")?
13. **Q13 — Milestone share validation.** Adding milestones can push the schedule above 100 % (only a red total hint). Block submission, or allow and warn?
14. **Q14 — Retention basis.** Retention = `paid × retention %`. Should it be computed on invoiced amounts (usual withholding on each invoice) and deducted from invoice amounts/receipts in the cash-recovery curve?
15. **Q15 — Client portal source.** Contract sheet says the client portal reads from it, but the portal reads `BILLING` (5400 base, different milestone amounts, invoice ids F-2026-1xx vs INV-2026-00x). Align on `CONTRACTS`?
16. **Q16 — i18n of data values.** In FR, select option values are translated and stored translated (an amendment created as "Signé" is not counted as signed). Confirm the rebuild uses enum keys; also several labels have no FR (see §0.7).
17. **Q17 — Multi-currency.** `currency` prop switches the symbol only; data are k€. Is real multi-currency (e.g. the R-15 EUR/USD Halvorsen exposure) in scope?

---

## Addendum (completeness pass)

Empty-state and guard flags described above without their identifiers:

| Flag | Template line | Logic (render-values line) | Screen / place | EN text | FR text |
|---|---|---|---|---|---|
| `noRec` | 479 | `!recChart` (5186); `recChart` exists only when `CONTRACTS[project]` exists | Budget › "Cash & recovery" tab | "No contract registered for this project" | "Aucun contrat enregistré pour ce projet" |
| `noContract` | 837 (Contract), 866 (Billing) | `!CT` (5200) | Contract and Billing screens (complement of `hasContract`) | "No contract registered for this project" | same |
| `noToInvoice` | 857 | `!ctrToInvoice.length` (5200) | Billing › "To invoice" card | "All milestones invoiced" | "Tous les jalons sont facturés" |
| `noInvoices` | 863 | `!ctrInvoices.length` (5200) | Billing › "Invoices" card | "No invoice issued yet" | "Aucune facture émise pour l’instant" |

`ctrCanEdit = !projReadOnly && !outside` (5200) gates the Contract edit buttons (template 832, 833, 835) and the Billing "Issue invoice" / "Mark paid" buttons (template 856, 862). The only seeded contract is `CONTRACTS['HLT-026']` (line 3713), so every other project shows these empty states.
