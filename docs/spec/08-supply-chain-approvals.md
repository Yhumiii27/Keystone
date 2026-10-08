# 08 — Supply chain & approvals

Procurement (RFQ, supplier invoices, supplier scorecard), purchase orders, deliveries / goods receipt, stock, resource requests, department approvals and the unified "My approvals" inbox.

Source of truth: `design/Keystone PM v8.dc.html` (template lines quoted below, logic in `class Component` → `renderValsEN()`), read through `design/_extracted/template-annotated.html` (same line numbers, `«English»` = UI text). Logic line numbers refer to the original `.dc.html`.

## Screens covered

| # | Screen (title) | Flag / `screen` id | Template lines | Logic lines | Nav location | FR title |
|---|---|---|---|---|---|---|
| 1 | Sourcing, invoices & suppliers | `isProcurement` / `procurement` | 1972–2078 | 4646–4676 | Purchasing & stock › Sourcing & invoices | Consultations, factures et fournisseurs |
| 2 | Purchase orders | `isOrders` / `orders` | 2615–2688 | 4306–4337 | Purchasing & stock › Purchase orders | Commandes d’achat |
| 3 | Deliveries & goods receipt | `isDeliveries` / `deliveries` | 1598–1657 | 4447–4467 | Purchasing & stock › Deliveries | Livraisons et réceptions |
| 4 | Stock & storages | `isStock` / `stock` | 1658–1714 | 4469–4492 | Purchasing & stock › Stock & storages | Stock et magasins |
| 5 | Resource requests (+ "New resource request" dialog, 3071–3092) | `isRequests` / `requests` | 2689–2730 | 4111–4157 | Resources › Resource requests | Demandes de ressources |
| 6 | Approvals — {department} | `isApprovals` / `approvals` | 2731–2812 | 4111–4145 | Resources › Approvals | Approbations — {service} |
| 7 | My approvals | `isMyApprovals` / `myapprovals` | 1715–1736 | 4720–4737 | Fixed entry (My work) › My approvals | Mes approbations |

All seven ids are valid values of the component prop `startScreen` (declared in the `data-props` of line 3095; default `home`). The current screen is `this.state.screen || this.props.startScreen || 'home'` (line 3778).

---

## 0. Shared conventions used by every screen in this area

### 0.1 Global prototype context (affects every value shown)

| Item | Value | Source |
|---|---|---|
| Status date ("today") | `25 Sep 2026` (Friday) — header text `Status date · 25 Sep 2026` | `statusDate` (5228) |
| Day index | `TODAY = 4`; `dayDate(o) = new Date(2026, 8, 21 + floor(o/5)*7 + o%5)` → day offset 0 = Mon 21 Sep 2026, 5 working days per week | 3265–3267 |
| `dayLabel(o)` | `'Fri 25 Sep'` style; `.slice(4)` gives `'25 Sep'` | 3267 |
| Default language | `lang: 'fr'` → the prototype opens in **French**; EN/FR toggle in header (`langSeg`) | 3774 |
| Default role | `role: 'director'` (Marie Lefebvre, Portfolio director) — switchable bottom-left of the sidebar | 3774, `PERSONAS` 3747 |
| Default project | `project: 'HLT-026'` (Harbor Line Terminal Expansion, PM R. Aubert) | 3774 |
| Persistence | All changes are in React state only (`*Overrides`, `*Ov`, `requests`, `stock`, `moves`, `draftPOs`, `todos`) — lost on reload. No backend. | — |

`PERSONAS` (3747): `director` Marie Lefebvre / Portfolio director · `pm` Romain Aubert / Project manager · `depthead` Marion Kerviel / Head of engineering · `member` Julien Wagner / Structural engineer · `englead` Antoine Girard / Engineering lead · `quality` Gabriel Comte / Quality manager · `procurement` Fabien Bertrand / Procurement & stock · `client` Nadia Bensaïd / Client — Port authority.

### 0.2 Role visibility (`ROLE_SCREENS`, 3465–3466)

`director: null` means every screen. A screen not in the role's list is still reachable through links; it is then shown under a sidebar section "Outside my workspace" and the header primary button is hidden (`outside`, 5163; `hasPrimary` 5177).

| Screen | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| procurement | ✓ | ✓ | | | | | ✓ | |
| orders | ✓ | ✓ | | | | | ✓ | |
| deliveries | ✓ | ✓ | | | | ✓ | ✓ | |
| stock | ✓ | ✓ | | | | ✓ | ✓ | |
| requests | ✓ | ✓ | ✓ | | ✓ | | | |
| approvals | ✓ | | ✓ | | | ✓ | | |
| myapprovals | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |

Read-only project scope: when a non-director role views a project that is not theirs (`projReadOnly`, 4173), the header primary button is hidden on `orders` and `deliveries` (list at 5177) and a `Read-only` outline tag is shown next to the title (template line 97). `procurement`, `stock`, `requests`, `approvals`, `myapprovals` are not affected.

### 0.3 Sidebar entries & badges (`navs`, 5147–5152)

| Section (FR) | Item label (FR) | Icon | Badge rule |
|---|---|---|---|
| Purchasing & stock (Achats & stock), key `stock` | Sourcing & invoices (Consultations et factures) | `ph-handshake` | count of invoices with status `Blocked` or `No PO` (`blocked`, 4667) |
| | Purchase orders (Commandes d’achat) | `ph-shopping-cart` | count of POs `Awaiting approval` in the current project |
| | Deliveries (Livraisons) | `ph-truck` | count of deliveries `QC pending` in the current project |
| | Stock & storages (Stock et magasins) | `ph-warehouse` | count of stock lines with `min > 0 && onHand < min` |
| Resources (Ressources), key `res` | Resource requests (Demandes de ressources) | `ph-paper-plane-tilt` | count of R. Aubert's requests in status `reschedule` |
| | Approvals (Approbations) | `ph-seal-check` | count of `pending` requests of the currently selected department (`dPending`) |
| Fixed block (My work) | My approvals (Mes approbations) | `ph-stamp` | `apprItems.length` (all items waiting for the current role) |

Badges render only when > 0. Collapsed sections show the sum of numeric badges (5166).

### 0.4 Page header per screen

Header = breadcrumb (`crumb`), H2 title (26px, `titles` map 5109), global search, notifications, status date, language segmented control, `Export` (secondary, no handler) and the primary button (`primary` map, 5137).

| Screen | Breadcrumb (`crumbOf()` + `CRUMB_EXTRA`) | Project picker (`showProjectPicker`) | Primary button label (FR) → handler |
|---|---|---|---|
| procurement | `Purchasing & stock · all projects` | no | `New RFQ` (Nouvelle consultation) → `afOpen('procurement')` (generic action form, §1.4.5) |
| orders | `Purchasing & stock` + project picker | **yes** | `New purchase order` (Nouvelle commande) → `createDrafts`; **hidden when `shortfall` is empty** (`primary[1]` null) |
| deliveries | `Purchasing & stock` + project picker | **yes** | `Announce a delivery` (Annoncer une livraison) → `announce` |
| stock | `Purchasing & stock · Sage X3 + local` | no | `Import from X3` (Importer depuis X3) → `importX3` |
| requests | `Resources · R. Aubert, project manager` | no | `New request` (Nouvelle demande) → `openNr` |
| approvals | `Resources · {head name} · {head role}` e.g. `Resources · Marion Kerviel · Head of engineering` | no | `Team capacity` → `go('resources')` (still rendered with the `ph-plus` icon) |
| myapprovals | `My work · one queue for every decision assigned to me` | no | none |

Title strings: `Sourcing, invoices & suppliers`, `Purchase orders`, `Deliveries & goods receipt`, `Stock & storages`, `Resource requests`, `'Approvals — ' + dept`, `My approvals`.

### 0.5 Reusable UI patterns (implement once as components)

**Screen root.** `display:flex; flex-direction:column; gap:14px` inside the main content column (shell layout is specified elsewhere).

**KPI tile row** (`*Kpis` arrays of `{label, value, sub, color}`): grid `repeat(auto-fit, minmax(150px, 1fr))`, gap 10px. Tile = `.card.elev-sm`, padding `12px 14px`, gap 3px. Label 10.5px, uppercase, letter-spacing .08em, `--color-neutral-400`. Value 22px, weight 500, letter-spacing −0.02em, color = `k.color`. Sub 11.5px `--color-neutral-400` (My approvals adds `text-wrap:pretty`).

**Value colors.** `LO = var(--color-accent-300)` (attention), `OK = var(--color-text)` (3135). Every "bad" number in this area uses `LO`; there is no red.

**Filter chip row** (`chips(opts, cur, set)`, 4110): label block = Phosphor icon 15px `--color-accent` + filter name 12px `--color-neutral-400` (`FL.status` "Status"/"Statut", `FL.location` "Location"/"Emplacement", `FL.kind` "Kind"/"Nature", `FL.department` "Department"/"Service", `FL.view` "Display"/"Vue"). Each chip: `<button>` inline-flex gap 8px, padding `4px 10px`, radius `--radius-md`, 12px; ON: bg `--color-accent-900`, border `1px solid --color-accent-700`, text `--color-accent-200`; OFF: bg transparent, border `--color-neutral-800`, text `--color-neutral-300`; hover bg `--color-neutral-900`. Count suffix 11px tabular `--color-neutral-400`. Single select; the `All` chip has value `null`. Right side of the row: a 12px `--color-neutral-400` explanatory sentence with `margin-left:auto`.

**Segmented control** (`seg(opts, cur, set)`, 3889): Nocturne `.seg` container (1px divider border, radius-md), buttons 12px, padding `4px 10px`; active: text `--color-accent`, `box-shadow: inset 0 0 0 1px var(--color-accent)`; inactive text `--color-neutral-300`; every option after the first has `border-left: 1px solid var(--color-divider)`.

**Card with table**: `.card.elev-sm`, padding `14px 16px`, gap 8px, `overflow:auto` (horizontal scroll on narrow screens). Title row: `.card-title` (17px) with `margin-right:auto` + a 12px `--color-neutral-400` hint. Nocturne `.table` at `font-size:13px` (drawer tables 12.5px); headers 11px uppercase; rows have faded 1px rule and hover tint. Clickable rows: `cursor:pointer`; the row whose id is selected has its id text in `--color-accent-300`, others `--color-neutral-300` (`idColor`). Row action buttons call `stopPropagation()`.

**Right-hand drawer** (Order, Delivery, Stock line, RFQ, Invoice): backdrop `position:fixed; inset:0; z-index:60; background: color-mix(in srgb, var(--color-bg) 60%, transparent)` (click = close). Panel `.card.elev-lg`, `position:fixed; top:0; right:0; bottom:0; z-index:61; width:min(640px,100vw); overflow:auto; border-radius:0; padding:18px 22px; gap:12px; border-left:1px solid var(--color-neutral-800)`. Header row: id text 12px tabular `--color-neutral-400` (`margin-right:auto`) · status tag · close button `.btn.btn-icon.btn-ghost` with `ph-x` (`--color-neutral-400`). Opening the same row again toggles it closed (`select` handlers set `x: s.x===id ? null : id`).

**Section label inside drawers**: 10.5px uppercase letter-spacing .08em `--color-accent`, margin-bottom 4px.

**Key/value list** (`meta` arrays of `{k, v, color}`): flex space-between gap 10px, 12.5px, padding `3px 0`, `border-bottom:1px solid var(--color-neutral-900)`; key `--color-neutral-400` (`flex:none`), value right-aligned, tabular, `text-wrap:pretty`, color `g.color`.

**Empty-state line**: 12.5px `--color-neutral-500`, padding `8px 0`.

**Buttons** (Nocturne): `.btn-primary` is an **outlined** accent button (accent text + accent border, tinted on hover) — not filled. `.btn-secondary` divider border. `.btn-ghost` accent text, no border. Row buttons use inline `font-size:12px; padding:3px 10px` (ghost: `3px 8px` or `2px 4px`); drawer buttons `font-size:12.5px`.

**Toast**: only the RFQ action form (§1.4.5) raises a toast in this area. Toast = fixed bottom-right card (`right:22px; bottom:22px; z-index:80`), `ph-check-circle`, auto-hide after 4 s (`showToast`, 5116).

### 0.6 Status tag mapping (Nocturne `.tag` variants)

`tag-neutral` = bg `--color-neutral-800`, text `--color-neutral-100`. `tag-accent` = bg `--color-accent-800`, text `--color-accent-100`. `tag-outline` = 1px `--color-accent` border, accent text.

