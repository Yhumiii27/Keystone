# Delivery 7 — lot "contract-portfolio" (notes)

Items: R-075 currencies, R-076 invoice due dates, R-079 amendment milestones and signature, R-132 margin at completion, R-133 cash remaining spread, R-129 overview population, R-130 portfolio alert rules, R-131 status report per audience. All eight are built.

Migrations: `drizzle/0007_fresh_young_avengers.sql` (generated: new columns and one foreign key) and `drizzle/0008_contract_payment_terms_backfill.sql` (generated with `db:generate --custom`: reads the payment rule of the contracts that existed before 0007 from their stored text; checked against `termsOfText` by `src/server/db/migration-0008.test.ts`). Both migrations only add columns. The seed changes below need a fresh database (`npm run db:reset`): an existing database keeps its milestones and invoices as they were.

## 1. Changes per item

### R-075 — currencies (C-9 b)

- **Rules** (`src/domain/currency.ts`):
  - A project has a currency (`projects.currency`, EUR when null). When it is not EUR, the project also has a **budget rate** (`projects.budget_rate`, in euros per unit). The portfolio director sets the rate; one rate per project.
  - Every document carries its own currency: contract, customer invoice, purchase order and supplier invoice. That currency is EUR or the project currency. A non-EUR document needs the rate to be set first.
  - Amounts stay in the document currency on the document's own screens (Contract, Billing, client portal, Orders, Procurement, PO PDF). Euro equivalents are shown as "≈ €…".
  - Amounts are converted to euros at the budget rate wherever the portfolio is consolidated: Budget › Cash & recovery, Cash flow & billing, Prioritisation, portfolio margin, alerts, and the Orders "Committed" and Procurement "To process" KPIs.
  - A row without a rate counts at par, `eurRate`. The write rules prevent this case.
- **Writers:**
  - `setProjectBudgetRate` (`src/server/dal/currency.ts`; `setBudgetRateAction`): director only, refused on a read-only project. EUR clears the rate. Once a contract, purchase order or invoice is in the project currency, that currency can no longer change; its rate can still be revised. The writer records an audit row and an activity event, for example "budget rate: EUR → USD · 1 USD = 0.92 €".
  - Contract sheet "Currency" (`updateContractSheet`): EUR or the project currency with a rate. It is fixed once an invoice is issued.
  - Order drawer "Currency" (`setPurchaseOrderCurrency`; `setOrderCurrencyAction`): Draft orders only. Line prices are converted at the budget rate, so the order keeps its value in euros.
  - Invoices are issued in the contract currency.
  - The contract row, and the project row on currency changes, are locked (`SELECT … FOR UPDATE`) so that a currency change cannot cross an invoice being issued.
- **UI:**
  - Contract › "Currency & budget rate" card. The director edits it there. It also appears on a project without a contract.
  - Amounts in the contract currency, with the field labels "Amount (k$)".
  - The order drawer has a currency select for Draft orders.
  - Procurement amounts are shown in the invoice currency. A supplier invoice in another currency than its PO shows a "diff" match.
- **Exports** (`currency-columns.ts`): an amount of a non-EUR document is exported as a number with the currency in the header ("Amount (k USD)"). EUR columns are unchanged.

### R-076 — invoice due dates (C-6 a)

- `src/domain/payment-terms.ts`. Each contract has one rule, in calendar days:
  - `net`: N days from the invoice date;
  - `days_eom`: invoice date + N, then the end of that month (French "45 jours fin de mois");
  - `eom_days`: end of the invoice month, then + N.
- New contract columns: `payment_rule`, `payment_days` (0–180). The text `payment_terms` is regenerated from them ("Net 45 days", "45 jours fin de mois"…).
- `paymentDueOn` drives every due date: Billing due dates and overdue flags, the client portal's "Due …", the Cash flow receipts and Budget › Cash & recovery (payment month = the real payment date).
- The sheet replaces the free "Payment terms" field with "Payment rule" (select) and "Payment days".

### R-079 — amendment milestones, signature cycle, bond release (NEW-D3-3 a)

- Milestones:
  - A payment milestone belongs to the base contract or to an amendment (`payment_milestones.amendment_id`).
  - Its amount is round(basis × share / 100). The basis is the base amount for a base milestone and the amendment's amount for an amendment milestone. **Signed amendments no longer re-price the base milestones**; the prototype priced every milestone on base + signed amendments.
  - A milestone is billable when it belongs to the base contract or to a signed amendment.
  - An invoiced milestone keeps its invoice amount.
  - The schedule is grouped by "Base contract" and each amendment, with subtotals and a share check per group. "Total billable" = contract value when every group is complete.
