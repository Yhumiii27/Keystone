// Portfolio finance: proposal scoring and ranking, capacity what-if, billing roll-up and the 6-month cash forecast
// (docs/spec/03 §6 Prioritisation & capacity, §7 Cash flow & billing; prototype logic 4494–4520). Pure functions on
// numbers and codes; money formatting and translation stay in the UI (src/features/pfinance/model.ts).
// Golden values: src/domain/portfolio-finance.test.ts (the prototype logic run in node).

// ── Margin rights ──────────────────────────────────────────────────────────────────────────────────────

/** Margins (ranking "Margin", cash "Margin", "Portfolio margin") are shown to these roles only (`canSeeMargin`). */
export const MARGIN_ROLES = ['director', 'pm'] as const;
export const canSeeMargins = (role: string) => (MARGIN_ROLES as readonly string[]).includes(role);

/** A margin below this % is shown in the attention colour (strict). */
export const MARGIN_ALERT_PCT = 15;

/**
 * "Portfolio margin" KPI: the prototype's constant (03 OQ8, A-12 — "Client projects · weighted by contract" has no
 * formula yet). Kept as a constant until finance confirms the definition.
 */
export const PORTFOLIO_MARGIN_PCT = 18;

/** `(contract − budget) / contract` in whole %, null for internal projects (contract 0) or without a billing plan. */
export function marginPct(contractKeur: number | null | undefined, budgetKeur: number): number | null {
  return contractKeur ? Math.round(((contractKeur - budgetKeur) / contractKeur) * 100) : null;
}

export const marginAlert = (pct: number | null) => pct != null && pct < MARGIN_ALERT_PCT;

// ── Scoring (logic 4497–4500) ──────────────────────────────────────────────────────────────────────────

/** Axis scale: scores are integers 1–5. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Raw Σ of the weights (the "Weights sum" tile; 0 when every weight is 0). */
export const weightSum = (weights: number[]) => weights.reduce((a, b) => a + b, 0);

/** Σw used to normalise: the raw sum, or 1 when it is 0 (`wSum || 1`). */
const normaliser = (weights: number[]) => weightSum(weights) || 1;

/** 100 × Σ (sᵢ / 5) × (wᵢ / Σw), unrounded. */
export function priorityScore(scores: number[], weights: number[]): number {
  const sum = normaliser(weights);
  return scores.reduce((a, s, i) => a + (s / SCORE_MAX) * ((weights[i] ?? 0) / sum), 0) * 100;
}

/** Normalised share of each weight, whole % (`round(w / Σw × 100)`). */
export const weightShares = (weights: number[]) => weights.map((w) => Math.round((w / normaliser(weights)) * 100));

/** "Weights sum" in the attention colour when |Σw − 1| > 0.01. */
export const weightsOff = (weights: number[]) => Math.abs(weightSum(weights) - 1) > 0.01;

/** Weight input (`setW`): parseFloat, NaN → 0. */
export function parseWeight(raw: string): number {
  const v = parseFloat(raw);
  return Number.isNaN(v) ? 0 : v;
}

/** Valid stored weight: finite, 0 ≤ w ≤ 1 (the input's min/max), rounded to 3 decimals. Null when invalid. */
export function validWeight(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 1000) / 1000;
}

/** Valid axis score: an integer 1–5 (the "Score a proposal" numbers). Null when invalid. */
export function validScore(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX ? n : null;
}

export interface Ranked<T> {
  rank: number;
  /** Rounded score 0–100 (also the bar width in %). */
  score: number;
  item: T;
}