| Entity | `tag-neutral` | `tag-accent` | `tag-outline` | Function |
|---|---|---|---|---|
| Purchase order | Received, Cancelled, Draft | Partially received | Awaiting approval, Ordered | `poTag` 4313 |
| Delivery | Accepted, Announced | Rejected, Partially rejected | QC pending, Received | `dTag` 4451 |
| RFQ | Awarded, Draft | Comparing | Open | `rfqTag` 4649 |
| Invoice | Paid, Approved for payment | Blocked, No PO | Awaiting receipt, Rejected | `invTag` 4660 |
| Supplier grade | A | C | B | 4674 |
| Stock source | X3 | Local | — | 4473 |
| Part status (PLM) | Validated | Outdated, Obsolete | Not validated | `partTag` 4176 |
| Resource request | rejected, withdrawn | approved | pending, reschedule | `REQ_STATUS` 3282 |

### 0.7 Number and money formatting

- `f(k, signed)` = `this.money(k)` (3775) with **k in thousands of currency**: EN `€432k`, `€4.99M` (≥ 1000 k → 2 decimals M); FR `432 k€`, `4,99 M€`; `currency` prop `USD` switches the symbol to `$` (EN format only). Signed adds `+`/`−`.
- `money$(v)` (4177) — full amount, **always €** (ignores the `currency` prop): EN `€1,240`, FR `1 240 €`.
- Quantities use `toLocaleString()` without a locale argument (browser default, not tied to `lang`).
- Dates are plain strings in the data (`'16 Mar'`, `'30 Sep'`), month names translated by `frSeg` in FR.

---

## 1. Sourcing, invoices & suppliers — `procurement`

### 1.1 Key & access
- Flag `isProcurement` (`screen==='procurement'`), `startScreen: 'procurement'`.
- Nav: Purchasing & stock › Sourcing & invoices (`ph-handshake`). Roles: director, pm, procurement. Breadcrumb `Purchasing & stock · all projects` — **not project-scoped** (RFQS, INVOICES, SUPPLIERS are global), except the supplier NCR counts (see 1.4.4).

### 1.2 Purpose
Upstream purchasing for the "Approvisionnements" stage: issue requests for quotation, compare supplier quotes and award; control supplier invoices against purchase order and goods receipt (3-way match) before they are pushed to Sage X3 accounts payable; monitor supplier performance (on-time, quality, NCR rate) which feeds the quote comparison.

### 1.3 Layout (1972–2078)
Column flex, gap 14px:
1. View row (1974): `ph-eye` + `FL.view` ("Display") + segmented control `pSeg` with three options: `RFQ & quotes` (Consultations et devis) · `Invoices — 3-way match` (Factures — rapprochement 3 voies) · `Supplier performance` (Performance fournisseurs). State `pTab` (default `'rfq'`), flags `pIsRfq`, `pIsInv`, `pIsSup`.
2. The selected tab's content (below).

### 1.4 Components

#### 1.4.1 Tab "RFQ & quotes" (1975–2016)

**KPI tiles** `rfqKpis` (4652):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Open RFQs (Consultations ouvertes) | count status ≠ `Awarded` (seed 3) | `{n} ready to award` = count `Comparing` (seed 1) | OK |
| Quotes received (Devis reçus) | sum of quotes over all RFQs (seed 8) | `Across open requests` | OK |
| Savings vs list (Économies vs catalogue) | `f(12.4)` → `€12k` (hard-coded) | `Awarded this quarter` | OK |
| Average cycle (Cycle moyen) | `9 d` (hard-coded) | `RFQ sent → award` | OK |
| Award rule (Règle d’attribution) | `PM` (hard-coded) | `Decided per RFQ by the project manager` | OK |

**Table card** (1977–1997). Title `Requests for quotation` (Demandes de devis (RFQ)); hint `Draft → sent → comparing → awarded · the award creates a draft purchase order`.

| Column | Content / format |
|---|---|
| RFQ | two lines (max-width 300px): `id` 12px weight 500 tabular in `idColor`; `title` with `text-wrap:pretty` |
| Part | `part` ref, 12px tabular `--color-neutral-300` |
| Qty | right-aligned, tabular |
| Quotes due | `due`, 12px nowrap |
| Buyer | `owner`, 12px nowrap |
| Quotes | `quotesText` = `'{n} quotes · from ' + money$(min unit price)` or `No quote yet`, 12px `--color-neutral-300` |
| Award rule | `rule`, 12px `--color-neutral-400` |
| Awarded to | `chosen` or `—`, 12px |
| Status | tag (`rfqTag`) |
| (actions) | right-aligned: `Send to suppliers` (secondary, `ph-paper-plane-tilt`) if `status==='Draft'`; `Compare quotes` (primary) if `status==='Open' && quotes.length > 1` |

No sorting, no filter, no empty state on this table. Row click toggles the RFQ drawer (`rfq` state).

**RFQ drawer** (1999–2015, `rfqVals` 4653–4657):
- Header: `rfq.id`, status tag, close.
- Title: `rfq.title` (`.card-title`, `text-wrap:pretty`).
- Section `Quote comparison` (Comparaison des devis): table 12.5px, `width:100%` inside an `overflow:auto` wrapper.

| Column (header text in prototype) | Content |
|---|---|
| Supplier | `sup` + `Awarded` tag-accent if `chosen === sup` |
| Unit | `money$(price)`; `--color-accent-300` if it is the best (minimum) unit price, else `--color-text` |
| Total | `money$(price × qty)` |
| vs best | `—` for the best price, else `'+' + money$((price − best) × qty)`, `--color-neutral-400` |
| **Discipline lead** ⚠ | `lead + ' wks'`; `--color-accent-300` if it is the shortest lead time, else `--color-neutral-300`. The header label is a wrong i18n key (`T.k239` "Discipline lead", FR "Référent"); the intended label is **"Lead time"** (`k993` exists). Use "Lead time" / "Délai". |
| Terms | e.g. `Net 30` |
| Rating | `{grade} · {score}/100` tabular |
| (action) | `Award` (primary, `ph-check`) when `status==='Comparing' && !chosen && role ∈ {pm, procurement, director}` |

  Empty state when no quote: `No quote received yet — send the RFQ to at least three suppliers`. Footnote 11.5px: `Best unit price and shortest lead time highlighted · rating from supplier performance ·` + `rfq.hint` where hint = `Switch to Project manager or Procurement to award.` (Comparing and role not allowed) / `Awarded to {chosen} — purchase order created as draft.` (Awarded) / empty.
- Section `Request` (key/value): `Part` = `ref · part name`; `Quantity`; `Quotes due`; `Buyer`; `Award rule`; `Last purchase price` = `money$(lastPrice(part))` (`LAST_PRICE[ref] ?? part.price`).
- Buttons: `Send to suppliers` (primary, Draft only) · `Part record` (secondary `ph-cube`) → `{screen:'plm', part, rfq:null}` · `Purchase orders` (secondary `ph-shopping-cart`) → `goTo('orders')` (RFQ selection is kept).

#### 1.4.2 Tab "Invoices — 3-way match" (2017–2053)

**KPI tiles** `invKpis` (4668):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Invoices to process (Factures à traiter) | count status ≠ `Paid` (seed 5) | `money$` sum of their amounts (seed `€1,724,160`) | OK |
| Blocked by 3-way match (Bloquées par le rapprochement) | count `Blocked` or `No PO` (seed 3) | `Quantity or PO mismatch` | LO if > 0 |
| Awaiting goods receipt (En attente de réception) | count `Awaiting receipt` (seed 2) | `Invoice before delivery` | OK |
| Approved for payment (Approuvée pour paiement) | count `Approved for payment` (seed 0) | `Pushed to X3 accounts payable` | OK |
| Due within 30 days (Échéance sous 30 jours) | count status ≠ `Paid` (same formula as tile 1 — no date logic) | `Net 30 default terms` | OK |

**Status chips** `invChips` (4666): `All` · `Blocked` · `Awaiting receipt` · `No PO` · `Approved for payment` · `Paid`, each with its count; state `invFilter`. Right-side text: `3-way match: purchase order · goods receipt · invoice — approved invoices are pushed to X3 accounts payable`. (`Rejected`, reachable by action, has no chip.)

**Table card** title `Supplier invoices` (Factures fournisseurs):

| Column | Content |
|---|---|
| Invoice | `id` (12px, 500, tabular, `idColor`) over `date` (11.5px neutral-400) |
| Supplier | name |
| Purchase order | `po` or `—` |
| Goods receipt | `gr` or `—` |
| Amount | `money$(amount)`, right |
| Not covered by receipt | `gap = amount − grAmt`; shown as `money$(gap)` in `LO` only if `gr` set and gap > 0, else `—` in neutral-500 |
| Match | three dot+label pairs `PO`, `GR`, `INV` (8px dots, 11px labels). Dot colors via `mDot`: `ok` → `--color-accent`; `none` → `--color-neutral-100`; `partial` / `diff` → `--color-accent-700`; `pending` → `--color-neutral-700`. `INV` is always `ok`. |
| Due | `dueDate` |
| Status | tag (`invTag`) |
| (actions) | `Approve payment` (primary `ph-check`) if `canApprove`; `Approve received part` (secondary) if `canPartial` |

Empty: `No invoice in this status`.

3-way match rule `match3(i)` (4663):
- `po`: `'none'` if no PO reference; `'ok'` if `amount === poAmt`; else `'diff'`.
- `gr`: `'none'` if no GR reference; `'ok'` if `grAmt >= amount`; `'partial'` if `0 < grAmt < amount`; `'pending'` if `grAmt === 0`.
- `canApprove` = status ∈ {Blocked, Awaiting receipt} ∧ po = ok ∧ gr = ok. (With seed data no invoice satisfies this.)
- `canPartial` = status = Blocked ∧ gr = partial.

**Invoice drawer** (2043–2052, `invVals` 4670–4672): header `inv.id` + tag; title = supplier.
- Section `3-way match` (Rapprochement 3 voies): 3 rows, grid `10px minmax(0,1fr) auto auto`, gap 10px, padding `6px 0`, bottom border neutral-900, 12.5px: dot (10px), label + reference (11px neutral-400), amount (tabular), state text (11.5px; `--color-text` when Matched else LO).

  | Row | Reference | Amount | State |
  |---|---|---|---|
  | Purchase order | `po` / `—` | `money$(poAmt)` | per `match3.po` |
  | Goods receipt | `gr` / `—` | `money$(grAmt)` | per `match3.gr` |
  | Invoice | `id` | `money$(amount)` | Matched |

  State labels: ok → `Matched` (Rapproché), partial → `Partial receipt` (Réception partielle), diff → `Amount differs` (Montant différent), pending → `Receipt pending` (Réception en attente), none → `Missing` (Manquant).
- Section `Invoice` (key/value): `Invoice date`, `Due date`, `Terms` = `Net 30` (constant), `Variance invoice − receipt` (= gap or `—`), `Blocking reason` (LO when not `—`): Blocked + gr partial → `Invoiced quantity exceeds accepted receipt (rejected units)`; Blocked otherwise → `Amount differs from PO`; No PO → `No purchase order referenced — create PO or reject`; Awaiting receipt → `Goods not yet received`; else `—`.
- Buttons: `Approve payment` (primary) if canApprove · `{partialLabel}` (primary `ph-check`) if canPartial, label `'Approve ' + money$(grAmt) + ' · request credit note'` (FR rule → `Approuver … · demander un avoir`) · `Purchase order` (secondary `ph-shopping-cart`) if `po` → `{screen:'orders', po, inv:null}` · `Goods receipt` (secondary `ph-truck`) if `gr` → `{screen:'deliveries', deliv:gr, inv:null}` · `Reject invoice` (ghost) if status ∉ {Paid, Approved for payment}.

#### 1.4.3 Invoice actions → state
| Action | Effect (`setInv` → `invOv[id]`) |
|---|---|
| Approve payment | `{status:'Approved for payment'}` |
| Approve received part | `{status:'Approved for payment', amount: grAmt}` (the invoice amount is reduced to the received value; the remainder is implicitly a credit-note request) |
| Reject invoice | `{status:'Rejected'}` |

No Sage X3 call, no toast. "Paid" is only seed data.

#### 1.4.4 Tab "Supplier performance" (2054–2075)

**KPI tiles** `supKpis` (4675):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Active suppliers (Fournisseurs actifs) | `SUPPLIERS.length` (8) | `{n} rated A` (4) | OK |
| On-time delivery (Livraison à l’heure) | rounded mean of OTD % (90%) | `Weighted last 12 months` (it is a plain mean) | OK |
| Quality acceptance (Acceptation qualité) | rounded mean of quality % (97%) | `Units accepted at receipt` | OK |
| Rated C (Notés C) | count grade C (1) | `Improvement plan required` | LO if > 0 |
| NCRs from suppliers (NCR d’origine fournisseur) | count of current-project NCRs with `src==='Goods receipt'` (HLT: 3) | `This quarter` | OK |

**Table** `Supplier scorecard` (Tableau de bord fournisseurs); hint `On-time from deliveries · quality from goods receipt · NCR rate per unit · rating feeds RFQ comparison`. Rows not clickable.

