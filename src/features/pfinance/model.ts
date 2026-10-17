// View models of Portfolio — prioritisation & capacity (docs/spec/03 §6; template 2079–2141, logic 4494–4512) and
// Cash flow & billing — next 6 months (03 §7; template 2143–2179, logic 4513–4520). Pure (no server-only): the
// Prioritisation board recomputes its view in the browser as weights are typed. Strings are the prototype's English
// source rendered through `t` (pass `pfT(t, lang)`); money through lib/format. Rules: src/domain/portfolio-finance.ts.
import { LO, OK, TAG_CLASS, lifecycleTone, type Tone } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  billingRollup, capacityBar, capacityOptions, cashBars, clientProjectsText, lowestCumulative, marginAlert, netCash, netLabel,
  parseWeight, rankByScore, scoreDots, verdictOf, verdictText, weightShares, weightSum, weightsOff, type BillingLine, type CashMonth,
} from '@/domain/portfolio-finance';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { lowPointSubText, pctOrDash } from '@/features/kpis/i18n';
import { dataText } from '@/i18n/data-text';

const N300 = 'var(--color-neutral-300)';
const N400 = 'var(--color-neutral-400)';
const A300 = 'var(--color-accent-300)';
/** Masked figure for viewers without margin rights. */
export const MASK = '•••';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

// ── URL state (?tab=score|capacity, ?project= candidate, ?sel= selected row) ──────────────────────────

export type PfTab = 'score' | 'capacity';
/** `pfTab`: 'capacity' or the Prioritisation tab (default; the legacy value 'cash' and unknown values included). */
export const parsePfTab = (v: string | null | undefined): PfTab => (v === 'capacity' ? 'capacity' : 'score');

export function prioritisationHref({ tab = 'score', project, sel }: { tab?: PfTab; project?: string | null; sel?: string | null }): string {
  const q = new URLSearchParams();
  if (tab !== 'score') q.set('tab', tab);
  if (project) q.set('project', project);
  if (sel) q.set('sel', sel);
  const s = q.toString();
  return screenHref('portfolio') + (s ? `?${s}` : '');
}

// ── Prioritisation ─────────────────────────────────────────────────────────────────────────────────────

export interface RankInput {
  code: string;
  /** English name. */
  name: string;
  /** Lifecycle label (French domain value, e.g. "APD"). */
  status: string;
  /** Lifecycle code. */
  stage: string;
  budget: number;
  /** Axis scores 1–5, axis order. */
  scores: number[];
  /** Margin %, null = internal or no billing plan. Always null for viewers without margin rights. */
  marginPct: number | null;
}

export interface PrioritisationData {
  /** Axis codes and EN labels, SCORE_AXES order. */
  axes: { code: string; label: string }[];
  /** The viewer's saved weights, axis order. */
  weights: number[];
  /** Ranking population: zone projects with scores, not closed or cancelled (register order). */
  projects: RankInput[];
  /** Zone projects in execution / in the pipeline (KPI tiles). */
  active: { count: number; budgetKeur: number };
  pipeline: { count: number; budgetKeur: number };
  canSeeMargin: boolean;
  /** A-12 "Portfolio margin": Σ (contract − EAC) / Σ contract of the active client projects, whole %; null = none (or masked). */
  portfolioMarginPct?: number | null;
  zoneSelected: boolean;
}

export interface AxisCellView {
  label: string;
  value: number;
  dots: boolean[];
}

export interface RankRowView {
  rank: number;
  code: string;
  name: string;
  status: string;
  stage: string;
  tone: Tone;
  score: number;
  axes: AxisCellView[];
  budget: string;
  marginText: string;
  marginColor: string;
  selected: boolean;
}

export interface WeightRowView {
  code: string;
  label: string;
  /** Normalised share, "25%". */
  pct: string;
}

export interface PrioritisationView {
  kpis: KpiView[];
  rows: RankRowView[];
  weightRows: WeightRowView[];
  /** Zone selected and no ranked project (`zoneEmptyPf`). */
  zoneEmpty: boolean;
  /** "Margins are visible to directors and project managers only." notice. */
  masked: boolean;
}

/** Number shown in a weight input (`String(W8[k])`). */
export const weightText = (w: number) => String(w);

