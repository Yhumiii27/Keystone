# 10 — Site, document vault (Codex), document types, activity & integrations, settings, My work, task detail

Source of truth: `design/Keystone PM v8.dc.html`. Template line numbers below are identical in `design/_extracted/template-annotated.html` (where every `{{ T.kN }}` is shown as «English text»). Logic lives in `class Component` → `renderValsEN()`; "logic" line numbers refer to the prototype file. Labels are quoted in English as authored; the French shown is the one the FR layer (`FR_DICT` / `FR_RULES`, lines 3752–3758) produces. "— (no FR)" means the string is missing from the dictionary and **renders in English even when the UI is in French** (the app boots in French, `state.lang:'fr'`, line 3774).

| Screen | Route key (`state.screen`) | Template flag | Template lines | Logic lines | Nav location | `startScreen` option | Roles (`ROLE_SCREENS`) |
|---|---|---|---|---|---|---|---|
| Settings — personalisable lists | `settings` | `isSettings` | 1573–1597 | 4437–4445 (+ `SETTINGS0` 3467) | Sidebar › **Administration** › "Settings" | yes | director, pm, depthead, englead, quality, procurement |
| Activity, integrations & audit ("plumbing") | `plumbing` | `isPlumbing` | 2237–2267 | 4692–4718 | Sidebar › **Administration** › "Activity & integrations" | no | director, pm |
| Site (chantier) | `site` | `isSite` (+ `isSiteProj` / `siteNotProj`) | 2268–2309 | 4739–4760 | Sidebar › **Project** › *Site & handover* › "Site (chantier)" | yes | director, pm, depthead, member |
| Documents — Codex index (vault) | `docs` | `isDocs` | 2310–2345 | 5019–5062 | Sidebar fixed entries (top) › "Documents · Codex" | no | every role |
| ↳ Document record drawer | (overlay, `dv.open`) | `showDoc` | 2346–2362 | 5040–5047 | opened from vault rows and from other screens | — | — |
| ↳ "Deposit in Codex" dialog | (overlay, `dv.dep.open`) | `depOpen` | 2363–2374 | 5048–5060 | primary button on Documents, "New revision" in the drawer, PLM part drawer | — | — |
| Document types register (Codex) | `doctypes` | `isDocTypes` | 2375–2383 | 5198 (`docTypesRows`) | Sidebar › **Administration** › "Document types register (Codex)" | no | director, pm, quality |
| My work ("My tasks") | `mywork` | `isMyWork` | 2813–2901 | 4058–4083 | Sidebar fixed entries (top) › "My tasks" | yes | director, member |
| Task detail | `task` | `isTask` | 2902–2969 | 4085–4107 | not in nav (highlights "My tasks") | yes | director, member |

Also covered: `SETTINGS0`, `CONNECTORS`, `IMPORTS`, `AUDIT`, `ACTIVITY`, `NOTIFS` (count only), `SITE*` constants, `DOC_FAM`, `DOC_TYPES`, `DOC_TYPE`, `DOC_WHO`, `DOCS`, `DOC_SVC`, `DOC_VIEWS`, `DOC_STATUSES`, the `dv` state (vault + deposit), the shared document-override store `engOv`, `TODOS`, `CHECKS`, `COMMENTS`, `FILES`, `ENTRIES`, `DESC`, the action forms `AF.plumbing` and `AF.site`.

---

## 0. Shared conventions in this area

The page shell (sidebar, header, global search, notifications, FR/EN switch, role menu, "Outside my workspace" banner) is specified in `01-shell-navigation-i18n.md`; tokens/classes in `02-design-system.md`. Only what these screens rely on is repeated here.

### 0.1 Header per screen (titles `titles` line 5109, breadcrumb `crumbOf()` + `CRUMB_EXTRA` 5162–5163, primary map `primary` 5137, `hasPrimary` 5177)

| Screen | Title EN / FR | Breadcrumb EN / FR | Project picker in header (`showProjectPicker`) | Primary button EN / FR → handler |
|---|---|---|---|---|
| settings | "Settings — personalisable lists" / "Paramètres — listes personnalisables" | "Administration" | no | "Reset to defaults" / "Réinitialiser" → `setState({settings: deepClone(SETTINGS0)})` (no confirmation) |
| plumbing | "Activity, integrations & audit" / "Activité, intégrations et audit" | "Administration · all projects" / "Administration · tous les projets" | no | "Add connector" / "Ajouter un connecteur" → `afOpen('plumbing')` (§2.6) |
| site | "Site — readiness, mobilisation & execution" / "Chantier — préparation, mobilisation et exécution" | "Project · Site & handover · international site" / "Projet · Chantier & transfert · chantier international" | **yes** | "Daily report" / "Rapport journalier" → `afOpen('site')` (§3.7). Hidden when `projReadOnly` |
| docs | "Documents — Codex index" / "Documents — index Codex" | "Documents · numbered, tagged, versioned" / "Documents · numérotés, tagués, versionnés" | **yes** | "Deposit in Codex" / "Déposer dans Codex" → `dv.dep = {...dv.dep, open:true, step:1, ctx:''}` (§4.6) |
| doctypes | "Document types register (Codex)" / "Registre des types de documents (Codex)" | "Administration · one circuit and one retention rule per type" / "… · un circuit et une règle de conservation par type" | no | none (`primary` has no `doctypes` key → button hidden) |
| mywork | "My work" / "Mon travail" | "My work · {person}" | no | "Log time" (— no FR) → `openTask(open[0] \|\| mine[0] \|\| TSK)` i.e. navigates to the first open task of the viewed person (array order of `TODOS`, not sorted) |
| task | `{task.title}` (e.g. "Survey verticality — Bay 3 columns") | "My work · {task.id}" | no | "Mark done" / "Marquer terminé" → `setTask({status:'done', pct:100})` |

`hasPrimary` = label and handler exist **and** not `outside` **and** not (`projReadOnly` and screen ∈ project-scoped list, which includes `site` but not `docs`). The header also always shows a secondary "Export" button (`ph ph-export`, no handler). The primary button always carries the icon `ph ph-plus`.

"Outside my workspace": if `ROLE_SCREENS[role]` does not contain the screen (for `task` the check uses `mywork`), a read-only banner is shown and the primary button hidden (see 01).

### 0.2 Sidebar entries and badges (logic 5143–5153)

| Entry | Section | Icon | Badge rule |
|---|---|---|---|
| "My tasks" (FR "Mes tâches") → `mywork` | fixed top entries (`navWork`) | `ph ph-check-square` | number of the viewed person's open tasks due today (`open.filter(t=>t.due===TODAY).length`), empty if 0. Item is also highlighted when `screen==='task'` |
| "Documents · Codex" → `docs` | fixed top entries (`navDocs`) | `ph ph-books` | count of **all** vault rows (all projects) with status `Release proposed`; initial value "1" |
| "Site (chantier)" (FR "Chantier") → `site` | Project › group *Site & handover* (with "Commissioning & handover") | `ph ph-hard-hat` | text `NO GO` when the current project is `HLT-026` and the Go-chantier verdict is not GO (initially shown) |
| "Settings" (FR "Paramètres") → `settings` | Administration | `ph ph-gear-six` | none |
| "Document types register (Codex)" → `doctypes` | Administration | `ph ph-list-checks` | none |
| "Activity & integrations" (FR "Activité et intégrations") → `plumbing` | Administration | `ph ph-plugs-connected` | `!` when any connector has status `Warning` (initially shown: Outlook / Exchange) |

Administration order: Settings, Machine types, Document types register (Codex), Activity & integrations.

### 0.3 Recurring building blocks (exact markup reused by every screen here)

- **KPI tile** — `div.card.elev-sm`, `gap:3px; padding:12px 14px`. Label 10.5px, `letter-spacing:0.08em`, uppercase, `--color-neutral-400`; value 22px, weight 500, `letter-spacing:-0.02em`, colour `k.color`; sub 11.5px `--color-neutral-400` (+ `text-wrap:pretty` on Plumbing, Site, Docs). Grid: `display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px` (all screens here).
- **Colour constants** (line 3135): `LO = 'var(--color-accent-300)'` (attention), `OK = 'var(--color-text)'`. Note the DS has no red/green: "bad" values are accent-300, "good" values plain text.
- **Segmented control** (`seg(opts, cur, set)`, line 3889) — `.seg` (flex, wrap) of `button.seg-opt`: no border/background, `font-size:12px; padding:4px 10px; gap:6px`, optional leading icon. Selected: `color:var(--color-accent); box-shadow: inset 0 0 0 1px var(--color-accent)`; unselected: `color:var(--color-neutral-300)`. Every option after the first has `border-left:1px solid var(--color-divider)`. It is usually preceded by a caption: icon (15px, accent) + `FL.view` = "Display" (FR "Vue") / `FL.scope` = "Scope" (FR "Périmètre") / `FL.source` = "Source" / `FL.family` = "Family" (FR "Famille") / `FL.status` = "Status" (FR "Statut"), 12px neutral-400.
- **Filter chip** (`chips(opts, cur, set)`, line 4110) — `button` inline-flex, `gap:8px; padding:4px 10px; border-radius:var(--radius-md); font-size:12px`; label + count (11px, tabular, neutral-400). Selected: `background:var(--color-accent-900); border:1px solid var(--color-accent-700); color:var(--color-accent-200)`; unselected: transparent / `--color-neutral-800` / `--color-neutral-300`. Hover: `background:var(--color-neutral-900)`. First chip is always the "All …" option (`v:null`).
- **Card** — `card elev-sm`, `padding:14px 16px`; card header = `.card-title` (17px, weight 500) + optional subtitle 12px `--color-neutral-400`, left block has `margin-right:auto` so actions sit right.
- **Key/value list row** ("sheet" rows) — flex, `justify-content:space-between; gap:10px; font-size:12.5px; padding:3px 0; border-bottom:1px solid var(--color-neutral-900)`; key `--color-neutral-400` (`flex:none`), value right-aligned, tabular, `text-wrap:pretty`.
- **Tag classes** (DS): `tag tag-neutral` (neutral-800 bg / neutral-100 text), `tag tag-accent` (accent-800 bg / accent-100 text), `tag tag-outline` (1px accent border, accent text).
- **Tables** — `table.table` inside a card with `overflow:auto` (horizontal scroll on narrow screens, no other responsive behaviour).
- **Toast** — bottom-right, 4 s (`showToast`, line 5116); in FR each " · "-separated segment is translated.
- **Generic action form** (template 138–158, logic 5111–5136) — see 06 §0.4 / 01. Used here by `AF.plumbing` and `AF.site`.
- Responsive behaviour is purely `auto-fit/minmax` grids, `flex-wrap`, and `overflow:auto` cards; no breakpoints.

---

## 1. Settings — personalisable lists (`settings`)

### 1.1 Key, nav, audience
`isSettings = screen==='settings'` (line 5223). Sidebar › Administration › "Settings" (`ph ph-gear-six`). Visible to director, pm, depthead, englead, quality, procurement (not member, not client). `startScreen` option: yes.

### 1.2 Purpose
Company-level reference lists that other modules offer as choices (stock locations, skills, cost categories, project lifecycle stages, risk categories, deliverable types, public holidays) and the thresholds that classify project health (On track / At risk / Off track from CPI and SPI).

### 1.3 Layout (template 1573–1597)
```
column (gap 14px)
├─ KPI grid (5 tiles)                                             1575
├─ "Project health rules" card (padding 14px 16px, gap 10px)      1576–1582
└─ list-card grid: repeat(auto-fit,minmax(min(100%,340px),1fr)),
   gap 14px, align-items:start — 7 cards (settingsCards)           1583–1595
```

### 1.4 Components

**a) KPI tiles — `settingsKpis` (line 4445)** — all coloured `OK`.

| Label EN / FR | Value | Sub (EN / FR) |
|---|---|---|
| "Stock locations" / "Emplacements de stock" | `ST.locations.length` (6) | `{n} types in use` — n = distinct location types (5) |
| "Skill families" / "Familles de compétences" | `ST.skills.length` (10) | "Rated 1–5" (— no FR) |
| "Cost categories" / "Catégories de coûts" | `ST.costCats.length` (6) | "Per-project overrides allowed" (— no FR) |
| "Health rules" / "Règles de santé" | `` `${risk} / ${off}` `` → "0.97 / 0.9" (raw JS number to string, so `0.90` shows as `0.9`) | "At-risk / off-track thresholds" (— no FR) |
| "Public holidays" / "Jours fériés" | `ST.holidays.length` (11) | "2026 · France" |

**b) Project health rules card (1576–1582)**
- Header row (flex, wrap, gap 10px): icon `ph ph-heartbeat` (accent) · title "Project health rules" / "Règles de santé des projets" · subtitle `health.text` = `"On track when CPI and SPI ≥ {risk} · At risk below {risk} · Off track below {off}"`.
- Two inline fields (label 12px neutral-400 + `input.input[type=number][step=0.01]`, `width:84px; min-height:30px; padding:2px 8px; text-align:right`):
  - "At risk below" / "À risque sous" → `health.risk`, `onChange = setHealth('risk')`
  - "Off track below" / "Hors trajectoire sous" → `health.off`, `onChange = setHealth('off')`
  - `setHealth(k)`: `v = parseFloat(value)`; if `NaN` the previous value is kept; otherwise written to `settings.health[k]`. No min/max, no check that `off < risk`.
- Footnote row (12.5px, neutral-300, icon `ph ph-currency-eur` accent): "Labor rates and multipliers are edited on the **Rate cards** page (directors and PMs)." — FR "Les taux horaires et majorations se modifient sur la page **Grilles de taux** (directeurs et chefs de projet)." The words "Rate cards" are styled `--color-accent-300` but are **not a link** (no handler).

**c) List cards — `settingsCards` (built by `listCard(key,title,sub,icon)`, line 4440–4441)**, in this order:

