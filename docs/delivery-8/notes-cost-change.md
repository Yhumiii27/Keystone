# Delivery 8 — lot "cost-change" notes

Scope: R-069, R-015 (part: change-request notices), R-081, R-077, R-080, R-054, R-140 of `docs/RESTE-A-DEVELOPPER.md`
(`docs/delivery-8/lot-briefs.md`, lot cost-change). Owner decisions applied: **P-6a** (the director records the change control
board), **P-6b** (sequential chain), **P-6c** (client step only for a contractual change, board above a threshold), **A-4** (one
register, automatic posting), **C-3a** (cost-category amounts frozen after BL1), **C-7 / C-7a** (no invoice above 100 %, the
schedule can always be retouched), **C-1** (Budget colours on the health thresholds), **L-2 "a"** (« Planning BL1 posé » follows
BL1), **X-6a** (notify the approver, not a whole role), **X-11 = shared** (the justification reaches the client). To be folded into
`DELIVERY-8.md`.

Pure rules: `src/domain/change-control.ts`, `cost-control.ts`, `baseline-policy.ts`, `contract.ts`, `evm.ts`, `health.ts`,
`settings-defaults.ts` (tests `src/domain/d8-cost-change.test.ts` and the updated module tests). DAL: `changes.ts`,
`change-posting.ts`, `change-settings.ts` (new), `change-notices.ts` (new), `settings.ts`, `budget-categories.ts`, `contract.ts`,
`cost.ts`, `lifecycle.ts`, `baselines.ts`, `projects-register.ts`, `client.ts`; imports `table-import.ts`, `schedule-import.ts`.
Integration tests: `src/server/dal/d8-cost-change.test.ts`; Server Functions `src/features/changes/d8-cost-change.test.ts`,
`src/features/contract/d8-milestones.test.ts`, `src/features/admin/d8-ccb-threshold.test.ts`; renders
`src/features/changes/d8-justification.test.ts`, `src/features/contract/d8-render.test.ts`, `src/features/budget/d8-render.test.ts`.
FR strings: `src/i18n/extra/d8-cost-change.json` only.

## 1. R-069 — sequential change-request chain, steps from the contractual impact and the board threshold

### Rules (`src/domain/change-control.ts`)

- **`requiredSteps({ contractImpact, amountKeur, ccbThresholdKeur })`** — fixed when the request is submitted: PM and director
  always `pending`; client `na` when the impact is **None (internal)**, else `pending`; board `pending` when **|amount| > threshold
  (strict)**, else `na`. An unusable threshold falls back to 50 k€. A request without an impact (older callers) keeps the client step.
- **`currentStep(chain)`** — the first `pending` step in PM → director → client → board order whose earlier steps are all `ok` or
  `na`; null after a rejection, a missing decision (CR-005) or when nothing is pending.
