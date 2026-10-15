# Delivery 8 — lot "supply-engineering": notes

Branch `worktree-wf_3e64f8c5-23c-1` (continued from `d8-supply-engineering-wip`), based on `e41c309`. Eleven items. The lot was
interrupted once by a usage limit: the first three commits were finished then; R-145 was half done in the WIP commit `e692057`
and is finished in `7512fb0` together with R-155; R-153 is `5a256a9`. The decisions applied are the owner's answers in
`docs/DECISIONS.md` and the defaults of `docs/DELIVERY-8-PLAN.md` §2; each test that changes a displayed value cites its decision id.

| Item | Decision | Status | Commit |
|---|---|---|---|
| R-095 Cancel a purchase order with a reason (before it is placed) | SC-3a = a, P-5c = a | done for orders not yet placed; placed / X3 orders not built (see below) | `101bf57` |
| R-034 Honest Sage X3 mock | A-15, R-021 as built | done for the buildable part (the real connector waits for the extracts, I-3b) | `101bf57` |
| R-102 Part validation by engineering | E-1a = a, E-1b = a | done; Vigie ECO hook not built (V-2) | `101bf57` |
| R-104 Substitution priced between revisions | E-2b = a | done (goldens regenerated with the E-2b patch) | `101bf57` |
| R-108 P&ID: search the whole catalogue for a tag's part | E-6 = a | done | `03bb657` |
| R-109 P&ID revision gap with Codex, re-import offer | A-9 = a | done | `03bb657` |
| R-110 Installed-base pins only for fitted parts | E-4 = a | done | `8be3f64` |
| R-111 Possible duplicate EQ-CRN-250T / ASM-RMG-250 | NEW-D4-5 = c | done (optional export note not built) | `8be3f64` |
| R-145 Warranty cost of the calendar year, extension in force | NEW-D5-2 = a | done | `e692057` + `7512fb0` |
| R-155 Zone notice of the machine lists | X-16 (+ 07 A.1) | done, per-view texts as a recorded deviation | `7512fb0` |
| R-153 No project sub-line on fleet-wide forms | X-10 = remove | done | `5a256a9` |

## Migration

One generated migration for the lot: **`drizzle/0016_burly_golden_guardian.sql`** (+ `drizzle/meta/0016_snapshot.json`,
`_journal.json`). No custom SQL. `npm run db:generate` reports no further change on the lot's schema.

- `purchase_orders`: `cancel_reason` (text), `cancelled_by_person_id` (FK persons), `cancelled_at` (timestamptz) — R-095.
- `parts`: `hs_not_applicable` (bool, default false), `export_reviewed` (bool, default false), `validated_at` (timestamptz),
  `validated_by_person_id` (FK persons) — R-102.

Integrator: drop this lot's 0016 files at merge and regenerate on the merged schema in merge order (plan §3). The column
additions are independent of the other lots' tables. No backfill: `export_reviewed` is false on every existing row on purpose
(see R-102), the seed's cancelled orders keep a null reason.

## Per item

### R-095 — SC-3a = a, P-5c = a: cancel a purchase order before it is placed
- Rule (`src/domain/orders.ts`, `poCancelRight` / `isCancellablePo` / `poCancelReason`): only an order drafted in Keystone and
  not in Sage X3 (`poX3State` local: BOM shortfall, RFQ award, spares list). **Draft** → its author (SC-3a) and — default beyond
  SC-3a, for the owner to confirm — the project's leads (PM of record, co-PM, deputy) and the director. **Awaiting approval** →
  withdrawn by whoever sent it for approval (P-5c); the approvers keep Reject. **Never once Ordered.** Reason required, trimmed,
  ≤ 1000 characters (`PO_CANCEL_REASON_MAX`), also for Reject.
