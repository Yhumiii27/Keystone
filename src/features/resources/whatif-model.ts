// View model of What-if levelling (docs/spec/05 §4.4; prototype logic 4405–4419, template 1504–1528). Pure and
// client-safe: the board recomputes it on every optimistic lever toggle. Scenario arithmetic lives in
// src/domain/whatif.ts.
import { LO, OK } from '@/components/app/tones';
import { autoLevelSet, maxOverPeople, scenarioOutcome, WHATIF_PRIORITIES, type LeverEffect, type WhatIfBase, type WhatIfPriority } from '@/domain/whatif';
import { fmtDY, MINUS, MO, money } from '@/lib/format';
import type { Lang, T } from '@/i18n/translate';

export interface WhatIfLeverData extends LeverEffect {
  /** EN source label. */
  label: string;
}

export interface WhatIfScenarioState {
  /** "A". */
  name: string;
  priority: WhatIfPriority;
  /** Lever code → enabled. */
  levers: Record<string, boolean>;
  selected: boolean;
}

/** Serializable props of the what-if board (built by the page from the DAL). */
export interface WhatIfData {
  projectCode: string;
  levers: WhatIfLeverData[];
  /** AUTO: levers set by "Auto-level for this priority". */
  auto: Record<WhatIfPriority, string[]>;
  /** Window week labels, EN ("Sep 28"). */
  weeks: string[];
  base: WhatIfBase;
  /** Current baseline (code, ISO finish) — KPI sub "BL1 18 Dec 2026 · float −27 d". */
  baseline: { code: string; finish: string } | null;
  /** Peak weekly load of the pool, who and which week (ISO Monday). */
  peak: { pct: number; person: string; weekStart: string } | null;
  scenarios: WhatIfScenarioState[];
}

export const PRIORITY_LABEL: Record<WhatIfPriority, string> = { date: 'Protect date', budget: 'Protect budget', people: 'Protect people' };
export const PRIORITY_OPTIONS = WHATIF_PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABEL[v] }));

/** "People above 100%" sub: a constant of the prototype (00 OPEN QUESTION A-12), like Resources "Peak weeks 41–43". */
export const PEOPLE_ABOVE_SUB = 'Weeks 41–43';

/** ISO date → local Date (no time-zone shift for display). */
const dateOfIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** "14 Jan 2027" (EN; translate with t()). */
export const dayMonthYear = (iso: string) => fmtDY(dateOfIso(iso));
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v);
/** "+12 d" / "−27 d" through t() → FR "+12 j". */
const days = (v: number, t: T) => t(`${signed(v)} d`);

/**
 * "Scenario A" (FR "Scénario A"); new scenarios keep their own name after the word, unless the name already starts
 * with it ("Scenario C" stays "Scenario C", not "Scenario Scenario C").
 */
export const scenarioTitle = (name: string, t: T) => (/^sc[eé]nario\b/i.test(name) ? name : `${t('Scenario')} ${name}`);

/**
 * "Critical-path float" result: "+3 days" / "−7 days" (FR "−7 jours"). The prototype always wrote "days"; a float
 * of ±1 day (e.g. contractor + overtime + move: −1) reads "−1 day" here (FR "−1 jour").
 */
export const floatDaysText = (fl: number, t: T) => t(`${fl >= 0 ? '+' : MINUS}${Math.abs(fl)} ${Math.abs(fl) === 1 ? 'day' : 'days'}`);

/**
 * Lever effect text: "+12 d · +€18k · peak −20 pts". The prototype used a hyphen-minus for negatives and started
 * with "· " when the float is 0 ("· peak -15 pts"); here the parts are joined and negatives use U+2212.
 */
