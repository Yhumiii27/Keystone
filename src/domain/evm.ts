// Earned-value and cash-recovery logic of the Budget & cost screen (docs/spec/04 §1.4–§1.8; prototype logic
// 3099–3100, 3784–3788, 3829–3845, 4048–4056, 4904–4928). Pure functions: amounts in k€, months as indexes.
// Formatting (money, translated sentences) stays in the UI. Golden values: src/domain/evm.test.ts.

// ── EVM core (logic 3787–3788) ─────────────────────────────────────────────────────────────────────────

export interface EvmSeries {
  /** Cumulative planned value by month end (12 months). */
  pv: number[];
  /** Cumulative earned value to date (EVn months). */
  ev: number[];
  /** Cumulative actual cost to date (EVn months). */
  ac: number[];
  /** Budget at completion. */
  bac: number;
}

export interface EvmCore {
  /** Months elapsed including the current one (`EV.length`). */
  evn: number;
  /** Last earned value, actual cost and planned value (index EVn − 1). */
  ev: number;
  ac: number;
  pv: number;
  cpi: number;
  spi: number;
  /** Estimate at completion = BAC / CPI. */
  eac: number;
  /** Variance at completion = BAC − EAC. */
  vac: number;
  /** To-complete performance index = (BAC − EV) / (BAC − AC). */
  tcpi: number;
  /** Cost variance EV − AC and schedule variance EV − PV. */
  cv: number;
  sv: number;
}

/** CPI, SPI, EAC, VAC, TCPI, CV, SV from the cumulative series (prototype formulas, no rounding). */
export function evmCore({ pv, ev, ac, bac }: EvmSeries): EvmCore {
  const evn = ev.length;
  const e = ev[evn - 1] ?? 0;
  const a = ac[evn - 1] ?? 0;
  const p = pv[evn - 1] ?? 0;
  // Degenerate inputs (no actuals yet) would give Infinity/NaN in the prototype; fall back to neutral ratios.
  const cpi = a ? e / a : 1;
  const spi = p ? e / p : 1;
  const eac = bac / cpi;
  const tcpi = bac - a ? (bac - e) / (bac - a) : 1;
  return { evn, ev: e, ac: a, pv: p, cpi, spi, eac, vac: bac - eac, tcpi, cv: e - a, sv: e - p };
}

// ── Commercial offer → planned value (logic 3099–3100) ─────────────────────────────────────────────────

export interface OfferQuote {
  system: string;
  supplier: string;
  /** k€ */
  amount: number;
  /** "30 / 60 / 10" — deposit / delivery / acceptance %, positional. */
  terms: string;
  /** Month indexes from the project start (chartMonths). */
  orderMonth: number;
  deliveryMonth: number;
  acceptanceMonth: number | null;
  leadWeeks: number;
}

export type DisbursementKind = 'order' | 'deliv' | 'acc';

/** English word of a disbursement kind in the chart tooltip (`deposit|delivery|acceptance`). */
export const DISBURSEMENT_WORD: Record<DisbursementKind, string> = { order: 'deposit', deliv: 'delivery', acc: 'acceptance' };

export interface DisbursementPoint {
  /** Month index, capped at 11. */
  m: number;
  k: DisbursementKind;
  pct: number;
  /** round(amount × pct / 100) */
  amt: number;
  sys: string;
  sup: string;
}

/** `offerPoints(offer)`: one point per non-zero payment term whose month is known. */
export function offerPoints(offer: OfferQuote[]): DisbursementPoint[] {
  const pts: DisbursementPoint[] = [];
  for (const q of offer) {
    const t = q.terms.split('/').map((s) => parseInt(s, 10));
    const at: [DisbursementKind, number | null][] = [['order', q.orderMonth], ['deliv', q.deliveryMonth], ['acc', q.acceptanceMonth]];
    at.forEach(([k, mo], i) => {
      if (mo != null && t[i]) pts.push({ m: Math.min(11, mo), k, pct: t[i], amt: Math.round((q.amount * t[i]) / 100), sys: q.system, sup: q.supplier });
    });
  }
  return pts;
}

/** HLT-026 planned value (`HPV`): offer disbursements + monthly cost streams, cumulated and rounded per month. */
export function plannedValueFromOffer(offer: OfferQuote[], streamsMonthly: number[][]): number[] {
  const m = Array<number>(12).fill(0);
  for (const p of offerPoints(offer)) m[p.m] += p.amt;
  for (const s of streamsMonthly) s.forEach((v, i) => (m[i] += v));
  let c = 0;
  return m.map((v) => Math.round((c += v)));
}