- **One `canDecideStep(cr, step, { role, name? })`** for Change control, My approvals and the client portal (R-171's
  "unify canDecideStep"): in review, `step` is the current one, and the decider holds it (`holdsStep`: the role; or, routed by
  person in My approvals, the named approver — the board by its recorder's role, P-6a). `approvals.ts` lost its own copy;
  `pendingStepFor` = the current step if the viewer holds it. `stepWaitsForEarlier` drives the refusal **"Not yours to decide
  yet"** (`NOT_YOURS_YET`). PM-step routing unchanged (PM of record by name in My approvals; project PMs / deputies on Change control).
- `crAwaitsClient` (portal), Home `crAwaiting`, `client.ts` decisions and `listChangeRequestsAwaiting` all read `currentStep`.
- **Contractual impact** `contract_impact` ('none' | 'price' | 'dates' | 'price_dates', codec `contractImpact` in `codes.ts`);
  required on "New change request" (select with an empty first option, "Choose the contractual impact"). Requests raised before:
  `inferredContractImpact` (client `na` → none; amount and days → price_dates; amount → price; days → dates; else null).
- **A-4 posting**: `isContractualChange` = client `ok` AND amount ≠ 0 AND impact includes the price (null impact = delivery 7's
  rule). A dates-only change prepares no money amendment (open question 3).
- Drawer hint "Waiting for <step>" for a viewer holding a later step; Pending value KPI sub-line names the current steps
  (`awaitingStepsText`, "Awaiting director · client"; "No change request in review" when none); workflow note completed with
  "Each step waits for the previous one; the client decides contractual changes, the board changes above 50 k€".

### Writers (`src/server/dal/changes.ts`)

- `createChangeRequest` writes the impact, the optional cost category (R-081) and the steps from `requiredSteps` with the threshold
  read in the same transaction; the audit line names the impact.
- `submitChangeRequest`: guarded `draft → in_review` update, then the steps are rewritten from the rule in force.
- `decideChangeStep` throws `ChangeStepError` (`not_in_review` | `not_pending` | `not_current`), refuses a non-current step and
  records the decision with a guarded update (`decision = 'pending'`, R-010). The three Server Functions map `not_current` to
  "Not yours to decide yet", the rest to their "no longer pending" message.

### Settings — "Change control board" (key `change.ccbThreshold`, `{ keur }`)

- Default **50 k€** — the prototype's `amt > 50` highlight, until management sets the real value (open question 1). Cached reader
  `src/server/dal/change-settings.ts` (`readCcbThreshold(q?)`, `ccbThreshold`), seeded by both seeds, an optional `change` field of
  the "Reset to defaults" document (a stored document without it restores 50 k€), `setCcbThreshold` (director only — A-14 —,
  0–1 000 000 k€, two decimals, audit + activity "Change control board threshold · 50 → 80 k€" only when it changes),
  `setCcbThresholdAction`, a card next to "Project health rules" ("Board above (k€)", "Applies to change requests submitted
  afterwards"), read-only for the other Settings viewers; the Settings export gets a "Change control board" sheet.

### Seed and existing databases

`seed/change.ts` stores the inferred impacts; `backfillContractImpacts` (`src/server/db/seed/cost-change.ts`, idempotent, only rows
without an impact) runs under the `Delivery 8 · demo backfills · cost-change` marker. Seeded decisions are kept.
HLT-026: CR-004 price_dates, CR-005 price, CR-006 price, CR-007 none, CR-008 price_dates, CR-009 dates.

### Displayed values, old → new (seed)

| Where | Prototype / delivery 7 | Delivery 8 |
|---|---|---|
| Change control › Pending value sub-line (HLT-026) | Awaiting director · client · CCB | Awaiting director |
| same, project with nothing in review | Awaiting director · client · CCB | No change request in review |
| CR-008 drawer, director | Approve on director **and** board | Approve on director only; board "Pending" |
| CR-008 drawer, client | Approve / Reject on the client step | no buttons; "Waiting for Portfolio director" |
| Client portal HLT-026 › Awaiting your decision | 3 (CR-008, D-014, D-016) | 2 (D-014, D-016) — CR-008 after the director approves |
| Client Home › Change requests to approve | 1 · CR-008 · €85k (accent) | 0 · None |
| Client My approvals (queue · KPIs) | CR-008, D-014, D-016 · 3 · 2 · 24 Sep | D-014, D-016 · 2 · 1 · 25 Sep; client sidebar badge 3 → 2 |
| Director My approvals after approving CR-008's director step | the board step listed at once | listed once the client approved |
| CR-009 once submitted | board step pending | board "n/a" (0 k€) — approved after the client |
| Settings | — | new "Change control board" card, 50 k€; `app_settings` 4 → 5 rows (`scripts/db-check.ts`) |

Each changed test cites P-6b / P-6c (e.g. `src/domain/approvals.test.ts`, `rexclient.test.ts`, `change-control.test.ts`,
`src/server/approvals/approvals.test.ts`, `src/server/dal/home.test.ts`, `shell.test.ts`, `delivery5*.test.ts`,
`delivery2-writes.test.ts`, `cost-control.test.ts`, the changes / myapprovals / rexclient feature tests, `scripts/db-check.ts`,
`tests/e2e/02-planning.spec.ts` — impact "Contractual dates", approved PM → director → client, no board for 0 k€; not run here).

## 2. R-015 (part) — change-request notices (X-6a)

`notifyChangeRequest(projectCode, number, actorName)` (`src/server/dal/change-notices.ts`, rule `crNoticeOf`): called by the Server
Functions **after** the write committed (create, submit, each decision — Change control, My approvals, client portal); best effort
(try/catch + `logError`, never undoes the decision). In review → the approvers of the **current** step: PM → the PM of record;
director and board → the active users with the director role (P-6a); client → the active users of the project's client
organisation. Approved / rejected → the requester (`requested_by_person_id`). The actor is never notified; duplicates removed;
nobody left → no notice. Kind `approval`, fixed EN titles "Change request awaiting your decision · CR-011" / "Change request
approved · CR-011" / "Change request rejected · CR-011" (FR in the lot file), sub-line = the typed title, target Change control
`?cr=`. Clients see it through the bell's existing read-time filter. Keystone's bell only (no mail relay). **R-015 stays
"en cours"**: other events belong to the connectors and work-planning lots; KPI alerts deferred.

## 3. R-081 — cost-category amounts frozen after BL1 (C-3a), the category posted at approval (A-4)

- Rule `categoryAmountFrozen(codes) = !canSnapshotFreely(codes)` (`baseline-policy.ts`): frozen once the project has BL1 or any
  higher BLn, in any state — the same "after BL1" test as "Set baseline". Message "After BL1 the amount changes only through an
  approved change request" (`CATEGORY_FROZEN_MESSAGE`).
- DAL (`budget-categories.ts`, re-checked inside the transaction, the director included): `updateProjectCostCategory` refuses a
  budget change; an absent budget = unchanged (name and type stay editable). `addProjectCostCategory` creates the category at
  0 k€ (forecast 0) whatever budget is given.
- Server Functions (`category-actions.ts`): frozen → "Add" without a budget creates at 0, a non-zero budget is refused; "Edit"
  without a budget keeps it. UI (`setup-tab.tsx`, `category-forms.ts`, `budget/page.tsx`): when frozen the dialogs have no budget
  field and a hint links to Change control `?new=1`.
- Excel / CSV budget lines (`table-import.ts`): after BL1 a row changing an existing category's amount is an **error** (skipped,
  same message); a row creating a category is a **warning** "After BL1 a new category starts at 0 k€ — its amount changes only
  through an approved change request" and is created at 0. Re-checked in the writing transaction (BL1 set since the preview).
- **Cost category on a change request** (`change_requests.cost_category_code`): optional select "Cost category" of the project's
  categories ("C03 · Steel works", names as typed — the form is translated in `translatedChangeRequestForm` so `t()` never touches
  them, R-148), offered to the project team only (never the client: the page does not even read the categories for a client,
  `forClient` strips the code from the portal); validated in `createChangeRequestAction` (team only, one of the project's, a
  negative change may not take the category below 0). `postApprovedChange`, inside the idempotent posting, adds the amount to
  that category's budget (its forecast too while nothing is spent or committed), clamped at 0 (`postedCategoryBudget`), audited
  ("budget: 0 → 40 k€ · from CR-011", and the posting line ends "· category C08 0 → 40 k€"). Without a category only the BAC and
  the work packages move (open question 6). The drawer shows "Cost category" to the project team.
- Seed: every project with BL1 (HLT-026, NDC-031…) has frozen amounts — the Budget › Structure & changes dialogs lose their budget
  field there. `interchange.test.ts` (HLT-026 budget lines: C01 → error, "Location grue" → created at 0 with a warning),
  `category-actions.test.ts` (chapter-4 tests run "before BL1" through a mocked rule; an R-081 block on the real rule) and
  `ch4-settings.test.ts` (NDC-031) cite C-3a.

## 4. R-077 — invoicing blocked above 100 %, planned milestones edited and removed (C-7, C-7a)

- Rule `invoiceBlocked(milestones, number)` (`contract.ts`): the milestone's schedule group — the base contract, or its amendment —
  has Σ shares > 100 % + 0.01 (`SHARE_TOLERANCE_PCT`); per group (open question 7). Under 100 % stays a hint (C-7a).
- `issueInvoice` recomputes the group inside its transaction and refuses with "Payment milestones exceed 100 % — invoicing is
  blocked until the schedule is corrected"; `issueInvoiceAction` checks it **before** parsing the form (else the reason would read
  "Choose a milestone still to invoice"). Billing: the row's and (when every planned milestone is blocked) the header's "Issue
  invoice" disabled with the reason as title, the reason under the row; `invoiceFormDef` leaves blocked milestones out.