| # | key | Title EN / FR | Subtitle EN / FR | Icon | Initial items |
|---|---|---|---|---|---|
| 1 | `locations` | "Stock locations & workshops" / "Emplacements de stock et ateliers" | "Create the places your sites need — receipts, transfers and reservations use them" / "Créez les lieux dont vos sites ont besoin — réceptions, transferts et réservations s’y appuient" | `ph ph-warehouse` | 6 `[name, type]` pairs (see §8) |
| 2 | `skills` | "Skills & levels" / "Compétences et niveaux" | "Skill families rated 1–5 in the matrix" | `ph ph-certificate` | copy of `SKILLS` (10) |
| 3 | `costCats` | "Cost categories" / "Catégories de coûts" | "Default categories offered when a project budget is set up" | `ph ph-coins` | Labor, Materials, Equipment, Subcontractors, Permits & fees, Contingency |
| 4 | `statuses` | "Project statuses" / "Statuts de projet" | "Lifecycle stages available on the Projects page" | `ph ph-flag` | copy of `STATUSES` (13: Initiative, APS, APD, Etudes, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise Service & SAT, Garantie, Clos, Annulé) |
| 5 | `riskCats` | "Risk categories" / "Catégories de risques" | "Used by the risk register (5×5 + EMV)" | `ph ph-warning` | Technical, Supplier / delivery, HSE (safety), Contractual / client, Financial / currency, Regulatory / permits, Resources / skills |
| 6 | `delivTypes` | "Deliverable types" / "Types de livrables" | "Register with RACI-B (B = backup)" | `ph ph-files` | Drawings, Calculation notes, Specifications, Test & inspection reports, Certificates (CE, lifting…), Manuals / as-built, Meeting minutes, Client acceptance (PV de réception) |
| 7 | `holidays` | "Public holidays 2026 — France" / "Jours fériés 2026 — France" | "Removed from capacity · Lucca stays the source for leave" | `ph ph-calendar-x` | 11 strings `"1 Jan · Jour de l’an"` … `"25 Dec · Noël"` |

Card anatomy (`card elev-sm`, `padding:14px 16px; gap:8px`):
1. Header: icon (16px, accent, `margin-top:2px`) · title (`card-title`) + subtitle (12px neutral-400) · count tag `tag tag-neutral` = `ST[key].length`.
2. Item list: one row per entry, `grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:5px 0; border-top:1px solid var(--color-neutral-900)`. Left: label 13px; for `locations` only a second line = location type (11px neutral-400) (`hasSub`). Right: remove button `btn btn-icon btn-ghost`, 26×26, `color:--color-neutral-500`, icon `ph ph-x`, `title="Remove"` (FR "Retirer") → removes that index immediately (no confirmation, no undo).
3. Locations card only (`c.isLoc`): a segmented control `locTypeSeg` over `ST.locTypes` with shortened labels (" (QC hold)" and " at supplier" stripped): "Central warehouse" / "Entrepôt central", "Workshop" / "Atelier", "Site store" / "Magasin chantier", "Consignment" / "Consignation", "Quarantine" / "Quarantaine". Selected value in `state.locType` (default `'Central warehouse'`). It is the type given to the next location added.
4. Add row: `input.input` (`min-height:32px; flex:1`, placeholder "Add an entry" / "Ajouter une entrée", value `state.drafts[key]`) + `btn btn-secondary` "Add" / "Ajouter" with `ph ph-plus` (12.5px).
   - `add()`: trims the draft; empty → no-op. Appends `[value, state.locType]` for `locations`, the plain string otherwise; clears `drafts[key]`. No duplicate check. No Enter-key submit.

### 1.5 Interactions & state
| Action | Writes |
|---|---|
| Edit health thresholds | `settings.health.risk` / `.off` |
| Remove item | `settings[key]` (filtered by index) |
| Type in add field | `drafts[key]` |
| Add | `settings[key]`, `drafts[key]=''` |
| Choose location type | `locType` |
| Primary "Reset to defaults" | `settings = deepClone(SETTINGS0)` (drafts and `locType` are not reset) |

State lives only in memory (`state.settings`, initialised from `SETTINGS0` at line 3774). No toast on any action.

### 1.6 Consumers of these settings (what is actually wired in the prototype)
- `settings.locations` → Stock & storages (`locs`, line 4470): location chips, location type lookup, transfer targets, KPI "N locations".
- `settings.riskCats` → Risk register filter chips (line 4583).
- Everything else (`skills`, `costCats`, `statuses`, `delivTypes`, `holidays`, `health`) is **not read anywhere else**: the Skills matrix uses the `SKILLS` constant, Projects uses `STATUSES`, and project health is hard-coded as `m<.9 → Off track, m<.97 → At risk` (lines 3794, 3916) with `m = min(CPI, SPI)`. See Open questions.

### 1.7 Cross-links
None clickable. Stock (`stock`) and Risks (`risks`) consume lists.

---

## 2. Activity, integrations & audit (`plumbing`)

### 2.1 Key, nav, audience
`isPlumbing = screen==='plumbing'` (line 5194). Sidebar › Administration › "Activity & integrations" (`ph ph-plugs-connected`, badge `!` on connector warning). Roles: director, pm. Not a `startScreen` option.

### 2.2 Purpose
Administrative "plumbing" of the tool: cross-project activity feed, the status of every connector to the company's systems of record (Cursus, Codex, Lucca, Sage X3, SolidWorks PDM, MS Project, Outlook, Teams, SMTP), file import/export formats, and the immutable audit trail used for ISO 9001 audits.

### 2.3 Layout (template 2237–2267)
```
column (gap 14px)
├─ KPI grid (5 tiles)                                   2239
├─ "Display" segmented control (plumbSeg, 4 options)    2240
├─ [plIsAct]   source chips + Activity feed card        2241–2247
├─ [plIsConn]  Connectors table card                    2248–2253
├─ [plIsImp]   Import / export card grid                2254–2258
└─ [plIsAudit] Audit trail table card                   2259–2265
```

### 2.4 Components

**a) KPI tiles — `plumbKpis` (line 4718)**

| Label EN / FR | Value | Sub | Colour |
|---|---|---|---|
| "Events today" / "Événements aujourd’hui" | count of `ACTIVITY` rows whose `when` starts with "26 Sep" **or** "25 Sep" (= 6) | "Across all projects" / "Tous projets" | OK |
| "Connectors" / "Connecteurs" | `CONNECTORS.length` (9) | `{#OK} healthy · {#Warning} warning` → "7 healthy · 1 warning" | LO if any `Warning` |
| "Unread notifications" / "Notifications non lues" | unread notifications of the current role (`myNotifs`, see 01) — director: 3 | persona title, e.g. "Portfolio director" | LO if > 0 |
| "Audit entries · 7 days" / "Entrées d’audit · 7 jours" | `AUDIT.length` (8) | "Every status, approval and value change" / "Chaque changement de statut, d’approbation et de valeur" | OK |
| "Channels" / "Canaux" | literal `'3'` | "In-app · e-mail · Teams" | OK |

**b) Segmented control `plumbSeg`** (state `plumbTab`, default `'activity'`): "Activity feed" / "Fil d’activité" (`activity`), "Connectors" / "Connecteurs" (`connectors`), "Import / export" (`imports`), "Audit trail" / "Piste d’audit" (`audit`). Caption "Display".

**c) Activity tab**
- Source chips (`actChips`, caption icon `ph ph-plugs-connected` + `FL.source` "Source"): "All" (12) then one chip per distinct `kind` in order of first appearance, label = kind with first letter upper-cased: Sync (1), Stock (2), Comment (1), Change (1), Snapshot (1), Quality (1), Request (1), Delivery (1), Invoice (1), Eco (1), Client (1). FR: Synchro, Stock, Commentaire, Modification, Instantané, Qualité, Demander (sic), Livraison, Facture, ECO, Client. State `actFilter` (null = all).
- Card "Activity feed" + right subtitle "Every change across projects, people and connectors · newest first" / "Chaque changement sur les projets, les personnes et les connecteurs · plus récent d’abord". Card `gap:2px`.
- Row (`actRows`): `grid-template-columns:28px minmax(0,1fr) auto; gap:12px; padding:9px 0; border-top:1px solid neutral-900`.
  - Icon square 28×28, radius 7px, bg neutral-900, colour neutral-300, icon from `ACT_ICON[kind]`: sync `ph-arrows-clockwise`, stock `ph-warehouse`, comment `ph-chat-circle`, change `ph-git-pull-request`, snapshot `ph-camera`, quality `ph-shield-warning`, request `ph-paper-plane-tilt`, delivery `ph-truck`, invoice `ph-receipt`, eco `ph-git-branch`, client `ph-buildings`.
  - Text 13px: **who** (weight 500) + " · " + what.
  - When: 11.5px, neutral-500, nowrap.
  - Rows are not clickable. (`ini` initials are computed but unused.)
  - Order is the constant's order (already newest first). No paging.

**d) Connectors tab** — card "Connectors" + subtitle "Source systems stay the reference — Keystone reads, links and pushes back approved changes" / "Les systèmes source restent la référence — Keystone lit, relie et renvoie les modifications approuvées". Table (13px):

| Column EN / FR | Content / format |
|---|---|
| "System" / "Système" | `name`, weight 500, nowrap |
| "Data" / "Données" | `what`, 12.5px neutral-300, `min-width:260px`, pretty wrap |
| "Frequency" / "Fréquence" | `freq`, 12px nowrap |
| "Status" / "Statut" | tag: `OK` → `tag-neutral`; `Warning` → `tag-accent`; anything else (`Ready`) → `tag-outline` |
| "Last sync" / "Dernière synchro" | `last`, 12px neutral-300 |
| "Last volume" / "Dernier volume" | `vol`, 12px neutral-400 |
| (actions) | right-aligned: `btn btn-secondary` "Sync now" / "Synchroniser" (`ph ph-arrows-clockwise`, 12px, `padding:3px 10px`) and `btn btn-ghost` "Configure" / "Configurer" — **no handlers** |

**e) Import / export tab** — grid `repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:10px`. One card per `IMPORTS` row (`padding:14px 16px; gap:8px`): icon (20px accent) + name (13.5px, 500); description 12px neutral-400; drop zone `width:100%; aspect-ratio:5/1; border:1px dashed var(--color-neutral-700); border-radius:8px`, centred text "Drop a file or click to choose" / "Déposer un fichier ou cliquer pour choisir" (12px neutral-500). **No upload handler.**

**f) Audit trail tab** — card "Audit trail" + subtitle "Who changed what, when — immutable, exportable for ISO 9001 audits". Table (12.5px): "When" / "Quand" (nowrap, neutral-300) · "Who" / "Qui" · "Object" / "Objet" (tabular) · "Change" / "Modification" (pretty wrap) · "Area" / "Domaine" (12px neutral-400). Read-only; no sort, no filter, no export button on the card.

### 2.5 Interactions & state
| Control | State | Notes |
|---|---|---|
| Display seg | `plumbTab` | — |
| Source chips | `actFilter` | filters `ACTIVITY` by `kind` |
| Sync now / Configure / drop zones | — | inert in prototype |
| Primary "Add connector" | `af` | opens action form (§2.6) |

### 2.6 Action form `AF.plumbing` (line 3674+, result `AF_RESULT.plumbing`)
Title "Add connector" / "Ajouter un connecteur"; submit "Connect" / "Connecter" (icon `ph ph-check`). Subtitle shows the current project name (shell behaviour).

| id | Label EN / FR | Type | Options / default | Required |
|---|---|---|---|---|
| `system` | "System" / "Système" | select | Sage X3, Lucca, SharePoint, SeeElectrical, SolidWorks 3DX, TIA Portal | no |
| `direction` | "Direction" / "Sens" | select | Import, Export, Both | no |
| `freq` | "Frequency" / "Fréquence" | select | Real time, Hourly, Daily, Manual | no |
| `owner` | "Technical owner" / "Responsable technique" | text | `''` | no |

Always valid. Submit closes the dialog and toasts "Connector added · first sync scheduled" / "Connecteur ajouté · première synchronisation planifiée". **No connector row is added** to the table.

### 2.7 Data
`ACTIVITY`, `CONNECTORS`, `IMPORTS`, `AUDIT` (field lists in §8). `NOTIFS` for the unread KPI.

### 2.8 Cross-links
None clickable on the page. The connector rows describe the integrations used by: Site (Cursus), Documents (Codex), Leave/Hours (Lucca), Stock/Invoices (Sage X3), Drawings (SolidWorks PDM), Schedule (MS Project).

---

## 3. Site (chantier) (`site`)

### 3.1 Key, nav, audience
`isSite = screen==='site'` (line 5214); content only when `isSiteProj = project==='HLT-026'` (line 4741), else `siteNotProj`. Sidebar › Project › *Site & handover* › "Site (chantier)" (`ph ph-hard-hat`), badge `NO GO`. Roles: director, pm, depthead, member. `startScreen` option: yes. Header shows the project picker; the primary "Daily report" is hidden when the persona only has read-only access to the current project (`projReadOnly`).

### 3.2 Purpose
Stage "Chantier" of the lifecycle (after Expédition): decide whether the site can start ("Go chantier"), track client prerequisites, equipment and individual clearances (from Cursus); plan the site team rotation and spot collisions; follow mission costs; then during execution collect daily reports, the punch list (réserves) and the HSE register up to SAT.