- Signature cycle:
  - Draft → "Send for signature" (`sent_on`) → "Mark signed" (date + signed document reference).
  - Each step is a guarded UPDATE, recorded with an audit row and an activity event.
  - A signed amendment needs its signature date.
- Guarantees: "Release" (release date) on a guarantee in force, once.
- Seed: HLT-026's Amendment 1 (€120k, CR-004, signed) gets its own milestone M6 "Anti-collision lidar commissioned", 100 %, 14 Dec 2026, planned.

### R-132 — margin at completion (C-10b a)

- `marginAtCompletion(plan, project)` (`src/server/dal/cashflow.ts`) = `projectMarginPct(contract in €, EAC)` = round(100 × (contract − EAC) / contract). It is the only margin shown:
  - Cash flow rows;
  - Prioritisation ranking;
  - portfolio finance;
  - the status report.
- The old budgeted `marginPct` is removed.

### R-133 — cash remaining spread (C-10a a)

- `remainingSpend` (`src/domain/kpis.ts`): the ETC follows each project's planned curve. Each month gets ETC × that month's planned increment ÷ the remaining planned total. The planned curve is the monthly increments of the Budget PV curve (`plannedSpendOfPv`).
- When the curve is exhausted or missing, the ETC is spread evenly to the finish, as in chapter 4.

### R-129 — overview population, fiscal year (A-3 a)

- Overview, My projects, the director's Home KPIs and the Cash flow population count the projects in the execution group (`inExecution`: Études → Mise en service & SAT).
- `fiscalYearLabel(dataDate)` = "FY" + the year of the portfolio data date. It is used in the Overview hint and the portfolio breadcrumbs.

### R-130 — portfolio alert rules (NEW-D1-1 a)

- `src/domain/portfolio-alerts.ts` (rules) and `src/server/dal/portfolio-alerts.ts` (inputs). They replace the four fixed texts in Portfolio › "Needs attention" and in the director's Home.
- One alert per rule and project, worst first:
  1. off track (A-13, Settings thresholds);
  2. critical-path slip (negative float, with the late milestones);
  3. cost overrun (clamped CPI below "At risk below");
  4. billing late (overdue invoice, else a billable milestone past its date and not invoiced);
  5. over-allocation of the pool (> 110 %, the next 8 weeks);
  6. approvals in the director's queue waiting more than N days;
  7. late milestone while float remains.
- Project alerts follow the zone filter. Each alert opens the screen that resolves it (Schedule, Budget, Billing, Resources, My approvals).
- An empty list shows "Nothing needs attention".

### R-131 — status report per audience (C-5 a)

- `src/server/export/providers/status-report.ts`:
  - **steering**: indices, float, risk exposure, **Margin at completion** (director and PM only), **Contract & billing** (in the contract currency, with the payment rule), milestones, snapshots, top risks, open changes, deliverables awaiting the client;
  - **internal**: the steering content plus **Assigned resources** (team, average and peak load);
  - **client**: progress, milestones, decisions waiting, **Changes**, **Deliverables**, **Invoices** and the contract summary, with no internal cost figure.
- A client viewer always gets the client report, without the manager note, whatever the URL or the last recorded report asks.

## 2. Defaults taken (owner to confirm)

| Point | Default |
|---|---|
| Who sets the budget rate | The portfolio director (no Finance role yet) |
| Rates | One budget rate per project, revisable; no dated rate table; document currency ∈ {EUR, project currency} |
| Currencies offered | EUR, USD, GBP, CHF, CAD, AUD, SGD, ZAR, MAD, AED |
| Draft PO currency switch | Line prices converted at the budget rate (catalogue and quotes are in euros) |
| Supplier invoice currency | Stored per invoice (EUR by default; the X3 import does not carry one yet); a currency different from the PO's = "diff" in the 3-way match |
| Payment days bounds | 0–180 calendar days; default `net` 45 |
| Alert thresholds without Settings entry | approvals > 5 days, over-allocation > 110 %, at most 8 alerts (`ALERT_RULE_DEFAULTS`) |
| Approvals alert | The portfolio director's queue (global items once, project items of the projects in execution) |
| Fiscal year | Calendar year of the portfolio data date |
| Amendment milestones | Billable only once the amendment is signed; shares per amendment are a hint (C-7 blocking not in this lot) |