- Writers (`src/server/dal/purchasing.ts`): `cancelPurchaseOrder` locks the row (`FOR UPDATE`), re-reads status, origin and the
  actor's right inside the transaction (a withdrawal racing an approval loses cleanly — `loadPo` is now locked too), stores
  `cancel_reason` / `cancelled_by_person_id` / `cancelled_at`, audits `status: Draft|Awaiting approval → Cancelled · <reason>`
  (the "status: A → B" shape kept), activity "Cancelled PO-x" / "Withdrew PO-x from approval". `rejectPurchaseOrder` now takes a
  required reason, stored the same way, audit `status: Awaiting approval → Cancelled · <reason>`, activity "Rejected PO-x".
  `poCancelRights` lists what the viewer may do per order (drawer). Refusals are typed (`PurchaseOrderError`: stale /
  not_allowed / not_local / reason_required / reason_too_long).
- Server Functions (`src/features/orders/actions.ts`): `cancelOrderAction` (Orders editable on the project — workspace,
  read-only project, client refused by the project context — then the role rule, then the writer); `decidePurchaseOrderAction`
  accepts and checks the reason on Reject. Best-effort notice after the commit (`notifyPurchaseOrderCancelled`,
  `src/server/dal/orders.ts`): the author and the submitter, never the actor; fixed English title translated by `t()`, the typed
  reason in the sub-line (`fieldsText`); failures logged, never undoing the write.
- UI: drawer button "Cancel order" / "Withdraw from approval" with a reason dialog (`CancelOrderButton`); a cancelled order's
  drawer shows "Cancelled · <date> · <who> · <reason>" (typed reason as typed). My approvals PO Reject goes through the
  existing reject dialog with a required reason ("Rejecting cancels the order"). **Code vs brief:** `rejectPrompt` lives in
  `src/features/myapprovals/decision-buttons.tsx`, not in `src/domain/approvals.ts` — the case was added there; approvals.ts is
  untouched. The brief's "'Cancel order' row" is read as the drawer's meta row plus the drawer action; no list-row button was
  added (no such row action exists on the Orders list).
- Internal PO summary PDF (`src/server/export/providers/purchasing.ts`): subtitle shows "Cancelled", a "Cancelled" row gives
  date · who · reason, "Approved by" is "—" on a cancelled order.
- RFQ footnote (`rfqHint`, `src/domain/procurement.ts`; FR in `src/features/procurement/i18n.ts`): "Awarded to X — purchase
  order PO-n awaiting approval / placed / cancelled before it was placed."; a Draft keeps the prototype sentence; the RFQ stays
  awarded.
- Not built (owner arbitration / other systems): cancelling Ordered or received orders, approved-not-pushed orders, "solder le
  reste à livrer", orders imported from X3 (cancelled in X3: I-3b, A-1a).
- Seed values: none move (no seeded order is cancelled by the lot; tests that cancel use orders they draft).
- Tests: `src/features/orders/cancel-actions.test.ts` (rules, every persona, a PM outside his project, malformed input, X3-origin
  and placed orders refused, approval racing a withdrawal, writer re-check, audit / activity / notice, drawer, RFQ footnote, PO
  summary); `src/features/orders/actions.test.ts` (Reject now needs a reason).

### R-034 — A-15: honest Sage X3 mock
- `src/server/integrations/x3/mock-mode.ts`: `x3Simulated()` = demo database (`databaseSeedMode`, R-011) and "Sage X3" not
  disabled by IT (`connectorEnabled`, D-7a); `requireX3Simulation()` throws "Sage X3 is not connected".
- Demo database: "Import from X3" (Stock header), "Push to X3" (stock drawer, PO drawer) keep working; toasts, audit and activity
  say "Simulated import / push (Sage X3 not connected) · …" (FR toasts built in `src/features/stock/i18n.ts`; the PO toast
  translates per segment).
- Production database (or Sage X3 disabled): the three buttons are not rendered; the Server Functions refuse them, and the
  writers (`importStockFromX3`, `pushStockToX3`, `pushPurchaseOrderToX3`) refuse again before their transaction — no snapshot
  line, `x3_sync_runs` row, `pushedToX3At` or fake `X3-` reference reaches real data. Production wording: stock KPI sub-lines
  "Sage X3 not connected", drawer note "Sage X3 not connected · movements are recorded in Keystone only", PO drawer Sage X3 line
  "Not in Sage X3 · Sage X3 not connected".