### 3.3 Layout (template 2268–2309)
```
column (gap 14px)
├─ [isSiteProj]
│  ├─ "Display" seg: siteSeg (3)                                   2271
│  ├─ [siteIsReady]  Readiness & go                                 2272–2286
│  │   ├─ KPI grid (5)                                             2273
│  │   ├─ grid minmax(min(100%,380px),1fr) gap 14: Go card | Site sheet card   2274–2280
│  │   ├─ Client prerequisites table card                           2281
│  │   └─ grid minmax(min(100%,540px),1fr) gap 14: Equipment card | Cursus card  2282–2285
│  ├─ [siteIsTeam]   Team & mobilisation                            2287–2294
│  │   ├─ KPI grid (5)
│  │   ├─ Rotation plan table card
│  │   └─ grid minmax(min(100%,540px),1fr): Collision detection | Mission costs
│  └─ [siteIsExec]   Daily execution                                2295–2302
│      ├─ KPI grid (5)
│      ├─ Daily reports table card
│      └─ grid minmax(min(100%,540px),1fr): Punch list | HSE register
└─ [siteNotProj] empty state                                        2304
```

**Empty state (2304):** 12.5px neutral-400, `padding:14px; text-align:center; border-radius:var(--radius-md); background:var(--color-neutral-900)`: "The site module opens when the project reaches the Expédition stage — only Harbor Line has a site sheet in this mockup." / "Le module chantier s’ouvre quand le projet atteint l’étape Expédition — seul Harbor Line a une fiche chantier dans …". (In the real app: show the module for projects at/after the Expédition stage that have a site sheet.)

**Segmented control `siteSeg`** (state `siteTab`, default `'ready'`): "Readiness & go" / "Préparation & go" (`ready`), "Team & mobilisation" / "Équipe & mobilisation" (`team`), "Daily execution" / "Exécution quotidienne" (`exec`).

**Status → tag mapping `stTag(s)` (line 4743), used by every site table:**

| Status values | Class |
|---|---|
| Signed, Confirmed, OK, Closed, Ready, Approved, GO, Not required | `tag tag-neutral` |
| Pending, Expiring, GO with reserve | `tag tag-outline` |
| Missing, Open, NO GO | `tag tag-accent` |
| anything else (e.g. "0 déclaré") | `tag tag-neutral` |

FR: Signed "Signé", Confirmed "Confirmé", Closed "Clôturée", Ready "Prêt", Approved "Approuvé", Not required "Non requis", Pending "En attente", Expiring "Expire bientôt", GO with reserve "GO avec réserve", Missing "Manquant", Open "Ouverte"; GO / NO GO / OK unchanged.

### 3.4 Tab "Readiness & go"

**a) KPI tiles — `siteKpis` (line 4750)** (initial values in brackets)

| Label EN / FR | Value | Sub | Colour |
|---|---|---|---|
| "Go chantier" | `GO` if all 5 go items ok else `NO GO` [NO GO] | `{#not ok} of 5 conditions open · start {SITE.start}` ["5 of 5 conditions open · start 19 Oct 2026"] | OK if GO else LO |
| "Client prerequisites" / "Prérequis client" | `{#status≠Pending} / {#rows}` [4 / 6] | `{#late} late vs need date` [0] | LO if any late |
| "Individual go · Cursus" / "Go individuel · Cursus" | `{#verdict≠NO GO} / {#rows}` [3 / 5] | `{#GO with reserve} with reserve · approvals only` [1] | OK if no NO GO else LO |
| "Equipment confirmed" / "Matériel confirmé" | `{#Confirmed} / {#rows}` [6 / 8] | `{#src='Expédié'} shipped · {#other} local / client` [3 / 5] | OK |
| "Collisions" | `SITE_COLLISIONS.length` [4] | "Load · leave · certificates · badges" / "Charge · congés · habilitations · badges" | LO if > 0 |

**b) Go card "Go chantier — five conditions"** / "Go chantier — cinq conditions"; subtitle "Green only when every condition is confirmed · checked daily from J-30" / "Vert seulement quand toutes les conditions sont confirmées · vérifié chaque jour à partir de J-30". Right: `tag tag-accent` (13px, `padding:4px 12px`) = `goLabel` (`GO`/`NO GO`; always accent class).
Inner grid `repeat(auto-fit,minmax(150px,1fr)); gap:8px` of 5 tiles (`padding:10px; radius md; bg neutral-900`; icon 18px; label 12.5px; sub 11.5px in the item colour):

| Condition label EN / FR | ok when | sub when not ok |
|---|---|---|
| "Client prerequisites" / "Prérequis client" | no prerequisite is `Pending` | `{n} pending` |
| "Individual go · Cursus" | no Cursus verdict is `NO GO` | `{n} NO GO` |
| "Equipment on site" / "Matériel sur site" | every equipment row `Confirmed` | `{n} unconfirmed` |
| "Team without collisions" / "Équipe sans collision" | `SITE_COLLISIONS.length === 0` (constant → never ok) | `{n} collisions` |
| "HSE permits" / "Permis HSE" | no `SITE_HSE` row has status `Pending` | `{n} pending` |

ok → icon `ph ph-check-circle`, sub "Ready"; not ok → `ph ph-warning-circle`. **Both states use colour `--color-accent-300`** (ok colour literal and `LO` are the same token) — only the icon differs. `goOk = every item ok`.

**c) "Site sheet" card** / "Fiche chantier" (`siteMeta`): key/value rows (colour text):

| Key EN / FR | Value (from `SITE`) |
|---|---|
| "Site" | `site` — "Terminal Harbor Line — Quai 4, Le Havre (FR)" |
| "Country · time zone" / "Pays · fuseau horaire" | `country · tz` — "France · Europe/Paris (UTC+1)" |
| "Language · currency" / "Langue · devise" | `lang · cur` — "Français · EUR" |
| "Client contact on site" / "Contact client sur site" | `contact` |
| "Working hours" / "Horaires de travail" | `hours` |
| "Local holidays" / "Fériés locaux" | `holidays` |
| "Access constraints" / "Contraintes d’accès" | `access` |
| "Window" / "Fenêtre" | `{start} → {end} · {planDays} working days` — "19 Oct 2026 → 18 Dec 2026 · 44 working days" |

**d) "Client prerequisites (readiness)"** / "Prérequis client (readiness)"; subtitle "Dated and signed by the client · each one conditions a site activity · J-15 unconfirmed → alert, risk and client letter" (Keystone, R-121, owner 17 Oct 2026: no client letter — "… · J-15 unconfirmed → alert and risk proposal"). Table (13px), rows `prereqs` (line 4744):

| Column EN / FR | Content |
|---|---|
| "Prerequisite" / "Prérequis" | title, pretty wrap |
| "Conditions activity" / "Conditionne l’activité" | `act` + " · " + activity name from `ALL_BYID` (e.g. "A1320 · Crane delivery & rigging"); 12px neutral-400, `max-width:220px`, single line ellipsis |
| "Needed by" / "Requis pour le" | due date, 12px; colour LO when `late`, else neutral-300 |
| "Status" / "Statut" | `stTag(status)` |
| "Evidence" / "Preuve" | note, 12px neutral-400 |
| (actions) | Pending → `btn btn-secondary` "Client confirms" / "Le client confirme" → `siteOv[i]='Confirmed'`; Confirmed → `btn btn-primary` with `ph ph-signature` "Signed on site" / "Signé sur site" → `siteOv[i]='Signed'`; Signed → none |

`status = siteOv[i] || constant`. `late = status==='Pending' && due ∈ {'12 Oct','16 Oct'}` (hard-coded list, not a date computation; initially no row is late).

**e) "Equipment on site"** / "Matériel sur site"; subtitle "Shipped with the machine · rented locally · provided by the client". Table (12.5px), rows `equip`:
"Equipment" / "Équipement" · "Source" (tag: `Expédié` → `tag-outline`, else `tag-neutral`; values Expédié / Location locale / Client) · "Status" (`stTag`) · "Note" (11.5px neutral-400) · action: Pending → `btn btn-secondary` "Confirm" / "Confirmer" → `siteEqOv[i]='Confirmed'`.

**f) "Individual go / no go — Cursus"** / "Go / No Go individuel — Cursus"; subtitle "Approvals received from Cursus · checked against the mission dates". Header buttons: `btn btn-ghost` "Sync Cursus" (`ph ph-arrows-clockwise`) → toast `Cursus sync · {5} approvals received`; `btn btn-secondary` "Open Cursus" (`ph ph-arrow-square-out`) → toast "Opening Cursus · HLT-026 mobilisation" / "Ouverture de Cursus · mobilisation HLT-026".
Privacy notice (12px neutral-300, `padding:8px 10px; radius sm; bg neutral-800`, icon `ph ph-lock-simple` accent-300): "Passports, visa files, vaccination records and medical data stay in Cursus. Keystone only receives the approval, the confirmation and its date — no personal data is imported or stored." — this is a functional requirement: store only verdicts and dates.
Table (12.5px), rows `docs` (from `SITE_DOCS`, line 4746):

| Column EN / FR | Content |
|---|---|
| "Person" / "Personne" | name |
| "Visa" | tag `stTag(visa)` (Not required / Approved / Pending) |
| "Vaccinations" | tag `stTag(vacc)` (Confirmed / Pending) |
| "Clearances & badges" / "Habilitations & badges" | tag `stTag(hab)` (OK / Pending / Expiring / Missing) + note below (11.5px; neutral-400 if `hab==='OK'`, else LO) |
| "Cursus verdict" / "Verdict Cursus" | tag `stTag(verdict)` (GO / GO with reserve / NO GO) |
| "Received" / "Reçu" | timestamp, 12px tabular neutral-400 |
| (action) | if verdict ≠ `GO` and not yet reminded: `btn btn-secondary` "Remind in Cursus" / "Relancer dans Cursus" → `siteDocOv[i]='sent'` + toast `Reminder sent via Cursus · {who}`; afterwards text "Reminder sent" / "Relance envoyée" (11.5px neutral-400) |

### 3.5 Tab "Team & mobilisation"

**a) KPI tiles — `teamKpis` (line 4756)**

| Label EN / FR | Value | Sub | Colour |
|---|---|---|---|
| "People on rotation" / "Personnes en rotation" | `SITE_ROTATION.length` (6) | `2 rotations · {planDays} working days` ("2 rotations" literal) | OK |
| "Man-days planned" / "Jours-homme prévus" | literal `'168'` | `0 consumed · site starts {SITE.start}` | OK |
| "Collisions open" / "Collisions ouvertes" | `SITE_COLLISIONS.length` (4) | "Arbitrated by department heads" / "Arbitrées par les chefs de service" | LO if > 0 |
| "Mission budget" / "Budget de mission" | `f(Σ budget)` = f(98.3) → "€98k" / "98 k€" | `{f(Σ actual)} committed · {round(Σa/Σb·100)}%` → "€11k committed · 11%" | OK |
| "Site premium" / "Majoration chantier" | literal "×1.5 / ×2" | "Saturday / Sunday rates · 6d · 10h calendar" / "Taux samedi / dimanche · calendrier 6j · 10h" | OK |

`f(k)` = `money(k)` (line 3775): input in k€; EN `€12k` / `€1.42M`; FR+EUR `12 k€` / `1,42 M€`; currency prop EUR|USD.

**b) "Rotation plan"** / "Plan de rotation"; subtitle "Who, when, where they sleep, how they travel · shown next to the site activities in the Gantt". Table (13px), rows `rotation`:

| Column header as authored (FR) | Field shown |
|---|---|
| "Person" (Personne) | who, nowrap |
| "Role on site" (Rôle sur site) | role, 12px neutral-300 |
| "Issued by" (Émetteur) | **mission start date** (`from`, e.g. "19 Oct") — see Open questions |
| "Recipients" (Destinataires) | **mission end date** (`to`, e.g. "18 Dec") — see Open questions |
| "Rotation" | `'R' + rot` (R1 / R2), tabular |
| "Lodging" (Hébergement) | 12px neutral-300 |
| "Travel" (Transport) | 12px neutral-300 |
| "Collision" | icon 16px: `ph ph-warning` if the person appears in `SITE_COLLISIONS`, else `ph ph-check`; both coloured accent-300 |

**c) "Collision detection"** / "Détection des collisions"; subtitle "Same person on two sites · Lucca leave · certificate expiring · badge missing · mission length". One row per collision (`grid minmax(0,1fr) auto; gap:10px; padding:8px 0; border-top neutral-900`):
- Line 1: who (13px) + kind tag (10px): `Load` → "Load" (FR "Charge") `tag-accent`; `Cert` → "Certificate" ("Habilitation"), `Doc` → "Document", `Leave` → "Leave" ("Congés") — all `tag-outline`.
- Line 2: what (12px neutral-300). Line 3: "→ " + fix (11.5px neutral-400).
- Button `btn btn-secondary` "Resolve" / "Résoudre" → Load → `screen:'whatif'`; Leave → `screen:'leave'`; Cert → `screen:'skills'`; Doc → `siteTab:'ready'` (jumps to the Cursus table). The collision itself is not cleared.

**d) "Mission costs"** / "Coûts de mission"; subtitle "Charged to the Site work package · planned vs actual" / "Imputés au lot Chantier · prévu vs réel". Table (12.5px): "Line" / "Ligne" · "Budget" (right, tabular, `f(b)`) · "Actual" / "Réel" (right, `f(a)` or "—" when 0) · bar column (`width:26%`: track 5px neutral-800 radius 3, fill accent width `round(min(1,a/b)·100)%`) · "Remaining" / "Reste" (right, `f(b−a)`).

### 3.6 Tab "Daily execution"

**a) KPI tiles — `execKpis` (line 4760)**

| Label EN / FR | Value | Sub | Colour |
|---|---|---|---|
| "Progress on site" / "Avancement chantier" | `{doneDays} / {planDays} d` → "0 / 44 d" | "Daily reports feed the data date" | OK |
| "Daily reports" / "Rapports journaliers" | `SITE_REPORTS.length` (2) | "Mobile · hours, %, photos, weather, incidents, visitors" (— no FR) | OK |
| "Punch list open" / "Réserves ouvertes" | # punch `Open` (2) | `{# Open & owner Client} on the client` (1) | LO if any open |
| "HSE" | literal "0 incident" | `{# SITE_HSE Pending} permits pending` (2) | OK |
| "Client decisions logged" / "Décisions client consignées" | literal '3' | "Out-of-scope requests → change request" / "Demandes hors périmètre → demande de modification" | OK |

