# Delivery 7 — lot "operations": notes

Branch `worktree-wf_1417a6af-536-6`, based on `f01c836`. Nine items, one commit each (R-098 and R-099 share one, R-124 and R-106 share one). The decisions applied are the owner's answers in `docs/DECISIONS.md`; each test that changes a displayed value cites its decision id.

| Item | Decision | Status | Commit |
|---|---|---|---|
| R-105 Latest frozen or released revision is the reference for engineering inputs | E-5 = a | done | `049806d` |
| R-097 PO PDF becomes an internal summary; the legal PO is issued by Sage X3 | SC-4b | done | `617bf19` |
| R-055 Effective date of a stage change | L-4c | done | `6c6c7f0` |
| R-098 Stock issue requires an activity and charges its work package | SC-5a | done | `5b01d48` |
| R-099 Stock reserved for another project cannot be issued | NEW-D4-2 (+ director override from the lot brief) | done, see open question 1 | `5b01d48` |
| R-103 BOM valuation: ordered price, else last purchase, else catalogue, source shown | E-2a, A-11 | done | `10bd8cb` |
| R-062 Change request ↔ plan activities | NEW-D2-2 = a | done | `6ef4640` |
| R-124 Codex document approvals made in Keystone go to Codex through an outbox | P-7b = a, D-1b = a, I-3a | done (mock connector; HTTP connector ready for Codex's API) | last commit |
| R-106 "Validate release (PM)" starts the Codex approval circuit | P-7c = a | done | last commit |

## Migration

One migration for the whole lot: **`drizzle/0007_flawless_living_mummy.sql`** (+ `drizzle/meta/0007_snapshot.json`, `_journal.json`).

- `stock_movements`: `unit_cost_eur`, `value_eur`, `wbs_code`, `override_qty`, `override_from_project_id` (FK projects, set null) — R-098 / R-099.
- `change_request_activities` (new): request ↔ activity code, requested duration, applied-at / applied-from, unique (request, code) — R-062.
- `codex_document_outbox` (new): Codex decisions and circuit starts with their delivery state — R-124 / R-106.

Integrator: if another lot also generated a `0007_*`, drop this lot's 0007 files and regenerate once on the merged schema (`npm run db:generate`). No existing migration was edited.

## Per item

### R-105 — E-5: the latest frozen or released revision is the reference
- `src/domain/engineering.ts`: `REFERENCE_STATUSES` (Frozen, Release proposed, Released, Obsolete) and `inputLatest`; the data layer (`src/server/dal/engineering.ts`) uses the domain rule. Only a Draft points to the previous letter; external documents are always up to date.
- Goldens: `scripts/proto-golden-eng.ts` and `scripts/proto-golden-d5.ts` patch the prototype logic (`applyE5`) before running it; `eng.golden.json` and `delivery5.golden.json` regenerated.
- Displayed: LST-IO-026 rev B (Frozen) is no longer "Outdated" against rev A for Automation; Synthesis KPI "Outdated inputs" **4 → 3**.

### R-097 — SC-4b: the PO PDF is an internal summary
- `src/server/export/providers/purchasing.ts` (`poDocument`): title "Purchase order {n}" → **"Purchase order summary {n}"**; subtitle "Internal document — not sent to the supplier · {supplier}"; new field "Sage X3 reference" ("Sage X3 order {x3Ref}" / "Imported from Sage X3" / "Not yet in Sage X3"); the supplier acknowledgement signature block and the instructions to the supplier are removed; new footnote: the legal order (mentions, terms) is issued by Sage X3.

### R-055 — L-4c: effective date of a stage change
- Rule (`src/domain/lifecycle.ts`): default = today, i.e. the project's data date; refused when invalid, after today, or before the previous stage change (`effectiveDateError`).
- Writer (`src/server/dal/lifecycle.ts` `recordStageChange`): validates again inside the transaction and refuses a move when the project moved since (`StageChangeError` `stale`); audit "stage: X → Y · mode · effective D" (time of entry = audit time) and activity "Stage changed · CODE → Stage · D".
- UI: the register's Force dialog gets a date field; moving a complete stage opens a new "Change stage" dialog with the date (it was a one-click move). The director's revert and the automatic advance are dated today, never before the previous change.

### R-098 / R-099 — SC-5a, NEW-D4-2: stock issues
- Issue requires an activity of the current project's plan ("Choose the activity the parts are issued to"); the movement is valued at the stock unit cost (last purchase price, else list price) and stored with the activity's work package (`wbs_code`, `value_eur`). Budget work packages add issues − returns to their actual cost (`stockCostByWorkPackage`, read-time overlay in `src/server/dal/cost.ts`). A return naming an activity credits it back.
- An issue or a scrap never takes units reserved for another project ("Reserved for {project}" note on the line). New operation **"Release reservation"**: the reserving project's PM or the director. The director alone may take reserved units anyway (checkbox "Take them anyway (director override, recorded in the audit trail)"): audited on both projects and written to the reserving project's feed ("Reservation reduced · ref × n · location · director override").
- The stock line is locked (`FOR UPDATE`) for the movement's transaction.

### R-103 — E-2a, A-11: BOM valuation
- One rule (`src/domain/bom.ts` `bomUnitPrice`): the project's ordered price (quantity-weighted lines of its Ordered / Partially received / Received orders), else the part's last purchase price, else the catalogue price. Used by the flat list, totals, BOM value, assembly roll-up, node roll-up, revision comparison and the BOM export ("Price basis" column).
- Accepted goods update the part's last purchase price (order line price, receipt date, supplier) unless a later purchase is recorded.
- Displayed: price source under each price ("Ordered price", "Last purchase", "Catalogue price", "Roll-up of components"); KPI sub "Ordered, else last purchase, else catalogue price". HLT-026 BOM value **€7.05M → €7.02M**; crane roll-up **€713,996 → €720,396**. Goldens regenerated through `scripts/proto-e2a.ts`.

### R-062 — NEW-D2-2 = a: change request ↔ plan activities
- New change request form field "Plan activities touched (optional)" (`A1250=28, A1320`): codes checked against the plan, at most 50, durations 0–3650 working days.
- Request drawer "Plan activities": the project team (not the client, who does not see the section) adds / removes links while the request is draft or in review.
- Plan activity drawer: "Change requests" section; the cost note names the requests in review (the prototype's hard-coded "second crew (CR-008)" on A1250 is now the seeded link CR-008 → A1250).
- Once the request is approved, the next **Reschedule** applies the new durations, once, audited ("duration X d → Y d · CR-0nn approved"), and its toast says so.

### R-124 / R-106 — P-7b = a, D-1b = a, P-7c = a: approvals go to Codex
Rules (`src/domain/codex-approvals.ts`, pure, unit-tested):
- A decision on a circuit step (drawer "Approve in Codex", or Approve / Reject in My approvals) is recorded in `codex_document_outbox`, **pending sync with Codex**. The index record — status, approval proof, withdrawal, acknowledgement — is never changed by Keystone; only Codex's answer (the HTTP connector's refresh, `src/server/integrations/codex/mirror.ts`) changes it and closes the entries it reflects.
- The next step opens in Keystone at once (the next approver sees it in My approvals); a rejection (reason required, ≤ 1000 characters) stops the circuit until Codex answers; when every step is signed or approved the record shows "Release approved · Pending sync with Codex" and nothing is open.
- Who decides is unchanged: the named approver of the open step, or the director on their behalf. A decision on a step that moved on is refused ("This decision is not waiting for you any more"); the writer locks the record and re-checks the step.
- Engineering deliverables (a discipline's project record with recipients): no step is open until the project's PM or the director clicks **"Validate release (PM)"**, which now records a circuit start in the outbox instead of releasing. The deliverable stays Release proposed until Codex releases it.
- A new revision handed to Codex closes the open entries of the record.

Connector (`src/server/integrations/codex/`, Vigie ECO pattern): `mock` by default (entries stay pending); `http` when `CODEX_API_URL` is set — delivers the outbox (`POST /api/documents/:number/approvals`, `POST /api/documents/:number/circuit`) then refreshes the records concerned (`GET /api/documents/state?numbers=…`). Endpoints are a proposal, marked `TODO(codex)`. "Sync now" on the Documents screen delivers the outbox first.

Displayed values (old → new):
- Drawer "Approve in Codex": no toast → "RPT-HLT-014 · Approved · Pending sync with Codex"; the record stays "Release proposed" (was Released after the last step); new callout with the circuit note; approval-proof rows of decided steps read "Approved · 11 Oct · Pending sync with Codex" (hollow dot) with the decider.
- Documents sidebar badge: records with a step open in Keystone (was: every record in Release proposed). Seed value unchanged ("1").
- My approvals, "Codex document" rows: inline Approve / Reject (reason dialog) + "Open in Codex" (were "no inline decision"); the decided count includes the viewer's Codex decisions.
- Engineering discipline screens: "Validate release (PM)" → toast "SCH-ELE-026 · Approval circuit started · Pending sync with Codex", status stays "Release proposed" with a line under it ("Awaiting PM validation", "Approval circuit started · Pending sync with Codex", "Release approved · …", "Approval circuit in progress in Codex"); the button disappears once the circuit started. Synthesis KPI "N awaiting PM validation" counts only deliverables whose circuit has not started (seed value unchanged: 0).
- "Sync now" toast: "Codex sync · index up to date · 412 records" + " · N decisions pending sync with Codex" when some wait.
- Engineering golden replay (`src/features/eng/render.test.ts`): the prototype's immediate release is replayed as PM validation + approvals + Codex's answer, so every screen value still matches the prototype.

## Files outside the lot's obvious scope (for the integrator)
- `src/server/db/codes.ts` (stock operation `release`, Codex outbox codes), `src/server/dal/cost.ts` (stock issues in WP actuals), `src/server/dal/schedule.ts` (Reschedule applies approved CR durations), `src/server/dal/deliveries.ts` (last purchase price on acceptance), `src/server/db/seed/change.ts` (CR-008 → A1250 link), `scripts/proto-golden-*.ts`, `scripts/proto-e2a.ts`, `scripts/db-check.ts`.
- `src/domain/approvals.ts` (new `codex-document` decision mode) and `src/features/myapprovals/decision-buttons.tsx` (its recorder and reject prompt): the cost-control lot also adds modes to the same union / switch — merge both.
- `CODEX_API_URL` should be added to the central configuration module and `.env.example` (lot "platform", R-007) — read directly from `process.env` here, like `VIGIE_API_URL`.

## Open questions
1. **R-099 / NEW-D4-2.** The owner answered "refuse, unless the other project's PM agrees"; the lot brief added "unless the director overrides". Both exist: the reserving PM (or the director) releases the reservation, and the director alone can override at issue time (audited). Keep the director override?
2. **R-098.** A return without an activity credits no work package (the unit goes back to stock, the cost stays charged). Should a return always name an activity?
3. **R-098 / R-073.** Stock issues reach the work packages' actual cost through a read-time overlay. If the cost-control lot recomputes WP actuals, it should take issues from `stock_movements.value_eur` / `wbs_code` instead.
4. **R-124.** Until Codex has an API, the mock connector never releases anything: approved documents stay "Release approved · Pending sync with Codex". Acceptable for the demo, or should the mock simulate Codex's acceptance?
5. **R-124 / P-7b.** The answer says "named approver"; the director can still decide on the approver's behalf (needed for steps whose approver has no Keystone account, e.g. L. Fabre). Keep?
6. **R-124.** Freeze and Propose release still change the Codex status locally (out of this lot's items). Should they also go through the outbox?
7. **R-124.** The Codex endpoints and payloads are a proposal (`TODO(codex)`); to agree with Codex (D-1). The integrations screen's Codex row is a static connector: it does not show the outbox counts yet.
8. **R-062.** The CR-008 → A1250 link is seeded; existing databases (already seeded) do not get it.
9. **R-055.** The automatic advance (all deliverables ticked) is dated today with no dialog when it is triggered by ticking the last deliverable; only the explicit "Change stage" asks for a date.
