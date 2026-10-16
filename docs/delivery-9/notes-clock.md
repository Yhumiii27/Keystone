# Delivery 9 — lot "clock" (R-013): one business clock

Status: built on `main-2a2fep` after delivery 8 was merged into `main` (PR #2), as planned in `DELIVERY-8-PLAN.md` §4
("its own lot right after delivery 8"). The data-date half (R-060, S-4) still waits for the owner.

## 1. What changed

The prototype worked at frozen dates: `STATUS_ISO` (25 Sep 2026, stamped on writes), `TODAY` (working-day 4 = Fri 25 Sep),
`STATUS_DATE` ("25 Sep 2026" in the header), `NOW_ISO` (30 Sep: invoices, minutes, claims, stakeholders, interfaces),
`PG_NOW` (month index 8.97 ≈ 30 Sep: portfolio Gantt, meetings, interfaces, stakeholders, contract), `CODEX_TODAY_ISO`
(29 Sep: Codex deposits) and `DEFAULT_DATA_DATE`, plus hidden ones (`NCR_OVERDUE_AS_OF`, the new-project template dates,
the Lucca import default '2026-09-30', `BL-2026-` receipt numbers, the My work calendar starting at offset 0, the request
default start offset 5). All are gone.

| Piece | Where | Role |
|---|---|---|
| Pure clock | `src/domain/clock.ts` | `ClockSetting` (real / fixed), `todayOf`, `businessNowOf`, `workdayOffsetOf` (former TODAY; a weekend counts as its Friday), `monthNowOf` (former PG_NOW), `DEMO_TODAY_ISO` (seeds and tests only) |
| Server clock | `src/server/clock.ts` | `businessToday(q?)`, `businessNow(q?)`, `setClockForTests`; pass the transaction inside a transaction (PGlite) |
| Setting | `KEYSTONE_CLOCK` (`src/server/config/parse.ts`, `.env.example`, `docs/EXPLOITATION.md` §3) | unset = automatic; `real`; or a pinned `YYYY-MM-DD` (warning in production); logged at start-up |
| Client | `src/components/app/clock.tsx` | `ClockProvider` in the app layout, `useToday()`, `useTodayOffset()` |

**Automatic clock.** It follows the data, like the seed (R-011): the real date (Europe/Paris) on a production database;
the demo data set's date, Fri 25 Sep 2026, on a demo database — its overdue items, weeks and periods were written for that
date and would drift a little more every week under the real clock. `KEYSTONE_CLOCK=real` gives the real date on the demo
database too. A pinned date keeps the real time of day.

**Rules.** Pure functions take the date as a required parameter (no default anywhere); DAL readers, writers and Server
Functions resolve it once; Client Components read the layout's date (the browser's own clock is never used for business
rules). Writers that stamped 25, 29 or 30 Sep stamp the business date; number prefixes (INV-, RFQ-, BL-) follow its year.
Technical timestamps (comments, audit rows, jobs, sync times, uploads) stay real instants. Seeds keep their fixed dates.

**Derived defaults** (same value as before on 25 Sep 2026): NCR overdue as-of = today + 7 days; new-project planned start =
the Monday on or after today + 105 days, finish = end of today's month one year later (2027-01-11 / 2027-09-30); My work
calendar starts on the Monday of today's week; a request's default start is next Monday; ITP year-less dates read within
today ± 183 days; the project data date falls back to today (S-4 open).

## 2. Values that change on the demo data set

One date instead of three: what the prototype computed at 29 or 30 Sep is now computed at 25 Sep. Golden tests of the pure
rules pass the prototype's anchors explicitly, so they still compare with the prototype; demo-database tests whose value
changed carry an "R-013" comment.

| Area | Before (prototype) | Now |
|---|---|---|
| Fleet warranty "ends in n d" | MCH-035 31 d | 36 d |
| Interfaces, days to need | IF-02 in 15 d, IF-05 in 45 d, IF-07 10 d late, new IF-10 32 d | 20 d, 50 d, 5 d late, 37 d (no status changes) |
| Meetings | MTG-116's reopened action (due 29 Sep) Overdue, overdue KPI 1 | Open, KPI 0 (neutral tile); a meeting on 6 Oct is no longer "this week" |
| Portfolio schedule | today line at 8.97; EWA-051 "Decision pending · 8 d" | 8.8; 3 d (default window unchanged, Oct 2025 – Sep 2027) |
| Dates proposed by forms | 30 Sep (contract sign / release / invoice, ITP result, intervention done, register machines, interface received) | 25 Sep |
| Dates stamped on writes | 30 Sep (invoices issued / paid, amendments, minutes sent / read, client issues handled, claims, stakeholders), 29 Sep (Codex deposit, acknowledgement), Lucca import 30 Sep | 25 Sep; an invoice issued without a date is due 9 Nov (was 14 Nov) |
| Register machines | delivered 30 Sep 2026, warranty to 29 Sep 2028 | 25 Sep 2026, 24 Sep 2028 |
| Typed dates after 25 Sep | accepted up to 30 Sep | refused as "in the future" where the rule forbids future dates; a year-less "29 Sep" reads as the past year where only past dates make sense |
| Contract late milestone | due on 30 Sep = late at 30 Sep | a milestone due on the business date itself is not late (no seeded value changes) |

Unchanged on the demo date: greeting, status date in the header, My work KPIs and calendar, wizard dates, rate card date,
purchasing, ECO, drawings, Cursus, the INV/RFQ year (2026).

## 3. Verification

`npm run typecheck`, `npm run lint`, `npm test` (365 files, 4 014 tests) green after the conversion; tests of the clock:
`src/domain/clock.test.ts`, `src/server/clock.test.ts` (automatic by data set, KEYSTONE_CLOCK, override, inside a
transaction), `src/server/config/parse.test.ts` (KEYSTONE_CLOCK).

## 4. Open points

1. **Demo clock default.** The demo database stays at 25 Sep 2026 unless `KEYSTONE_CLOCK=real`. Should the beta (a demo
   database, `EXPLOITATION.md` §7) run at the real date instead? Its prototype data would then look more and more late.
2. **S-4 / R-060** — what advances a project's data date and what the Friday freeze records. Until then the data date is
   `projects.data_date` (never written) else today.
3. Two messages still say "status date" ("The SAT date cannot be before the status date", "The reply date is before the
   status date") — kept to avoid new translations; they now mean the business date.
4. `advancePunchItem(…, on = null)` called directly without a date closes an item undated (the Server Function passes the
   business date) — unchanged behaviour.
5. Unblocked by this lot, not built: R-121 (J-15 alert on an unconfirmed client prerequisite), R-085 (8-week load plans),
   R-015 KPI alerts.