/** `weights` = the live weights (typed drafts parsed with parseWeight, or the saved ones). */
export function prioritisationView(d: PrioritisationData, weights: number[], t: T, lang: Lang, selected: string | null = null): PrioritisationView {
  const f = (k: number) => money(k, lang);
  const ranked = rankByScore(d.projects, weights);
  const top = ranked[0]?.item;
  const sum = weightSum(weights);
  const rows = ranked.map(({ rank, score, item: p }): RankRowView => ({
    rank,
    code: p.code,
    name: dataText(p.name, lang),
    status: t(p.status),
    stage: p.stage,
    tone: lifecycleTone(p.stage),
    score,
    axes: p.scores.map((v, i) => ({ label: t(d.axes[i]?.label ?? ''), value: v, dots: scoreDots(v) })),
    budget: f(p.budget),
    marginText: d.canSeeMargin ? (p.marginPct != null ? `${p.marginPct}%` : t('Internal')) : MASK,
    // The masked "•••" is not coloured: the prototype's LO dots revealed which margins are below 15 %.
    marginColor: d.canSeeMargin && marginAlert(p.marginPct) ? LO : OK,
    selected: selected === p.code,
  }));
  const shares = weightShares(weights);
  return {
    kpis: [
      { label: t('Active projects'), value: String(d.active.count), sub: t(`${f(d.active.budgetKeur)} committed`), color: OK },
      { label: t('Pipeline'), value: String(d.pipeline.count), sub: t(`${f(d.pipeline.budgetKeur)} proposed · approved · planning`), color: OK },
      { label: t('Top-ranked'), value: top ? top.code : '—', sub: top ? dataText(top.name, lang) : '', color: OK },
      {
        label: t('Portfolio margin'),
        value: d.canSeeMargin ? pctOrDash(d.portfolioMarginPct) : MASK,
        sub: t(d.canSeeMargin ? 'Client projects · weighted by contract' : 'Directors and PMs only'),
        color: OK,
      },
      // Σw shown as typed: 0 % (in LO) when every weight is 0 (the prototype showed 100 %, `wSum || 1`).
      { label: t('Weights sum'), value: `${Math.round(sum * 100)}%`, sub: t('Edit weights on the right'), color: weightsOff(weights) ? LO : OK },
    ],
    rows,
    weightRows: d.axes.map((a, i) => ({ code: a.code, label: t(a.label), pct: `${shares[i]}%` })),
    zoneEmpty: d.zoneSelected && d.projects.length === 0,
    masked: !d.canSeeMargin,
  };
}

/** Live weights from the inputs' text (`setW`: NaN → 0). */
export const liveWeights = (drafts: string[]) => drafts.map(parseWeight);

/** Text saved when a weight field is left (blur, Enter): a cleared field is 0, as the prototype reads it (`setW`). */
export const weightOnLeave = (typed: string) => (typed.trim() ? typed : '0');

// ── Capacity what-if ───────────────────────────────────────────────────────────────────────────────────

export interface CapacityInput {
  project: { code: string; name: string; status: string; stage: string; budget: number; start: string };
  departments: { department: string; capacityH: number; committedH: number; addH: number }[];
}

export interface CapacityRowView {
  name: string;
  /** "+476 h". */
  addText: string;
  /** "1586 / 960 h". */
  text: string;
  color: string;
  committedPct: number;
  candidatePct: number;
  capacityPct: number;
}

export interface CapacityView {
  name: string;
  status: string;
  stage: string;
  tone: Tone;
  /** "€3.40M · start Aug 2026". */
  budgetLine: string;
  verdict: string;
  verdictColor: string;
  /** "Capacity gap · 1560 h over 8 weeks". */
  gapLine: string;
  gapH: number;
  rows: CapacityRowView[];
  options: string[];
}

export function capacityView({ project: p, departments }: CapacityInput, t: T, lang: Lang): CapacityView {
  const rows = departments.map((d) => ({ d, b: capacityBar(d) }));
  const gapH = rows.reduce((a, r) => a + r.b.gapH, 0);
  const v = verdictOf(gapH);
  return {
    name: dataText(p.name, lang),
    status: t(p.status),
    stage: p.stage,
    tone: lifecycleTone(p.stage),
    budgetLine: `${money(p.budget, lang)} ${t('· start')} ${t(p.start)}`,
    verdict: t(verdictText(gapH)),
    verdictColor: v === 'absorbed' ? OK : v === 'overtime' ? A300 : LO,
    gapLine: `${t('Capacity gap ·')} ${t(`${gapH} h over 8 weeks`)}`,
    gapH,
    rows: rows.map(({ d, b }) => ({
      name: t(d.department),
      addText: `+${d.addH} h`,
      text: `${b.totalH} / ${d.capacityH} h`,
      color: b.over ? LO : N300,
      committedPct: b.committedPct,
      candidatePct: b.candidatePct,
      capacityPct: b.capacityPct,
    })),
    options: capacityOptions(p.name, gapH).map(t),
  };
}

// ── Cash flow & billing ────────────────────────────────────────────────────────────────────────────────

