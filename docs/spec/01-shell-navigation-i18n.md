# 01 — App shell, navigation, roles, global dialogs, i18n

Source of truth: `design/Keystone PM v8.dc.html` (prototype) and `design/_extracted/template-annotated.html` (same line numbers; `«…»` = English text of a `{{ T.kN }}` key). All line numbers below refer to these files. Logic identifiers (state keys, constants, handlers) are quoted in `code`. French (FR) labels are given as rendered by the prototype's own translation layer (`trFR`), checked by running the prototype logic headlessly.

## 0. Screens and global elements covered

| # | Element | Binding / key | Template lines | Logic (main) |
|---|---|---|---|---|
| 1 | App root grid (sidebar + main) | — | 17, 19–73, 75–2970 | — |
| 2 | Sidebar: brand, page search (⌘K), fixed entries, collapsible sections, "View as" role menu | `navQ`, `navHits`, `navFixed`, `navSections`, `roleMenuOpen` | 19–73 | 3786, 5101–5103, 5139–5173 |
| 3 | Top bar: breadcrumb, project switcher, title, global search, notifications, status date, FR/EN, Export, primary action | `crumb`, `showProjectPicker`, `projMenuOpen`, `searchOpen`, `notifOpen`, `langSeg`, `hasPrimary` | 76–125 | 4157–4173, 4692–4708, 5109, 5137, 5162–5163, 5174–5177 |
| 4 | "Outside my workspace" banner | `outside` | 126–128 | 5153–5154, 5176 |
| 5 | Zone bar (portfolio zone filter) | `zoneBar` | 130–136 | 3791, 3902, 4995, 5211 |
| 6 | Generic add-form dialog | `afOpenDlg`, `afForm` | 138–158 | 3674–3701 (`AF`, `AF_RESULT`), 5111–5136 |
| 7 | Toast | `hasToast` | 159–161 | 5116, 5177 |
| 8 | New project wizard (4 steps) | `npOpen`, `np` | 2972–3056 | 3179–3185 (`NP_TEMPLATES`), 3946–3969 |
| 9 | Force stage change dialog | `showForce`, `force` | 3058–3069 | 3917–3923, 3938, 3942 |
| 10 | New resource request dialog | `nrOpen`, `nr` | 3071–3092 | 3268–3283, 4146–4156 |
| 11 | i18n layer (FR/EN) | `lang`, `T.kN` | all | 3751–3759, 3775–3776 |
| 12 | Complete screen inventory (59 screen ids) | `is<Screen>` | 163–2969 | 5172–5240 |

---

## 1. Runtime model and how to read the prototype

### 1.1 x-dc → React mapping

The prototype is a single React class (`class Component extends DCLogic`, line 3763) rendered by the x-dc runtime (`support.js`). For the rebuild:

| x-dc construct | Meaning | React equivalent |
|---|---|---|
| `{{ expr }}` | binding to a key of the object returned by `renderVals()` | prop / derived value |
| `<sc-if value="{{ x }}">` | conditional block | `{x && …}` |
| `<sc-for list="{{ xs }}" as="n">` | loop | `xs.map(n => …)` |
| `style-hover="…"` | `:hover` pseudo-class style (runtime turns `style-*` attrs into pseudo-class rules) | CSS `:hover` |
| `onClick="{{ fn }}"`, `onChange`, `onKeyDown`, `onFocus` | React events (inputs are controlled: `value` + `onChange` fires on every keystroke) | same |
| `ref="{{ r }}"` | React ref | same |
| `hint-placeholder-val` / `hint-placeholder-count` | design-time streaming placeholders only | ignore |
| `<helmet>` (lines 10–15) | head injection: Nocturne `styles.css`, `_ds_bundle.js`, Phosphor icons `https://unpkg.com/@phosphor-icons/web@2.1.1`, `image-slot.js`, base `<style>` | app `index.html` / global CSS |

Base global CSS (line 14): `body{margin:0;background:var(--color-bg)}`, `*{scrollbar-color:var(--color-neutral-700) transparent;scrollbar-width:thin}`, `a{color:var(--color-accent)}`, `a:hover{color:var(--color-accent-400)}`.

Render pipeline: `renderVals()` (line 3776) calls `renderValsEN()` (line 3777 → 5239), which computes every binding in English; if `state.lang==='fr'` the whole result is passed through `deepTr()`; then `T` (static template strings, `T.k0…T.k1058`) is attached. See §13.

### 1.2 Component props (`data-props`, line 3095)

| Prop | Editor | Options | Default | Used by |
|---|---|---|---|---|
| `currency` | enum | `'EUR'` \| `'USD'` | `'EUR'` | `money()` only (line 3775) — symbol `€` / `$` and FR formatting |
| `showBaseline` | boolean (section "Schedule") | — | `true` | `showBaseline` binding (Schedule Gantt baseline bars, lines 521/531) |
| `startScreen` | enum | `home, myprojects, worldmap, overview, projects, plan, schedule, budget, trends, risks, changes, site, quality, presources, procurement, orders, deliveries, stock, resources, rates, skills, leave, whatif, requests, approvals, pid, bom, plm, eco, drawings, settings, mywork, myapprovals, task` (34 ids) | `'home'` | initial screen when `state.screen` is `null` |

### 1.3 Screen routing and current project (no URL routing)

- Current screen: `const screen = this.state.screen || this.props.startScreen || 'home'` (line 3778). `state.screen` starts `null`.
- Navigation helper: `go = s => () => this.setState({screen:s})` (line 3779). Every nav item, notification, search hit and cross-link writes `screen` (often with extra state such as `project`, `sel`, `cr`, `ncr`, `po`…).
- Current project: `state.project` (default `'HLT-026'`, line 3774). `proj = state.projects.find(p=>p.code===project) || state.projects[0]` (line 3782). Project data for project-scoped screens comes from `projectData(project, proj)` (line 3310; `HLT_PD` for HLT-026, generated for other `DEFS` codes).
- Project switching: project switcher (§6.2), global search "Project" hits, map iframe message, many in-screen links (`setState({screen:'plan', project:code})`).
- Role switching sets `{role:k, roleMenu:false, screen:'home'}` (line 5102); `project` is NOT reset.
- Map iframe (`Keystone PM map.html`, line 110) posts `{type:'keystone-map', action:'open', code}`; `componentDidMount` (line 3765) listens on `window` `message`: if `DEFS[code]` → `{screen:'plan', project:code, projMenu:false}`, else → `{screen:'projects', q:code, statusFilter:null}`.
- `componentDidMount` also sets `window.__ks = this` (debug handle) and registers the global ⌘K / Ctrl+K handler (§4.2). Both listeners are removed in `componentWillUnmount` (line 3766).
- Persistence: only `state.navOpen` is persisted (localStorage key `keystone-nav-open`). Everything else (role, language, project, created records) is in-memory and reset on reload.

Implementation note (suggestion, non-normative): a router such as `/:screenId` for global screens and `/projects/:code/:screenId` for project-scoped screens (the `showProjectPicker` list, §6.2) maps 1:1 to the prototype's `screen` + `project` pair.

### 1.4 Shell state keys (initial values, line 3767–3774)

| Key | Initial | Purpose |
|---|---|---|
| `screen` | `null` | current screen id (see §1.3) |
| `project` | `'HLT-026'` | current project code |
| `role` | `'director'` | current persona key (`PERSONAS`) |
| `roleMenu` | `false` | "View as" popover open (binding `roleMenuOpen`) |
| `lang` | `'fr'` | UI language — **the app opens in French** |
| `navQ` | `''` | sidebar page-search query |
| `navOpen` | `JSON.parse(localStorage['keystone-nav-open'])` or `null` | per-section / per-group collapse map |
| `projMenu` | `false` | project switcher dropdown open (binding `projMenuOpen`) |
| `projScope` | `'mine'` | switcher scope `'mine'`/`'all'` (only when scope is available) |
| `projQ` | `''` | switcher search text |
| `search` | `''` | global search text (binding `searchQ`) |
| `searchOpen` | `false` | global search dropdown requested |
| `notifOpen` | `false` | notifications panel open |
| `readNotifs` | `{}` | `{[notifId]: true}` read overrides |
| `pfZone` | `undefined` → `null` | portfolio zone filter (`'euna'`/`'afr'`/`'apac'`/null) |
| `af` | `{open:false, key:null, values:{}}` | generic add-form dialog |
| `toast` | `''` | toast text |
| `added` | `{risks:[], crs:[], ncrs:[], meetings:[], stakeholders:[], itp:[], punch:[], interfaces:[], draws:[], fleet:[], claims:[], lessons:[], milestones:[], amendments:[], bonds:[], wps:[], acts:[], mtypes:[]}` | records created through the add-form dialog (session only) |
| `np` | `{open:false, step:1, name:'', client:'', das:'2', mt:'EMP', cur:'EUR', template:'EMP', cats:<EMP template cats>, cont:5, cal:'Standard 5d · 8h'}` | New project wizard |
| `force`, `forceReason` | `null`, `''` | Force stage change dialog |
| `nr` | `{open:false, title:'', act:'A1250', person:'Julien Wagner', hours:'8', week:5, dur:4, prio:'med', note:''}` | New resource request dialog |
| `projects` | `initialProjects()` (17 projects) | portfolio project list (mutated by wizard and stage changes) |
| `requests` | `REQUESTS` copy (10) | resource requests (NR dialog prepends) |
| `stageDone`, `stageHist` | deep copies of `STAGE_DONE_DEFAULT`, `STAGE_HISTORY` | lifecycle deliverable checklists and history |
| `person`, `task` | `'Hélène Sauvage'`, `'T-2314'` | "My work" context (also drives the My tasks badge) |

---

## 2. Visual shell layout

### 2.1 Root grid (line 17)

- `display:grid; grid-template-columns: 232px minmax(0,1fr); min-height:100vh`.
- Background: `radial-gradient(1200px 600px at 70% -10%, var(--color-accent-900), transparent 60%), var(--color-bg)`; `color: var(--color-text)`; `font-family: var(--font-body)` (Inter).
- No media queries anywhere in the shell: the sidebar is always 232 px; the header wraps (`flex-wrap:wrap`); popovers use `min(…, 90vw)` widths. See Open questions for mobile.

### 2.2 Sidebar container (line 19)

`<aside>`: `display:flex; flex-direction:column; gap:14px; padding:18px 14px; position:sticky; top:0; height:100vh; overflow:auto; border-right:1px solid var(--color-neutral-900); background: color-mix(in srgb, var(--color-bg) 70%, transparent)`.

### 2.3 Main container (line 75)

`<main>`: `display:flex; flex-direction:column; gap:18px; padding:20px 28px 40px; min-width:0`. Children in order: header (76–125), outside banner (126–128), zone bar (130–136), add-form dialog (138–158, fixed overlay), toast (159–161, fixed), then exactly one screen block (163–2969). The three wizard/dialog overlays (np/force/nr) are siblings of `<main>` (2972–3092).

### 2.4 Nocturne tokens used by the shell

`--color-bg #161826`, `--color-surface #232532`, `--color-text #e9e9ed`, `--color-accent #9184d9`, `--color-divider` (text 16 %), ramps `--color-neutral-100…900`, `--color-accent-100…900`; `--radius-md 8px`, `--radius-lg 14px`; `--shadow-md`, `--shadow-lg`. Classes: `.btn` (+`.btn-primary` accent outline, `.btn-secondary` divider outline, `.btn-ghost` accent text, `.btn-icon` 36×36), `.input` (min-height 36, surface fill, divider border), `.field > label` (12 px, text 70 %), `.seg`/`.seg-opt`, `.tag` (+`-accent` accent-800/accent-100, `-neutral` neutral-800/neutral-100, `-outline` 1 px accent), `.card`, `.elev-sm/md/lg`, `.dialog-backdrop` (fixed, grid, neutral-900 50 %), `.dialog` (surface, radius-lg, shadow-lg), `.dialog-title` (20 px, 500), `.dialog-actions` (flex end, gap 5.6 px). Disabled buttons: opacity .45. Focus: 2 px accent `:focus-visible` outline.

Segmented control as used everywhere in the shell (inline, not the DS `:has(input)` variant): container `.seg` with `display:flex`; each option a `<button class="seg-opt">` with `border:0; background:transparent; font-size:12px; padding:4px 10px; gap:6px; white-space:nowrap`, and from the `seg()` helper (line 3889): selected → `color:var(--color-accent)` + `box-shadow: inset 0 0 0 1px var(--color-accent)`; unselected → `color:var(--color-neutral-300)`, no shadow; options after the first get `border-left:1px solid var(--color-divider)`.

Badge pill (used in nav): `font-size:11px; padding:1px 7px; border-radius:9px; background:var(--color-accent-800); color:var(--color-accent-100); flex:none`.

---

## 3. Personas and roles

### 3.1 `PERSONAS` (line 3747)

| Key | Name | Role label (EN) | Role label (FR) | Initials |
|---|---|---|---|---|
| `director` | Marie Lefebvre | Portfolio director | Directrice de portefeuille | ML |
| `pm` | Romain Aubert | Project manager | Chef de projet | RA |
| `depthead` | Marion Kerviel | Head of engineering | Responsable ingénierie | MK |
| `member` | Julien Wagner | Structural engineer | Ingénieur structure | JW |
| `englead` | Antoine Girard | Engineering lead | Référent ingénierie | AG |
| `quality` | Gabriel Comte | Quality manager | Responsable qualité | GC |
| `procurement` | Fabien Bertrand | Procurement & stock | Achats et stock | FB |
| `client` | Nadia Bensaïd | Client — Port authority | Client — Autorité portuaire | NB |

Initials = first letter of each word of the name (`name.split(' ').map(s=>s[0]).join('')`).

### 3.2 `ROLE_SCREENS` (lines 3465–3466)

`director: null` means "everything". Other roles get a base list plus pushed extras (line 3466): `eng, eng-process, eng-meca, eng-elec, eng-auto` for pm/englead/quality; per-role extras; then every role gets `docs`, every non-client role gets `myprojects`, and `pm`/`quality` get `doctypes`. Final lists (computed):

| Role | Count | Allowed screen ids |
|---|---|---|
| director | all | (null = no gating) |
| pm | 53 | home, myapprovals, plumbing, portfolio, cash, pfplan, worldmap, trends, risks, changes, quality, procurement, overview, projects, plan, schedule, budget, presources, orders, deliveries, stock, requests, whatif, rates, skills, leave, bom, eco, plm, drawings, settings, mtypes, eng, eng-process, eng-meca, eng-elec, eng-auto, site, meetings, contract, billing, stakeholders, itp, interfaces, contingency, commissioning, rex, hours, fleet, sav, docs, myprojects, doctypes |
| depthead | 16 | home, myapprovals, site, overview, worldmap, resources, approvals, skills, leave, whatif, requests, settings, meetings, hours, docs, myprojects |
| member | 9 | home, site, mywork, task, skills, leave, meetings, docs, myprojects |
| englead | 26 | home, myapprovals, quality, pid, plan, bom, plm, eco, drawings, skills, requests, settings, mtypes, eng, eng-process, eng-meca, eng-elec, eng-auto, leave, meetings, interfaces, itp, commissioning, rex, docs, myprojects |
| quality | 30 | home, myapprovals, risks, quality, pid, plan, eco, plm, drawings, bom, approvals, deliveries, stock, settings, mtypes, eng, eng-process, eng-meca, eng-elec, eng-auto, leave, meetings, itp, commissioning, rex, sav, fleet, docs, myprojects, doctypes |
| procurement | 18 | home, myapprovals, procurement, orders, deliveries, stock, bom, plm, eco, resources, settings, leave, meetings, contract, sav, fleet, docs, myprojects |
| client | 10 | home, myapprovals, client, trends, changes, quality, meetings, itp, commissioning, docs |

Note: `pm` has no `resources`, `approvals`, `mywork`, `task`, `client`; `task` is treated as `mywork` for gating (`screenNavId = screen==='task' ? 'mywork' : screen`, line 5153).

### 3.3 Gating semantics (lines 5138–5156)

- `allowed = ROLE_SCREENS[role]`; `gate(list)` keeps nav items whose `id` is in `allowed` (or everything if `allowed` is null). Gating only hides navigation entries; screens stay reachable by other routes (notification, search hit, cross-link, startScreen).
- `outside = !!allowed && !allowed.includes(screenNavId)`. When true:
  - the "Outside my workspace" banner shows (§7.1);
  - a synthetic sidebar section `outside` is prepended (§4.6);
  - the header primary action is hidden (`hasPrimary` requires `!outside`);
  - some screens also use `outside` to disable editing (`planCanEdit: !planRO && !outside`, `ctrCanEdit: !projReadOnly && !outside`).