**b) "Daily reports"** / "Rapports journaliers"; subtitle "Filled on mobile by the site lead · hours per activity, % complete, photos, weather, incidents, visitors". Table (13px): "Date" (12px nowrap) · "Activity" / "Activité" (12px neutral-300) · "%" (right, tabular) · "Report" / "Compte rendu" (pretty) · "Link" / "Lien" (12px tabular accent-300) · "By" / "Par" (12px nowrap). Each row has `cursor:pointer`; click → if `link` starts with "NCR" go to `quality` with `{qTab:'ncr', ncr:link}`; otherwise nothing. Footnote under the table: "Site starts 19 Oct — reports so far cover preparation visits." (hard-coded text).

**c) "Punch list & reserves"** / "Réserves (punch list)"; subtitle "Linked to NCRs and to the SAT acceptance · signed off by the client". Table (12.5px): "#" (tabular 12px) · "Item" / "Élément" · "NCR" (12px tabular neutral-400) · "Owner" / "Responsable" · "Due" / "Échéance" · "Status" (`stTag`: Open → accent, Closed → neutral). Read-only. (The editable punch list lives on the ITP screen, see 07.)

**d) "HSE register"** / "Registre HSE"; subtitle "Prevention plan, inductions, work & lifting permits, near misses". Rows `grid minmax(0,1fr) auto auto; gap:10px; padding:7px 0; border-top neutral-900; 12.5px`: title · date (12px neutral-400) · status tag (`stTag`). Buttons below (inert): `btn btn-secondary` "Declare incident" / "Déclarer un incident" (`ph ph-first-aid`) and `btn btn-ghost` "Client communication log" / "Journal de communication client" (`ph ph-chats`).

### 3.7 Action form `AF.site` — primary "Daily report"
Title "Daily report" / "Rapport journalier"; submit "Save report" / "Enregistrer le rapport"; result toast "Daily report saved" / "Rapport journalier enregistré". **No row is appended** to Daily reports.

| id | Label EN / FR | Type | Default / options | Required | Span |
|---|---|---|---|---|---|
| `date` | "Date" | text | "30 Sep 2026" | no | 1 col |
| `weather` | "Weather" / "Météo" | select | Clear, Rain / Pluie, Wind > 50 km/h, Storm / Tempête | no | 1 col |
| `headcount` | "Headcount on site" / "Effectif sur site" | number | 24 | no | 1 col |
| `progress` | "Progress" / "Avancement" | textarea | '' | **yes** (submit disabled until non-blank) | full width |
| `incident` | "HSE" | select | None / Aucun, Near miss / Presque-accident, First aid / Premiers soins, Incident | no | 1 col |

### 3.8 State summary
`siteTab`, `siteOv` (prereq index → status), `siteEqOv` (equipment index → status), `siteDocOv` (Cursus row index → 'sent'). All in-memory, keyed by array index.

### 3.9 Cross-links
Collisions → What-if levelling / Leave & calendar / Skills matrix; daily-report NCR link → Quality (NCR drawer); prerequisite activities refer to Plan activities (`ALL_BYID`, not clickable); Mission costs are the "Site" work package in Budget; Cursus and the punch list relate to ITP & punch list (07). The `NO GO` badge appears in the sidebar for every screen.

---

## 4. Documents — Codex index (`docs`)

### 4.1 Key, nav, audience
`isDocs = screen==='docs'` (line 5198). Fixed sidebar entry "Documents · Codex" (`ph ph-books`), badge = number of documents in `Release proposed` across all projects. Every role has it (`ROLE_SCREENS` push, line 3466). Header shows the project picker. Not a `startScreen` option.

### 4.2 Purpose
A synced, read-mostly index of the document management system **Codex** (the GED): every project document record (number, revision, status, confidentiality, tags, links) with filters and saved views, the approval proof and distribution/acknowledgement trail per document, and a hand-off to deposit new documents or revisions in Codex. Codex owns files, numbering, approval circuits and retention; Keystone mirrors and links.

### 4.3 Layout (template 2310–2345)
```
column (gap 14px)
├─ Codex banner card                                       2312
├─ KPI grid (4)                                            2313
├─ filter row 1 (flex wrap, gap 10): Scope seg · Saved views chips · search (margin-left:auto)   2314–2318
├─ filter row 2 (flex wrap, gap 14): Family chips | 1×18px divider | Status chips                2319
├─ [hasSel] selection bar                                   2320
└─ Vault card (table + empty state)                         2321–2343
overlays (global, outside isDocs): document record drawer 2346–2362, deposit dialog 2363–2374
```

### 4.4 Components

**a) Codex banner (2312)** — `card elev-sm` as a flex row (`align-items:center; gap:12px; flex-wrap:wrap; padding:12px 16px; border:1px solid var(--color-accent-800)`):
- "Cx" badge: 34×34, `radius md`, bg accent-900, text accent-200, 13px weight 500, `border:1px solid accent-800`.
- Text block (`flex:1; min-width:240px`): "Project documents live in Codex" / "Les documents projet vivent dans Codex" (13px 500) + "Keystone shows a synced index of the document records — numbers, revisions, statuses and links. Files, approval circuits and retention rules are handled in Codex." (12px neutral-400).
- Sync status (11.5px neutral-400, `ph ph-arrows-clockwise`): `codexSync` = `Last sync 08:02 · {412 + newDocs.length} records` / "Dernière synchro 08:02 · 412 fiches".
- `btn btn-secondary` "Sync now" / "Synchroniser" → toast `Codex sync · index up to date · {n} records`.
- `btn btn-primary` "Open Codex" / "Ouvrir Codex" (`ph ph-arrow-square-out`) → toast `Opening Codex · project {project}`.

**b) KPI tiles — `dvKpis` (line 5039)** (computed over `inScope`; initial values for HLT-026 in brackets)

| Label EN / FR | Value | Sub | Colour |
|---|---|---|---|
| "Documents in scope" / "Documents dans le périmètre" | `inScope.length` [40] | `{#Released} released` [28] | OK |
| "Awaiting approval" / "En attente d’approbation" | # `Release proposed` [1] | "circuit defined by document type" / "circuit défini par le type de document" | LO if > 0 |
| "Client acknowledgments pending" / "Accusés de réception client en attente" | # `shared && !ack` [1] | `{#shared} shared with client` [7] | LO if > 0 |
| "Obsolete revisions withdrawn" / "Révisions obsolètes retirées" | Σ over in-scope docs of (rev letter index), i.e. rev A→0, B→1, D→3 [25] | "automatic on release of the next revision" | OK |

**c) Scope segmented control `dvScope`** (caption icon `ph ph-folders` + "Scope"/"Périmètre"): "Current project" / "Projet courant" (`proj`, default) and "All projects" / "Tous les projets" (`all`). `inScope = scope==='all' ? all : docs where proj === current project OR proj === 'QMS'` (QMS = company quality-system documents, always visible).

**d) Saved views chips `dvViews`** (caption icon `ph ph-bookmark-simple` + "Saved views" / "Vues enregistrées"; state `dv.view`, default `all`). Selecting a view also resets `fam` and `st` to null. Counts are computed on `inScope` only (ignoring family/status/search).

| v | Label EN / FR | Filter (`viewFilter`) | Initial count |
|---|---|---|---|
| `all` | "All documents" / "Tous les documents" | everything | 40 |
| `bpe` | "BPE dossier (released)" / "Dossier BPE (diffusés)" | status `Released` and `proj === current project` | 24 |
| `audit` | "Quality records 2026 (ISO audit)" / "Enregistrements qualité 2026 (audit ISO)" | type ∈ {REC, NCR, AUD, PRO, FRM, CER, COC, PV, RPT} and status ≠ `Draft` | 14 |
| `client` | "Shared with client" / "Partagés avec le client" | `shared` (type is client deliverable and status `Released`) | 7 |
| `pending` | "Awaiting approval" / "En attente d’approbation" | status `Release proposed` | 1 |
| `obsolete` | "Obsolete withdrawn" / "Obsolètes retirés" | `rev !== 'A'` (has at least one withdrawn earlier revision) | 14 |

("BPE" = *Bon Pour Exécution*, released for execution.)

**e) Search** — wrapper `margin-left:auto; position:relative; min-width:260px`; icon `ph ph-magnifying-glass` absolute at `left:10px; top:10px` neutral-500; `input.input` `padding-left:30px; min-height:34px`; placeholder "Search number, title, tag, author…" / "Rechercher numéro, titre, tag, auteur…". Live filter (`setDvQ` on change → `dv.q`): case-insensitive substring of `id + title + tags + typeLabel + by`.

**f) Family chips `dvFam`** (caption `ph ph-tag` + "Family"; state `dv.fam`): "All families" / "Toutes familles" (count inScope) + one chip per `DOC_FAM` key **that has ≥1 in-scope document**, label `DOC_FAM[k]`, count. Initial: Engineering 13, Client deliverables 3, Quality 9, Purchasing 5, Site 4, Contracts & mail 4, Photos & reports 2.

**g) Status chips `dvSt`** (caption `ph ph-funnel` + "Status"; state `dv.st`): "All statuses" / "Tous statuts" + each `DOC_STATUSES` value present in scope: Draft (7), Frozen (4), Release proposed (1), Released (28) (Obsolete appears only if some document has that status).

**h) Selection bar (`hasSel`, 2320)** — flex wrap, gap 8px, `padding:8px 12px; radius md; bg accent-900; 12.5px`. Left: `{n} selected` (accent-100). Buttons: `btn btn-secondary` "Download zip" / "Télécharger zip" (`ph ph-file-zip`, **inert**), `btn btn-secondary` "Export register (xlsx)" / "Exporter le registre (xlsx)" (`ph ph-file-xls`, **inert**), `btn btn-ghost` "Clear" / "Effacer" → `dv.sel = {}`.

**i) Vault card (2321–2343)** — title `Vault · {dvCount}` where `dvCount = "{shown} / {inScope} documents"` ("Coffre-fort · …"); subtitle "Flat vault · every document is numbered by the system, tagged, versioned and downloadable · folders are just saved views". Header button `btn btn-secondary` "Export register (xlsx)" (`ph ph-file-xls`, inert).

Table (12.5px), rows `dvList` (order = new deposits first, then `DOCS` order; no sorting UI):

| # | Column EN / FR | Content / format |
|---|---|---|
| 1 | (checkbox) | `width:28px`. 16×16 button, radius 4px, `border:1px solid` accent (selected) / neutral-600; bg accent-700 (selected) / transparent; check icon `ph ph-check` 11px accent-100 when selected. Click → toggles `dv.sel[id]` (stops propagation) |
| 2 | "Number" / "Numéro" | `id`, tabular, weight 500, nowrap; + `tag tag-accent` (10px) "New" / "Nouveau" if `isNew` |
| 3 | "Title" / "Titre" | pretty wrap, `min-width:160px` |
| 4 | "Kind" / "Nature" | `DOC_TYPE[type].label`, 12px neutral-300 |
| 5 | "Service" | `DOC_SVC[svc]`, 12px neutral-300 |
| 6 | "Project" / "Projet" | `proj` (`HLT-026`, `NDC-031`, `QMS`), 12px tabular |
| 7 | "Rev" / "Rév." | revision letter, tabular |
| 8 | "Status" / "Statut" | tag `stClassDoc(status)` |
| 9 | "Confidentiality" / "Confidentialité" | tag (10.5px): `Client` → `tag-accent`, `Supplier` → `tag-outline`, else (`Internal`) → `tag-neutral`. FR: Client, Fournisseur, Interne |
| 10 | "Tags" | `tags` string (" · "-separated), 11.5px neutral-400, `max-width:220px`, single-line ellipsis |
| 11 | (download) | `btn btn-icon btn-ghost` `ph ph-download-simple` neutral-400 → appends `"{persona name} · rev {rev} · 29 Sep · PDF"` to `engOv.dl[id]` (stops propagation; no toast) |

Row click (`cursor:pointer`) → `dv.open = (dv.open===id ? null : id)` → opens the document record drawer.

**Status → class `stClassDoc` (line 5024):** Released → `tag-neutral`; Release proposed → `tag-accent`; Obsolete → `tag-outline`; Draft, Frozen → `tag-outline`. FR: Draft "Brouillon", Frozen "Gelé", Release proposed "Diffusion proposée", Released "Diffusé", Obsolete "Obsolète".

Empty state (`noDocs`): "No document matches" / "Aucun document ne correspond" (12.5px neutral-500, `padding:8px 0`) below the (empty) table.

### 4.5 Document record drawer (`showDoc`, template 2346–2362, logic 5040–5047)
Global overlay (works from any screen as long as `dv.open` points to an existing record; other screens navigate to `docs` and set `dv.open`).
- Backdrop: fixed `inset:0; z-index:60; background: color-mix(in srgb, var(--color-bg) 60%, transparent)`; click → close (`dv.open=null`).
- Panel: `card elev-lg`, fixed right `top:0; bottom:0; z-index:61; width:min(680px,100vw); overflow:auto; border-radius:0; padding:18px 22px; gap:12px; border-left:1px solid neutral-800`.