| Column | Content |
|---|---|
| Supplier | name, weight 500 |
| On-time delivery (width 22%) | bar: track `flex:1; height:5px; radius:3px; bg --color-neutral-800`, fill width `otd%` bg `--color-accent`; value 12px tabular, LO if OTD < 85 |
| Quality acceptance (width 22%) | same bar, fill `--color-neutral-300`; value 12px |
| NCR rate | `ncr + '%'`, LO if > 2 |
| Open POs | `pos` (static count from SUPPLIERS) |
| NCRs this quarter | computed: count of current-project NCRs with `src==='Goods receipt'` whose `part` appears in a current-project delivery of that supplier |
| Rating | grade tag (A neutral, B outline, C accent) |

#### 1.4.5 "New RFQ" action form (header primary)
Generic action-form dialog (template 138–157; `AF.procurement` 3674+20; `afOpenWith` 5113). Dialog `width:min(640px,100%)`, `max-height:84vh`, backdrop z 50 aligned to top (`padding-top:8vh`). Title `New RFQ` (Nouvelle consultation); subtitle `{projectName} · Required fields are marked · *` (note: shows the current project although the screen is cross-project). Two-column field grid (gap 12px; `title` spans both columns):

| Field id | Label (FR) | Type | Required | Default |
|---|---|---|---|---|
| title | Title (Titre) | text | yes | '' |
| suppliers | Suppliers (Fournisseurs) | text | yes | '' |
| articles | Articles | text | yes | '' |
| due | Reply due (Réponse attendue le) | text | no | `15 Oct 2026` |
| incoterm | Incoterm | select `DAP site`, `EXW`, `FCA`, `DDP` | no | `DAP site` |

Validation: submit disabled until every required text field is non-blank (`afValid`). Submit `Send RFQ` (Envoyer la consultation, `ph-check`) → toast `RFQ sent to suppliers` (Consultation envoyée aux fournisseurs). **No RFQ row is created** in the prototype.

### 1.5 Interactions & state

| Handler | Reads | Writes |
|---|---|---|
| `pSeg` option | `pTab` | `pTab` ∈ `rfq` / `inv` / `sup` |
| RFQ row click `r.select` | `rfq` | `rfq` = id or null (toggle) |
| `Send to suppliers` (row / drawer) | — | `rfqOv[id].status = 'Open'` |
| `Compare quotes` | — | `rfqOv[id].status = 'Comparing'` |
| `Award` (per quote) | `role` | `rfqOv[id] = {chosen: sup, status: 'Awarded'}` — no PO is created despite the hint text |
| `closeRfq` / backdrop | — | `rfq: null` |
| Invoice chip | — | `invFilter` |
| Invoice row click | — | `inv` toggle |
| Approve / partial / reject | — | `invOv[id]` (see 1.4.3) |
| `closeInv` | — | `inv: null` |

Deep links into this screen set `pTab` + `rfq` or `inv` (My approvals, notifications).

### 1.6 Data
- `RFQS` (3526): `{id, title, part, qty, due, status, rule, owner, quotes: [[supplier, unitPrice, leadWeeks, terms, grade, score]], chosen}` merged with `rfqOv`.
- `INVOICES` (3531): `{id, supplier, po, gr, amount, poAmt, grAmt, date, dueDate, status}` merged with `invOv`.
- `SUPPLIERS` (3538): `[name, otd%, quality%, ncrRate%, grade, openPOs]`.
- `allNCRs` (4614) and `allDeliv` (4450) of the **current project** for NCR counts.
- `PARTS`, `LAST_PRICE` / `lastPrice()` for the drawer.

### 1.7 Cross-links
Out: PLM part record (`plm`), Purchase orders (`orders`, with `po`), Deliveries (`deliveries`, with `deliv`). In: My approvals (`RFQ award` → `{pTab:'rfq', rfq}`, `Invoice — 3-way match` → `{pTab:'inv', inv}`), notification `n8` (INV-HC-7781 → `{pTab:'inv', inv}`), sidebar.

---

## 2. Purchase orders — `orders`

### 2.1 Key & access
`isOrders`, `startScreen: 'orders'`. Nav Purchasing & stock › Purchase orders (`ph-shopping-cart`). Roles: director, pm, procurement. **Project-scoped**: project picker in the breadcrumb; data = `genPOs(project)` + session drafts for that project.

### 2.2 Purpose
Purchase orders of the selected project with their approval circuit (draft → approval → ordered → received), tied to the planning activity that needs the material, and a BOM shortfall assistant that drafts orders for every BOM article not yet fully ordered.

### 2.3 Layout (2615–2688)
Column, gap 14px: KPI row → shortfall banner (conditional) → status-chip row → orders table card → order drawer.

### 2.4 Components

**KPI tiles** `poKpis` (4326):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Open orders (Commandes ouvertes) | count status ∉ {Received, Cancelled} (HLT 5) | `{n} orders in total` (6) | OK |
| Committed (Engagé) | `f(Σ poValue / 1000)` over status ∉ {Cancelled, Draft} — includes *Awaiting approval* (HLT `€6.09M`) | `Ordered, not cancelled` | OK |
| Late deliveries (Livraisons en retard) | count of rows whose risk text starts with `Activity` (HLT 1: PO-1063) | `See Deliveries for goods receipt` | LO if > 0 |
| Awaiting approval (En attente d’approbation) | count `Awaiting approval` (HLT 1) | `Blocks ordering` | LO if > 0 |

**Shortfall banner** (2626–2631, `hasShortfall`): `.card.elev-sm`, padding `12px 16px`, gap 8px, **bg `--color-accent-900`**. Row: `ph-cube` (accent) · title 13.5px/500 `shortfallTitle` = `'{n} BOM articles are not fully ordered'` (singular `'1 BOM article is not fully ordered'`) · sub 12px neutral-300 `shortfallSub` = `f(shortValue/1000) + ' still to commit at list price'` (HLT: 15 articles, `€884k`) · button `Create draft POs by supplier` (primary, `ph-plus`) → `createDrafts`. Below: wrap of `tag-neutral` chips (11px) `'{ref} · {qty} to order'`.

Shortfall formula (4327–4329): `orderedQty[ref]` = Σ line qty over POs with status ≠ Cancelled (drafts count). `shortfall` = PARTS where `usage[p3] > 0` ∧ `mb === 'Purchased'` ∧ `orderedQty < usage[p3]`; `need = usage − orderedQty`; `shortValue = Σ part.price × need` (list price `PARTS.price`, not LAST_PRICE). Manufactured parts are excluded.

**Status chips** `poChips`: `All` + every `PO_FLOW` value (`Draft`, `Awaiting approval`, `Ordered`, `Partially received`, `Received`, `Cancelled`) with counts; state `poFilter`. Right text: `Draft → awaiting approval → ordered → received · deliveries checked against the activity that needs them`.

**Orders table** (2636–2662). Title `poTitle` = `'Purchase orders · ' + rows.length`; hint `Click an order for its lines`.

| Column | Content |
|---|---|
| Order | `id`, 12px/500 tabular nowrap, `idColor` |
| Supplier | name |
| Articles | line 1 (12.5px): first two refs joined `, ` + ` +N` if more; line 2 (11.5px neutral-400): `'{n} line(s) · {Σqty} units'` + `' · part status issue'` if any line's part is Outdated / Obsolete / Not validated |
| Value | `f(poValue/1000)`, right; `poValue = Σ PARTS.price × ordered qty` |
| Status | tag (`poTag`) |
| Ordered | `—` when Draft, else `ordered` date; 12px neutral-300 |
| Expected | `Delivered` when Received, else `expected`; LO when at risk else neutral-300 |
| Needed by | line 1 12px `'{actId} · {activity name}'` (from `ALL_BYID[o.act]`, `—` if none); line 2 11px: `Activity already started — delivery is late` (LO) when risk, else `'Needed from ' + activity start` (actual-date marker ` A` stripped) |
| (actions) | `Send for approval` (secondary) when Draft; `Approve & order` (primary `ph-check`) when Awaiting approval |

Risk rule (`needOf`, `poRow` 4314–4315): late = activity `pc > 0` (already started) ∧ PO status ≠ Received; shown only if status ∉ {Received, Cancelled}. Empty: `No purchase orders in this status`.

**Order drawer** (2663–2686, `poVals` 4331–4337):
- Header: `'{id} · {supplier}'`, status tag, close.
- Stepper (11.5px neutral-400): three steps `Draft` · `Approved` · `Ordered`, each a 10px dot + label, joined by 36px × 1px `--color-neutral-800` connectors (margin `0 8px`). Reached dot = `--color-accent` and label `--color-text`; unreached = `--color-neutral-700` / `--color-neutral-500`. Reached: Draft always (unless Cancelled); Approved and Ordered when `PO_FLOW.indexOf(status) >= 2`. Glow `0 0 8px color-mix(accent 60%)` on `Ordered` while status is Ordered or Partially received. Cancelled → nothing reached. (There is no "Received" step.)
- Warning box (if any line part ≠ Validated): flex, 12.5px/1.45, neutral-200, padding `10px 12px`, radius-md, bg `--color-accent-900`, `ph-warning` accent; text `'{ref} is {status lower-case} · … — resolve in PLM before this order is released.'`.
- Lines table (12.5px): Reference · Article · Ordered (right) · Unit price (`money$(PARTS.price)`) · Total (`money$(price × qty)`) · Part status (tag `partTag`). Row click → `{screen:'bom', part: ref}`. (A received quantity per line is computed — `recv`, `recvColor` — but not displayed.)
- `Order details` key/value: `Order value` = `f(value/1000)`; `Ordered on` = `Not yet` when Draft else date; `Expected delivery` (LO if late and not Received); `Needed by` = activity text; `Delivery / terms` = `Site gate 2 · DAP · Net 30` (constant).
- Buttons (margin-top 8px): `Open activity` (secondary `ph-tree-structure`) → `{screen:'plan', sel: po.act || current sel, selOpen:true, po:null}`; `Export PO` (ghost `ph-file-pdf`) — no handler.

### 2.5 Interactions & state

| Handler | Effect |
|---|---|
| chip | `poFilter` |
| row click | `po` toggle |
| `Send for approval` | `poOverrides[id] = 'Awaiting approval'` |
| `Approve & order` | `poOverrides[id] = 'Ordered'` (no role check on this screen) |
| `createDrafts` (banner button or header `New purchase order`) | groups `shortfall` by manufacturer (`part.mfr`) and appends one draft per supplier to `draftPOs`: `{id: 'PO-' + (1100 + draftPOs.length + i), project, supplier, lines: [[ref, need, 0]], status:'Draft', ordered: '25 Sep', expected:'To confirm', act:null}`; resets `poFilter` to null. Afterwards the shortfall is empty, so the banner and header button disappear. HLT result: 13 drafts (ArcelorMittal, Lincoln Electric, Halvorsen Cranes, SKF, SEW-Eurodrive, Teufelberger, ABB ×2 lines, Dellner Bubenzer, Bromma, Siemens ×2 lines, SICK, Camco, Thies Clima). |
| `closePO` / backdrop | `po: null` |
| (My approvals) approve / reject | `poOverrides[id] = 'Ordered'` / `'Cancelled'` |

`allPOs` (4308): `[...genPOs(project), ...draftPOs for project]`, status = `poOverrides[id] || status`; when status is `Received`, every line's received qty is forced to the ordered qty. A `receive` handler (→ Received) exists in `poRow` but no button renders it.

### 2.6 Data
- `HLT_POS` (3406–3413): `[id, supplier, lines[[ref, orderedQty, receivedQty]], status, ordered, expected, act]` → object `{id, supplier, lines, status, ordered, expected, act}`.

  | id | supplier | lines (ref ordered/received) | status | ordered | expected | activity | value |
  |---|---|---|---|---|---|---|---|
  | PO-1041 | Keystone Steelworks | KS-STL-0450 48/48 · KS-STL-0301 640/640 | Received | 16 Mar | 30 Jun | A1230 | €432k |
  | PO-1052 | Halvorsen Cranes | EQ-CRN-250T 2/0 · CR-RAIL-A100 96/96 | Partially received | 04 May | 12 Oct | A1320 | €4.99M |
  | PO-1063 | Nordvolt | EL-SWG-11KV 2/0 · EL-TRF-2MVA 2/2 | Partially received | 22 Jun | 02 Oct | A1410 | €421k |
  | PO-1071 | Brightline Electrics | EL-CBL-XLPE 42/42 · LT-HB-200W 260/0 | Partially received | 10 Jul | 19 Oct | A1420 | €218k |
  | PO-1078 | Cotswold Fire Systems | FD-DAMP-FR 24/0 · FD-SPR-HD 420/0 | Ordered | 01 Sep | 06 Nov | A1430 | €19k |
  | PO-1082 | Cotswold Fire Systems | FD-DET-OPT 180/0 | Awaiting approval | 24 Sep | 13 Nov | A1430 | €9k |