- Read-only project mode (`projReadOnly`, §6.2) is a separate mechanism for pm/client looking at a project that is not theirs.
- Other role checks visible from the shell: `home` primary "New project" only for `director`/`pm`; `planRO = role==='client'`; `canSeeRates = ['director','pm']`; `canSeeMargin = ['director','pm']`; `mtCanEdit` for director/pm/englead/quality (screen modules own these details).

---

## 4. Sidebar (lines 19–73)

### 4.1 Brand (lines 20–24)

Row `display:flex; align-items:center; gap:10px; padding:0 6px`:
- Logo tile 26×26, `border-radius:7px`, `border:1px solid var(--color-accent)`, centred Phosphor `ph ph-polygon` 15 px in accent, glow `box-shadow:0 0 14px color-mix(in srgb, var(--color-accent) 40%, transparent)`.
- Word mark "Keystone" (T.k0), 16 px, weight 500, `letter-spacing:-0.01em`. No click handler.

### 4.2 Page search / quick jump (lines 25–37; logic 5167–5173)

- Wrapper `position:relative`. Left icon `ph ph-magnifying-glass` (absolute left 9 / top 9, 13 px, neutral-500, `pointer-events:none`). Input `.input`, `padding-left:28px; padding-right:38px; min-height:32px; font-size:12.5px; width:100%`, placeholder "Go to a page…" (FR "Aller à une page…"). Right hint chip "⌘K" (absolute right 8 / top 8, 10 px, padding 1px 5px, radius 4, border neutral-800, neutral-500).
- Bindings: `ref=navQRef` (React ref, line 3764), `value=navQ`, `onChange=setNavQ` (`{navQ:e.target.value}`), `onKeyDown=navQKey`:
  - `Escape` → `navQ:''`;
  - `Enter` with at least one hit → `{screen: navHits[0].id, navQ:''}`.
- Global shortcut (componentDidMount): `(metaKey||ctrlKey) && key in ['k','K']` → `preventDefault()`, focus and select the input.
- States: `navSearching = !!navQ.trim()` shows the hit list (30–37) and hides normal browsing (`navBrowsing`, 38–57).
- Hits: `navAll` = fixed entries (section `''`) + every gated section item, each with its section label (items `eng*`, `pid`, `bom` of the Project section get section "Project engineering"; FR via `FR_DICT`). Filter: case-insensitive substring of the FR label (`FR_DICT[label]` when lang=fr) OR of the EN label. Max 8 hits. Click → `{screen:n.id, navQ:''}`.
- Hit row (line 33): button `display:flex; gap:10px; padding:6px 8px; border-radius:md; font-size:13px`, background/colour = the item's active colours, hover neutral-900; icon 16 px; two-line text (label with ellipsis; section 10.5 px neutral-500); badge pill if any.
- Empty: "No page matches" (FR "Aucune page ne correspond"), 12 px neutral-500, padding 6px 8px.
- Only gated (accessible) pages are searchable.

### 4.3 Fixed entries (`navFixed`, lines 39–43; logic 5143–5159)

`navFixed = [...gated.navHome, ...gated.navWork, ...gated.navDocs]`, rendered as buttons `padding:7px 8px; gap:10px; font-size:13px; border-radius:md`, icon 16 px, label ellipsis, badge pill. Active item: `bg var(--color-accent-900)`, `color var(--color-accent-300)`; inactive: transparent / neutral-300; hover bg neutral-900 (`nav()` helper, line 3786).

| id | Label EN / FR | Icon | Badge rule | Visible for |
|---|---|---|---|---|
| `home` | Home / Accueil | `ph ph-house` | — | all |
| `myprojects` | My projects / Mes projets | `ph ph-folder-user` | — | all except client |
| `client` | My project / Mon projet | `ph ph-buildings` | — | client only (replaces My projects in `navHome` when `role==='client'`) |
| `mywork` | My tasks / Mes tâches | `ph ph-check-square` | `dueToday` = open todos of `state.person` with `due===TODAY` (initial 2) | director, member; also highlighted active when `screen==='task'` |
| `myapprovals` | My approvals / Mes approbations | `ph ph-stamp` | `apprItems.length` (role-dependent unified inbox; initial: director 5, pm 3, depthead 2, quality 1, procurement 5, client 3, englead none) | all except member |
| `docs` | Documents · Codex | `ph ph-books` | count of vault documents with status "Release proposed" (initial 1) | all |

### 4.4 Collapsible sections and groups (`navSections`, lines 44–56; logic 5159–5166)

Section definitions (`buildSecs`, line 5160), in display order:

| Key | Label EN / FR | Items (id · label EN / FR · icon · badge rule) | `sub` line |
|---|---|---|---|
| `portfolio` | Portfolio / Portefeuille | `overview` · Overview / Vue d’ensemble · `ph-squares-four`; `projects` · Projects / Projets · `ph-folders`; `pfplan` · Schedule / Planning · `ph-chart-bar-horizontal`; `worldmap` · Projects map / Mappemonde des projets · `ph-globe-hemisphere-west`; `portfolio` · Prioritisation / Priorisation · `ph-strategy`; `cash` · Cash flow / Trésorerie · `ph-coins` | zone name when a zone is selected |
| `project` | Project / Projet | grouped, see below | `pname(proj.code, proj.name)`, e.g. "#026 · Harbor Line Terminal Expansion" (FR: "#026 · Extension du terminal Harbor Line") |
| `tech` | Technical reference / Référentiel technique | `plm` · Parts (PLM) / Articles (PLM) · `ph-database`; `eco` · Change orders (ECO) / Ordres de modification (ECO) · `ph-git-branch` · badge = ECOs "In approval"; `drawings` · Drawings / Plans · `ph-blueprint` | — |
| `stock` | Purchasing & stock / Achats & stock | `procurement` · Sourcing & invoices / Consultations et factures · `ph-handshake` · badge = invoices with status Blocked or No PO; `orders` · Purchase orders / Commandes d’achat · `ph-shopping-cart` · badge = POs "Awaiting approval"; `deliveries` · Deliveries / Livraisons · `ph-truck` · badge = deliveries "QC pending"; `stock` · Stock & storages / Stock et magasins · `ph-warehouse` · badge = stock rows with `min && onHand<min` | — |
| `sav` | Warranty & after-sales / Garantie & SAV | `fleet` · Installed base / Parc installé · `ph-crane-tower`; `sav` · Warranty claims & interventions / Réclamations & interventions · `ph-wrench` · badge = open claims (status ≠ Closed) with severity Major or Critical | zone name when a zone is selected |
| `res` | Resources / Ressources | `resources` · Resources / Ressources · `ph-users-three`; `requests` · Resource requests / Demandes de ressources · `ph-paper-plane-tilt` · badge = PM R. Aubert's requests with status `reschedule`; `approvals` · Approvals / Approbations · `ph-seal-check` · badge = pending requests of the selected department (`dPending`); `whatif` · What-if levelling / Lissage what-if · `ph-scales`; `skills` · Skills matrix / Matrice de compétences · `ph-certificate`; `leave` · Leave & calendar / Congés et calendrier · `ph-calendar-check`; `rates` · Rate cards / Grilles de taux · `ph-currency-eur` | — |
| `admin` | Administration | `settings` · Settings / Paramètres · `ph-gear-six`; `mtypes` · Machine types / Types de machines · `ph-cube`; `doctypes` · Document types register (Codex) / Registre des types de documents (Codex) · `ph-list-checks`; `plumbing` · Activity & integrations / Activité et intégrations · `ph-plugs-connected` · badge `'!'` if any `CONNECTORS` row has status "Warning" | — |

Project section groups (built with `grp(label, ids)`; first item of each group carries `groupLabel`):

| Group (EN / FR) | Items (id · label EN / FR · icon · badge rule) |
|---|---|
| Contract / Contrat | `contract` · Contract / Contrat · `ph-file-text`; `billing` · Billing / Facturation · `ph-receipt` · badge = late payment milestones (`ctrBadge`) |
| Steering / Pilotage | `plan` · Plan — WBS · `ph-tree-structure`; `schedule` · Schedule / Planning · `ph-calendar-dots`; `budget` · Budget & cost / Budget et coûts · `ph-chart-line-up`; `hours` · Hours (Lucca) / Heures (Lucca) · `ph-clock-countdown`; `contingency` · Contingency / Provision pour aléas · `ph-piggy-bank`; `presources` · Project resources / Ressources du projet · `ph-user-list` |
| Team & exchanges / Équipe & échanges | `meetings` · Meetings & minutes / Réunions & CR · `ph-chats-circle` · badge = meetings with status "Notes in progress" (`mtgBadge`); `stakeholders` · Stakeholders & RACI / Parties prenantes & RACI · `ph-users-four`; `interfaces` · Interfaces · `ph-arrows-left-right` · badge = interfaces with status "Late" (`ifcBadge`) |
| Project engineering / Ingénierie projet | `eng` · Synthesis / Synthèse · `ph-squares-four` · badge = blocking engineering checks (HLT-026 only); `eng-process` · Process · `ph-flow-arrow`; `eng-meca` · Mechanical / Mécanique · `ph-gear`; `eng-elec` · Electrical / Électricité · `ph-lightning`; `eng-auto` · Automation / Automatisme · `ph-cpu` (each discipline: open blocking checks of that discipline, HLT-026 only); `pid` · P&ID validation / Validation P&ID · `ph-flow-arrow` · badge = unlinked P&ID tags when coverage < 100 % (HLT-026 only); `bom` · Project BOM / Nomenclature projet · `ph-cube` |
| Control / Maîtrise | `risks` · Risk register / Registre des risques · `ph-shield-warning` · badge = open risks with score ≥ 15; `changes` · Change control / Contrôle des modifications · `ph-git-pull-request` · badge = CRs "In review"; `quality` · Quality & deliverables / Qualité et livrables · `ph-seal-check` · badge = open NCRs with severity Critical; `itp` · Inspections & punch list / Inspections & réserves · `ph-clipboard-text` · badge = open punch items of category A |
| Site & handover / Chantier & transfert | `site` · Site (chantier) / Chantier · `ph-hard-hat` · badge `'NO GO'` when project is HLT-026 and the mobilisation GO checklist is not all OK; `commissioning` · Commissioning & handover / Mise en service & transfert · `ph-key` |
| Project review / Bilan | `trends` · Trends & status / Tendances et état · `ph-chart-line`; `rex` · Lessons learned & closure / REX & clôture · `ph-graduation-cap` |

Initial badge values (director, project HLT-026): meetings 1, interfaces 1, eng 4, eng-elec 2, eng-auto 2, pid 9, risks 1, changes 1, quality 1, site "NO GO", eco 1, procurement 3, orders 1, deliveries 1, stock 1, sav 2, requests 1, approvals 2, plumbing "!".

Rendering (per section, lines 46–54):
- Section header button: `display:flex; gap:8px; padding:6px 8px; border-radius:md; font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase`, colour `sec.color` (neutral-300 if the section is open or contains the active screen, else neutral-500), hover bg neutral-900. Chevron `ph ph-caret-down` (open) / `ph ph-caret-right` (closed), 11 px. Then label (ellipsis), then either a badge pill (10.5 px, `padding:0 6px`) or a count (10.5 px neutral-600).
  - Header badge (only when closed): `'!'` if any item has a non-numeric badge, else the sum of numeric badges; empty if none.
  - Header count (only when closed and no badge): number of items in the section.
