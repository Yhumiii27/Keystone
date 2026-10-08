# Keystone PM — Delivery 4

Delivery 4 adds the technical reference and the supply chain (spec 00 §9, phase 6): the PLM parts catalogue, the project
BOM, engineering change orders, drawings, purchase orders, deliveries and goods receipt, stock, and sourcing / supplier
invoices. **Engineering change orders are owned by Vigie** (user decision, overrides the prototype and spec 09 §4):
Keystone shows them, opens them in Vigie and records progress on them through a connector (§5). The shell badges and
search, the Home and five more My approvals kinds now read the database.
Conventions: `docs/ARCHITECTURE.md`. Functional spec: `docs/spec/`. Earlier baselines: `docs/DELIVERY-1.md`, `docs/DELIVERY-2.md`, `docs/DELIVERY-3.md`.

## 1. Status at hand-over (8 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 124 files, 1654 tests, all passing (Delivery 3: 91 files, 1172 tests). Golden values are computed from the prototype logic. |
| `KEYSTONE_DIST_DIR=.next-ci npm run build` | succeeds (Next 16.4 / Turbopack), 47 routes, all dynamic (8 new pages). `KEYSTONE_DIST_DIR` keeps verification builds out of `.next`, which the Mac app serves |
| `npm run db:generate` | "No schema changes". Four migrations: `0000_living_gateway.sql` (40 tables), `0001_colorful_speedball.sql` (35 tables, 3 columns), `0002_amazing_lester.sql` (35 tables, 1 column) and `drizzle/0003_jittery_nextwave.sql` (31 new tables) |
| `scripts/db-check.ts` | "All checks passed", including the new "Delivery 4 tables (golden row counts)", "Delivery 4 data (DAL vs prototype)" blocks and the Delivery 4 writes in "Numbering & writes" |
| Golden generators | The eight Delivery 4 generators (§2) were re-run at the final integration; the tests pass against their output |
| Route matrix on `next start` with a fresh DB | 152 routes × 8 personas × FR/EN = 2 432 requests, all 200, no "being built" page on a built screen, nothing but the start-up lines in the server log; re-run after the mutations below, same result |
| Feature reviews | Seven fidelity reviews (plm, bom, eco + drawings, orders, deliveries, stock, procurement) re-ran the prototype's own logic (design lines 3095–5239) in node:vm, in EN and FR, for every persona, and compared it with the rebuild's view models on a seeded database. English matches the prototype; the French differences and the defect fixes are the deliberate ones in §7. They fixed the deviations listed in §7.1 and extended the golden tests. |

**Route matrix** (final integration; server `next start` on 127.0.0.1:3310 from `.next-ci`, log `/tmp/ks-d4-final.log`; ports 3000,
3100, 3110, 3200, 3210, 3217 untouched; `.data` deleted before and after):
- **Delivery 4 (25 routes, 400 requests):** `/`, `/reference/parts` (and `?part=CD-200`, `?part=FD-DET-OPT`),
  `/projects/HLT-026/bom` (and `?part=CD-200`, `?part=FD-DET-OPT`), `/projects/NDC-031/bom`, `/projects/EWA-051/bom`,
  `/reference/eco` (and `?eco=ECO-2026-015`), `/reference/drawings`, `/projects/{HLT-026,NDC-031}/orders`,
  `/projects/HLT-026/deliveries` (and `?deliv=BL-2026-0533`, `?receipt=BL-2026-0533`), `/purchasing/stock`,
  `/purchasing/sourcing` (and `?tab=inv&inv=INV-HC-7781`, `?tab=sup`), `/my/approvals`, `/projects/HLT-026/{plan, documents}`, `/portfolio/projects`.
- **Delivery 4 deep links and empty states (33 routes, 528 requests):** BOM `?view=tree|used|compare|spares`, `?node=ASM-RMG-250`,
  `?used=FD-DET-OPT`, `?sys=ASM-RMG-250`, unknown `?view=` / `?type=` / `?sort=`, a search with a sort; EWA-051 BOM, orders and
  deliveries; NDC-031 deliveries; `?po=PO-1082|PO-1101`, an unknown `?status=`; `?receipt=BL-2026-0600`; stock `?q=`, unknown
  `?loc=`, `?part=`; drawings `?dwg=`, `?state=wip&q=`; ECO `?status=in_approval`, `?eco=ECO-2026-017`, unknown `?eco=`; parts
  unknown `?type=`, `?restr=1&q=`, `?part=ME-GBX-95` (created during the run); sourcing `?rfq=RFQ-2026-031|RFQ-2026-035`,
  `?tab=inv&status=blocked`; `/my/approvals?filter=eco|po`.
- **Delivery 1 (14 routes, 224 requests)**, **Delivery 2 (22 + 16 routes, 608 requests)** and **Delivery 3 (20 + 22 routes,
  672 requests)**: the matrices of `DELIVERY-1.md` §1 (without `/dev/components`), `DELIVERY-2.md` §1 and `DELIVERY-3.md` §1, deep links included.

