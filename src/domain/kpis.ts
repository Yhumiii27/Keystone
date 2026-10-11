// Chapter 4 — A-12: the KPIs the prototype hard-coded, as formulas over the data (docs/spec/00 §10 A-12; 03 OQ7–9,
// 08 OQ22–23, 09 OQ17–18, 10 OQ4, OQ7, OQ16, OQ18, 07 OQ6, OQ23). Pure functions: every getter that feeds a KPI tile
// (DAL, view model) calls one of them, so a questionnaire answer changes one place. Each formula is stated in a
// one-line comment; values are computed at the project's data date (`projectDataDate`, src/domain/ch4-defaults.ts) or
// the portfolio data date (`DEFAULT_DATA_DATE`) — never the real clock. Golden values: src/domain/kpis.test.ts.
//
// Already computed before chapter 4 (kept where they are, listed for completeness): client home "Change requests to
// approve" (`crAwaiting`, src/domain/home.ts), My approvals "Oldest" (`oldestItem`, src/domain/approvals.ts), Documents
// "Obsolete revisions withdrawn" (`vaultKpis`, src/domain/documents.ts), Site "2 rotations" (`rotationCount`,
// src/domain/site.ts). Resources KPIs (unmet demand, peak weeks, skills ≥ 4) belong to the what-if module.
import { addDaysIso, daysBetweenIso, dowOfIso, parisParts, STATUS_ISO } from '@/server/db/codes';
import { BUILTIN_CALENDAR_BY_CODE, makeCalendar, type CalendarDef, type WorkCalendar } from './calendar';
import { DEFAULT_PROJECT_CALENDAR } from './ch4-defaults';
import { clampHealthCpi } from './health';
import { paymentDueOn, type PaymentRule } from './payment-terms';

// ── Dates ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "2026-09" of an ISO date. */
export const monthKey = (iso: string) => iso.slice(0, 7);
/** First day of the month ("2026-09-01"). */
export const monthStartOf = (iso: string) => `${monthKey(iso)}-01`;
/** First day of the month `n` months after the month of `iso` (n may be negative). */
export function addMonthsIso(iso: string, n: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
/** Whole months from the month of `a` to the month of `b` (negative when b is earlier). */
export const monthsBetween = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
/** Last day of the month of `iso`. */
export const monthEndOf = (iso: string) => addDaysIso(addMonthsIso(iso, 1), -1);
/** Calendar quarter "2026-Q3" of an ISO date. */
export const quarterKey = (iso: string) => `${iso.slice(0, 4)}-Q${Math.floor((+iso.slice(5, 7) - 1) / 3) + 1}`;
/** Monday of the ISO week of `iso`. */
export const weekMondayOf = (iso: string) => addDaysIso(iso, -((dowOfIso(iso) + 6) % 7));
/** ISO date (Europe/Paris) of an instant. */
export const parisDateOf = (at: Date | string) => parisParts(typeof at === 'string' ? new Date(at) : at).iso;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Last day of a register month text ("Dec 2026" → "2026-12-31"); null for "—" or anything else. */
export function finishOfMonthText(text: string | null | undefined): string | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec((text ?? '').trim());
  const i = m ? MONTHS_EN.indexOf(m[1]) : -1;
  return m && i >= 0 ? monthEndOf(`${m[2]}-${String(i + 1).padStart(2, '0')}-01`) : null;
}

/** The standard calendar (5 d · 8 h, French public holidays) — the default of every working-day KPI (S-2, S-8). */
export const standardCalendar = (): WorkCalendar => makeCalendar(BUILTIN_CALENDAR_BY_CODE[DEFAULT_PROJECT_CALENDAR]);
/** Weekly hours of a calendar: working weekdays × hours per day (standard 5 × 8 = 40, the "of 40 h" basis). */
export const weekHoursOf = (def: Pick<CalendarDef, 'workDays' | 'hoursPerDay'> = BUILTIN_CALENDAR_BY_CODE[DEFAULT_PROJECT_CALENDAR]) =>
  def.workDays.length * def.hoursPerDay;