Content top to bottom:
1. Header row: `"Document record · {id} · rev {rev}"` (12px neutral-400 tabular; FR "Fiche document · … · rév. D") · `tag tag-outline` with `ph ph-books` "Codex" · confidentiality tag · status tag · close `btn btn-icon btn-ghost` `ph ph-x`.
2. Title (`card-title`, pretty wrap).
3. Action buttons (12.5px): `btn btn-primary` "Open in Codex" / "Ouvrir dans Codex" (`ph ph-arrow-square-out`) → toast `Opening Codex · {id} rev {rev}`; `btn btn-secondary` "Download PDF" / "Télécharger le PDF" (`ph ph-download-simple`) → download log entry (as in the table); `btn btn-ghost` "New revision · Codex" (`ph ph-git-branch`) → closes the drawer and opens the deposit dialog in *new revision* mode (§4.6); if `canApprove`: `btn btn-primary` (`ph ph-stamp`) labelled `approveLabel` = `"Approve in Codex · {nextRole} · {DOC_WHO[nextRole] or author}"` → `approve()`.
4. Note (11.5px neutral-500, `ph ph-arrows-clockwise`): "Record mirrored from Codex · revisions, approvals and distribution are read-only here".
5. If `obsNote` (set when an approval released a rev > A): info box (12.5px, `padding:10px 12px; radius md; bg accent-900`, `ph ph-info`): `Withdrawal · rev {prev} withdrawn automatically · 29 Sep` ("Retrait · …").
6. Section headers are 10.5px uppercase, `letter-spacing:0.08em`, accent colour, `margin-bottom:4px`.
   - **"Identity"** / "Identité": key/value rows `docMeta`: Number, Type (`{label} ({code})`), Family, Project (`QMS` shown as "QMS — transverse"), Service, Author, Confidentiality, Files (`JPG ×12` for PHO, else "Native + PDF" / "Natif + PDF"), Approval circuit, Retention, ISO process.
   - **"Classification"**: `tags.split(' · ')` as `tag tag-neutral` pills.
   - **"Revisions"** / "Révisions": one row per revision letter from A to current, **newest first** (`grid 44px minmax(0,1fr) auto auto; gap:10px; padding:6px 0; border-bottom neutral-900; 12.5px`):
     - `rev X` (500, tabular); note + sub-line `{date} · {by} · {versions}` (11px neutral-400); status tag; two ghost buttons "Native" / "Natif" and "PDF" (both log a download of the current revision).
     - Current revision: status = document status; date = document date; versions literal "A.3"; note "First issue" / "Première émission" (rev A) or `Rev {X} · changes recorded in transmittal`; colour text.
     - Earlier revision i: status "Obsolete" (`tag-outline`); date = `dayShift(docDate, −21 × (currentIndex − i))`; versions `{i+2} working versions`; note `Withdrawn {date + 21 d}`; colour neutral-500. (Synthetic history: one revision every 21 days.)
   - **"Approval proof"** / "Preuve d’approbation": one row per circuit step (`DOC_TYPE[type].circuit.split(' → ')`), grid `10px minmax(0,1fr) auto`: dot 10px (accent if signed, neutral-700 if pending) · `{role} · {who}` (who = author for step 0, else `DOC_WHO[role]` or "—") · `{state} · {when}` (11.5px neutral-400 tabular). A step is "Signed" when status is Released/Obsolete, or it is step 0, or `i ≤ engOv.appr[id]`; signed date = `dayShift(docDate, −(steps−1−i))`, pending date "—". Row colour text / neutral-500.
   - **"Distribution"** (only if non-empty): rows `{to} · rev {rev} · {date}` + tag: if shared with client → "Client — Port authority · N. Bensaïd" with "Acknowledged {date+1}" (`tag-neutral`) or "Acknowledgment pending" (`tag-accent`); plus one row per internal recipient from `to` (comma list, `client` excluded, mapped by `ENG_RCP`: process→Process, meca→Mechanical, elec→Electrical, auto→Automation, achats→Purchasing, site→Site) with tag "Received" (`tag-neutral`).
   - **"Download log"** / "Journal des téléchargements": session entries from `engOv.dl[id]`, then, for Released docs, two fixed entries `S. Haddad · rev X · {date+1} · PDF` and `N. Bensaïd · rev X · {date+2} · PDF` (12.5px neutral-300, bottom border).
   - **"Relations"** (only if `links` non-empty): pill buttons (`padding:4px 10px; radius md; border:1px solid neutral-800; 12px`; hover border accent-700) showing `{kind}` (neutral-400) + `{id}`. Only kind `Article` is clickable → `screen:'plm', part:id` (PLM part drawer). Other kinds (Deliverable, Purchase order, Punch item, Change request) have no handler.

### 4.6 "Deposit in Codex" dialog (`depOpen`, template 2363–2374, logic 5048–5060)
- Backdrop fixed `z-index:70`, `color-mix(bg 65%)`, click → `closeDep` (`dep.open=false, step=1, ctx=''`).
- Panel `card elev-lg`, fixed centred (`top:50%; left:50%; transform:translate(-50%,-50%)`), `z-index:71; width:min(640px,96vw); max-height:92vh; overflow:auto; padding:18px 22px; gap:14px`.
- Header: "Cx" badge · title "Deposit in Codex" / "Déposer dans Codex" · subtitle `dep.detected` = "New revision of an existing document" (when `ctx`) else `Type detected from file name · {type label}` · close ×.
- Info box (bg neutral-900, `ph ph-info`): "Keystone hands the context over to Codex — project, suggested type, linked order or article. Codex numbers the document, runs the approval circuit and sends the record back to this index."
- If `ctx` (new revision): banner (bg accent-900, accent-100) showing `ctx` = `"{id} · new revision {nextLetter}"`.
- **"Type proposed · confirm or change"** / "Type proposé · confirmer ou changer": chip buttons for types RPT, REC, NCR, CER, COC, PV, LET, MIN, PHO (DOC_TYPES order), each `padding:5px 10px; radius md; 12px`, showing code (neutral-400 tabular) + label; selected `bg accent-900 / border accent-700`, else transparent / neutral-800. Click → `dep.type`.
- Two fields (grid 2 cols, gap 12): "Linked purchase order" / "Commande liée" (`dep.link`, default `PO-2026-118`) and "Linked article" / "Article lié" (`dep.part`, default `CR-RAIL-A100`). Free text, no validation.
- Summary key/value rows (`depVals.meta`): Project (`QMS — transverse` for QMS), Type (`{label} ({code})`), Approval circuit, Retention, Confidentiality (`Client` if the type is a client deliverable else `Internal`), Linked to (`link · part` or "—"), **Numbering** = `by Codex · {number} (preview)` / "par Codex · … (aperçu)".
- **Number preview:** new document → `{TYPE}-{projCode}-{seq}` where `projCode` = "QMS" or the project code before the dash (HLT-026 → HLT) and `seq` = (number of existing docs of that type in that project + 40), 3 digits (e.g. CER for HLT-026 → `CER-HLT-042`). New revision → the existing document id.
- Buttons: `btn btn-ghost` "Cancel" / "Annuler" → close; `btn btn-primary` "Continue in Codex" / "Continuer dans Codex" (`ph ph-arrow-square-out`) → `handoff()` = `finish()` + toast `Codex · {number} recorded · synced to Keystone`.
- `finish()`:
  - New document: prepends to `dv.newDocs` a record `{id:number, type, title:'Material certificate 3.1 — S355 · heat 7781' (hard-coded), proj:dep.proj, svc (purchasing→procurement, quality→quality, site→site, else pm), rev:'A', status:'Draft', date:'29 Sep', by: persona name abbreviated ("Marie Lefebvre" → "M. Lefebvre"), conf, tags: "link · part" or "—", links: [['Purchase order',link]] and/or [['Article',part]], to:'', isNew:true}`; resets view to `all`, `fam`/`st` to null; opens the new record's drawer.
  - New revision: no new record; sets `engOv.docs[id] = 'Draft'` (status override) and closes the drawer.
- Openers: primary button "Deposit in Codex" (keeps last `type/proj/link/part`, clears `ctx`); drawer "New revision" (`type`, `proj`, `link` = first link id, `part:''`, `ctx`); PLM part drawer `openDepPart` (`type:'CER', link:'', part:<part ref>`). `dep.proj` is never reset to the current project (default `HLT-026`).
- `depVals` also exposes a 3-step wizard (`steps`: "File & type", "Metadata", "Number & record"; `is1/is2/is3`, `back/next`, `fileName`) that **the template does not render** — the dialog is single-step.

### 4.7 Interactions & state (`state.dv`, line 3774)
```
dv = { q:'', scope:'proj', fam:null, st:null, view:'all', sel:{}, open:null, newDocs:[],
       dep:{ open:false, step:1, type:'CER', proj:'HLT-026', link:'PO-2026-118', part:'CR-RAIL-A100', ctx:'' } }
```
Document lifecycle overrides live in `state.engOv` (line 3774, shared with engineering screens): `docs` (id → status), `appr` (id → number of approvals given), `ack` (`id|rev` → bool), `dl` (id → download log strings), `obs` (id → withdrawal note).

`approve()` (line 5026): `n = appr[id] + 1`; `rest = steps − 1`; when `n ≥ rest`: status → `Released`; if rev ≠ A → `obs[id] = "rev {prev} withdrawn automatically · 29 Sep"`; if the type is a client deliverable → `ack[id|rev] = false` (client acknowledgment pending). No role check: any persona can click the approve button.

`ack` default when not overridden: `shared && date ∉ {26 Sep, 28 Sep, 29 Sep}` (i.e. recently released client documents start "pending").

### 4.8 Data
`DOCS` (42 records), `DOC_TYPES` (28), `DOC_FAM`, `DOC_SVC`, `DOC_WHO`, `DOC_VIEWS`, `DOC_STATUSES`, `ENG_RCP`, `PERSONAS` (author/downloader name). See §8.

### 4.9 Cross-links
- Into the drawer (navigate to `docs` with `dv.open=<id>`): Meetings (minutes doc, `openDoc` line 4861 — sending minutes also creates a Released MIN record in `dv.newDocs`, line 4851), Contract (`openCtrDoc`, 4889; amendments 4884), ITP (4942), Commissioning dossier (4974), PLM part drawer "documents" list (`partDocs`, 5062).
- From the drawer: Relations › Article → PLM part (`plm`).
- Client portal (`client` screen, "documents" tab): lists `cpVaultDocs` = shared client documents of the project with "Acknowledge receipt" → sets `engOv.ack[id|rev]=true`, which updates the vault KPI and the drawer distribution row.
- Engineering discipline screens (`eng-*`) use the same document ids (`ENG_DOCS` derives from `DOCS`) and their "Freeze" / "Propose release" buttons write `engOv.docs` — the vault reflects them.
- PLM part drawer: "deposit" button opens this dialog pre-filled (`openDepPart`).

---

## 5. Document types register (`doctypes`)

### 5.1 Key, nav, audience
`isDocTypes = screen==='doctypes'`. Sidebar › Administration › "Document types register (Codex)" (`ph ph-list-checks`). Roles: director, pm, quality. No primary button. Not a `startScreen` option.

### 5.2 Purpose
Read-only mirror of the Codex document-type register: for each type, its family, approval circuit, retention rule, ISO 9001 clause, and whether it is a client deliverable; used to tag deliverables, drive the vault approval proof and the deposit summary.

### 5.3 Layout & components (template 2375–2383)
- Banner identical to the Documents banner (§4.4a) with texts "Synced from Codex" / "Synchronisé depuis Codex" and "This register is owned by Codex — numbering, circuits, retention and ISO processes are edited there. Keystone reads it to tag deliverables and link records."; single button `btn btn-primary` "Edit in Codex" / "Modifier dans Codex" (`ph ph-arrow-square-out`) → toast `Opening Codex · project {project}`.
- Card "Document types register" / "Registre des types de documents"; subtitle "One circuit, one retention rule and one ISO process per type · numbering TYPE-CLIENT-SEQ, revisions in letters, working versions A.1, A.2…".
- Table (12.5px), rows `docTypesRows` (line 5198), `DOC_TYPES` order, no sort/filter:

| Column EN / FR | Content |
|---|---|
| "Code" | code, tabular 500 |
| "Kind" / "Nature" | label |
| "Family" / "Famille" | `DOC_FAM[fam]`, 12px neutral-300 |
| "Approval circuit" / "Circuit d’approbation" | circuit, 12px neutral-300 |
| "Retention" / "Rétention" | 12px |
| "ISO process" / "Processus ISO" | 12px neutral-300 |
| "Client deliverable" / "Livrable client" | "Yes" / "Oui" or "—" |
| "In Codex" / "Dans Codex" | number of vault records of that type, **all projects** (incl. new deposits), tabular |

Full register content (counts = initial):