- `genPOs(code)` (3415–3420) for other projects (`DEFS`): one PO per manufacturer of the parts used by the project (`PARTS.usage[p3] > 0`); `frac = (i+1)/(nSup+1)`; status by project progress `prog`: `prog > frac+.15` → Received; `> frac−.1` → Partially received; `> frac−.35` → Ordered; else Awaiting approval. `id = 'PO-' + (DEFS.idx×1000 + 120 + i×7)`; line = `[ref, usage, received]` (received = usage / round(usage/2) / 0); `ordered = fmtD(monthDate(start + frac×dur×0.6))`; `expected = ordered month + maxLeadWeeks/4.3`; `act` = the activity at position `floor(frac × nActs)`.
- `PO_FLOW` (3414) — see Status machines.
- `PARTS` fields used: `ref, name, mb, price, mfr, status, usage`.
- `ALL_BYID` (3340): every activity of every project by id (`n` name, `s` start, `pc` % complete, `tf` total float).

### 2.7 Cross-links
Out: Plan (activity), BOM (part), via drawer. In: Deliveries drawer `Open purchase order` (`{screen:'orders', po, deliv:null}`), Invoice drawer `Purchase order`, RFQ drawer `Purchase orders`, My approvals (Purchase order item), Home (director "Purchase orders awaiting approval", PM "Waiting for me", Procurement "Purchase orders to act on" / "Still to order"), global search hits `Purchase order` → `{screen:'orders', po}`.

---

## 3. Deliveries & goods receipt — `deliveries`

### 3.1 Key & access
`isDeliveries`, `startScreen: 'deliveries'`. Nav Purchasing & stock › Deliveries (`ph-truck`). Roles: director, pm, quality, procurement. Project-scoped (project picker).

### 3.2 Purpose
Goods receipt for the project: deliveries announced against POs, physical receipt, incoming quality inspection, put-away location, documents (delivery note, mill/conformity certificates) and photos; rejected quantities go to quarantine and feed supplier NCRs.

### 3.3 Layout (1598–1657)
KPI row → status chips → `Goods receipts` table card → delivery drawer.

### 3.4 Components

**KPI tiles** `delivKpis` (4461):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Deliveries (Livraisons) | count (HLT 5) | `{n} announced` (1) | OK |
| Awaiting quality check (En attente de contrôle qualité) | count `QC pending` (1) | `Held in quarantine` | LO if > 0 |
| Rejected quantity (Quantité refusée) | Σ rejected units (4) | `round(rej/received×1000)/10 + '% of units received'` (`0.5%`) or `—` | LO if > 0 |
| On-time deliveries (Livraisons à l’heure) | `83%` (hard-coded) | `Last 90 days · vs PO expected date` | OK |
| Open orders to receive (Commandes à recevoir) | count POs `Ordered` or `Partially received` (4) | `Ordered or partially received` | OK |

**Status chips** `delivChips`: `All` + `DELIV_FLOW` (`Announced`, `Received`, `QC pending`, `Accepted`, `Partially rejected`, `Rejected`); state `delivFilter`. Right text: `Announced → received → quality check → accepted or rejected · accepted quantities go to stock`.

**Table** `Goods receipts` (Réceptions); hint `Click a delivery for its lines, quality check and documents`.

| Column | Content |
|---|---|
| Delivery | `id` (12px/500, `idColor`) over `'{date} · {supplier delivery note}'` (11.5px neutral-400) |
| Order | `po`, 12px tabular |
| Supplier | name |
| Articles | refs joined `, ` (12px neutral-300) |
| Delivered / ordered | `Σ delivered / Σ ordered`, right |
| Accepted | Σ accepted, right |
| Rejected | Σ rejected or `—`; LO when > 0 |
| Quality | `qc.result` (12px neutral-300): e.g. `Passed`, `Passed with reserve`, `Pending`, `Failed on 2 drums`, `—` |
| Put-away | location of the **first** line (12px neutral-400) |
| Status | tag (`dTag`) |
| (actions) | `Register receipt` (secondary `ph-package`) when Announced; `Accept` (primary `ph-check`) + `Reject` (ghost) when QC pending |

Empty: `No delivery in this status`.

**Delivery drawer** (1632–1654, `delivVals` 4462–4466):
- Header `'{id} · {po}'`, tag, close; title = supplier.
- Lines table (12.5px): Reference · Article · Ordered · Delivered · Accepted · Rejected (LO when > 0, `—` neutral-500 when 0) · Put-away (12px neutral-400). Row click → `{screen:'bom', part, bomView:'flat', deliv:null}`.
- Two-column grid `repeat(auto-fit, minmax(min(100%,260px),1fr))`, gap 18px:
  - `Delivery` key/value: Purchase order · Supplier delivery note · Delivered on · Carrier · Photos (`'{n} attached'` / `None`).
  - `Quality check` key/value: Inspector · Result (LO when it contains "Fail") · Remarks. When `QC pending`: text input (`.input`, min-height 32px) bound to `delivNote`, placeholder `Inspection remarks`, then `Accept → stock` (primary `ph-check`) and `Reject → quarantine` (secondary `ph-x`). When `Announced`: `Register receipt` (primary `ph-package`, `align-self:flex-start`).
- Second grid:
  - `Documents`: list rows (`ph-file-pdf`, ellipsis, 12.5px, padding `5px 0`, bottom border) or `No document yet`; ghost button `Attach delivery note` (`ph-paperclip`, no handler).
  - `Photos`: 16:9 drop zone `<image-slot id="deliv-{id}" shape="rounded" radius="8" placeholder="Drop receipt photos">` — a prototype placeholder component; in the real app = photo upload/gallery per delivery.
- Footer buttons: `Open purchase order` (secondary `ph-shopping-cart`) → `{screen:'orders', po, deliv:null}`; `Print receipt` (ghost `ph-file-pdf`, no handler).

### 3.5 Interactions & state (`setDeliv` → `delivOverrides[id]` merged, 4452)

| Action | Patch |
|---|---|
| `Register receipt` (Announced) | `status:'QC pending'`, `date:'25 Sep'`, `carrier:'Geodis'`, each line `delivered = ordered`, accepted 0, rejected 0 (location kept), `qc:{by:'Hélène Sauvage', result:'Pending', remarks:'Received complete · inspection to do'}` |
| `Accept` / `Accept → stock` (QC pending) | `status:'Accepted'`, each line `accepted = delivered`, rejected 0, location: a quarantine location (`includes('quarantaine')`) is replaced by `Entrepôt central — Lyon`; `qc:{by: PERSONAS[role].name, result:'Passed', remarks: delivNote || 'Conforming — released to stock'}` |
| `Reject` / `Reject → quarantine` | `status:'Rejected'`, accepted 0, `rejected = delivered`, location `Zone quarantaine QC — Lyon`; `qc:{by: current persona, result:'Failed', remarks: delivNote || 'Non-conforming — supplier notified'}` |
| `announce` (header `Announce a delivery`) | finds the first PO `Ordered` with no delivery; if found writes `delivOverrides['BL-2026-0' + (600 + #overrides)] = {… status:'Announced', lines delivered 0 at 'Magasin chantier — Le Havre', qc remarks 'Announced by supplier'}` and selects it. **Bug:** `allDeliv` only maps deliveries returned by `genDeliv`, so the announced delivery never appears; with HLT seed data no PO qualifies (PO-1078 already has BL-2026-0540) → no-op. |
| chip / row click / close | `delivFilter`, `deliv` toggle, `deliv:null` |
| remarks input | `delivNote` (shared across deliveries, never cleared) |

No stock line is created or incremented by Accept, and PO status is not updated by receipts (see Open questions). No toast.

### 3.6 Data
- `HLT_DELIV` (3468–3473): `{id, po, supplier, date, carrier, note, status, lines:[[ref, ordered, delivered, accepted, rejected, location]], qc:{by, result, remarks}, docs:[fileName], photos:n}`.

  | id | PO | supplier | date | status | QC | lines (o/d/a/r → loc) |
  |---|---|---|---|---|---|---|
  | BL-2026-0412 | PO-1041 | Keystone Steelworks | 30 Jun | Accepted | Passed (H. Sauvage) | KS-STL-0450 48/48/48/0, KS-STL-0301 640/640/640/0 → Magasin chantier — Le Havre |
  | BL-2026-0498 | PO-1052 | Halvorsen Cranes | 02 Sep | Accepted | Passed with reserve | CR-RAIL-A100 96/96/94/2 → Le Havre |
  | BL-2026-0521 | PO-1063 | Nordvolt | 18 Sep | QC pending | Pending (P. Noguès) | EL-TRF-2MVA 2/2/0/0 → Zone quarantaine QC — Lyon |
  | BL-2026-0533 | PO-1071 | Brightline Electrics | 23 Sep | Partially rejected | Failed on 2 drums | EL-CBL-XLPE 42/42/40/2 → Entrepôt central — Lyon |
  | BL-2026-0540 | PO-1078 | Cotswold Fire Systems | 06 Nov | Announced | — | FD-DAMP-FR 24/0/0/0, FD-SPR-HD 420/0/0/0 → Le Havre |

- `genDeliv(code)` (4449) for other projects: one delivery per PO in Received / Partially received; `id 'BL-2026-0' + (300 + idx×10 + i)`, date = PO expected, carrier `—`, note = 2 first letters of supplier + `-` + (4100 + 7i), status Accepted (PO Received) or QC pending; lines `[ref, ordered, received, accepted = received if Accepted else 0, 0, 'Magasin chantier — Marseille' (MSR) or 'Magasin chantier — Lyon']`; docs `['Delivery note.pdf']`; photos 2/0.
- `DELIV_FLOW` (3474).

### 3.7 Cross-links
Orders (PO), BOM (part), My approvals (`Delivery — quality check` for quality & procurement), invoice drawer `Goods receipt`, notification `n4` (BL-2026-0533), Quality NCRs (`src:'Goods receipt'`) via supplier scorecard.

---

## 4. Stock & storages — `stock`

### 4.1 Key & access
`isStock`, `startScreen: 'stock'`. Nav Purchasing & stock › Stock & storages (`ph-warehouse`). Roles: director, pm, quality, procurement. **Not project-scoped** (all stock lines), except that reservations/issues use the current project's 3-letter code `PD.p3`.

### 4.2 Purpose
Stock positions per article and storage location (central warehouse, workshop, site stores, supplier consignment, QC quarantine), imported from Sage X3; local movements (count adjustment, transfer, reservation for a project, issue to an activity, return, scrap/rework) are recorded and flagged as "Local" until pushed back to X3, which stays the accounting reference.

### 4.3 Layout (1658–1714)
KPI row → filter row (location chips + search) → two-card flex row (`flex-wrap:wrap; gap:14px; align-items:flex-start`): stock table card `flex: 2.4 1 980px; min-width:0` and "Recent movements" card `flex: 1 1 280px; min-width:0` (wraps under the table below ~1280px of content width) → stock-line drawer.

### 4.4 Components

**KPI tiles** `stockKpis` (4475):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Stock value (Valeur du stock) | `f(Σ onHand × lastPrice / 1000)` (`€1.25M`) | `'{lines} lines · {locations} locations'` (18 · 6) | OK |
| Below minimum (Sous le minimum) | count `min > 0 ∧ onHand < min` (1: MD-GAS-OUT) | `Reorder or transfer` | LO if > 0 |
| In quarantine (En quarantaine) | Σ onHand at locations whose type starts with `Quarantine` (2) | `Awaiting quality decision` | OK |
| X3 import (Import X3) | `x3Sync` (initial `07:15`) | `'Today · {n} lines from Sage X3'` (15) | OK |
| Local changes (Modifications locales) | count source `Local` (3) | `To push back to X3` | LO if > 0 |

**Filter row**: chips `stockLocChips` (`ph-map-pin` + `Location`): `All locations` (count = all lines) + one chip per `settings.locations` entry with its line count; state `stockLoc`. Right: search box (`margin-left:auto; min-width:260px`, `ph-magnifying-glass` at left 10px/top 10px, input `padding-left:30px; min-height:34px`), placeholder `Search article or location`, state `stockQ`; matches case-insensitively on `ref + part name + location`.

**Table** `Stock by location` (Stock par emplacement); hint with `ph-arrows-clockwise`: `Imported from Sage X3 · local changes are flagged until pushed back`.

