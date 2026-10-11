// Cost control from Keystone's own data (delivery 7, lot "cost-control"): pure rules, no I/O, no translation (English
// source strings). Golden values: src/domain/cost-control.test.ts.
//
//  1. Earned value at the data date (R-073; C-2a "la valeur acquise vaut avancement × budget", A-7, A-12):
//       progress = Σ activity budget × % complete / Σ activity budget            (budget-weighted, 0–1)
//       EV(t)    = BAC × Σ budget × % × g(t) / Σ budget                         g = share of the activity's ACTUAL span elapsed at t
//       PV(t)    = BAC × Σ baseline budget × f(t) / Σ baseline budget           f = share of the activity's BASELINE span elapsed at t
//       AC(t)    = Σ activity actual cost × g(t) + dated costs ≤ t (validated contingency draws; Keystone stock issues
//                  less returns, R-098)
//     Spans are spread linearly over calendar days; the BAC scaling spreads the unallocated contingency pro rata (as the
//     prototype's generated projects did, 04 §1.8). The series has one point per chart month (month end), the month of the
//     data date holds the values AT the data date, EV / AC stop there. Time entries are not costs (C-2b: hours are entered
//     in Cursus; C-2a: only validated Cursus hours count — R-074 feeds the activities' actual cost later).
//  2. Change requests flow through one register (R-068, A-4): approved changes, pending changes and the work-package
//     changes are read from the register; an approval posts the BAC change once and prepares the contract amendment.
//  3. Contingency (R-070 / R-071, A-8, C-4): the register is the source of "drawn" — validated draws only; a draw-down is
//     linked to a change request, a risk or an NCR, cannot exceed the remaining provision and counts once the portfolio
//     director validates it.

// ── Dates and months ────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
// The same few hundred dates are parsed for every month of every project: memoised (bounded) — the projects register computes
// the earned value of the whole portfolio on each request.
const MS = new Map<string, number>();
const msOf = (iso: string) => {
  let v = MS.get(iso);
  if (v === undefined) {
    if (MS.size > 20_000) MS.clear();
    v = Date.parse(iso + 'T00:00:00Z');
    MS.set(iso, v);
  }
  return v;
};
const isoOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Calendar days from `a` to `b` (ISO dates). */
export const daysBetween = (a: string, b: string) => Math.round((msOf(b) - msOf(a)) / DAY_MS);

/** Month index of an ISO date, counted from January 2026 (the prototype's month axis: 0 = Jan 2026). */
export function monthIndexOf(iso: string): number {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  return (y - 2026) * 12 + (m - 1);
}

/** Last day of the month `index` (0 = Jan 2026), ISO. */
export function monthEndOf(index: number): string {
  const y = 2026 + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return isoOfMs(Date.UTC(y, m + 1, 0));
}

/**
 * Share of a span [start, finish] (inclusive calendar days) elapsed at the end of day `t`: 0 before the start, 1 from the
 * finish on, linear in between. A missing bound collapses the span onto the other one; reversed bounds are swapped.
 */
export function spanShare(start: string | null, finish: string | null, t: string): number {
  let s = start ?? finish;
  let f = finish ?? start;
  if (!s || !f) return 0;
  if (f < s) [s, f] = [f, s];
  if (t < s) return 0;
  if (t >= f) return 1;
  return (daysBetween(s, t) + 1) / (daysBetween(s, f) + 1);
}

// ── 1. Earned value from Keystone data (R-073) ───────────────────────────────────────────────────────────

/** An activity as the earned-value rules read it (k€, % 0–100, ISO dates). */
export interface EvmActivity {
  budget: number;
  actual: number;
  /** % complete 0–100. */
  pct: number;
  /** Current start / finish (actual when started / finished). */
  start: string | null;
  finish: string | null;
  /** Started (actual start recorded, or progress reported). */
  started: boolean;
  /** Finished (actual finish recorded, or 100 %). */
  finished: boolean;
}

/** A row of the cost-loaded plan the planned value is measured against (baseline snapshot, else the current plan). */
export interface EvmPlanRow {
  budget: number;
  start: string | null;
  finish: string | null;
}

/**
 * A dated cost that is not in an activity's actual cost, k€: a validated contingency draw-down (A-8 books it on the reserve
 * line), or stock issued in Keystone (a return is negative; SC-5a, R-098).
 */