| Code | Kind | Family | Approval circuit | Retention | ISO process | Client | In Codex |
|---|---|---|---|---|---|---|---|
| PID | P&ID | Engineering | Author → Engineering lead → Project manager | Asset life | 8.3 Design & development | Yes | 2 |
| PFD | Process flow diagram | Engineering | Author → Engineering lead → Project manager | Asset life | 8.3 Design & development | — | 1 |
| SCH | Electrical schematics | Engineering | Author → Engineering lead → Project manager | Asset life | 8.3 Design & development | Yes | 1 |
| GA | General arrangement | Engineering | Author → Engineering lead → Project manager | Asset life | 8.3 Design & development | Yes | 1 |
| LST | Technical list | Engineering | Author → Engineering lead | Asset life | 8.3 Design & development | — | 4 |
| BOM | Bill of materials | Engineering | Author → Engineering lead | Asset life | 8.3 Design & development | — | 2 |
| FDS | Functional specification | Engineering | Author → Engineering lead → Client | Asset life | 8.3 Design & development | Yes | 1 |
| VAR | PLC variable table | Engineering | Author → Engineering lead | Asset life | 8.3 Design & development | — | 1 |
| HMI | HMI specification | Engineering | Author → Engineering lead → Client | Asset life | 8.3 Design & development | Yes | 1 |
| RPT | Test & inspection report | Client deliverables | Author → Quality manager → Project manager | 10 years | 8.6 Release of products | Yes | 2 |
| MAN | Manual / as-built | Client deliverables | Author → Engineering lead → Project manager | Asset life | 8.5.1 Production & service provision | Yes | 1 |
| PRO | Procedure | Quality | Author → Quality manager → Direction | Superseded + 3 years | 7.5 Documented information | — | 2 |
| FRM | Form / template | Quality | Author → Quality manager | Superseded + 3 years | 7.5 Documented information | — | 1 |
| REC | Quality record | Quality | Author → Quality manager | 10 years | 7.5.3 Control of documented information | — | 3 |
| NCR | Non-conformity report | Quality | Author → Quality manager | 10 years | 10.2 Nonconformity & corrective action | — | 3 |
| AUD | Audit report | Quality | Auditor → Quality manager → Direction | 10 years | 9.2 Internal audit | — | 1 |
| RFQ | Quotation | Purchasing | Buyer | 3 years | 8.4 External providers | — | 1 |
| PO | Purchase order | Purchasing | Buyer → Project manager | 10 years | 8.4 External providers | — | 1 |
| CER | Material certificate | Purchasing | Buyer → Quality (verification) | 10 years | 8.4.3 Information for external providers | — | 2 |
| COC | Certificate of conformity | Purchasing | Buyer → Quality (verification) | 10 years | 8.6 Release of products | Yes | 1 |
| PER | Permit | Site | Site manager → HSE officer | Project + 5 years | 8.5.1 Production & service provision | — | 2 |
| PV | Acceptance minutes (PV) | Site | Site manager → Project manager → Client | 10 years | 8.6 Release of products | Yes | 1 |
| HSE | HSE plan | Site | HSE officer → Project manager → Client | Project + 5 years | 8.5.1 Production & service provision | Yes | 1 |
| CTR | Contract / amendment | Contracts & mail | Project manager → Direction | 10 years after end | 8.2 Customer requirements | — | 2 |
| LET | Correspondence | Contracts & mail | Author | 5 years | 8.2.1 Customer communication | — | 1 |
| MIN | Meeting minutes | Contracts & mail | Author → Project manager | 5 years | 8.2.1 Customer communication | Yes | 1 |
| PHO | Site photos | Photos & reports | Author | Project + 5 years | 8.5.1 Production & service provision | — | 1 |
| VIS | Visit report | Photos & reports | Author → Project manager | 5 years | 8.5.1 Production & service provision | — | 1 |

Circuit semantics: steps separated by " → "; step 0 is the originator (Author/Buyer/Auditor/…), each further step is an approval; the number of approvals required to release = steps − 1 (single-step circuits like "Author" or "Buyer" need 0). Approver names come from `DOC_WHO`.

---

## 6. My work (`mywork`)

### 6.1 Key, nav, audience
`isMyWork = screen==='mywork'` (line 5174). Fixed sidebar entry "My tasks" / "Mes tâches" (`ph ph-check-square`) with the due-today badge. Roles: director and member (pm, depthead, etc. reach it only through links and then see the "Outside my workspace" banner). `startScreen` option: yes.

The screen shows the tasks of **`state.person`** (default `'Hélène Sauvage'`, line 3774), not of the logged-in persona. `person` changes when: a person row is clicked on Resources (line 3870, `{screen:'mywork', person:name}`), a team member is clicked on Approvals (4141), or a task is opened (`openTask` sets `person` to the task's assignee).

### 6.2 Purpose
Personal task list of a team member (engineer, QA, site lead…): tasks derived from plan activities and approved resource requests, with due dates, checklist progress, hours logged versus estimate, and three views (list grouped by urgency, kanban board, 2-week calendar with planned hours per day).

### 6.3 Layout (template 2813–2901)
```
column (gap 14px)
├─ header row (flex wrap, gap 12): person chip · viewing note · [margin-left:auto] "Display" seg (workSeg)   2815–2823
├─ KPI grid (5)                                         2824–2832
├─ [workList]  grouped list cards                       2833–2856
├─ [workBoard] 4 kanban columns                         2857–2874
└─ [workCal]   calendar card                            2875–2899
```

### 6.4 Components

**a) Person chip (2816–2820)** — flex, `gap:10px; padding:6px 10px 6px 6px; radius md; bg surface; box-shadow:var(--shadow-sm); cursor:pointer`: avatar 30×30 circle (bg accent-800, text accent-200, 11px) with `me.initials`; name (13px); sub-line `{role} · {projects}` (11.5px neutral-400; role from `PEOPLE`, projects = distinct `PROJ_NAMES` of the person's tasks joined " · ", e.g. "QA / QC · Harbor Line · Clinique Pasteur Lyon"; "No projects" / "Aucun projet" if none); caret `ph ph-caret-down` neutral-500. **No click handler** (intended person switcher).
- Viewing note (12px neutral-400): `Manager view · exactly what {first name} sees` ("Vue manager · …").

**b) View seg `workSeg`** (state `workView`, default `list`): "List" (`ph ph-list-bullets`, — no FR), "Board" (`ph ph-kanban`), "Calendar" / "Calendrier" (`ph ph-calendar-blank`).

**c) KPI tiles — `workKpis` (line 4066)**. Day axis: `TODAY = 4` (index), `dayDate(o) = new Date(2026, 8, 21 + floor(o/5)·7 + o%5)` → working days only: 0 = Mon 21 Sep … 4 = Fri 25 Sep (today), 5 = Mon 28 Sep … 9 = Fri 2 Oct, 10 = Mon 5 Oct… `dayLabel(o)` = "Fri 25 Sep" (FR "ven. 25 sept."). `open` = person's tasks with status ≠ done.

| Label | Value | Sub | Colour | Initial (Hélène) |
|---|---|---|---|---|
| "Due today" (— no FR) | # open with `due === TODAY` | `dayLabel(TODAY)` | OK | 2, "Fri 25 Sep" |
| "Overdue" / "En retard" | # open with `due < TODAY` | "Needs a new date or a push" (— no FR) | LO if any | 1 |
| "Next week" (— no FR) | # open with `TODAY < due ≤ 9` | "28 Sep – 2 Oct" (literal) | OK | 2 |
| "Logged this week" (— no FR) | Σ `logged` over **all** the person's tasks with `start ≤ TODAY` (incl. done), `toFixed(1) + ' h'` | `of 40 h · {round(sum/40·100)}%` | OK | "15.0 h", "of 40 h · 38%" |
| "Load next 2 wks" (— no FR) | `round((PEOPLE.load[0] + load[1]) / 2)` + "%" | "Over capacity — rebalance" if > 100 else "Within capacity" | LO if > 100 | 45%, Within capacity |

**d) List view (`workGroups`)** — vertical stack (gap 12) of group cards (`card elev-sm`, `padding:10px 16px 4px; gap:0`). Group header: label (11px, uppercase, `letter-spacing:0.08em`, group colour) + count (11.5px neutral-400, `"{n} task"` / `"{n} tasks"`). Groups (empty groups are omitted), each sorted by `byDue` = `due` ascending, then `prio==='high'` first:

| Group label | Members | Colour |
|---|---|---|
| "Overdue" / "En retard" | open, `due < TODAY` | LO |
| "Today" / "Aujourd’hui" | open, `due === TODAY` | accent-300 |
| "Next week" | open, `TODAY < due ≤ 9` | neutral-400 |
| "Later" | open, `due > 9` | neutral-400 |
| "Recently done" | status done (unsorted) | neutral-400 |

Task row (`grid-template-columns:20px minmax(0,1fr) auto; gap:12px; padding:9px 0; border-top:1px solid neutral-900; cursor:pointer`; hover `background: color-mix(in srgb, var(--color-text) 3%, transparent)`); row click → `openTask` (screen `task`, `task:id`, `person:assignee`):
1. Done toggle: 18×18 circle, `border:1.5px solid` (accent if done, neutral-600 otherwise), fill accent if done, check icon 10px in `--color-bg`; `title="Mark done"`. Click (stops propagation) → status done ↔ `doing`; pct 100 ↔ 75.
2. Middle: title (13.5px; line-through and neutral-500 when done) + if `fresh` a `tag tag-accent` (10px) `New · approved by {dept}` ("Nouveau · approuvé par …"); meta line (11.5px neutral-400): project tag (`tag tag-neutral` 10px, `PROJ_NAMES[project]`), activity id, labels as `#label` in accent-300.
3. Right (12px neutral-400, nowrap, gap 14): high-priority icon `ph ph-arrow-fat-up` (accent, title "High priority" / "Priorité haute") when `prio==='high'`; `ph ph-check-square` + checklist `done/total`; `ph ph-clock` + `logged/est h`; due text (`min-width:88px`, right-aligned, colour `dueColorOf`).

`dueTextOf(t)`: done → "Done"; overdue → `Overdue · {dayLabel(due)}`; today → "Today"; else `dayLabel(due)`. `dueColorOf`: done → neutral-500; overdue → LO; today → accent-300; else neutral-400.
Checklist counts `clOf(t)`: from `state.checks[id]` when present (`[#true, length]`), else the task's static `cl` pair.

**e) Board view (`boardCols`)** — grid `repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:10px; align-items:start`. Column panel: `padding:10px; radius md; background: color-mix(in srgb, var(--color-surface) 60%, transparent); box-shadow: var(--shadow-sm)`; header dot 8px + label (12.5px 500) + count. Columns (all the person's tasks, sorted `byDue`): "To do" / "À faire" (dot neutral-400), "In progress" / "En cours" (accent), "In review" / "En revue" (accent), "Done" / "Terminé" (neutral-500). Card = `button.card` (`gap:6px; padding:10px 12px; no border; shadow-sm`, hover `shadow-md`): title (13px, line-through if done), project tag + activity (11px), row with due text (coloured) · checklist · hours (right), progress bar 3px (track neutral-800, fill accent, width `pct%`). Card click → `openTask`. No drag-and-drop; no toggle. Empty column: "Nothing here" / "Rien ici".

**f) Calendar view** — card `overflow:auto`; header: title literal "21 Sep – 2 Oct" / "21 sept. – 2 oct." + two `btn btn-icon btn-secondary` 28×28 (`ph ph-caret-left` / `ph ph-caret-right`, **no handlers**).
Grid `grid-template-columns:200px repeat(10,minmax(56px,1fr)); min-width:780px`:
- Header row: empty cell + 10 day cells (`calDays`): weekday (10.5px neutral-400) + day number (13px tabular); today: text accent-300, bg accent-900; cells have `border-left:1px solid neutral-900`, bottom border neutral-800.
- One row per `calRows` task (open tasks with `start ≤ 9 && due ≥ 0`, sorted `byDue`), height 40px:
  - Label cell (clickable → task): title (12.5px, ellipsis) + `{project} · {logged/est h}` (11px neutral-400).
  - Track cell spanning 10 columns: background `repeating-linear-gradient(to right, var(--color-neutral-900) 0 1px, transparent 1px 10%)`; a fixed "today" band `left:40%; width:10%` (accent-900, opacity .5 — hard-coded to index 4); bar `top:9px; height:22px; radius 5px; 11.5px; padding 0 8px` at `left = max(start,0)·10%`, `width = (min(due,9) − left + 1)·10%`, clickable → task. Bar colours: overdue → bg accent-800 / text accent-100 / `box-shadow: inset 0 0 0 1px accent-600`; doing → accent-900 / neutral-200 / inset accent-600; other → neutral-900 / neutral-200 / inset neutral-700.
- Footer row "Planned hours" / "Heures prévues" (12px neutral-300) + 10 cells (`calHours`): Σ over open tasks covering that day of `est / (due − start + 1)`, shown `toFixed(1)` or "—"; colour LO if > 8 h; today cell bg accent-900.

### 6.5 Interactions & state
| Control | State written |
|---|---|
| View seg | `workView` |
| Done toggle (list) | `todos[i].status`, `todos[i].pct` |
| Row / card / bar click | `screen:'task'`, `task`, `person` |
| Primary "Log time" | navigates to the first open task (`openTask`) |

### 6.6 Data
`state.todos` (copy of `TODOS`, plus tasks created by request approvals and meeting minutes), `state.checks`, `PEOPLE` (role + 8-week load), `PROJ_NAMES`, `STATUS_L`, `TODAY`. See §8.

### 6.7 Cross-links
- To: Task detail.
- From: Resources people rows, Approvals team list, Member home (`homes.member`, line 4429: "My tasks" list opens tasks; "Hours logged" and "Load" rows open My work), notification n9 "New task assigned…" (member), Plan activity drawer (activity todos list, line 4027, opens tasks).
- New tasks appear here when a department head approves a resource request (line 4112: `id 'T-'+(2341+n)`, `status:'todo'`, `cl:[0,3]`, `labels:[first word of dept]`, `fresh:true`, `dept`) and when meeting minutes are sent with actions assigned to known people (line 4850).

---

## 7. Task detail (`task`)

### 7.1 Key, nav, audience
`isTask = screen==='task'`; current task `TSK = todos.find(id === state.task) || todos[0]` (default `'T-2314'`). No own nav entry ("My tasks" is highlighted). Roles: director, member (others see the read-only banner). `startScreen` option: yes. Title = task title; breadcrumb "My work · {id}".

### 7.2 Purpose
Execution sheet of one task: status and % progress, checklist, files, comments with @mentions, time logging (which becomes actual labour cost on the work package), and the position of the task's activity in the plan (finish date, float, critical path).

### 7.3 Layout (template 2902–2969)
```
column (gap 14px)
├─ header row (flex wrap, gap 10): back · id · project tag · activity link · [margin-left:auto] status seg   2904–2910
└─ grid repeat(auto-fit,minmax(min(100%,380px),1fr)), gap 14, align-items:start                            2911–2967
   ├─ left column (gap 14): Meta+description card · Checklist card · Files card · Comments card
   └─ right column (gap 14): Progress & Time card · Plan card
```

### 7.4 Components