| Column | Content |
|---|---|
| Reference | ref, 12px/500 tabular, `idColor` (selected = accent-300) |
| Article | part name (max-width 220px, ellipsis); if the part is pinned by an ECO for the installed base: second line 10.5px `--color-accent-300` `ph-push-pin` + `pinnedText` (`'Keep for the installed base · {n} machine(s) · {ECO ids}'`) |
| Location | name (12.5px) over location type (11px neutral-400) |
| On hand | right, tabular |
| Reserved | `'{n} · {proj}'` or `—`, neutral-400 |
| Available | `onHand − reserved`; LO if negative |
| Min | min or `—`, neutral-400; `ph-warning` (accent) when below min |
| Value | `money$(onHand × lastPrice(part))` |
| Source | tag `X3` (neutral) / `Local` (accent) |
| Last movement | date, 12px neutral-400 |

Empty: `No stock line matches`. Row click toggles the drawer (`stockRow` = row index in `stock`; also resets `stockQty:''`, `stockTarget:null`).

**Recent movements card**: title `Recent movements` (Mouvements récents); first 8 entries of `moves`; each row (padding `7px 0`, top border neutral-900): line 1 12.5px: type in `--color-accent-300` + ` · {ref} × {qty}`; line 2 11.5px neutral-400 `where`; line 3 11px neutral-500 `'{who} · {when}'`. Not clickable.

**Stock-line drawer** (1694–1711, `stockSel` 4488–4490):
- Header `'{ref} · {loc}'` + source tag + close; title part name; location type (12px neutral-400).
- `Position` key/value: On hand · Reserved (`'{n} · {proj}'` / `—`) · Available · Minimum level (`—` if 0) · Unit cost (last purchase) (`money$(lastPrice)`) · Last movement.
- `Movement` section:
  - Segmented control `opSeg` from `STOCK_OPS`: `Adjust (count)` · `Transfer` · `Reserve for project` · `Issue to activity` · `Return to stock` · `Scrap / rework` (state `stockOp`, default `adjust`, not reset when changing rows).
  - When `transfer`: label `Destination` (11.5px) + segmented control of every other location, labelled with the part before ` — ` (e.g. `Entrepôt central`, `Atelier mécanique`, `Magasin chantier` — note two locations share this short label), state `stockTarget`.
  - When `scrap` and the part is pinned: warning box (accent-900 bg, `ph-push-pin`) `'Pinned revision in service — {pinnedText}. Scrapping is allowed but After-sales must confirm spare coverage first.'` + ghost button `ECO →` opening the first pinning ECO.
  - Row: `qtyLabel` (`Counted quantity` for adjust, else `Quantity`) + number input (width 110px, right-aligned, state `stockQty`) + `Apply movement` (primary `ph-check`).
  - Note 11.5px: `Local movements are flagged until the next push to X3 · X3 remains the accounting reference`.
- `Movement history`: up to 6 latest moves of this ref; grid `auto minmax(0,1fr) auto`, 12.5px: `'{type} × {qty}'` (accent-300) · where (ellipsis) · when.
- Buttons: `Part record` (secondary `ph-cube`) → `{screen:'plm', part, stockRow:null}`; `Push to X3` (ghost `ph-upload-simple`) — **no handler**.

### 4.5 Movement semantics (`applyOp`, 4479–4487)
Guard: a row is selected and `parseInt(stockQty)` is non-zero (so a count to 0 is impossible). Each successful op sets the row's `source='Local'`, `last='25 Sep'`, prepends a move `[ '25 Sep 16:' + pad(10 + moves.length), type, ref, qty, where, PERSONAS[role].name ]` and clears `stockQty`. No validation against negative stock.

| Op | Stock effect | Move type | `where` text |
|---|---|---|---|
| adjust | `onHand = qty` | Adjust | `'{loc} · counted'` |
| transfer | requires `stockTarget` ≠ current loc (else no-op); `onHand −= qty`; target line (same ref) `+= qty`, created if missing `{onHand:0, reserved:0, proj:'', min:0}`; target also flagged Local | Transfer | `'{loc} → {target}'` |
| reserve | `reserved += qty`, `proj = PD.p3` | Reserve | `'{loc} · {p3}'` |
| issue | `onHand −= qty`, `reserved = max(0, reserved − qty)` | Issue | `'{loc} → {p3} activity'` (no activity picker) |
| return | `onHand += qty` | Return | `'{p3} → {loc}'` |
| scrap | `onHand −= qty` | Scrap | `'{loc} · rework / scrap'` |

`importX3` (header `Import from X3`): `stock = STOCK0` (discards all local changes; moves history kept), `x3Sync = '16:' + current minutes`, `stockRow:null`.

### 4.6 Data
- `STOCK0` (3475–3482) → `{ref, loc, onHand, reserved, proj, min, source:'X3'|'Local', last}`, 18 lines. Examples: `KS-STL-0450 @ Entrepôt central — Lyon 6/4 HLT min 4 X3 12 Sep`; `EL-TRF-2MVA @ Zone quarantaine QC — Lyon 2/2 HLT`; `FD-DET-OPT2 @ Entrepôt central — Lyon 60/0 min 50 Local 25 Sep`; `MD-GAS-OUT @ Magasin chantier — Marseille 0/0 min 10` (below min).
- `STOCK_OPS` (3483): `[key, label]` × 6.
- `MOVES0` (3484): `[when, type, ref, qty, where, who]`, 5 seed moves (Transfer, Receipt, Issue, Scrap, Reserve).
- `SETTINGS0.locations` (3467): `[name, type]` — `Entrepôt central — Lyon` (Central warehouse), `Atelier mécanique — Lyon` (Workshop), `Magasin chantier — Le Havre` (Site store), `Magasin chantier — Marseille` (Site store), `Consignation — Nordvolt` (Consignment at supplier), `Zone quarantaine QC — Lyon` (Quarantine (QC hold)); `locTypes` list. Editable in Settings (`settings.locations`), which drives the chips, type labels and transfer targets.
- `LAST_PRICE` (3428) / `lastPrice(p) = LAST_PRICE[p.ref] ?? p.price`: valuation and unit cost.
- `pinnedFor(ref)` / `pinnedText(ref)` (4198–4199): parts listed in non-rejected ECOs whose installed-base target disposition is `pinned` or `retrofit` (seed: FD-DET-OPT, FD-DET-OPT2 via ECO-2026-015 / MCH-029).

### 4.7 Cross-links
PLM part record, ECO screen (pinned warning), Settings (locations), My approvals (none). ACTIVITY/AUDIT feeds on the Activity & integrations screen contain stock events (static).

---

## 5. Resource requests — `requests`

### 5.1 Key & access
`isRequests`, `startScreen: 'requests'`. Nav Resources › Resource requests (`ph-paper-plane-tilt`, badge = reschedule proposals). Roles: director, pm, depthead, englead. The list is **hard-wired to the PM R. Aubert** (`myReqs = requests.filter(r => r.pm === 'R. Aubert')`, breadcrumb `R. Aubert, project manager`) whatever the role.

### 5.2 Purpose
The project manager's outbox of staffing requests: a PM asks a department for a person (or a contract role) on a planning activity for given dates and hours; the department head approves (the task then lands in the person's "My work"), rejects, or counter-proposes dates which the PM accepts or withdraws.

### 5.3 Layout (2689–2730)
KPI row → status chips → grid-table card (`padding:14px 16px; gap:0; overflow:auto`).

### 5.4 Components

**KPI tiles** `reqKpis` (4138):

| Label | Value | Sub | Color |
|---|---|---|---|
| Requests sent | count (seed 9) | `Harbor Line · last 2 weeks` | OK |
| Awaiting review | count pending (4) | `'{Σ hours of pending} h requested'` (64 h) | LO if > 0 |
| Needs your answer | count reschedule (1) | `Reschedule proposals` | LO if > 0 |
| Approved | count approved (3) | `Now in team members’ lists` | OK |
| Avg response | `1.4 d` (hard-coded) | `Department heads` | OK |

(No FR entries exist for these labels — they remain in English in FR mode.)

**Status chips** `reqChips` (4136): `All` (9) · `Pending` (4) · `Reschedule proposed` (1) · `Approved` (3) · `Rejected / withdrawn` (rejected + withdrawn; 1); state `reqFilter`. Right text: `A task reaches the team member only once the department head approves`.

**Grid table** (not a `<table>`): header and rows share `grid-template-columns: 82px minmax(180px,1.6fr) minmax(150px,1.1fr) 110px 170px minmax(200px,1.4fr) minmax(150px,auto)`, gap 12px (minimum ≈ 1114px → horizontal scroll). Header 10.5px uppercase neutral-400, padding `6px 0`, bottom border neutral-800. Rows padding `10px 0`, bottom border neutral-900, 12.5px, `align-items:center`.

| Column | Content |
|---|---|
| Request | `id` tabular over `sent` (`'Sent Fri 25 Sep'`, 11px neutral-400) |
| Task | title (ellipsis) + `ph-lightning` (accent, 12px) if the activity is critical (`tf < 0`) + `ph-arrow-fat-up` if priority high; second line `'{act} · {activity name}'` 11.5px neutral-400 |
| Resource | 24px round avatar (neutral-800 bg, neutral-200 text, 9.5px initials) + person (ellipsis) over department (11px) |
| When | `'{start} – {due}'` (e.g. `28 Sep – 29 Sep`) over `'{hours} h'` |
| Status | status tag (`REQ_STATUS`) + 3-dot mini-stepper (8px dots, flex 1px connectors neutral-800; tooltip `Sent → department review → assigned to the person`): dot1 accent always; dot2 accent unless pending; dot3 accent only when approved, others neutral-700; caption 11px `'In {first name}’s list'` (approved) or `Not sent to the person yet` |
| Response | `response` or `'Awaiting {department head}'`, 12px/1.4 neutral-300 |
| (actions) | reschedule: `Accept {proposed dates}` (primary `ph-check`) + `Withdraw` (ghost); pending: `Withdraw` (ghost); rejected: `Re-request` (secondary `ph-arrow-counter-clockwise`) |

No empty state on this table.

### 5.5 "New resource request" dialog (3071–3092)
Opened by `openNr` from header buttons on `requests` (`New request`), `resources` and `presources` (`Request resource`). `.dialog-backdrop` z 50, top-aligned (`padding-top:6vh`); `.dialog` `width:min(720px,100%)`, gap 14px, `max-height:88vh`, scroll.
- Title `New resource request` (Nouvelle demande de ressource); subtitle `Harbor Line Terminal Expansion · sent by R. Aubert` (hard-coded); close `.btn-icon.btn-secondary`.
- Fields (state `nr`, defaults 3773):

| Field | Control | Options / default |
|---|---|---|
| Task | text, placeholder `What needs doing` | '' |
| Activity | single-select chips | `NR_ACTS` = A1250, A1260, A1320, A1420, A1430, labelled `'{id} · {activity name}'`; default A1250 |
| Person or role | chips | the 8 `PEOPLE` + `Contract role` (value `Contract structural engineer`); default Julien Wagner |
| Week | segmented (`flex:1` options) | `w/c 28 Sep` (5) · `w/c 5 Oct` (10) · `w/c 12 Oct` (15); default 5 |
| Duration | segmented | `2 days` (1) · `1 week` (4) · `2 weeks` (9) — offsets added to the start day; default 4 |
| Hours | text (right-aligned) | `'8'` |
| Priority | segmented | `Low` / `Medium` / `High`; default `med` |
| Note for the department head | text, placeholder `Why now, what it unblocks` | '' |

  Week/Duration/Hours/Priority sit in a grid `repeat(auto-fit, minmax(min(100%,300px),1fr))`, gap 12px.
- Routing banner (neutral-900 bg, `ph-seal-check` accent): `'Goes to {head} ({dept}) for approval · {first} is at {load}% that week. The task appears in the person’s list only once approved.'` (or `contract hire — no current load`). Department = `DEPT_OF[person] || 'Engineering'`; load = `loadAt(person, week)`.
- Actions: `Cancel` (secondary) / `Send request` (primary `ph-paper-plane-tilt`). No validation: empty title → `Untitled request`, unparsable hours → 8.
- Send prepends `{id: 'RQ-0' + (45 + #new), pm:'R. Aubert', project:'HLT', person, dept, title, act, hours, start: week, due: week + dur, prio, status:'pending', sent:'Fri 25 Sep', note, response:'', propStart:null, propDue:null, todoId:null}` to `requests`, closes the dialog, clears title/note, sets `reqFilter:null`, `screen:'requests'`.

### 5.6 Interactions & state (PM side)

| Action | Patch on the request (`setReq`) |
|---|---|
| `Withdraw` (pending or reschedule) | `status:'withdrawn'`, `response:'Withdrawn by PM · Fri 25 Sep'` |
| `Re-request` (rejected) | `status:'pending'`, `sent:'Fri 25 Sep'`, `response:''` |
| `Accept {dates}` (reschedule) — `acceptReschedule` | `status:'approved'`, `start = propStart`, `due = propDue`, `response:'Rescheduled to {start} – {due} · accepted by PM · assigned'`, `todoId`; **creates the task** (see §6.5) |

