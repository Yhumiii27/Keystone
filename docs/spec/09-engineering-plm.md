# 09 — Engineering, BOM, PLM, ECO, drawings, P&ID, machine types

Source of truth: `design/Keystone PM v8.dc.html` (prototype). Template line numbers are identical in `design/_extracted/template-annotated.html`, where every `{{ T.kN }}` is shown as «English text». Logic lives in `class Component` → `renderValsEN()`; logic line numbers refer to the prototype file. French labels are the prototype's own `FR_DICT` entries (`_extracted/fr_dict.json`).

## Screens covered

| # | Screen (EN title / FR title) | Route key (`state.screen`) | Template flag | Template lines | Main logic lines | Nav location | `startScreen` option |
|---|---|---|---|---|---|---|---|
| 1 | Project BOM — equipment & parts / Nomenclature projet — équipements et articles | `bom` | `isBom` | 1167–1311 | 4175–4271 | Sidebar › **Project** › *Project engineering* › "Project BOM" | yes |
| 2 | Part record drawer (shared by BOM and PLM) | — (`state.part`) | `showPartDetail` | 2582–2613 | 4293–4304, 5062 | drawer over `bom` / `plm` | — |
| 3 | PLM — parts catalogue / PLM — catalogue articles | `plm` | `isPlm` | 2535–2580 | 4267–4292 | Sidebar › **Technical reference** › "Parts (PLM)" | yes |
| 4 | Engineering change orders / Ordres de modification (ECO) | `eco` | `isEco` | 1312–1376 | 4182–4199, 4339–4370 | Sidebar › **Technical reference** › "Change orders (ECO)" | yes |
| 5 | Drawings — PDM vault / Plans — coffre PDM | `drawings` | `isDrawings` | 1377–1419 | 4371–4380 | Sidebar › **Technical reference** › "Drawings" | yes |
| 6 | Standard machine types / Types de machines standard | `mtypes` | `isMtypes` | 1529–1572 | 5083–5099 | Sidebar › **Administration** › "Machine types" | **no** |
| 7 | Engineering synthesis / Synthèse ingénierie | `eng` | `isEng` | 2384–2417 | 4783–4816 | Sidebar › **Project** › *Project engineering* › "Synthesis" | **no** |
| 8 | Process / Mechanical / Electrical / Automation engineering (Ingénierie process / mécanique / électrique / automatisme) | `eng-process`, `eng-meca`, `eng-elec`, `eng-auto` | `isEngDisc` | 2418–2451 (+ import wizard 2452–2471) | 4783–4816 | Sidebar › **Project** › *Project engineering* › "Process" / "Mechanical" / "Electrical" / "Automation" | **no** |
| 9 | P&ID — tags, overlay & process validation / PID — tags, surcouche et validation du process | `pid` | `isPid` | 2472–2534 | 4762–4782 | Sidebar › **Project** › *Project engineering* › "P&ID validation" | yes |

Also covered: constants `PARTS`, `WEAR_SPARE`, `PU_LABEL`, `SPARE_LISTS`, `STATUS_NOTE`, `LAST_PRICE`/`lastPrice`, `TREE`/`TREES`, `REV_DIFF`, `ECO_TYPES`, `ECO_FLOW`, `ECOS`, `DRAWINGS`, `MACHINE_TYPES`, `NP_TEMPLATES` (machine-type fields), `REX_FIN`, `ITP_TEMPLATES`, `PID`, `PLC_LABEL`, `PID_TAGS`, `PID_STEPS`, `ENG_DISC`, `ENG_RCP`, `ENG_DOCS`, `ENG_INPUTS`, `ENG_RULES`, `ENG_CHECKS`, `ENG_OUTPUTS`, `ENG_CHANGES`, `ENG_TOOLS`, `ENG_MAP`, `ENG_DELTAS`, `FLEET`/`AS_MAINT` (as used by ECO effectivity), `ALL_BYID`, `HLT_PD`/`PD_CACHE` (project data provider `projectData`), the SolidWorks PDM connector, and the state keys `engOv`, `engImp`, `ecoOverrides`, `pidOv`, `mtOv`, `plm`, `bom*`.

---

## 0. Things every screen in this area shares

### 0.1 Shell, header, primary button (logic 5109, 5137, 5162–5177)

Page shell, header, breadcrumb, project picker and "Outside my workspace" banner are specified in `01-shell-navigation-i18n.md`. Area-specific values:

| Screen | Title (EN / FR) | Breadcrumb (EN) | Project picker (`showProjectPicker`) | Primary button (EN / FR) → handler |
|---|---|---|---|---|
| bom | Project BOM — equipment & parts / Nomenclature projet — équipements et articles | "Project · Project engineering" + picker | yes | "Add article" / "Ajouter un article" → `afOpen('bom')` |
| plm | PLM — parts catalogue / PLM — catalogue articles | "Technical reference · all projects" | no | "New part" / "Nouvel article" → `afOpen('plm')` |
| eco | Engineering change orders / Ordres de modification (ECO) | "Technical reference · all projects" | no | "New ECO" / "Nouvel ECO" → `afOpen('eco')` |
| drawings | Drawings — PDM vault / Plans — coffre PDM | "Technical reference · SolidWorks PDM" | no | "Sync vault" / "Synchroniser le coffre" → `afOpen('drawings')` |
| mtypes | Standard machine types / Types de machines standard | "Administration · one template per product range · planning, costs, ITP, REX" | no | "New machine type" / "Nouveau type de machine" → `afOpen('mtype')` |
| eng | Engineering synthesis / Synthèse ingénierie | "Project · Project engineering" + picker | yes | "Import a list" / "Importer une liste" → opens import wizard `{engImp:{...engImp, open:true, step:1}}` (keeps previous disc/doc/tool) |
| eng-process | Process engineering / Ingénierie process | idem | yes | "Import a list" → wizard preset `{disc:'process', doc:'GA-HLT-026', tool:1}` |
| eng-meca | Mechanical engineering / Ingénierie mécanique | idem | yes | "Import a list" → preset `{disc:'meca', doc:'LST-INS-026', tool:0}` |
| eng-elec | Electrical engineering / Ingénierie électrique | idem | yes | "Import a list" → preset `{disc:'elec', doc:'LST-INS-026', tool:0}` |
| eng-auto | Automation engineering / Ingénierie automatisme | idem | yes | "Import a list" → preset `{disc:'auto', doc:'LST-INS-026', tool:0}` |
| pid | P&ID — tags, overlay & process validation / PID — tags, surcouche et validation du process | "Project · Project engineering" + picker | yes | "Import P&ID tags" / "Importer les tags du PID" → `afOpen('pid')` |

`hasPrimary` hides the primary button when the persona is "outside" the screen, and also when the selected project is read-only for the persona (`projReadOnly`) on `bom`, `pid`, `eng`, `eng-*` (not on plm/eco/drawings/mtypes, which are portfolio-wide).

### 0.2 Role visibility (`ROLE_SCREENS`, 3465–3466; `PERSONAS`, 3747)

`director: null` = all screens. `eng, eng-process, eng-meca, eng-elec, eng-auto` are pushed for pm, englead, quality.

| Screen | director (Marie Lefebvre) | pm (Romain Aubert) | depthead (Marion Kerviel) | member (Julien Wagner) | englead (Antoine Girard) | quality (Gabriel Comte) | procurement (Fabien Bertrand) | client (Nadia Bensaïd) |
|---|---|---|---|---|---|---|---|---|
| bom | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | – |
| plm | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | – |
| eco | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | – |
| drawings | ✓ | ✓ | – | – | ✓ | ✓ | – | – |
| mtypes | ✓ | ✓ | – | – | ✓ | ✓ | – | – |
| eng, eng-* | ✓ | ✓ | – | – | ✓ | ✓ | – | – |
| pid | ✓ | **–** | – | – | ✓ | ✓ | – | – |

In-screen role gates (all client-side):

| Gate | Roles | Where |
|---|---|---|
| ECO approval buttons (`ecoRoleKey`) | `englead`→"englead", `quality`→"quality", `pm`→"pm"; **director cannot approve** | ECO drawer, My approvals |
| Set interchangeability (`canSetInterch`) | englead, quality, director (and ECO in Draft / Impact analysis) | ECO drawer |
| Project dispositions (`canDecide`) | pm, director (ECO not Released/Rejected) | ECO drawer |
| Machine dispositions (`canDecide`) | quality, englead, director (ECO not Released/Rejected) | ECO drawer |
| `mtCanEdit` | director, pm, englead, quality | Machine types: hides Activate/Deactivate, "Add phase/system/category" only |

No other action in this area checks the role (e.g. "Validate release (PM)" and PID mapping are open to anyone who can see the screen).

### 0.3 Recurring UI patterns

Same components as `08-supply-chain-approvals.md` §0.5 and `02-design-system.md` (implement once):

- **Screen root**: `display:flex; flex-direction:column; gap:14px`.
- **KPI tile row**: grid `repeat(auto-fit,minmax(150px,1fr))`, gap 10px; tile `.card.elev-sm` padding `12px 14px`, gap 3px; label 10.5px uppercase `letter-spacing:.08em` `--color-neutral-400`; value 22px/500/−0.02em in `k.color`; sub 11.5px `--color-neutral-400` (`text-wrap:pretty` on mtypes, eng, eng-*, pid). Value colors: `OK = var(--color-text)`, `LO = var(--color-accent-300)` (line 3135).
- **Filter chips** (`chips()` 4110): label block = Phosphor icon 15px accent + `FL.*` name (12px neutral-400); chip = button `padding:4px 10px; radius-md; 12px; border:1px`; active `bg accent-900 / border accent-700 / text accent-200`, inactive `transparent / neutral-800 / neutral-300`; hover `bg neutral-900`; count suffix 11px tabular neutral-400.
- **Segmented control** (`seg()` 3889): `.seg` with `.seg-opt` buttons 12px, padding `4px 10px`, active `color accent; box-shadow: inset 0 0 0 1px accent`, inactive `neutral-300`, `border-left:1px solid divider` from the 2nd option. Optional leading icon (`o.icon`).
- **Sortable header** (BOM, PLM): `<th>` clickable, `user-select:none`, label + icon 12px: active column `ph-caret-up` (asc) / `ph-caret-down` (desc) in `--color-accent`; inactive `ph-caret-up-down` in `--color-neutral-600`. Clicking the active column flips the direction; clicking another column sets it ascending, except money columns (`total`, `price`) which start **descending**.
- **Card with table**: `.card.elev-sm`, padding `14px 16px`, gap 8px, `overflow:auto`; title row `.card-title` (17px) `margin-right:auto` + 12px neutral-400 hint; `.table` at 13px (12.5px in tree/compare/eng tables). Selected-row id cell turns `--color-accent-300` (else `--color-neutral-300`).
- **Right drawer** (BOM node, Part record, ECO, Drawing, P&ID tag): backdrop `fixed inset:0 z-index:60 background:color-mix(in srgb, var(--color-bg) 60%, transparent)` (click closes); panel `.card.elev-lg` `fixed; top:0; right:0; bottom:0; z-index:61; width:min(640px,100vw); overflow:auto; border-radius:0; padding:18px 22px; gap:12px; border-left:1px solid var(--color-neutral-800)`. Header row: id (12px neutral-400 tabular), tags, close `.btn.btn-icon.btn-ghost` `ph-x`. Then `.card-title` with `text-wrap:pretty`.
- **Drawer section label**: 10.5px uppercase `.08em` `--color-accent`, margin-bottom 4px. **Key/value rows** (`{k,v,color}`): flex space-between, 12.5px, padding `3px 0`, `border-bottom:1px solid neutral-900`, key neutral-400, value right/tabular/`text-wrap:pretty`.
- **Clickable list row inside drawers** (parts, projects, equivalents, ECOs…): `<button>` grid `minmax(0,1fr) auto [auto]`, padding `5px 0` (or 6px), transparent, `border-bottom:1px solid neutral-900`, 12.5px, left-aligned; hover text `--color-accent-300`; line 1 tabular ref, line 2 11px neutral-400 ellipsis.
- **Empty state (no project data)**: 12.5px neutral-400, padding 14px, centered, `radius-md`, `background:var(--color-neutral-900)`.
- **Action-form dialog** (`afOpenDlg`, template 138–157, logic 5111–5135): `.dialog-backdrop` (z 50, aligned top, `padding-top:8vh`), `.dialog` `width:min(640px,100%)`, max-height 84vh; title + subtitle "`<projectName>` · Required fields are marked · *"; fields on a 2-column grid (textarea / `title` / `name` / `reason` fields span both columns); required marker accent `*`; footer "Cancel" (secondary) + submit (primary, `ph-check` for kind `create`, `ph-play` for kind `run`), disabled until every required **text** field is non-blank (selects always count as valid). Submit closes and shows a toast `AF_RESULT[key]`.
- **Toast** (template 159–161): fixed bottom-right card, `ph-check-circle`, auto-hide 4 s (`showToast`).
- **Money**: `money$(v)` (4177) full euros, EN `€1,240` / FR `1 240 €` (always €); `f(k)` (3775) thousands, EN `€432k`/`€14.05M`, FR `432 k€`/`14,05 M€`, honours the `currency` prop.

### 0.4 Status → tag mapping in this area

`tag-neutral` = neutral-800 bg / neutral-100 text; `tag-accent` = accent-800 / accent-100; `tag-outline` = 1px accent border + accent text.