- The Sage X3 row of Activity & integrations is untouched ("Not connected", no Sync now). **No `x3-import` job** is registered.
  Where it goes later: a daily job (I-3b) under a new marker in `src/domain/jobs.ts` / `src/server/jobs/definitions.ts`, reading
  the owner's Sage X3 extracts — stock positions per location, purchase orders and receipts, supplier invoices, supplier master
  (R-093), with their formats — none received yet.
- Tests: `src/features/stock/x3-mock.test.ts` (demo toasts and audit, production refusals of all three, buttons not rendered,
  production wording); `src/features/stock/actions.test.ts` (toast text).

### R-102 — E-1a = a, E-1b = a: part validation by engineering
- Rules (`src/domain/parts.ts`): `partValidationErrors` (presence, not truth: lead time 0 accepted; HS code or explicit "Not
  applicable"; export restriction text, or an explicit "None"; manufacturer reference); `canValidatePart` (engineering lead and
  — default — director, active role, part Not validated); `canCompletePartRecord` (the catalogue's editors while Not validated;
  validators only once Validated); `parsePartQualification` (form parsing, EN errors).
- Writers (`src/server/dal/parts.ts`): `updatePartQualification` (locked row, rule re-checked with the actor's role, audit
  "record completed · HS code … · export … · lead time … · manufacturer ref. …", nothing written when nothing changed);
  `validatePart` (locked row, status and record re-checked, `validated_at` / `validated_by_person_id`, audit
  `status: Not validated → Validated`). No manual path to Outdated / Obsolete nor back to Not validated.
- Server Functions (`src/features/plm/actions.ts`): `completePartRecordAction`, `validatePartAction` (screen access `plm`,
  reference format, stale status, translated refusals).
- UI: part drawer "Qualification" section (who validated and when, what is missing), "Complete the record" (prefilled form) and
  "Validate part" (disabled with the missing items as tooltip). New part form unchanged (minimal).
- Seed: the 47 Validated parts are untouched. Of the 4 Not validated parts, EL-BAT-LI-200 (restriction text) is complete;
  FD-DET-OPT2, HST-BRK-DSC and CTL-WIND-SN need their export "None" confirmed — `export_reviewed` is false on existing rows
  because a null restriction had two meanings (None / not checked). Owner to confirm.
- Not built: the Vigie `partStatusChanges` ECO hook (V-2 contract not agreed; the connectors lot proposes the field). Flag for
  reopening: the interchange parts import can still write `status` (imports are off, D-7b).
- Tests: `src/features/plm/validation-actions.test.ts` (rules, every persona, malformed input, stale status, the writers'
  re-check, audit, drawer section and form); `src/features/plm/page.test.ts`.

### R-104 — E-2b = a: substitution priced between revisions
- `src/domain/bom.ts`: `diffOldRef` and `diffCostDelta(from, to, newUnit, oldUnit)` = to × new − from × old; unknown price on
  either side keeps the quantity-only rule (never the whole new price). `getRevisionComparison` (`src/server/dal/bom.ts`) values
  old and new refs once with the E-2a rule and exposes `oldRef`, `oldUnitPriceEur`, `oldPriceSource`; the compare tooltip shows
  both prices and sources inside the price mask (R-046).
- **Golden exception (plan §2):** `scripts/proto-e2b.ts` patches design line 4266 (fails loudly if the line moved);
  `src/features/bom/bom.golden.json` and `src/server/dal/delivery4.golden.json` regenerated; the hand-checked JSON diff moves only
  the two substitution rows and the total.
- Seed values: EL-HMI-10 → EL-HMI-15 "—" → "+€750" (FR "+750 €"); FD-DET-OPT → FD-DET-OPT2 "—" → "+€12"; total
  "+€19,180 per crane" → "+€19,942 per crane" (FR "+19 942 € par grue").