export interface EvmCostEvent {
  date: string;
  amount: number;
}

export interface EvmInput {
  /** Budget at completion, k€ (the project's current budget, contingency included). */
  bac: number;
  /** Data date (ISO). */
  dataDate: string;
  /** Month index of chart month 0 (project start month, 0 = Jan 2026). */
  startMonth: number;
  /** Chart length in months (12, as the Budget and Schedule charts). */
  months?: number;
  activities: readonly EvmActivity[];
  /** Cost-loaded plan: the current baseline's snapshot (PV source); empty → the activities' current dates. */
  plan: readonly EvmPlanRow[];
  costs?: readonly EvmCostEvent[];
}

export interface ComputedEvm {
  /** Budget-weighted progress of the activities, 0–1. */
  progress: number;
  /** Values at the data date (k€, rounded like the series). */
  pv: number;
  ev: number;
  ac: number;
  /** EV / PV and EV / AC at the data date; null without a planned value / an actual cost. */
  spi: number | null;
  cpi: number | null;
  /** Cumulative monthly series: PV over the whole chart, EV / AC up to the data date's month (`evn` points). */
  series: { pv: number[]; ev: number[]; ac: number[] };
  /** Chart index of the data date's month (negative before the project start). */
  todayM: number;
  /** Months with earned value (EV.length). */
  evn: number;
  /** Where PV comes from: the baseline snapshot, or the current plan when the project has no baseline snapshot yet. */
  planSource: 'baseline' | 'plan';
}

const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);
const pctOf = (a: EvmActivity) => Math.max(0, Math.min(100, a.pct || 0)) / 100;

/** Budget-weighted progress (0–1) of activities; null when no activity carries a budget. */
export function activityProgress(acts: readonly Pick<EvmActivity, 'budget' | 'pct'>[]): number | null {
  const total = sum(acts.map((a) => Math.max(0, a.budget || 0)));
  if (!(total > 0)) return null;
  return sum(acts.map((a) => Math.max(0, a.budget || 0) * (Math.max(0, Math.min(100, a.pct || 0)) / 100))) / total;
}

/** Actual span of an activity for earning and spending: actual start → actual finish, or → the data date while in progress. */
function actualSpan(a: EvmActivity, dataDate: string): { start: string; finish: string } {
  if (!a.started && !(a.pct > 0)) return { start: dataDate, finish: dataDate };
  const start = a.start && a.start <= dataDate ? a.start : dataDate;
  const end = a.finished && a.finish ? (a.finish <= dataDate ? a.finish : dataDate) : dataDate;
  return { start, finish: end < start ? start : end };
}

/** Planned value share (0–1) of a cost-loaded plan at `t`; undated rows count at the latest planned finish. */
function plannedShare(plan: readonly EvmPlanRow[], total: number, latest: string, t: string): number {
  let v = 0;
  for (const r of plan) {
    const b = Math.max(0, r.budget || 0);
    if (!b) continue;
    v += b * (r.start || r.finish ? spanShare(r.start, r.finish, t) : t >= latest ? 1 : 0);
  }
  return v / total;
}

/**
 * Earned value of a project at its data date, from its activities and cost-loaded plan (rules in the file header).
 * Null when no activity carries a budget — the caller then keeps the figures it has (the prototype's, A-15 demo data).
 */