export interface CashRowInput {
  code: string;
  name: string;
  actual: number;
  /** "Client · milestones" (EN source). */
  modelLabel: string;
  contractKeur: number;
  milestones: BillingLine[];
  /** Margin %, null = internal. Always null for viewers without margin rights. */
  marginPct: number | null;
}

export interface CashData {
  rows: CashRowInput[];
  /** Zone-scaled forecast; `label` = EN month ("Oct", "Jan ’27"). */
  forecast: (CashMonth & { label: string })[];
  /** A-12 "Lowest cumulative point": its month (ISO first day) and the payment it waits for; null/absent = no sub-line. */
  lowPoint?: { month: string; next: { project: string; label: string; progressMonth?: string } | null } | null;
  canSeeMargin: boolean;
  zoneSelected: boolean;
  /** Business date (ISO, R-013): its year is the one the low-point month omits. */
  today: string;
}

export interface CashRowView {
  code: string;
  name: string;
  model: string;
  contract: string;
  invoiced: string;
  paid: string;
  /** Bar widths, whole % of the contract. */
  invoicedPct: number;
  paidPct: number;
  outstanding: string;
  outColor: string;
  cost: string;
  marginText: string;
  marginColor: string;
  next: string;
  internal: boolean;
}

export interface CashBarView {
  label: string;
  inPct: number;
  outPct: number;
  net: string;
  netColor: string;
  /** Tooltips: "Cash in · €1.35M". */
  inTitle: string;
  outTitle: string;
}

export interface CashView {
  kpis: KpiView[];
  rows: CashRowView[];
  bars: CashBarView[];
  zoneEmpty: boolean;
}

export function cashView(d: CashData, t: T, lang: Lang): CashView {
  const f = (k: number, signed = false) => money(k, lang, { signed });
  const rolled = d.rows.map((r) => ({ r, b: billingRollup(r.contractKeur, r.milestones) }));
  const rows = rolled.map(({ r, b }): CashRowView => {
    const c = r.contractKeur;
    return {
      code: r.code,
      name: dataText(r.name, lang),
      model: t(r.modelLabel),
      contract: c ? f(c) : '—',
      invoiced: c ? f(b.invoicedKeur) : '—',
      paid: c ? f(b.paidKeur) : '—',
      invoicedPct: b.invoicedPct,
      paidPct: b.paidPct,
      outstanding: c ? f(b.outstandingKeur) : '—',
      outColor: b.outstandingKeur > 0 ? A300 : N400,
      cost: f(r.actual),
      marginText: d.canSeeMargin ? (r.marginPct != null ? `${r.marginPct}%` : '—') : MASK,
      marginColor: d.canSeeMargin && marginAlert(r.marginPct) ? LO : OK,
      next: b.next ? t(`${b.next.label} · ${f(b.next.amountKeur)}`) : '—',
      internal: b.internal,
    };
  });
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const bars = cashBars(d.forecast);
  return {
    kpis: [
      {
        label: t('Contract value'),
        value: f(sum(d.rows.map((r) => r.contractKeur))),
        sub: t(clientProjectsText(rolled.filter((x) => !x.b.internal).length, rolled.filter((x) => x.b.internal).length)),
        color: OK,
      },
      { label: t('Invoiced to date'), value: f(sum(rolled.map((x) => x.b.invoicedKeur))), sub: t('Milestones reached or monthly progress'), color: OK },
      { label: t('Outstanding receivables'), value: f(sum(rolled.map((x) => x.b.receivableKeur))), sub: t('Invoiced, not yet paid'), color: A300 },
      { label: t('Net cash · next 6 months'), value: f(netCash(d.forecast), true), sub: t('Billing plan minus forecast spend'), color: OK },
      // A-12: the low month and the payment it waits for are computed (the prototype printed "November — before M3 payment lands").
      { label: t('Lowest cumulative point'), value: f(lowestCumulative(d.forecast), true), sub: lowPointSubText(d.lowPoint, t, lang, +d.today.slice(0, 4)), color: LO },
    ],
    rows,
    bars: d.forecast.map((m, i) => ({
      label: t(m.label),
      inPct: bars[i].inPct,
      outPct: bars[i].outPct,
      net: netLabel(bars[i].netKeur),
      netColor: bars[i].netKeur < 0 ? LO : A300,
      inTitle: `${t('Cash in')} · ${f(m.cashInKeur)}`,
      outTitle: `${t('Cash out')} · ${f(m.cashOutKeur)}`,
    })),
    zoneEmpty: d.zoneSelected && d.rows.length === 0,
  };
}

/** Status tag class of a view row (for tests and plain renderers). */
export const tagClassOf = (tone: Tone) => TAG_CLASS[tone];