**a) Header row**
- `btn btn-ghost` 13px `ph ph-arrow-left` "My work" / "Mon travail" → `screen:'mywork'` (`goMyWork`).
- Task id (12px neutral-400 tabular).
- `tag tag-neutral` project name (`PROJ_NAMES`).
- `btn btn-ghost` 12.5px: `{act} · {activity name}` + `ph ph-arrow-square-out` → `openPlan` = `screen:'plan', sel:activityId, collapsed[wbs]=false` (expands the WBS node).
- Status seg `task.statusSeg`: "To do" / "In progress" / "In review" / "Done" → `setTask({status:v, pct: v==='done' ? 100 : (pct===100 ? 75 : pct)})`.

**b) Meta + description card** (`padding:14px 16px; gap:10px`): flex-wrap of meta items (`gap:8px 22px`; key 10.5px uppercase neutral-400; value 12.5px coloured):

| Key | Value | Colour |
|---|---|---|
| "Assignee" (— no FR) | person | text |
| "Due" / "Échéance" | `dayLabel(due)` | LO if overdue and not done |
| "Priority" / "Priorité" | High / Medium / Low (FR Élevé / Moyen / Faible) | accent-300 if High |
| "Estimate" (— no FR) | `{est} h` | text |
| "Labels" (— no FR) | `#QA  #Site` (two spaces) | text |

Description paragraph (13.5px, `line-height:1.55`, neutral-200): `DESC[id]` or the generated default `"Part of {act} {activity name} — WBS {w} {package}. Complete the work, tick the checklist and log your hours; progress rolls up to the activity and the earned value of its work package."`.

**c) Checklist card** — header "Checklist" / "Liste de contrôle" (card-title 15px) + `{done} of {total} done` ("… sur …"); progress bar 3px (fill accent, width `round(done/total·100)%`). Items (`CHECKS[id]` with state `checks[id]`): full-width buttons (`padding:7px 0; border-bottom neutral-900; 13px`), box 16×16 radius 4 (`border:1.5px` accent/neutral-600, fill accent when done, check 10px in bg colour), text with line-through + neutral-500 when done. Click → toggles `checks[id][i]`. Empty: "No checklist yet" / "Aucune liste pour l’instant". Add row: input placeholder "Add an item…" / "Ajouter un élément…" + `btn btn-secondary` "Add" — **no handlers** (not wired). Note: when a task has no `CHECKS` entry, the header still shows its static `cl` pair (e.g. "0 of 3 done") above "No checklist yet".

**d) Files card** — header "Files" / "Fichiers" + `btn btn-ghost` "Attach" / "Joindre" (`ph ph-paperclip`, **no handler**). Rows (`border-top neutral-900; padding:6px 0; 13px`): 30×30 icon tile (radius 6, bg neutral-900, accent-300, icon from data e.g. `ph ph-file-xls`, `ph ph-image`, `ph ph-file-pdf`), name (ellipsis) + meta (11.5px neutral-400, e.g. "48 KB · H. Sauvage · today"). Not clickable. Empty: "No files attached" / "Aucun fichier joint".

**e) Comments card** — "Comments" / "Commentaires". Rows `grid 28px minmax(0,1fr); gap:10px; padding:8px 0; border-top neutral-900`: avatar circle 28px (bg neutral-800, neutral-200, 10.5px initials); author + when (12px; when neutral-500); text 13px `line-height:1.5` neutral-200. Empty: "No comments yet" / "Aucun commentaire". Composer: input (value `commentText`, placeholder "Write a comment… @mention to notify" / "Écrire un commentaire… @mention pour notifier", `min-height:34px`) + `btn btn-primary` "Post" / "Publier" → `addComment`: trims; empty → no-op; appends `['Marie Lefebvre', 'Just now', text]` (author hard-coded, not the current persona) to `comments[id]`; clears the input. @mentions are not parsed.

**f) Progress & Time card** (right column)
- "Progress" / "Avancement" + `pct%` (18px 500 tabular); bar 6px (fill accent, width pct%).
- `pctSeg` (full-width seg, each option `flex:1; justify-content:center`): 0%, 25%, 50%, 75%, 100% → `setTask({pct:v, status: v===100 ? 'done' : ((status==='done' || status==='todo') && v>0 ? 'doing' : status)})`.
- "Time" / "Temps" + `{logged.toFixed(1)}` (500) + ` / {est} h` (neutral-400); bar 6px, width `min(logged/est,1)` as %, colour LO if `logged > est` else neutral-300.
- Entries (`state.entries[id]`): rows `grid 96px minmax(0,1fr) auto; 12.5px; border-top neutral-900`: date (neutral-400) · note (neutral-300, ellipsis) · `{h} h`.
- Log form `grid 72px minmax(0,1fr) auto; gap:6px`: hours input (`logH`, placeholder "h", right-aligned) · note input (`logNote`, placeholder "What did you work on?" / "Sur quoi avez-vous travaillé ?") · `btn btn-primary` `ph ph-plus` "Log" / "Saisir" → `logTime`: `h = parseFloat(logH)`; falsy (0/NaN) → no-op; appends `[dayLabel(TODAY), h, logNote || 'Work on ' + title]`, adds `h` to `todos[i].logged`, clears both inputs. No upper bound; negative values accepted. `pct` is not recomputed from hours.
- Cost note (11.5px neutral-400): `{logged} h × ${rate}/h = ${round(logged·rate)} actual cost → Labor · WP {w} {package}` where `rate = RATES[role of assignee] || 100` (e.g. QA / QC = 95 → "6.0 h × $95/h = $570 actual cost → Labor · WP 1.4 Steel structure"). The `$` sign is hard-coded regardless of the currency prop. Fallback when the activity is unknown: "… → Labor · Clinique Pasteur Lyon".

**g) Plan card "Where this sits in the plan"** / "Position dans le plan" — key/value rows (`padding:4px 0`):

| Key | Value | Colour |
|---|---|---|
| "Activity" / "Activité" | `{act} · {name}` | text |
| "Work package" / "Lot de travaux" | `{w} {package}` (fallback "2.2 MEP — Clinique Pasteur Lyon") | text |
| "Activity finish" | activity `f` (e.g. "09 Oct") | text |
| "Total float" | "— (complete)" if `tf` null, else signed `{tf}d` (e.g. "-27d") | LO if negative |
| "Activity progress" | `{pc}%` | text |

If the activity float is negative and the task is not done: accent-900 info box (`ph ph-lightning`): "On the critical path — every day this activity finishes late moves the handover date." / "Sur le chemin critique — chaque jour de retard décale la date de livraison.". Button `btn btn-secondary` "Open activity in plan" / "Ouvrir l’activité dans le plan" (`ph ph-tree-structure`) → `openPlan`.

### 7.5 Interactions & state
| Control | State |
|---|---|
| Status seg / Mark done (primary) / % seg | `todos[i].status`, `todos[i].pct` |
| Checklist item | `checks[id][i]` |
| Comment input / Post | `commentText`, `comments[id]` |
| Log inputs / Log | `logH`, `logNote`, `entries[id]`, `todos[i].logged` |
| Back / activity link / Open activity in plan | `screen`, `sel`, `collapsed` |

### 7.6 Data & formulas
- Task record from `TODOS` (§8); `pct` initial = 100 if done else `min(100, round(logged/est·100))`.
- Activity lookup `ALL_BYID[act]` (Plan activities across projects): fields `id, w, n, pkg, f, tf, pc`.
- Actual labour cost = logged hours × role rate (`RATES`); shown as text only — EVM roll-up to the work package is described ("progress rolls up…") but not computed here.

### 7.7 Cross-links
Plan (activity selection, WBS expansion), My work (back), Budget (labour cost narrative), Hours/Lucca (the member home calls hours "Read from Lucca").

---

## 8. Data entities (field level)

### Settings (`SETTINGS0`, line 3467 → `state.settings`)
| Field | Type | Example |
|---|---|---|
| `skills` | string[] | copy of `SKILLS`: "Structural", "Electrical / HV", "MEP", "Automation & controls", "Crane & lifting", "Civil & site", "Planning & cost control", "Procurement", "Quality / QA-QC", "Software / IT" |
| `locations` | `[name: string, type: string][]` | ["Entrepôt central — Lyon","Central warehouse"], ["Atelier mécanique — Lyon","Workshop"], ["Magasin chantier — Le Havre","Site store"], ["Magasin chantier — Marseille","Site store"], ["Consignation — Nordvolt","Consignment at supplier"], ["Zone quarantaine QC — Lyon","Quarantine (QC hold)"] |
| `costCats` | string[] | Labor … Contingency (6) |
| `statuses` | string[] | copy of `STATUSES` (13 lifecycle stages incl. Annulé) |
| `riskCats` | string[] | 7 categories |
| `delivTypes` | string[] | 8 types |
| `holidays` | string[] `"{d} {Mon} · {name}"` | "14 Jul · Fête nationale" |
| `health` | `{risk: number, off: number}` | `{risk:0.97, off:0.90}` |
| `locTypes` | string[] | Central warehouse, Workshop, Site store, Consignment at supplier, Quarantine (QC hold) |
UI state: `drafts: {[listKey]: string}`, `locType: string`.

### ActivityEvent (`ACTIVITY`, 3557–3569) — tuple `[when, who, what, kind]`
`when` string "25 Sep 16:45"; `who` person or system ("Lucca", "System", "Sage X3"); `what` sentence; `kind` ∈ sync, stock, comment, change, snapshot, quality, request, delivery, invoice, eco, client. 12 rows.

### Connector (`CONNECTORS`, 3570) — `[name, what, freq, status, last, vol]`
| name | what (data) | freq | status | last | vol |
|---|---|---|---|---|---|
| Cursus | Individual go / no go: visa approval, vaccination confirmation, clearances & badges — approvals only, no personal data imported | Real time (webhooks) | OK | 26 Sep 07:00 | 5 people · HLT-026 |
| Codex | Document records, revisions, approval circuits, retention · deep links from every Keystone object | Real time (webhooks) | OK | 26 Sep 08:02 | 412 records · 38 linked to HLT-026 |
| Lucca | Hours, leave, RTT, sick leave | Daily 06:30 | OK | 26 Sep 06:30 | 312 h · 8 people |
| Sage X3 | Stock positions, purchase orders, supplier invoices, accounts payable | Every 2 h | OK | 26 Sep 07:15 | 18 stock lines · 6 invoices |
| SolidWorks PDM | Drawings, revisions, released states | Hourly | OK | 26 Sep 07:40 | 1 248 drawings · 13 linked |
| MS Project | Schedule import / export (XML) | On demand | Ready | 25 Sep 18:02 | HLT-026 exported · BL1 |
| Outlook / Exchange | Calendar sync for milestones and approvals | Every 15 min | Warning | 26 Sep 07:55 | Token expires in 3 days |
| Microsoft Teams | Notifications to project channels | Real time | OK | 26 Sep 08:00 | 14 messages today |
| E-mail (SMTP) | Digest and approval e-mails | Real time | OK | 26 Sep 08:01 | 9 sent today |
Status enum: OK, Warning, Ready.

### ImportFormat (`IMPORTS`, 3571) — `[name, desc, icon]`
MS Project XML (import), Excel / CSV (import: budget lines, BOM, parts catalogue, resource assignments), Primavera P6 XER (import), Export — MS Project XML, Export — Excel (any table, filtered view), Export — PDF (status report, PO, goods receipt, 8D, PV de réception). Icons `ph-file-arrow-down`, `ph-file-xls`, `ph-file-arrow-up`, `ph-file-pdf`.

### AuditEntry (`AUDIT`, 3572) — `[when, who, object, change, area]`
e.g. `['25 Sep 09:12','Romain Aubert','CR-008','status: Draft → In review','Change control']`. Areas seen: Change control, Approvals, Settings, Purchase orders, Deliveries, Stock, ECO, Deliverables. Immutable (append-only).

### SiteSheet (`SITE`, 3573)
`code` "HLT-026"; `site`; `country`; `tz`; `lang`; `cur`; `contact`; `hours`; `holidays`; `access`; `start` "19 Oct 2026"; `end` "18 Dec 2026"; `doneDays` 0; `planDays` 44.

### CursusClearance (`SITE_DOCS`, 3574) — `[who, visa, vacc, hab, habNote, verdict, received]`
visa ∈ {Not required, Approved, Pending}; vacc ∈ {Confirmed, Pending}; hab ∈ {OK, Pending, Expiring, Missing}; verdict ∈ {GO, GO with reserve, NO GO}; received "26 Sep 07:00". Override: `siteDocOv[index] = 'sent'` (reminder).

### SiteEquipment (`SITE_EQUIP`, 3575) — `[name, source, status, note]`
source ∈ {Expédié, Location locale, Client}; status ∈ {Confirmed, Pending}. Override `siteEqOv[index]`.

### ClientPrerequisite (`SITE_PREREQ`, 3576) — `[title, activityId, neededBy, status, evidence]`
status ∈ {Pending, Confirmed, Signed}; neededBy "2 Nov". Override `siteOv[index]`.

### RotationEntry (`SITE_ROTATION`, 3577) — `[who, roleOnSite, from, to, lodging, travel, rotation]`
e.g. `['Amélie Ollivier','Chef de chantier','19 Oct','18 Dec','Hôtel Vauban','TGV','1']`; rotation '1'|'2'.

### Collision (`SITE_COLLISIONS`, 3578) — `[who, what, kind, fix]`
kind ∈ {Load, Cert, Doc, Leave}.

### MissionCostLine (`SITE_COSTS`, 3579) — `[name, budget_k€: number, actual_k€: number]`
Voyages 12.4/4.2, Hébergement 18.6/0, Per diem 9.8/0, Majorations chantier (6j · 10h) 22.0/0, Location matériel local 31.5/6.0, Transport local & douane 4.0/1.1.

### DailyReport (`SITE_REPORTS`, 3580) — `[date, activity, pct, text, link, by]`
link "NCR-029" or "—"; pct "—".

### SitePunchItem (`SITE_PUNCH`, 3581) — `[id, title, ncr, status, owner, due]`
status ∈ {Open, Closed}; owner ∈ {Client, Keystone}.