- Contract hints: a group over 100 % reads "Shares total 105 % · invoicing blocked" (FR "Total des parts 105 % ·
  facturation bloquée"); under 100 % the prototype's "Shares must total 100 %".
- **Correcting the schedule**: `updatePaymentMilestone` (label, share 0–100, contractual date, condition of a **planned**
  milestone; the basis never changes — a forged "Applies to" is ignored) and `removePaymentMilestone` (planned only, after a
  confirmation dialog; hard delete — nothing references a planned milestone), both with a guarded write (status still planned),
  audited (area Contract, entity `payment_milestone`), the actor re-checked in the writer (`editsProjectScreen(…, 'contract')`,
  `MilestoneEditError`). A removed number is **never reused**: `addPaymentMilestone` numbers above every number on the contract and
  every number named by a "payment milestone Mn removed" audit line. Row actions "Edit" / "Remove" (`row-actions.tsx`) in an actions
  column shown to Contract editors only (colspans follow); Server Functions `updatePaymentMilestoneAction`,
  `removePaymentMilestoneAction` (`editable(code, 'contract')`: director, PM, procurement; the client is sent home).
- Seed: no group above 100 % — nothing blocked. Old → new in the prototype scenarios (`model.test.ts`, C-7 comments): "milestone"
  (105 %) and "milestone-late" (102.5 %) hints "Shares must total 100 %" → "Shares total 105 % · invoicing blocked" /
  "Shares total 102.5 % · invoicing blocked" (FR likewise). `portfolio-alerts.test.ts` now corrects the schedule (M5 25 → 24 %)
  before invoicing its extra 1 % milestone.

## 5. R-080 — Budget KPI colours on the Settings thresholds, signed variance bars (C-1)

- `budget/page.tsx` reads `healthThresholds()` and passes `th` to `PerformanceTab`. `budgetKpiAlerts(core, th)` (`evm.ts`):
  CPI when cpi < "At risk below"; EAC and VAC when VAC < 0 **and** the CPI is in alert; TCPI when tcpi > `tcpiAlertLimit(th)` =
  1 / "At risk below" (≈ 1.03 at 0.97 — a default, open question 8); the Variance card's CV like CPI, SV when spi < "At risk below".
  The "Q1" comment is gone. `indexAlert` moved to `health.ts` (re-exported by `portfolio.ts`).
- `costVarianceBars` returns `{ cv, h, dir }`: signed around a centre axis, height = % of half the plot, max 90 %, stub 4 %, cv = 0
  a neutral stub; savings in a neutral tone, overruns in the attention colour; the bars carry an `aria-label` listing the months.
- `costNote(stored, cpi, th)` uses `th.risk` instead of 0.97.
- Old → new (seed): HLT-026 (CPI 0.89, SPI 0.82, TCPI 1.25, VAC −€565k) — EAC, VAC, CPI, TCPI still in the attention colour, CV
  and SV now explicitly so; bars were 9 downward bars 3 %–80 % (prototype series) → on the computed EV / AC: Jan–May small savings
  (up, 4 % stubs), June flat, Jul–Sep down (5.3 %, 4.6 %, 90 %). NDC-031 (CPI ≈ 1.10, VAC > 0): EAC, VAC, CPI, TCPI and CV were
  always LO → neutral. `evm.test.ts` and `budget.render.test.ts` cite C-1.
- Unchanged on purpose (A-13 note, open question 9): the PM Home's literal 0.97 and the Overview's always-LO "Forecast (EAC)".

## 6. R-054 — « Planning BL1 posé » ticked by the real BL1 (L-2 "a")

- `BL1_STAGE_DELIVERABLE = { stage: 'apd', position: 1 }`, `hasBl1` (a BLn ≥ 1 current or superseded; a proposed one does not
  count), `bl1TickRefused` (`baseline-policy.ts`).
- `markBl1Deliverable(tx, projectId, actorName)` (`lifecycle.ts`): upserts the tick (`doneAt`, `doneByPersonId`) inside the
  caller's transaction, returns whether it changed (the callback's return value, R-010), audit "deliverable ticked: Planning BL1
  posé · BL1 set" and activity "<code> · “Planning BL1 posé” ticked · BL1 set" only on a change; **never moves the stage**. Called by
  `createBaselineSnapshot` and `snapshotIntoBaseline` when a BLn ≥ 1 is made current, by both change-request approval branches
  (baseline filled at approval; baseline already snapshotted), and by the NEW-mode MS Project / P6 import when BL1 is current.