| Entity (function, line) | tag-neutral | tag-accent | tag-outline |
|---|---|---|---|
| Part status (`partTag` 4176) | Validated / Validé | Outdated / Périmé, Obsolete / Obsolète | Not validated / Non validé |
| PU/PR flag (`puTag` 4181) | — (none) | PU | PR |
| ECO status (`ecoTag` 4194) | Released / Diffusé | In approval / En approbation | Draft / Brouillon, Impact analysis / Analyse d’impact, Rejected / Refusé |
| ECO approver state (4363) | Approved / Approuvé | Pending / En attente | Rejected / Refusé |
| ECO disposition (4366–4367) | Update, Not applicable | Pending (no disposition) | Pinned, Retrofit |
| Interchangeability (4365) | Interchangeable, Not interchangeable | Interchangeability not assessed | — |
| Drawing state (`dwgTag` 4373) | Released | WIP / En cours, Under review / En revue | Obsolete |
| Project stage (`statusTag` 3917) | Clos, Annulé | other stages | Garantie and pipeline stages (Initiative, APS, APD) |
| P&ID tag status (`tsTag` 4767) | Linked / Lié, Client | Unmapped / Non associé, Unknown ref / Référence inconnue | Not in BOM, Part not validated, Part outdated, Part obsolete |
| P&ID scope (4768) | Keystone | Overlay / Surcouche | Client |
| P&ID PLC (4768) | Process PLC / Automate process | Safety PLC / Automate sécurité | (Local / "—" shown as plain text) |
| P&ID validation step (4779) | Done / Terminé | In progress / En cours | To do / À faire |
| Eng. check severity (4789) | Info | Blocking / Bloquant | Warning / Alerte |
| Eng. check status (4789) | Resolved / Résolu | Open / Ouverte | In progress, Sent back / Renvoyé |
| Eng. deliverable status (4791) | Released | Release proposed / Diffusion proposée | Draft, Frozen / Gelé |
| Eng. input state (4794) | Up to date / À jour | Outdated / Périmé | To confirm / À confirmer |
| Eng. output state (4795) | Ready / Prêt | Blocked / Bloquée | Partial / Partiel, Stale / Périmé |
| Machine type state (5090) | Active / Actif | — | Inactive / Inactif |
| Installed-base part state (part drawer, 4302) | Latest, Update planned | Decision pending | Retrofit pending, Pinned |

### 0.5 Business glossary (for developers)

- **BOM** (nomenclature): articles of a project with quantities. **Make / buy**: `Manufactured` (Fabriqué) vs `Purchased` (Acheté).
- **PU / PR**: *pièce d’usure* (wear part, replaced on a schedule) vs *pièce de rechange* (spare part, held for breakdowns). Flag comes from `WEAR_SPARE[ref]`.
- **ECO** (engineering change order): controlled change to a part/assembly, with **interchangeability** (form-fit-function with previous revision) and **dispositions** per target (open project BOMs and machines of the installed base): Update / Pin (keep old revision) / Retrofit / N/A.
- **Open BOM**: a project in stage `Initiative`, `APS`, `APD` or `Etudes` (`OPEN_BOM`, 4185) — design still open, ECOs update it automatically. Any later stage = **Frozen BOM**.
- **BPE** (*bon pour exécution*): released-for-construction state of a deliverable. **Gate "Plans & BOM frozen"**: engineering gate blocked by open blocking inconsistencies.
- **Overlay (surcouche)**: Keystone instruments mounted on client-supplied equipment.
- **REX**: *retour d’expérience* (lessons from reference projects); here financial payment pattern.
- **ITP**: inspection & test plan (systems inspected per machine type).
- Machine types: `EMP`, `MEMU`, `SPUR`, `AUTRE` (other), `R&D` (`MACHINE_TYPES`, 3166).

### 0.6 State keys owned by this area (initial state line 3774 unless "implicit")

| Key | Initial | Meaning |
|---|---|---|
| `project` | `'HLT-026'` | current project (BOM, P&ID, engineering) |
| `part` | `null` | ref of the part shown in the Part record drawer (BOM / PLM) |
| `bomQ`, `bomType`, `bomMfr` | `''`, `null`, `null` | flat-list search / type / supplier filters |
| `bomSort`, `bomSortDir` | `'ref'`, implicit (`1`) | flat-list sort key / direction (1 asc, −1 desc) |
| `bomView` | implicit `'flat'` | `flat` · `tree` · `used` · `compare` · `spares` |
| `bomClosed` | implicit `{}` | `{[assemblyRef]: true}` folded tree nodes |
| `bomNode` | implicit `null` | selected tree node (opens node drawer) |
| `bomUsedQ` | implicit `''` | Where-used search |
| `spareSys`, `spareFilter` | implicit | PU/PR list: selected system ref, kind filter (`'PU'`/`'PR'`/null) |
| `plm` | `{q:'', type:null, mb:null, status:null, restricted:false}` (+ implicit `pu`, `sort`, `dir`) | PLM filters/sort |
| `eco`, `ecoFilter`, `ecoOverrides`, `ecoNew` | `null`, `null`, `{}`, `null` | selected ECO, status filter, per-ECO overrides `{status?, interch?, appr?:{}, disp?:{}}`, part ref from "Raise ECO" (unused) |
| `dwgQ`, `dwgState`, `dwg` | `''`, `null`, `null` | drawing search, state filter, selected drawing no |
| `pidFilter`, `pidScope`, `pidOv`, `pidTag`, `pidQ` | `null`, `null`, `{}`, `null`, `''` | P&ID filters, tag→ref overrides (`''` = unlinked), selected tag, search |
| `engOv` | `{docs:{}, inputs:{}, checks:{}, gen:{}, appr:{}, ack:{}, dl:{}, obs:{}}` | engineering overrides; `docs`, `appr`, `ack`, `obs`, `dl` are shared with the Codex document vault |
| `engImp` | `{open:false, step:1, disc:'elec', doc:'LST-INS-026', tool:2}` | import wizard |
| `engChkF` | `null` | consistency-check filter on discipline screens (`'open'`, `'Sent back'`, `'Resolved'`) |
| `mtSel`, `mtOv`, `added.mtypes` | `'EMP'`, `{}`, `[]` | machine types: selection, per-code patches, custom types |

Everything is in-memory (reset on reload). A real application must persist these as data (see §10).

---

## 1. Project BOM — `bom`

### 1.1 Key & access
`screen==='bom'` → `isBom` (5185). Nav: Project › Project engineering › "Project BOM" (`ph-cube`), no badge. Roles: director, pm, englead, quality, procurement. `startScreen: 'bom'` supported. Project-scoped (picker in header).

### 1.2 Purpose
Bill of materials of the selected project: every equipment/article with quantity, value, qualification status and export restrictions; for projects with a multi-level structure (only Harbor Line HLT-026 in the prototype) also the costed assembly tree, where-used analysis, revision comparison and the recommended wear & spare parts package handed over with the equipment (stage *Fabrication & Assemblage* → *Mise Service & SAT* → *Garantie*).

### 1.3 Layout (1167–1311)
Column (gap 14): KPI row (5 tiles) → view toolbar → one of five view panels → (optional) "no tree" notice. The Part record drawer (§2) and the node drawer (§1.6.2) overlay the page.

**View toolbar** (1178): flex wrap gap 10. Left: label `ph-eye` + `FL.view` "Display" (FR "Vue") and segmented control `bomViewSeg` (4227):

| Value | EN | FR |
|---|---|---|
| `flat` | Flat list | Liste à plat |
| `tree` | Assembly tree | Arborescence |
| `used` | Where-used | Cas d’emploi |
| `compare` | Compare revisions | Comparer les révisions |
| `spares` | PU/PR list | Liste PU/PR |

Right: 12px neutral-400 note «Roll-ups use the last purchase price».

### 1.4 KPI tiles (`bomKpis`, 4222)
Input set: `bomParts = PARTS.filter(p => p.usage[PD.p3] > 0)` (`PD.p3` = first 3 letters of project code, e.g. `HLT`).

| Label (EN / FR) | Value | Sub | Color |
|---|---|---|---|
| Articles / Articles | `bomParts.length` (HLT: 35) | "`Σ usage[p3]` units in total" (HLT: 2,042) | OK |
| BOM value / Valeur nomenclature | `f(Σ price × usage[p3] / 1000)` (list price; HLT: €14.05M) | "At unit list price" | OK |
| Not validated / Non validé | count status `Not validated` (HLT: 2) | "Blocked for purchasing" | LO if >0 |
| Outdated / obsolete / Périmés / obsolètes | count `Outdated` or `Obsolete` (HLT: 1) | "Replace before ordering" | LO if >0 |
| Export-restricted / Restreints à l’export | count `restr !== 'None'` (HLT: 7) | "Lines needing customs review" | OK |

Example values for other projects (articles / value): NDC 8 / €3.83M, RCF 5 / €150k, ERP 2 / €1.32M, WSA 6 / €4.01M, MSR 3 / €351k.

### 1.5 Flat list (`bomIsFlat`, 1179–1209)

**Filter bar** (1180–1186), flex wrap gap 14:
- Search input (flex `1 1 240px`, max-width 340px, min-height 32px, 12.5px, `ph-magnifying-glass` at left 10/top 9), placeholder «Search reference, article, manufacturer ref», value `bomQ`, `setBomQ` → `{bomQ}`. Matches `ref + name + mfr + mfrRef` (case-insensitive substring).
- `<select>` labelled `ph-tag` + "Type" (`FL.type`): options `bomTypeOpts` (4213) = "All types · 35" + one per type in the BOM in first-appearance order, label "`<type>` · `<count>`". `setBomType` → `{bomType: value || null}`.
- `<select>` labelled `ph-factory` + «Supplier»: options `bomMfrOpts` = "All suppliers · N" + manufacturers sorted A→Z with counts. `setBomMfr` → `{bomMfr}`.
- "Clear filters" ghost button (`ph-x`) shown when `bomType || bomMfr || bomQ` → resets all three.
- Right-aligned count (12px tabular): `bomCountText` = "`<shown>` / `<total>` articles".

**Table card** (1187–1208): title `bomTitle` = "Bill of materials · N article(s)" (FR "Nomenclature …"), hint «Click an article for its full record».

| # | Column (EN) | Sortable key | Cell content / format |
|---|---|---|---|
| 1 | Reference | `ref` (localeCompare) | `r.ref`, 12px 500 tabular nowrap; accent-300 when it is `state.part` |
| 2 | Article | `name` | name; second line 11.5px neutral-400 "`mfr` · `mfrRef`" |
| 3 | Type | `type` (then ref) | 12px neutral-300 nowrap |
| 4 | Make / buy | — | `Manufactured` / `Purchased`, 12px neutral-300 |
| 5 | PU/PR | — | tag: `PU` accent, `PR` outline, `—` neutral |
| 6 | Qty | — | right, `usage[p3].toLocaleString()` |
| 7 | Unit price | — | right, `money$(price)` (list price) |
| 8 | Total | `total` (price×qty; **first click = descending**) | right, `money$(price × qty)` |
| 9 | Status | `status` (then ref) | part tag (§0.4); below it, if an open ECO touches the part (`ecoOpenFor`), an outline tag-button (10px) with the ECO id → `openEcoScreen(id)` (stops row propagation) |
| 10 | Restrictions | — | 12px, max-width 220, `—` in neutral-500 if `None`, else the restriction text in `LO` |
| 11 | Also used in | — | 12px neutral-400: other projects' 3-letter codes (`usedIn(p)` minus current) joined ", " or `—` |

Row click → `selectPart(ref)` = toggle `state.part` (opens/closes Part record drawer §2).
Sort state: `bomSortBy[k]` (4210) sets `{bomSort:k, bomSortDir}`; comparator × direction; default `ref` ascending.

`ecoOpenFor(ref)` (4195): first ECO in `ECOS` order whose **derived** status is not Released/Rejected and whose `parts` include `ref`. Initially: FD-DET-OPT, FD-DET-OPT2 → ECO-2026-015; HST-BRK-DSC → ECO-2026-016; CR-BRG-SKF, CR-BRG-FAG → ECO-2026-017.

Computed but **not rendered** (legacy, do not implement unless wanted): `bomMfrChips`, `bomSortSeg` (with a `mfr` sort), `bySupplier`, `bomTypeChips`.

### 1.6 Assembly tree (`bomIsTree` + `bomHasTree`, 1210–1246)

Only when `TREES[PD.p3]` exists (HLT only). Wrapper grid `minmax(0,1fr)`, gap 14.

**Card** «Assembly tree», hint «Click a line for its detail · caret to fold». Table 12.5px:

| Column | Content |
|---|---|
| Reference · article | flex row, `padding-left = depth×18+6 px`; caret button 18×18 (`ph-caret-down` open, `ph-caret-right` folded, `ph-dot-outline` leaf; neutral-400) → toggles `bomClosed[ref]` (stops propagation); ref 12px tabular neutral-400; name — text color for assemblies, neutral-300 for leaves |
| Qty | `n.q` (quantity per parent), right |
| Extended | `ext = n.q × parent ext` (total units in the project), right, neutral-400 |
| Make / buy | part `mb` |
| PU/PR | PU/PR tag |
| Rev | part `rev` |
| Status | part tag |
| Unit cost | `money$(rollup(n))` |
| Extended cost | `money$(rollup(n) × ext)` |

Row background: `var(--color-accent-900)` for `state.bomNode`, else `transparent` (inline background replaces the Nocturne row rule — keep a separator in the rebuild). Row click → `{bomNode: ref}`.