const round1 = (v: number) => Math.round(v * 10) / 10;
/** Leading count of a text ("1 248 drawings · 13 linked" → 1248, "0 déclaré" → 0); null without one. */
export function leadingCount(text: string | null | undefined): number | null {
  const m = /^\s*(\d[\d\s  ]*)/.exec(text ?? '');
  return m ? parseInt(m[1].replace(/[\s  ]/g, ''), 10) : null;
}

// ── Portfolio margin (03 OQ8) ────────────────────────────────────────────────────────────────────────────────────────

/** Estimate at completion of a project: BAC / CPI, CPI = budget × progress / actual clamped to [0.70, 1.25], 1 without actuals (the Projects screen's EAC, A-13). */
export function projectEacKeur(p: { budget: number; actual: number; progress: number }): number {
  const cpi = p.actual ? clampHealthCpi((p.budget * p.progress) / p.actual) : 1;
  return p.budget / cpi;
}

/**
 * Margin at completion of one project (C-10b, R-132) = round(100 × (contract − EAC) / contract), whole %; null for an internal
 * project (contract 0) or a project without a billing plan. Contract and EAC in euros (the contract consolidated at the project's
 * budget rate, C-9). The one margin rule of Prioritisation, Cash flow and the steering status report (it was (contract − budget) /
 * contract, the budgeted margin).
 */
export function projectMarginPct(contractKeur: number | null | undefined, eacKeur: number): number | null {
  return contractKeur && contractKeur > 0 ? Math.round((100 * (contractKeur - eacKeur)) / contractKeur) : null;
}

/** Portfolio margin % = round(100 × Σ (contract − EAC) / Σ contract) over the active client projects (contract > 0); null when none. */
export function portfolioMarginPct(rows: readonly { contractKeur: number; eacKeur: number }[]): number | null {
  const client = rows.filter((r) => r.contractKeur > 0);
  const contract = client.reduce((s, r) => s + r.contractKeur, 0);
  return contract ? Math.round((100 * client.reduce((s, r) => s + r.contractKeur - r.eacKeur, 0)) / contract) : null;
}

// ── Cash forecast — next 6 months (03 OQ7) ──────────────────────────────────────────────────────────────────────────

/** Months of the cash window (the months after the data date's month). */
export const CASH_WINDOW_MONTHS = 6;
/** Payment delay of a billing plan without a contract (no payment terms recorded): Net 30. */
export const DEFAULT_PAYMENT_DAYS = 30;

export interface CashMilestoneInput {
  /** "M3" / "Handover". */
  label: string;
  amountKeur: number;
  status: 'planned' | 'invoiced' | 'paid';
  /** Contractual date of the milestone (planned), null when the plan has none. */
  dueOn: string | null;
  /** Payment due date of the milestone's invoice (invoiced), null when unknown. */
  paymentDueOn?: string | null;
}

export interface CashProjectInput {
  code: string;
  milestones: readonly CashMilestoneInput[];
  /** Payment delay of the contract's terms, calendar days (N of the rule). */
  paymentDays: number;
  /** Payment rule of the contract (C-6, R-076); absent = 'net' (invoice date + `paymentDays`). */
  paymentRule?: PaymentRule;
  /** Estimate to complete, k€: max(0, EAC − actual cost). */
  etcKeur: number;
  /**
   * C-10a (R-133): the planned spend per calendar month — the monthly increments of the PV curve (first day of the month, k€).
   * The remaining spend is spread along it; absent or exhausted = evenly to the finish.
   */
  plannedSpend?: readonly { month: string; keur: number }[];
  /** Planned finish (ISO), null when unknown. */
  finishOn: string | null;
  /** Monthly progress billing: contract value not invoiced yet, billed at each month end with the spend (k€); 0/absent otherwise. */
  progressBillingKeur?: number;
}

export interface CashReceipt {
  project: string;
  label: string;
  amountKeur: number;
  /** Expected payment date (ISO). */
  on: string;
  /** Monthly progress billing: the month the invoice covers (ISO first day). */
  progressMonth?: string;
}