- `sub` line (line 47): `font-size:11.5px; color:neutral-300; padding:0 8px 4px 27px; ellipsis`, tooltip "Current project" (FR "Projet courant") — the tooltip is the same even when the sub is a zone name.
- Group header (first item of a group, line 49): button `padding:7px 8px 4px 10px; font-size:10px; letter-spacing:.08em; uppercase; width:100%`, caret 10 px (`ph-caret-down`/`ph-caret-right`), label, then a 1 px fading rule `flex:1; background: linear-gradient(90deg, var(--color-neutral-800), transparent)`, then group badge or count (same rules as the section header but over the group's items; shown only when the group is closed). Colour neutral-300 if the group is open or contains the active screen, else neutral-500; hover colour neutral-200. Click stops propagation and toggles the group.
- Item button (line 51): `padding:6px 8px 6px 10px`, otherwise identical to fixed entries. Rendered only if `visible`.

### 4.5 Open/closed logic and persistence (line 5166)

- Section open state: `navOpen[key]` if defined, else default **open only for `project`**.
- Group open state: `navOpen['sub:'+groupLabel]` if defined, else default **open only for "Steering"**.
- Closed section → shows only the active item (if it belongs to the section).
- Closed group → its items are hidden except the active one (`visible = groupOpen || isActive`). The group header itself only appears on the group's first item, so if a closed section/group contains the active item that is not the first of its group, the item shows without its group header.
- `isActiveNav(n) = n.id===screen || (screen==='task' && n.id==='mywork')`.
- Toggling a section or group writes the new map to `state.navOpen` and to `localStorage['keystone-nav-open']` (wrapped in try/catch).
- Sections with zero gated items are not rendered.

### 4.6 "Outside my workspace" section (line 5167)

When `outside`, a section `{key:'outside', label:'Outside my workspace', open:true, chev:'ph ph-eye', color:'var(--color-accent-300)'}` is prepended, holding a single item: the nav item of the current screen (or a synthetic one with `titles[screen]` and icon `ph ph-eye`), forced active colours, no badge, no group. FR label: "Hors de mon périmètre". Its toggle does nothing.

### 4.7 "View as" role switcher (lines 58–72)

- Container at the bottom (`margin-top:auto; position:relative`).
- Trigger button (line 67): full width, `padding:8px; gap:10px; border-radius:md; background:var(--color-surface)`, hover neutral-900. Avatar 28×28 circle `background:accent-800; color:accent-200; font-size:11px` with `viewer.initials`; name 13 px (ellipsis); role 11 px neutral-400; trailing `ph ph-caret-up-down` neutral-500. Click → `toggleRoleMenu` (`roleMenu = !roleMenu`).
- Popover (when `roleMenuOpen`): `.elev-md`, absolute, `z-index:40; bottom:calc(100% + 6px); left:0; right:0; padding:6px; border-radius:md; background:surface`. Header "View as" (FR "Voir en tant que"), 10 px uppercase neutral-500, padding 4px 8px 6px. One row per persona (8): button `gap:9px; padding:6px 8px; border-radius:6px; font-size:12.5px`, avatar 24×24 neutral-800/neutral-200 10 px, name + role (11 px neutral-400); current role row bg accent-900; hover neutral-900.
- Selecting a persona: `{role:k, roleMenu:false, screen:'home'}`.
- No click-outside handler: the popover closes only via the trigger or by choosing a persona.

---

## 5. Top bar (header, lines 76–125)

Header: `display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap`. Left block (`margin-right:auto`, column gap 4): breadcrumb row + title row. Then, right-aligned: global search, notifications, status date, language toggle, Export + primary action.

### 5.1 Breadcrumb (`crumb`, line 78; logic `crumbOf`, 5163)

Row `font-size:12px; color:neutral-400; display:flex; gap:8px; align-items:center; flex-wrap:wrap`.

Base: the label of the (ungated, `secDefsRaw`) section containing the current screen, plus `' · ' + groupLabel` when grouped; for screens not in a section: `home`/`myprojects` → "Keystone"; `mywork` (and `task`)/`myapprovals` → "My work"; `docs` → "Documents"; anything else → "Keystone". Then `' · ' + CRUMB_EXTRA[screen]` when defined:

| Screen | Extra (EN) | Example full crumb EN / FR |
|---|---|---|
| fleet, sav | zone name if a zone is selected | Warranty & after-sales / Garantie & SAV |
| contract | contract reference `CT.ref` | Project · Contract · CTR-HLT-001 / Projet · Contrat · CTR-HLT-001 |
| billing | contract payment terms `CT.terms` | Project · Contract · Net 45 days / Projet · Contrat · Net 45 jours |
| worldmap | `<n> projects located` + zone | Portfolio · 17 projects located / Portefeuille · 17 projets localisés |
| myprojects | persona role | Keystone · Portfolio director / Keystone · Directrice de portefeuille |
| stock | Sage X3 + local | Purchasing & stock · Sage X3 + local |
| leave | Lucca | Resources · Lucca |
| drawings | SolidWorks PDM | Technical reference · SolidWorks PDM |
| plumbing, procurement, resources, plm, eco | all projects | e.g. Resources · all projects / Ressources · tous les projets |
| requests | R. Aubert, project manager | Resources · R. Aubert, project manager / … chef de projet |
| approvals | `<head name> · <head role>` of selected department | Resources · Marion Kerviel · Head of engineering |
| mywork | `state.person` | My work · Hélène Sauvage / Mon travail · Hélène Sauvage |
| task | task id | My work · T-2314 |
| projects | `FY2026 · <n> projects` + zone | Portfolio · FY2026 · 17 projects / Portefeuille · Exercice 2026 · 17 projets |
| overview, portfolio, pfplan, cash | `FY2026` + zone | Portfolio · FY2026 / Portefeuille · exercice 2026 |
| client | read-only except decisions and issues | Keystone · read-only except decisions and issues / Keystone · consultation sauf décisions et problèmes |
| doctypes | one circuit and one retention rule per type | Administration · … |
| mtypes | one template per product range · planning, costs, ITP, REX | Administration · … |
| myapprovals | one queue for every decision assigned to me | My work · … |
| docs | numbered, tagged, versioned | Documents · numbered, tagged, versioned |
| trends | weekly snapshots | Project · Project review · weekly snapshots |
| quality | ISO 9001 | Project · Control · ISO 9001 |
| risks | 5×5 + EMV | Project · Control · 5×5 + EMV |
| site | international site | Project · Site & handover · international site |

Zone suffix (`zoneCrumb`) = `' · ' + zone label` when `pfZone` is set.

### 5.2 Project switcher (lines 79–95; logic 4157–4173, 5175)

Shown when `showProjectPicker`, i.e. `screen` ∈ { budget, schedule, plan, presources, orders, deliveries, bom, trends, risks, changes, quality, client, site, pid, docs, meetings, contract, billing, stakeholders, itp, interfaces, contingency, commissioning, rex, hours, eng, eng-process, eng-meca, eng-elec, eng-auto } (project-scoped screens).

- Separator "/" (neutral-600), then trigger button: `inline-flex; gap:6px; padding:3px 9px; border-radius:6px; border:1px solid neutral-800; background:surface; font-size:12.5px`, hover border neutral-600; icons `ph ph-folder-open` (accent) and `ph ph-caret-down` (neutral-500); text `projectName` = `pname(code,name)` = `"<PROJ_ID.id or code> · <name>"`, e.g. "#026 · Harbor Line Terminal Expansion". Click → `projMenu = !projMenu`.
- Dropdown (`projMenuOpen`): `.elev-md`, absolute `z-index:30; top:calc(100% + 4px); left:0; min-width:460px; max-width:min(560px,90vw); padding:6px; border-radius:md; background:surface`.
  - Header "Switch project" (FR "Changer de projet"), 10 px uppercase neutral-500.
  - Scope segmented control (only if `projScopeAvail`): "My projects" `<mineCount>` | "Whole portfolio" `<pool.length>` (FR "Mes projets" / "Tout le portefeuille"), options `flex:1`, counts 11 px tabular neutral-400. Click → `{projScope:v, projQ:''}`.
  - Search input: magnifier icon, placeholder "Search a project number or name…" (FR "Rechercher un n° ou un nom de projet…"), `min-height:32px; font-size:12.5px`; `onChange=setProjQ`, `onClick=stopClick` (stopPropagation).
  - Option rows (grid `minmax(0,1fr) auto`, gap 10, padding 6px 8px, radius 6, 13 px; hover neutral-900; current project bg accent-900): name (ellipsis) + sub line 11 px neutral-400 `"<ana> · DAS <das> · <mt> · <pm>"` (e.g. "HAV004 · DAS 2 · EMP · R. Aubert"); right side: `ph ph-eye` (neutral-500, tooltip "Read-only") when `readOnly`, then health tag.
  - Empty: "No project in this scope · search the whole portfolio" (FR "Aucun projet dans ce périmètre · recherchez dans tout le portefeuille").
  - Select → `{project:p.code, projMenu:false, part:null, bomType:null, projQ:''}`.
  - No click-outside overlay: closes via trigger or selection (or map message).
- Pool: only projects that have project data, `allP.filter(p=>DEFS[p.code])` → 6 projects: HLT-026, NDC-031, RCF-019, ERP-202, WSA-044, MSR-012.
- Ownership `isMineP(p)`: director → all; client → `p.client==='Port authority'`; others → `p.pm === "<first initial>. <last name>"` of the persona (e.g. "R. Aubert").
- `scopeAvail = role!=='director' && 0 < mineCount < pool.length` → in practice only `pm` (1 of 6: HLT-026) and `client` (1 of 6: HLT-026). Otherwise scope is forced to `'all'` and nothing is read-only.
- Filtering: with search text → match against `code + name + PROJ_ID.id + PROJ_ID.ana + pm + client` (case-insensitive) across the whole pool regardless of scope; without text → scope filter.
- `projReadOnly = scopeAvail && !isMineP(proj)`; option `readOnly = !isMineP(p) && scopeAvail`.

Health (`healthOf`, line 3916): `null` if `!actual || !progress`; else `m = min(budget*progress/actual, spi||1)`; `m < .90` → "Off track" (FR "Hors trajectoire", `tag tag-accent`); `m < .97` → "At risk" (FR "À risque", `tag tag-outline`); else "On track" (FR "Conforme", `tag tag-neutral`); null → "—". Initial values: HLT-026 At risk, NDC-031 On track, RCF-019 Off track, ERP-202 On track, WSA-044 On track, MSR-012 At risk.

### 5.3 Title row (line 97)

`display:flex; align-items:center; gap:10px`: `<h2>` `margin:0; font-size:26px` with `title = titles[screen]` (map at line 5109; full list in §15), then — when `showProjectPicker` — the project health tag (`projectHealthClass`), then — when `projReadOnly` — `tag tag-outline` with `ph ph-eye` + "Read-only" (FR "Consultation").

### 5.4 Global search (lines 99–107; logic 4693–4705, 5192)

- Wrapper `position:relative; min-width:220px; flex:1 1 220px; max-width:360px`; magnifier at left 10 / top 9; input `padding-left:30px; min-height:32px; font-size:12.5px`, placeholder "Search projects, activities, parts, orders, people…" (FR "Rechercher projets, activités, articles, commandes, personnes…").
- `onChange` → `{search: value, searchOpen:true}`; `onFocus` → `{searchOpen:true}`.
- Dropdown visible only if `searchOpen && query.trim().length >= 2`: full-screen transparent click-catcher `position:fixed; inset:0; z-index:48` (click → `{searchOpen:false, search:''}`), panel `.elev-md` absolute `z-index:49; top:calc(100% + 4px); right:0; width:min(480px, calc(100vw - 48px)); padding:6px; max-height:60vh; overflow:auto`.
- Hit row: grid `110px minmax(0,1fr)`, gap 10, padding 7px 8px, radius 6, 12.5 px, hover neutral-900; left: kind as `tag tag-neutral`; right: title + sub (11 px neutral-400), both ellipsis.
- Empty: "No match — try a reference, a name or a supplier" (FR "Aucun résultat — essayez une référence, un nom ou un fournisseur").
- Click on a hit → `{screen, search:'', searchOpen:false, ...extra}`.

| Kind EN / FR | Source | Match on | Max | Title / sub | Target |
|---|---|---|---|---|---|
| Project / Projet | `state.projects` (all 17) | name + code | 4 | name / `code · status · pm` | `plan`, `project` = code if it has data (`DEFS`), else unchanged |
| Activity / Activité | `ALL_BYID` (activities of all projects with data) | id + name | 4 | `id · name` / `start → finish` | `plan` + `{sel:id, selOpen:true}` |
| Part / Article | `PARTS` | ref + name + manufacturer | 4 | `ref · name` / `mfr · status` | `plm` + `{part:ref}` |
| Person / Personne | `PEOPLE` | name | 3 | name / role | `resources` |
| Purchase order / Commande d’achat | `allPOs` (current project) | id + supplier | 3 | `id · supplier` / status | `orders` + `{po:id}` |
| ECO | `allEcos` | id + title | 3 | `id · title` / status | `eco` + `{eco:id}` |
| Change request / Demande de modification | `allCRs` (current project) | id + title | 3 | `id · title` / status | `changes` + `{cr:id}` |
| NCR | `allNCRs` (current project) | id + title | 3 | `id · title` / `sev · status` | `quality` + `{qTab:'ncr', ncr:id}` |
| Risk / Risque | `risks` (current project) | id + title | 3 | `id · title` / category | `risks` + `{risk:id}` |
| Drawing / Plan | `DRAWINGS` | number + title | 3 | `no · title` / `rev <rev> · <state>` | `drawings` + `{dwg:no}` |

Search ignores role gating: a hit may land on a screen outside the persona's workspace (→ outside banner, read-only).

### 5.5 Notifications (lines 108–117; data `NOTIFS` 3545–3555, `NOTIF_ICON` 3556; logic 4706–4708, 5193)

- Trigger: `btn btn-icon btn-secondary` (36×36), `ph ph-bell`, tooltip "Notifications". Unread badge (when `hasUnread`): absolute `top:-4px; right:-4px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; font-size:10px; background:accent; color:bg`, text = unread count.
- Click → `notifOpen = !notifOpen`. Panel: click-catcher `fixed inset 0 z 48` (closes), panel `.elev-md` absolute `z-index:49; top:calc(100% + 6px); right:0; width:min(440px,90vw); padding:8px; max-height:70vh; overflow:auto`.
- Panel header: "Notifications" 13 px 500 + ghost button "Mark all read" (FR "Tout marquer lu", `font-size:12px; padding:2px 8px`) → `readNotifs` = every NOTIFS id → true.
- Row (button, grid `8px 28px minmax(0,1fr)`, gap 10, padding 8, radius 6, hover neutral-900): unread dot 8×8 (accent if unread, else transparent; `margin-top:9px`); icon tile 28×28 radius 7 `background:accent-900; color:accent-300` with `NOTIF_ICON[kind]`; text column: title 13 px, sub 11.5 px neutral-400, when 11 px neutral-500. Unread row background `color-mix(in srgb, var(--color-accent-900) 60%, transparent)`.
- Click a row → `{screen:target, notifOpen:false, readNotifs[id]:true, ...extra}`.
- Footer note: "Also sent by e-mail digest and to the project Teams channel · preferences in Settings" (11 px neutral-500).
- Filter: only notifications whose audience array contains the current role.

| id | kind → icon | Title (EN / FR) | Sub (EN) | When | Read | Target screen + state | Audience |
|---|---|---|---|---|---|---|---|
| n1 | approval → `ph-seal-check` | CR-008 awaits your approval / CR-008 attend votre approbation | Second steel crew — schedule recovery · +85 k€ · Romain Aubert | 25 Sep 09:12 | no | `changes` `{cr:'CR-008'}` | director, client |
| n2 | alert → `ph-warning` | Harbor Line float dropped to −27 days / La marge de Harbor Line est tombée à −27 jours | Steel structure forecast slipped 3 more days at W39 snapshot | 25 Sep 07:40 | no | `trends` | director, pm |
| n3 | quality → `ph-shield-warning` | NCR-029 raised — Critical / NCR-029 émise — Critique | Foundation bolt pattern 12 mm off at Bay 7 · Thomas Kerbrat | 24 Sep 16:20 | no | `quality` `{qTab:'ncr', ncr:'NCR-029'}` | pm, quality, englead |
| n4 | delivery → `ph-truck` | BL-2026-0533 partially rejected / BL-2026-0533 partiellement refusée | 2 XLPE drums with sheath damage → scrap · Hélène Sauvage | 23 Sep 11:20 | yes | `deliveries` `{deliv:'BL-2026-0533'}` | pm, procurement |
| n5 | eco → `ph-git-branch` | ECO-2026-015 needs PM approval / ECO-2026-015 attend l’approbation du chef de projet | Replace CD-200 detector by CD-210 in all open designs | 19 Sep 14:05 | no | `eco` `{eco:'ECO-2026-015'}` | pm |
| n6 | mention → `ph-at` | @you in A1250 Steel erection / @vous dans A1250 Montage charpente | “Can we confirm the crane slot for the K-12 splice re-weld?” · Julien Wagner | 25 Sep 10:30 | no | `plan` `{sel:'A1250', selOpen:true}` | pm, member, depthead |
| n7 | request → `ph-paper-plane-tilt` | Resource request rescheduled / Demande de ressource replanifiée | Structural checks · Julien Wagner · proposed W42 instead of W41 · Marion Kerviel | 24 Sep 09:00 | yes | `requests` | pm |
| n8 | invoice → `ph-receipt` | INV-HC-7781 blocked by 3-way match / INV-HC-7781 bloquée par le rapprochement 3 voies | Halvorsen Cranes · receipt 26.8 k€ short of invoice | 22 Sep 17:45 | no | `procurement` `{pTab:'inv', inv:'INV-HC-7781'}` | procurement, director |
| n9 | task → `ph-check-square` | New task assigned: Steel QA checks W41 / Nouvelle tâche : contrôles QA charpente S41 | Approved by Marion Kerviel · due 12 Oct | 25 Sep 08:15 | no | `mywork` | member |
| n10 | sync → `ph-arrows-clockwise` | Lucca sync completed / Synchro Lucca terminée | Hours and leave imported for W39 · 8 people · 3 anomalies to review | 26 Sep 06:30 | yes | `leave` | all except client |

Initial unread counts: director 3, pm 4, depthead 1, member 2, englead 1, quality 1, procurement 1, client 1. Notifications can navigate outside the persona's workspace (e.g. client → `changes` is allowed; member → `plan` is outside).

`ACTIVITY` (lines 3557–3569, 12 rows `[when, who, what, kind]`) is not shown in the shell; it feeds the Activity tab of `plumbing` (see that module's spec).

### 5.6 Status date (line 119)

`ph ph-calendar-blank` + "Status date ·" + `statusDate` = hard-coded `'25 Sep 2026'` (FR "Date d’état · 25 sept. 2026"); 12 px neutral-400. Consistent with `TODAY = 4` (Fri 25 Sep 2026, §14).

### 5.7 Language toggle (line 120)

Segmented control `langSeg = seg([{v:'fr',l:'FR'},{v:'en',l:'EN'}], lang, v=>setState({lang:v}))`. Default `'fr'`. Not persisted.

### 5.8 Export (line 122)

`btn btn-secondary` with `ph ph-export` + "Export" (FR "Exporter"). **No handler** in the prototype.

### 5.9 Primary action (line 123; map `primary`, line 5137)

`btn btn-primary` with `ph ph-plus` + `primaryAction`. Visible when `hasPrimary = !!label && !!handler && !outside && !(projReadOnly && screen ∈ project-scoped editable list)`, where the editable list = the `showProjectPicker` list minus `client` and `docs`.

| Screen | Label EN / FR | Handler |
|---|---|---|
| home | New project / Nouveau projet (director, pm only) | `openNp` → wizard (§10) |
| overview, projects | New project / Nouveau projet | `openNp` |
| meetings | New meeting / Nouvelle réunion | AF `meetings` |
| contract | Add amendment / Ajouter un avenant | AF `amendment` |
| billing | Issue invoice / Émettre la facture | AF `billing` — only if at least one milestone is "Planned" (`ctrToInvoice.length`) |
| stakeholders | Add stakeholder / Ajouter une partie prenante | AF `stakeholders` |
| itp | Add inspection / Ajouter une inspection (plan view) · Add punch item / Ajouter une réserve (`itpView==='punch'`) | AF `itp` / `punch` |
| interfaces | New interface / Nouvelle interface | AF `interfaces` |
| contingency | Draw-down / Prélèvement | AF `contingency` |
| commissioning | Plan SAT / Planifier la SAT | AF `commissioning` |
| rex | Add lesson / Ajouter un REX | AF `rex` |
| hours | Import Lucca / Importer Lucca | AF `hours` |
| fleet | Add machine / Ajouter une machine | AF `fleet` |
| sav | New claim / Nouvelle réclamation | AF `sav` |
| docs | Deposit in Codex / Déposer dans Codex | `dv.dep = {open:true, step:1, ctx:''}` (docs module dialog) |
| eng | Import a list / Importer une liste | `engImp = {open:true, step:1}` |
| eng-process / eng-meca / eng-elec / eng-auto | Import a list | `engImp` open with `{disc, doc, tool}` = process/`GA-HLT-026`/1, meca/`LST-INS-026`/0, elec/`LST-INS-026`/0, auto/`LST-INS-026`/0 |
| budget | Change request / Demande de modification | `{budgetTab:'setup'}` |
| schedule | Re-baseline / Nouvelle référence | AF `schedule` |
| plan | Add activity / Ajouter une activité (Structure view) · Update progress / Mettre à jour l’avancement (Progress view, default) | AF `plan` / `progress` |
| resources, presources, requests | Request resource / Demander une ressource · requests: New request / Nouvelle demande | `openNr` → §12 |
| orders | New purchase order / Nouvelle commande | `createDrafts` — only when BOM shortfall exists |
| deliveries | Announce a delivery / Annoncer une livraison | `announce` |
| stock | Import from X3 / Importer depuis X3 | `importX3` |
| bom | Add article / Ajouter un article | AF `bom` |
| plm | New part / Nouvel article | AF `plm` |
| eco | New ECO / Nouvel ECO | AF `eco` |
| rates | Add role / Ajouter un rôle | AF `rates` |
| trends | Generate status report / Générer le rapport d’état | AF `trends` |
| plumbing | Add connector / Ajouter un connecteur | AF `plumbing` |
| client | Download status report / Télécharger le rapport d’état | AF `client` |
| portfolio | Score a proposal / Noter une proposition | AF `portfolio` |
| quality | New NCR / Nouvelle NCR | AF `quality` |
| site | Daily report / Rapport journalier | AF `site` |
| pid | Import P&ID tags / Importer les tags du PID | AF `pid` |
| procurement | New RFQ / Nouvelle consultation | AF `procurement` |
| risks | New risk / Nouveau risque | AF `risks` |
| changes | New change request / Nouvelle demande de modification | AF `changes` |
| settings | Reset to defaults / Réinitialiser | `{settings: deep copy of SETTINGS0}` |
| skills | Add skill / Ajouter une compétence | AF `skills` |
| mtypes | New machine type / Nouveau type de machine | AF `mtype` |
| leave | Sync Lucca / Synchroniser Lucca | AF `leave` |
| whatif | New scenario / Nouveau scénario | AF `whatif` |
| drawings | Sync vault / Synchroniser le coffre | AF `drawings` |
| approvals | Team capacity (no FR) | `go('resources')` |
| mywork | Log time (no FR) | `openTask(open[0] || mine[0] || TSK)` → screen `task` |
| task | Mark done / Marquer terminé | `setTask({status:'done', pct:100})` |
| myprojects, worldmap, pfplan, cash, myapprovals, doctypes | — | none |

---

## 6. Overlay stacking (z-index map)

| Layer | z-index | Element |
|---|---|---|
| Project switcher dropdown | 30 | line 84 |
| Role menu popover | 40 | line 60 |
| Search / notifications click-catcher | 48 | lines 101, 111 |
| Search results / notifications panel | 49 | lines 102, 112 |
| Add-form dialog, New project wizard, New resource request | 50 | lines 139, 2973, 3072 |
| Force stage change | 55 | line 3059 |
| Toast | 80 | line 160 |

Module overlays outside this spec (document viewer `showDoc`, Codex deposit `depOpen`, engineering import `engImpOpen`, part detail `showPartDetail`) are siblings inside `<main>` and are specified with their modules.

---

## 7. Banners

### 7.1 Outside banner (lines 126–128)

Shown when `outside`. Row `display:flex; align-items:center; gap:10px; font-size:12.5px; color:neutral-300; padding:9px 12px; border-radius:md; background:neutral-900; box-shadow: inset 0 0 0 1px neutral-800`. `ph ph-eye` (16 px accent), text `outsideText = 'Outside my workspace · Read-only · ' + PERSONAS[role][1]` (FR "Hors de mon périmètre · Consultation · <rôle>"), ghost button `ph ph-house` + "Home" (FR "Accueil") → `go('home')`.

### 7.2 Zone bar (lines 130–136; logic 3791, 3902, 4995, 5211)

Shown on `overview, projects, pfplan, worldmap, portfolio, cash, fleet, sav` (`zoneBar`). Row `display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:-4px`:
- Label: `ph ph-globe-hemisphere-east` (15 px accent) + "Zone" (12 px neutral-400).
- Segmented control (wrapping): "All zones" (FR "Toutes zones") + one option per `ZONES` entry, each with a count (11 px tabular neutral-400): for portfolio screens = number of portfolio projects (`state.projects`, all 17) in the zone (`zoneOf(code)` via `GEO`/`COUNTRY_ZONE`, default `'euna'`); for `fleet`/`sav` = number of installed machines in the zone; "All zones" = total.
- Click → `{pfZone:v, pfSel:null, pfWhatif:null, statusMenu:null, stageOpen:null}`.
- Manager: `ph ph-user-circle` + "Zone manager"/"Zone managers" (FR "Responsable de zone"/"Responsables de zone") + name (neutral-200): selected zone → full manager name; none → abbreviated list "O. Castel · A. Diallo · S. Nguyen".

`ZONES` (line 3170): `['euna','Europe & North America','Olivier Castel']` (FR "Europe & Amérique du Nord"), `['afr','Africa','Aïcha Diallo']` (FR "Afrique"), `['apac','Asia Pacific','Sophie Nguyen']` (FR "Asie Pacifique"). `ZONE_BOUNDS` (line 3172) feeds the map. The zone filter (`inZone`) applies to every portfolio screen and to fleet/sav; empty-state text "No project in this zone for this view" (FR "Aucun projet dans cette zone pour cette vue") is rendered by those screens (`zoneEmpty*` flags). The section `sub` of Portfolio and Warranty & after-sales shows the zone name.

---

## 8. Generic add-form dialog (`afOpenDlg`, lines 138–158)

### 8.1 Layout

- Backdrop `.dialog-backdrop` with `z-index:50; align-items:start; padding-top:8vh`.
- Dialog `.dialog` `width:min(640px,100%); gap:14px; max-height:84vh; overflow:auto`.
- Header row: title (`.dialog-title`, `afForm.title`) and sub-line 12 px neutral-400: `<projectName> · Required fields are marked · *` (asterisk in accent; FR "Les champs obligatoires sont marqués ·"); close button `btn btn-icon btn-secondary` with `ph ph-x` → `afClose`.
- Body: grid `repeat(2, minmax(0,1fr))`, gap 12. Each field `.field` with `grid-column: span` = `'1 / -1'` (full width) when type is `textarea` or id ∈ {`title`, `name`, `progress`, `reason`, `why`}, else `auto`. Label row `display:flex; gap:4px` + accent `*` when required.
- Controls: `text` → `.input`; `number` → `.input type=number` tabular figures; `textarea` → `.input rows=3`, `resize:vertical; min-height:72px`; `select` → `<select class="input">` with options (value = label = option string).
- Footer `.dialog-actions` (flex end, gap 8): "Cancel" (`btn-secondary`, FR "Annuler") → `afClose`; submit `btn-primary` with icon (`ph ph-check` for `kind:'create'`, `ph ph-play` for `kind:'run'`) + `afForm.submit`, `disabled` when invalid.
- No backdrop click handler; Esc not handled.

### 8.2 Field model and behaviour (lines 5111–5136)

- Definition: `AF[key] = {title, kind:'create'|'run', submit, fields:[[id, label, type, default, required?]]}`.
- Opening `afOpenWith(key, init)`: builds `values` — array default → first option; dynamic token (`'WP','TEAM','ACT','ACTOPEN','PIPE','RCAT','ITPSYS','FLEET','MSPLAN'`) → `''`; otherwise the default string; then merges `AF_DYN[key]` (billing: `{no: ctrNextInvNo}`, e.g. "INV-2026-004") and `init`; sets `af = {open:true, key, values}`. Each opening rebuilds values (no carry-over).
- Displayed value: `values[id]` if non-empty, else first option for selects, else `''`.
- Dynamic option sources (`afOpts`):

| Token | Options |
|---|---|
| `WP` | level-1 WBS packages of the current project: `"<w> · <name>"` (e.g. "1.1 · Design & permits") |
| `ACTOPEN` | activities with `pc < 100`: `"<id> · <name>"` |
| `ACT` | first 12 activities of the project data: `"<id> · <name>"` |
| `TEAM` | `DEFS[project].team` if defined, else all `PEOPLE` names |
| `PIPE` | projects in stages Initiative / APS / APD: `pname(code,name)` |
| `RCAT` | distinct `RISKS_HLT[].cat` |
| `ITPSYS` | `ITP_TEMPLATES[machine type of project]` (fallback `AUTRE`) |
| `FLEET` | `FLEET` rows: `"<id> · <name>"` |
| `MSPLAN` | contract milestones with status "Planned": `"<id> · <label>"` |

- Change: `afSetVal(id)` writes `af.values[id]`.
- Validation (`afValid`): every required field must be non-blank after trim; `select` fields always pass. Submit disabled otherwise (`afForm.disabled`).
- Close: `afClose` sets `af.open=false` (values kept until next open).
- Submit (`afSubmit`): guards validity, resolves each value (`get(id)` = typed value or first option), applies per-key side effects (below), writes `added`, closes, then `showToast(msg)` where `msg = AF_RESULT[key]`, possibly prefixed.

### 8.3 Per-key side effects of `afSubmit`

| Key | Effect on state | Toast (EN) |
|---|---|---|
| `risks` | prepend to `added.risks`: `{id:'R-'+(20+n+1) padded 2 (→ "R-21"), title, cat, p:int clamp 1–5 (default 3), i:int clamp 1–5 (default 3), owner, resp, plan:plan or '—', act:'', emv:int or 0, trig:'—', status:'Open', trend:'flat', proj}` | "R-21 · Risk registered" |
| `changes` | prepend to `added.crs`: `{id:'CR-0'+(10+n+1) (→ "CR-011"), title, types: 'Scope + budget' → ['scope','budget'] else [type.toLowerCase()], amt:int, days:int, wbs:[wbs or '1'], status:'In review', by:"M. Lefebvre"-style short name of the persona, date:'30 Sep', chain:{pm,director,client,ccb:'pending'}, bl:'BL1', proj}` — the "Justification" (`why`) is not stored | "CR-011 · Change request submitted for review" |
| `quality` | prepend to `added.ncrs`: `{id:'NCR-0'+(30+n+1) (→ "NCR-031"), title, sev, src, act:<id part of Activity>, part, raised:<persona full name>, date:'30 Sep', owner, status:'Open', root:'—', action:desc or '—', due:'—', cost:0, deliv:'', iso:'8.7 Control of nonconforming outputs', proj}` | "NCR-031 · NCR raised" |
| `meetings`, `milestone`, `amendment`, `bond`, `stakeholders`, `itp`, `punch`, `interfaces`, `contingency`, `rex`, `fleet`, `sav` | append a record `{<every field id>: value, proj, date2:'30 Sep 2026'}` to bucket: milestone→`milestones`, amendment→`amendments`, bond→`bonds`, contingency→`draws`, rex→`lessons`, sav→`claims`, others same name | meetings: "<title> · …"; amendment/bond: "<label> · …"; others: result text |
| `billing` | if a milestone is chosen: `ctrOv[msId]='Invoiced'`, `ctrInv[msId]={no (or ctrNextInvNo), date (or '30 Sep 2026'), note}` | "INV-2026-004 · M4 · Invoice issued · sent to the client" |
| `hours` | `hoursImported:true` | result text |
| `plan` | append to `added.acts`: `{proj, id:'A'+DEFS[project].idx+'9'+NN (→ "A1901"), w:<wp code>, n:name, d: working days = round((finish−start) days × 5/7), min 1, default 20, o: initials via INIT_OF (default 'RA'), s/f: wbsFmtDate (e.g. "05 Oct"), b:float budget, crit: critical==='Yes', desc}` | "A1901 · Activity created · 1.1" |
| `mtype` | code = upper-cased, spaces→'-'; if new: append to `added.mtypes` a copy of the base machine type (phases, cats, itp, dep/deliv/acc) with `refs:[]`, `active:true`; set `mtSel` | "<CODE> · Machine type created", or "Code already used" (FR "Code déjà utilisé") when the code exists |
| `wp` | append to `added.wps`: `{proj, w:'1.'+(count of level-1 packages + added ones + 1) (→ "1.9" on HLT), n, o, b, desc}` | "1.9 · <name> · Work package created" |
| `progress` | `wbsOv[project+'|'+actId].pc = clamp 0–100` | "A1250 · 50 % · Progress saved" |
| `schedule` | none | "<baseline name> · Baseline frozen" |
| `pid` | none | "27 tags · rev <rev> imported · 3 new · 1 updated" |
| all others (`commissioning`, `bom`, `plm`, `eco`, `rates`, `trends`, `plumbing`, `client`, `portfolio`, `site`, `procurement`, `skills`, `leave`, `whatif`, `drawings`) | none (toast only) | result text |

### 8.4 `AF` catalogue (lines 3674–3700) and `AF_RESULT` (line 3701)

Field notation: `id` Label (type, default or [options]; `*` = required). Titles and submit labels in FR as rendered.

| Key (opened from) | Title EN / FR | Kind | Submit EN / FR | Fields | Result (`AF_RESULT`) |
|---|---|---|---|---|---|
| `meetings` (meetings primary) | New meeting / Nouvelle réunion | create | Create & invite / Créer & inviter | `title` Title (text*); `type` Type ([Internal, External]); `series` Series ([Weekly site meeting, Steering committee, Engineering coordination, Supplier review, Kick-off, One-off]); `date` Date (text*, "6 Oct 2026"); `time` Time (text, "09:00"); `loc` Location (text, "Teams"); `invited` Invitees (text*, "R. Aubert, L. Fabre, J. Wagner"); `agenda` Agenda (one point per line) (textarea) | Meeting created · invitation synced to the calendar |
| `milestone` (contract screen `addMilestone`) | Add payment milestone / Ajouter un jalon de paiement | create | Add milestone / Ajouter le jalon | `label` Milestone (text*); `pct` Share of contract (%) (number*, "10"); `due` Contractual date (text*); `cond` Condition (textarea) | Payment milestone added |
| `amendment` (contract primary, `addAmendment`) | Add amendment / Ajouter un avenant | create | Register amendment / Enregistrer l’avenant | `label` Subject (text*); `cr` Linked change request (text); `amt` Amount (k€) (number*, "0"); `status` Status ([Draft, Sent for signature, Awaiting signature, Signed]); `date` Signature date (text); `doc` Document reference (text) | Amendment registered |
| `bond` (contract `addBond`) | Add guarantee / Ajouter une garantie | create | Register guarantee / Enregistrer la garantie | `label` Type ([Performance bond, Advance payment bond, Retention bond, Warranty bond, Parent company guarantee]); `amt` Amount (k€) (number*, "0"); `issuer` Issuer (text*); `valid` Valid until (text*) | Guarantee registered |
| `billing` (billing primary; contract milestone row via `afOpenWith('billing',{ms})`, line 4878) | Issue invoice / Émettre la facture | run | Issue invoice | `ms` Milestone (select `MSPLAN`); `no` Invoice number (text*, = `ctrNextInvNo`); `date` Invoice date (text*, "30 Sep 2026"); `note` Note on the invoice (textarea) | Invoice issued · sent to the client |
| `stakeholders` | Add stakeholder / Ajouter une partie prenante | create | Add / Ajouter | `name` Name (text*); `org` Organisation (text*); `role` Role (text); `type` Type ([Client, Internal, Supplier, Authority, Third party]); `contact` Contact (e-mail) (text); `owner` Relationship owner (select `TEAM`) | Stakeholder added |
| `itp` | Add inspection / Ajouter une inspection | create | Add to plan / Ajouter au plan | `name` Inspection / test (text*); `system` System (`ITPSYS`); `type` Type ([Hold, Witness, Review, Surveillance]); `stage` Stage ([Workshop, FAT, Site, SAT]); `ref` Standard / reference (text); `date` Planned date (text) | Inspection added to the plan |
| `punch` | Add punch item / Ajouter une réserve | create | Add item / Ajouter la réserve | `item` Item (text*); `loc` System / location (text); `cat` Category ([A — blocking, B — before SAT, C — cosmetic]); `src` Source ([Site walk, Client inspection, ITP, SAT]); `owner` Owner (`TEAM`); `due` Due (text) | Punch item added |
| `interfaces` | New interface / Nouvelle interface | create | Register | `title` Interface (text*); `a` Keystone side ([Process, Mechanical, Electrical, Automation, Site]); `b` Other party (text*); `data` Data expected (text*); `needed` Needed by (text*); `owner` Owner (`TEAM`) | Interface registered |
| `contingency` | Contingency draw-down / Prélèvement sur provision | create | Record draw-down / Enregistrer le prélèvement | `amount` Amount (k€) (number*); `reason` Reason (textarea*); `link` Linked to (text, "CR / risk / NCR"); `approver` Approved by ([R. Aubert · Project manager, M. Lefebvre · Portfolio director]) | Draw-down recorded |
| `commissioning` | Plan SAT / Planifier la SAT | run | Plan & invite / Planifier & inviter | `system` System (`ITPSYS`); `date` Date (text*, "10 Dec 2026"); `client` Client witnesses (text, "N. Bensaïd, K. Doucouré"); `note` Prerequisites (textarea, "Punch A items closed · pre-commissioning reports issued") | SAT planned · invitation sent to the client |
| `rex` | Add lesson learned / Ajouter un retour d’expérience | create | Record | `theme` Theme ([Engineering, Procurement, Site, Client, Planning, Quality, HSE]); `what` What happened (textarea*); `impact` Impact (text); `reco` Recommendation (textarea*); `apply` Applies to ([WBS template, ITP template, Purchasing procedure, Engineering gate checklist, Stakeholder & RACI template, Other]) | Lesson recorded · to be validated |
| `hours` | Import Lucca hours / Importer les heures Lucca | run | Import | `period` Period ([September 2026, August 2026, Q3 2026]); `code` Analytic code (text, "HAV004"); `mode` Matching ([Resource × work package (planning), Resource only]) | Lucca hours imported · 12 lines matched · 2 to assign |
| `fleet` | Add machine / Ajouter une machine | create | Add machine | `name` Machine (text*); `type` Type ([EMP, MEMU, SPUR, AUTRE]); `client` Client (text*); `site` Site; `delivered` Delivered; `warranty` Warranty end (texts) | Machine added to the installed base |
| `sav` | New warranty claim / Nouvelle réclamation garantie | create | Open claim / Ouvrir la réclamation | `machine` Machine (`FLEET`); `issue` Issue (text*); `sev` Severity ([Minor, Major, Critical]); `cover` Coverage ([Warranty, Extended warranty, Chargeable]); `owner` Owner ([T. Kerbrat, C. Morvan, S. Haddad, J. Wagner]); `desc` Description (textarea) | Warranty claim opened |
| `mtype` | New machine type / Nouveau type de machine | create | Create machine type / Créer le type | `code` Code (text*); `label` Label (text*); `base` Copy template from ([EMP, MEMU, SPUR, AUTRE, R&D, Blank]); `cal` Default calendar ([Standard 5d · 8h, Standard 5d · 8h + Atelier, Chantier 6d · 10h]); `desc` Description (textarea) | Machine type created |
| `wp` (plan screen `addWp`) | Add work package / Ajouter un lot de travaux | create | Create work package / Créer le lot | `name` Work package name (text*); `owner` Owner (`TEAM`); `budget` Budget (k€) (number, "100"); `desc` Scope (textarea) | Work package created |
| `progress` | Update progress / Mettre à jour l’avancement | run | Save progress / Enregistrer l’avancement | `act` Activity (`ACTOPEN`); `pc` % complete (number*, "50"); `note` Note (textarea) | Progress saved |
| `plan` (plan primary in Structure view; WBS row via `afOpenWith('plan',{wp})`, line 4011) | Add activity / Ajouter une activité | create | Create activity / Créer l’activité | `name` Activity name (text*); `wp` Work package (`WP`); `owner` Owner (`TEAM`); `start` Start date (text, "5 Oct 2026"); `finish` Finish (text, "30 Oct 2026"); `budget` Budget (k€) (number, "40"); `critical` Critical path ([No, Yes]); `desc` Description (textarea) | Activity created |
| `schedule` | Re-baseline / Nouvelle référence | run | Freeze new baseline / Geler la nouvelle référence | `name` Baseline name (text*, "BL2 — after CR-006"); `reason` Reason (textarea*); `approver` Approver ([Marie Lefebvre · Portfolio director, Romain Aubert · Project manager]); `scope` Scope ([Dates & budget, Dates only, Budget only]) | Baseline frozen |
| `bom` | Add article / Ajouter un article | create | Add to BOM / Ajouter à la nomenclature | `ref` Article reference (text*); `qty` Quantity (number, "1"); `act` Activity (`ACT`); `scope` Scope ([Keystone, Client, Overlay]); `note` Note (textarea) | Article added to the project BOM |
| `plm` | New part / Nouvel article | create | Create part / Créer l’article | `ref` Reference (text*); `name` Designation (text*); `family` Family ([Structure, Mechanical, Electrical, Automation, Consumable]); `supplier` Preferred supplier (text); `price` Unit price (€) (number); `unit` Unit ([pc, m, kg, set]) | Part created in the catalogue |
| `eco` | New ECO / Nouvel ECO | create | Open ECO / Ouvrir l’ECO | `title` Title (text*); `parts` Parts affected (text*); `reason` Reason ([Client request, Non-conformity, Cost reduction, Design error, Supplier change]); `impact` Impact ([Drawings only, Drawings + BOM, Drawings + BOM + purchasing]); `desc` Description (textarea) | ECO opened · in approval |
| `rates` | Add role / Ajouter un rôle | create | Add role | `role` Role (text*); `rate` Hourly rate (€) (number*); `cc` Cost center ([Engineering, Site, Automation, Project management]); `grade` Grade ([Junior, Confirmed, Senior, Expert]) | Role added to the rate card |
| `trends` | Generate status report / Générer le rapport d’état | run | Generate PDF / Générer le PDF | `period` Period ([September 2026, Q3 2026, Since project start]); `audience` Audience ([Steering committee, Client, Internal]); `sections` Sections ([Full report, Summary + KPIs, KPIs only]); `note` Manager note (textarea) | Status report generated · PDF ready |
| `plumbing` | Add connector / Ajouter un connecteur | create | Connect / Connecter | `system` System ([Sage X3, Lucca, SharePoint, SeeElectrical, SolidWorks 3DX, TIA Portal]); `direction` Direction ([Import, Export, Both]); `freq` Frequency ([Real time, Hourly, Daily, Manual]); `owner` Technical owner (text) | Connector added · first sync scheduled |
| `client` | Download status report / Télécharger le rapport d’état | run | Download / Télécharger | `period` Period ([September 2026, Q3 2026, Since project start]); `format` Format ([PDF, PowerPoint]) | Report downloaded |
| `portfolio` | Score a proposal / Noter une proposition | run | Save score / Enregistrer le score | `project` Proposal (`PIPE`); `fit` Strategic fit (1–5) (number*, "3"); `fin` Financial return (1–5) (number*, "3"); `risk` Risk (1–5, 5 = low) (number*, "3"); `comment` Comment (textarea) | Score saved |
| `quality` | New NCR / Nouvelle NCR | create | Raise NCR / Émettre la NCR | `title` Title (text*); `sev` Severity ([Minor, Major, Critical]); `src` Source ([Site inspection, Goods receipt, Workshop, Client, Audit]); `act` Activity (`ACT`); `part` Part (text); `owner` Owner (`TEAM`); `desc` Description (textarea) | NCR raised |
| `site` | Daily report / Rapport journalier | create | Save report / Enregistrer le rapport | `date` Date (text, "30 Sep 2026"); `weather` Weather ([Clear, Rain, Wind > 50 km/h, Storm]); `headcount` Headcount on site (number, "24"); `progress` Progress (textarea*); `incident` HSE ([None, Near miss, First aid, Incident]) | Daily report saved |
| `pid` | Import P&ID tags / Importer les tags du PID | run | Import tags / Importer les tags | `file` File (text, "PID-HLT-026_revE_tags.xlsx"); `rev` Revision (text*, "E"); `source` Source ([AutoCAD P&ID export, Excel list]); `mode` Mode ([Add & update, Replace all]) | 27 tags imported · 3 new · 1 updated |
| `procurement` | New RFQ / Nouvelle consultation | create | Send RFQ / Envoyer la consultation | `title` Title (text*); `suppliers` Suppliers (text*); `articles` Articles (text*); `due` Reply due (text, "15 Oct 2026"); `incoterm` Incoterm ([DAP site, EXW, FCA, DDP]) | RFQ sent to suppliers |
| `risks` | New risk / Nouveau risque | create | Register risk / Enregistrer le risque | `title` Title (text*); `cat` Category (`RCAT`); `p` Probability (1–5) (number, "3"); `i` Impact (1–5) (number, "3"); `owner` Owner (`TEAM`); `resp` Response ([Mitigate, Accept, Transfer, Avoid]); `emv` EMV (k€) (number); `plan` Response plan (textarea) | Risk registered |
| `changes` | New change request / Nouvelle demande de modification | create | Submit for review / Soumettre en revue | `title` Title (text*); `type` Type ([Scope, Budget, Schedule, Scope + budget]); `amt` Amount (k€) (number, "0"); `days` Delay (days) (number, "0"); `wbs` WBS (text, "1.3"); `why` Justification (textarea*) | Change request submitted for review |
| `skills` | Add skill / Ajouter une compétence | create | Add skill | `name` Skill (text*); `cat` Category ([Engineering, Site, Automation, Management, Safety]); `levels` Levels ([1–4, 1–3, Yes / No]) | Skill added |
| `leave` | Sync Lucca / Synchroniser Lucca | run | Synchronise / Synchroniser | `period` Period ([Next 3 months, Next 6 months, Full year]); `teams` Teams ([All teams, Engineering, Site]) | Lucca synchronised · 14 absences updated |
| `whatif` | New scenario / Nouveau scénario | create | Create scenario / Créer le scénario | `name` Scenario name (text*); `basis` Basis ([Current plan, Baseline BL1, Last approved scenario]); `horizon` Horizon ([3 months, 6 months, 12 months]); `note` Hypotheses (textarea) | Scenario created |
| `drawings` | Sync vault / Synchroniser le coffre | run | Synchronise / Synchroniser | `source` Source ([SolidWorks 3DX vault, SeeElectrical, Both]); `scope` Scope ([Current project, All projects]) | Vault synchronised · 6 drawings updated |

---

## 9. Toast (lines 159–161; `showToast`, line 5116)

- `.card .elev-lg`, `position:fixed; right:22px; bottom:22px; z-index:80; display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; max-width:min(420px,90vw); border:1px solid var(--color-accent-800)`. Icon `ph ph-check-circle` (accent, 18 px), text (`text-wrap:pretty`), close `btn btn-icon btn-ghost` `ph ph-x` (neutral-400, margin-left 4) → `toast:''`.
- `showToast(msg)`: in FR, `msg.split(' · ').map(frSeg).join(' · ')`; sets `toast`; clears the previous timer and auto-hides after 4000 ms (`this._toastT`). One toast at a time (newer replaces older).
- Emitters: AF submit (§8.3); site screen (Cursus reminder/open/sync, lines 4746–4747); meetings minutes sent (4852, FR string hard-coded there); docs/Codex (5047, 5055, 5058, 5059). The New project wizard, New request dialog and Force dialog do not toast.

---

## 10. New project wizard (`npOpen`, lines 2972–3056; logic 3946–3969)

Business meaning: creates a new project at lifecycle stage **Initiative** with an auto-numbered project ID, an analytic code derived from the client, a DAS (business area 1–4), a machine type (product range) and a standard planning template + budget breakdown for that machine type.

### 10.1 Container

Backdrop `z-index:50; align-items:start; padding-top:6vh`; dialog `width:min(720px,100%); gap:14px; max-height:88vh; overflow:auto`. Header: "New project" (FR "Nouveau projet") + sub 12.5 px neutral-400 "Guided setup · step N of 4" (FR "Création guidée · étape N sur 4"); close `btn-icon btn-secondary ph-x` → `npClose` (`np.open=false`, values kept).

Stepper (grid 4 columns, gap 6): each step = 2 px bar (radius 1; accent if index < current step, else neutral-800) + label 11.5 px (text colour on current step, else neutral-400). Labels: Basics, Structure, Budget, Schedule (FR: "Basics" untranslated, "Structure", "Budget", "Planning").

Footer `.dialog-actions` (margin-top 0): "Back" (`btn-secondary`, step > 1, FR "Retour") → step−1; on step 4 "Create project" (`btn-primary` + `ph-check`, FR "Créer le projet") → `npCreate`; on steps 1–3 "Next" (`btn-primary` + trailing `ph-arrow-right`, FR "Suivant") → step+1. No validation on any step.

### 10.2 Step 1 — Basics (grid 2 columns, gap 12)

| Field (EN / FR) | Control | Binding / behaviour |
|---|---|---|
| Project name / Nom du projet (full width) | input, placeholder "Eastbank Warehouse Automation" | `np.name` (`npSetName`) |
| Project ID / Identifiant projet | read-only pseudo-input: value bold tabular + hint "#000 · auto-incremented" | `nextProjectId()` = `'#' + (max numeric PROJ_ID id + 1)` padded 3 → "#045" initially |
| Analytic code / Code analytique | read-only pseudo-input: value + hint (ellipsis) | `nextAnalytic(client)` = 3-letter client code + count+1 padded 3 (e.g. "LOG001"); hint: no client → "3 client letters + incremental number"; known client (`CLIENT_CODES`) → "Client code LOG · incremental number"; unknown → "New client — code ACM proposed" |
| DAS | segmented DAS 1 / DAS 2 / DAS 3 / DAS 4 (`flex:1` options) | `np.das`, default '2' |
| Machine type / Type de machine | segmented EMP / MEMU / SPUR / AUTRE / R&D | `np.mt`, default 'EMP'; changing it: if template is 'blank' keep blank and categories, else switch `template` to that machine type's template and reset `cats` to its categories |
| Project manager / Chef de projet | static pseudo-select: avatar "SP" + "S. Perrin" + caret | not interactive |
| Client / sponsor | input, placeholder "Logistics business unit" (FR "BU Logistique") | `np.client` (`npSetClient`) |
| Currency / Devise | segmented USD / EUR | `np.cur`, default 'EUR' (affects only the step-3 total text) |
| Planned start / Début prévu | static pseudo-select `ph-calendar-blank` "11 Jan 2027" | not interactive |
| Planned finish / Fin prévue | static "30 Sep 2027" | not interactive |

`CLIENT_CODES` (line 3167): Port authority HAV, Infrastructure BU NGD, Health trust CPL, Finance KEY, Energy BU WFE, Transit BU RTM, Logistics BU LOG, Network BU TLN, Retail BU SGP. `clientCode3(c)` = mapped code, else first 3 letters of `c` (letters only, upper-case, padded with X; empty → "XXX").

### 10.3 Step 2 — Structure

- Label "Start from" (FR "Partir de").
- Template cards (grid `repeat(auto-fit,minmax(200px,1fr))`, gap 10): only `blank` and the template whose `mt === np.mt` (always 2 cards). Card: `padding:12px; border-radius:md; background:neutral-900; border:1px solid` (accent if selected, else neutral-800; hover neutral-600); 14 px radio dot (selected: accent border + accent fill + `inset 0 0 0 3px neutral-900`); name 13.5 px 500; description 12 px neutral-400. Click → `{template:id, cats: template cats}` (blank → empty list).
- "Copy" panel (grid `repeat(auto-fit,minmax(130px,1fr))`, gap 8, padding 12, bg neutral-900): WBS → `tmpl.wbs`; Activities & logic → `tmpl.acts`; Cost categories → "`n` categories" or "Define in step 3"; Calendars → `tmpl.cal`; Baselines → "Not copied" (neutral-500). Labels 10.5 px uppercase neutral-400; values 13 px.
- Phases (if template has phases): "Standard phases — WBS level 1" + `tag tag-neutral` chips "`n` · `phase`" + note "The budget breakdown in the next step follows the same machine type."

`NP_TEMPLATES` (lines 3179–3185; content authored in French):

| id | mt | Name | WBS | Activities | Calendar | Phases | Cost categories [name, type, budget k] |
|---|---|---|---|---|---|---|---|
| blank | — | Projet blank | Vide | Aucune | Standard 5d · 8h | — | — |
| EMP | EMP | Planning EMP | 6 phases · 14 lots | 38 activités · 52 liens | Standard 5d · 8h + Atelier | Études & approvisionnements longs; Fabrication structure; Montage mécanique; Installation électrique & automatisme; Essais & mise en service; Réception & transfert | Études Labor 160; Matière & structure Material 560; Composants achetés Material 440; Fabrication & montage Labor 360; Sous-traitance Subcontract 200; Installation & essais Labor 160; Frais & transport Fees 60 |
| MEMU | MEMU | Planning MEMU | 6 phases · 12 lots | 31 activités · 40 liens | Standard 5d · 8h | Études; Approvisionnements; Fabrication modules; Assemblage & câblage; Essais plateforme; Installation site & réception | Études Labor 120; Modules & composants Material 420; Assemblage Labor 240; Sous-traitance Subcontract 140; Installation & réception Labor 140; Frais & transport Fees 70 |
| SPUR | SPUR | Planning SPUR | 6 phases · 15 lots | 44 activités · 60 liens | Chantier 6d · 10h | Études & permis; Génie civil; Structures & supports; Équipements électriques; Raccordement & essais; Mise en service | Études & permis Labor 90; Génie civil Subcontract 270; Structures Material 450; Équipements électriques Material 420; Installation & essais Labor 180 |
| AUTRE | AUTRE | Planning standard (Autre) | 5 phases · 8 lots | 20 activités · 24 liens | Standard 5d · 8h | Cadrage; Conception; Réalisation; Essais; Livraison | Main-d’œuvre Labor 400; Matériel Material 300; Sous-traitance Subcontract 150; Frais Fees 50 |
| R&D | R&D | Planning R&D | 5 phases · 7 lots | 18 activités · 20 liens | Standard 5d · 8h | Exploration; Prototype; Essais & itérations; Industrialisation; Bilan | Personnel R&D Labor 330; Prototypes & essais Material 150; Partenaires & labos Subcontract 70 |

Descriptions (verbatim FR source): blank "WBS vide — vous définissez lots, catégories et calendriers."; EMP "Planning standard EMP : études, structure, montage mécanique, électricité & automatisme, essais, réception."; MEMU "Planning standard MEMU : études, approvisionnements, fabrication modules, assemblage & câblage, essais plateforme, installation."; SPUR "Planning standard SPUR : études & permis, génie civil, structures, équipements électriques, raccordement, mise en service."; AUTRE "Cadrage, conception, réalisation, essais, livraison — pour les projets hors gammes machine."; R&D "Exploration, prototype, essais & itérations, industrialisation, bilan — jalons de décision go / no-go." (`NP_TEMPLATES_OLD`, lines 3186–3191, is legacy and unused.)

### 10.4 Step 3 — Budget

- Header row: "Cost categories for this project" (13 px neutral-300) + `catSource` (12 px neutral-400): blank → "Start from nothing", else "Budget structure of `<template name>`".
- Editable grid `minmax(0,1.6fr) 130px 110px 32px`, gap 8; headers Category / Type / Budget (k) (right) / — (10.5 px uppercase neutral-400). Per row: name input (`min-height:32px; 13px`), type as static pseudo-select (not interactive; values Labor / Material / Subcontract / Fees / Equipment, FR Main-d’œuvre / Matériel / Sous-traitance / Frais / Équipement), budget input (right-aligned, string), remove button (`btn-icon btn-ghost` 32×32 `ph-x`).
- Footer row: "+ Add category" (`btn-ghost`; appends `{name:'New category', type:'Labor', budget:'0'}`); right: "Contingency" + segmented 5% / 10% / 15% (`np.cont`, default 5); "Total budget" label + value 18 px 500.
- Total: `npTotal = Σ parseFloat(budget)||0 × (1 + cont/100)` (k units); `totalText = (cur==='EUR' ? '€' : '$') + (npTotal ≥ 1000 ? (npTotal/1000).toFixed(2)+'M' : round(npTotal)+'k')` — e.g. EMP defaults: 1940 × 1.05 = 2037 → "€2.04M". Not localised (same in FR).

### 10.5 Step 4 — Schedule

Grid 2 columns:
- Default calendar (full width): segmented Standard 5d · 8h / Site 6d · 10h / 24h continuous (`np.cal`, default "Standard 5d · 8h"; FR "Standard 5d · 8h" / "Chantier 6j · 10h" / "24h continuous").
- Static pseudo-selects (not interactive): Progress cycle (data date) "Weekly · Fridays" (`ph-clock`); Baseline policy "Set BL1 at Planning → Active" (`ph-flag-banner`); Working time "08:00 – 17:00"; Holidays "US federal + site shutdown 24 Dec – 2 Jan" (FR dictionary renders "Fériés France + fermeture chantier 24 déc. – 2 janv.").
- "Will be created" panel (full width, bg neutral-900, padding 12): `summary` = `"<pid> · <ana> · DAS <das> · <mt> · <name or 'Untitled project'> · status Initiative · <'empty WBS' | '<wbs>, <acts> copied'> · <n> cost categories with <cont>% contingency · <cal> calendar · weekly data date."`

### 10.6 Create (`npCreate`, line 3969)

Closes the wizard and sets `{statusFilter:null, screen:'projects'}`, prepending to `state.projects`:
`{code: clientCode3(client)+'-'+<pid digits> (e.g. "ACM-045"), name: name or 'Untitled project', status:'Initiative', pm:'S. Perrin', client: client or '—', start:'Jan 2027', finish:'Sep 2027', budget: npTotal (k), actual:0, progress:0, spi:1, isNew:true}` and registering `PROJ_ID[code] = {id:pid, das, mt, ana}` (mutates the module constant, so the next ID increments). Template, categories, contingency, calendar and currency are not stored on the project. The new project has no `DEFS` entry → it cannot be opened (no project data) and is not in the project switcher. Wizard values are not reset after creation.

---

## 11. Force stage change dialog (`showForce`, lines 3058–3069; logic 3917–3942)

Business meaning: moving a project to the next lifecycle stage normally requires the current stage's deliverables to be complete (auto mode). Forcing allows the move with a mandatory reason, logged as "forced" and (per the text) sent to the portfolio director for validation. Cancelling a project ("Annulé") always goes through this dialog.

- Opened from the Projects screen status menu (line 3938): clicking a transition `t` from `TRANS[p.status]`: if `t==='Annulé'` or the current stage has missing deliverables → `force = {code, from:p.status, to:t, missing}`; otherwise `advance(code, t, 'auto', '')` immediately.
- Container: backdrop `z-index:55` (centred, above other dialogs); dialog `width:min(560px,100%); gap:14px`.
- Header: "Force stage change" (FR "Forcer le changement d’étape"), sub "<pname> · <from> → <to>"; close → `force.cancel`.
- "Missing deliverables" panel (when `missing.length`; FR "Livrables manquants"): bg accent-900, padding 10px 12px, radius md; `ph-warning` accent + title 13 px 500; one line per missing deliverable with `ph-square` neutral-400 (12.5 px neutral-200).
- Cancel note (when `to==='Annulé'`): "Cancelling a project stops every open request, order and task. The decision is recorded in the stage history."
- Field "Reason for forcing (required)" (FR "Motif du forçage (obligatoire)"), input placeholder "e.g. client pressure on delivery date, deliverable to follow next week"; binds `forceReason`.
- Info line (`ph-seal-check` accent): "A forced change is applied immediately and sent for validation to the portfolio director — Marie Lefebvre · Directrice de portefeuille. The history keeps the mode (auto / forced) and the reason." (the approver string is hard-coded French in both languages).
- Actions: "Cancel" → `{force:null, forceReason:''}`; "Confirm and request validation" (`btn-primary`, `ph-arrow-right`) rendered only when `forceReason.trim()` is non-empty (hidden, not disabled) → `advance(code, to, 'forced', reason)`.
- `advance` (line 3922): sets project `status:to, isNew:false`; appends `[to, '25 Sep 2026', mode, reason]` to `stageHist[code]`; resets `statusMenu`, `force`, `forceReason`. No toast; no approval workflow is modelled after confirmation.
- Auto-advance elsewhere (`toggleDeliv`, line 3923): ticking the last missing deliverable of the project's current stage moves it to the next stage with mode 'auto'.

Example: HLT-026 at "Fabrication & Assemblage" → "FAT" lists missing "Câblage & armoires terminés", "NCR majeures clôturées".

---

## 12. New resource request dialog (`nrOpen`, lines 3071–3092; logic 4146–4156)

Business meaning: a project manager asks a department head for a named person (or a contract role) for a given activity, week and duration; the request goes to that department's approval queue and only becomes a task for the person once approved.

- Opened by `openNr` (`nr.open=true`) from the primary action of `resources`, `presources`, `requests`.
- Container: backdrop `z-index:50; align-items:start; padding-top:6vh`; dialog `width:min(720px,100%); gap:14px; max-height:88vh; overflow:auto`.
- Header: "New resource request" (FR "Nouvelle demande de ressource"), static sub "Harbor Line Terminal Expansion · sent by R. Aubert" (FR "Extension du terminal Harbor Line · envoyée par R. Aubert"); close → `nr.close`.
- Fields:

| Field EN / FR | Control | Values | Default |
|---|---|---|---|
| Task / Tâche | input, placeholder "What needs doing" | `nr.title` | '' |
| Activity / Activité | chips | `NR_ACTS` (line 3283): A1250 · Steel erection — Bays 3–4; A1260 · Roof decking; A1320 · Crane delivery & rigging; A1420 · Lighting & power distribution; A1430 · Fire detection & suppression (label = `id · ALL_BYID[id].n`) | A1250 |
| Person or role / Personne ou rôle | chips | the 8 `PEOPLE` names + "Contract role" (value `'Contract structural engineer'`) | Julien Wagner |
| Week / Semaine | segmented | w/c 28 Sep (5) · w/c 5 Oct (10) · w/c 12 Oct (15) | 5 |
| Duration / Durée | segmented | 2 days (1) · 1 week (4) · 2 weeks (9) | 4 |
| Hours / Heures | input right-aligned | free text | '8' |
| Priority / Priorité | segmented | Low (low) · Medium (med) · High (high) | med |
| Note for the department head / Note pour le chef de service | input, placeholder "Why now, what it unblocks" | `nr.note` | '' |

  Week/Duration/Hours/Priority sit in a grid `repeat(auto-fit, minmax(min(100%,300px),1fr))`, gap 12. Chip style (`chips()` helper, line 4110): `padding:4px 10px; border-radius:md; font-size:12px`; selected bg accent-900 / border accent-700 / colour accent-200; unselected transparent / neutral-800 / neutral-300; hover bg neutral-900.
- Routing panel (bg neutral-900, padding 10px 12px, `ph-seal-check` accent): `"Goes to <DEPTS[dept][0]> (<dept>) for approval · " + (load known ? "<first name> is at <load>% that week" : "contract hire — no current load") + ". The task appears in the person’s list only once approved."` where `dept = DEPT_OF[person] || 'Engineering'` and `load = loadAt(person, week)` = `PEOPLE[person].weeks[clamp(floor(week/5)−1, 0, 7)]`. Example default: "Goes to Marion Kerviel (Engineering) for approval · Julien is at 90% that week. …". This sentence is not translated in FR.
- Actions: "Cancel" → close; "Send request" (`ph-paper-plane-tilt`, FR "Envoyer la demande") → `nr.send`:
  prepends to `state.requests` `{id:'RQ-0'+(45 + added count) (→ "RQ-045"), pm:'R. Aubert', project:'HLT', person, dept, title: title or 'Untitled request', act, hours: parseFloat(hours)||8, start: week, due: week+dur, prio, status:'pending', sent: dayLabel(TODAY) ("Fri 25 Sep"), note, response:'', propStart:null, propDue:null, todoId:null}`; closes, clears `title`/`note` (other fields kept), sets `reqFilter:null` and navigates to `requests`. No validation, no toast.

`DEPTS` (line 3268): Engineering → Marion Kerviel (Head of engineering); Site operations → Olivier Blanc (Site operations manager); MEP → Sophie Renard (Head of MEP); Quality → Gabriel Comte (Quality manager); Controls & planning → Ines Duarte (Head of project controls). `DEPT_OF` (line 3269) maps the 8 people to departments.

---

## 13. Internationalisation (FR / EN)

### 13.1 Model

- Authoring language is English; French is produced at render time. Default `state.lang = 'fr'`.
- Static template strings: `TPL_KEYS` (line 3751, 1059 strings; the template uses `{{ T.kN }}`, 1013 distinct keys, 1358 occurrences). `renderVals` builds `T = {kN: fixEnt(lang==='fr' ? trFR(TPL_KEYS[N]) : TPL_KEYS[N])}`; `fixEnt` decodes `&nbsp;` → U+00A0 and `&amp;` → `&` (some keys contain `&nbsp;`).
- Dynamic values: when `lang==='fr'`, the whole object returned by `renderValsEN()` is passed through `deepTr(v)` (line 3758): recursion depth ≤ 8 over arrays and plain objects; every string is passed to `trFR`; values under keys in `SKIP_KEYS` are left untouched; functions/refs untouched.
- `SKIP_KEYS` (line 3757, 82 keys): icon, bg, color, shadow, bl, border, fg, bar, d, pv, ev, ac, fc, evArea, tagClass, cursor, pad, h, left, width, x, y, ty, tx, slotId, key, id, ref, code, no, initials, refColor, idColor, noColor, nameColor, barBg, barEdge, fillBg, edge, dot, ring, aW, bW, aL, bL, cL, dW, fL, cW, todayL, planH, actH, spiColor, cpiColor, varColor, slipColor, availColor, avgColor, restrColor, recvColor, expColor, riskColor, aColor, bColor, w, ext, dates, act, mfrRef, path, hs, unit, total, price, delta, rev, qty, recv, base, q, hours, caret.

### 13.2 Translation functions (lines 3752–3756)

- `FR_DICT` (line 3752; 2786 entries; also exported as `_extracted/fr_dict.json`): exact English → French.
- `FR_RULES` (line 3754; 284 `[RegExp, replacement]` pairs), e.g. `/^(\d+) active projects$/ → '$1 projets actifs'`, `/^(\d+) of (\d+)$/ → '$1 sur $2'`, `/^data date (.+)$/ → 'date d’état $1'`.
- `FR_MONTHS` (line 3753): Jan→janv., Feb→févr., Mar→mars, Apr→avr., May→mai, Jun→juin, Jul→juil., Aug→août, Sep→sept., Oct→oct., Nov→nov., Dec→déc. `FR_DAYS`: Mon→lun., Tue→mar., Wed→mer., Thu→jeu., Fri→ven., Sat→sam., Sun→dim., Monday…Sunday → lundi…dimanche, Yesterday→Hier.
- `frSeg(s)`: dictionary hit → return; else apply the **first** matching rule; then replace month and day abbreviations (word boundaries), `Today`→`Aujourd’hui`, `today`→`aujourd’hui`, `yesterday`→`hier`.
- `trFR(s)`: non-string/empty → as is; dictionary hit → return; only digits/spaces/`.,%€$+−–-` → as is; if an anchored rule (not starting with `^(.+)`) matches and `s` contains ` · ` or ` — ` → `frSeg(s)` on the whole string; else split on separators ` · `, ` — `, ` → `, ` / ` (kept) and `frSeg` each segment; else `frSeg(s)`.

### 13.3 Explicit language branches in logic

| Line | Where | Behaviour |
|---|---|---|
| 3775 | `money()` | FR + EUR → "4,80 M€" / "123 k€" (see §14) |
| 3932 | Projects `pvExtra.attention` | each fragment through `frSeg` |
| 4177 | `money$` | FR → `toLocaleString('fr-FR') + ' €'`; EN → `'€' + toLocaleString('en-US')` |
| 4852 | meeting minutes toast | hard-coded FR sentence |
| 4883, 4887, 4899 | contract/billing KPI subs | inline FR/EN strings |
| 5073 | world map | `mapT = trFR` for strings passed to the map iframe hash |
| 5116 | `showToast` | per-segment `frSeg` |
| 5169–5170 | sidebar page search | FR label matching and FR section names |

### 13.4 Known gaps / anomalies (observed when rendering FR)

- Untranslated in FR: wizard step "Basics", "Activities & logic", "Calendars", "Not copied", "Define in step 3", "Start from nothing", "24h continuous", "`n` categories", "copied … cost categories with …% contingency … calendar · weekly data date." (summary tail), "Contract role", "Untitled request", the NR routing sentence, primary actions "Team capacity" and "Log time", several `AF_RESULT` toasts (e.g. "Meeting created · invitation synced to the calendar", "SAT planned · …", "Lesson recorded · …", "Lucca hours imported · …", "ECO opened · in approval", "Status report generated · PDF ready", "Connector added · …", "27 tags imported · …", "Lucca synchronised · …", "Vault synchronised · …"), "Nothing waiting for you", "Action due".
- Mistranslations: "1 week" → "1 semaines"; AF labels "Time" → "Temps", "Location" → "Emplacement", "Issue" → "Sortie", submit "Register" → "Registre", "Record" → "Fiche", "Import" → "Import", "Unit" → "Unitaire"; department names inside "Approvals — Engineering" stay English.
- Mixed language by design: lifecycle stages (`STATUSES`), stage deliverables (`STAGE_DELIVS`), gates (`GATES`, `LIFE`), `NP_TEMPLATES` and stage-history mode labels ("Forcé"/"Auto") are authored in French and appear in French in EN mode too. The Force dialog approver text is French in EN mode.
- `<select>` options in the add-form dialog are translated as values (option `v` is not in `SKIP_KEYS`): in FR, a user-picked option stores the French string, which breaks English comparisons in `afSubmit` (e.g. `critical==='Yes'`, `type==='Scope + budget'`). Untouched selects fall back to the English first option. The rebuild must separate option value from label.

### 13.5 Key FR equivalents (headings and statuses)

| EN | FR |
|---|---|
| Portfolio · Project · Technical reference · Purchasing & stock · Warranty & after-sales · Resources · Administration | Portefeuille · Projet · Référentiel technique · Achats & stock · Garantie & SAV · Ressources · Administration |
| Contract · Steering · Team & exchanges · Project engineering · Control · Site & handover · Project review | Contrat · Pilotage · Équipe & échanges · Ingénierie projet · Maîtrise · Chantier & transfert · Bilan |
| My work · Documents · Outside my workspace · Read-only · Current project | Mon travail · Documents · Hors de mon périmètre · Consultation · Projet courant |
| On track · At risk · Off track | Conforme · À risque · Hors trajectoire |
| Request statuses: Pending review · Approved · assigned · Reschedule proposed · Rejected · Withdrawn | Pending review (untranslated) · Approuvée · assigned · Replanification proposée · Refusé · Withdrawn (untranslated) |
| Lifecycle (`STATUSES`, line 3136): Initiative · APS · APD · Etudes · Approvisionnements · Fabrication & Assemblage · FAT · Expédition · Chantier · Mise Service & SAT · Garantie · Clos · Annulé | same, with FR display fixes: Etudes → Études, Mise Service & SAT → Mise en service & SAT |

---

## 14. Formatting helpers and constants

| Helper (line) | Definition | Examples |
|---|---|---|
| `money(k, signed)` (3775) → bound as `f` | amounts are in **thousands**. `sign = k<0 ? '−' (U+2212) : (signed && k>0 ? '+' : '')`. If `lang==='fr'` and currency EUR: `≥1000` → `sign + (a/1000).toFixed(2) with ',' + ' M€'`, else `sign + round(a) + ' k€'`. Otherwise (EN, or USD in any language): `sign + symbol + (a/1000).toFixed(2) + 'M'` or `sign + symbol + round(a) + 'k'`, symbol `€`/`$` from `props.currency` | `f(4800)` → "€4.80M" / FR "4,80 M€"; `f(-27,true)` → "−€27k" / "−27 k€"; `f(160,true)` → "+€160k" / "+160 k€"; USD+FR `f(85,true)` → "+$85k" |
| `money$(v)` (4177) | full euros: FR `Math.round(v).toLocaleString('fr-FR') + ' €'`; EN `'€' + Math.round(v).toLocaleString('en-US')` (always €) | "€4,700" / "4 700 €" |
| `pct(v)` (3133) | `(round(v*1000)/10) + '%'` (one decimal), mostly for CSS widths | `pct(.6438)` → "64.4%" |
| `MO` (3096) | `['Jan',…,'Dec']` | — |
| `dateOf(m)` (3134) | `m` = months since 1 Jan 2026 (float); year 2027 if `m ≥ 12`; month `floor(m%12)`; day `max(1, round(frac×30))`; suffix " ’27" for 2027 | `dateOf(12.45)` → "14 Jan ’27" |
| `monthDate(m)` (3303) | `new Date(2026+floor(m/12), m mod 12, 1+round(frac×27))` | — |
| `fmtD(dt)` (3304) | `"<d> <Mon>"` + " ’27" if year > 2026 | "5 Oct" |
| `fmtDY(dt)` (3305) | `"<d> <Mon> <yyyy>"` | "5 Oct 2026" |
| `monthLabels(start,n)` (3306) | month abbreviations; January of 2027 gets " ’27" | — |
| `mIdx(str)` (3672) | parses "Dec 2026" / "14 Jan 2027" into the month index (`(y−2026)×12 + m + (d−1)/30`); '—' → null | "Dec 2026" → 11 |
| `wbsParseDate(s)` (3761) | "5 Oct 2026" / "5 Oct" → `Date` (default year 2026) or null | — |
| `wbsFmtDate(d)` (3762) | zero-padded day + month + " ’yy" if year ≠ 2026 | "05 Oct", "14 Jan ’27" |
| `TODAY` (3265) | `4` = working-day offset from Mon 21 Sep 2026 | Fri 25 Sep 2026 |
| `dayDate(o)` (3266) | `new Date(2026, 8, 21 + floor(o/5)×7 + o%5)` (5 working days per week) | `dayDate(5)` → Mon 28 Sep |
| `dayLabel(o)` (3267) | `"<Ddd> <d> <Mon>"` | "Fri 25 Sep" |
| `statusDate` | hard-coded `'25 Sep 2026'` | — |
| `LO` / `OK` (3135) | `var(--color-accent-300)` (attention colour) / `var(--color-text)` | — |
| `pidOf(code)`, `pname(code,name)` (3144–3145) | `PROJ_ID[code].id` or code; `pidOf(code) + ' · ' + name` | "#026 · Harbor Line Terminal Expansion"; EXTRA projects without PROJ_ID show their code, e.g. "EWA-051 · …" |
| `initials(n)` | first letters of each word | "ML" |

---

## 15. Complete screen inventory

Legend — Roles: DIR director, PM project manager, DH department head, MEM member, EL engineering lead, QM quality manager, PRO procurement, CLI client. "Start" = available as `startScreen` prop value. "Proj" = project-scoped (project switcher shown, `showProjectPicker`). "Zone" = zone bar shown. Line ranges are the top-level `<sc-if>` blocks in the template.

| Screen id | Flag (template lines) | Nav location | Nav label EN / FR · icon | Page title EN / FR | Roles | Start | Proj | Zone | Primary action |
|---|---|---|---|---|---|---|---|---|---|
| home | `isHome` (163–194) | fixed | Home / Accueil · `ph-house` | Home / Accueil | all | Y | – | – | New project (DIR, PM) |
| myprojects | `isMyProjects` (196–213) | fixed | My projects / Mes projets · `ph-folder-user` | My projects / Mes projets | all but CLI | Y | – | – | – |
| client | `isClient` (2180–2235) | fixed (client role only) | My project / Mon projet · `ph-buildings` | My project — client view / Mon projet — vue client | CLI (DIR allowed but no nav entry) | – | Y | – | Download status report |
| mywork | `isMyWork` (2813–2900) | fixed | My tasks / Mes tâches · `ph-check-square` | My work / Mon travail | DIR, MEM | Y | – | – | Log time |
| task | `isTask` (2902–2969) | none (highlights My tasks) | — | task title (e.g. "Survey verticality — Bay 3 columns") | DIR, MEM | Y | – | – | Mark done |
| myapprovals | `isMyApprovals` (1715–1735) | fixed | My approvals / Mes approbations · `ph-stamp` | My approvals / Mes approbations | all but MEM | Y | – | – | – |
| docs | `isDocs` (2310–2344); overlays `showDoc` (2346–2362), `depOpen` (2363–2374) | fixed | Documents · Codex · `ph-books` | Documents — Codex index / Documents — index Codex | all | – | Y | – | Deposit in Codex |
| overview | `isOverview` (237–284) | Portfolio | Overview / Vue d’ensemble · `ph-squares-four` | Portfolio overview / Vue d’ensemble du portefeuille | DIR, PM, DH | Y | – | Y | New project |
| projects | `isProjects` (638–749) | Portfolio | Projects / Projets · `ph-folders` | Projects / Projets | DIR, PM | Y | – | Y | New project |
| pfplan | `isPfPlan` (972–1023) | Portfolio | Schedule / Planning · `ph-chart-bar-horizontal` | Portfolio schedule — projects in progress & pipeline / Planning du portefeuille — projets en cours & pipe | DIR, PM | – | – | Y | – |
| worldmap | `isWorldMap` (215–235) | Portfolio | Projects map / Mappemonde des projets · `ph-globe-hemisphere-west` | Projects map / Mappemonde des projets | DIR, PM, DH | Y | – | Y | – |
| portfolio | `isPortfolio` (2079–2141) | Portfolio | Prioritisation / Priorisation · `ph-strategy` | Portfolio — prioritisation & capacity / Portefeuille — priorisation & capacité | DIR, PM | – | – | Y | Score a proposal |
| cash | `isCash` (2143–2178) | Portfolio | Cash flow / Trésorerie · `ph-coins` | Cash flow & billing — next 6 months / Trésorerie & facturation — 6 prochains mois | DIR, PM | – | – | Y | – |
| contract | `isContract` (814–839) | Project › Contract | Contract / Contrat · `ph-file-text` | Contract / Contrat | DIR, PM, PRO | – | Y | – | Add amendment |
| billing | `isBilling` (841–868) | Project › Contract | Billing / Facturation · `ph-receipt` | Billing & payments / Facturation & encaissements | DIR, PM | – | Y | – | Issue invoice |
| plan | `isPlan` (1024–1165) | Project › Steering | Plan — WBS · `ph-tree-structure` | Plan — WBS & activities / Plan — WBS et activités | DIR, PM, EL, QM | Y | Y | – | Update progress / Add activity |
| schedule | `isSchedule` (485–571) | Project › Steering | Schedule / Planning · `ph-calendar-dots` | Schedule / Planning | DIR, PM | Y | Y | – | Re-baseline |
| budget | `isBudget` (286–483) | Project › Steering | Budget & cost / Budget et coûts · `ph-chart-line-up` | Budget & cost / Budget et coûts | DIR, PM | Y | Y | – | Change request |
| hours | `isHours` (932–946) | Project › Steering | Hours (Lucca) / Heures (Lucca) · `ph-clock-countdown` | Hours — Lucca reconciliation / Heures — rapprochement Lucca | DIR, PM, DH | – | Y | – | Import Lucca |
| contingency | `isContingency` (900–908) | Project › Steering | Contingency / Provision pour aléas · `ph-piggy-bank` | Contingency register / Registre de la provision pour aléas | DIR, PM | – | Y | – | Draw-down |
| presources | `isResources` + `isPResources` (573–637) | Project › Steering | Project resources / Ressources du projet · `ph-user-list` | Project resources / Ressources du projet | DIR, PM | Y | Y | – | Request resource |
| meetings | `isMeetings` (753–812) | Project › Team & exchanges | Meetings & minutes / Réunions & CR · `ph-chats-circle` | Meetings & minutes / Réunions & CR | all | – | Y | – | New meeting |
| stakeholders | `isStakeholders` (870–878) | Project › Team & exchanges | Stakeholders & RACI / Parties prenantes & RACI · `ph-users-four` | Stakeholders & RACI | DIR, PM | – | Y | – | Add stakeholder |
| interfaces | `isInterfaces` (893–898) | Project › Team & exchanges | Interfaces · `ph-arrows-left-right` | Interface register / Registre des interfaces | DIR, PM, EL | – | Y | – | New interface |
| eng | `isEng` (2384–2416); overlay `engImpOpen` (2452–2471) | Project › Project engineering | Synthesis / Synthèse · `ph-squares-four` | Engineering synthesis / Synthèse ingénierie | DIR, PM, EL, QM | – | Y | – | Import a list |
| eng-process | `isEngDisc` (2418–2451) | Project › Project engineering | Process · `ph-flow-arrow` | Process engineering / Ingénierie process | DIR, PM, EL, QM | – | Y | – | Import a list |
| eng-meca | `isEngDisc` (2418–2451) | Project › Project engineering | Mechanical / Mécanique · `ph-gear` | Mechanical engineering / Ingénierie mécanique | DIR, PM, EL, QM | – | Y | – | Import a list |
| eng-elec | `isEngDisc` (2418–2451) | Project › Project engineering | Electrical / Électricité · `ph-lightning` | Electrical engineering / Ingénierie électrique | DIR, PM, EL, QM | – | Y | – | Import a list |
| eng-auto | `isEngDisc` (2418–2451) | Project › Project engineering | Automation / Automatisme · `ph-cpu` | Automation engineering / Ingénierie automatisme | DIR, PM, EL, QM | – | Y | – | Import a list |
| pid | `isPid` (2472–2533) | Project › Project engineering | P&ID validation / Validation P&ID · `ph-flow-arrow` | P&ID — tags, overlay & process validation / PID — tags, surcouche et validation du process | DIR, EL, QM | Y | Y | – | Import P&ID tags |
| bom | `isBom` (1167–1310); overlay `showPartDetail` (2582–2613) | Project › Project engineering | Project BOM / Nomenclature projet · `ph-cube` | Project BOM — equipment & parts / Nomenclature projet — équipements et articles | DIR, PM, EL, QM, PRO | Y | Y | – | Add article |
| risks | `isRisks` (1771–1831) | Project › Control | Risk register / Registre des risques · `ph-shield-warning` | Risk register / Registre des risques | DIR, PM, QM | Y | Y | – | New risk |
| changes | `isChanges` (1833–1881) | Project › Control | Change control / Contrôle des modifications · `ph-git-pull-request` | Change control & baselines / Contrôle des modifications et références | DIR, PM, CLI | Y | Y | – | New change request |
| quality | `isQuality` (1883–1970) | Project › Control | Quality & deliverables / Qualité et livrables · `ph-seal-check` | Quality — NCR & deliverables / Qualité — NCR et livrables | DIR, PM, EL, QM, CLI | Y | Y | – | New NCR |
| itp | `isItp` (880–891) | Project › Control | Inspections & punch list / Inspections & réserves · `ph-clipboard-text` | Inspection & test plan · punch list / Plan d’inspection et d’essais · réserves | DIR, PM, EL, QM, CLI | – | Y | – | Add inspection / Add punch item |
| site | `isSite` (2268–2306) | Project › Site & handover | Site (chantier) / Chantier · `ph-hard-hat` | Site — readiness, mobilisation & execution / Chantier — préparation, mobilisation et exécution | DIR, PM, DH, MEM | Y | Y | – | Daily report |
| commissioning | `isCommissioning` (910–919) | Project › Site & handover | Commissioning & handover / Mise en service & transfert · `ph-key` | Commissioning & handover dossier / Mise en service & dossier de transfert | DIR, PM, EL, QM, CLI | – | Y | – | Plan SAT |
| trends | `isTrends` (1737–1769) | Project › Project review | Trends & status / Tendances et état · `ph-chart-line` | Trends & status report / Tendances et rapport d’état | DIR, PM, CLI | Y | Y | – | Generate status report |
| rex | `isRex` (921–930) | Project › Project review | Lessons learned & closure / REX & clôture · `ph-graduation-cap` | Lessons learned & project closure / Retours d’expérience & clôture du projet | DIR, PM, EL, QM | – | Y | – | Add lesson |
| plm | `isPlm` (2535–2580); overlay `showPartDetail` | Technical reference | Parts (PLM) / Articles (PLM) · `ph-database` | PLM — parts catalogue / PLM — catalogue articles | DIR, PM, EL, QM, PRO | Y | – | – | New part |
| eco | `isEco` (1312–1375) | Technical reference | Change orders (ECO) / Ordres de modification (ECO) · `ph-git-branch` | Engineering change orders / Ordres de modification (ECO) | DIR, PM, EL, QM, PRO | Y | – | – | New ECO |
| drawings | `isDrawings` (1377–1418) | Technical reference | Drawings / Plans · `ph-blueprint` | Drawings — PDM vault / Plans — coffre PDM | DIR, PM, EL, QM | Y | – | – | Sync vault |
| procurement | `isProcurement` (1972–2077) | Purchasing & stock | Sourcing & invoices / Consultations et factures · `ph-handshake` | Sourcing, invoices & suppliers / Consultations, factures et fournisseurs | DIR, PM, PRO | Y | – | – | New RFQ |
| orders | `isOrders` (2615–2687) | Purchasing & stock | Purchase orders / Commandes d’achat · `ph-shopping-cart` | Purchase orders / Commandes d’achat | DIR, PM, PRO | Y | Y | – | New purchase order (if shortfall) |
| deliveries | `isDeliveries` (1598–1656) | Purchasing & stock | Deliveries / Livraisons · `ph-truck` | Deliveries & goods receipt / Livraisons et réceptions | DIR, PM, QM, PRO | Y | Y | – | Announce a delivery |
| stock | `isStock` (1658–1713) | Purchasing & stock | Stock & storages / Stock et magasins · `ph-warehouse` | Stock & storages / Stock et magasins | DIR, PM, QM, PRO | Y | – | – | Import from X3 |
| fleet | `isFleet` (948–954) | Warranty & after-sales | Installed base / Parc installé · `ph-crane-tower` | Installed base / Parc installé | DIR, PM, QM, PRO | – | – | Y | Add machine |
| sav | `isSav` (956–971) | Warranty & after-sales | Warranty claims & interventions / Réclamations & interventions · `ph-wrench` | Warranty claims & interventions / Réclamations & interventions | DIR, PM, QM, PRO | – | – | Y | New claim |
| resources | `isResources` (573–637) | Resources | Resources / Ressources · `ph-users-three` | Resources / Ressources | DIR, DH, PRO | Y | – | – | Request resource |
| requests | `isRequests` (2689–2729) | Resources | Resource requests / Demandes de ressources · `ph-paper-plane-tilt` | Resource requests / Demandes de ressources | DIR, PM, DH, EL | Y | – | – | New request |
| approvals | `isApprovals` (2731–2811) | Resources | Approvals / Approbations · `ph-seal-check` | Approvals — `<department>` / Approbations — `<department>` | DIR, DH, QM | Y | – | – | Team capacity |
| whatif | `isWhatif` (1504–1527) | Resources | What-if levelling / Lissage what-if · `ph-scales` | What-if levelling / Lissage what-if | DIR, PM, DH | Y | – | – | New scenario |
| skills | `isSkills` (1451–1475) | Resources | Skills matrix / Matrice de compétences · `ph-certificate` | Skills matrix / Matrice de compétences | DIR, PM, DH, MEM, EL | Y | – | – | Add skill |
| leave | `isLeave` (1477–1502) | Resources | Leave & calendar / Congés et calendrier · `ph-calendar-check` | Leave & working calendar / Congés et calendrier de travail | all but CLI | Y | – | – | Sync Lucca |
| rates | `isRates` (1420–1449) | Resources | Rate cards / Grilles de taux · `ph-currency-eur` | Rate cards / Grilles de taux | DIR, PM | Y | – | – | Add role |
| settings | `isSettings` (1573–1596) | Administration | Settings / Paramètres · `ph-gear-six` | Settings — personalisable lists / Paramètres — listes personnalisables | DIR, PM, DH, EL, QM, PRO | Y | – | – | Reset to defaults |
| mtypes | `isMtypes` (1529–1571) | Administration | Machine types / Types de machines · `ph-cube` | Standard machine types / Types de machines standard | DIR, PM, EL, QM | – | – | – | New machine type |
| doctypes | `isDocTypes` (2375–2383) | Administration | Document types register (Codex) / Registre des types de documents (Codex) · `ph-list-checks` | Document types register (Codex) | DIR, PM, QM | – | – | – | – |
| plumbing | `isPlumbing` (2237–2266) | Administration | Activity & integrations / Activité et intégrations · `ph-plugs-connected` | Activity, integrations & audit / Activité, intégrations et audit | DIR, PM | – | – | – | Add connector |

Totals: 58 navigable screen ids + `task`. The startScreen list (34 ids) does not include: client, docs, pfplan, portfolio, cash, contract, billing, hours, contingency, meetings, stakeholders, interfaces, eng, eng-*, itp, commissioning, rex, fleet, sav, mtypes, doctypes, plumbing.

Purpose one-liners (details in the module specs): Home = role landing page; My projects = projects of the current persona; Projects map = world map of project sites (iframe `Keystone PM map.html`); Overview = portfolio KPIs/health; Projects = lifecycle register with stage cursor and stage changes; Portfolio schedule = Gantt of in-progress and pipeline projects; Prioritisation = proposal scoring and capacity; Cash flow = 6-month cash and billing; Contract/Billing = contract, amendments, bonds, payment milestones, invoices; Plan = WBS & activities with progress; Schedule = Gantt/milestones/SPI; Budget = EVM (PV/EV/AC/CPI/EAC), structure & changes, cash recovery; Hours = Lucca timesheet reconciliation; Contingency = reserve draw-downs; Project resources = project team load; Meetings = meetings, minutes, decisions, actions; Stakeholders = stakeholder register and RACI; Interfaces = interface register; Engineering = cross-discipline consistency checks and imports; P&ID = tag validation overlay; BOM = project bill of materials and spares; Risks = 5×5 register with EMV; Changes = change requests and baselines; Quality = NCRs and deliverables; ITP = inspection & test plan and punch list; Site = mobilisation readiness (GO / NO GO), team, execution; Commissioning = SAT and handover dossier; Trends = weekly snapshots and status report; REX = lessons learned and closure; PLM/ECO/Drawings = technical reference data; Sourcing/Orders/Deliveries/Stock = purchasing chain (Sage X3); Installed base/Warranty = after-sales; Resources/Requests/Approvals/What-if/Skills/Leave/Rates = resource management; Settings/Machine types/Document types/Activity & integrations = administration; My work/Task/My approvals = personal inbox.

---

## Data entities

| Entity | Fields (type · example) | Source constant / state | Relations |
|---|---|---|---|
| Persona | key (`'director'`…), name (string · "Marie Lefebvre"), roleLabel (string · "Portfolio director"), initials (derived · "ML") | `PERSONAS` (3747) | allowed screens via `ROLE_SCREENS[key]` |
| RoleScreens | roleKey → `string[] \| null` (null = all) | `ROLE_SCREENS` (3465–3466) | screen ids |
| NavItem | id (screen id), label (string), icon (Phosphor class), badge (string · "" / "3" / "!" / "NO GO"), bg/color (active styling), groupLabel/groupKey (string), visible/hidden (bool), onClick | built in `navs` (5145–5155) | belongs to a NavSection or fixed list |
| NavSection | key (`portfolio`/`project`/`tech`/`stock`/`sav`/`res`/`admin`/`outside`), label, sub (string), items (NavItem[]), open (bool), chev, badge, count, color, toggle | `buildSecs` (5160), `navSections` (5166) | — |
| NavOpenState | `{[sectionKey]: bool, ['sub:'+groupLabel]: bool}` | `state.navOpen`, localStorage `keystone-nav-open` | — |
| Project (portfolio) | code (string · "HLT-026"), name ("Harbor Line Terminal Expansion"), status (lifecycle stage · "Fabrication & Assemblage"), pm ("R. Aubert"), client ("Port authority"), start ("Jan 2026"), finish ("Dec 2026"), budget (number k€ · 4800), actual (k€ · 3360), progress (0–1 · .64), spi (number · .90), isNew (bool, wizard-created) | `state.projects` ← `initialProjects()` (3163) from `PROJECTS`, `META`, `STAGE_OF`, `EXTRA`, `STATUS_MAP_OLD` | PROJ_ID, DEFS (project data), GEO (zone) |
| ProjectIdentity | id ("#026"), das ("2"), mt (machine type · "EMP"), ana (analytic code · "HAV004") | `PROJ_ID` (3168; mutated by wizard) | keyed by project code |
| Zone | key ("euna"), label ("Europe & North America"), manager ("Olivier Castel") | `ZONES` (3170), `ZONE_BOUNDS`, `COUNTRY_ZONE`, `GEO` | projects via `zoneOf(code)` |
| Notification | id ("n1"), kind (approval/alert/quality/delivery/eco/mention/request/invoice/task/sync), title, sub, when ("25 Sep 09:12"), read (bool), screen (target id), extra (state patch object), audience (role keys[]) | `NOTIFS` (3545), `NOTIF_ICON` (3556), `state.readNotifs` | target screen |
| ActivityLogEntry | when, who, what, kind | `ACTIVITY` (3557) | plumbing screen |
| SearchHit | kind, title, sub, target screen + state patch | `searchHits` (4695) | many entities |
| AddFormDef | key, title, kind (`create`/`run`), submit, fields: `[id, label, type: text/number/textarea/select, default \| options[] \| token, required?]` | `AF` (3674–3700), `AF_RESULT` (3701), `AF_DYN` (5112) | writes `state.added.*` |
| AddedRecords | buckets: risks, crs, ncrs, meetings, stakeholders, itp, punch, interfaces, draws, fleet, claims, lessons, milestones, amendments, bonds, wps, acts, mtypes (each record has `proj`) | `state.added` | consumed by module screens |
| NewProjectDraft | open, step (1–4), name, client, das ('1'–'4'), mt (EMP/MEMU/SPUR/AUTRE/R&D), cur (USD/EUR), template (id), cats ([{name, type, budget: string}]), cont (5/10/15), cal (string), code (unused) | `state.np` | NP_TEMPLATES |
| NpTemplate | id, mt, name, desc, wbs, acts, cal, phases (string[]), cats ([name, type, budget][]) | `NP_TEMPLATES` (3179) | machine type |
| ForceRequest | code, from (stage), to (stage), missing (deliverable labels[]) + reason (`state.forceReason`) | `state.force` | STAGE_DELIVS, TRANS |
| StageHistoryEntry | [stage, date ("25 Sep 2026"), mode ('auto'/'forced'), reason] | `state.stageHist[code]` ← `STAGE_HISTORY` (3142) | project |
| StageDeliverables | `{[code]: {[stage]: (0/1)[]}}` | `state.stageDone` ← `STAGE_DONE_DEFAULT` (3141); labels `STAGE_DELIVS` (3140) | project, stage |
| ResourceRequestDraft | open, title, act (activity id), person, hours (string), week (5/10/15), dur (1/4/9), prio (low/med/high), note | `state.nr` | NR_ACTS, PEOPLE |
| ResourceRequest | id ("RQ-044"), pm ("R. Aubert"), project ("HLT"), person, dept, title, act, hours (number), start (day offset), due (day offset), prio, status (pending/approved/reschedule/rejected/withdrawn), sent ("Fri 25 Sep"), note, response, propStart, propDue, todoId | `state.requests` ← `REQUESTS` (3270), `REQ_STATUS` (3282) | DEPTS, DEPT_OF, PEOPLE |
| Department | name → [head name, head role] | `DEPTS` (3268), `DEPT_OF` (3269) | requests, approvals |
| i18n | TPL_KEYS (string[1059]), FR_DICT (Record<string,string>, 2786), FR_RULES ([RegExp, string][], 284), FR_MONTHS, FR_DAYS, SKIP_KEYS (Set, 82) | 3751–3757 | all strings |
| AppProps | currency ('EUR'/'USD'), showBaseline (bool), startScreen (screen id) | `data-props` (3095) | — |

---

## Status machines / workflows

1. **Project lifecycle (`STATUSES`, `STAGE_ORDER`, `TRANS`, `GATES`, `STAGE_DELIVS`)**
   Initiative → APS → APD → Etudes → Approvisionnements → Fabrication & Assemblage → FAT → Expédition → Chantier → Mise Service & SAT → Garantie → Clos; any stage except Clos/Annulé → Annulé. Pipeline stages: Initiative/APS/APD; execution stages: Etudes…Mise Service & SAT.
   - Auto advance: all deliverables of the current stage ticked (`toggleDeliv`) or transition chosen with nothing missing → history mode `auto`.
   - Forced advance: transition chosen with missing deliverables, or any move to Annulé → Force dialog → reason required → history mode `forced` ("Forcé"). Validation by the portfolio director is announced but not modelled.
   - New projects (wizard) start at Initiative with `isNew:true`; `isNew` cleared on first `advance`.
2. **New project wizard**: step 1 Basics → 2 Structure → 3 Budget → 4 Schedule → Create; Back allowed from 2–4; close at any step keeps the draft.
3. **Resource request**: created `pending` by the NR dialog → (department head in Approvals) `approved` / `reschedule` / `rejected`; `withdrawn` also exists (`REQ_STATUS`). Owned by the resources module.
4. **Add-form dialog**: closed → open (values seeded) → valid/invalid (required fields) → submit (side effect + toast) or cancel.
5. **Notification**: unread → read (open row or "Mark all read"); read state is session-only.
6. **Access modes**: in-workspace → outside (screen not in `ROLE_SCREENS[role]`) → read-only banner, no primary action. Project read-only (pm/client on another project's screen) → "Read-only" tag, no primary action.
7. **Nav collapse**: section/group open ↔ closed, persisted in localStorage.
8. **Toast**: hidden → shown (4 s auto-hide or manual close; replaced by a newer toast).

---

## Cross-links

| From | To | Mechanism |
|---|---|---|
| Sidebar / page search | every screen | `setState({screen})` |
| Role menu | Home | `{role, screen:'home'}` |
| Project switcher | current screen with new project | `{project}` |
| Outside banner "Home" | Home | `go('home')` |
| Notifications n1–n10 | changes (CR-008), trends, quality (NCR-029), deliveries (BL-2026-0533), eco (ECO-2026-015), plan (A1250 drawer), requests, procurement (invoice INV-HC-7781), mywork, leave | §5.5 |
| Global search | plan (project / activity drawer), plm (part), resources, orders (PO), eco, changes (CR), quality (NCR), risks, drawings | §5.4 |
| Map iframe (`worldmap`) | plan (project with data) or projects (filtered by code) | `postMessage` `keystone-map` |
| Primary actions | AF dialog; New project wizard (home/overview/projects); NR dialog (resources/presources/requests); docs deposit; engineering import; budget "setup" tab; approvals → resources; mywork → task | §5.9 |
| New project wizard | Projects (new row at top, status Initiative) | `npCreate` |
| NR dialog | Resource requests (new pending row) | `nr.send` |
| Projects status menu | Force dialog | `state.force` |
| Contract milestone row | AF `billing` with milestone preselected | `afOpenWith('billing',{ms})` |
| Plan WBS row | AF `plan` with work package preselected | `afOpenWith('plan',{wp})` |
| Contract screen buttons | AF `amendment`, `bond`, `milestone` | `addAmendment`, `addBond`, `addMilestone` |
| Plan screen | AF `wp` | `addWp` |

Specs of the target screens: see the module spec files in `docs/spec/` (e.g. 06 resources/HR, 07 risk/change/quality/ops).

---

## Open questions

1. **Default language**: the prototype starts in French (`lang:'fr'`) while the source is authored in English. Which is the product default, and should the choice be persisted per user?
2. **URL routing**: the prototype has none (state only). Confirm the route scheme (e.g. project-scoped routes for the 30 `showProjectPicker` screens) and deep-link behaviour for notifications.
3. **Export button** (line 122) has no behaviour. What does Export do per screen (PDF, Excel, CSV)?
4. **Mobile / narrow layouts**: no responsive rules (fixed 232 px sidebar). Is a collapsible sidebar / mobile layout required?
5. **Status date** is hard-coded "25 Sep 2026" and `TODAY` is fixed. Should the status (data) date be the project's weekly data date (Fridays) and be selectable?
6. **Role gating vs. reachability**: gating only hides nav entries; notifications, search and cross-links can open screens outside the workspace in a "read-only" mode, but most screens do not actually enforce read-only (only the primary button is hidden). Should outside screens be blocked, or fully read-only?
7. **Project read-only scope** only applies to pm and client (others see all projects as editable). Confirm the ownership rules for englead, quality, procurement, depthead and member (their `isMineP` matches no project).
8. **Director and the `client` screen**: allowed by `ROLE_SCREENS` (null) but has no nav entry for non-client roles. Should the director be able to preview the client view?
9. **New project wizard**: Project manager, Planned start/finish, cost-category Type, Progress cycle, Baseline policy, Working time and Holidays are static, non-interactive placeholders; created projects always get pm "S. Perrin", start "Jan 2027", finish "Sep 2027". Which of these must be editable and stored? Is currency stored on the project? Should name/client be required? Should the template's WBS/activities actually be generated (the new project has no project data and cannot be opened)?
10. **Baseline policy text** "Set BL1 at Planning → Active" references the old status model (`STATUS_MAP_OLD`); with the French lifecycle, at which stage is BL1 set (APD per `STAGE_DELIVS`)?
11. **Holidays** text differs between EN ("US federal + site shutdown…") and FR ("Fériés France + fermeture chantier…"). Which holiday calendar applies?
12. **Force stage change**: what is the validation workflow after "Confirm and request validation" (approve/reject by the portfolio director, revert on rejection)? Should the approver be dynamic?
13. **New resource request**: subtitle and requester are hard-coded (HLT, R. Aubert). Should the request use the current project and current user? Should Task title and Hours be required?
14. **Add-form dialog subtitle** always shows the current project name, even for non-project forms (rates, skills, plumbing, mtype, leave, drawings, portfolio). Intended?
15. **Change request form** collects a Justification (`why`) that is not stored. Should it be?
16. **Select values in FR**: option values are translated (see §13.4). The rebuild should use stable codes; confirm the code lists (types, severities, responses, etc.).
17. **Untranslated / mistranslated strings** listed in §13.4 need FR wording, and EN labels are needed for French-authored lifecycle stages, deliverables, gates and NP templates if EN mode is kept.
18. **Search scope**: project-specific hits (POs, CRs, NCRs, risks) only cover the current project; Project hits for projects without data navigate to the Plan of the current project. Should search be portfolio-wide and open the hit's own project?
19. **Notifications**: read state is session-only and the "e-mail digest / Teams channel / preferences in Settings" mentioned in the footer is not modelled. Confirm channels and preferences.
20. **Popover dismissal**: the project switcher and role menu have no click-outside/Escape handling (search and notifications do). Expected behaviour?
21. **Group header visibility** when a collapsed group's active item is not its first item (no header shown). Acceptable or should the header always show?
22. **Toast for NP / NR / Force**: none is shown on success. Should they confirm like the add-forms?

---

## Addendum (completeness pass)

Added by the coverage audit (see `12-coverage-report.md`). Its job is traceability: these shell-level `<sc-if>` flags were already described in prose above, but their identifiers were not named.

| Flag | Template line | Logic (render-values line) | Where | EN text | FR text |
|---|---|---|---|---|---|
| `navNoHit` | 35 | `!!navQ && !navHits.length` (5173) | Sidebar quick jump (⌘K) result list | "No page matches" | "Aucune page ne correspond" |
| `noProjOptions` | 91 | `!projectOptions.length` (5175) | Breadcrumb project switcher popover | "No project in this scope · search the whole portfolio" | "Aucun projet dans ce périmètre · recherchez dans tout le portefeuille" |
| `noHits` | 104 | `!searchHits.length` (5192) | Header global search popover | "No match — try a reference, a name or a supplier" | "Aucun résultat — essayez une référence, un nom ou un fournisseur" |

Screen-flag index: `12-coverage-report.md` §1 lists all 59 `isXxx` screen and sub-screen flags, the 14 top-level overlay flags and the 20 nested drawer and popover flags, each with the spec file that documents it.