- Plan "Set baseline" and Schedule "Re-baseline" toasts append "· “Planning BL1 posé” ticked" only when the tick changed.
- Manual tick without BL1 and untick with BL1 refused: `setDeliverableAction`, `setDeliverableAndAdvance` and
  `toggleStageDeliverable`, message "Set BL1 first (Plan › Set baseline, up to BL1) — or force the stage change"; a forced stage
  change is unchanged. Register: APD #1 is read-only with "Ticked when BL1 is set (Plan › Set baseline, up to BL1)" or "Ticked by
  BL1 · 12 Mar 2026" (`getRegisterData` → `bl1`); register goldens unchanged. Wizard text "BL1 frozen at the end of APD (ticks
  “Planning BL1 posé”)".
- DELIVERY-6 §8 L-2 is closed by the answer's option detail.

## 7. R-140 — the justification in the drawer and on the client portal (X-11 shared)

- Change control drawer: a "Justification" section after "Raised by" (text as typed — `dataText`, `white-space: pre-wrap` —, for
  every viewer of the drawer, the client included; omitted when blank: the seeded requests have none). The drawer also shows the
  contractual impact (everyone) and the cost category (the project team).
- Client portal › Decisions: "Why: …" under the sub-line of each request waiting for the client, as typed (never inside the
  translated sub-line), clamped to three lines with a `<details>` "Show more / Show less"; decided rows unchanged.