/** Σ quote amounts, quote count and share of BAC (`costProfile.sourceText`, logic 3830–3831). */
export function offerSummary(offer: OfferQuote[], bac: number): { count: number; amount: number; pctOfBac: number } {
  const amount = offer.reduce((a, q) => a + q.amount, 0);
  return { count: offer.length, amount, pctOfBac: bac ? Math.round((amount / bac) * 100) : 0 };
}

/** Long-lead flag of a quote (hourglass icon): lead time ≥ 26 weeks. */
export const isLongLead = (q: Pick<OfferQuote, 'leadWeeks'>) => q.leadWeeks >= 26;

// ── Variance card (logic 3842–3843) ────────────────────────────────────────────────────────────────────

/** Monthly cumulative cost variance bars: `cv = EV − AC`, height % = max(3, |cv| / max(1, max|cv|) × 80). */
export function costVarianceBars(ev: number[], ac: number[]): { cv: number; h: number }[] {
  const cvs = ev.map((e, i) => e - ac[i]);
  const max = Math.max(1, ...cvs.map(Math.abs));
  return cvs.map((cv) => ({ cv, h: Math.max(3, (Math.abs(cv) / max) * 80) }));
}

// ── Bars (logic 3844–3845, 4054) ───────────────────────────────────────────────────────────────────────

/** Share of a line's budget covered by a bullet bar (the bar spans 140 % of the budget). */
export const BAR_SPAN = 1.4;

/** Cost breakdown bullet: actual / committed widths (unclamped), budget tick, forecast diamond (fractions of the track). */
export function categoryBar(budget: number, actual: number, committed: number, forecast: number) {
  return {
    actual: actual / budget / BAR_SPAN,
    committed: committed / budget / BAR_SPAN,
    tick: 1 / BAR_SPAN,
    forecast: Math.min(forecast / budget, BAR_SPAN) / BAR_SPAN,
  };
}

/** Work-package bar: actual fill and EAC diamond clamped at 140 % of the current budget, tick at the current budget. */
export function workPackageBar(current: number, actual: number, eac: number) {
  return {
    actual: Math.min(actual / current, BAR_SPAN) / BAR_SPAN,
    tick: 1 / BAR_SPAN,
    eac: Math.min(eac / current, BAR_SPAN) / BAR_SPAN,
  };
}

export interface WorkPackageAmounts {
  original: number;
  changes: number;
  actual: number;
  eac: number;
}

/** Total row of "Budget by work package" (sums of original, changes, actual, EAC). */
export function workPackageTotals(rows: WorkPackageAmounts[]): WorkPackageAmounts {
  return rows.reduce(
    (a, w) => ({ original: a.original + w.original, changes: a.changes + w.changes, actual: a.actual + w.actual, eac: a.eac + w.eac }),
    { original: 0, changes: 0, actual: 0, eac: 0 },
  );
}

// ── Reconciliation (logic 4051) ────────────────────────────────────────────────────────────────────────
// The contingency tile is src/domain/cost-control.ts `contingencyTile` since delivery 7 (A-8: the register's validated
// draw-downs are the drawn figure; the prototype's `contUsed` forecast shows apart).

// ── Contract & cash recovery (logic 4871–4928) ─────────────────────────────────────────────────────────

export type MilestoneStatus = 'planned' | 'invoiced' | 'paid';

export interface PaymentMilestone {
  id: string;
  label: string;
  /** Share of the contract value in %. */
  pct: number;
  /** Contractual date, e.g. "14 Dec 2026". */
  due: string;
  status: MilestoneStatus;
  /** Invoice date ("26 Sep") or null. */
  invoiced: string | null;
  /** Payment date ("2 Apr") or null. */
  paid: string | null;
}

/** Contract value = base amount + signed amendments (`ctrTotal`, logic 4877). */
export function contractValue(base: number, amendments: { amount: number; signed: boolean }[]): number {
  return base + amendments.filter((a) => a.signed).reduce((s, a) => s + a.amount, 0);
}

/** Milestone amount = round(contract value × share / 100). */
export const milestoneAmount = (total: number, pct: number) => Math.round((total * pct) / 100);

/** Payment delay in days = first integer of the terms text ("Net 45 days" → 45), default 45. */
export function termsDays(terms: string | null | undefined): number {
  const m = String(terms ?? '').match(/\d+/);
  return (m ? parseInt(m[0], 10) : 45) || 45;
}

/** Cash-recovery months: Jan…Dec 2026 then Jan–Mar 2027 (`rcMonths`, RCN = 15). English, translate for display. */
export const RECOVERY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan ’27', 'Feb ’27', 'Mar ’27'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `mAt(s)`: month index (0 = Jan 2026, floored) of a display date; two-token dates ("2 Apr") are in 2026.
 * '—', empty or unparsable → null.
 */