/**
 * Expected receipts of a project: an invoice is paid on its due date; a dated planned milestone is invoiced at max(its date,
 * data date) and paid by the contract's payment rule (R-076); undated planned milestones are spread evenly from the data date to
 * the planned finish, then the rule; monthly progress billing invoices the unbilled contract value in equal parts at each month
 * end up to the finish, then the rule.
 */
export function expectedReceipts(p: CashProjectInput, asOf: string): CashReceipt[] {
  const terms = { rule: p.paymentRule ?? 'net', days: p.paymentDays } as const;
  const due = (invoicedOn: string) => paymentDueOn(invoicedOn, terms);
  const undated = p.milestones.filter((m) => m.status === 'planned' && !m.dueOn);
  const span = p.finishOn && p.finishOn > asOf ? daysBetweenIso(asOf, p.finishOn) : 0;
  const out: CashReceipt[] = [];
  for (const m of p.milestones) {
    if (m.status === 'paid' || !m.amountKeur) continue;
    let on: string;
    if (m.status === 'invoiced') on = m.paymentDueOn ?? due(asOf);
    else if (m.dueOn) on = due(m.dueOn > asOf ? m.dueOn : asOf);
    else on = due(addDaysIso(asOf, Math.round(((undated.indexOf(m) + 1) / undated.length) * span)));
    out.push({ project: p.code, label: m.label, amountKeur: m.amountKeur, on });
  }
  if (p.progressBillingKeur && p.progressBillingKeur > 0) {
    const first = addMonthsIso(asOf, 1);
    const months = p.finishOn ? Math.max(1, monthsBetween(first, p.finishOn) + 1) : CASH_WINDOW_MONTHS;
    for (let i = 0; i < months; i++) {
      const month = addMonthsIso(first, i);
      out.push({ project: p.code, label: MONTHS_EN[+month.slice(5, 7) - 1], amountKeur: p.progressBillingKeur / months, on: due(monthEndOf(month)), progressMonth: month });
    }
  }
  return out;
}

export interface CashForecastMonth {
  /** First day of the month (ISO). */
  month: string;
  cashInKeur: number;
  cashOutKeur: number;
  /** Receipts expected in the month (date order). */
  receipts: CashReceipt[];
}

/** First days of the window's months: the `n` months after the data date's month. */
export const cashWindow = (asOf: string, n = CASH_WINDOW_MONTHS) => Array.from({ length: n }, (_, i) => addMonthsIso(asOf, i + 1));

/**
 * Remaining spend of a project per window month (C-10a, R-133): the ETC spread along the planned curve — each month from the
 * window start on gets ETC × its planned spend ÷ the planned spend still to come (the window's share only; months past the
 * window are outside it). Without a planned curve, or once the curve is spent (a late project), evenly over the months from
 * the window start to the planned finish month (all in the first month when the finish has passed, over the window when
 * unknown) — the chapter-4 rule. k€, unrounded.
 */
export function remainingSpend(p: Pick<CashProjectInput, 'etcKeur' | 'finishOn' | 'plannedSpend'>, months: readonly string[]): number[] {
  const n = months.length;
  const out = months.map(() => 0);
  if (!(p.etcKeur > 0) || !n) return out;
  const first = months[0];
  const ahead = (p.plannedSpend ?? []).filter((x) => x.month >= first && x.keur > 0);
  const total = ahead.reduce((s, x) => s + x.keur, 0);
  if (total > 0) {
    for (const x of ahead) {
      const i = months.indexOf(monthStartOf(x.month));
      if (i >= 0) out[i] += (p.etcKeur * x.keur) / total;
    }
    return out;
  }
  // Months from the window start to the finish month, both included (1 when the finish has passed).
  const span = p.finishOn ? Math.max(1, monthsBetween(first, p.finishOn) + 1) : n;
  for (let i = 0; i < Math.min(n, span); i++) out[i] += p.etcKeur / span;
  return out;
}

/**
 * Planned spend per calendar month from a cumulative PV curve (k€) whose index 0 is the month `startMonth` months after
 * Jan 2026 (the evm_periods / Budget convention): the month's increment PV[i] − PV[i − 1].
 */