export function computeEvm(inp: EvmInput): ComputedEvm | null {
  const months = inp.months ?? 12;
  const acts = inp.activities;
  const progress = activityProgress(acts);
  if (progress == null) return null;
  const actBudget = sum(acts.map((a) => Math.max(0, a.budget || 0)));
  // PV source: the baseline snapshot when it carries budget, else the activities' current dates (no baseline set yet).
  const planRows = inp.plan.filter((r) => (r.budget || 0) > 0);
  const fromBaseline = planRows.length > 0;
  const plan: readonly EvmPlanRow[] = fromBaseline ? planRows : acts.map((a) => ({ budget: a.budget, start: a.start, finish: a.finish }));
  const planTotal = sum(plan.map((r) => Math.max(0, r.budget || 0)));
  const dated = plan.flatMap((r) => [r.start, r.finish]).filter((d): d is string => !!d).sort();
  const latest = dated[dated.length - 1] ?? inp.dataDate;
  const spans = acts.map((a) => ({ a, span: actualSpan(a, inp.dataDate) }));
  const costs = inp.costs ?? [];

  const pvAt = (t: string) => (planTotal > 0 ? inp.bac * plannedShare(plan, planTotal, latest, t) : 0);
  const evAt = (t: string) => (inp.bac * sum(spans.map(({ a, span }) => Math.max(0, a.budget || 0) * pctOf(a) * spanShare(span.start, span.finish, t)))) / actBudget;
  const acAt = (t: string) =>
    sum(spans.map(({ a, span }) => (a.actual || 0) * spanShare(span.start, span.finish, t))) + sum(costs.filter((c) => c.date <= t).map((c) => c.amount || 0));

  const todayM = monthIndexOf(inp.dataDate) - inp.startMonth;
  const evn = Math.max(0, Math.min(months, todayM + 1));
  // The data date's month (or the last chart month when the project runs past the chart) holds the values at the data date.
  const dateIndex = Math.min(todayM, months - 1);
  const at = (i: number) => (i === dateIndex && todayM >= 0 ? inp.dataDate : monthEndOf(inp.startMonth + i));
  const pv: number[] = [];
  const ev: number[] = [];
  const ac: number[] = [];
  for (let i = 0; i < months; i++) {
    const t = at(i);
    pv.push(Math.round(pvAt(t)));
    if (i < evn) {
      ev.push(Math.round(evAt(t)));
      ac.push(Math.round(acAt(t)));
    }
  }
  // Before the first chart month (a project not started yet), the values at the data date are still computed.
  const pvNow = evn ? pv[evn - 1] : Math.round(pvAt(inp.dataDate));
  const evNow = evn ? ev[evn - 1] : Math.round(evAt(inp.dataDate));
  const acNow = evn ? ac[evn - 1] : Math.round(acAt(inp.dataDate));
  return {
    progress, pv: pvNow, ev: evNow, ac: acNow,
    spi: pvNow ? evNow / pvNow : null,
    cpi: acNow ? evNow / acNow : null,
    series: { pv, ev, ac }, todayM, evn, planSource: fromBaseline ? 'baseline' : 'plan',
  };
}

/** Rounded progress share (0–1, two decimals) as stored and displayed for a project. */
export const roundProgress = (p: number) => Math.round(p * 100) / 100;

// ── Commitments (R-073: "l'engagé depuis les commandes Keystone") ─────────────────────────────────────

/** Purchase order statuses whose open quantity is committed (ordered, not yet received). */
export const COMMITTED_PO_STATUSES = ['ordered', 'partially_received'] as const;

export interface PoLineFacts {
  status: string;
  orderedQty: number;
  receivedQty: number;
  /** € per unit. */
  unitPriceEur: number;
}

/** Orders placed not yet received, k€: Σ (ordered − received) × unit price of the lines of ordered / partially received POs. */
export function openCommitmentKeur(lines: readonly PoLineFacts[]): number {
  const eur = sum(
    lines
      .filter((l) => (COMMITTED_PO_STATUSES as readonly string[]).includes(l.status))
      .map((l) => Math.max(0, (l.orderedQty || 0) - (l.receivedQty || 0)) * (l.unitPriceEur || 0)),
  );
  return Math.round(eur / 100) / 10;
}

// ── 2. Change-request register (R-068, A-4) ─────────────────────────────────────────────────────────────

export type RegisterStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
export type RegisterStep = 'pending' | 'ok' | 'rejected' | 'na';

/** A change request as the budget rules read it. */
export interface RegisterChange {
  /** "CR-008". */
  id: string;
  /** Signed k€. */
  amount: number;
  status: RegisterStatus;
  /** WBS impacted, with the amount allocated to each when entered. */
  wbs: readonly { code: string; amount: number | null }[];
  /** Decision of the client step (null when the request has no chain). */
  clientStep: RegisterStep | null;
}

export interface RegisterReconciliation {
  /** Σ approved amounts and their count ("Approved changes · 3 change requests"). */
  approved: number;
  approvedCount: number;
  /** Σ amounts in review and their ids ("Pending · CR-008 · In review"). */
  pending: number;
  pendingIds: string[];
}