### 5.7 Data
`REQUESTS` (3270–3281) → `{id, pm, project (3-letter), person, dept, title, act, hours, start (day offset), due (day offset), prio:'low'|'med'|'high', status, sent, note, response, propStart, propDue, todoId}`; status labels/tags `REQ_STATUS` (3282); `NR_ACTS` (3283); `DEPTS`, `DEPT_OF` (3268–3269); `PEOPLE` (3123–3130, `[name, role, weeklyLoad%[8]]`); `ALL_BYID` for activity names and float.

### 5.8 Cross-links
Approvals (department side), My work (approved task), Plan (activities), Home (PM "My resource requests", director "Resource requests pending"), notification `n7`.

---

## 6. Approvals — `approvals` (department head)

### 6.1 Key & access
`isApprovals`, `startScreen: 'approvals'`. Nav Resources › Approvals (`ph-seal-check`, badge = pending of the selected department). Roles: director, depthead, quality. Title `'Approvals — ' + dept` (FR `Approbations — Ingénierie`). The department is a free choice (`dept` state, default `Engineering`); it is not bound to the role.

### 6.2 Purpose
Department heads arbitrate staffing requests from project managers against their team's load: approve (assign the task), reject with a reason, or counter-propose a later week.

### 6.3 Layout (2731–2812)
1. Header row (flex, gap 12px, wrap): department-head chip (padding `6px 10px 6px 6px`, radius-md, bg `--color-surface`, `--shadow-sm`; 30px avatar bg `--color-accent-800` text `--color-accent-200` 11px; name 13px; role 11.5px neutral-400) + department chips (`ph-users-three` + `Department`): one per `DEPTS` key; badge pill (11px, padding `0 6px`, radius 9px, bg accent-800, text accent-100) showing the pending count when > 0. Changing department resets `decide`.
2. KPI row.
3. Two-column grid `repeat(auto-fit, minmax(min(100%,460px),1fr))`, gap 14px, `align-items:start`: left column (Awaiting + Decided cards stacked, gap 14px), right column (Team load card).

### 6.4 Components

**KPI tiles** `apprKpis` (4144):

| Label | Value | Sub | Color |
|---|---|---|---|
| Pending approvals | `dPending.length` (Engineering seed 2) | `'{Σ h} h requested'` (52 h) | LO if > 0 |
| Team load w/c 28 Sep | mean of team members' week-0 load (`PEOPLE[i][2][0]`) (90%) | `'{n} person/people'` | LO if > 100 |
| Capacity · 8 wks | `ROLES[dept][1] + ' h'` (960 h) | `'Committed ' + ROLES[dept][2] + ' h'` (1110 h) | LO if committed > capacity |
| Decided | count non-pending excluding withdrawn | `'{a} approved · {r} rejected'` | OK |
| Avg response | `0.9 d` (hard-coded) | `Target ≤ 1 day` | OK |

**Card "Awaiting your decision"** (En attente de votre décision); hint `Approve sends the task to the person · reschedule counter-proposes dates`. One block per pending request (`queue`): flex column gap 8px, padding 12px, radius-md, bg `--color-neutral-900`, `box-shadow` = `inset 0 0 0 1px var(--color-accent-700)` while that request is in decide mode.
- Meta line 11.5px neutral-400: id · `'{sent} by {pm}'` · project tag (`tag-neutral`, 10px, padding `1px 7px`, e.g. `Harbor Line`) · `ph-arrow-fat-up High priority` (accent-300) · `ph-lightning Critical path`.
- Title 14px/500.
- Facts 12.5px (gap `6px 18px`): `ph-tree-structure` `'{act} · {name}'` · `ph-user` person · `ph-calendar-blank` `'{dates} · {hours}'`.
- PM note: 12.5px neutral-300, `padding-left:10px; border-left:2px solid var(--color-neutral-700)`.
- Impact line 12px with `ph-gauge`: `'{first} at {load}% w/c {week} → {load + round(hours/40×100)}% with this request'`, LO when the result > 110; or `No named resource — contract hire, no current load`.
- Decide forms (surface bg, radius 6px, padding 10px):
  - Reschedule: `Propose` + segmented `+1 wk` / `+2 wks` / `+3 wks` (state `decide.shift`) + `'→ {start+5·shift} – {due+5·shift}'`; input (placeholder `Reason for the PM (e.g. over capacity that week)`, state `decide.note`) + `Send proposal` (primary `ph-paper-plane-tilt`) + `Cancel` (ghost).
  - Reject: input (placeholder `Reason — the PM sees this`) + `Confirm reject` (secondary `ph-x`) + `Cancel`.
  - Default actions (when not deciding this one): `Approve & send to {first}` (primary `ph-check`; `{first}` = first name, or the literal `procurement` when the person is not a named employee) · `Propose reschedule` (secondary `ph-calendar-dots`) · `Reject` (ghost, neutral-300).
- Empty: block (13px neutral-400, padding 16px, centered, neutral-900 bg) `Nothing waiting — every request for {dept} is decided`.

**Card "Decided"**: rows grid `64px minmax(0,1.4fr) minmax(0,1fr) auto`, gap 12px, padding `8px 0`, top border neutral-900, 12.5px: id (neutral-400) · title (ellipsis) over `'{person} · {dates} · {hours}'` · response (11.5px neutral-400) · status tag. Includes approved, rejected, reschedule and withdrawn. Empty: `No decisions yet`.

**Card "Team load"**: subtitle `Next two weeks · pending hours are not yet committed`. Grid `minmax(0,1fr) 62px 62px 64px`, gap 6px, 12.5px; headers `Person` · `28 Sep` · `5 Oct` · `Pending` (hard-coded week labels). Per member of the department (`PEOPLE` filtered by `DEPT_OF`): name cell (38px high, 26px avatar, name + role) — click → `{screen:'mywork', person}` (tooltip `Open their work`); two heat cells (30px high, radius 5px, value `'{v}%'`) colored by `shade(v)`:

| Load v | Background | Text |
|---|---|---|
| > 115 | `--color-accent-400` | `--color-bg` |
| > 100 | `--color-accent-600` | `--color-accent-100` |
| ≥ 90 | `--color-accent-800` | `--color-accent-200` |
| ≥ 60 | `--color-accent-900` | `--color-neutral-300` |
| < 60 | `--color-neutral-900` | `--color-neutral-400` |

  Pending column: `'+{Σ pending hours} h'` (LO) or `—` (neutral-500). Empty: `No named team members in this department yet`. Footer 12px: `Click a person to open exactly what they see.`

### 6.5 Interactions & state

| Action | Effect |
|---|---|
| Department chip | `dept`, `decide` reset |
| `Approve & send to …` — `approve(r)` | creates a task in `todos`: `{id: 'T-' + (2341 + #new), person, title, project, act, status:'todo', prio, start, due, est: hours, logged:0, cl:[0,3], labels:[first word of dept], pct:0, fresh:true, dept}`; request → `status:'approved'`, `response:'Approved · {head} · Fri 25 Sep'`, `todoId` |
| `Propose reschedule` / `Reject` | `decide = {id, mode:'reschedule' / 'reject', shift:1, note:''}` |
| shift segment / reason input | `decide.shift`, `decide.note` |
| `Send proposal` | request → `status:'reschedule'`, `propStart = start + 5·shift`, `propDue = due + 5·shift`, `response:'Reschedule proposed · {head} · Fri 25 Sep' + (' — ' + note)`; `decide.id = null` |
| `Confirm reject` | request → `status:'rejected'`, `response:'Rejected · {head} · Fri 25 Sep' + (' — ' + note)`; `decide.id = null` |
| `Cancel` | `decide.id = null` |
| Team member | `screen:'mywork'`, `person` |

No role check: any role that can open the screen decides for any department.

### 6.6 Data / formulas
`loadAt(who, day) = PEOPLE[who].load[clamp(floor(day/5) − 1, 0, 7)]` (week 0 = w/c 28 Sep); `weekLabel(d) = 'w/c ' + dayLabel(floor(d/5)·5)`; `critAct(id) = ALL_BYID[id].tf < 0`; `DEPTS` (head name/role), `DEPT_OF`, `ROLES` (`[dept, capacity8w h, committed8w h]`, 3132).

### 6.7 Cross-links
Resource requests (PM side), My work (team member & created task), Resources (header `Team capacity`), My approvals (depthead), Home (depthead "Approval queue").

---

## 7. My approvals — `myapprovals`

### 7.1 Key & access
`isMyApprovals`, `startScreen: 'myapprovals'`. Fixed sidebar entry (`ph-stamp`, badge = number of items). Roles: all except `member`. Breadcrumb `My work · one queue for every decision assigned to me`.

### 7.2 Purpose
A single inbox of every decision waiting for the current role across modules (resource requests, POs, ECOs, delivery QC, forced stage changes, change requests, deliverable acceptance, RFQ awards, blocked invoices, NCR verification); simple items can be decided inline, others open their own page.

### 7.3 Layout (1715–1736)
KPI row → kind chips → one card `Waiting for my decision` (padding `14px 16px`, gap 4px).

### 7.4 Components

**KPI tiles** `myApprKpis` (4737):

| Label (FR) | Value | Sub | Color |
|---|---|---|---|
| Waiting for me (En attente de ma part) | number of items | `'As ' + role label` | LO if > 0 |
| Types | number of distinct kinds | kinds joined ` · ` or `Nothing pending` | OK |
| Oldest (Plus ancienne) | `when` of the **last** item pushed (not a real min) or `—` | `Submitted on` | OK |
| Decided this week (Décidées cette semaine) | depthead: count of decided requests in the department; others: ECOs with `appr[roleKey]==='ok'` + POs in status `Ordered` | `Audit trail kept per item` | OK |

**Kind chips** `apprChips` (`ph-funnel` + `Kind`): `All` + each kind present, with counts; state `apprFilter`. Right text: `Resource requests, purchase orders, ECOs, deliveries, change requests and deliverables — decided here or on their own page`.

**Item rows**: grid `150px minmax(0,1fr) auto auto`, gap 14px, padding `10px 0`, top border neutral-900, `cursor:pointer` when it has an `open` target. Col 1: kind as `tag-outline` + id (11.5px neutral-400, tabular). Col 2: title (13px) · sub (11.5px neutral-400) · `'{who} · {when}'` (11px neutral-500). Col 3: when inline actions exist: `Reject` (ghost) + `Approve` (primary `ph-check`) (stopPropagation). Col 4: `ph-arrow-right` (neutral-500) when openable. Empty: `Nothing waiting for you — switch role (bottom-left) to see another queue`.

### 7.5 Routing matrix (`apprItems`, 4721–4732; order of rows = order below)

| Kind (FR) | Roles | Source & condition | id / title / sub / when / who | Inline Approve → | Inline Reject → | Row opens |
|---|---|---|---|---|---|---|
| Resource request (Demande de ressource) | depthead | `dPending` of the selected department | id · title · `'{person} · {project} · {h} h'` · `''` (field missing) · `'R. Aubert'` | — | — | `approvals` |
| Purchase order (Commande d’achat) | pm, director | current-project POs `Awaiting approval` | id · `'{supplier} · {value}'` · refs · ordered date · `Fabien Bertrand` | status `Ordered` | status `Cancelled` | `orders` + `po` |
| ECO | englead, quality, pm (`ecoRoleKey`) | ECOs `In approval` with `appr[roleKey]==='pending'` | id · title · `'{type} · {projects}'` · date · by | `appr[roleKey]='ok'` | `appr[roleKey]='rejected'` | `eco` + `eco` |
| Delivery — quality check (Livraison — contrôle qualité) | quality, procurement | current-project deliveries `QC pending` | id · `'{supplier} · {refs}'` · QC remarks · date · `Fabien Bertrand` | same as delivery `Accept` ⚠ | same as delivery `Reject` ⚠ | `deliveries` + `deliv` |
| Forced stage change (Changement d’étape forcé) | director | `stageHist` entries flagged `forced` dated `25 Sep 2026` (created during the session on Projects) | code · `'{project} → {stage}'` · reason · date · PM | — | — | `projects` |
| Change request (Demande de modification) | pm, director, client (`crRoleKey`) | current-project CRs `In review` with `chain[roleKey]==='pending'` | id · title · types/amount/days · date · by | `chain[roleKey]='ok'` | `chain[roleKey]='rejected'` | `changes` + `cr` |
| Deliverable acceptance (Acceptation de livrable) | client | deliverables `Submitted` | id · title · `'{type} · {acc}'` · due · R | status `Accepted`, `acc:'25 Sep · N. Bensaïd'` | status `Rejected`, `acc:'25 Sep · comments issued'` | `quality` + `{qTab:'dlv', dlv}` |
| RFQ award (Attribution de consultation) | pm, procurement | RFQs `Comparing` | id · title · `'{n} quotes · {rule}'` · due · owner | — | — | `procurement` + `{pTab:'rfq', rfq}` |
| Invoice — 3-way match (Facture — rapprochement 3 voies) | procurement, director | invoices `Blocked` or `No PO` | id · `'{supplier} · {amount}'` · `No purchase order referenced` / `Receipt does not cover invoice` · date · `Accounts payable` | — | — | `procurement` + `{pTab:'inv', inv}` |
| NCR verification (Vérification NCR) | quality | open NCRs in `Verification` | id · title · `'{sev} · {owner}'` · due · raised by | status `Closed` | status `Corrective action` | `quality` + `{qTab:'ncr', ncr}` |