export function plannedSpendOfPv(pv: readonly number[], startMonth: number): { month: string; keur: number }[] {
  const base = Math.floor(startMonth);
  return pv.map((v, i) => ({ month: addMonthsIso('2026-01-01', base + i), keur: v - (i ? pv[i - 1] : 0) }));
}

/**
 * Cash in of a month = Σ receipts expected in it (overdue ones in the first month, later ones outside the window);
 * cash out = each project's remaining spend along its planned curve (`remainingSpend`, C-10a). k€, rounded.
 */
export function cashForecast(projects: readonly CashProjectInput[], asOf: string, n = CASH_WINDOW_MONTHS): CashForecastMonth[] {
  const months = cashWindow(asOf, n);
  const first = months[0];
  const last = monthEndOf(months[n - 1]);
  const inK = months.map(() => 0);
  const outK = months.map(() => 0);
  const receipts: CashReceipt[][] = months.map(() => []);
  for (const p of projects) {
    for (const r of expectedReceipts(p, asOf)) {
      if (r.on > last) continue;
      const i = r.on < first ? 0 : months.indexOf(monthStartOf(r.on));
      inK[i] += r.amountKeur;
      receipts[i].push(r);
    }
    remainingSpend(p, months).forEach((v, i) => (outK[i] += v));
  }
  return months.map((month, i) => ({
    month, cashInKeur: Math.round(inK[i]), cashOutKeur: Math.round(outK[i]), receipts: receipts[i].sort((a, b) => a.on.localeCompare(b.on)),
  }));
}

export interface LowestPoint {
  /** Index of the month in the window. */
  index: number;
  cumKeur: number;
  /** The first receipt expected after that month (the payment the low point waits for), null when none in the window. */
  next: CashReceipt | null;
}

/** Lowest cumulative point = the month of the minimum running Σ (in − out), and the first receipt expected after it. */
export function lowestCumulativePoint(months: readonly CashForecastMonth[]): LowestPoint | null {
  if (!months.length) return null;
  let cum = 0;
  let low = { index: 0, cumKeur: Infinity };
  months.forEach((m, i) => {
    cum += m.cashInKeur - m.cashOutKeur;
    if (cum < low.cumKeur) low = { index: i, cumKeur: cum };
  });
  const next = months.slice(low.index + 1).find((m) => m.receipts.length)?.receipts[0] ?? null;
  return { ...low, next };
}

// ── Capacity model (03 OQ9) ──────────────────────────────────────────────────────────────────────────────────────────

/** Weeks of the capacity window (the resource pool's 8 weekly loads). */
export const CAPACITY_WINDOW_WEEKS = 8;

export interface PoolLoad {
  department: string | null;
  /** % of available hours, one value per window week. */
  loads: readonly number[];
}

/** Capacity of a department = pool members × weekly hours × window weeks; committed = Σ members Σ weekly load % × weekly hours. */
export function departmentCapacity(people: readonly PoolLoad[], department: string, weekHours = weekHoursOf(), weeks = CAPACITY_WINDOW_WEEKS) {
  const members = people.filter((p) => p.department === department);
  return {
    members: members.length,
    capacityH: members.length * weekHours * weeks,
    committedH: Math.round(members.reduce((s, p) => s + p.loads.slice(0, weeks).reduce((a, l) => a + (l / 100) * weekHours, 0), 0)),
  };
}

/** Value of a project for the demand rate: its contract value when it has one, else its budget at completion (k€). */
export const projectValueKeur = (contractKeur: number | null | undefined, budgetKeur: number) => (contractKeur && contractKeur > 0 ? contractKeur : budgetKeur);

/** Demand per €1M = the department's committed hours over the window ÷ value of the active portfolio in M€ (0 without value). */
export const demandPerMeur = (committedH: number, portfolioValueKeur: number) => (portfolioValueKeur > 0 ? committedH / (portfolioValueKeur / 1000) : 0);

// ── Procurement (08 OQ23) ────────────────────────────────────────────────────────────────────────────────────────────