- Updated with E-2b comments: `src/domain/bom.test.ts`, `src/server/dal/delivery4.test.ts`, `src/server/dal/bom-valuation.test.ts`,
  `src/features/bom/page.test.ts`, `src/features/bom/model.test.ts`, `scripts/db-check.ts`, `src/features/bom/i18n.ts`,
  `docs/spec/09-engineering-plm.md` §1.8 / §13 OQ8.

### R-108 — E-6 = a: P&ID catalogue search for a tag's part
- `searchPidCandidates` (`src/domain/pid.ts`): text on reference or name (FR name too in French), type filter defaulting to the
  tag kind's compatible types or "All types", project BOM articles first and marked, ≤ 20 results + a refine flag. URL state
  `?cq=` / `?ctype=` (`src/features/pid/links.ts`), debounced input.
- `mapPidTag` (`src/server/dal/pid.ts`) accepts any catalogue reference (still refuses an unknown reference, a client tag and the
  reference already mapped) and, on "Link and add to the BOM", adds the BOM line in the same transaction through `addBomLine`
  (now taking an optional `tx`): quantity (default 1), the tag's scope, the tag's activity only when it is in the plan; the
  writer re-checks the BOM right (`editsProjectScreen`); a quantity-0 BOM line gets a clear message. `mapPidTagAction` checks
  `ctx.canEdit('bom')` when adding, audits on the tag and the BOM, records activity, revalidates the project layout and the PLM
  screen. "Link only" leaves the tag Not in BOM. Never creates a part (A-1b).
- Tests: `src/domain/pid-search.test.ts`, `src/features/pid/catalogue-link.test.ts`; E-6 comments in `pid.test.ts`,
  `page.test.ts`, `render.test.ts`, `delivery5.test.ts`, `delivery5-writes.test.ts`. `pid.golden.json` untouched.

### R-109 — A-9 = a: P&ID revision gap with Codex
- `pidRevisionGap` (`src/domain/pid.ts`) reuses E-5 (a Codex Draft makes the previous revision the reference; Obsolete excluded
  explicitly); order consistent with `nextRevision`; a non-comparable pair only reads "different". Exposed by
  `getPidValidation` and the view model; a callout at the top of the P&ID body; "Import P&ID tags" suggesting the Codex revision
  for P&ID editors only (one dialog shared with the header button). Nothing blocked.
- Seed: HLT-026 shows "Codex has rev D of this P&ID (Released) — the tags come from rev C. Re-import the tags of rev D." (default:
  shown whenever Codex is ahead, also right after a release step — owner to confirm).
- Tests: `src/features/pid/pid-gap-page.test.ts`, domain cases in `src/domain/pid-search.test.ts` / `pid.test.ts`.

### R-110 — E-4 = a: installed-base pins only for fitted parts
- `installedBasePinsOf` (`src/domain/eco.ts`) + `installedBasePins` (`src/server/dal/eco.ts`, one batched read of the machines'
  configurations): a machine with a recorded configuration pins only the ECO parts it carries, at its fitted revision; a machine
  without configuration (added by hand, unknown to Keystone) keeps every ECO part (cautious default).
- Seed: EL-HMI-15 and FD-DET-OPT2 are no longer pinned (expectations overridden with E-4 comments in `delivery4.test.ts`,
  `bom/model.test.ts`, `stock/model.test.ts`).
- Tests: `src/server/dal/eco-pins.test.ts` (rule; seed; "Mark done" fitting EL-HMI-15 on a targeted machine makes the pin appear).

### R-111 — NEW-D4-5 = c: possible duplicate
- `possibleDuplicates` (`src/domain/bom.ts`): a purchased line and an assembly line with the same HS code and catalogue price,
  neither in the other's structure. Flat-list note on both lines, a qualitative KPI note (never an amount), part drawer note only on
  a project screen (`bomDuplicatePartners`). No value moves, no dismiss.
- Seed: EQ-CRN-250T and ASM-RMG-250 on HLT-026 are flagged. Not built: the optional note in the BOM export's KPI sheet.
- Tests: `src/features/bom/duplicates.test.ts` (rule, delivery-4 data layer, flat list, KPI note, part drawer, render); no
  golden or existing expectation moves (the new fields are additions).

