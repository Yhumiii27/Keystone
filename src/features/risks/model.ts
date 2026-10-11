// View models of the Risk register (docs/spec/07 §2.1, template 1771–1832) and the Contingency register
// (docs/spec/04 §5, template 900–909): the domain figures (src/domain/risk.ts, contingency.ts) turned into the
// translated strings, tag classes and links the server components render. Pure (no I/O): `t` and `lang` come
// from the page.
import { LO, OK, TAG_CLASS } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import { contingencySummary, drawCountText, drawRows } from '@/domain/contingency';
import {
  costIfOccurs, levelLabel, levelOf, levelTagText, levelTone, registerRows, riskChips, riskKpis, riskMatrix, scoreOf, statusTone, toggleOf,
  type RiskCategory, type RiskLevel, type RiskResponse, type RiskStatus, type RiskTrend,
} from '@/domain/risk';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { Contingency } from '@/server/dal/contingency';
import type { RiskRow } from '@/server/dal/risks';
import { dataText } from '@/i18n/data-text';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

// ── Risk register ──────────────────────────────────────────────────────────────────────────────────────

/** URL of the register with its state (`?filter=` category code, `?risk=` open drawer). */
export function risksHref(code: string, q: { filter?: RiskCategory | null; risk?: string | null } = {}): string {
  const u = new URLSearchParams();
  if (q.filter) u.set('filter', q.filter);
  if (q.risk) u.set('risk', q.risk);
  const qs = u.toString();
  const base = screenHref('risks', { code });
  return qs ? `${base}?${qs}` : base;
}

export interface RiskRowView {
  id: string;
  title: string;
  category: string;
  p: number;
  i: number;
  score: number;
  level: string;
  levelClass: string;
  response: string;
  owner: string;
  emvText: string;
  actText: string;
  trend: RiskTrend;
  status: string;
  statusClass: string;
  /** The open (drawer) row: id in accent-300. */
  selected: boolean;
  /** Row click toggles the drawer (`select()`: the same id again closes it). */
  href: string;
}

export interface ChipView {
  value: string;
  label: string;
  count: number;
  href: string;
}

export interface MatrixRowView {
  i: number;
  cells: { p: number; level: RiskLevel; ids: string }[];
}

export interface RiskDrawerView {
  id: string;
  /** "R-03 · Supplier / delivery" (translated). */
  head: string;
  levelText: string;
  levelClass: string;
  title: string;
  probability: number;
  impact: number;
  response: RiskResponse;
  status: RiskStatus;
  plan: string;
  meta: { k: string; v: string }[];
  /** Plan with the activity drawer open (`?act=`); null without a linked activity. */
  activityHref: string | null;
  whatifHref: string;
  closeHref: string;
  toggleLabel: string;
  toggleNext: RiskStatus;
}

export interface RiskRegisterView {
  kpis: KpiView[];
  filter: RiskCategory | null;
  chips: ChipView[];
  rows: RiskRowView[];
  /** Inline empty text under the table, or null when rows are shown. */
  empty: string | null;
  matrix: MatrixRowView[];
  drawer: RiskDrawerView | null;
}

export interface RiskRegisterInput {
  code: string;
  risks: RiskRow[];
  /** Contingency the exposure is compared with (PD.recon.cont), k€. */
  contingency: number;
  filter: RiskCategory | null;
  /** `?risk=` value. */
  selected: string | null;
}

const activityText = (r: RiskRow, lang: Lang) => (r.activity ? `${r.activity.code} · ${dataText(r.activity.name, lang)}` : '—');
const emvText = (k: number, lang: Lang) => (k ? money(k, lang) : '—');