Roll-up (4231): `rollup(leaf) = lastPrice(part)` (= `LAST_PRICE[ref] ?? price`); `rollup(assembly) = Σ child.q × rollup(child)` (the assembly's own list price is ignored). Walk (4233–4236) is depth-first, folded nodes hide their subtree. Example HLT: ASM-RMG-250 q2, unit €713,996, extended €1,427,992; ASM-BOG-300 q4 ext 8 unit €11,222.

#### 1.6.1 Tree data (`TREE`, 3421; `TREES = {HLT: TREE}`)
`{ref, q, c?: Node[]}`:
```
ASM-RMG-250 ×2
├ ASM-STR-100 ×1 ─ KS-STL-0450 ×4 · ASM-GIR-200 ×2 (KS-PLT-S355 ×48, KS-WLD-CONS ×2) · ASM-BOG-300 ×4 (CR-WHL-630 ×2, CR-BRG-SKF ×4, CR-MOT-15K ×1)
├ ASM-HST-400 ×1 ─ HST-DRM-2000 ×1, HST-ROP-28 ×2, HST-MOT-160 ×1, HST-BRK-DSC ×2, ASM-SPR-500 ×1
├ ASM-ELE-600 ×1 ─ EL-SWG-11KV ×1, EL-TRF-2MVA ×1, EL-CBL-XLPE ×6, ASM-DRV-700 ×1 (EL-VFD-200 ×3, EL-PLC-S7 ×1, EL-HMI-15 ×1)
└ ASM-CTL-800 ×1 ─ CTL-ANT-COL ×4, CTL-CAM-OCR ×6, CTL-WIND-SN ×1, FD-DET-OPT2 ×2
```

#### 1.6.2 Node drawer (`hasNode`, 1233–1243; `nodeVals` 4242–4247)
Header: ref, part status tag (`margin-left:auto`), close (`closeNode` → `{bomNode:null}`). Title: part name.

- **Identification** (FR missing in dictionary): Revision · Make / buy · Manufacturer · Drawing / ref. (= `mfrRef`) · Lead time ("N weeks" or —) · Components ("`<leafCount>` parts · `<n>` direct children" or "Leaf part").
- **Costed roll-up** (Cumul valorisé): "Rolled-up cost (last purchase)" = `money$(rollup)`; "List / standard price" = `money$(price)`; "Delta" = sign + `money$(|unit−list|)` (value in `LO` when rolled-up > list); "Per project (× N)" where N = product of `q` along the first path from the root (inclusive) → `money$(unit × N)`.
- **Used in** (Utilisé dans): one line per path: ancestor refs joined " › " (excluding the node), or "Top level".
- Buttons: "Part record" (secondary, `ph-cube`) → `{part: ref, bomView:'flat'}`; "Drawings" (secondary, `ph-blueprint`) → `{screen:'drawings', dwgQ: ref}`; "Raise ECO" (primary, `ph-git-branch`) → `{screen:'eco', ecoNew: ref}` (see Open questions: `ecoNew` is never consumed).

### 1.7 Where-used (`bomIsUsed`, 1247–1265; 4248–4254)
Rendered for every project (no tree guard).
Card (gap 12): header «Where-used» + sub «Every assembly path, project and open order that carries the part»; search input min-width 280 (placeholder «Part reference or name», `setUsedQ` → `bomUsedQ`).
Part resolution: `q = bomUsedQ.trim().toUpperCase()`; exact ref match → else first part whose ref includes q or uppercase name includes q → else **default `CR-BRG-SKF`** (also when the query is empty).
Header line: ref (12px tabular), name (14px/500), status tag, «Equivalents:» `equiv.join(', ')` or `—`.
Three columns (grid `repeat(auto-fit,minmax(min(100%,300px),1fr))`, gap 18), each with a section label:
- **Assembly paths** (Chemins d’assemblage): per path in the project tree: chain "`REF ×q`  ›  `REF ×q` …" (ancestors only) + "`Π q (incl. leaf)` per project" (e.g. CR-BRG-SKF: "ASM-RMG-250 ×2 › ASM-STR-100 ×1 › ASM-BOG-300 ×4", 32 per project). Empty: «Not part of an assembly in this project».
- **Projects** (Projets): every project using the part (`usedIn`): grid `minmax(0,1fr) auto auto`: project name (ellipsis), "`N` units", project stage tag.
- **Purchase orders** (Commandes d’achat): every PO from `genPOs(code)` over all `DEFS` projects containing the ref: id, "supplier · project code", `tag-neutral` status. Empty: «No open order». (All statuses are listed, including Received.)

### 1.8 Compare revisions (`bomIsCompare` + `hasCmp`, 1266–1276; `cmpVals` 4266)
Only when `REV_DIFF[tree.ref]` exists (ASM-RMG-250: rev B → C).
Card title `"<tree ref> · rev <from> → rev <to>"`, sub `"<date> · <eco>"` ("12 Sep 2026 · ECO-2026-014"); right tag-accent «Cost delta» `<total>`.
Table (12.5px): Line (12px tabular neutral-300) · Article · "Rev B" (right) · "Rev C" (right) · Change (tag: Added → accent, Substitution → outline, Quantity → neutral) · Cost delta (right).
Formula: `ref = line.split(' / ').pop().split(' → ').pop()` (the new part); `d = int(b) − int(a)` (non-numbers → 0); delta = `±money$(|d| × lastPrice(ref))` or `—` if d = 0. Total = Σ d × lastPrice, formatted "`±€N` per crane". HLT: +€13,600 (VFD 2→3), —, —, +€860 (anemometer added), +€4,720 (plate 44→48) → "+€19,180 per crane".

> **Delivery 8 (R-104, E-2b = a).** A line is priced new qty × new price − old qty × old price, both at the E-2a valuation (ordered, else last purchase, else catalogue); a quantity or added line is unchanged; an unknown price keeps the quantity-only rule. HLT: EL-HMI-10 → EL-HMI-15 "—" → "+€750", FD-DET-OPT → FD-DET-OPT2 "—" → "+€12" → "+€19,942 per crane". The delta's tooltip gives both prices old → new.

### 1.9 PU/PR list (`bomIsSpares` + `bomHasTree`, 1277–1307; 4255–4265)
- **KPI row** `spKpis`:

| Label | Value | Sub | Color |
|---|---|---|---|
| Lines / Lignes | rows count | "`n` wear · `m` spare" | OK |
| Recommended package / Lot recommandé | `f(Σ lastPrice × qTotal / 1000)` | "At last purchase price · × N system(s)" | OK |
| Not in stock / Hors stock | rows with `stock < qTotal` | "Lines below recommended quantity" | LO if any |
| Long lead (> 8 wks) / Délai long (> 8 sem.) | rows whose part `lead > 8` | "Order with the main equipment" | OK |
| Under change / En modification | rows whose ref is in `ecoFrozen` | "Frozen by an open ECO" | LO if any |

- **Toolbar** (1280): `ph-tree-structure` + `FL.system` "System" (Système) segmented control `spSeg`: one option per key of `SPARE_LISTS` that exists in the tree: `ASM-RMG-250` → "Complete system" (Système complet), others → part name ("Travel bogie", "Hoist & trolley", "Drive cabinet", "Controls & safety systems"). Default `spareSys = tree.ref`. Then `ph-tag` + `FL.kind` "Kind" (Nature) chips `spChips`: All / Wear parts (PU) / Spare parts (PR) → `spareFilter`.
- Legend line (12px neutral-400): «PU = wear part, replaced on a schedule · PR = spare part, held for breakdowns · quantities per system × systems in the project».
- **Card** title «Recommended wear & spare parts» — `spSysName` (part name of the system); sub «Linked to the system in the catalogue · handed over with the equipment · stock checked against recommended quantity»; buttons «Create spares purchase order» (secondary `ph-shopping-cart`) and «Export list» (ghost `ph-file-pdf`) — **no handlers**.
- `sysQty` = `tree.q` for the complete system, else product of `q` along the path to the system **including the system's own q** (e.g. ASM-BOG-300 → 2×1×4 = 8).
- Table (13px):

| Column | Content |
|---|---|
| Reference | 12px 500 tabular, accent-300 when selected |
| Article | name; if `pinnedFor(ref)` non-empty: link button 10.5px accent-300 `ph-push-pin` "Keep for the installed base · N machine(s) · ECO ids" → opens first pinning ECO |
| PU/PR | kind tag |
| Qty per system | `q` |
| Recommended qty | `q × sysQty`, weight 500 |
| Replacement / note | note or `—`, 12px neutral-300, max-width 240 |
| Unit price | `money$(lastPrice)` |
| Total | `money$(lastPrice × qTotal)` |
| «Discipline lead» (sic, FR "Référent") | **lead time** "N wks" (see Open questions) |
| Stock | "N in stock" / "None in stock"; color neutral-300 if `stock ≥ qTotal`, else LO |
| Status | part tag |

Row click → `selectPart(ref)` (Part record drawer). Empty: «No wear or spare part registered for this system».
HLT complete system (×2): 12 lines (4 PU, 8 PR), package €235k, long lead 4, under change 3 (CR-BRG-SKF, HST-BRK-DSC, FD-DET-OPT2).
`ecoFrozen` (4229) = parts of ECOs whose **raw** `ECOS` status is not Released/Rejected (ignores overrides).
Stock: `STOCK_BY_REF` (4228) is intended as Σ on-hand quantity per ref across `STOCK0` — **prototype bug**: it indexes `s[0]`/`s[2]` on objects, so every row shows "None in stock" (see Open questions).

### 1.10 No tree notice (1308)
`bomNoTree = !tree && bomView !== 'flat'` → «No multi-level assembly is registered for this project — the flat list is the full BOM.» (empty-state box). Shown under the Where-used card too for non-HLT projects.

### 1.11 Interactions summary

| Control | Handler | State written / navigation |
|---|---|---|
| View seg | `bomViewSeg[i].onClick` | `bomView` |
| Search / type / supplier / clear | `setBomQ`, `setBomType`, `setBomMfr`, `bomClear` | `bomQ`, `bomType`, `bomMfr` |
| Column header | `bomSortBy[k]` | `bomSort`, `bomSortDir` |
| Flat / spare row | `r.select` | toggle `part` |
| ECO tag in Status | `r.openEco` | `{screen:'eco', eco:id, part:null, dwg:null}` |
| Tree caret / row | `r.toggle` / `r.select` | `bomClosed[ref]` / `bomNode` |
| Node drawer buttons | `node.openPart`, `node.openDrawings`, `node.raiseEco` | see §1.6.2 |
| Where-used search | `setUsedQ` | `bomUsedQ` |
| System seg / kind chips | `spSeg`, `spChips` | `spareSys`, `spareFilter` |
| Pinned link | `r.openPinnedEco` | ECO screen |
| Primary "Add article" | `afOpen('bom')` | dialog (§1.12) |
| Project change (header picker) | — | `{project, projMenu:false, part:null, bomType:null, projQ:''}` |

### 1.12 "Add article" form (`AF.bom`, 3674ff.)
Title "Add article", kind create, submit "Add to BOM". Fields: `ref` "Article reference" (text, **required**); `qty` "Quantity" (number, default `1`); `act` "Activity" (select: first 12 activities of the project, "A1250 · name"); `scope` "Scope" (Keystone / Client / Overlay); `note` "Note" (textarea). Submit → toast "Article added to the project BOM". **No data is created** in the prototype.

---

## 2. Part record drawer (shared by BOM and PLM)

### 2.1 Key & access
`showPartDetail = !!SP && (screen==='bom' || screen==='plm')` (5235), `SP = PARTS.find(ref === state.part)`. Opened by row clicks on BOM flat list, PU/PR list, PLM catalogue, and by `state.part` set from other modules (P&ID, ECO, drawings, stock, deliveries, NCR, RFQ, Codex links). Template 2582–2613, logic 4293–4304.

### 2.2 Layout & components
Drawer (§0.3) with header: ref · part status tag · "Open in PLM" (secondary, `ph-database`, `st({screen:'plm'})` — keeps `part`, so the drawer stays open on PLM) · close (`closePart` → `{part:null}`). Title: part name.

1. **Warning banner** (`hasWarn`): 12.5px, line-height 1.45, neutral-200 on `accent-900`, `ph-warning` accent, text = `STATUS_NOTE[status]`:
   - Outdated: "Superseded — replace in open designs before procurement."
   - Obsolete: "Discontinued by the manufacturer — no new orders; switch to the registered equivalent."
   - Not validated: "Qualification pending — cannot be released to purchasing."
2. **Linked documents** — section label «Freeze» (sic; FR "Geler") with ghost button "Propose release" (`ph-upload-simple`) → `openDepPart` = opens the Codex deposit wizard (global dialog, template 2363) preset `{type:'CER', link:'', part:<ref>, ctx:''}`. List `partDocs` (5062): Codex vault documents whose `links` contain the ref or whose `tags` include it; row = "`id` · rev `rev`" / title (ellipsis) / type label / status tag (Codex classes); click → `{screen:'docs', part:null, dv.open:id}`.
3. Grid `repeat(auto-fit,minmax(min(100%,230px),1fr))`, gap 18, sections:
   - **Identification**: Make / buy · Wear / spare (PU/PR) (`PU_LABEL`: "Wear part (PU)", "Spare part (PR)", "—") · Type of part · Manufacturer · Manufacturer ref. · Revision · Lead time ("N weeks").
   - **Commercial & export** (Commercial et export): Unit price `money$(price)` · Customs (HS) code · Export restrictions (LO if not "None") · Total quantity "`Σ usage` units · `n` project(s)" · Committed value `money$(price × Σ usage)`.
   - **Equivalent parts** (Articles équivalents): rows for `equiv` refs (ref, name, status tag) → select that part; empty «No equivalent registered»; ghost «Register equivalent» (`ph-plus`) — **no handler**.
   - **Spare parts list** (only if `SPARE_LISTS[ref]`): rows ref / name / "× q" / kind tag → select part; ghost «Open PU/PR list» (`ph-list-checks`) → `{screen:'bom', bomView:'spares', spareSys:ref, part:null}`.
   - **Projects equipped** (Projets équipés): per `usedIn` project: name (ellipsis), "`code` · `N` units", stage tag, `ph-arrow-right`; click → `{screen:'bom', project:<code>, projMenu:false, bomType:null}`. Empty «Not used in any project yet».
   - **Installed base** (Parc installé): machines from `FLEET` whose `AS_MAINT[id].parts` contains the ref: name, "`MCH-id` · `Gen n` · rev X", state tag (+ " · ECO id"), arrow; click → ECO screen if an ECO drives the state, else `{screen:'fleet', part:null}`. Empty «Not fitted on any machine in service.». State per machine (scan non-rejected ECOs containing the part, stop at first Pinned): disposition `pinned` → "Pinned" (outline); `retrofit` → "Retrofit pending" (outline); none and ECO not Released → "Decision pending" (accent); `update` and ECO not Released and still Latest → "Update planned" (neutral); default "Latest" (neutral).
   - **Engineering changes** (Modifications techniques; only if any): non-rejected ECOs containing the part: id, title, ECO status tag, arrow → ECO screen.

---

## 3. PLM — parts catalogue — `plm`

### 3.1 Key & access
`isPlm` (5185). Nav: Technical reference › "Parts (PLM)" (`ph-database`). Roles: director, pm, englead, quality, procurement. Portfolio-wide (no project picker). `startScreen` supported.

### 3.2 Purpose
Company-wide master catalogue of articles (manufactured and purchased), with qualification status, customs/export data, wear/spare classification, equivalents and usage across projects — the reference the project BOMs, purchasing and after-sales draw from.

### 3.3 Layout (2535–2580)
KPI row → filter card → catalogue table card. Part record drawer (§2) on row click.

### 3.4 KPI tiles (`plmKpis`, 4281)

| Label | Value (initial) | Sub | Color |
|---|---|---|---|
| Parts in catalogue / Articles au catalogue | `PARTS.length` (54) | "16 manufactured · 38 purchased" | OK |
| Validated / Validé | `round(validated / total × 100)%` (87%) | "`n` awaiting qualification" (4) | OK |
| Outdated still in use / Périmés encore utilisés | parts Outdated/Obsolete with usage (2) | refs joined " · " ("FD-DET-OPT · SG-BRK-SS") or "None" | LO if >0 |
| Export-restricted | `restr !== 'None'` (13) | "Licence or notification needed" | OK |
| Avg lead time / Délai moyen | `round(mean(lead) over parts with lead>0)` + " wks" (9 wks) | "Purchased & manufactured" | OK |

### 3.5 Filter card (2546–2556)
`.card.elev-sm` padding `12px 16px`; flex wrap gap 14:
- Search (placeholder «Search reference, name, manufacturer, manufacturer ref») → `plm.q`; matches ref + name + mfr + mfrRef.
- Select `ph-tag` «Type»: `plmTypeOpts` "All types · 54" + 13 types with counts (Structural, Heavy equipment, Electrical, HVAC, Fire & safety, Architectural, Medical, Mechanical, Electronics, IT hardware, Assembly, Consumable, Software).
- Select `ph-funnel` «Status»: "Any status · 54", Validated, Not validated, Outdated, Obsolete (with counts).
- Select `ph-gear` «PU/PR»: "All parts · 54", "Wear parts (PU) · 6", "Spare parts (PR) · 19", "Neither · 29" (`pu:'none'` = no flag).
- Select `ph-factory` `FL.makebuy` "Make / buy": "All · 54", "Manufactured · 16", "Purchased · 38".
- Toggle chip `restrChip` `ph-globe-hemisphere-west` "Export-restricted only" → flips `plm.restricted`.
- "Clear filters" ghost (`plmHasFilter`) → resets type/status/pu/mb/restricted/q.
All setters merge into `state.plm` (`setPlm`).

### 3.6 Catalogue table (2557–2579)
Card title «Parts catalogue» (Catalogue articles), right `plmCount` = "N of 54 parts".

| Column | Sort key | Content |
|---|---|---|
| Reference | `ref` | as BOM |
| Part | `name` | name |
| Type | `type` | 12px neutral-300 |
| Make / buy | — | |
| PU/PR | — | tag |
| Manufacturer | — | mfr / mfrRef (neutral-400) stacked, 12px |
| Unit price | `price` (first click desc) | `money$(price)` |
| «Discipline lead» (sic) | — | **lead time** "N wks" or — |
| Status | `status` | tag + open-ECO outline button (as BOM) |
| Restrictions | — | as BOM |
| Used in | — | "N project(s)" or — |

Sort stored in `plm.sort`/`plm.dir` (`plmSortBy`, 4275). Row click → toggle `part`.
Computed but **not rendered**: `plmTypeChips`, `plmStatusChips`, `plmMbSeg`, `plmPuChips`.

### 3.7 "New part" form (`AF.plm`)
Title "New part", submit "Create part". Fields: `ref` Reference (text, required) · `name` Designation (text, required) · `family` Family (Structure / Mechanical / Electrical / Automation / Consumable) · `supplier` Preferred supplier (text) · `price` Unit price (€) (number) · `unit` Unit (pc / m / kg / set). Toast "Part created in the catalogue". **No part is created.**

---

## 4. Engineering change orders — `eco`

### 4.1 Key & access
`isEco` (5185). Nav: Technical reference › "Change orders (ECO)" (`ph-git-branch`), badge = number of ECOs with derived status "In approval" (initial 1). Roles: director, pm, englead, quality, procurement. Portfolio-wide. `startScreen` supported.

### 4.2 Purpose
Controlled engineering changes on catalogue parts/assemblies: impact analysis (projects, open POs, stock, cost, schedule, documents), interchangeability decision, effectivity per target (open project BOMs and machines already in service), and a three-party approval (engineering lead, quality ISO 9001, PMs of impacted projects) before release.

### 4.3 Layout (1312–1376)
KPI row (6 tiles) → filter bar → ECO table card → ECO drawer.

### 4.4 Derived ECO model (`allEcos`, 4192–4193; `ecoTargets`, 4187–4191)
For each `ECOS` row, with `o = ecoOverrides[id] || {}`:
- `appr = {...e.appr, ...o.appr}` (`englead`, `quality`, `pm` ∈ `ok` | `pending` | `rejected`).
- `allOk` = the three are `ok`; `anyRej` = any `rejected`.
- `base = o.status || e.status`.
- Targets `tg`:
  - **Projects**: keys = `e.projects` ∪ every project using any ECO part (`usedIn`). For each: `pr = projOf3(key)`; `openBom = OPEN_BOM.includes(pr.status)`; disposition = override `o.disp[key]` → else `e.disp[key]` → else (`openBom` ? `'update'` (auto) : `null`).
  - **Machines**: `FLEET` rows having `AS_MAINT[id]` with any ECO part; `ref` = first ECO part fitted, `rev` = fitted revision. Disposition = override → `e.disp` → else (`interch==='no'` ? `'pinned'` (auto) : `null`).
  - `pending` = number of targets with no disposition; `inter` = `o.interch ?? e.interch ?? null`.
- `locked = allOk && base!=='Draft' && !anyRej && (pending>0 || inter===null)`.
- **Displayed status** = `anyRej` → "Rejected"; else `allOk && base!=='Draft'` → (`locked` ? "In approval" : "Released"); else `base`.
  → Release is automatic once all three approvals are `ok`, interchangeability is set and every disposition is set.

### 4.5 KPI tiles (`ecoKpis`, 4350)

| Label | Value | Sub | Color |
|---|---|---|---|
| Open ECOs / ECO ouverts | status ∉ {Released, Rejected} (3) | "6 in total" | OK |
| Awaiting my approval / En attente de mon approbation | In approval and `appr[ecoRoleKey]==='pending'` (pm: 1; others 0) | "As `<persona role>`" or "Switch to an approver role" | OK |
| Released this month / Diffusés ce mois | count Released (2; **no date filter**) | "Cost impact `money$(Σ cost)`" (€10,360) | OK |
| Projects impacted / Projets impactés | distinct `projects` of open ECOs (2) | "By open changes" | OK |
| Parts under change / Articles en modification | distinct parts of open ECOs (5) | "Frozen for new orders" | always LO |
| Dispositions pending / Dispositions en attente | Σ `tg.pending` over open ECOs (12) | "N release(s) blocked" or "No release blocked" | LO if any locked |

### 4.6 Filter bar (1315–1318)
`ph-funnel` + `FL.status` "Status" chips: All (6) + each `ECO_FLOW` value with count (Draft, Impact analysis, In approval, Released, Rejected) → `ecoFilter`. Right (12px neutral-400): «Draft → impact analysis → approval (engineering lead · quality · PMs impacted) → released».

### 4.7 ECO table (1319–1345)
Card title «Engineering change orders», hint «Click an ECO for its impact analysis». Columns:

| Column | Content |
|---|---|
| ECO | id, 12px 500 tabular; accent-300 when selected |
| Change | title (max-width 340, pretty) + 11.5px neutral-400 "`by` · `date`" |
| Type | `ECO_TYPES[type]`: Part revision / BOM substitution / Assembly structure / Supplier / make-buy / Obsolescence notice |
| Parts | first two refs + " +N" |
| Projects | `PROJ_NAMES[k]` joined ", " (e.g. "Harbor Line, Clinique Pasteur Lyon") |
| Cost | `+money$(cost)` or — (right) |
| Schedule | "+N d" / "-N d" or — (right) |
| Approvals | three 8px dots + labels "Eng.", "Quality", "PM": ok → accent, rejected → neutral-100, pending → neutral-700 |
| Status | status tag; if `pending > 0` and status ∉ {Draft, Rejected, Released}: 11px accent-300 line with `ph-lock-simple` (locked) or `ph-hourglass` + "N disposition(s) pending" |
| (actions) | Draft → "Start impact analysis" (secondary) → `ecoOverrides[id].status='Impact analysis'`; Impact analysis & `inter===null` → non-clickable tag-accent "Set interchangeability"; Impact analysis & inter set → "Submit for approval" (primary) → status 'In approval'. Buttons stop row propagation. |

Row click toggles `eco`. Empty: «No ECO in this status».

Initial rows (derived):

| ECO | Type | Status | Interch. | Pending dispositions |
|---|---|---|---|---|
| ECO-2026-014 Gantry crane rev C — VFD redundancy, HMI 15″, gen-2 detectors | Assembly structure | Released | no | 0 (MCH-029, MCH-022 auto-pinned) |
| ECO-2026-015 Replace CD-200 smoke detector by CD-210 in all open designs | Obsolescence notice | In approval (PM pending) | yes | 3 (RCF, MCH-041, MCH-022) |
| ECO-2026-016 Disc brake SF 30 — supplier qualification & torque spec | Supplier / make-buy | Impact analysis | not assessed | 4 machines |
| ECO-2026-017 Bearing 22326 CC/W33 → Schaeffler equivalent (lead time) | BOM substitution | Draft | yes | 5 machines |
| ECO-2026-012 Stainless bracket rev 2 — thicker gauge after vibration test | Part revision | Released | yes | 0 |
| ECO-2026-011 Anemometer added to controls & safety assembly | Assembly structure | Rejected (quality) | yes | — |

### 4.8 ECO drawer (`showEco`, 1346–1373; `ecoVals` 4352–4369)
Header: id (`margin-right:auto`), `tag-neutral` type, status tag, close (`closeEco` → `{eco:null}`). Title.
**Step indicator**: `ECO_FLOW.slice(0,4)` (Draft → Impact analysis → In approval → Released): 10px dot (accent if index ≤ current, else neutral-700; all neutral-700 when Rejected), label (text / neutral-500), 36×1px connector neutral-800; right "Raised by `by · date`".
Single-column grid gap 18:

1. **Impact analysis** (k/v; key `flex:none`): Projects & BOMs (project names) · Open purchase orders (POs from `genPOs` across all projects containing an ECO part and not Received/Cancelled, "`id` · `supplier` · `status`", joined " · " or "None") · Stock to scrap / rework (`stock`) · Cost delta (`+money$` or "None"; LO if cost > 5000) · Schedule delta ("±N days" or "None") · Documents to update (`docs` joined " · ").
2. **Parts concerned**: buttons ref / name / part status tag → `{screen:'bom', part:ref, bomView:'flat'}`.
3. **Effectivity & dispositions** (Effectivité et dispositions): header right `revText` = "`parts[0]` · `from` → `to`" + tag (`pendText` "N disposition(s) pending" accent / "All dispositions set" neutral).
   - Interchangeability row: if `canSetInterch` a segmented control (`ph-arrows-left-right` "Interchangeable" | `ph-link-break` "Not interchangeable") → `ecoOverrides[id].interch`; then the current tag (`interchLabel`) and hint (11.5px neutral-400, `flex:1 1 220px`):
     - yes: "Form-fit-function with the previous revision — fits every machine and BOM; each target still needs a disposition."
     - no: "Does not fit previous generations — machines in service keep their revision (pinned); open BOMs take the new one."
     - null: "Decide interchangeability with the previous revision before submitting for approval."
   - Locked banner (`isLocked`): accent-900 box, `ph-lock-simple`, «Release locked until interchangeability and every disposition are set.»
   - **Projects & BOMs · N** (11px uppercase neutral-500): per target: button (name `PROJ_NAMES[k]`, sub "`code` · Open BOM|Frozen BOM · `stage` · `PM`") → `{screen:'bom', project:code, projMenu:false, bomType:null, eco:null, part:null}`; right revText (update: "from → to"; na: "—"; else "from") and disposition tag (`DISP_L`: Update / Pinned / Retrofit / Not applicable, or "Pending"). Second line: «Decided by» "PM" + note (`dnote` or "Design phase — updated automatically" when auto) and, if `canDecide`, seg Update | Pin | N/A → `ecoOverrides[id].disp[key]`.
   - **Installed base · N**: per machine: name (`FLEET[2]`), sub "`MCH-id` · `client` · `Gen n` · `warranty start` · `warranty status`", revText "`ref` rev `X`", tag; «Decided by» "Quality + Eng. lead" + note (or "Not interchangeable — pinned automatically"); seg Update | Pin | Retrofit | N/A when `canDecide`; click → `{screen:'fleet', eco:null, part:null}`. Empty «No machine in the installed base carries these parts.»
   - Retrofit banner (any retrofit): neutral-900 box `ph-wrench` «Retrofit interventions are planned manually in After-sales.» + ghost «Plan intervention» `ph-arrow-right` → `{screen:'sav', savView:'interventions', eco:null}`.
   - Pinned banner (any pinned): `ph-package` «Pinned revisions keep their spare parts and stock — do not scrap:» + list "MCH-029 (ASM-RMG-250 rev B) · …".
4. **Approvals**: three rows (grid `minmax(0,1fr) auto`): Engineering lead / Antoine Girard; Quality (ISO 9001) / Gabriel Comte; PM of impacted projects / PMs of the ECO projects (`projOf3(k).pm`, e.g. "R. Aubert, C. Moreau"). Right: if `canAct` (status In approval, this key pending, persona's key) "Reject" (ghost) + "Approve" (primary `ph-check`) → `ecoOverrides[id].appr[key] = 'rejected' | 'ok'`; state tag. Footer hint `roleHint`: "Approvals open once the impact analysis is submitted." (not In approval) / "Switch to Engineering lead, Quality or Project manager (bottom-left) to approve." (non-approver persona) / empty.

### 4.9 "New ECO" form (`AF.eco`)
Title "New ECO", submit "Open ECO". Fields: `title` Title (required) · `parts` Parts affected (text, required) · `reason` Reason (Client request / Non-conformity / Cost reduction / Design error / Supplier change) · `impact` Impact (Drawings only / Drawings + BOM / Drawings + BOM + purchasing) · `desc` Description. Toast "ECO opened · in approval". **No ECO is created.**

---

## 5. Drawings — PDM vault — `drawings`

### 5.1 Key & access
`isDrawings` (5185). Nav: Technical reference › "Drawings" (`ph-blueprint`). Roles: director, pm, englead, quality. Portfolio-wide. `startScreen` supported.

### 5.2 Purpose
Read-only mirror of the SolidWorks PDM vault: drawings linked to catalogue parts with revision, lifecycle state, author and driving ECO. Revisions are changed in the vault, not in Keystone.

### 5.3 Layout (1377–1419)
KPI row → filter bar → register card → drawing drawer.

### 5.4 KPI tiles (`dwgKpis`, 4376)

| Label | Value | Sub | Color |
|---|---|---|---|
| Drawings in vault / Plans dans le coffre | "1 248" (hard-coded) | "13 linked to catalogue parts" | OK |
| Released | 10 | "Current revision" | OK |
| WIP / under review / En cours / en revue | 2 | "Linked to open ECOs" | OK |
| Obsolete still referenced / Obsolètes encore référencés | 1 | "Superseded by rev 2" | always LO |
| Last vault sync / Dernière synchro coffre | "07:40" (hard-coded) | "SolidWorks PDM · today · read-only" | OK |

### 5.5 Filter bar (1380–1383)
`ph-funnel` + `FL.state` "State" (État) chips: All (13), Released (10), WIP (1), Under review (1), Obsolete (1) → `dwgState`. Right: search (min-width 260, placeholder «Drawing number, title or part») → `dwgQ`, matches `no + title + part`.

### 5.6 Register table (1385–1403)
Card «Drawing register», right hint `ph-arrows-clockwise` «Mirrored from SolidWorks PDM — revisions are changed in the vault».

| Column | Content |
|---|---|
| Drawing | `no`, 12px 500 tabular; accent-300 when selected |
| Title | title + 11.5px neutral-400 vault path |
| Part | part ref (tabular) + part name (neutral-400, ellipsis, max-width 180) |
| Rev | rev letter |
| State | drawing tag |
| Checked in | "`by` · `date`" (12px neutral-300) |
| ECO | id or — |

Row click toggles `dwg`. Empty «No drawing matches».

### 5.7 Drawing drawer (`showDwg`, 1405–1415; `dwgVals` 4378–4379)
Header: "`no` · rev `X`" (nowrap), state tag, close (`closeDwg`). Title.
- Preview: `aspect-ratio:4/3` `<image-slot id="dwg-<no>" shape="rounded" radius="8" fit="contain" placeholder="Drop the PDM preview (PDF / PNG export)">` — design-time drop target; production must show the PDM preview/thumbnail.
- Meta k/v: Part ("ref · name") · Vault path (`path + no + '.SLDDRW'`) · Checked in by ("by · date") · Linked ECO (or "None") · Formats ("SLDDRW · PDF · DXF") · Part status.
- **Revision history** (Historique des révisions): letters A…current rev (A–D only), newest first; grid `auto minmax(0,1fr) auto`: "Rev X" · "Current · `date`" (first) / "Superseded" · ECO (first) / —. (Synthesised, not real history.)
- Buttons: "Part record" (secondary `ph-cube`) → `{screen:'bom', part, bomView:'flat'}`; "Open ECO" (secondary, if linked) → `{screen:'eco', eco}`; "Open in PDM" (ghost `ph-arrow-square-out`) — **no handler**.

### 5.8 "Sync vault" form (`AF.drawings`, kind run)
Fields: `source` Source (SolidWorks 3DX vault / SeeElectrical / Both) · `scope` Scope (Current project / All projects). Submit "Synchronise" (`ph-play`) → toast "Vault synchronised · 6 drawings updated". No data change.

### 5.9 SolidWorks PDM connector
`CONNECTORS` row (3570): `['SolidWorks PDM', 'Drawings, revisions, released states', 'Hourly', 'OK', '26 Sep 07:40', '1 248 drawings · 13 linked']` — shape `[system, data scope, frequency, status, last sync, volume]`, shown on the Activity & integrations screen. Other references: crumb "SolidWorks PDM"; mechanical tool "SolidWorks 3DX" (`ENG_DISC.meca`, `ENG_TOOLS[1]` "SolidWorks 3DX — BOM export"); "Add connector" form option "SolidWorks 3DX". Integration contract implied: hourly one-way import of drawing number, title, linked part ref, revision, state (Released / WIP / Under review / Obsolete), vault folder, last check-in user/date, linked ECO, file formats, preview.

---

## 6. P&ID — tags, overlay & process validation — `pid`

### 6.1 Key & access
`isPid` (5213). Nav: Project › Project engineering › "P&ID validation" (`ph-flow-arrow`), badge = Keystone-scope tags not Linked when coverage < 100 % (initial 9). Roles: director, englead, quality (**not pm**). Project-scoped. `startScreen` supported. Content only for `project==='HLT-026'` (`isPidProj`); other projects: «No P&ID registered for this project yet — import the tag list from the drawing to start the validation.»

### 6.2 Purpose
Check the P&ID tag list (instruments, equipment) of a process project against the project BOM before release for construction: every tag in Keystone scope must map to a validated BOM reference; overlay (instruments Keystone fits on client-supplied equipment) must be agreed with the client; PLC-wired actuators need a state feedback.

### 6.3 Layout (2472–2534)
KPI row → two cards (grid `repeat(auto-fit,minmax(min(100%,380px),1fr))`): P&ID drawing | Process validation → filter bar → tag register card → overlay card → tag drawer.

### 6.4 KPI tiles (`pidKpis`, 4776)

| Label | Value | Sub | Color |
|---|---|---|---|
| P&ID | "PID-HLT-026 rev C" | "4 sheets · Under review · 12 Sep 2026" | OK |
| Tags in our scope / Tags dans notre périmètre | non-Client tags (22) | "5 overlay · 2 client-supplied" | OK |
| Linked to a BOM reference / Liés à une référence | `round(linked / ksTags × 100)%` (59%) | "13 / 22 tags" | LO if < 100 |
| Unmapped tags / Tags non associés | 6 | "Blocks release for construction" | LO if > 0 |
| Reference issues / Anomalies de référence | not Linked and not Unmapped (3) | "Not in BOM · outdated · not validated" | LO if > 0 |

### 6.5 P&ID drawing card (2477–2484)
Title "P&ID drawing · `PID.doc` rev `PID.rev`" (FR "Schéma PID"), sub «Drop the P&ID export · tags are extracted from the drawing and matched against the project BOM»; secondary «Open in PDM» (`ph-arrow-square-out`, no handler). Image slot `id="pid-hlt-026"`, `aspect-ratio:16/8`, placeholder «Drop the P&ID (PDF / PNG) — sheets 1–4». Legend (11.5px): `tag-neutral` "Keystone" «our supply» · `tag-accent` "Overlay" «our sensors on client equipment (surcouche)» · `tag-outline` "Client" «client-supplied equipment — no BOM reference expected».

### 6.6 Process validation card (2482–2485)
Title «Process validation», sub «Release for construction needs 100 % of our tags linked and the overlay agreed with the client». Rows from `PID_STEPS` via `pidSteps` 4777 (grid `12px minmax(0,1fr) auto`): 10px dot (done accent, doing accent-600, todo neutral-700), label (neutral-500 when todo), "who · date", state tag (Done / In progress / To do):
1. Tags extracted from P&ID rev C — done — 12 Sep — P. Noguès
2. Tag ↔ BOM reference mapping — doing — A. Girard
3. Overlay scope agreed with client — todo — R. Aubert · N. Bensaïd
4. Process validation review (HAZOP light) — todo — Quality · Engineering
5. P&ID released for construction (rev D) — todo — A. Girard

Static (no interaction).

### 6.7 Filter bar (2487–2491)
`ph-funnel` `FL.status` chips: All (24) + statuses present, in order Linked (13), Unmapped (6), Not in BOM, Part not validated (2), Part outdated (1), Part obsolete, Client (2) → `pidFilter`. `ph-stack` `FL.scope` "Scope" seg: All scopes / Keystone / Overlay (surcouche) / Client → `pidScope`. Search (min-width 240, «Tag, description or reference») → `pidQ`, matches tag + desc + ref + PLC label + feedback text.

### 6.8 Tag register (2492–2513)
Card «Tag register — P&ID ↔ BOM», hint «Click a tag to map it to a reference».

| Column | Content |
|---|---|
| Tag | tag, 500 tabular; accent-300 when selected |
| Description | pretty |
| Kind | Instrument / Equipment |
| Scope | scope tag |
| PLC | `P`/`S` → tag (Process PLC neutral, Safety PLC accent); `L` → plain "Local"; empty → "—" (neutral-500) |
| State feedback | `fb` text; actuator wired to P/S PLC without `fb` → `ph-warning` + "Missing" in accent-300; `—` neutral-500 otherwise |
| BOM reference | ref (tabular 12px) or —; second line part name (or, for Client tags, the note "Client scope — free issue") |
| Activity | "`act` · `activity name`" (`ALL_BYID`), ellipsis max 200 |
| Status | P&ID status tag |

Status derivation (`tagStatus`, 4766), with `ref = pidOv[tag] ?? t.ref`: Client scope → "Client"; no ref → "Unmapped"; ref not in `PARTS` → "Unknown ref"; ref not in current project BOM → "Not in BOM"; part not Validated → "Part " + status lower-case ("Part not validated" / "Part outdated" / "Part obsolete"); else "Linked".
Row click toggles `pidTag`. Empty «No tag matches».

### 6.9 Overlay card (2514–2517)
Title «Overlay (surcouche) — client equipment secured by Keystone», sub «The client supplies the equipment, Keystone supplies and wires the instruments · this list is agreed and signed with the client»; secondary «Export overlay list» (`ph-file-pdf`, no handler). Table 12.5px: Tag · Description · Supplied by (scope tag) · BOM reference · Status — rows = tags with scope Overlay or Client (7). Row click → tag drawer.

### 6.10 Tag drawer (`showPidTag`, 2518–2529; `pidTagVals` 4781)
Header "`tag` · `kind`", scope tag, status tag, close (`closePidTag`). Title = description.
- **Tag record** (Fiche tag) k/v: Reference · Part · Activity · PLC · State feedback · Sheet ("PID-HLT-026 · sheet `1 + index % 4`") · Scope ("Overlay — Keystone sensor on client equipment" / "Client-supplied equipment (free issue)" / "Keystone supply").
- **Map to a BOM reference** (if scope ≠ Client): up to 8 candidates = current-project BOM parts of compatible type (Instrument → Electronics, Electrical, Fire & safety; Equipment → Electrical, Mechanical, Heavy equipment, Assembly), in `PARTS` order; row ref / name / part status tag → `pidOv[tag] = ref`. Hint «Candidates are BOM articles of a compatible type · pick one to link the tag».
- Client info banner (accent-900, `ph-info`): «Client-supplied equipment: no BOM reference expected. Its overlay instruments are listed as separate tags in Keystone scope.»
- Feedback warning (neutral-900, border accent-800, `ph-warning`): «Actuator wired to the PLC without state feedback — add a position or run-status sensor before release for construction.» (initially XV-111).
- Buttons: if a part is resolved: «Part record» (secondary `ph-cube`) → `{screen:'plm', part:ref}`, «Unlink» (ghost) → `pidOv[tag] = ''`; if status "Not in BOM": «Add reference to project BOM» (primary `ph-plus`) → `{screen:'bom'}` only.

### 6.11 "Import P&ID tags" form (`AF.pid`, kind run)
Fields: `file` File (text, default "PID-HLT-026_revE_tags.xlsx") · `rev` Revision (text, default "E", required) · `source` Source (AutoCAD P&ID export / Excel list) · `mode` Mode (Add & update / Replace all). Submit "Import tags" → toast "27 tags imported · rev `<rev>` · 3 new · 1 updated". No data change.

---

## 7. Engineering synthesis — `eng`

### 7.1 Key & access
`isEng` (5197). Nav: Project › Project engineering › "Synthesis" (`ph-squares-four`), badge = open blocking checks (initial 4), HLT-026 only. Roles: director, pm, englead, quality. Not a `startScreen` option. Content only for HLT-026 (`isEngProj`); else «No engineering register for this project yet — import the first list to start.»

### 7.2 Purpose
Cross-discipline engineering register of a project during *Etudes*: which discipline (process, mechanical, electrical, automation) consumes which revision of whose documents, what is outdated, which inconsistencies between business-tool exports (AutoCAD P&ID, SolidWorks 3DX, SeeElectrical, TIA Portal) block the gate "Plans & BOM frozen", and what changed recently. Files stay in the business tools; Keystone holds revisions and statuses.

### 7.3 Layout (2384–2417)
KPI row (4) → "Who is waiting for what" matrix card → two cards (grid `repeat(auto-fit,minmax(min(100%,380px),1fr))`): Disciplines | Gate → Recent changes card.

### 7.4 KPI tiles (`engKpis`, 4803)

| Label | Value | Sub | Color |
|---|---|---|---|
| Blocking inconsistencies / Incohérences bloquantes | open blocking checks (4) | "block the gate «Plans & BOM frozen»" or "gate «Plans & BOM frozen» can pass" | LO if > 0 |
| Outdated inputs / Entrées périmées | inputs outdated (4) | "across the 4 disciplines" | LO if > 0 |
| Deliverables released / Livrables diffusés | "6 / 13" | "`n` awaiting PM validation" (Release proposed) | OK |
| Outputs ready / Sorties prêtes | "2 / 6" | "`n` blocked by inconsistencies" | LO if not all ready |

### 7.5 "Who is waiting for what" matrix (2388–2397; `engMatrix` 4801)
Card title «Who is waiting for what» (Qui attend quoi de qui), sub «Rows receive, columns provide · one pill per document: revision in use vs latest released». Legend (11px): 8px dots — «Up to date» neutral-300, «To confirm» neutral-500, «Outdated» accent, «Awaited» hollow 1px neutral-600.
Grid `110px repeat(5,minmax(130px,1fr))`, gap 6, `min-width:820px` (card scrolls horizontally).
- Header row: empty + columns FROM = Client, Process, Mechanical, Electrical, Automation (10.5px uppercase neutral-400).
- Rows TO = Process, Mechanical, Electrical, Automation, Purchasing, Site, Client (12.5px neutral-200).
- Cell (min-height 40, radius-md, padding `5px 6px`, flex-wrap gap 4): bg transparent on the diagonal; `neutral-900` with items; `color-mix(neutral-900 45%, transparent)` when empty.
- Pill: 11px, padding `2px 7px`, radius 9px, 1px border, dot 7px; text "`shortDoc` · `sub`" (`shortDoc` strips "-HLT-026"/"-026", e.g. "PID", "LST-INS", "BOD-CLI").
  - TO is a discipline: one pill per `ENG_INPUTS` of that discipline whose provider = FROM. Outdated → text accent-200, border accent-700, dot accent, sub "rev X → Y"; acknowledged → neutral-200 text, dot neutral-300, sub "rev X"; to confirm → neutral-400 text, dot neutral-500.
  - TO is Purchasing/Site/Client: one pill per `ENG_DOCS` of discipline FROM whose recipients include TO. Released → neutral-200 text, filled neutral-300 dot, sub "rev X"; otherwise neutral-400 text, hollow dot (border neutral-600), sub = status ("Draft", "Frozen"…).

### 7.6 Disciplines card (2399–2402; `engDiscCards` 4798)
Title «Disciplines», sub «Referent proposes · project manager validates BPE releases». One button per discipline (grid `auto minmax(0,1fr) auto`, padding `9px 6px`, top border neutral-900, hover neutral-900): icon 18px accent (`ENG_DISC[k][1]`), label (13px), "`lead` · `tools`" (11.5px neutral-400), 3px progress bar (track neutral-800, fill accent, width = released/total %); right: "`rel` / `total` released", "`open` open · `blocking` blocking" (accent-300 if blocking). Click → `{screen:'eng-<k>', engChkF:null}`.
Initial: Process 3/3 (100 %) · 1 open · 0 blocking; Mechanical 2/3 · 1 · 0; Electrical 0/4 · 4 · 2; Automation 0/3 · 3 · 2.

### 7.7 Gate card (2403–2406)
Title «Gate · Plans & BOM frozen» (Jalon · Plans & nomenclature gelés), sub «Blocking inconsistencies must be resolved before the gate»; right tag `engGateText`: "Blocked by N blocking inconsistencies" (accent) / "Ready to pass" (neutral). Items = first 6 open blocking checks: 10px severity dot, title (12.5px), "`id` · `rule label` · `lead`" (11px), status tag. Click → `{screen:'eng-<disc>', engChkF:null}`.

### 7.8 Recent changes card (2408–2411)
Title «Recent changes & impact». Rows (grid `64px minmax(0,1fr) auto`): date (neutral-400), text, «Impacts» recipients labels (`ENG_CHANGES`):
- 26 Sep · P&ID rev D released · +3 tags (LSL-201, XV-112, TT-201) · Electrical · Automation
- 24 Sep · PLC variable table rev A imported · 2 mismatches vs I/O list · Electrical
- 22 Sep · Mechanical BOM rev D frozen · 148 articles · Purchasing
- 18 Sep · Motor list rev B · M-310 160 kW confirmed · Electrical

---

## 8. Engineering discipline screens — `eng-process`, `eng-meca`, `eng-elec`, `eng-auto`

### 8.1 Key & access
`isEngDisc = !!engScreens[screen]` (4784–4785, 5197). Nav: Project › Project engineering › Process (`ph-flow-arrow`) / Mechanical (`ph-gear`) / Electrical (`ph-lightning`) / Automation (`ph-cpu`); badge = open blocking checks owned by the discipline (elec 2, auto 2). Roles: director, pm, englead, quality. HLT-026 only (same empty state as §7).

### 8.2 Purpose
Workspace of one discipline referent: confirm consumption of incoming documents, manage own deliverables up to BPE release (PM validates), generate lists for downstream services, and resolve inconsistencies detected at each import.

### 8.3 Layout (2418–2451)
Header line (12.5px neutral-400): discipline icon 20px accent; «Discipline lead» + lead name; «Tools» + tool names; right «Referent proposes · project manager validates BPE releases».
KPI row (4) → grid `repeat(auto-fit,minmax(min(100%,620px),1fr))`: Inputs | Deliverables → same grid: Generated outputs | Consistency checks.

`ENG_DISC`: process — Pauline Noguès — AutoCAD P&ID; meca — Julien Wagner — SolidWorks 3DX; elec — Sami Haddad — SeeElectrical; auto — Claire Morvan — TIA Portal · EcoStruxure.

### 8.4 KPI tiles (`engDKpis`, 4811)

| Label | Value | Sub | Color |
|---|---|---|---|
| Inputs up to date / Entrées à jour | "`up` / `n`" | "`n` to confirm" | LO if up < n |
| Deliverables released | "`rel` / `n`" | "`n` frozen" | OK |
| Open inconsistencies / Incohérences ouvertes | open checks **owned** by the discipline | "`n` blocking" | LO if blocking |
| Outputs ready | "`ready` / `n`" | "`n` blocked" | LO if not all |

### 8.5 Inputs table (2425–2429; `inRows` 4794)
Card «Inputs», sub «Documents received from other disciplines · revision in use vs latest released», button «Import a list» (secondary `ph-upload-simple`) → `openEngImp` (discipline + doc `GA-HLT-026` for process, else `LST-INS-026`).
Columns: Document (id 500 tabular + title 11px) · Issued by (provider label) · Rev in use ("rev X", accent-300 if outdated) · Latest ("rev Y") · State tag · actions: "Confirm" (secondary; when not outdated and not acknowledged) → `engOv.inputs['disc|doc'] = {rev, ack:true}`; "Import new rev" (primary; when outdated) → wizard preset to this disc/doc.
Formulas: `rev = override.rev ?? input.rev`; `ack = override.ack ?? input.ack`; `latest` = provider doc's rev if its (overridden) status is Released, else `prevRev(rev)` (previous letter; "A" stays "A"); for docs outside `ENG_DOCS` (client BOD) latest = rev in use. State: `rev ≠ latest` → Outdated; else ack → Up to date; else To confirm.

### 8.6 Deliverables table (2430–2434; `docRows` 4791)
Card «Deliverables», sub «Own documents · files stay in the business tool, Keystone holds revision and status». Columns: Document (id + "title · date · by") · Rev · Status tag · Recipients (`ENG_RCP` labels joined " · ", max-width 160) · actions:
- Draft → "Freeze" (ghost) → `engOv.docs[id] = 'Frozen'`.
- Frozen and no open blocking check owned by the discipline → "Propose release" (secondary) → `'Release proposed'`.
- Frozen with blocking checks → 11.5px accent-300 `ph-warning` "Release blocked · N blocking".
- Release proposed → "Validate release (PM)" (primary) → `'Released'` (no role check).
`engOv.docs` is the same map the Codex vault uses, so statuses stay in sync with the Documents screen.

### 8.7 Generated outputs (2437–2440; `outRows` 4795)
Card «Generated outputs», sub «Lists Keystone produces from imported data for the next service». Rows: "`name` → `recipients`", «Source» · source, optional `genText` (accent-300, "Generated today · xlsx"); right state tag (Blocked shows "Blocked · N blocking") + "Generate xlsx" (secondary `ph-file-xls`, when not Blocked) → `engOv.gen[id]`. Derived state: seed state, except "Blocked" becomes "Ready" when the owning discipline has no open blocking check.

### 8.8 Consistency checks (2441–2446; `chk` 4789)
Card «Consistency checks», sub «Run at each import · resolve here or send back to the business tool». Chips (`engChkChips`): All, Open (Open + In progress), Sent back, Resolved (zero-count options hidden except All) → `engChkF`. List = checks where `disc === discipline` **or** the rule pair contains the discipline. Row (grid `10px minmax(0,1fr) auto`): severity dot (blocking accent, warning accent-700, info neutral-600); title (text if open, neutral-500 if closed); detail (11.5px); "`id` · `rule` · `owner` · `lead`" (11px neutral-500); note (accent-300); actions when open: "Resolve here" (secondary) → `{status:'Resolved', note:'Resolved in Keystone'}`; "Send back to tool" (ghost) → `{status:'Sent back', note:'Sent back to tool · closes on next import'}`; right: severity tag + status tag.

### 8.9 Import wizard (`engImpOpen`, 2452–2471; `engImpVals` 4813)
Centered modal: backdrop z 70 (`color-mix(bg 65%)`, click = cancel), card z 71 `width:min(720px,96vw); max-height:92vh; padding:18px 22px; gap:14px`.
Header «Import a list» + target (12px neutral-400) "`doc title` · rev `X` → `<recipient discipline>`" (e.g. "Instrument list · rev D → Electrical"); close.
Stepper: 18px circles numbered 1–3 (bg accent-600 when reached, neutral-700 otherwise), labels Source / Column mapping / Check & import (current accent-200, done text, future neutral-500).
- **Step 1** «Source tool»: radio-like buttons from `ENG_TOOLS` (AutoCAD P&ID — tag list export · Process; SolidWorks 3DX — BOM export · Mechanical; SeeElectrical — device & I/O list · Electrical; TIA Portal — PLC tag table · Automation); selected: bg accent-900, border accent-700, filled accent 12px circle → `engImp.tool`. Drop zone (dashed neutral-700, `ph-file-xls` 26px) «Drop the xlsx / csv export here» + file name "`doc`_rev`X`.xlsx · 27 rows" (static).
- **Step 2**: table Source column → Keystone field (`ENG_MAP`: TAG→Tag, DESCRIPTION→Description, TYPE→Kind, P_KW→Power (kW), SIGNAL→Signal type, ADDR→I/O address) with tag "auto-detected".
- **Step 3**: stats tiles (27 rows; 3 new tags; 1 attribute changed; 0 unknown references), delta rows from `ENG_DELTAS` ("+" new tag ×3, "~" "LT-201 — range 0–5 m → 0–6 m" attribute changed), note «The revision in use is updated · the referent then confirms consumption».
- Footer: Cancel (ghost), Back (step > 1), Next (step < 3), on step 3 «Import · freeze this revision as input» (primary `ph-upload-simple`) → `inputs['disc|doc'] = {rev: doc.rev, ack:false}`; if doc is LST-INS-026 also `inputs['disc|PID-HLT-026'] = {rev:'D', ack:false}`; resolves C-08 (elec) or C-09 (auto) with note "Closed by import of rev X"; closes and resets step to 1. No toast. The imported data itself is static.

---

## 9. Standard machine types — `mtypes`

### 9.1 Key & access
`isMtypes` (5186). Nav: Administration › "Machine types" (`ph-cube`). Roles: director, pm, englead, quality. Not a `startScreen` option.

### 9.2 Purpose
One template per product range (EMP, MEMU, SPUR, AUTRE, R&D): standard phases, cost categories with reference budget, default calendar, ITP inspection systems and the financial REX payment pattern (deposit / delivery / acceptance) inherited by projects of that type at creation (*Initiative*).

### 9.3 Layout (1529–1572)
KPI row → flex wrap gap 14: left list card (`flex:1 1 280px; max-width:360px`) | right column (`flex:999 1 420px`, gap 14): identity card → [Standard phases | ITP systems] grid → Cost categories card → [Financial REX | Projects using this type] grid (grids `repeat(auto-fit,minmax(min(100%,340px),1fr))`).

### 9.4 Data assembly (`MT_ALL`, 5085)
Per code in `MACHINE_TYPES`: `t = NP_TEMPLATES.find(mt===code)`, `rx = REX_FIN[code] || REX_FIN.AUTRE` → `{code, label: code, desc: t.desc, cal: t.cal || 'Standard 5d · 8h', phases: t.phases, cats: t.cats→{name,type,budget}, itp: ITP_TEMPLATES[code], dep, deliv, acc, refs: rx.refs → "code · name · year", active:true, std:true}`; then custom types from `added.mtypes` (`std:false`); then `mtOv[code]` patches merged.

### 9.5 KPI tiles (`mtKpis`, 5089)

| Label | Value | Sub | Color |
|---|---|---|---|
| Machine types / Types de machines | active types (5) | "`n` inactive · `n` custom" | OK |
| Projects covered / Projets couverts | projects whose `PROJ_ID[code].mt` is set / all projects ("6 / 17") | "typed projects inherit the template at creation" | OK |
| Planning templates / Modèles de planning | types with phases / all ("5 / 5") | "phases, cost categories, calendar" | OK if all, else accent-300 |
| ITP systems / Systèmes ITP | Σ ITP systems (17) | "inspection systems across types" | OK |
| REX patterns / Schémas REX | types with REX refs (5) | "deposit / delivery / acceptance" | OK |

### 9.6 List card
Title «Machine types», sub «Standard planning · costs · inspections · financial REX». Items (padding `9px 11px`, radius-md, selected bg accent-900 + `inset 0 0 0 1px accent-700`; hover neutral-900): code (13.5px 500), «Custom» tag-accent if not standard, state tag (Active neutral / Inactive outline); sub "`n` phases · `n` cost categories · `n` ITP systems"; use "`n` project(s)" or "no project". Click → `mtSel`.
Initial: EMP 6·7·6 (1 project, HLT); MEMU 6·6·5 (2: RCF, MSR); SPUR 6·5·4 (1: WSA); AUTRE 5·4·1 (1: NDC); R&D 5·3·1 (1: ERP).

### 9.7 Identity card
Title "`code` · `label`", tag-neutral state, "Deactivate"/"Activate" (secondary, if `mtCanEdit`) → `mtOv[code].active`. Field grid `repeat(auto-fit,minmax(min(100%,220px),1fr))` gap `10px 14px`, inputs min-height 28, 12.5px:
- Code (disabled) · Label → `mtOv.label` · Default calendar select (Standard 5d · 8h / Standard 5d · 8h + Atelier / Site 6d · 10h) → `mtOv.cal` · Description textarea (full width, min-height 56) → `mtOv.desc`.
- **Payment pattern (deposit / delivery / acceptance)**: three number inputs (110px, 0–100) Deposit % / Delivery % / Acceptance % → `parseInt || 0`; "Total `sum` %" + `ph-check-circle` accent if sum = 100, else «Shares must total 100 %» (accent-300). Not blocking (just a warning).

### 9.8 Standard phases / ITP systems cards
Section label + ghost "Add phase" / "Add system" (`ph-plus`, if `mtCanEdit`) → appends "New phase" / "New system". Rows: (phases only) index 22px; text input → replaces item; remove icon button 24×24 `ph-x` (title "Remove") → removes (always visible).

### 9.9 Cost categories card
Section «Cost categories (reference budget, k€)» + "Add category" → `{name:'New category', type:'Labor', budget:'0'}`. Grid `minmax(140px,1fr) 120px 90px auto`: header Category / Type / Budget; rows: name input, type select (Labor / Material / Equipment / Subcontract / Fees), budget number (right) → stored as string, remove. Total row: `f(Σ parseFloat(budget))` (k€; EMP: €1.94M).

### 9.10 Financial REX / Projects using this type
- «Financial REX · reference projects»: rows "HAV001 · Terminal Ouest — Dunkerque · 2023" with remove; empty «No reference project yet · the first closed project of this type will feed it». (`REX_FIN` 4th field — e.g. "29 % deposits · peak M8 · 8 % at SAT" — is not shown.)
- «Projects using this type»: rows name (`pname` "#026 · Harbor Line Terminal Expansion"), "`code` · `stage`"; «Open project» ghost (`ph-arrow-right`, only if the project has `DEFS`) → `{screen:'plan', project}`. Empty «No project of this type yet».

### 9.11 "New machine type" form (`AF.mtype`)
Fields: `code` Code (required) · `label` Label (required) · `base` Copy template from (EMP / MEMU / SPUR / AUTRE / R&D / Blank) · `cal` Default calendar (Standard 5d · 8h / Standard 5d · 8h + Atelier / Chantier 6d · 10h) · `desc` Description. Submit "Create machine type": code → trim, upper-case, spaces → "-"; if unique, push to `added.mtypes` `{code, label, desc, cal, phases/cats/itp/dep/deliv/acc copied from base (Blank: [], [], ['General'], 30/60/10), refs:[], active:true}` and select it; toast "`CODE` · Machine type created"; else toast "Code already used".

---

## 10. Data entities (field level)

### 10.1 Part (`PARTS`, 3343–3398; 54 rows)
Tuple → object: `ref` string (e.g. "EL-VFD-200") · `name` string · `mb` "Manufactured" | "Purchased" · `type` string (13 values, §3.5) · `price` number € (list/standard unit price) · `mfr` string (manufacturer/supplier) · `mfrRef` string (manufacturer reference or Keystone drawing no. for manufactured parts) · `equiv` string[] (equivalent refs) · `hs` string (customs HS code, "n/a") · `restr` string ("None" or export restriction text: "Dual-use — export licence for some destinations", "Encryption module — export notification", "Dangerous goods UN3480 — shipping constraints", "Medical device — CE / FDA registration required", "Anti-dumping tariff applies by origin", "Encryption — export notification") · `status` "Validated" | "Not validated" | "Outdated" | "Obsolete" · `rev` string (letter or "—") · `lead` number (weeks) · `usage` `{[project3]: qty}` (per-project BOM quantity; the prototype's BOM line store) · `pu` "PU" | "PR" | "" (from `WEAR_SPARE`).
Example: `{ref:'EL-VFD-200', name:'Frequency drive 200 kW', mb:'Purchased', type:'Electrical', price:14200, mfr:'ABB', mfrRef:'ACS880-200', equiv:[], hs:'8504.40', restr:'Encryption module — export notification', status:'Validated', rev:'C', lead:9, usage:{HLT:6}, pu:'PR'}`.
Recommended normalisation: Part (catalogue) + ProjectBomLine `{project, partRef, qty, activity?, scope?, note?}` + PartEquivalence.

### 10.2 Supporting part data
- `WEAR_SPARE` `{[ref]: 'PU'|'PR'}`; `PU_LABEL` `{PU:'Wear part (PU)', PR:'Spare part (PR)', '':'—'}`.
- `LAST_PRICE` `{[ref]: number}` last purchase price (15 refs); `lastPrice(p) = LAST_PRICE[ref] ?? price`.
- `STATUS_NOTE` `{Outdated, Obsolete, 'Not validated'}` → banner texts (§2.2).
- `SPARE_LISTS` `{[systemRef]: [partRef, 'PU'|'PR', qtyPerSystem, note][]}` for ASM-RMG-250 (12 lines), ASM-BOG-300 (3), ASM-HST-400 (3), ASM-DRV-700 (3), ASM-CTL-800 (4).

### 10.3 Assembly structure
- `TREE` node `{ref: string, q: number, c?: Node[]}`; `TREES` `{[project3]: rootNode}` (HLT only).
- `REV_DIFF` `{[assemblyRef]: {from, to, date, eco, rows: [line, name, qtyFrom, qtyTo, kind ('Quantity'|'Substitution'|'Added')][]}}`. Line format "`parentRef` / `childRef`" or "`parent` / `old` → `new`".

### 10.4 ECO (`ECOS`, 3432–3438)
`id` "ECO-2026-014" · `title` · `type` key of `ECO_TYPES` (`rev`, `sub`, `asm`, `sup`, `obs`) · `status` ∈ `ECO_FLOW` · `interch` 'yes' | 'no' | null · `from`, `to` (revision/identifier before/after, e.g. "B"→"C", "CD-200"→"CD-210", "SKF"→"FAG") · `disp?` `{[project3 | machineId]: 'update'|'pinned'|'retrofit'|'na'}` · `dnote?` `{[key]: string}` · `parts` string[] · `projects` string[] (3-letter) · `by` person · `date` · `cost` number € · `sched` number days (negative = gain) · `stock` free text · `docs` string[] · `appr` `{englead, quality, pm}` each 'ok'|'pending'|'rejected'.
Override record (`ecoOverrides[id]`): `{status?, interch?, appr?: Partial<appr>, disp?: {[key]: disp}}`.
Derived target: `{kind:'project'|'machine', key, disp, auto:boolean, note, pr?|m?, am?, ref?, rev?, openBom?}`.

### 10.5 Installed base (used by ECO)
- `FLEET` rows `[id, machineType, name, client, location, projectCode, warrantyStart, warrantyEnd, warrantyStatus]` (8 machines).
- `AS_MAINT` `{[machineId]: {gen: 'Gen 1'|'Gen 2', parts: {[ref]: revision}}}` — as-maintained configuration (6 machines).

### 10.6 Drawing (`DRAWINGS`, 3439–3453; 13 rows)
`no` "DWG-AS-9000" · `title` · `part` ref · `rev` letter · `state` 'Released'|'WIP'|'Under review'|'Obsolete' · `path` vault folder ("Cranes/RMG-250/") · `by` · `date` ("12 Sep") · `eco` id or ''.

### 10.7 P&ID
- `PID` `{code:'HLT-026', doc:'PID-HLT-026', rev:'C', date:'12 Sep 2026', sheets:4, by:'Pauline Noguès', checker:'Antoine Girard', status:'Under review'}`.
- `PLC_LABEL` `{P:'Process PLC', S:'Safety PLC', L:'Local'}`.
- `PID_TAGS` (24) `{tag, desc, kind:'Instrument'|'Equipment', scope:'Keystone'|'Overlay'|'Client', ref (part ref or ''), note, act (activity id), plc:'P'|'S'|'L'|'', fb (state feedback text or ''), role:'sensor'|'actuator'|'ctrl'|'passive'}`.
- Override `pidOv` `{[tag]: ref | ''}`.
- `PID_STEPS` `[label, 'done'|'doing'|'todo', date, who][]`.

### 10.8 Engineering register
- `ENG_DISC` `{[disc]: [label, icon, lead, tools]}` for process/meca/elec/auto. `ENG_RCP` labels for recipients: process, meca, elec, auto, client ("Client"), achats ("Purchasing"), site ("Site").
- `ENG_DOCS` = `DOCS` rows with recipients: `{id, disc (= DOCS.svc), title, rev, status ('Draft'|'Frozen'|'Release proposed'|'Released'), date, by, to: recipient[]}` (13 docs: PFD, PID, LST-INS, GA, BOM-MEC, LST-MOT, SCH-ELE, BOM-ELE, LST-IO, LST-CAB, FDS, VAR-PLC, HMI).
- `ENG_INPUTS` `{disc (consumer), doc, rev (in use), ack:boolean, from? (provider when doc is external, e.g. 'client'), title?}` (12).
- `ENG_RULES` `{pair: label}`: process-meca, process-elec, elec-auto, process-auto, meca-elec, revision.
- `ENG_CHECKS` `{id, pair, sev:'blocking'|'warning'|'info', title, detail, disc (owner), status:'Open'|'In progress'|'Resolved'}` (10; 4 open blocking).
- `ENG_OUTPUTS` `{id, disc, name, to: recipient[], source, state:'Ready'|'Partial'|'Blocked'|'Stale'}` (6).
- `ENG_CHANGES` `[date, text, recipients csv]`; `ENG_TOOLS` `[label, disc]`; `ENG_MAP` `[sourceColumn, keystoneField]`; `ENG_DELTAS` `['+'|'~', label, kind]`.
- `engOv`: `docs {[docId]: status}`, `inputs {['disc|doc']: {rev, ack}}`, `checks {[id]: {status, note}}`, `gen {[outputId]: text}`; plus Codex-owned `appr`, `ack`, `dl`, `obs`.

### 10.9 Machine type
`{code, label, desc, cal, phases: string[], cats: {name, type ('Labor'|'Material'|'Equipment'|'Subcontract'|'Fees'), budget (k€, string after edit)}[], itp: string[], dep, deliv, acc (% numbers), refs: string[], active: boolean, std: boolean}`. Sources: `MACHINE_TYPES`, `NP_TEMPLATES` (`mt`, `desc` (French), `cal`, `phases`, `cats`), `ITP_TEMPLATES`, `REX_FIN` `{[mt]: {dep, deliv, acc, refs: [projectCode, name, year, comment][]}}`, `PROJ_ID[code].mt`.

### 10.10 Project data provider
`projectData(code, p)` returns `HLT_PD` for HLT-026 (3308) or a generated object cached in `PD_CACHE` (3309) with, among others, `p3` (3-letter key used by `usage`, `TREES`, ECO projects) and `ACTS` (activities). `ALL_BYID` (3340) = every activity with an id across all `DEFS` projects (used for P&ID activity labels).

---

## 11. Status machines / workflows

**ECO_FLOW** (`ECO_FLOW` 3431; actions §4.7–4.8):
`Draft` —"Start impact analysis"→ `Impact analysis` —[interchangeability set] "Submit for approval"→ `In approval` —[englead ok ∧ quality ok ∧ pm ok ∧ interchangeability set ∧ 0 pending dispositions]→ `Released` (automatic). Any approver "Reject" → `Rejected` (terminal). With all approvals ok but pending dispositions / interchangeability unset, the ECO stays `In approval` with `locked=true` (lock icon, banner).

**ECO disposition per target**: none (Pending) → Update | Pin(ned) | Retrofit (machines only) | N/A. Automatic defaults: open-BOM project → Update; machine of a non-interchangeable ECO → Pinned. Editable until Released/Rejected (projects: pm/director; machines: quality/englead/director).

**Interchangeability**: not assessed → Interchangeable | Not interchangeable (editable in Draft/Impact analysis by englead/quality/director).

**Installed-base part state** (part drawer): Latest → Update planned → (on release) Latest; Decision pending; Retrofit pending; Pinned.

**Part status**: Validated / Not validated / Outdated / Obsolete — no transition in the UI (driven by ECOs/qualification, OPEN QUESTION).

**Project BOM openness**: stage ∈ {Initiative, APS, APD, Etudes} → Open BOM; later stages → Frozen BOM.

**Drawing state** (mirrored from PDM): WIP → Under review → Released → Obsolete.

**P&ID tag status** (derived): Client | Unmapped | Unknown ref | Not in BOM | Part not validated/outdated/obsolete | Linked; transitions via map/unlink (`pidOv`).

**P&ID process validation**: Tags extracted → Tag ↔ BOM mapping → Overlay agreed with client → HAZOP-light review → Released for construction (static list; gate = 100 % Keystone tags Linked + overlay agreed).

**Engineering deliverable**: `Draft` —Freeze→ `Frozen` —Propose release [no open blocking check of the discipline]→ `Release proposed` —Validate release (PM)→ `Released`.

**Engineering input**: `To confirm` —Confirm→ `Up to date`; provider releases a newer rev → `Outdated` —Import (wizard)→ `To confirm`.

**Consistency check**: `Open` / `In progress` —Resolve here→ `Resolved`; —Send back to tool→ `Sent back`.

**Engineering output**: Ready / Partial / Stale / Blocked; Blocked → Ready when the owning discipline has no open blocking check; Generate xlsx stamps "Generated today · xlsx".

**Gate "Plans & BOM frozen"**: Blocked while any open blocking check exists → "Ready to pass".

**Import wizard**: step 1 Source → 2 Column mapping → 3 Check & import → finish (closes, step reset).

**Machine type**: Active ⇄ Inactive.

---

## 12. Cross-links

| From | To | Trigger / state |
|---|---|---|
| BOM, PLM (status ECO tag) | ECO drawer | `openEcoScreen(id)` → `{screen:'eco', eco, part:null, dwg:null}` |
| BOM tree node | Part drawer / Drawings / ECO | §1.6.2 |
| Part drawer | PLM, BOM (other project), BOM PU/PR list, ECO, Fleet, Codex docs, Codex deposit wizard | §2.2 |
| ECO drawer | BOM (part / project), Fleet, After-sales interventions (`sav`, `savView:'interventions'`) | §4.8 |
| Drawings drawer | BOM part drawer, ECO | §5.7 |
| P&ID tag drawer | PLM part drawer, BOM | §6.10 |
| Engineering synthesis | Discipline screens | discipline cards, gate items |
| Machine types | Plan (project) | "Open project" |
| Home dashboards (4426–4431) | ECO (pm "ECOs in approval", "Approve as PM"; englead "ECOs waiting for engineering"; quality approvals), Drawings (englead watchlist), PLM ("Parts needing action") | `goTo(...)` |
| My approvals (4725) | ECO approve/reject inline, open ECO | same `ecoOverrides` writes |
| Stock (4473, 4489–4490) | `pinnedFor` / pinned warning on scrap; PLM part | |
| Deliveries (4464), RFQ (4657), NCR (4628), Codex article links (5046) | BOM / PLM part drawer; NCR → open ECO for the part | |
| Fleet (4985) | uses `machineCfg` (pending / retrofit / pinned ECO counts per machine) | |
| Purchase orders (`genPOs`) | ECO impact "Open purchase orders", Where-used "Purchase orders"; PO drawer warns on non-validated parts | |
| Codex documents | shares `engOv.docs` statuses with engineering deliverables | |
| Activity & integrations | SolidWorks PDM connector row | |
| Sidebar badges | eng (blocking checks), eng-* (per discipline), pid (unlinked tags), eco (In approval) | `navs` 5150 |

---

## 13. Open questions

1. **Stock in PU/PR list is always 0** (`STOCK_BY_REF`, 4228): the reducer reads `s[0]`/`s[2]` from `STOCK0` rows that were already mapped to objects (`{ref, onHand, …}`), so every line shows "None in stock" and the "Not in stock" KPI counts all lines. Intended rule presumably Σ `onHand` per ref across all locations (or only unreserved / project stock?) — confirm.
2. **"Discipline lead" header vs data** (PLM catalogue and PU/PR list, key `k239`, FR "Référent"): the cells show the part lead time ("9 wks"). Rename to "Lead time" (FR "Délai d’approvisionnement")?
3. **Part drawer section «Freeze» / "Propose release"**: the section lists linked Codex documents and the button opens the Codex deposit wizard with type `CER`. Intended label (e.g. "Documents") and intended document type?
4. **"Raise ECO" / "New ECO" create nothing**: `ecoNew` is set but never consumed; the New ECO form only toasts "ECO opened · in approval" although the flow starts at Draft. Expected: create a Draft ECO prefilled with the part, and map form fields (reason, impact) to the ECO model (no `type` field in the form vs `ECO_TYPES`).
5. **Add article / New part / Sync vault / Import P&ID tags / New ECO** are toast-only. The New part form's "Family" (Structure, Mechanical, Electrical, Automation, Consumable) does not match the catalogue `type` list, and lacks make/buy, manufacturer ref, HS code, restrictions, lead time.
6. **BOM value double counting**: the flat BOM includes both assemblies (ASM-*, with list prices) and their components, so "BOM value" (HLT €14.05M) adds both. Should the flat list/value exclude assemblies or components?
7. **Price basis**: flat list and BOM value use list price; tree roll-up, PU/PR list and revision comparison use last purchase price. Confirm.
8. **Compare revisions**: substitutions show no cost delta even when the new part costs more (only quantity changes are priced). Should substitutions be priced as (new − old)? — **Answered E-2b = a (Delivery 8, R-104):** yes, new qty × new price − old qty × old price (§1.8).
9. **"Under change" in PU/PR list** reads raw `ECOS` statuses, ignoring user overrides; the rest of the area uses derived statuses.
10. **PM approval of multi-project ECOs** is a single `pm` key although several PMs are listed. One approval per impacted PM? Director cannot approve at all.
11. **"Validate release (PM)"** has no role check and bypasses the Codex approval circuit (`DOC_TYPES` circuits). Who may validate?
12. **Input "latest" rule**: when the provider document is Frozen (not Released), `latest = prevRev(rev)`, which flags LST-IO-026 rev B as "Outdated" for Automation (latest shown "rev A"). Intended?
13. **P&ID metadata inconsistency**: `PID` says rev C, Under review, 12 Sep; Codex/engineering register say PID-HLT-026 rev D Released 26 Sep; validation step 5 still expects rev D release. Which is the source?
14. **P&ID and engineering register exist only for HLT-026** (hard-coded `project==='HLT-026'`). Data model per project required.
15. **P&ID candidates** limited to 8 compatible-type parts already in the project BOM; "Add reference to project BOM" only navigates. Expected mapping/search UX?
16. **Machine types**: calendar options differ between the screen ("Site 6d · 10h") and data/New-type form ("Chantier 6d · 10h", SPUR default → no option selected). Edits (`mtOv`) are not consumed by the new-project wizard, ITP or cash/REX modules (they read the static constants). Label defaults to the code; descriptions are French in the EN UI. Remove buttons and inputs stay editable even when `mtCanEdit` is false.
17. **Drawings**: "Drawings in vault 1 248" and "Last vault sync 07:40" are hard-coded; revision history is synthesised (A…current); "Open in PDM" has no handler; previews are design-time image slots. Define the PDM sync contract (fields, frequency, preview URL, deep link).
18. **"Released this month"** counts all released ECOs (no date filter).
19. **Drawing / ECO "Part record"** navigates to the current project's BOM even when the part is not used there (drawer still opens). Intended?
20. **Buttons without handlers**: Create spares purchase order, Export list, Export overlay list, Register equivalent, Open in PDM (drawing drawer and P&ID card), header Export.
21. **Pinned propagation** (`pinnedFor`) marks every part of an ECO as "keep for the installed base" for a pinned machine even if that machine does not carry that particular part.
22. **Where-used** defaults to CR-BRG-SKF when the search is empty, and lists POs of every status under «No open order» semantics.
23. **ECO targets for EXTRA projects / machines without `AS_MAINT`** are ignored; installed-base effectivity relies on an as-maintained configuration that has no maintenance UI in this area.

---

## Addendum (completeness pass)

### A.1 Missing constant: `P3NAME` (line 3748)
`const P3NAME = {HLT:'Harbor Line Terminal Expansion', NDC:'Northgate Data Center Retrofit', RCF:'Clinique Pasteur Lyon Fit-out', ERP:'ERP Migration — Phase 2', WSA:'Westfield Solar Array', MSR:'Marseille Metro Signage Rollout'}`. It maps the 3-letter project prefix used as the key of `PARTS[].usage` to a full project name, and it is used only as a **fallback**:
- Where-used › Projects column (`usedProjects`, logic 4252): `name = pr ? pr.name : P3NAME[k] || k`, where `pr = projOf3(k)` (4178) is the first project in `allP` whose `code` starts with `k`.
- Part record drawer › "Projects equipped" (`partVals.projects`, logic 4299): same rule.

When `projOf3(k)` finds no project, the row shows the `P3NAME` name (or the raw key), status "—" with `tag tag-neutral`, and in the drawer the click sends `{screen:'bom', project:<current project>, projMenu:false, bomType:null}`, so the user stays on the current project. With the seed data all six usage keys (`HLT, NDC, RCF, ERP, WSA, MSR`) resolve to a project, so the fallback never shows. For the rebuild, key part usage by project id rather than by a 3-letter prefix; this removes the need for `P3NAME`.

Clarification for §2.2 "Projects equipped": the sub-line `{{ p.code }} · {{ p.qty }}` shows the **3-letter usage key** (for example "HLT · 2 units"), not the full project code "HLT-026". `qty` already includes the word "units".

### A.2 Flag index (identifiers not named above)

| Flag | Template line | Logic (line) | EN text | FR text |
|---|---|---|---|---|
| `bomHasFilter` | 1184 | `!!(bomType \|\| bomMfr \|\| bomQ)` (4215) | Shows the ghost button `bomClearLabel` "Clear filters" (`ph-x`) → `bomClear` = `{bomType:null, bomMfr:null, bomQ:''}` | "Effacer les filtres" |
| `noSpares` | 1304 | `!spareRows.length` (5231) | "No wear or spare part registered for this system" | "Aucune pièce d’usure ou de rechange enregistrée pour ce système" |
| `noEcos` | 1344 | `!ecoRows.length` | "No ECO in this status" | "Aucun ECO dans ce statut" |
| `noDwgs` | 1403 | `!dwgRows.length` | "No drawing matches" | "Aucun plan ne correspond" |
| `engNotProj` | 2414 | `!isEngProj` (5197) | "No engineering register for this project yet — import the first list to start." | "Pas encore de registre ingénierie pour ce projet — importez une première liste pour démarrer." |
| `noPid` | 2512 | `!pidList.length` (5213) | "No tag matches" | "Aucun tag ne correspond" |
| `pidNotProj` | 2531 | `!isPidProj` (5213) | "No P&ID registered for this project yet — import the tag list from the drawing to start the validation." | "Aucun PID enregistré pour ce projet — importez la liste des tags du schéma pour démarrer la validation." |

Spot-check (completeness pass): the ECO derived-status rule (`allEcos`, 4192–4193), `ecoTag`, `partTag`, `dwgTag`, `puTag`, `tsTag` and `statusTag` were re-read from source and match §0.4 and §4.4.
