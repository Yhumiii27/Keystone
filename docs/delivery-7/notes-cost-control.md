# Delivery 7 — lot "cost-control" notes

Scope: R-068, R-070, R-071, R-072, R-073 of `docs/RESTE-A-DEVELOPPER.md` (`docs/DELIVERY-7-PLAN.md`, lot cost-control). Owner
decisions applied: **A-4** (one change register, automatic propagation), **A-8** (the contingency register is the "consumed"
figure), **C-4** (draw-down linked to a CR / risk / NCR, validated by the portfolio director), **Q-1** (cost entered, EMV =
cost × P / 5), **C-2a** ("la valeur acquise vaut avancement × budget"), **A-12** (formulas on data), **A-13** (one health rule),
**A-15** (real data only). To be folded into `DELIVERY-7.md`.

Pure rules: `src/domain/cost-control.ts` (tests `src/domain/cost-control.test.ts`), `src/domain/risk.ts` (Q-1),
`src/domain/contingency.ts` (draw-down form). DAL: `src/server/dal/evm.ts` (new), `change-posting.ts` (new), `contingency.ts`,
`cost.ts`, `risks.ts`. Integration tests: `src/server/dal/cost-control.test.ts`, `src/features/risks/actions.test.ts`.

## 1. R-073 — earned value from Keystone data at the data date

### Rules (`computeEvm`, `src/domain/cost-control.ts`)

- **Progress** = Σ activity budget × % complete / Σ activity budget (budget-weighted, 0–1).
- **EV(t)** = BAC × Σ (budget × % × g(t)) / Σ budget, g = share of the activity's *actual* span elapsed at t (actual start →
  actual finish, or → the data date while in progress). At the data date EV = progress × BAC (C-2a).
- **PV(t)** = BAC × Σ (baseline budget × f(t)) / Σ baseline budget, f = share of the activity's *baseline* span elapsed at t. The
  plan is the current baseline's activity snapshot (BL1 on every seeded project); a project without a snapshot uses its
  activities' current dates (`planSource: 'plan'`).
- **AC(t)** = Σ activity actual cost × g(t) + validated contingency draw-downs dated ≤ t (A-8: a draw-down is booked on the
  reserve line).