/** Approved and pending changes of the register (drafts and rejected requests change nothing). */
export function registerReconciliation(crs: readonly RegisterChange[]): RegisterReconciliation {
  const approved = crs.filter((c) => c.status === 'approved');
  const pending = crs.filter((c) => c.status === 'in_review');
  return {
    approved: sum(approved.map((c) => c.amount || 0)),
    approvedCount: approved.length,
    pending: sum(pending.map((c) => c.amount || 0)),
    pendingIds: pending.map((c) => c.id),
  };
}

/**
 * Sub-line of the "Pending" tile (English): "CR-008 · In review", "2 change requests in review", "No change request in review",
 * or the prototype's "No change requests raised" when the register is empty.
 */
export function pendingSubText(pendingIds: readonly string[], registerSize: number): string {
  if (!registerSize) return 'No change requests raised';
  if (!pendingIds.length) return 'No change request in review';
  if (pendingIds.length === 1) return `${pendingIds[0]} · In review`;
  return `${pendingIds.length} change requests in review`;
}

export interface WorkPackageRef {
  /** "1.4"; the unallocated contingency row ("—") never receives a change. */
  code: string;
  /** Original budget, k€ (the pro-rata key). */
  original: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Split of a change amount over the work packages (k€, two decimals, the rounding remainder on the largest share so the
 * shares add up to the amount):
 *  - an amount entered against a WBS element of the request is kept as entered;
 *  - the rest goes to the request's other WBS elements that are work packages, pro rata to their original budget (equally
 *    when those budgets are all 0);
 *  - a request on the project root ("1") or on no known work package spreads that rest over every work package, pro rata.
 * Empty when the project has no work package.
 */
export function allocateChange(amount: number, wbs: RegisterChange['wbs'], packages: readonly WorkPackageRef[]): { code: string; amount: number }[] {
  const wps = packages.filter((p) => p.code && p.code !== '—');
  if (!wps.length || !amount) return [];
  const out = new Map<string, number>();
  const known = new Set(wps.map((p) => p.code));
  let rest = amount;
  for (const w of wbs)
    if (w.amount != null && known.has(w.code)) {
      out.set(w.code, (out.get(w.code) ?? 0) + w.amount);
      rest -= w.amount;
    }
  const open = wbs.filter((w) => w.amount == null && known.has(w.code)).map((w) => w.code);
  const targets = wps.filter((p) => (open.length ? open.includes(p.code) : true));
  if (Math.abs(rest) > 1e-9 && targets.length) {
    const base = sum(targets.map((p) => Math.max(0, p.original || 0)));
    const shares = targets.map((p) => ({ code: p.code, w: base > 0 ? Math.max(0, p.original || 0) / base : 1 / targets.length }));
    const parts = shares.map((s) => ({ code: s.code, amount: round2(rest * s.w), w: s.w }));
    const drift = round2(rest - sum(parts.map((p) => p.amount)));
    if (drift) {
      const largest = parts.reduce((m, p) => (p.w > m.w ? p : m));
      largest.amount = round2(largest.amount + drift);
    }
    for (const p of parts) out.set(p.code, round2((out.get(p.code) ?? 0) + p.amount));
  }
  return wps.filter((p) => out.has(p.code)).map((p) => ({ code: p.code, amount: round2(out.get(p.code)!) }));
}

/** "Changes" of each work package: Σ of the approved requests' allocations (A-4: the Budget reads the register). */
export function workPackageChanges(crs: readonly RegisterChange[], packages: readonly WorkPackageRef[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cr of crs.filter((c) => c.status === 'approved'))
    for (const a of allocateChange(cr.amount, cr.wbs, packages)) out.set(a.code, round2((out.get(a.code) ?? 0) + a.amount));
  return out;
}

/** The request changes the contract price: the client approved it (a client step "not required" is an internal change). */
export const isContractualChange = (cr: Pick<RegisterChange, 'clientStep' | 'amount'>) => cr.clientStep === 'ok' && !!cr.amount;

export type AmendmentOutcome =
  /** A draft amendment is prepared for signature. */
  | 'prepared'
  /** The contract already has an amendment for this request. */
  | 'exists'
  /** Internal change (client step not required) or no amount: the contract does not move. */
  | 'not_contractual'
  /** The project has no contract to amend. */
  | 'no_contract';