⚠ Prototype defect: the inbox wrapper calls `i.approve()` / `i.reject()` without the click event, but the delivery handlers (`delivRow(d).accept/reject`, 4456) call `e.stopPropagation()` on their argument → TypeError, nothing happens. The intended behaviour is the delivery Accept / Reject of §3.5 (remarks = current `delivNote` or the default text).

Seed queues (HLT, Engineering): director 5 (PO-1082, CR-008, INV-HC-7781, INV-BX-55120, INV-LE-2210); pm 3 (PO-1082, ECO-2026-015, RFQ-2026-031); depthead 2 (RQ-043, RQ-041); englead 0; quality 1 (BL-2026-0521); procurement 5 (BL-2026-0521, RFQ-2026-031, 3 invoices); client CR-008 + D-014, D-016.

### 7.6 Cross-links
Every module listed in 7.5. ECO, CR, NCR and deliverable circuits are specified with their own screens (ECO, Change control, Quality).

---

## Data entities (field level)

### PurchaseOrder (`HLT_POS`, `genPOs`, `draftPOs`, overrides `poOverrides`)
| Field | Type | Example | Notes |
|---|---|---|---|
| id | string | `PO-1052` | drafts `PO-11xx` |
| project | string (code) | `HLT-026` | only on session drafts; seed POs are implicitly the project passed to `genPOs` |
| supplier | string | `Halvorsen Cranes` | = `PARTS.mfr` for generated POs |
| lines | `[ref, orderedQty, receivedQty][]` | `['CR-RAIL-A100',96,96]` | |
| status | `PO_FLOW` value | `Partially received` | |
| ordered | date string | `04 May` | shown `—` while Draft |
| expected | date string | `12 Oct` | `To confirm` for drafts |
| act | activity id \| null | `A1320` | "needed by" link |
| *derived* value | number € | Σ `PARTS.price × orderedQty` | list price |
| *derived* received value | number € | Σ `price × receivedQty` | used only in the unused `received` total |

### RFQ / Quote (`RFQS`, `rfqOv`)
RFQ: `id` (`RFQ-2026-031`), `title`, `part` (ref), `qty` (number), `due` (date string), `status` (Draft/Open/Comparing/Awarded), `rule` (`Lowest total cost of ownership` / `Technical compliance first` / `Lowest price` / `PM decides`), `owner` (buyer name), `quotes`, `chosen` (supplier or null).
Quote tuple: `[supplier, unitPrice €, leadTimeWeeks, terms, grade 'A'|'B'|'C', score 0–100]`, e.g. `['Dillinger',1195,6,'Net 45','B',94]`.

### SupplierInvoice (`INVOICES`, `invOv`)
`id` (`INV-HC-7781`), `supplier`, `po` ('' if none), `gr` (delivery id or ''), `amount`, `poAmt`, `grAmt` (€, full units), `date`, `dueDate`, `status` (`Paid`, `Blocked`, `Awaiting receipt`, `No PO`, `Approved for payment`, `Rejected`). Seed: KS-4471 Paid; HC-7781 Blocked (GR €1,259,600 < €1,286,400); NV-1190 Awaiting receipt (GR 0); BX-55120 Blocked (€156,000 < €163,800); CF-0921 Awaiting receipt (no GR); LE-2210 No PO (€6,880).

### Supplier (`SUPPLIERS`)
`[name, onTimeDelivery %, qualityAcceptance %, ncrRate %, grade, openPOs]`, e.g. `['Cotswold Fire Systems',78,95,0.5,'C',7]`. 8 suppliers. RFQ quotes carry their own grade/score (not joined to this table).

### GoodsReceipt / Delivery (`HLT_DELIV`, `genDeliv`, `delivOverrides`)
`id` (`BL-2026-0521`), `po`, `supplier`, `date`, `carrier`, `note` (supplier delivery-note no.), `status` (`DELIV_FLOW`), `lines: [ref, ordered, delivered, accepted, rejected, location][]`, `qc: {by, result, remarks}`, `docs: string[]` (file names), `photos: number`.

### StockPosition (`STOCK0` → `state.stock`)
`ref`, `loc` (location name), `onHand`, `reserved`, `proj` (3-letter project code of the reservation or ''), `min` (0 = none), `source` (`X3` | `Local`), `last` (date string). Derived: `available = onHand − reserved`, `value = onHand × lastPrice`, `below = min > 0 ∧ onHand < min`.

### StockMovement (`MOVES0` → `state.moves`)
`[when 'DD Mon HH:MM', type ('Adjust','Transfer','Reserve','Issue','Return','Scrap','Receipt'), ref, qty, where (free text), who]`.

### StockOperation (`STOCK_OPS`)
`[key, label]`: `adjust` Adjust (count) (Ajuster (inventaire)) · `transfer` Transfer (Transférer) · `reserve` Reserve for project (Réserver pour le projet) · `issue` Issue to activity (Sortir vers une activité) · `return` Return to stock (Retour en stock) · `scrap` Scrap / rework (Rebut / reprise).

### StorageLocation (`SETTINGS0.locations` → `state.settings.locations`)
`[name, type]`; types (`locTypes`): Central warehouse (Entrepôt central), Workshop (Atelier), Site store (Magasin chantier), Consignment at supplier (Consignation fournisseur), Quarantine (QC hold) (Quarantaine (blocage QC)).

### Part (subset of `PARTS`, 3343–3398) used here
`ref`, `name`, `mb` (`Manufactured`|`Purchased`), `type`, `price` (list €), `mfr` (supplier), `status` (`Validated`|`Not validated`|`Outdated`|`Obsolete`), `lead` (weeks), `usage` (`{HLT:48, …}` per 3-letter project). `LAST_PRICE` (3428): `{ref: lastPurchaseUnitPrice€}` for 15 refs (e.g. `EL-TRF-2MVA: 121500` vs list 124000).