## 3. Displayed values that change on the seed (tests cite the decision)

| Where | Before | After | Decision |
|---|---|---|---|
| HLT-026 milestones M1–M5 | 552 / 1 104 / 1 380 / 1 104 / 1 380 k€ | 540 / 1 080 / 1 350 / 1 080 / 1 350 k€, + M6 120 k€ | NEW-D3-3 |
| HLT-026 Billing | invoiced €3.04M (55 %), collected €1.66M, outstanding €1.38M, next M4 €1.10M | €2.97M (54 %), €1.62M, €1.35M, M4 €1.08M; retention €81k | NEW-D3-3 |
| Client portal invoices | 5 rows | 6 rows (M6 planned); summary carries the currency | NEW-D3-3, C-9 |
| Director Home / client Home invoice | INV-2026-003 €1.38M | €1.35M | NEW-D3-3 |
| Overview KPIs | €13.23M · €7.43M, 56 % · €13.50M, −€270k | €13.63M · €6.96M, 51 % · €13.97M, −€338k (PRS-038 in, WSA-044 out) | A-3 |
| Needs attention | 4 fixed texts | 8 computed alerts (RCF-019 off track, 4 critical-path slips, HLT-026 cost overrun, 3 people over 110 %, 1 approval > 5 days) | NEW-D1-1 |
| Margins (Cash flow, Prioritisation) | HLT 13 %, NDC 11 %, RCF 10 %, MSR 14 %, WSA 13 % | 5 %, 15 %, 2 %, 16 %, 16 % (portfolio 8 % unchanged) | C-10b |
| Cash flow, all zones | net +€2.84M, low −€521k | net +€2.87M, low −€1.08M (Oct) | C-10a, C-6, NEW-D3-3 |
| Cash flow EU-NA / Africa | +€2.34M, −€617k / +€498k, +€97k | +€2.38M, −€1.03M / +€496k, −€51k | same |
| Cash flow tiles | invoiced €5.26M, outstanding €1.94M | €5.19M, €1.91M | NEW-D3-3 |
| Budget › Cash & recovery (HLT-026) | received €1.66M (30 %), recovery −€2.42M, coverage 41 %, next €1.38M, low −€2.50M, M5 in Mar ’27 | €1.62M (29 %), −€2.45M, 40 %, €1.35M, −€2.54M; M4 + M6 in Jan ’27, M5 in Feb ’27 | NEW-D3-3, C-6 |
| My projects (PM) | HLT-026 | HLT-026, PRS-038 | A-3 |

## 4. Files outside the lot's obvious scope

- `src/server/db/codes.ts`: payment rule codec and the "awaiting signature" statuses.
- `src/domain/evm.ts`: the cash recovery uses each milestone's own amount and payment date.
- `src/server/dal/shell.ts`: breadcrumb fiscal year.
- `src/server/dal/home.ts` and `src/domain/home.ts`: the director's KPIs and alerts, and the client invoice currency.
- Orders and procurement:
  - `src/domain/orders.ts`, `src/domain/procurement.ts`;
  - `src/server/dal/purchasing.ts`, `src/server/approvals/invoices.ts`;
  - `src/features/orders/*`, `src/features/procurement/model.ts`.
- Export providers: contract, purchasing, status report.
- `src/server/db/seed/contract.ts`.

## 5. Open questions

1. **Alert thresholds in Settings.** NEW-D1-1 says "thresholds in Settings". Only the health thresholds have a Settings entry. The approval age (5 days), the over-allocation level (110 %) and the maximum number of alerts (8) are code defaults. Should they get Settings entries?
2. **Fiscal year.** Is EPC2i's fiscal year the calendar year?
3. **Who sets the budget rate.** The director only, or a Finance role? Should a rate revision be dated, with history?
4. **Supplier invoice currency.** Should the currency come from the Sage X3 import? Is a currency mismatch with the PO a blocking "diff", or should the invoice be converted?
5. **Amendment signature.** Should an amendment sent for signature be withdrawable or refusable? Does a refused amendment delete its milestones?
6. **R-077 / C-7.** The share check stays a hint (not blocking). The blocking rule is R-077, which is not in this lot.
7. **Cost-control lot (R-073).** Its computed PV and "committed" figures will have to use each document's euro rate (`eurRate`) when orders are not in euros.
8. **Margin at completion in the status report.** The report shows the live EAC used by the portfolio margin next to the last snapshot's EAC. They can differ by a few k€ until the next snapshot.