export function leverEffectText(l: LeverEffect, t: T, lang: Lang): string {
  const parts: string[] = [];
  if (l.floatDays) parts.push(days(l.floatDays, t));
  if (l.costKeur) parts.push(money(l.costKeur, lang, { signed: true }));
  if (l.peakPts) parts.push(`${t('peak')} ${signed(l.peakPts)} pts`);
  return parts.join(' · ');
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ScenarioResultView {
  key: string;
  value: string;
  color: string;
}

export interface ScenarioCardView {
  name: string;
  title: string;
  priority: WhatIfPriority;
  selected: boolean;
  levers: { code: string; label: string; on: boolean; effect: string }[];
  bars: { label: string; height: string; bg: string }[];
  results: ScenarioResultView[];
}

export interface WhatIfView {
  kpis: KpiView[];
  scenarios: ScenarioCardView[];
  /** "Side by side": one row per result key, one value per scenario. */
  compare: { key: string; values: { value: string; color: string }[] }[];
}

const BAR_BG = { over: 'var(--color-accent-400)', stretched: 'var(--color-accent-600)', normal: 'var(--color-neutral-700)' } as const;

export function whatIfKpis(d: Pick<WhatIfData, 'base' | 'baseline' | 'peak' | 'scenarios'>, t: T): KpiView[] {
  const fin = d.base.forecastFinish;
  const peak = d.peak;
  const weekOf = peak ? dateOfIso(peak.weekStart) : null;
  return [
    {
      // The prototype labels this tile "Baseline finish" while it shows the forecast (00 §7.16, 05 OQ12).
      label: t('Forecast finish'),
      value: fin ? t(dayMonthYear(fin)) : '—',
      sub: d.baseline ? `${d.baseline.code} ${t(dayMonthYear(d.baseline.finish))} · ${t('float')} ${days(d.base.floatDays, t)}` : `${t('float')} ${days(d.base.floatDays, t)}`,
      color: d.base.floatDays < 0 ? LO : OK,
    },
    {
      label: t('Peak load'),
      value: peak ? `${peak.pct}%` : '—',
      sub: peak && weekOf ? t(`${peak.person} · week of ${weekOf.getDate()} ${MO[weekOf.getMonth()]}`) : '',
      color: peak && peak.pct > 100 ? LO : OK,
    },
    { label: t('People above 100%'), value: String(d.base.overPeople), sub: t(PEOPLE_ABOVE_SUB), color: d.base.overPeople > 0 ? LO : OK },
    { label: t('Scenarios'), value: String(d.scenarios.length), sub: t('Compared side by side · PM sets the priority'), color: OK },
  ];
}

export function scenarioCard(d: Pick<WhatIfData, 'base' | 'levers' | 'weeks'>, s: WhatIfScenarioState, t: T, lang: Lang): ScenarioCardView {
  const o = scenarioOutcome(d.base, d.levers, s.levers);
  const fl = o.floatDays;
  return {
    name: s.name,
    title: scenarioTitle(s.name, t),
    priority: s.priority,
    selected: s.selected,
    levers: d.levers.map((l) => ({ code: l.code, label: t(l.label), on: !!s.levers[l.code], effect: leverEffectText(l, t, lang) })),
    bars: o.bars.map((b, i) => ({ label: (d.weeks[i] ?? '').split(' ')[1] ?? '', height: `${b.height}%`, bg: BAR_BG[b.band] })),
    results: [
      { key: t('Forecast finish'), value: o.finish ? t(dayMonthYear(o.finish)) : '—', color: o.finishOk ? OK : LO },
      { key: t('Critical-path float'), value: floatDaysText(fl, t), color: fl < 0 ? LO : OK },
      { key: t('Cost impact (EAC)'), value: o.sum.costKeur ? money(o.sum.costKeur, lang, { signed: true }) : '—', color: o.costAlert ? LO : OK },
      { key: t('Peak load'), value: `${o.peakPct}%`, color: o.peakAlert ? LO : OK },
      { key: t('People above 100%'), value: String(o.overPeople), color: o.overPeople ? LO : OK },
      { key: t('Side effects'), value: o.sum.sideEffects.map(t).join(' · ') || t('None'), color: 'var(--color-neutral-300)' },
    ],
  };
}

export function whatIfView(d: WhatIfData, t: T, lang: Lang): WhatIfView {
  const scenarios = d.scenarios.map((s) => scenarioCard(d, s, t, lang));
  return {
    kpis: whatIfKpis(d, t),
    scenarios,
    compare: (scenarios[0]?.results ?? []).map((r, i) => ({ key: r.key, values: scenarios.map((s) => ({ value: s.results[i].value, color: s.results[i].color })) })),
  };
}

/** Base figures of the formulas from the DAL (`getWhatIf`): float, forecast finish, pool peak and people above 100 %. */
export function whatIfBase(w: { floatDays: number | null; forecastFinish: string | null; peak: { pct: number } | null; overByWeek: number[]; baseLoad: number[] }): WhatIfBase {
  return { floatDays: w.floatDays ?? 0, forecastFinish: w.forecastFinish, peakPct: w.peak?.pct ?? 0, overPeople: maxOverPeople(w.overByWeek), baseLoad: w.baseLoad };
}

/** Optimistic edits of the board (mirrors the Server Functions in actions.ts). */
export type WhatIfAction =
  | { type: 'priority'; name: string; priority: WhatIfPriority }
  | { type: 'toggle'; name: string; lever: string }
  | { type: 'auto'; name: string }
  | { type: 'select'; name: string };

export function reduceScenarios(
  state: WhatIfScenarioState[],
  a: WhatIfAction,
  d: Pick<WhatIfData, 'levers' | 'auto'>,
): WhatIfScenarioState[] {
  if (a.type === 'select') return state.map((s) => ({ ...s, selected: s.name === a.name }));
  return state.map((s) => {
    if (s.name !== a.name) return s;
    if (a.type === 'priority') return { ...s, priority: a.priority };
    if (a.type === 'toggle') return { ...s, levers: { ...s.levers, [a.lever]: !s.levers[a.lever] } };
    return { ...s, levers: autoLevelSet(d.levers, d.auto[s.priority] ?? []) };
  });
}