### HseItem (`SITE_HSE`, 3582) — `[title, status, date]`
status ∈ {Signed, Ready, Pending, free text e.g. "0 déclaré"}.

### DocumentType (`DOC_TYPES`, 3615; index `DOC_TYPE`, 3616)
`{code: string, label: string, fam: DocFamilyKey, circuit: string (" → " separated roles), retention: string, iso: string, client: boolean}` — full table in §5.3.
`DOC_FAM` (3614): eng → Engineering, client → Client deliverables, quality → Quality, purchasing → Purchasing, site → Site, contracts → Contracts & mail, photos → Photos & reports.
`DOC_WHO` (3617) role → approver: Engineering lead → A. Girard, Project manager → R. Aubert, Quality manager → G. Comte, Direction → M. Lefebvre, Client → N. Bensaïd, Quality (verification) → G. Comte, HSE officer → L. Fabre, Buyer → F. Bertrand, Site manager → L. Fabre, Auditor → G. Comte.
`DOC_SVC` (3662): process → Process, meca → Mechanical, elec → Electrical, auto → Automation, quality → Quality, procurement → Purchasing, site → Site, pm → Project management.
`DOC_VIEWS` (3663): see §4.4d. `DOC_STATUSES` (3664): Draft, Frozen, Release proposed, Released, Obsolete.

### Document (`DOCS`, 3618–3661; plus `dv.newDocs`)
| Field | Type | Example |
|---|---|---|
| `id` | string — `TYPE-PROJ-SEQ` (or TYPE-QMS-SEQ, TYPE-INS-…) | "PID-HLT-026" |
| `type` | DocumentType code | "PID" |
| `title` | string | "P&ID" |
| `proj` | project code or "QMS" | "HLT-026" |
| `svc` | DOC_SVC key | "process" |
| `rev` | letter A–Z | "D" |
| `status` | DOC_STATUSES | "Released" |
| `date` | "d Mon" (2026) | "26 Sep" |
| `by` | author short name | "P. Noguès" |
| `conf` | Internal \| Client \| Supplier | "Client" |
| `tags` | " · "-separated string | "A1410 · A1420 · LT-101 · XV-111" |
| `links` | `[kind, id][]`, kind ∈ Deliverable, Article, Purchase order, Punch item, Change request | `[['Deliverable','D-016']]` |
| `to` | comma list of recipient keys (process, meca, elec, auto, client, achats, site) or '' | "meca,elec,auto,client" |
| `isNew` | boolean (deposits / minutes only) | true |
Derived per row (`docRow`): `status` (override), `typeLabel`, `fam`, `famLabel`, `svcLabel`, `stClass`, `revText`, `tagList`, `shared`, `ack`, `confClass`, `circuit`, `retention`, `iso`, `nextRole`, `canApprove`, `approveLabel`, `selected`, plus handlers `open/toggle/freeze/propose/approve/acknowledge/download`, `canFreeze` (Draft), `canPropose` (Frozen).
42 records: 40 for HLT-026 + QMS, 2 for NDC-031.

### DocumentOverrides (`state.engOv`, shared)
`docs: {[id]: status}`, `appr: {[id]: number}`, `ack: {[id|rev]: boolean}`, `dl: {[id]: string[]}`, `obs: {[id]: string}` (+ `inputs/checks/gen` used by engineering screens).

### DepositDraft (`state.dv.dep`)
`open: boolean, step: 1|2|3 (unused), type: DocumentType code, proj: string, link: string (PO id), part: string (article ref), ctx: string ("{id} · new revision {X}" or '')`.

### Task (`TODOS`, 3228–3256 → `state.todos`)
Tuple `[id, person, title, project, act, status, prio, start, due, est, logged, cl, labels]` mapped to:
| Field | Type | Example |
|---|---|---|
| `id` | "T-nnnn" | "T-2314" |
| `person` | full name (PEOPLE) | "Hélène Sauvage" |
| `title` | string | "Survey verticality — Bay 3 columns" |
| `project` | short code (HLT, RCF…) | "HLT" |
| `act` | activity id | "A1250" |
| `status` | todo \| doing \| review \| done (labels `STATUS_L`) | "doing" |
| `prio` | high \| med \| low | "high" |
| `start`, `due` | working-day index relative to Mon 21 Sep 2026 (TODAY = 4 = Fri 25 Sep) | 3, 4 |
| `est` | hours | 8 |
| `logged` | hours (number) | 6 |
| `cl` | `[done, total]` static checklist counts | [2,4] |
| `labels` | string[] | ['QA','Site'] |
| `pct` | derived 0–100 | 75 |
| `fresh`, `dept` | optional (tasks from approved requests) | true, "Engineering" |
27 rows for 8 people (Hélène Sauvage 8, Julien Wagner 5, Amélie Ollivier 4, Thomas Kerbrat 2, Léa Marchand 2, Damien Roux 2, Pauline Noguès 2, Fabien Bertrand 2).

### ChecklistItem (`CHECKS`, 3257) — `{[taskId]: [text, done 0|1][]}` → `state.checks: {[taskId]: boolean[]}`. Present for T-2314, T-2305, T-2318.
### Comment (`COMMENTS`, 3258) — `{[taskId]: [author, when, text][]}` (T-2314 only) → `state.comments`.
### TaskFile (`FILES`, 3259) — `{[taskId]: [name, meta, icon][]}` (T-2314, T-2305). Static.
### TimeEntry (`ENTRIES`, 3260) — `{[taskId]: [dateLabel, hours, note][]}` → `state.entries`.
### Description (`DESC`, 3261) — `{[taskId]: string}` (T-2314 only).
### Supporting: `PEOPLE` (3123: `[name, role, load%[8 weeks]]`), `RATES` (3262: role → €/h), `PROJ_NAMES` (3263), `STATUS_L` (3264), `TODAY` (3265), `PERSONAS` (3747), `ROLE_SCREENS` (3465–3466).

---

## 9. Status machines / workflows

**Document (vault, shared with engineering screens)**
```
(deposit / new revision in Codex) → Draft --Freeze (eng screens)--> Frozen --Propose release (eng screens)--> Release proposed
Release proposed --approve × (circuit steps − 1)--> Released
Released (rev N) ⇒ rev N−1 shown as Obsolete + "withdrawn automatically" note
```
- Approvals are sequential by circuit order; the button shows the next role and its named approver (`DOC_WHO`).
- On release of a client-deliverable type: client acknowledgment becomes pending → client acknowledges on the client portal → "Acknowledged".
- New revision via the deposit dialog sets the existing record back to `Draft` (rev letter not incremented in the index).

**Go chantier (Site)** — `GO` ⇔ all five: no prerequisite Pending ∧ no Cursus NO GO ∧ all equipment Confirmed ∧ zero collisions ∧ no HSE permit Pending; otherwise `NO GO` (sidebar badge).

**Client prerequisite** — `Pending` --"Client confirms"--> `Confirmed` --"Signed on site"--> `Signed`.

**Site equipment** — `Pending` --"Confirm"--> `Confirmed`.

**Cursus individual go** — verdict read-only from Cursus (GO / GO with reserve / NO GO); reminder action `not sent → sent` for non-GO rows.

**Site punch item** — Open / Closed (read-only here). **HSE item** — Pending / Ready / Signed (read-only).

**Task** — `todo ⇄ doing ⇄ review ⇄ done` (any transition via the status seg). Couplings: Done ⇒ pct 100; leaving Done from pct 100 ⇒ pct 75; pct 100 ⇒ Done; pct > 0 on todo/done ⇒ doing; list toggle Done ⇄ doing (pct 100 ⇄ 75).

**Connector** — OK / Warning / Ready (display only).

---

## 10. Cross-links

| From | Trigger | To |
|---|---|---|
| Sidebar (any screen) | "Site (chantier)" `NO GO` badge | Site |
| Site › Collision "Resolve" | kind Load / Leave / Cert / Doc | What-if levelling / Leave & calendar / Skills matrix / Site Readiness tab |
| Site › Daily report row | link NCR-xxx | Quality, NCR tab, NCR drawer |
| Documents › drawer Relations | Article | PLM, part drawer |
| Meetings, Contract (+ amendments), ITP, Commissioning, PLM part drawer | "open document" | Documents with drawer open |
| PLM part drawer | deposit button (`openDepPart`) | Deposit dialog (type CER, part pre-filled) |
| Meetings › send minutes | creates MIN record in `dv.newDocs` | Documents (New tag) |
| Client portal › documents | Acknowledge receipt | updates vault ack state |
| Engineering discipline screens | Freeze / Propose release | vault statuses (`engOv.docs`) |
| Resources people row, Approvals team row | click | My work (person) |
| Member home | My tasks rows / Hours logged / Load | Task / My work |
| Plan activity drawer | task in activity todo list | Task |
| Approvals (dept head) | approve request | new "fresh" task in My work |
| Task › activity link / "Open activity in plan" | click | Plan (activity selected, WBS expanded) |
| Task › "My work" | click | My work |
| Notification n9 (member) | click | My work |
| Settings › locations / risk categories | data | Stock & storages / Risk register chips |

---

## 11. Open questions

1. **Settings are mostly not wired.** Health thresholds (`settings.health`) are displayed but every health computation uses hard-coded `0.90 / 0.97` (lines 3794, 3916). `skills`, `costCats`, `statuses`, `delivTypes`, `holidays` are not read by Skills matrix, New-project wizard, Projects, Deliverables or capacity. Should the rebuild drive those modules from these lists? Who may edit (role permission is only screen visibility), is there an audit entry (AUDIT has an "Settings" area example), and should removal of an in-use value be blocked?
2. Settings: "Reset to defaults" has no confirmation; removals have no undo; no duplicate check; no validation that "Off track below" < "At risk below". The "Rate cards" mention looks like a link but is not.
3. Plumbing: "Sync now", "Configure", import drop zones and the audit export are inert; "Add connector" toasts but does not add a row, and its system list (SharePoint, SeeElectrical, SolidWorks 3DX, TIA Portal) differs from the connectors table. Expected behaviour?
4. Plumbing KPI "Events today" counts both 25 and 26 Sep (status date is 25 Sep). Define "today" (status date vs. clock).
5. Site module is gated on `project === 'HLT-026'`; the empty-state text says it opens at the Expédition stage. Confirm the rule (stage ≥ Expédition and site sheet exists?).
6. Site "late" prerequisite uses a hard-coded list of dates ('12 Oct', '16 Oct') while the subtitle promises "J-15 unconfirmed → alert, risk and client letter". Implement the J-15 rule? Are the alert/risk/letter automations in scope?
7. Site hard-coded values: "Man-days planned" 168, "Client decisions logged" 3, "HSE" "0 incident", "2 rotations", "Site starts 19 Oct…" footnote, Go-chantier "checked daily from J-30".
8. Rotation plan headers read "Issued by" / "Recipients" (FR "Émetteur" / "Destinataires") but the cells are the mission start and end dates — almost certainly a label mix-up for "From" / "To" (Arrival / Departure). Confirm.
9. Go chantier: ok and not-ok items use the same colour (accent-300) and the GO/NO GO tag is always `tag-accent`; should GO be visually distinct?
10. Cursus: the "Remind in Cursus" action is offered for "GO with reserve" rows too — intended? The collision list has no "resolved" state.
11. Site "Daily report" form does not create a daily-report row; "Declare incident" and "Client communication log" are inert.
12. Vault: no role check on "Approve in Codex" (any persona can approve any step). Should approval be restricted to the named approver (`DOC_WHO`) and executed in Codex only (the drawer says approvals are read-only here)?
13. Vault dates are hard-coded ("29 Sep" for downloads, deposits, withdrawals) and revision history is synthesised (one revision every 21 days, "A.3" working versions, fixed download-log entries for S. Haddad / N. Bensaïd). The real Codex sync must supply revisions, approvals, distribution and download log.
14. Deposit dialog: title of a new record is hard-coded ("Material certificate 3.1 — S355 · heat 7781") whatever the type; `dep.proj` is not reset to the current project; the 3-step wizard state exists but only one step is rendered; numbering preview uses "count + 40". A "new revision" only resets the status to Draft without incrementing the revision letter. Define the real hand-off contract with Codex (deep link? API create?).
15. Vault "Download zip", both "Export register (xlsx)" buttons and Relations of kind Deliverable / Purchase order / Punch item / Change request have no handler — target screens?
16. KPI "Obsolete revisions withdrawn" is the sum of revision letters, not a count of actual obsolete records.
17. My work shows `state.person` (default Hélène Sauvage) for every persona; the member persona is Julien Wagner. Should My work default to the logged-in user, with the person chip (caret, no handler) as a manager-only switcher? The "Manager view · exactly what X sees" note is always shown.
18. My work calendar: fixed window "21 Sep – 2 Oct", prev/next buttons inert, today band hard-coded at column 5; "Next week" sub hard-coded. KPI "Logged this week" sums all hours of tasks started by today rather than this week's time entries; "Load next 2 wks" uses the first two weeks of `PEOPLE` load. Confirm formulas.
19. Many My work / Task strings have no French translation (List, Due today, Next week, Logged this week, Load next 2 wks, Later, Recently done, task/tasks, Assignee, Estimate, Labels, Activity finish, Total float, Activity progress, Log time, Needs a new date or a push, Within capacity, Over capacity — rebalance, Rated 1–5, Per-project overrides allowed, …).
20. Task: checklist "Add" and files "Attach" are not wired; the comment author is hard-coded "Marie Lefebvre" and @mentions are not parsed/notified; the cost note always uses "$"; logging hours does not update % progress; negative hours are accepted; setting 0% on a Done task keeps status Done; a task without `CHECKS` shows "0 of 3 done" with "No checklist yet". Should logged time sync to Lucca (Hours screen) and feed EVM actual cost?
21. Board view has no drag-and-drop; is moving cards between columns expected?