export function monthAt(s: string | null | undefined): number | null {
  if (!s || s === '—') return null;
  const p = String(s).trim().split(/\s+/);
  const parts = p.length === 2 ? [...p, '2026'] : p;
  const d = parts.length === 3 ? parseInt(parts[0], 10) : 1;
  const mo = MONTHS.indexOf(parts[parts.length - 2]);
  const y = parseInt(parts[parts.length - 1], 10);
  const v = (y - 2026) * 12 + mo + (d - 1) / 30;
  return mo < 0 || isNaN(v) ? null : Math.max(0, Math.floor(v));
}

/**
 * Orders placed but not yet in actual cost (`openCommit`): HLT-026 uses the literal 713 (passed as `override`);
 * otherwise 60 % of next month's planned value: max(0, round((PV[min(11, EVn)] − PV[EVn − 1]) × 0.6)).
 */
export function openCommitment(pv: number[], evn: number, override?: number | null): number {
  if (override != null) return override;
  const todayM = evn - 1;
  return Math.max(0, Math.round(((pv[Math.min(11, evn)] ?? 0) - (pv[todayM] ?? 0)) * 0.6));
}

export interface CashRecoveryInput {
  pv: number[];
  ac: number[];
  bac: number;
  /** Months elapsed (EV.length). */
  evn: number;
  cpi: number;
  /** Contract value (base + signed amendments). */
  contractTotal: number;
  milestones: PaymentMilestone[];
  /** Payment delay (days) from the contract terms. */
  termsDays: number;
  /** Orders placed (k€). */
  openCommit: number;
}

export interface CashRecovery {
  /** RECOVERY_MONTHS.length (15). */
  months: number;
  /** Index of the current month (EVn − 1). */
  todayM: number;
  /** Receipt lag in months = max(1, round(termsDays / 30)). */
  termsM: number;
  milestones: (PaymentMilestone & { amount: number })[];
  /** Actual receipts (paid milestones) and projected receipts by month. */
  recA: number[];
  recP: number[];
  /** Milestone ids received/expected in each month. */
  recWhat: string[][];
  cumRec: number[];
  cumCom: number[];
  /** Cumulative receipts − cumulative commitments. */
  recov: number[];
  recNow: number;
  /** Month of the lowest recovery (first minimum). */
  lowI: number;
  /** First month with a projected receipt, −1 when none. */
  nextI: number;
  paid: number;
  paidCount: number;
  openCommit: number;
  /** Actual cost + orders placed (committed to date). */
  committedNow: number;
}

/** Client receipts vs commitments by month (logic 4905–4913). */
export function cashRecovery(inp: CashRecoveryInput): CashRecovery {
  const RCN = RECOVERY_MONTHS.length;
  const { pv, ac: acs, bac, evn, cpi, openCommit } = inp;
  const todayM = evn - 1;
  const ac = acs[todayM] ?? 0;
  const termsM = Math.max(1, Math.round(inp.termsDays / 30));
  const recA = Array<number>(RCN).fill(0);
  const recP = Array<number>(RCN).fill(0);
  const recWhat: string[][] = Array.from({ length: RCN }, () => []);
  const milestones = inp.milestones.map((m) => ({ ...m, amount: milestoneAmount(inp.contractTotal, m.pct) }));
  for (const m of milestones) {
    if (m.status === 'paid') {
      const i = Math.min(monthAt(m.paid) ?? todayM, todayM);
      recA[i] += m.amount;
      recWhat[i].push(m.id);
    } else {
      const base = m.status === 'invoiced' ? monthAt(m.invoiced) : monthAt(m.due);
      let i = (base ?? todayM) + termsM;
      if (i <= todayM) i = todayM + 1;
      if (i < RCN) {
        recP[i] += m.amount;
        recWhat[i].push(m.id);
      }
    }
  }
  let c = 0;
  const cumRec = recA.map((a, i) => (c += a + recP[i]));
  const committedNow = ac + openCommit;
  const cumCom = cumRec.map((_, i) =>
    i < todayM
      ? acs[i]
      : i === todayM
        ? committedNow
        : Math.max(committedNow, Math.round(ac + ((i <= 11 ? pv[i] : bac) - pv[todayM]) / cpi)),
  );
  const recov = cumRec.map((v, i) => v - cumCom[i]);
  const lowI = recov.reduce((b, v, i) => (v < recov[b] ? i : b), 0);
  const paidMs = milestones.filter((m) => m.status === 'paid');
  return {
    months: RCN,
    todayM,
    termsM,
    milestones,
    recA,
    recP,
    recWhat,
    cumRec,
    cumCom,
    recov,
    recNow: recov[todayM],
    lowI,
    nextI: recP.findIndex((v) => v > 0),
    paid: paidMs.reduce((s, m) => s + m.amount, 0),
    paidCount: paidMs.length,
    openCommit,
    committedNow,
  };
}