### R-145 — NEW-D5-2 = a: warranty cost of the year, warranty in force
- `src/domain/aftersales.ts`: `warrantyInForce({ warrantyEndOn, extendedUntil, warrantyStatus }, today = NOW_ISO)` →
  `{ status, endOn }`: Extended while a recorded extension runs (later than the contractual end, or no contractual end, and not
  past); In warranty while the end in force is not past; Out of warranty once it has passed; no date → the stored status.
  `addedWarrantyStatus` wraps it. `fleetKpis(machines, today)` reads the status in force and counts "Warranty ending < 90 days"
  from the end in force. `savKpis(claims, ivs, lang, today)`: "Warranty cost YTD" and its "n chargeable" sub-line count the
  claims whose `reportedOn` year is today's (no upper bound); `ClaimFacts` gained `reportedOn`.
- `listMachines` (`src/server/dal/fleet.ts`, only that function): status, status text, ending alert and days from the warranty in
  force; computed on read (no job, no migration); the "Warranty end" column keeps the contractual date.
- Defaults (owner to confirm): "Extended" also before the contractual end has passed (no prototype precedent: the only seeded
  extension is past its contractual end); an extension not later than the contractual end is ignored; a stored "Out of warranty"
  with a future end now reads In warranty (no such row: the only writers are the seed and "Add machine").
- FR label « Coût garantie de l’année » — a deliberate override of the prototype key "Warranty cost YTD" (fr-dict « Coût garantie
  cumulé ») in `src/i18n/extra/d8-supply-engineering.json` (NEW-D5-2). **Integrator: add it to the dictionaries-test allowlist.**
- Two clocks until R-013: `warrantyEnding` compares month indexes with PG_NOW, the status and the year filter use NOW_ISO; they
  agree on 30 Sep 2026 and must move together. Until then the tile never resets on 1 January.
- Seed values: no figure moves (every seeded claim is of 2026; MCH-022's extension runs until 4 Jun 2027); only the FR label.
- Out of scope: any form to record a warranty extension (extensions come from the seed / data until the owner validates one).
- Tests: `src/domain/aftersales.test.ts` (fixture `reportedOn` from P.CLAIMS column 4, WC-020 literal; a 2025 claim excluded,
  2027-01-05 → 0, an extension ending within 3 months is ending soon, an expired one is Out, a contractual end just passed is
  Out); `src/server/dal/warranty-in-force.test.ts` (own database: inserted machines with expired / running extensions and a
  lapsed end, 2025 claims); FR label in `src/features/aftersales/model.test.ts` and `actions.test.ts`.

### R-155 — X-16: zone notice of the machine lists
- `src/features/aftersales/model.ts` only (the shared project notice key is untouched): Installed base shows "No machine in this
  zone" when the zone has no machine; Warranty & claims keeps the `savZoneEmpty` rule (07 A.1) and picks the text from the
  zone's machines: no machine → "No machine in this zone"; machines but the view's list empty → "No claim / No intervention /
  No warranty cost in this zone" (FR « Aucune machine / Aucune réclamation / Aucune intervention / Aucun coût de garantie dans
  cette zone », in the d8 file — not in `extra/aftersales.json` as the triage suggested, per the plan's i18n rule).
- **Deviation (X-16 + 07 A.1):** the per-view texts go beyond X-16's literal wording, which would be false for Asia Pacific ›
  Interventions on the seed (one machine, one claim, no intervention). Owner to confirm.
- Seed values: Asia Pacific › Interventions "No project in this zone for this view" → "No intervention in this zone" (FR
  « Aucun projet dans cette zone pour cette vue » → « Aucune intervention dans cette zone »). Nothing else shows a notice on the
  seed. `src/domain/aftersales.golden.json` and the proto-golden script are untouched.
- Tests with X-16 comments: `page.test.ts`, `render.test.ts` (the old FR text absent and the new one checked), `model.test.ts`
  (every zone and view, plus a zone without machines on both screens).

### R-153 — X-10 = remove: no project sub-line on fleet-wide forms
- Removed the `context` prop and the `getLastProject` / `getProject` / `projectLabelText` loads that fed it from
  `admin/machine-types/page.tsx` (New machine type; `listProjects` stays), `reference/parts/page.tsx` (New part),
  `after-sales/fleet/page.tsx` (Add machine; `listProjects` and `projectAccessResolver` stay) and `after-sales/claims/page.tsx`
  (New claim and Plan intervention — `planInterventionAction(null, …)` records nothing on a project).
- Sync vault (`reference/drawings/page.tsx`): the run of scope "Current project" is still attached to the last project visited, so
  the project moves into that option's label — "Current project · #026 · Harbor Line Terminal Expansion" (`projectLabelText`,
  R-148) — and the sub-line is dropped.