- "New change request": the justification's placeholder "Shown to the client with the change request".

## 8. Migration

`drizzle/0016_curvy_talos.sql` (generated): `change_requests.contract_impact text` and `change_requests.cost_category_code text`,
both nullable. No custom SQL. Data: the demo backfill above; a production database keeps null impacts (its requests behave as in
delivery 7: client step required, delivery 7's amendment rule) — no production backfill (no marker for this lot). The board
threshold row is seeded by both seeds; a database without it reads 50 k€.

## 9. Rights summary (8 personas, tests loop over them)

| Action | Allowed | Others |
|---|---|---|
| New change request (impact) | director, PM, client (Change control editors) | read-only / outside |
| Cost category on a request | director, PM (project team) | client: "Only the project team links a cost category…" |
| Decide a step | its holder, when it is the current step | "Not yours to decide yet" (later step held) / "not yours" |
| Board threshold | portfolio director | member read-only; pm, depthead, englead, quality, procurement refused; client sent home |
| Edit / remove a milestone | director, PM, procurement (Contract editors) | read-only; client sent home; writer re-checks the actor |
| Issue invoice | Billing editors, when the group ≤ 100 % | the reason |
| Category budget after BL1 | nobody (a change request) | — |

## 10. Open questions

1. **Board threshold** 50 k€ is the prototype's highlight value — management to set the real one (0 means "every request with an
   amount").
2. **"None (internal)" chosen by the requester**, the client included (P-6c option b): a client could raise an internal request
   that skips its own step. Restrict the option to the project team?
3. **Dates-only change** (impact "Contractual dates"): no money amendment is prepared — should a "dates" amendment exist?
4. **PM routing**: the PM step goes to the PM of record (notices, My approvals); co-PMs / deputies decide on Change control
   (notes-rights Q4 still open).
5. **Client step while there are no client accounts (I-2b)**: a contractual request then waits at the client step; recording the
   client's decision on its behalf was not built.
6. **No cost category on an approved request**: only the BAC and the work packages move — confirm, or make the category required
   after BL1.
7. **Block per group vs whole contract**: the base contract and each amendment are checked separately (C-7 default); a base
   schedule under 100 % is only a hint.
8. **TCPI alert at 1 / "At risk below"** and EAC / VAC coloured only with a CPI alert — defaults of the triage (C-1 names "the same
   thresholds").
9. **A-13 literals left**: the PM Home's 0.97 and the Overview's always-LO EAC are not changed by this lot.
10. **Existing databases** whose APD #1 was ticked by hand without BL1 keep the tick; it can no longer be ticked by hand.
11. **Budget-line import rows** that change a frozen amount are refused whole (actuals included); an alternative is to import the
    other columns and warn.
12. **Reset to defaults** dialog text does not mention the board threshold (restored with the rest).
13. **Portal "Approved changes"** still totals every approved request, internal ones included (not limited to contractual CRs).
14. Not built (per the triage): a board step tied to every re-baseline, the next board meeting date.

## 11. Integrator notes

- **Shared files** (merge next to the other lots' code): `src/server/db/seed/index.ts` (import line + the cost-change marker),
  Settings plumbing (`settings-view.tsx` card after the health card, `admin/actions.ts`, `admin/model.ts` `ccb`, `dal/settings.ts`
  setter next to `setHealthThresholds` and the Reset block, `domain/settings-defaults.ts` optional `change`, `seed/settings.ts`,
  `export/providers/admin.ts`) — the roles-rates-hr lot adds the hours-variance setting to the same places;
  `projects-register.ts` (import line, `getRegisterData`, `setDeliverableAndAdvance`); `client.ts` decisions block; `home.ts`
  `crAwaiting`; `approvals.ts` (`canDecideStep` removed — import it from `change-control.ts`); rexclient domain / model /
  client-view (DecisionsTab only); `portfolio.ts` (`indexAlert` moved to `health.ts`, re-exported); `register-model.ts`,
  `register-cells.tsx`, `register.module.css` (APD #1 lock); `contract-view.tsx` (actions column — the roles-rates-hr lot changes
  Contract rights: the column follows `canEdit`), `contract/actions.ts` (`editable` now returns the viewer).
- **i18n**: single-word keys `director`, `client`, `CCB` (→ "comité") and `Edit` (→ "Modifier") are in `d8-cost-change.json`; check
  for clashes with other lots' files at integration.
- `canDecideStep` signature changed to `(cr, step, { role, name? })` — any other lot calling the old `(role, cr, step)` form must
  follow.
- `createBaselineSnapshot` returns `bl1Ticked?: true`; callers typed with `Awaited<ReturnType<…>>`.
- Category DAL writers keep their `actorName`-only signature (no role re-check there, unchanged from chapter 4).
- The notice helper is lot-local (`change-notices.ts`); other lots' R-015 helpers may consolidate later.
- `tests/e2e/02-planning.spec.ts` updated (impact select, chain order, no board step) — not run in the lot.
- Suggested `docs/reste-a-developper.json` progress: R-069, R-081, R-077, R-080, R-054, R-140 → `fait` (delivery 8, after
  integration); R-015 → `en_cours` (change-request notices done).

## Integration review fixes

- R-077 / P-4: the "Edit" / "Remove" milestone DAL re-check (`requireContractEditor`) now mirrors `canEditContract` through
  `editsContract` (`team-guard.ts`: director and Finance on every project, else a lead whose workspace has Contract) instead of
  the P-2 team rule — Finance off the team is no longer refused, a 'pm'-role plain member no longer passes
  (`src/features/contract/d8-milestone-rights.test.ts`).
- R-069 / P-6c: the CR drawer's Budget row is highlighted when |amount| is over the Settings board threshold (`crImpact` `ctx.ccbThresholdKeur`, passed by `ChangesView`), the board step's own rule, instead of the prototype's fixed `amt > 50` (`d8-ccb-highlight.test.ts`; seeded values unchanged at the 50 k€ default).
- The CCB-threshold and New change request persona tests loop over `PERSONAS` (9, Finance included); a role without Settings in its workspace (member, Finance) expects "Settings are read-only for you".