- Spans are spread **linearly over calendar days**, inclusive. The BAC scaling spreads the unallocated contingency pro rata
  (as the prototype's generated projects did, 04 §1.8).
- One point per chart month (month end); the month of the data date holds the values **at the data date**
  (`projectDataDate`, default 25 Sep 2026); EV / AC stop there. 12 months from `project_controls.start_month` (else the
  project's start month, else the first activity month).
- **SPI** = EV / PV, **CPI** = EV / AC at the data date (null without PV / AC).
- **Orders placed / commitments** = Σ open purchase-order lines (`ordered`, `partially_received`) not yet received, k€
  (`openCommitmentKeur`).
- A project **without activity budgets** keeps its stored figures (the prototype's: there is no Keystone data to compute from,
  A-15). That is the case of the 11 projects without planning data.

### Where it is read

`src/server/dal/evm.ts` (`listProjectEvms` is memoised per request with React `cache`, `getProjectEvm`, `getOpenCommitment`):

- projects register / every `listProjects()` reader: progress, actual cost, SPI (health, CPI, EAC, VAC follow — A-13);
- Budget (Performance: PV / EV / AC series, % complete, CPI, EAC, TCPI…; Setup: work packages' actual / EAC = Σ activities;
  Cash: orders placed);
- Schedule progression curve, Plan, client portal (progress tile and "Progress to date" bars), Contingency (progress),
  portfolio finance / planning screens, Home.

Footnote on the Budget Performance tab when computed: "Planned value follows the cost-loaded baseline · Earned value =
progress × budget" (FR in `src/i18n/extra/d7-cost-control.json`).

### Old → new values of the seed (data date 25 Sep 2026)

| Project | Progress | PV | EV | AC | SPI | CPI | Health |
|---|---|---|---|---|---|---|---|
| HLT-026 | 64 % → 63 % | 3 420 → 3 663 | 3 080 → 3 006 | 3 360 (=) | 0.90 → 0.82 | 0.92 → 0.89 | At risk → **Off track** |
| NDC-031 | 51 % → 46 % | → 1 018 | 1 071 → 973 | 1 020 → 884 | 0.98 → 0.96 | → 1.10 | On track → **At risk** |
| RCF-019 | 82 % → 77 % | → 1 149 | 1 107 → 1 040 | 1 210 → 1 076 | 0.84 → 0.91 | → 0.97 | Off track → **At risk** |
| ERP-202 | 45 % → 52 % | → 500 | 432 → 499 | 410 → 457 | 1.01 → 1.00 | → 1.09 | On track (=) |
| WSA-044 | 27 % → 8 % | → 271 | 918 → 271 | 880 → 247 | 1.06 → 1.00 | → 1.10 | On track (=), pipeline |
| MSR-012 | 91 % → 92 % | → 580 | 564 → 572 | 550 → 553 | 0.95 → 0.99 | → 1.03 | At risk → **On track** |

Other displayed values that follow (each test cites the decision):

- Budget HLT-026: EV €3.08M → €3.01M, CPI 0.92 → 0.89, EAC €5.24M → €5.37M, VAC −€436k → −€565k, TCPI 1.19 → 1.25,
  CV −€280k → −€354k, SV −€340k → −€657k; **orders placed €713k → €3.95M** (see open question 1).
- Projects register (budget view) HLT-026 earned €3.01M · EAC €5.37M · VAC −€566k; NDC-031 spent €884k, EAC €1.91M, VAC
  +€192k; RCF-019 spent €1.08M, VAC −€46k; MSR-012 VAC +€21k (`src/features/projects/register.test.ts`).
- Client portal HLT-026: progress 64 % (planned 71 %) → 63 % (planned 76 %); NDC-031 51 % (38 %) → 46 % (48 %).
- Portfolio finance: margin afr 15 % → 19 % (NDC-031 CPI 1.05 → 1.10); 6-month net cash +€2.84M → +€2.71M, lowest point
  −€521k → −€570k (euna +€2.34M / −€617k → +€2.26M / −€659k; afr +€498k / +€97k → +€450k / +€89k).
- Projects map "at risk" count: euna 3 → 2 (MSR-012 back on track), afr 0 → 1 (NDC-031).
- `scripts/db-check.ts` updated accordingly (decision ids in comments); it passes.

Golden fixtures generated from the prototype are patched in the tests through `src/test/d7-cost-control.ts` (health, rounded
progress, actual cost, SPI of the six projects), never by editing the `*.golden.json` files.

## 2. R-068 — approved change requests flow into the budget and the contract (A-4)

### One register

`getCostControl` (`src/server/dal/cost.ts`) no longer reads `budget_change_lines` nor the seeded reconciliation figures:

- change list = the register without drafts (`budgetChangeRows`), each id links to Change control (`?cr=`);
- "Approved changes" = Σ approved amounts · count; "Pending" = Σ in-review amounts, sub-line "CR-008 · In review" /
  "N change requests in review" / "No change request in review" / "No change requests raised" (`registerReconciliation`,
  `pendingSubText`);
- work packages' "Changes" = Σ of the register's allocations (`workPackageChanges`).
- Client portal "approved changes" reads the same reconciliation.

### Posting an approval (`src/server/dal/change-posting.ts`)

`decideChangeStep` calls `postApprovedChange(tx, crId, actor)` **inside the approval transaction** when the request becomes
approved (Change control or My approvals):

1. `change_request_postings` has a **unique key on the request**: a second call, a retry or a concurrent approval inserts
   nothing and returns null (idempotent). The project row is locked (`FOR UPDATE`).
2. BAC: `projects.budget_keur = budget_keur + amount` (atomic). The posting stores BAC before / after and the allocation.
3. Allocation (`allocateChange`): explicit WBS amounts kept; the rest pro rata of the original budget of the listed work
   packages, or of every work package for the project root / an unknown code; rounding drift on the largest share.
4. Amendment (`amendmentOutcome`): a **contractual** change (client step approved, amount ≠ 0) on a project **with a contract**
   gets a **draft** amendment "Amendment N — <CR title>" for the CR amount, linked to the CR (`prepared`); `exists` when the
   contract already has one for that CR; `not_contractual` (client step not required); `no_contract`. A draft does not change
   the contract value (signed amendments do, existing rule).
5. Audit: area Budget "posted to the budget · BAC 4800 → 4885 k€ · 1.4 +85 k€"; area Contract "amendment prepared from CR-008 ·
   Amendment 3 — … (CR-008) · 85 k€ · Draft"; the Change control audit line gets "posted · BAC … · amendment prepared".
   Activity feed: "Posted CR-008 to the budget · BAC +85 k€ · amendment prepared". A zero-amount request records the posting
   row only (no BAC change, no audit noise).

### Old → new

| Where | Before | After |
|---|---|---|
| Budget HLT-026 change list | Budget's own list (incl. CR-007 "Yard drainage re-routing") | Register: CR-004 +120, CR-006 +65, CR-007 +15 approved, CR-008 +85 in review (−12 d), CR-005 −40 rejected |
| Work-package changes HLT-026 | 1.2 +120 · 1.4 +65 · 1.6 +15 | 1.3 +120 · 1.5 +65 · 1.7 +15 (register WBS) |
| Approving CR-008 | nothing moved | BAC 4 800 → 4 885, WP 1.4 +85, Amendment 3 draft 85 k€, Pending → "No change request in review" |

## 3. R-070 — the contingency register is the "consumed" figure (A-8)

- Drawn = Σ **validated** draw-downs of the register (`drawTotals`). The Budget's reserve line actual = drawn; its forecast =
  max(drawn, stored forecast consumption), shown apart ("32% drawn · Forecast €208k").
- Provision (`provisionOf`): the register's initial amount; without a register, the **budget's contingency line**; without
  either, round(BAC × 3 %). The first draw-down creates the register with that provision.
- Validated draw-downs are part of AC (reserve line) at their date (R-073).

| Where | Before | After |
|---|---|---|
| Budget HLT-026 contingency tile | 139 % drawn · +€58k over (red) | 32 % drawn · Forecast €208k |
| Budget NDC-031 reserve line | actual 85 | actual 0, forecast 85 (provision 100) |
| Contingency NDC-031 (no register) | provision 63 (BAC × 3 %) | 100 (budget line); EWA-051 keeps 66 (BAC × 3 %) |

## 4. R-071 — linked draw-downs validated by the portfolio director (C-4)

- Form "Record draw-down": amount, reason, **"Linked to" required**, a list of the project's change requests (not drafts),
  risks (open first) and NCRs from the Vigie mirror (`drawLinkOptions`); no approver field any more. Server checks: the link
  is one of the project's items, amount > 0, reason, **amount ≤ provision − drawn − pending** (`submitBalanceError`).
- Status `submitted` → `validated` | `rejected` (`contingency_draws.status`, seeded draw-downs = validated). Only validated
  ones count.
- My approvals: new kind **"Contingency draw-down"** (`contingency`, provider `src/server/approvals/contingency-draws.ts`),
  visible to the **director** only, all projects. Approve → validated (refused if drawn + amount > provision,
  `validateBalanceError`); Reject → optional comment the requester sees. Server Function `decideDrawDownAction`
  (`src/features/risks/actions.ts`): refused outside the inbox workspace, for any role but director, on malformed ids, on an
  unknown / already decided draw-down (`stale`, conditional update `WHERE status = 'submitted'`).
- Writers lock the register row (`FOR UPDATE`) so two draw-downs cannot both pass the balance check.
- Audit (area Contingency) "draw-down submitted · 30 k€ · NCR-029 · awaiting validation", "draw-down validated · …",
  "draw-down rejected · 10 k€ · CR-004 · <comment>"; activity feed lines; notifications: the director on submission
  ("Contingency draw-down to validate"), the requester on decision.
- Contingency screen: "Linked to" opens the CR (Change control `?cr=`), risk (`?risk=`) or NCR (Quality `?ncr=`) when it
  resolves; "Approved by" shows the validator, or a status tag "Awaiting validation" / "Rejected" (with the comment);
  "Remaining" sub-line adds "N awaiting validation (€x)".
- Toast after recording: "Draw-down recorded · Awaiting the director's validation".

## 5. R-072 — cost if it occurs, EMV = cost × P / 5 (Q-1)

- `risks.cost_keur` (new) is entered: "New risk" form field "Cost if it occurs (k€)" and the risk drawer (inline field).
  `parseCost`: blank → 0, point or comma decimals to 2 places, ≥ 0, ≤ 100 000; else "Enter a cost of 0 or more (k€)".
- `emvOf(cost, P)` = round2(cost × clamp(P, 1, 5) / 5): P = 1 → 20 %, P = 5 → 100 %. It feeds the register KPIs, the heat-map
  tooltips, the contingency exposure, Home, exports and meetings (risk proposals carry a cost).
- `risks.emv_keur` becomes nullable legacy: no longer written. The seed stores `cost = EMV × 5 / P` so **every seeded EMV is
  unchanged** (HLT-026 open EMV 340, NDC-031 53 / 26 / 20 / 16). An existing database is backfilled at start-up
  (`backfillCostControl`, seed's existing-DB branch): cost = round2(EMV × 5 / P) where null, else 0.
- Changing P now moves the EMV (R-03: P 4 → 5, EMV 120 → 150) — the prototype kept the EMV and moved the displayed cost.
  Audit: "P: 4 → 5 · EMV: 120 → 150 k€", "cost if it occurs: 150 → 200 k€".

## 6. Migration

`drizzle/0007_polite_proteus.sql` (generated with `npm run db:generate`):

- new table `change_request_postings` (unique `change_request_id`, FK cascade; FK amendment set null);
- `risks.cost_keur` numeric (nullable), `risks.emv_keur` DROP NOT NULL;
- `contingency_draws.status` text NOT NULL DEFAULT 'validated', `requested_by_person_id`, `requested_by_name`,
  `decided_by_person_id`, `decided_at`, `decision_comment`.

If another lot also generated a `0007_*`, regenerate at integration (never edit a generated one).

## 7. Rights summary (8 personas)

| Action | Who | Refused |
|---|---|---|
| New risk / risk drawer edits (cost) | director, quality, PM on their own project (Risk register workspace) | depthead, member, englead, procurement, client (outside workspace); PM on a project not theirs (read-only) |
| Record draw-down | director, PM on their own project (Contingency workspace) | the 6 other personas (outside workspace), PM read-only; link not of the project; balance |
| Validate / reject draw-down | director only (My approvals) | the 7 other personas (`isDrawDecider`, tested for the 8), stale, balance |
| CR posting | whoever's approval makes the CR approved (existing chain rules) | — (runs inside the approval) |

## 8. Open questions

1. **Orders placed** now come from the purchase orders: HLT-026 shows €3.95M because the seeded PO-1052 (cranes) carries list
   prices (3 700 k€) — the prototype's literal was €713k. Should the PO seed be corrected (it is prototype data), or is the
   figure right?
2. Amendment amount = the CR cost amount. Should a contractual CR carry a separate **selling price** (cost + margin)?
3. Projects **without a contract** (NDC-031…): the posting records `no_contract`; billing plans are untouched. Should an
   approved contractual CR also add a billing milestone?
4. Client portal "approved changes" now includes **internal** CRs (client step not required) — €200k on HLT-026, CR-007 is
   internal. Show only client-approved CRs to the client?
5. A draw-down **recorded by the director** still needs a validation (by a director). Auto-validate the director's own
   draw-downs, or require a second person?
6. Category actuals other than the reserve line (labour, material…) stay seeded until R-074 (Cursus hours × rate, Sage X3
   receipts and invoices, C-2a). Only work-package actual / EAC and the totals come from the activities.
7. PV / EV / AC are spread linearly over **calendar days**; should the project calendar (working days) be used?
8. A CR on the project root is spread pro rata of the original work-package budgets. Acceptable, or ask the WBS at approval?
9. The contingency **forecast consumption** is still the stored `contingency_used_keur` (seeded 208 on HLT-026); no rule
   computes it yet.
10. `risks.emv_keur` can be dropped in a later migration once every database is backfilled.
11. The weekly status snapshot (`freezeSnapshot`, 11 §3.3, no job yet) should take its SPI / CPI / EAC from `getProjectEvm`.