export interface RfqKpiFacts {
  /** Award date (ISO), null when not awarded. */
  awardedOn: string | null;
  /** "Send to suppliers" date (ISO), null when unknown. */
  sentOn: string | null;
  listPriceEur: number | null;
  awardedUnitPriceEur: number | null;
  quantity: number | null;
}

/** Savings vs list (k€) = Σ (list price − awarded unit price) × quantity over the RFQs awarded in the data date's quarter. */
export function rfqSavingsKeur(rfqs: readonly RfqKpiFacts[], asOf: string): number {
  const q = quarterKey(asOf);
  const eur = rfqs
    .filter((r) => r.awardedOn && quarterKey(r.awardedOn) === q && r.listPriceEur != null && r.awardedUnitPriceEur != null && r.quantity)
    .reduce((s, r) => s + (r.listPriceEur! - r.awardedUnitPriceEur!) * r.quantity!, 0);
  return round1(eur / 1000);
}

/** Average cycle (calendar days, whole) = mean of sent → award over the awarded RFQs with both dates; null when none. */
export function rfqAverageCycleDays(rfqs: readonly RfqKpiFacts[]): number | null {
  const d = rfqs.filter((r) => r.awardedOn && r.sentOn).map((r) => daysBetweenIso(r.sentOn!, r.awardedOn!));
  return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
}

/** On-time window of the deliveries KPI ("Last 90 days"). */
export const ON_TIME_WINDOW_DAYS = 90;

/** On-time deliveries % = receipts received on or before their PO's expected date ÷ receipts received in the 90 days up to the data date (PO date known); null when none. */
export function onTimeDeliveryPct(receipts: readonly { receivedOn: string | null; poExpectedOn: string | null }[], asOf: string): number | null {
  const from = addDaysIso(asOf, -ON_TIME_WINDOW_DAYS);
  const window = receipts.filter((r) => r.receivedOn && r.poExpectedOn && r.receivedOn > from && r.receivedOn <= asOf);
  return window.length ? Math.round((100 * window.filter((r) => r.receivedOn! <= r.poExpectedOn!).length) / window.length) : null;
}

// ── Resource requests (08 OQ23) ──────────────────────────────────────────────────────────────────────────────────────

const SENT = new Set(['sent', 'resent']);
const DECIDED = new Set(['approved', 'reschedule', 'rejected']);

/** Average response (working days, 1 decimal) = mean over decisions of working days from the request's sending to the department's decision; null when none. */
export function averageResponseDays(
  requests: readonly { events: readonly { action: string; date: string }[] }[],
  cal: Pick<WorkCalendar, 'workDaysBetween'> = standardCalendar(),
): number | null {
  const spans: number[] = [];
  for (const r of requests) {
    let sent: string | null = null;
    for (const e of r.events) {
      if (SENT.has(e.action)) sent = e.date;
      else if (DECIDED.has(e.action) && sent) {
        spans.push(Math.max(0, cal.workDaysBetween(sent, e.date)));
        sent = null;
      }
    }
  }
  return spans.length ? round1(spans.reduce((a, b) => a + b, 0) / spans.length) : null;
}