### ResourceRequest (`REQUESTS` → `state.requests`)
| Field | Type | Example |
|---|---|---|
| id | string | `RQ-038` |
| pm | string (short name) | `R. Aubert` |
| project | 3-letter code | `HLT` |
| person | string (employee or contract role) | `Pauline Noguès` / `Contract structural engineer` |
| dept | `DEPTS` key | `MEP` |
| title | string | `Re-route cable trays around crane rail` |
| act | activity id | `A1420` |
| hours | number | 16 |
| start, due | day offsets (see §0.1) | 7, 11 → 30 Sep – 6 Oct |
| prio | `low`/`med`/`high` | `med` |
| status | `pending`/`approved`/`reschedule`/`rejected`/`withdrawn` | `reschedule` |
| sent | string | `Tue 22 Sep` |
| note | string (PM's note) | |
| response | string (decision trail) | `Reschedule proposed · Sophie Renard · Thu 24 Sep — …` |
| propStart, propDue | day offsets \| null | 15, 19 → 12 Oct – 16 Oct |
| todoId | task id \| null | `T-2327` |

`REQ_STATUS`: pending → `Pending review` (tag-outline); approved → `Approved · assigned` (tag-accent); reschedule → `Reschedule proposed` (tag-outline); rejected → `Rejected` (tag-neutral); withdrawn → `Withdrawn` (tag-neutral).
`NR_ACTS = ['A1250','A1260','A1320','A1420','A1430']` (activities offered in the new-request dialog).

### Department / people
`DEPTS` (3268): `{Engineering: ['Marion Kerviel','Head of engineering'], 'Site operations': ['Olivier Blanc','Site operations manager'], MEP: ['Sophie Renard','Head of MEP'], Quality: ['Gabriel Comte','Quality manager'], 'Controls & planning': ['Ines Duarte','Head of project controls']}`. `DEPT_OF` (3269): employee → department (8 people). `PEOPLE` (3123): `[name, role, load% for 8 weeks from w/c 28 Sep]`. `ROLES` (3132): `[dept, capacity h (8 wks), committed h]`.

### Task created on approval (`state.todos`, shape of `TODOS` 3228)
`{id 'T-2341…', person, title, project, act, status:'todo', prio, start, due, est (h), logged:0, cl:[done,total] checklist counts, labels[], pct, fresh:true, dept}`.

### Approval inbox item (`apprItems`)
`{kind, id, title, sub, when, who, approve?: fn, reject?: fn, open?: fn}`.

### Other constants requested in scope
- `HLT_DELIVS` (3515), `DELIV_TYPES` (3513), `DELIV_FLOW2` (3514): **client deliverables** register (Quality screen, `qTab:'dlv'`), not goods deliveries. Deliverable = `{id 'D-014', title, type ∈ DELIV_TYPES, wbs, due, status ∈ DELIV_FLOW2, raci:{R,A,C,I,B}, rev, acc}`; non-HLT projects reuse the first 4 with ids `D-110…` and R = project PM (4630). Used by My approvals (client).
- `SCORE_AXES` (3539): `[key, label, defaultWeight]` = fit Strategic fit .25 · margin Margin / NPV .25 · risk Risk level .20 · res Resource fit .15 · client Client priority .15. `SCORES` (3540): `{projectCode: [5 axis scores 1–5]}`. Portfolio prioritisation score (4499): `score = 100 × Σ_i (s_i / 5) × (w_i / Σw)` with user-editable weights `pfWeights`. (Portfolio spec; not used by the supply-chain screens.)
- `DEFS` (3284–3300): per-project generator definition `{idx, start (month index), dur (months), cont (k€ contingency), phases[], team[], pk: [name, budget k€, startMonth, endMonth, critical?][], cats: [name, type, budget][]}`; `HLT-026` only `{idx:1, start:0, dur:12, team}` (HLT uses hand-written data). Drives `projectData()`, `genPOs()`, `genDeliv()` and PO ids (`idx`).
- `INIT_OF` (3301): reverse of `OWN` — full name → initials key (`'Romain Aubert' → 'RA'`), used when creating activities (Plan).
- `SRC_OF` (3302): cost-category type → source of actuals: Labor `Timesheets × role rate`, Material `Purchase orders + receipts`, Equipment `Plant hire invoices`, Subcontract `Certified payment claims`, Fees `Direct invoices`, Reserve `Drawn by change request` (Budget screen category rows). The Material line is the link between POs/receipts and project cost.

### Sage X3 connector references
| Where | Content |
|---|---|
| `CONNECTORS` (3570) | `['Sage X3', 'Stock positions, purchase orders, supplier invoices, accounts payable', 'Every 2 h', 'OK', '26 Sep 07:15', '18 stock lines · 6 invoices']` (Activity & integrations › Connectors) |
| Stock | `source:'X3'|'Local'`; KPI `X3 import` (`x3Sync`), `Local changes`; `Import from X3` (`importX3` resets to `STOCK0`); `Push to X3` (no handler); texts "Imported from Sage X3 · local changes are flagged until pushed back", "X3 remains the accounting reference" |
| Invoices | "approved invoices are pushed to X3 accounts payable"; KPI sub `Pushed to X3 accounts payable` (no push implemented) |
| `ACTIVITY` (3557+) | `['22 Sep 17:45','Sage X3','Invoice INV-HC-7781 received · blocked by 3-way match','invoice']` |
| `AF.plumbing` | "Add connector" system select includes `Sage X3` |
| `CLOSURE` (3733) | `Financial close in Sage X3` (L. Marchand) |

---

## Status machines / workflows

### PO_FLOW — purchase order (3414)
`Draft → Awaiting approval → Ordered → Partially received → Received`, plus `Cancelled`.

| From | Trigger (UI) | To | Who in prototype |
|---|---|---|---|
| (none) | `Create draft POs by supplier` / header `New purchase order` (shortfall) | Draft | anyone with access to Orders |
| Draft | `Send for approval` | Awaiting approval | anyone (no check) |
| Awaiting approval | `Approve & order` (Orders) or `Approve` (My approvals, pm/director) | Ordered | Orders: anyone; inbox: pm, director |
| Awaiting approval | `Reject` (My approvals) | Cancelled | pm, director |
| Ordered / Partially received | (no UI; `poRow.receive` exists) | Received | — |
| Ordered | (seed data / generator only) | Partially received | — |

Drawer stepper shows only Draft · Approved · Ordered.

### RFQ — request for quotation (no constant; values in `RFQS`)
`Draft →(Send to suppliers) Open →(Compare quotes, needs ≥ 2 quotes) Comparing →(Award, pm/procurement/director) Awarded`. Award records `chosen`; the expected creation of a draft PO is not implemented. Quotes arrive only through seed data.

### Supplier invoice — 3-way match
States: `Awaiting receipt`, `Blocked`, `No PO`, `Approved for payment`, `Paid`, `Rejected`.
- `Blocked | Awaiting receipt` + PO ok + GR ok → `Approve payment` → `Approved for payment`.
- `Blocked` + GR partial → `Approve received part` → `Approved for payment` with `amount = grAmt` (credit note requested for the rest).
- any state except `Paid` / `Approved for payment` → `Reject invoice` → `Rejected`.
- `Approved for payment → Paid` happens in X3 (not modelled). Initial status is seed data (no automatic evaluation of `match3` into a status).

### DELIV_FLOW — goods receipt (3474)
`Announced →(Register receipt) QC pending →(Accept / Accept → stock) Accepted` or `→(Reject / Reject → quarantine) Rejected`. `Received` and `Partially rejected` exist only as seed values (no transition produces them; a partial accept is not possible in the UI). QC decisions are offered inline in My approvals to quality and procurement.

### Stock movements
Not a status machine: six operations (§4.5) that mutate quantities and flip the line's `source` to `Local`; `Import from X3` resets every line to `X3`.

### Resource request (`REQ_STATUS`)
```
pending ──Approve (dept head)──────────────► approved  (task T-xxxx created for the person)
pending ──Confirm reject (dept head)───────► rejected ──Re-request (PM)──► pending
pending ──Send proposal (dept head)────────► reschedule ──Accept (PM)───► approved (dates = proposal, task created)
pending ──Withdraw (PM)────────────────────► withdrawn
reschedule ──Withdraw (PM)─────────────────► withdrawn
```
Approval circuit: PM (sender) → department head of `DEPT_OF[person]` (or Engineering for contract roles) → person's "My work". Mini-stepper on the PM side: Sent · Department review · Assigned.

### Client deliverable — DELIV_FLOW2 (3514), Quality screen
`Planned →(Start) In progress →(To internal review) Internal review →(Submit) Submitted →(client Accept) Accepted | (client Reject) Rejected`. Accept/Reject only for role `client` (also inline in My approvals).

### Cross-module circuits surfaced in My approvals (detailed in their own specs)
- ECO (`ECO_FLOW` 3431: Draft → Impact analysis → In approval → Released | Rejected): approvals by englead, quality and pm (`appr`); any rejection → Rejected; all ok → Released (or stays In approval while installed-base targets are pending).
- Change request: chain `pm → director → client → ccb` (`chain`, `n/a` allowed); inbox for pm, director, client.
- NCR (`NCR_FLOW` 3506): quality closes from `Verification` (approve → Closed, reject → Corrective action).
- Forced stage change: informational for the director.

---

## Cross-links

| From | Element | To |
|---|---|---|
| Procurement · RFQ drawer | `Part record` | `plm` (`part`) |
| Procurement · RFQ drawer | `Purchase orders` | `orders` |
| Procurement · Invoice drawer | `Purchase order` | `orders` (`po`) |
| Procurement · Invoice drawer | `Goods receipt` | `deliveries` (`deliv`) |
| Orders · drawer line | row click | `bom` (`part`) |
| Orders · drawer | `Open activity` | `plan` (`sel`, `selOpen`) |
| Deliveries · drawer line | row click | `bom` (`part`, `bomView:'flat'`) |
| Deliveries · drawer | `Open purchase order` | `orders` (`po`) |
| Stock · drawer | `Part record` | `plm` (`part`) |
| Stock · drawer (scrap, pinned) | `ECO →` | `eco` (`eco`) |
| Requests header / Resources / Project resources | `New request` / `Request resource` | New resource request dialog → `requests` |
| Approvals · Team load | person | `mywork` (`person`) |
| Approvals header | `Team capacity` | `resources` |
| My approvals rows | open | `approvals`, `orders`, `eco`, `deliveries`, `projects`, `changes`, `quality`, `procurement` |
| Home (director) | "Purchase orders awaiting approval", "Resource requests pending" | `orders`, `requests` |
| Home (pm) | "My resource requests", PO "Approve" rows | `requests`, `orders` (`po`) |
| Home (depthead) | "Approval queue" | `approvals` |
| Home (procurement) | "Purchase orders to act on", "Still to order" | `orders` (`po`) |
| Global search | `Purchase order` hits | `orders` (`po`) |
| Notifications | n4 / n7 / n8 | `deliveries` (BL-2026-0533) / `requests` / `procurement` (inv) |
| BOM "where used" | `usedPOs` (POs containing the part, all projects) | Orders |
| Settings | Stock locations list | Stock chips, location types, transfer targets |

---

## Open questions

1. **RFQ award → PO.** The hint says "purchase order created as draft" but `Award` only sets `chosen`/`Awarded`. Should awarding create a Draft PO (supplier = winner, line = RFQ part × qty at the quoted unit price)?
2. **Quote table header.** Column shows lead time but uses key `k239` "Discipline lead" (FR "Référent"). Confirm it must read "Lead time" / "Délai".
3. **RFQ-2026-031 data.** Title "Steel plate S355 · 20 mm" but `part:'KS-STL-0450'` (a HEB 450 column); the plate is `KS-PLT-S355`. Fix seed?
4. **New RFQ form** only toasts; no RFQ row is created and `suppliers`/`articles` are free text. Expected data model (part picker, supplier multi-select, quantity)?
5. **Invoice statuses.** Initial status is not derived from `match3`; `Approve payment` can never appear with seed data. Should status be computed automatically (match → approvable), and what triggers `Paid` (X3 sync)? `Rejected` has no filter chip and still counts in "Invoices to process" and "Due within 30 days" (the latter uses no date logic).
6. **PO value vs invoice amount.** PO value uses `PARTS.price` (PO-1041 = €432,480) while its invoice/PO amount is €433,400; stock uses `LAST_PRICE`. Which price is authoritative on a PO line (needs a unit-price field per line)?
7. **Receipt → PO / stock coupling.** Accepting a delivery changes neither the PO status/received quantities nor the stock lines, although the UI says "accepted quantities go to stock". Expected behaviour: accepted qty → stock receipt movement at the put-away location; rejected qty → quarantine; PO → Partially received / Received.
8. **`Announce a delivery`** is broken (announced entries are stored in `delivOverrides` but never listed). Should it open a form (PO, expected date, carrier)? Same for `Attach delivery note`, `Print receipt`, `Export PO`, `Push to X3` (no handlers).
9. **Partial QC.** Only full accept or full reject exists; seed data has `Partially rejected` and `Passed with reserve`. Need per-line accepted/rejected entry?
10. **Received status unreachable.** `poRow.receive` exists but no button; is reception purely driven by deliveries?
11. **Segregation of duties.** "Approve & order" on Orders, invoice approval and delivery QC have no role check, while My approvals routes PO approval to pm/director only and QC to quality/procurement. Which roles may act on each screen? Any amount thresholds?
12. **Cancellation.** A PO can be cancelled only by rejecting it in My approvals; no cancel for Draft/Ordered POs. Required?
13. **Stock adjust to zero** is impossible (`qtyN` must be non-zero), and there is no negative-stock guard on issue/transfer/scrap. Confirm rules.
14. **Issue to activity** has no activity picker (records "{p3} activity"); reserve uses the current project. Should issue select an activity and decrement the reservation of that project only?
15. **Import from X3** discards all local (unpushed) changes without warning. Desired merge behaviour?
16. **Transfer destinations** use the short label before " — " so both site stores show "Magasin chantier". Use full names?
17. **Generated deliveries** for non-HLT projects put stock at `Magasin chantier — Lyon`, which is not a configured location.
18. **Requests screen** is hard-wired to PM "R. Aubert" (and the dialog subtitle to Harbor Line). It should be the signed-in PM and the current project.
19. **Approvals department** is a free chip choice for any role (quality and director can decide for any department). Should it be locked to the department head's own department?
20. **Unnamed resources.** "Approve & send to procurement" appears for contract roles (`first` fallback), and the task is assigned to the role name. Intended flow for contract hires (procurement of a subcontractor)?
21. **Withdrawn requests** cannot be re-requested (only `rejected` shows Re-request). Intended?
22. **My approvals "Oldest"** shows the last pushed item's date, not the oldest; resource-request items have empty `when` and a hard-coded `who` ("R. Aubert"); PO and delivery items show a hard-coded `Fabien Bertrand`.
23. **Hard-coded KPIs**: Savings vs list €12k, Average cycle 9 d, Award rule PM, On-time deliveries 83%, Avg response 1.4 d / 0.9 d, Team load week headers "28 Sep"/"5 Oct". Define real formulas.
24. **Supplier scorecard** is global, but "NCRs this quarter" and the "NCRs from suppliers" KPI are computed from the current project only. Should they be portfolio-wide?
25. **Home (procurement role)** uses `poKpis[4]`, which does not exist (only 4 PO KPIs) — a tile renders empty. Which KPI was intended?
26. **i18n gaps**: no FR for `Pending review`, `Approved · assigned` (rendered "Approuvée · assigned"), `Withdrawn`, `Rejected / withdrawn`, the Requests/Approvals KPI labels, `Team capacity`, `1 week`, `+1 wk`…; `Request` (RFQ drawer heading, a noun) is translated as the verb "Demander". `money$` ignores the `currency` prop and quantities use the browser locale.
27. **Primary button on Approvals** ("Team capacity") carries a `ph-plus` icon although it navigates. Use a navigation icon?
28. **Inline QC decision in My approvals** throws (event-less call into `delivRow(d).accept/reject`, see §7.5). Confirm the inbox should apply the same Accept → stock / Reject → quarantine effects, and whether an inspection remark must be captured from the inbox.

---

## Addendum (completeness pass)

Flag and close-handler index for this area. The drawers and empty states are described in §1–§6 above; this table adds the identifiers so developers can trace them. All five drawers use the shared right-hand drawer shell from §0.5 (backdrop z60, panel z61, `width:min(640px,100vw)`).

| Flag | Template lines | Logic (render-values line) | Close / state | EN text | FR text |
|---|---|---|---|---|---|
| `noDeliv` | 1630 | `!delivRows.length` (5221) | — | "No delivery in this status" | "Aucune livraison dans ce statut" |
| `showDeliv` | 1632–1654 | `!!delivVals` (5221) | `closeDeliv` → `{deliv:null}` | Delivery drawer (§3.4) | — |
| `noStock` | 1687 | `!stockRows.length` (5222) | — | "No stock line matches" | "Aucune ligne de stock ne correspond" |
| `showStockSel` | 1694–1711 | `!!stockSel` (5222) | `closeStock` → `{stockRow:null}` | Stock-line drawer (§4.4) | — |
| `noApprovals` | 1732 | `!myApprovals.length` (5220) | — | "Nothing waiting for you — switch role (bottom-left) to see another queue" | "Rien en attente pour vous — changez de rôle (en bas à gauche) pour voir une autre file" |
| `showRfq` | 1999–2015 | `!!rfqVals` (5215) | `closeRfq` → `{rfq:null}` | RFQ drawer (§1.4.1) | — |
| `noInv` | 2041 | `!invRows.length` (5215) | — | "No invoice in this status" | "Aucune facture dans ce statut" |
| `showInv` | 2043–2052 | `!!invVals` (5215) | `closeInv` → `{inv:null}` | Invoice drawer (§1.4.2) | — |
| `noPOs` | 2661 | `!poRows.length` (5230) | — | "No purchase orders in this status" | "Aucune commande dans ce statut" |
| `showPO` | 2663–2685 | `!!SPO` (5230) | `closePO` → `{po:null}` | Order drawer (§2.4) | — |
| `queueEmpty` | 2778 | `!queue.length` (5189) | — | "Nothing waiting — every request for {deptName} is decided" | "Rien en attente — toutes les demandes pour {deptName} sont traitées" |
| `decidedEmpty` | 2790 | `!decided.length` (5189) | — | "No decisions yet" | "Aucune décision pour l’instant" |
| `teamEmpty` | 2806 | `!team.length` (5189) | — | "No named team members in this department yet" | "Aucun membre nommé dans ce service pour l’instant" |

Spot-check (completeness pass): the Purchase orders KPI seeds (5 open, €6.09M committed, 1 late, 1 awaiting approval), the PO values in the §2.6 table, the `poTag` mapping, the stepper glow rule and the `createDrafts` id and date rule (`'PO-'+(1100+draftPOs.length+i)`, `dayLabel(TODAY).slice(4)` = "25 Sep") were re-derived from source and match.