- Kept: New RFQ, What-if and every `/projects/[code]/*` page. The components keep their optional `context` prop.
- Comments updated (`primary-buttons.tsx`, `add-buttons.tsx`, `plm-buttons.tsx`, the page headers) and spec 09 §0.3 annotated.
  Spec 01 §5.9 / 02 / 06 still describe the prototype's sub-line on every add-form (other owners' spec files, left as is).
- Tests with X-10 comments: `aftersales/page.test.ts` (EN/FR Add machine, New claim, Plan intervention), `plm/page.test.ts`,
  `admin/page.test.ts`, `eco/page.test.ts` (the Sync vault option label).

## Checks

- `npm run typecheck`: clean. ESLint on every file of the lot: clean.
- `npx vitest run` (whole suite): see the integrator notes below for the result of the final run.
- `scripts/db-check.ts`: all checks passed (run under vitest's resolver; `npx tsx --conditions=react-server scripts/db-check.ts`
  fails in this sandbox before any check — `@phosphor-icons/react/dist/ssr` resolves to its CommonJS build under tsx's CJS loader,
  unrelated to the lot).
- `npm run db:generate`: "No schema changes" after `0016`.

## For the integrator

- Shared files touched: `src/server/dal/fleet.ts` (`listMachines` and the header comment only), `src/server/dal/bom.ts`
  (`addBomLine` refactor with optional `tx`), `src/server/dal/purchasing.ts` (`loadPo` locked, `decidePurchaseOrder` returns),
  `src/features/myapprovals/decision-buttons.tsx` (`rejectPrompt` and the PO recorder), `src/server/dal/delivery4.test.ts`,
  `delivery4-writes.test.ts`, `delivery5.test.ts`, `delivery5-writes.test.ts` (expectations of this lot's items only),
  `scripts/db-check.ts` (E-2b expectation), `docs/spec/09-engineering-plm.md`.
- Dictionary: one deliberate override of a prototype key, "Warranty cost YTD" → « Coût garantie de l’année » (NEW-D5-2): add it
  to the dictionaries-test allowlist when audit-i18n-shell's d8 guard is merged. No other d8 key differs from another dictionary.
- No job, no seed backfill, no marker used (the lot has none).
- R-015 interplay: the R-095 notice uses `createNotification({ toPersonIds })` after commit as the plan's default; if
  connectors' R-096 / cost-change notify the same buyer chain, they are independent calls.
- Tests that cancel or reject orders, validate parts or insert machines use orders / rows they create or their own database;
  golden baselines do not move except R-104's regenerated BOM goldens.

## Open questions for the owner

1. R-095: may the project's leads and the director cancel someone else's Draft (built), or only its author (SC-3a literal)?
   Cancelling a placed order (SC-3a vs P-5c) is not built.
2. R-102: confirm the director as a validator next to the engineering lead, and that existing parts must have their export "None"
   confirmed explicitly (3 seeded parts).
3. R-109: should the banner stay right after a release step when Codex already holds the next revision (built: yes)?
4. R-145: "Extended" before the contractual end has passed (built: yes); the FR label « Coût garantie de l’année ».
5. R-155: per-view texts "No claim / intervention / warranty cost in this zone" beyond X-16's literal text.
6. R-034: the Sage X3 extracts (format, frequency, scope) to build the real connector and its daily job (I-3b).