export function riskRegisterView(input: RiskRegisterInput, t: T, lang: Lang): RiskRegisterView {
  const { code, risks, contingency, filter } = input;
  const selected = input.selected ? (risks.find((r) => r.id === input.selected!.toUpperCase()) ?? null) : null;
  const k = riskKpis(risks, contingency);
  const kpis: KpiView[] = [
    { label: t('Open risks'), value: String(k.open), sub: t(`${k.closed} closed`), color: OK },
    { label: t('Critical / high'), value: String(k.criticalHigh), sub: t('Score ≥ 8 on 5×5'), color: k.criticalHigh > 0 ? LO : OK },
    {
      label: t('Exposure (EMV)'),
      value: money(k.exposure, lang),
      sub: t(`${k.exposurePct}% of contingency ${money(contingency, lang)}`),
      color: k.exposureAlert ? LO : OK,
    },
    { label: t('On critical path'), value: String(k.onCriticalPath), sub: t('Risks tied to critical activities'), color: OK },
    { label: t('Trending up'), value: String(k.trendingUp), sub: t('Since last review'), color: k.trendingUp > 0 ? LO : OK },
  ];

  const chips: ChipView[] = riskChips(risks).map((c) => ({
    value: c.value ?? 'all',
    label: t(c.label),
    count: c.count,
    href: risksHref(code, { filter: c.value }),
  }));

  const rows: RiskRowView[] = registerRows(risks, filter).map((r) => {
    const score = scoreOf(r);
    const level = levelOf(score);
    const isSel = selected?.id === r.id;
    return {
      id: r.id, title: dataText(r.title, lang), category: t(r.categoryLabel), p: r.probability, i: r.impact, score,
      level: t(levelLabel(level)), levelClass: TAG_CLASS[levelTone(level)], response: t(r.responseLabel), owner: r.owner ?? '—',
      emvText: emvText(r.emv, lang), actText: activityText(r, lang), trend: r.trend,
      status: t(r.statusLabel), statusClass: TAG_CLASS[statusTone(r.status)], selected: isSel,
      href: risksHref(code, { filter, risk: isSel ? null : r.id }),
    };
  });

  const matrix: MatrixRowView[] = riskMatrix(risks).map((row) => ({
    i: row.i,
    cells: row.cells.map((c) => ({ p: c.p, level: levelOf(c.score), ids: c.ids.join(' ') })),
  }));

  let drawer: RiskDrawerView | null = null;
  if (selected) {
    const r = selected;
    const level = levelOf(scoreOf(r));
    const tog = toggleOf(r.status);
    const cost = costIfOccurs(r.emv, r.probability);
    drawer = {
      id: r.id,
      head: `${r.id} · ${t(r.categoryLabel)}`,
      levelText: levelTagText(r).split(' · ').map(t).join(' · '),
      levelClass: TAG_CLASS[levelTone(level)],
      title: dataText(r.title, lang),
      probability: r.probability,
      impact: r.impact,
      response: r.response,
      status: r.status,
      plan: t(r.plan),
      meta: [
        { k: t('Owner'), v: r.owner ?? '—' },
        { k: t('Trigger'), v: t(r.trigger) },
        { k: t('Linked activity'), v: activityText(r, lang) },
        { k: t('EMV (P × cost impact)'), v: emvText(r.emv, lang) },
        { k: t('Contingency draw if it occurs'), v: cost != null ? money(cost, lang) : '—' },
      ],
      activityHref: r.activity ? `${screenHref('plan', { code })}?act=${encodeURIComponent(r.activity.code)}` : null,
      // What-if levelling of THIS project (`?project=`); the prototype's what-if is always Harbor Line's (00 §7.16).
      whatifHref: `${screenHref('whatif')}?project=${encodeURIComponent(code)}`,
      closeHref: risksHref(code, { filter }),
      toggleLabel: t(tog.label),
      toggleNext: tog.next,
    };
  }

  return {
    kpis,
    filter,
    chips,
    rows,
    empty: rows.length ? null : t(risks.length ? 'No risk in this category' : 'No risk registered for this project'),
    matrix,
    drawer,
  };
}

// ── Contingency register ───────────────────────────────────────────────────────────────────────────────

export interface DrawRowView {
  date: string;
  amount: string;
  reason: string;
  link: string;
  by: string;
}

export interface ContingencyView {
  kpis: KpiView[];
  usedPct: string;
  progPct: string;
  /** Bar widths ("32%"). */
  barUsed: string;
  barExposure: string;
  barProgress: string;
  rows: DrawRowView[];
}

export function contingencyView(c: Contingency, t: T, lang: Lang): ContingencyView {
  const s = contingencySummary({ initial: c.initial, draws: c.draws, exposure: c.exposure, progress: c.progress, bac: c.bac });
  const f = (k: number) => money(k, lang);
  return {
    kpis: [
      { label: t('Initial provision'), value: f(s.initial), sub: t(`${s.initialPctOfBudget} % of budget`), color: 'var(--color-neutral-200)' },
      { label: t('Drawn'), value: f(s.drawn), sub: t(`${s.usedPct} % used · project ${s.progPct} % complete`), color: s.drawnAlert ? LO : OK },
      { label: t('Remaining'), value: f(s.remaining), sub: t(drawCountText(s.drawCount)), color: OK },
      {
        label: t('Exposure (open risks EMV)'),
        value: f(s.exposure),
        sub: t(s.exposureExceeds ? 'exceeds remaining provision' : 'covered by remaining provision'),
        color: s.exposureExceeds ? LO : OK,
      },
    ],
    usedPct: t(`${s.usedPct} %`),
    progPct: t(`${s.progPct} %`),
    barUsed: `${s.barUsed}%`,
    barExposure: `${s.barExposure}%`,
    barProgress: `${s.barProgress}%`,
    rows: drawRows(c.draws).map((d) => ({
      date: t(d.dateText),
      amount: f(d.amount),
      reason: dataText(d.reason, lang),
      link: d.linkRef || '—',
      by: d.approvedBy ?? '—',
    })),
  };
}