/** What the approval of a request does to the contract (R-068, A-4 "l'avenant est préparé pour signature"). */
export function amendmentOutcome(cr: Pick<RegisterChange, 'clientStep' | 'amount'>, ctx: { hasContract: boolean; amendmentExists: boolean }): AmendmentOutcome {
  if (!isContractualChange(cr)) return 'not_contractual';
  if (!ctx.hasContract) return 'no_contract';
  return ctx.amendmentExists ? 'exists' : 'prepared';
}

/** Subject of a prepared amendment ("Amendment 3 — Second steel crew — schedule recovery"); the label adds " (CR-008)". */
export const amendmentSubject = (n: number, title: string) => `Amendment ${n} — ${title}`;

/** Budget list of the register: every request but drafts (not raised yet), register order. */
export const budgetChangeRows = <C extends Pick<RegisterChange, 'status'>>(crs: readonly C[]): C[] => crs.filter((c) => c.status !== 'draft');

// ── 3. Contingency (R-070 / R-071, A-8, C-4) ────────────────────────────────────────────────────────────

export type DrawStatus = 'submitted' | 'validated' | 'rejected';
export const DRAW_STATUSES: readonly DrawStatus[] = ['submitted', 'validated', 'rejected'];
/** EN labels of the statuses (the Contingency table and My approvals). */
export const DRAW_STATUS_LABEL: Record<DrawStatus, string> = { submitted: 'Awaiting validation', validated: 'Validated', rejected: 'Rejected' };

/** Who validates a draw-down: the portfolio director (C-4 "validation du directeur"). */
export const DRAW_DECIDER_ROLE = 'director' as const;
export const isDrawDecider = (role: string) => role === DRAW_DECIDER_ROLE;

/**
 * Provision of a project: its register when it has one; else the contingency line of its budget (A-8: one figure for the
 * Budget, the Risk register and the Contingency register); else round(BAC × 3 %) (04 §5.3).
 */
export function provisionOf(p: { registerInitial: number | null; budgetContingency: number | null; bac: number }): { initial: number; source: 'register' | 'budget' | 'default' } {
  if (p.registerInitial != null) return { initial: p.registerInitial, source: 'register' };
  if (p.budgetContingency != null) return { initial: p.budgetContingency, source: 'budget' };
  return { initial: Math.round(p.bac * 0.03), source: 'default' };
}

export interface DrawFacts {
  amount: number;
  status: DrawStatus;
}

/** Drawn = Σ validated draws (A-8: the register is the consumed figure); pending = Σ draws awaiting validation. */
export function drawTotals(draws: readonly DrawFacts[]): { drawn: number; pending: number; validatedCount: number; pendingCount: number } {
  const v = draws.filter((d) => d.status === 'validated');
  const p = draws.filter((d) => d.status === 'submitted');
  return { drawn: sum(v.map((d) => d.amount || 0)), pending: sum(p.map((d) => d.amount || 0)), validatedCount: v.length, pendingCount: p.length };
}

/** Error (EN) when a new draw-down of `amount` would exceed the provision left once the pending draws are validated. */
export function submitBalanceError(amount: number, c: { initial: number; drawn: number; pending: number }): string | null {
  return amount > c.initial - c.drawn - c.pending + 1e-9 ? 'The draw-down exceeds the remaining provision' : null;
}

/** Error (EN) when validating a draw-down of `amount` would take the drawn total above the provision. */
export function validateBalanceError(amount: number, c: { initial: number; drawn: number }): string | null {
  return amount > c.initial - c.drawn + 1e-9 ? 'The draw-down exceeds the remaining provision' : null;
}

export interface ContingencyTile {
  /** round(drawn / initial × 100). */
  pct: number;
  /** Drawn above the provision (0 when within). */
  over: number;
  /** Forecast consumption shown apart (A-8): never below what is drawn. */
  forecast: number;
  /** Forecast above the provision → LO. */
  alert: boolean;
}

/** Budget › reconciliation "Contingency" tile: drawn from the register, the forecast consumption shown apart (A-8). */
export function contingencyTile(initial: number, drawn: number, forecast: number | null): ContingencyTile {
  const f = Math.max(drawn, forecast ?? drawn);
  return { pct: initial ? Math.round((drawn / initial) * 100) : 0, over: Math.max(0, drawn - initial), forecast: f, alert: drawn > initial || f > initial };
}