// ── Site (10 OQ7) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Crew of a rotation line: "Contractant — 2 monteurs" → 2 (a count after the dash), a named person → 1. */
export function crewSize(person: string): number {
  const m = /[—–-]\s*(\d+)\s/.exec(person);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

/** Man-days planned = Σ rotation lines crew × working days from arrival to departure (both included, the project calendar). */
export function plannedManDays(rotation: readonly { person: string; fromOn: string; toOn: string }[], cal: Pick<WorkCalendar, 'durationOf'> = standardCalendar()): number {
  return rotation.reduce((s, r) => s + crewSize(r.person) * cal.durationOf(r.fromOn, r.toOn), 0);
}

/** HSE incidents = Σ of the counts Vigie reports on its incident / near-miss registers ("0 déclaré" → 0). */
export const vigieIncidentCount = (items: readonly { kind?: string; statusText?: string | null }[]) =>
  items.filter((h) => h.kind === 'register').reduce((s, h) => s + (leadingCount(h.statusText) ?? 0), 0);

// ── Drawings vault (09 OQ17) ─────────────────────────────────────────────────────────────────────────────────────────

export interface VaultSyncFacts {
  /** ISO instant of the run. */
  at: string;
  /** Drawings in the PDM vault reported by the run; null when unknown. */
  drawingsInVault: number | null;
}

/** Vault state = the latest of the PDM connector row's last run (volume "1 248 drawings · …") and Keystone's last vault sync; the count from the latest run that reports one. */
export function latestVaultSync(sources: readonly (VaultSyncFacts | null)[]): VaultSyncFacts | null {
  const runs = sources.filter((s): s is VaultSyncFacts => !!s).sort((a, b) => b.at.localeCompare(a.at));
  if (!runs.length) return null;
  return { at: runs[0].at, drawingsInVault: runs.find((r) => r.drawingsInVault != null)?.drawingsInVault ?? null };
}

// ── Change orders (09 OQ18) ──────────────────────────────────────────────────────────────────────────────────────────

/** Release date of a released ECO = Vigie's last approval decision (release is automatic once approved), else its raise date. */
export function ecoReleaseDate(e: { raisedOn?: string | null; approvals?: readonly { decidedAt?: string | null }[] }): string | null {
  const last = (e.approvals ?? []).map((a) => a.decidedAt).filter((d): d is string => !!d).sort().at(-1);
  return last ? parisDateOf(last) : e.raisedOn ?? null;
}

/** Released this month = released ECOs whose release date falls in the data date's calendar month. */
export function releasedInMonth<T extends { status: string; raisedOn?: string | null; approvals?: readonly { decidedAt?: string | null }[] }>(ecos: readonly T[], asOf: string): T[] {
  return ecos.filter((e) => e.status === 'released' && monthKey(ecoReleaseDate(e) ?? '') === monthKey(asOf));
}

// ── Quality (07 OQ23) ────────────────────────────────────────────────────────────────────────────────────────────────

/** Closed this quarter = closed NCRs whose closure date (Vigie's last update, else the raise date) falls in the data date's calendar quarter. */
export function closedInQuarter(ncrs: readonly { status: string; closedOn?: string | null; raisedOn?: string | null }[], asOf: string): number {
  const q = quarterKey(asOf);
  return ncrs.filter((n) => n.status === 'closed' && (n.closedOn ?? n.raisedOn) && quarterKey((n.closedOn ?? n.raisedOn)!) === q).length;
}

// ── Interfaces (07 OQ6) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Due within n days = open interfaces whose need date is between the data date and the data date + n calendar days. */
export function dueWithinDays(rows: readonly { status: string; neededBy: string }[], asOf: string, days = 30): number {
  const until = addDaysIso(asOf, days);
  return rows.filter((r) => r.status === 'open' && r.neededBy >= asOf && r.neededBy <= until).length;
}

// ── My work (10 OQ18) ────────────────────────────────────────────────────────────────────────────────────────────────

/** Logged this week = Σ the person's time entries dated from the Monday of the data date's week to the data date. */
export function loggedInWeek(entries: readonly { workDate: string; hours: number }[], asOf: string): number {
  const from = weekMondayOf(asOf);
  return round1(entries.filter((e) => e.workDate >= from && e.workDate <= asOf).reduce((s, e) => s + e.hours, 0));
}

/** Load next n weeks = round(mean of the person's weekly loads of the n weeks starting after the data date); null without them. */
export function nextWeeksLoad(weekStarts: readonly string[], loads: readonly number[] | null, asOf: string, n = 2): number | null {
  if (!loads) return null;
  const idx = weekStarts.map((w, i) => (w > asOf ? i : -1)).filter((i) => i >= 0).slice(0, n);
  return idx.length === n ? Math.round(idx.reduce((s, i) => s + (loads[i] ?? 0), 0) / n) : null;
}

// ── Activity & integrations (10 OQ4) ─────────────────────────────────────────────────────────────────────────────────

/** Events today = activity events whose Paris date is the data date. */
export const eventsOnDay = (instants: readonly (Date | string)[], day: string = STATUS_ISO) => instants.filter((at) => parisDateOf(at) === day).length;