/** Ranking: rounded score descending, ties in input (register) order; rank 1…n (`scoreRows`). */
export function rankByScore<T extends { scores: number[] }>(items: T[], weights: number[]): Ranked<T>[] {
  return items
    .map((item) => ({ item, score: Math.round(priorityScore(item.scores, weights)) }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

/** Filled state of the 5 dots of an axis score. */
export const scoreDots = (v: number) => [1, 2, 3, 4, 5].map((d) => d <= v);

// ── Capacity what-if (logic 4505–4512) ────────────────────────────────────────────────────────────────

/** Candidate demand of a department over the 8-week window: round(budget / 1000 × hours per €1M). */
export const candidateHours = (budgetKeur: number, hoursPerMeur: number) => Math.round((budgetKeur / 1000) * hoursPerMeur);

export interface CapacityLoad {
  capacityH: number;
  committedH: number;
  /** Candidate project demand. */
  addH: number;
}

export interface CapacityBar {
  totalH: number;
  /** max(0, total − capacity). */
  gapH: number;
  over: boolean;
  /** Widths / tick position in whole % of max(capacity, total) × 1.1. */
  committedPct: number;
  candidatePct: number;
  capacityPct: number;
}

export function capacityBar({ capacityH, committedH, addH }: CapacityLoad): CapacityBar {
  const totalH = committedH + addH;
  const scale = Math.max(capacityH, totalH) * 1.1 || 1;
  return {
    totalH,
    gapH: Math.max(0, totalH - capacityH),
    over: totalH > capacityH,
    committedPct: Math.round((committedH / scale) * 100),
    candidatePct: Math.round((addH / scale) * 100),
    capacityPct: Math.round((capacityH / scale) * 100),
  };
}

/** Overtime band: a gap under this many hours is "absorbable with overtime or one contractor". */
export const OVERTIME_GAP_H = 300;
/** Hours per additional person over the window (verdict) and per contracted engineer (options). */
export const HOURS_PER_PERSON = 140;
export const HOURS_PER_CONTRACTOR = 280;

export type Verdict = 'absorbed' | 'overtime' | 'hire';

export const verdictOf = (gapH: number): Verdict => (gapH === 0 ? 'absorbed' : gapH < OVERTIME_GAP_H ? 'overtime' : 'hire');

/** Verdict sentence (EN source). */
export function verdictText(gapH: number): string {
  const v = verdictOf(gapH);
  if (v === 'absorbed') return 'Can be absorbed with current capacity';
  if (v === 'overtime') return `Absorbable with ${gapH} h of overtime or one contractor`;
  return `Needs ${Math.ceil(gapH / HOURS_PER_PERSON)} additional people or a later start`;
}

/** "Options" card rows (EN source). `projectName` = the candidate's English name (first word used). */
export function capacityOptions(projectName: string, gapH: number): string[] {
  return [
    gapH ? `Start ${projectName.split(' ')[0]} 6 weeks later — gap closes as Harbor Line demobilises` : 'No action needed',
    gapH ? `Contract ${Math.ceil(gapH / HOURS_PER_CONTRACTOR)} engineer(s) for the ramp-up phase` : 'Keep 10% reserve for Harbor Line recovery',
    'Delay Metro Signage Line B (non-critical) by 2 weeks',
  ];
}

// ── Billing roll-up (logic 4515–4517) ─────────────────────────────────────────────────────────────────

export type MilestoneState = 'planned' | 'invoiced' | 'paid';

export interface BillingLine {
  label: string;
  amountKeur: number;
  status: MilestoneState;
}

export interface BillingRollup {
  /** Σ milestones not planned (invoiced or paid). */
  invoicedKeur: number;
  paidKeur: number;
  /** invoiced − paid. */
  outstandingKeur: number;
  /** Σ milestones in status "invoiced" (the "Outstanding receivables" tile). */
  receivableKeur: number;
  /** First planned milestone. */
  next: BillingLine | null;
  /** Contract value 0 → internal project. */
  internal: boolean;
  /** invoiced / contract and paid / contract, whole %; 0 for internal projects. */
  invoicedPct: number;
  paidPct: number;
}

export function billingRollup(contractKeur: number, lines: BillingLine[]): BillingRollup {
  const invoicedKeur = lines.filter((m) => m.status !== 'planned').reduce((a, m) => a + m.amountKeur, 0);
  const paidKeur = lines.filter((m) => m.status === 'paid').reduce((a, m) => a + m.amountKeur, 0);
  return {
    invoicedKeur,
    paidKeur,
    outstandingKeur: invoicedKeur - paidKeur,
    receivableKeur: lines.filter((m) => m.status === 'invoiced').reduce((a, m) => a + m.amountKeur, 0),
    next: lines.find((m) => m.status === 'planned') ?? null,
    internal: !contractKeur,
    invoicedPct: contractKeur ? Math.round((invoicedKeur / contractKeur) * 100) : 0,
    paidPct: contractKeur ? Math.round((paidKeur / contractKeur) * 100) : 0,
  };
}

// ── Cash forecast (logic 4518–4520) ───────────────────────────────────────────────────────────────────

/** Bar scale of the cash-flow chart (k€ = 100 % of the 100px bar area); grows if a month exceeds it. */
export const CASH_BAR_SCALE_KEUR = 1500;

export interface CashMonth {
  cashInKeur: number;
  cashOutKeur: number;
}

export interface CashBar {
  /** Bar heights in whole % of the scale. */
  inPct: number;
  outPct: number;
  netKeur: number;
  /** Cumulative net to this month (computed, not displayed). */
  cumKeur: number;
}

export function cashBars(months: CashMonth[]): CashBar[] {
  const scale = Math.max(CASH_BAR_SCALE_KEUR, ...months.flatMap((m) => [m.cashInKeur, m.cashOutKeur]));
  let cum = 0;
  return months.map((m) => {
    const netKeur = m.cashInKeur - m.cashOutKeur;
    cum += netKeur;
    return { inPct: Math.round((m.cashInKeur / scale) * 100), outPct: Math.round((m.cashOutKeur / scale) * 100), netKeur, cumKeur: cum };
  });
}

/** Net label above a bar: "+530k" / "−760k" (U+2212), as the prototype prints it in both languages. */
export const netLabel = (netKeur: number) => (netKeur >= 0 ? '+' : '−') + Math.abs(netKeur) + 'k';

/** Σ in − Σ out over the window. */
export const netCash = (months: CashMonth[]) => months.reduce((a, m) => a + m.cashInKeur - m.cashOutKeur, 0);

/** Lowest cumulative (in − out) over the window; 0 for an empty window. */
export function lowestCumulative(months: CashMonth[]): number {
  if (!months.length) return 0;
  let cum = 0;
  let low = Infinity;
  for (const m of months) {
    cum += m.cashInKeur - m.cashOutKeur;
    low = Math.min(low, cum);
  }
  return low;
}

/** "{n} client projects · {m} internal" with singular forms ("1 client project"). */
export const clientProjectsText = (client: number, internal: number) => `${client} client project${client === 1 ? '' : 's'} · ${internal} internal`;