**Deep links:** `?part=CD-200` returns 200 without a drawer: CD-200 is a manufacturer reference (of FD-DET-OPT), not a part
reference. `?part=FD-DET-OPT` (any case) opens the part drawer on Parts, BOM and Stock. `?deliv=` (the prototype's key) is an alias
of `?receipt=` and opens the delivery drawer. An unknown `?eco=` or `?part=` returns 200 and opens nothing (the reviews' tests cover `?dwg=` too).

**Extra routes:** `/dev/components`, `/projects/XXX-999/bom`, `/reference/nope`, `/my/tasks/T-9999` → 404. `/projects/HLT-026/quality`,
`/admin/settings`, `/after-sales/fleet` (Installed base) and `/after-sales/claims` → 200 "This module is being built". `/resources/approvals` → 307.

**Outside-my-workspace banner** (EN and FR renders agree; `O` = banner, read-only). The Delivery 1–3 routes give the same matrix
as `DELIVERY-2.md` §1 and `DELIVERY-3.md` §1.

| Route | director | pm | depthead | member | englead | quality | procurement | client |
|---|---|---|---|---|---|---|---|---|
| `/reference/parts`, `/projects/*/bom`, `/reference/eco` | | | O | O | | | | O |
| `/reference/drawings` | | | O | O | | | O | O |
| `/projects/*/orders`, `/purchasing/sourcing` | | | O | O | O | O | | O |
| `/projects/*/deliveries`, `/purchasing/stock` | | | O | O | O | | | O |

**Mutations tested at integration** (fresh DB, Server Functions posted to `next start` by action ID; badges and queues read back
from the rendered pages; the route matrices were re-run after them with the same result):

| Feature | Action | Result |
|---|---|---|
| Purchase orders | client decides PO-1082 from the inbox; procurement approves on Orders; engineering lead creates drafts | refused ("not waiting for you", "Only the project manager or the portfolio director approves purchase orders", read-only) |
| Purchase orders | PM approves PO-1082 from My approvals | Ordered; Orders badge 1 → none; a second decision is refused |
| Purchase orders | procurement creates drafts from the BOM shortfall | PO-1100…PO-1112 (one per manufacturer); a second run is refused ("Every BOM article is already ordered") |
| Purchase orders | submit PO-1100 and PO-1101; director rejects PO-1100 (inbox), approves PO-1101 (Orders); Push to X3 | badge 2; PO-1100 Cancelled; `X3-PO-1101`; pushing a draft is refused |
| Deliveries | PM accepts BL-2026-0521; engineering lead decides it from the inbox | refused (QC belongs to quality, procurement, director; read-only inbox) |
| Deliveries | quality accepts BL-2026-0521 from My approvals | Accepted; Deliveries badge 1 → none; quality queue 3 → 2; a second decision is refused |
| Deliveries | announce on PO-1101, register (quantities as announced), quality rejects | BL-2026-0600; badge none → 1 → none (quarantine) |
| ECOs (Vigie mock) | director (holds no key), engineering lead (key already approved), quality deciding the PM key, member requesting a step | refused |
| ECOs (Vigie mock) | PM approves ECO-2026-015 from My approvals | "Approved · Pending sync with Vigie"; status stays "In approval" and the Change orders badge stays 1 (Vigie decides) |
| ECOs (Vigie mock) | engineering lead "Start impact analysis" on ECO-2026-017, twice | recorded as pending sync; the second is refused. Still 6 ECOs listed; no Server Function can create an ECO |
| ECOs (Vigie links) | `/reference/eco`, part and BOM node drawers | 7 anchors to `localhost:3200/modifications-techniques/…`, all `target=_blank`; "Raise ECO" → `/modifications-techniques/nouvelle?part=…&project=…&source=keystone` |
| Sourcing | engineering lead awards RFQ-2026-031; award to a supplier who did not quote; award twice | refused |
| Sourcing | procurement awards RFQ-2026-031 to Dillinger | draft PO-1113 at the quoted price |
| Sourcing | PM decides an invoice (P-5); procurement approves INV-HC-7781 received part; director approves INV-BX-55120 received part and INV-NV-1190 for payment; INV-LE-2210 rejected (twice) | refused; accepted ×3; rejected, then refused. Sourcing badge 3 → none |
| Sourcing | New RFQ | RFQ-2026-035 |
| Stock | engineering lead counts a line; issue 99 999 | refused ("Stock is read-only for you", "Only 0 on hand at …") |
| Stock | procurement counts MD-GAS-OUT at 50, then Push to X3 | Stock badge 1 → none; "Pushed to Sage X3 · MD-GAS-OUT · … · 1 movement" |
| PLM | client creates a part; engineering lead creates ME-GBX-95, then again | refused; created; duplicate refused |
| My approvals | queues at the end of the run | director 1 (CR-008), quality 2, PM 0, procurement 0 |

## 2. How to run

Same as `DELIVERY-1.md` §2, with these changes:
- **No new npm dependency.**
- **Database:** migration `0003` adds 31 tables. A fresh `./.data` is seeded completely. A database seeded before Delivery 4 gets
  `0003` on the next start and then the Delivery 4 modules once (catalogue, purchasing, stock, Vigie mirror), seeded against its own
  people, projects and activities when its catalogue is empty (`seedIfEmpty`, `src/server/db/seed/index.ts`). That backfill is not
  covered by the tests or the route matrix; `npm run db:reset` (server stopped) remains the reference. The Mac app keeps its own data in
  `~/Library/Application Support/Keystone/data` (README: quit the app and delete that folder for a fresh demo database).
- **Verification builds:** `KEYSTONE_DIST_DIR=.next-ci npm run build` and `KEYSTONE_DIST_DIR=.next-ci npx next start -p <port> -H 127.0.0.1`
  never touch `.next`. Such a build rewrites the gitignored `next-env.d.ts` to `.next-ci/types`; point it back to `.next/types` (or run
  `next dev`) after deleting `.next-ci`, or `tsc` fails.
- **Vigie:** `NEXT_PUBLIC_VIGIE_URL` (default `http://localhost:3200`) is the Vigie web app the links open; it is inlined at build time.
  `VIGIE_API_URL` (server only) switches the ECO connector from the mock to the HTTP implementation (§5). Leave it unset until Vigie
  publishes its ECO API.

Golden generators (each one runs the prototype logic in node:vm and rewrites a committed JSON; re-running them must leave the files unchanged):

| Script | Output |
|---|---|
| `npx tsx scripts/proto-golden-d4.ts` | `src/server/dal/delivery4.golden.json` (EN render values behind every Delivery 4 screen, incl. the shortfall drafts) |
| `npx tsx scripts/proto-golden-plm.ts` | `src/features/plm/plm.golden.json` (catalogue under every filter / sort, every part drawer, EN and FR) |
| `npx tsx scripts/proto-golden-bom.ts` | `src/features/bom/bom.golden.json` (7 projects, every display, EN and FR, every role) |
| `npx tsx scripts/proto-golden-eco.ts` | `src/features/eco/eco.golden.json` (ECO KPIs, chips, rows and drawer per persona; Drawings) |
| `npx tsx scripts/proto-golden-orders.ts` | `src/features/orders/orders.golden.json` (7 projects, drawers, chips, shortfall assistant, approve / cancel steps) |
| `npx tsx scripts/proto-golden-deliveries.ts` | `src/domain/deliveries.golden.json` (KPIs, chips, rows, drawers, header, badge) |
| `npx tsx scripts/proto-golden-stock.ts` | `src/features/stock/stock.golden.json` (incl. the transfer-of-reserved-goods cases) |
| `npx tsx scripts/proto-golden-procurement.ts` | `src/features/procurement/procurement.golden.json` (three tabs, drawers, New RFQ) |

## 3. Data

### Newly modelled (migration `0003`, schema in `src/server/db/schema/`, seeders in `src/server/db/seed/`)

| Schema file | Tables | Seeded from |
|---|---|---|
| `suppliers.ts` | `suppliers`, `storage_locations` | the manufacturers of PARTS, SUPPLIERS (scorecard), Keystone's own workshops; SETTINGS0 locations (7) |
| `catalogue.ts` | `parts`, `part_equivalents`, `part_last_prices`, `assembly_links`, `spare_list_lines` | PARTS (54, with HS code, export restriction and its control family, list price, lead time, wear / spare flag, unit), equivalents (one row per direction), last purchase prices, TREE (28 links), the PU/PR lists (25 lines) |
| `plm.ts` | `project_bom_lines`, `project_assembly_roots`, `revision_diffs`, `revision_diff_lines`, `drawings`, `drawing_revisions`, `pdm_vault_syncs` | the BOM of the 6 projects with data (59 lines), TREES (HLT-026: ASM-RMG-250 × 2), REV_DIFF (B → C), DRAWINGS (13, 28 revisions), the vault sync state "07:40" |
| `purchasing.ts` | `rfqs`, `rfq_quotes`, `purchase_orders`, `po_lines`, `goods_receipts`, `receipt_lines`, `receipt_attachments`, `supplier_invoices` | RFQS (4, 8 quotes); `genPOs` per project (21 orders, 35 lines, each line with its own unit price — A-11); HLT_DELIV + `genDeliv` (15 receipts, 25 lines, 44 documents / photos); SUP_INV (6) |
| `stock.ts` | `stock_positions`, `stock_movements`, `x3_sync_runs` | STOCK (18 positions by article × location, reservations per project), MOVES0 (5), the X3 import "07:15 · 15 lines" |
| `vigie.ts` | `vigie_ecos`, `vigie_eco_approvals`, `vigie_eco_parts`, `vigie_eco_projects`, `vigie_eco_effectivity`, `vigie_eco_progress` | The **read-only mirror** of Vigie's ECOs, seeded from the prototype ECOS (6 ECOs, 18 approval keys, 12 parts, 7 project links, 24 effectivity targets) through `src/server/integrations/vigie/prototype-snapshot.ts`; `vigie_eco_progress` is the outbox (empty at seed) |

New codes in `src/server/db/codes.ts`: part make / buy, type, status, wear / spare, unit, export control; BOM scope; ECO status,
approver keys, decisions, dispositions, interchangeability, step advance (`ECO_STEP_ADVANCE`) and the Vigie sync status
(`pending` / `sent` / `failed`); drawing state; RFQ status, award rule, Incoterm; PO status and origin; receipt status and
attachment kind; supplier invoice status and grade; location type; stock operations and movement types.

Rules settled in the data layer:
- **BOM value:** each article once. An assembly whose components are in the same BOM is valued through them (`isValuedByComponents`),
  so HLT-026 is €7.05M, not the prototype's €14.05M (09 OQ6, 00 §7.16).
- **PU/PR stock:** real on-hand quantities summed over the locations (`stockOnHandByRef`), fixing the `STOCK_BY_REF` tuple bug (E-3).
- **Price basis:** each PO line stores its unit price: the list price for the seed and the shortfall drafts, the quoted price for an
  RFQ award (A-11 still open).
- **Goods receipt effects (SC-3):** accepted quantities go to stock at the put-away location, rejected ones to quarantine; the PO's
  received quantities and status follow; the supplier invoices of that order are re-matched.
- **Supplier invoice status:** derived from the 3-way match at read time (`matchedInvoiceStatus`): an invoice "Awaiting receipt" whose goods
  are partly received shows as Blocked and can be approved for the received part.
- **ECOs:** never written by Keystone except through the connector's refresh (§5).

### Writes that persist (new in Delivery 4)

Every write validates its raw input and checks the viewer server-side, including the outside-workspace and project read-only
rules. It records the viewer as the actor in `audit_entries` / `activity_events` and revalidates the affected screens and badges.

- **PLM:** New part (unique reference, created "Not validated", revision A, the viewer as author); Register equivalent (both directions).
- **BOM:** Add article (part, quantity, activity, scope, note).
- **ECOs (sent to Vigie, §5):** the viewer's decision on their own approval key (approve / reject, comment); the step requests "Start impact
  analysis" (Draft) and "Submit for approval" (Impact analysis).
- **Drawings:** Sync vault (simulated PDM sync, real clock time).
- **Purchase orders:** drafts from the BOM shortfall (one per manufacturer, PO-1100…), Send for approval, Approve & order, Reject (Cancelled), Push to X3 (mock reference `X3-PO-…`).
- **Deliveries:** Announce a delivery (BL-2026-0600…), Register receipt (delivered quantity per article), quality decision (Accept → stock,
  Reject → quarantine, or per article), Attach delivery note (file name only).
- **Stock:** Adjust (count), Transfer, Reserve for project, Issue to activity, Return to stock, Scrap / rework; Import from X3 (merges, keeps
  local and pushed changes); Push to X3 per line.
- **Sourcing:** New RFQ (RFQ-2026-035…), send, compare, award → draft PO at the quoted price (SC-1); invoice Approve, Approve received part, Reject.
- **My approvals inline decisions:** purchase orders, ECO approval keys and delivery quality checks are decided for real.

### Still not modelled (read from the prototype JSON, marked `TODO(db)`)

- Installed base (FLEET, AS_MAINT): part drawer "Installed base", ECO effectivity machines, shell search (phase 8).
- NCRs (supplier scorecard counts, My approvals NCR kind, shell badge), client deliverables (phase 7).
- Claims, connectors, punch list, ITP, commissioning, engineering checks, P&ID, site.
- Real connectors: Sage X3 (orders, stock, accounts payable), SolidWorks PDM, Vigie (mock), Codex, Lucca, Outlook.

## 4. What is implemented

42 of the 59 registry screens are built: 34 from Deliveries 1–3 plus 8 new ones, all `built: true` in `src/config/screens.ts`.
The other 17 still render the "This module is being built" page.

### PLM — parts catalogue — `/reference/parts` (spec 09 §3)
- KPI tiles (Parts in catalogue, Validated, Outdated still in use, Export-restricted, Avg lead time), filters `?type=`, `?status=`, `?pu=`,
  `?mb=`, the "Export-restricted only" toggle `?restr=1`, search `?q=` (EN and FR names), sortable columns `?sort=` / `?dir=`, "Clear filters".
- Shared **part record drawer** `?part=` (case-insensitive; `<PartDrawer/>`, also used by BOM and Stock): identification, commercial and
  customs data, status banner, stock by location, "Used in" (projects and assembly chains), equivalents, revisions (REV_DIFF), drawings,
  documents, installed base (prototype data), engineering changes from the Vigie mirror with "Open in Vigie" and "Raise ECO" (opens Vigie).
- Primary "New part"; "Register equivalent" in the drawer. Open to director, PM, engineering lead, quality, procurement; refused server-side for the others.

### Project BOM — `/projects/[code]/bom` (spec 09 §1)
- KPI tiles (Articles, BOM value, Not validated, Outdated / obsolete, Export-restricted, Long lead (> 8 wks)); displays `?view=` flat list (filters
  `?type=`, `?mfr=`, search, sorts), assembly tree (`?node=` drawer, extended cost), where-used (`?used=`, open orders of the part),
  compare revisions (B → C, cost delta per crane), PU/PR spares list (`?sys=`, `?kind=`, real on-hand, below-recommended count).
- Primary "Add article" for viewers who may edit the project BOM. "Raise ECO" (node and part drawers) opens Vigie's new-ECO form for viewers
  whose workspace has the ECO screen; ECO tags open Keystone's ECO screen. Projects without data show an empty BOM.

### Engineering change orders — `/reference/eco` (spec 09 §4, **Vigie owns the ECOs**)
- KPI tiles (Open ECOs, Awaiting my approval, Released this month, Projects impacted, Parts under change, Dispositions pending), status chips
  `?status=`, the register with approval dots (state and sync state as accessible names), step buttons and a sync line under the status.
- Drawer `?eco=` (case-insensitive): step indicator, impacts, approval keys with the viewer's Approve / Reject, interchangeability and
  dispositions read-only with "Manage in Vigie", effectivity targets, "Open in Vigie".
- Primary "New ECO" opens Vigie (new window). Sidebar badge = ECOs in approval in the mirror. See §5 for the boundary.

### Drawings — PDM vault — `/reference/drawings` (spec 09 §5)
- Read-only mirror of the SolidWorks PDM vault: KPI tiles (Drawings in vault, Released, WIP / under review, Obsolete still referenced, Last
  vault sync), state chips `?state=`, search, drawer `?dwg=` (revision history, the ECO that drives it, "Open in PDM" for http(s) links only).
- Primary "Sync vault" (simulated) for director, PM, engineering lead, quality.

### Purchase orders — `/projects/[code]/orders` (spec 08 §2)
- KPI tiles (Open orders, Committed, Late deliveries, Awaiting approval), status chips `?status=`, drawer `?po=` with steps, lines, part
  warnings, receipts and invoices links, Sage X3 state.
- Primary "New purchase order" = the BOM shortfall assistant, shown only while articles are short (HLT-026: 15 articles, €884k).
  Send for approval; Approve & order only for the director or the project's PM; Push to X3 for approved orders drafted in Keystone.

### Deliveries & goods receipt — `/projects/[code]/deliveries` (spec 08 §3)
- KPI tiles (Deliveries, Awaiting quality check, Rejected quantity, On-time deliveries, Open orders to receive), status chips, register,
  drawer `?receipt=` (alias `?deliv=`) with lines, documents, photos placeholder, inspection.
- Primary "Announce a delivery" (form: PO, expected date, carrier, location); Register receipt (per-article delivered quantity); quality
  decision (accept, reject, partial rejection per article) for quality, procurement and director. Sidebar badge = receipts awaiting QC.

### Stock & storages — `/purchasing/stock` (spec 08 §4)
- KPI tiles (Stock value, Below minimum, In quarantine, X3 import, Local changes), location chips `?loc=`, search, 10-column table, recent
  movements, stock-line drawer `?stock=` (position, the six operations, destination, scrap warning on a pinned part, history, "Part record").
- Reservations, issues and returns use the current project. Import from X3, Push to X3 per line. Sidebar badge = lines below minimum.

### Sourcing, invoices & suppliers — `/purchasing/sourcing` (spec 08 §1)
- Tabs `?tab=rfq|inv|sup`: RFQ & quotes (comparison, award → draft PO), Invoices — 3-way match (PO / GR / INV dots with state text, blocking
  reason, `?status=` chips, decisions for procurement and the director), Supplier performance (scorecard, NCR counts of the current project).
- Drawers `?rfq=` / `?inv=`; primary "New RFQ". Sidebar badge = invoices to resolve.

### Shell, Home and My approvals (now read from the database)
- **Sidebar badges:** Orders (`posAwaitingApprovalByProject`, every project), Deliveries (`receiptsQcPendingByProject`), Sourcing
  (`countInvoicesToResolve`, the same queue as `invoiceQueue`), Stock (`stockNavBadge`), Change orders (`ecoNavBadge`, Vigie mirror).
- **Global search:** parts (`listParts`, incl. parts created in Keystone), purchase orders (`listPurchaseOrders`), ECOs (mirror), drawings.
- **Home:** parts, ECOs (Vigie mirror; `reported: true` = the status Vigie reports, never recomputed), drawings, purchase orders (own
  `valueEur`) and the BOM shortfall from the database. An ECO decision recorded in Keystone counts at once in "Waiting for me".
- **My approvals:** the purchase-order, ECO, delivery-QC, RFQ-award and invoice kinds read the database (`source: 'db'`). ECO items carry
  "Open in Vigie". Only the deliverable and NCR kinds remain on prototype data.

### Platform
- Domain modules with golden tests: `parts`, `bom`, `eco`, `drawings`, `orders`, `deliveries`, `stock`, `procurement`.
- Integration: `src/server/integrations/vigie/` (§5).
- i18n: `src/i18n/extra/{plm,bom,eco,orders,deliveries,stock,procurement}.json`; feature `i18n.ts` helpers for parameterised French.
- Shared component change: `Drawer` without a title is labelled by its header id (accessible name).

## 5. The Keystone ↔ Vigie ECO boundary

Vigie (the group's QHSE application, `http://localhost:3200`) owns the engineering change orders. Creation, editing, dispositions,
interchangeability, effectivity, release and the whole workflow happen in Vigie's database, never in Keystone. No Keystone Server
Function can create or edit an ECO.

**What Keystone shows.** The ECOs that concern its parts and projects, as Vigie reports them: the ECO register and drawer, ECO tags and
sections in the BOM, the part drawer, Stock pins, Drawings, the Home, global search, the nav badge and My approvals. Status, effectivity,
pending dispositions and the release lock are Vigie's values; Keystone derives only display texts, KPIs and chips (`src/domain/eco.ts`).

**What progress Keystone records** (`recordProgress`, validated server-side in `src/server/integrations/vigie/progress.ts`):
- **Approval:** the viewer's own key only (`englead`, `quality`, `pm`; the director holds none), on an ECO in approval in Vigie, key still
  pending and not already decided in Keystone; the PM key belongs to the PMs of the ECO's projects. Approve or reject, optional comment.
- **Step:** "Start impact analysis" (Draft → Impact analysis) and "Submit for approval" (Impact analysis → In approval), one at a time, by a
  viewer whose workspace includes the ECO screen.
- Each entry is written to the outbox `vigie_eco_progress` with the actor (the viewer), the status at recording time and a sync state
  `pending` → `sent` / `failed`. The UI shows "Pending sync with Vigie" / "Sent to Vigie" / "Sync with Vigie failed"; the ECO's status does
  not change in Keystone until Vigie reports it.

**Connector** (`src/server/integrations/vigie/`, interface `VigieEcoConnector`: `listEcos(filter?)`, `getEco(number)`,
`recordProgress(number, {key, decision, comment} | {step, comment}, actor)`, `sync()`; `getVigieEcoConnector()` picks the implementation):
- `config.ts`: `NEXT_PUBLIC_VIGIE_URL` (default `http://localhost:3200`), `VIGIE_API_URL` (optional, server only).
- **mock** (default): reads the local mirror seeded from the prototype ECOS; progress stays "pending sync with Vigie".
- **http** (`VIGIE_API_URL` set, `TODO(vigie)`): refreshes the mirror at most once a minute (`GET /api/ecos?source=keystone`, full refresh
  with prune; a stale mirror is used when Vigie is unreachable) and delivers the outbox (`POST /api/ecos/:number/progress`, Vigie answers `{ id }`).
  Both endpoints are proposals (OPEN QUESTION V-2).
- `mirror.ts`: `upsertMirror` is the only writer of the mirror tables (seed and refresh); `readMirror` overlays undelivered progress.

**URL patterns** (`links.ts`, the only place Keystone builds Vigie URLs; OPEN QUESTION V-1 until Vigie defines its ECO routes):
- `vigieEcoUrl(id)` → `/modifications-techniques/<ECO number>`.
- `vigieNewEcoUrl({ partRef?, projectCode?, title? })` → `/modifications-techniques/nouvelle?part=…&project=…&title=…&source=keystone`.
- `vigieEcoListUrl({ partRef?, projectCode? })` → `/modifications-techniques?part=…&project=…`.
- Every Vigie link uses `VIGIE_LINK_ATTRS` (`target=_blank`, `rel=noopener noreferrer`); the Mac app hands them to the browser.

**When Vigie ships its ECO module and API:** set the real routes in `links.ts` (one file), implement the two endpoints in
`eco-connector.ts` against Vigie's payload (`VigieEcoRecord` in `types.ts`), set `VIGIE_API_URL`. Vigie has not been modified by this delivery.

## 6. Known gaps — `TODO(db)` and placeholders

`grep -rn "TODO(db)" src` (32 markers). Retired in Delivery 4: the ECO, supplier-invoice, stock, purchase-order, delivery, part and
drawing blocks of the shell and the Home; the purchase-order, delivery-QC, invoice, RFQ-award and ECO kinds of My approvals and their
prototype item builders (`src/domain/approvals.ts`); the ECO effectivity lock of the Home.

| Where | What is still read from the prototype / not persisted |
|---|---|
| `src/server/dal/shell.ts:12, 63, 418, 444` | Badges, crumbs and search hits of unmodelled modules: claims, connectors, punch list, engineering checks, P&ID, site, NCRs (phase 7), installed base (phase 8) |
| `src/server/dal/home.ts:8, 45, 49, 55` | Client deliverables (Harbor Line only); client Home "Milestone 4 invoice €640k · 15 Oct" literal (A-5) |
| `src/domain/home.ts:468` | "Unmet demand 240 h" constant (A-12) |
| `src/server/approvals/ncr-verification.ts:2`, `deliverables.ts:2`, `types.ts:26`; `src/domain/approvals.ts:93` | My approvals kinds still on prototype data (NCR verification, deliverable acceptance; decisions are previews) |
| `src/server/dal/machines.ts:3`, `src/server/dal/plm.ts:5, 44`, `src/features/plm/part-drawer.tsx:11`, `src/features/plm/model.ts:315`, `src/server/dal/eco-screen.ts:38` | Installed base (FLEET / AS_MAINT): part drawer "Installed base", ECO effectivity machines (phase 8) |
| `src/server/dal/suppliers.ts:44` | NCR counts of the supplier scorecard (`allNCRs`, phase 7) |
| `src/server/dal/stock.ts:312` | Sage X3 stock import: the mock returns the seed snapshot |
| `src/server/dal/team.ts:31, 38` | Interfaces "Blocking commissioning" reads the prototype COMMISSIONING grid |
| `src/server/dal/plan.ts:149` | Template index (DEFS idx) of a project is not stored |
| `src/features/plan/drawer-model.ts:127` | Activity ↔ change request link |
| `src/features/schedule/actions.ts:14` | Re-baseline should write a `baselines` row |
| `src/features/hr/actions.ts:94, 117`, `src/features/hr/leave-view.tsx:30`, `src/app/(app)/projects/[code]/hours/page.tsx:32` | Lucca connector |
| `src/features/hr/skills-view.tsx:37` | "Open requests needing level ≥4" constant (06 OQ4, A-12) |
| `src/server/prototype/index.ts:4` | Rule: prototype reads must be marked `TODO(db)` |

Other markers: `TODO(vigie)` in `src/server/integrations/vigie/eco-connector.ts:10, 46, 72, 89` (HTTP connector, V-2); `TODO(X3)` in
`src/server/dal/orders.ts:5` and `src/domain/orders.ts:167` (Push to X3 uses `mockX3OrderRef`).

Other gaps:
- **17 screens not built:** Client view; Engineering (5 screens), P&ID, Quality, ITP, Site, Commissioning, REX; Installed base, Warranty
  claims; Settings, Machine types, Activity & integrations.
- **MVP scope** (phases 0–4) is complete except Settings and Machine types. Phases 5 and 6 are complete except the real connectors
  (Codex, Outlook, Sage X3, SolidWorks PDM, Vigie API).
- **Coming-soon toasts and inert controls (new):** BOM "Create spares purchase order" and "Export list" (E-3); Orders "Export PO";
  Deliveries "Print receipt"; delivery photos (placeholder, no upload); "Attach delivery note" stores the file name only (Codex hand-off pending).
- **Constants kept from the prototype** (A-12): Deliveries "On-time deliveries 83 %"; Sourcing "Savings vs list", "Average cycle" and
  "Award rule" tiles; Drawings "1 248" drawings in vault and the "Superseded by rev 2" texts; seed times "07:40" (vault), "07:15" (X3).
- **Left open by the reviews** (no code change):
  - PLM: in French the "Installed base" state tag leaves 15–25 px for the machine name (English is ~40 px in the prototype); Vigie links are
    shown to viewers outside the ECO screen, as on the ECO screen itself.
  - BOM: where-used with an empty or unmatched search still shows CR-BRG-SKF and lists orders of every status under "open order" (09 OQ22);
    EQ-CRN-250T (bought crane) and ASM-RMG-250 may be the same crane (possible second double count, E-2); search matches English names only.
  - ECO: a full refresh in HTTP mode deletes an ECO Vigie stops listing, with its unsent progress; focus drops to the page body after a decision;
    machine targets link to the unbuilt Installed base screen.
  - Orders: who may approve, thresholds, cancelling Draft / Ordered orders (P-5, SC-3); "Received" reachable only through receipts.
  - Deliveries: a rejection creates no supplier NCR (phase 7) and sends no notification; deciding from My approvals says "Approved / Rejected"
    (shared inbox buttons). For the components owner: `ClickableRow` should ignore clicks from dialogs opened inside a row.
  - Stock: no activity picker for "Issue to activity" (08 OQ14); an issue can take another project's reserved goods once the free quantity is
    used up; `getStockPosition().transferTargets` is unused.
  - Sourcing: RFQs created in Keystone never receive quotes (SC-7); supplier names are free text; the client and outside viewers read supplier
    prices and invoices (P-2); the cleaner fix for partial QC (store Blocked in `decideReceipt`) belongs to Deliveries — the read-side rule then becomes a no-op.

## 7. Deliberate deviations from the prototype

Delivery 1–3 deviations still apply (`DELIVERY-1.md` §6, `DELIVERY-2.md` §6, `DELIVERY-3.md` §6). New in Delivery 4:

| Area | Prototype | Rebuild |
|---|---|---|
| ECO ownership (user decision, overrides 09 §4) | ECOs created and managed in Keystone ("New ECO" form, interchangeability, dispositions, release) | Vigie owns them; Keystone shows the mirror, opens Vigie and records the viewer's key decision and two step requests, sent to Vigie (§5) |
| "Raise ECO" (00 §7.16) | Sets `ecoNew`, never consumed | Opens Vigie's new-ECO form prefilled with the part and project |
| ECO status after a Keystone decision | Recomputed from the approvals | Vigie's status until Vigie reports otherwise; Home and My approvals count the decision at once |
| ECO PM key | Any PM | Only a PM of an impacted project |
| ECO part links (09 OQ19) | Current project's BOM | The PLM part record |
| BOM value (09 OQ6, 00 §7.16) | Flat sum counts assemblies and their components (HLT-026 €14.05M) | Each article once (€7.05M) |
| PU/PR stock (E-3, `STOCK_BY_REF` bug) | Always 0 | Real on-hand (CR-BRG-SKF 16, HST-ROP-28 2, FD-DET-OPT2 60); "Not in stock" 10 |
| Lead-time column | Header "Discipline lead" | "Lead time" (FR "Délai d’approvisionnement") |
| Harbor Line fallback | HLT-026 BOM, orders, shortfall on every project | Empty states |
| Part drawer | «Freeze» section; ECO section hidden without ECO | "Documents"; stock by location, "Used in", revisions and drawings added; ECO rows with "Open in Vigie" and sync note; section kept for ECO-screen roles so they get "Raise ECO" |
| New part / Register equivalent | Toasts | Saved (equivalence both ways; new part "Not validated", revision A) |
| Approve & order (08 OQ11) | Every role | Director or the project's PM, server-side too |
| Order details | Cancelled orders flagged late; "14ug A" dates; mixed EN/FR sentences | Not late; real dates; full FR sentences; receipts / invoices links, Sage X3 row, Push to X3 |
| Delivery QC (08 OQ11, 00 §7.16) | PM may decide; inline QC in My approvals crashes; inspector named in advance; remarks shared across deliveries | Quality, procurement, director; inline decision records Accept → stock / Reject → quarantine; inspector named once done; remarks per delivery |
| Announce / Register (SC-4, 00 §7.16) | One-click; the announced entry never listed; hard-coded Hélène Sauvage, Geodis, Fabien Bertrand | Forms; listed at once; actors follow the viewer; partial rejection per article |
| Receipt effects (SC-3) | Status only | Stock and quarantine movements; PO received quantities and status; invoices re-matched. Put-away at the unlisted "Magasin chantier — Lyon" goes to the central warehouse |
| Stock rules (SC-5) | No adjustment to 0; no negative-stock guard; an issue decrements the wrong project's reservation; Import from X3 discards local changes | Count to 0 allowed; no movement above on hand; reservation per project, travelling with a transfer (refused onto another project's reservation); local and pushed changes kept; Push to X3 per line; full location names |
| Supplier invoices (P-5, SC-2) | Every role with the screen (the PM included) decides; "Rejected" has no chip and stays in the KPIs | Procurement and the director; "Rejected" chip, out of the KPIs; partial receipts shown Blocked and approvable for the received part |
| RFQ award (SC-1) | Toast | Draft PO at the quoted price |
| French texts | Statuses not agreed, "0.5 %", English part names, "1 wk" | "Acceptée", "Refusée", "Reçue"; "0,5 %"; French thousands separators; translated names; singular forms; FR "Délai", "Demande", "Transfert", "rév. D" |
| Dates and quantities | "01 Sep"; browser locale | "1 Sep"; the app's language |
| Drawings | "Open in PDM" opens any address | http(s) only |

Kept on purpose although questionable (spec open questions):
- Where-used defaults to CR-BRG-SKF and lists every order status (09 OQ22).
- Sourcing FR keeps "Payé", "Refusé" and "1.2%"; the seed RFQ-2026-031 keeps its S355 title on part KS-STL-0450 (SC-7).
- The client and other outside viewers can read supplier prices and invoices (P-2).
- Text coming from Vigie is translated only on an exact dictionary match.

### 7.1 Fixed by the fidelity reviews and the final integration

| Feature | Fix |
|---|---|
| PLM | New part dialog sub-line names the current project (09 §0.3); `?part=` case-insensitive and an unknown reference dropped from the links; long FR section labels wrap in the drawer; FR names in "Register equivalent"; dead code removed |
| BOM | Stale `?sys=` fell back to an empty list; "Raise ECO" in the node drawer followed the edit right instead of the ECO-screen rule (`BomViewOpts = { canEdit, canRaiseEco }`), now with the "opens outside" arrow and tooltip; whole header cells sort |
| ECO | Long FR sync line widened the table and overflowed on a phone; delivered progress still said "Pending sync"; `?eco=` / `?dwg=` case-insensitive, unknown dropped; "Open in PDM" http(s) only; approval dots had no accessible name |
| Orders | Refused actions left stale rows and banners (`stale()` refreshes first); title-less drawer had no accessible name (shared `Drawer`) |
| Deliveries | Clicks in the row's Register form leaked to the row; focus fell to the body after a decision; `?deliv=` alias; the announced delivery hidden by the status filter; BOM / Orders links now use those screens' helpers |
| Stock | A transfer of reserved goods lost the reservation; FR search missed the displayed part name |
| Procurement | Second rejection allowed in the DAL; partial QC left an invoice with only "Reject"; match dots colour-only; broken links with an unknown project cookie |
| Integration | Eight screens built; Orders, Sourcing, Stock badges and parts / PO search on the database; Home and five My approvals kinds on the database; unused prototype item builders removed; `getBomShortfall` reuses `bomShortfall` |
| Final integration | `src/domain/eco.ts` imported a value from `@/domain/approvals`, which loads the screen registry (icons) and crashed `scripts/db-check.ts` under `--conditions=react-server`; it now uses `isoOfDisplayDate` from `codes` (type-only import kept). `next-env.d.ts` pointed back to `.next/types` after the verification build |

## 8. Open questions blocking the next steps

IDs refer to spec 00 §10 unless a spec number is given. Questions of earlier `DELIVERY-*.md` §7 not repeated here are still open.

| ID | Question | Blocks |
|---|---|---|
| V-1 (new) | Vigie's ECO routes: register, record, creation form and its prefill parameters (`part`, `project`, `title`, `source`) | Every Keystone → Vigie link (`links.ts`) |
| V-2 (new) | Vigie's ECO API: list endpoint and payload, progress endpoint and acknowledgement, authentication, what happens to progress on an ECO that left approval or that Vigie stops listing | HTTP connector; leaving the mock |
| E-2, A-11 | Price basis of BOM roll-ups and PO lines (list, last purchase, PO unit price); is EQ-CRN-250T the same crane as ASM-RMG-250 | BOM value, Orders, Home, transport valuation |
| E-3 | "Create spares purchase order": its own PO origin so it does not count against the BOM shortfall; "Export list" | BOM PU/PR |
| E-7 | PDM sync contract (fields, frequency, previews, "Open in PDM", vault KPIs) | Drawings beyond the simulated sync |
| E-8, phase 8 | Installed base and as-maintained configuration | Part drawer, ECO effectivity |
| P-5, SC-3 | Who approves POs and invoices, thresholds, cancelling Draft / Ordered orders, making PO "Received" explicit | Orders, Sourcing, My approvals |
| SC-2 | "Paid" from the X3 sync; "Due within 30 days" | Sourcing |
| SC-4 | Delivery note to Codex, Print receipt, Export PO, photo storage | Deliveries, Orders |
| SC-5, 08 OQ14 | Activity picker for issues; issuing another project's reserved goods | Stock |
| SC-6 | Supplier grades derived from OTD / quality / NCR rate; portfolio vs project NCR counts | Sourcing, Quality (phase 7) |
| SC-7 | New RFQ data model (part picker, supplier list, quantity); quotes for RFQs created in Keystone | Sourcing |
| A-1, I-3 | Sage X3 connector (orders, stock, accounts payable): mode, references, conflicts | Push / Import to X3 |
| A-12 | Sources for On-time deliveries 83 %, Savings vs list, Average cycle, Award rule, vault count | KPI tiles |
| P-2 | Client and outside viewers reading supplier prices and invoices | Sourcing, client portal |
| 09 OQ22 | Where-used default and the "open order" status filter | BOM |

## 9. For the next team

- **Routes:** `screenHref(id, { code })`; flip `built: true` in `src/config/screens.ts` when a screen lands.
  - PLM (`src/features/plm/links.ts`): `plmHref`, `withPart`, `openInPlmHref`, `ecoHref`, `drawingHref`, `stockHref`, `bomHref`.
  - BOM (`src/features/bom/links.ts`): `bomHref`, `bomSparesHref`, `bomPartHref`; URLs `?part=`, `?view=spares&sys=`, `?node=`.
  - ECO (`src/features/eco/links.ts`): `ecoScreenHref`, `drawingsHref`, `partRecordHref`, `projectBomHref`. `<VigieLink/>`, `<VigieIconLink/>` (`vigie-link.tsx`).
  - Orders: `orderHref(code, number)` (`@/domain/orders`), `ordersHref(code, { status, po })`, `receiptHref`, `invoiceHref` (`src/features/orders/links.ts`).
  - Deliveries: `deliveriesHref` (`src/features/deliveries/model.ts`). Stock: `stockHref` (`src/features/stock/links.ts`). Sourcing: `sourcingHref` (`@/domain/procurement`).
- **Components:** `<PartDrawer partRef projectCode? closeHref />` (`src/features/plm/part-drawer.tsx`, `?part=` matched case-insensitively).
  Any caller of `bomScreenView` must pass `{ canEdit, canRaiseEco }`.
- **Vigie:** `getVigieEcoConnector()` (`src/server/integrations/vigie/eco-connector.ts`); `vigieEcoUrl`, `vigieNewEcoUrl`, `vigieEcoListUrl`,
  `VIGIE_LINK_ATTRS` (`links.ts`); `vigiePublicUrl`, `vigieApiUrl` (`config.ts`). Never write the `vigie_*` mirror tables outside `upsertMirror`.
- **DAL** (`src/server/dal/`, server-only):
  - `parts.ts`: `listParts`, `getPartsByRef`, `getPart`, `getPartRecord`, `lastPriceByRef`, `createPart`, `registerEquivalent`. `plm.ts`: `getPlmCatalogue`, `getPartDrawer`, `listEquivalentCandidates`.
  - `bom.ts`: `getProjectBom`, `getProjectAssembly`, `resolveWhereUsedQuery`, `getWhereUsed`, `getRevisionComparison`, `getSpareList`, `listBomActivityOptions`, `addBomLine`. `bom-screen.ts`: `getBomScreen`.
  - `eco.ts`: `listEcos`, `getEco`, `recordEcoProgress`, `countEcosInApproval`, `openEcoByPart`, `partsUnderChange`, `installedBasePins`, `ecoApprovalQueue`.
    `eco-screen.ts`: `getEcoScreen(viewer, requested)`, `getDrawingsScreen(requested)` (both return `selected`), `resolveId`, `ecoNavBadge`. `drawings.ts`: `listDrawings`, `getDrawing`, `getVaultSyncState`, `syncPdmVault`.
  - `purchasing.ts`: `listPurchaseOrders`, `getPurchaseOrder`, `listAllPurchaseOrders`, `listPurchaseOrdersWithParts`, `posAwaitingApprovalByProject`,
    `getBomShortfall`, `createDraftPurchaseOrders`, `submitPurchaseOrder`, `approvePurchaseOrder`, `rejectPurchaseOrder`, RFQs (`listRfqs`, `getRfq`, `createRfq`,
    `sendRfq`, `compareRfqQuotes`, `awardRfq`), invoices (`threeWayMatch`, `matchedInvoiceStatus`, `listSupplierInvoices`, `getSupplierInvoice`,
    `countInvoicesToResolve`, `approveInvoicePayment`, `approveInvoiceReceivedPart`, `rejectSupplierInvoice`), queues (`poApprovalQueue`, `rfqAwardQueue`, `invoiceQueue`).
    `orders.ts`: `getOrdersScreen`, `pushPurchaseOrderToX3`.
  - `deliveries.ts`: `listReceipts`, `getReceipt`, `getDeliveriesScreen`, `receiptsQcPendingByProject`, `qcQueue`, `announceDelivery`, `registerReceipt`,
    `acceptReceipt`, `rejectReceipt`, `recordReceiptQc`, `attachReceiptDocument`.
  - `stock.ts`: `listStock`, `stockOnHandByRef`, `listStockMovements`, `getStockPosition`, `getX3StockSync`, `stockNavBadge`, `applyStockMovement`,
    `importStockFromX3`, `pushStockToX3` (`planStockMovement` accepts `targetReservedFor`). `suppliers.ts`: `listSuppliers`, `getSupplierScorecard`, `listStorageLocations`.
    `machines.ts`: `listInstalledBase`, `machinesCarryingPart` (prototype data until phase 8).
- **Server Functions:**
  - `src/features/plm/actions.ts`: `createPartAction`, `registerEquivalentAction`. `src/features/bom/actions.ts`: `addBomArticleAction`.
  - `src/features/eco/actions.ts`: `decideEcoApprovalAction`, `requestEcoStepAction`, `syncVaultAction`.
  - `src/features/orders/actions.ts`: `createDraftOrdersAction`, `submitOrderAction`, `approveOrderAction`, `pushOrderToX3Action`, `decidePurchaseOrderAction`.
  - `src/features/deliveries/actions.ts`: `announceDeliveryAction`, `registerReceiptAction`, `acceptReceiptAction`, `rejectReceiptAction`,
    `recordPartialQcAction`, `decideReceiptFromInboxAction`, `attachDeliveryNoteAction`.
  - `src/features/stock/actions.ts`: `applyStockMovementAction`, `importFromX3Action`, `pushStockLineAction`.
  - `src/features/procurement/actions.ts`: `createRfqAction`, `sendRfqAction`, `compareRfqAction`, `awardRfqAction`, `approveInvoiceAction`, `approveInvoicePartAction`, `rejectInvoiceAction`.
- **Reusable logic** (`src/domain/`, pure, golden-tested): `parts` (catalogue filters, KPIs, restriction and stock texts), `bom` (`bomSummary`,
  `isValuedByComponents`, `buildAssembly`, `rollupCost`, `pathQuantity`, `systemQuantity`, `bomShortfall`, `orderedQtyByRef`, `groupBySupplier`,
  `spareShortfall`), `eco` (KPIs, chips, dots, `syncStateOf` / `syncLabelOf`, `canActOnKey`, `ecoApprovalItems`), `drawings`, `orders` (`poKpis`,
  `poValueEur`, `isLatePo`, `canPushPoToX3`), `deliveries` (`registerPlan`, `qcPlan`, `putAwayAfterQc`, `QC_DECIDERS`), `stock`
  (`planStockMovement`, `planX3Import`, `availableQty`), `procurement` (`match3`, `blockingReason`, `compareQuotes`, `invoiceKpis`).
  `src/domain/eco.ts` must keep only a type import of `@/domain/approvals` (a value import breaks `scripts/db-check.ts`).
- **Adding an approval kind:** follow the providers in `src/server/approvals/` (`source: 'db'`); NCR and deliverable kinds are next (phase 7).
- **Time model:** unchanged (`PG_NOW`, `NOW_ISO`, `CODEX_TODAY_ISO`, `STATUS_ISO`); only "Sync now", "Sync vault" and the outbox use the real clock.

### What the future "Expédition & transport" module can reuse (`docs/BACKLOG.md` §1; not built)

These fields are first-class columns, not texts; read them through the DAL rather than copying them.
- **Customs data per article:** `parts.hs_code` (null = not applicable), `parts.export_restriction` (EN source text) and `parts.export_control`
  (`dual_use`, `encryption`, `dangerous_goods`, `medical_device`, `anti_dumping`), the unit (`parts.unit`) and the manufacturer (`suppliers`).
  `PartRow` (`listParts`, `getPartsByRef`) carries `hsCode`, `exportRestriction`, `exportControl` and the per-project `usage` quantities.
- **BOM quantities:** `project_bom_lines.quantity` per project and article, with `scope` (`keystone` / `client` / `overlay`); the assembly structure
  (`assembly_links`, `getProjectAssembly`, `pathQuantity`, `systemQuantity`) to expand an assembly into the parts actually shipped, and
  `isValuedByComponents` to avoid counting an assembly and its components twice (the packing-list ↔ BOM check needs the same rule).
- **Values:** `parts.list_price_eur`, `part_last_prices.unit_price_eur`, `po_lines.unit_price_eur` (price basis A-11 to settle before valuing parcels or customs declarations).
- **Ordered and received quantities:** `po_lines` (ordered / received per article), `orderedQtyByRef`; `goods_receipts` and `receipt_lines` (ordered,
  delivered, accepted, rejected, put-away location; carrier, delivery note, dates) through `listReceipts` / `getReceipt` — the site-arrival link of the backlog.
- **Stock and locations:** `stock_positions` by article × `storage_locations` (site stores included), `stockOnHandByRef`.
- **Incoterm:** only on RFQs today (`rfqs.incoterm`, codec `Incoterm`); orders do not carry it yet.
- **Not modelled yet** (the module will need them): weights, dimensions, country of origin, parcels, containers, freight mode, forwarder, shipping milestones.
