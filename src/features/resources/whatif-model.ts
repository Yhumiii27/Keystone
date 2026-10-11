// View model of What-if levelling (chapter 4, S-7; docs/spec/05 §4.4, template 1504–1528). Pure and client-safe: the board
// recomputes it on every optimistic edit. The levers and their effects come from the DAL (src/server/dal/resources.ts →
// domain/whatif.ts: levers derived from the data, effects computed by the CPM engine on a copy of the plan); this module
// only formats them. Dynamic sentences are built per language (the shared FR rules do not cover them).
import { LO, OK } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  leverSetKey, WHATIF_PRIORITIES, WHATIF_RULES, type WhatIfHelperKind, type WhatIfLever, type WhatIfLeverKind, type WhatIfPriority, type WhatIfResult, type WhatIfSideEffect,
} from '@/domain/whatif';
import { weekRangesText } from '@/domain/resources';
import { FR_MONTHS } from '@/i18n/fr-rules';
import { fmtDY, MINUS, MO, money } from '@/lib/format';
import { isoWeekOf } from '@/server/db/codes';
import type { Lang, T } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';

/** What-if levelling of a project: `/resources/what-if?project=HLT-026` (scenarios are per project). */
export const whatIfHref = (code: string) => `${screenHref('whatif')}?project=${encodeURIComponent(code)}`;

/** A lever as the board needs it (serializable). */
export interface WhatIfLeverData {
  code: string;
  kind: WhatIfLeverKind;
  activity: string;
  /** EN source name. */
  activityName: string;
  resource: string | null;
  person: string | null;
  from: number;
  to: number;
  helper: { kind: WhatIfHelperKind; name: string } | null;
  driving: boolean;
  /** The lever alone vs the current plan. */
  effect: WhatIfResult;
}

/** Domain lever → board data (drops the helper's rate: rates stay on the server). */
export const leverData = (l: WhatIfLever, effect: WhatIfResult): WhatIfLeverData => ({
  code: l.code, kind: l.kind, activity: l.activity, activityName: l.activityName, resource: l.resource, person: l.person, from: l.from, to: l.to,
  helper: l.helper ? { kind: l.helper.kind, name: l.helper.name } : null, driving: l.driving, effect,
});

export interface WhatIfScenarioState {
  /** "A". */
  name: string;
  priority: WhatIfPriority;
  /** Lever code → enabled. */
  levers: Record<string, boolean>;
  selected: boolean;
  /** "Apply" / "Select scenario" drafted requests from it. */
  applied: boolean;
  requests: { draft: number; sent: number };
  hypotheses: string | null;
}

/** Serializable props of the what-if board (built by the page from the DAL). */
export interface WhatIfData {
  projectCode: string;
  /** Data date of the copy of the plan (ISO). */
  dataDate: string;
  /** Window week labels, EN ("Sep 28"), and their ISO Mondays. */
  weeks: string[];
  weekStarts: string[];
  levers: WhatIfLeverData[];
  /** "Auto-level for this priority": lever codes per priority (derived). */
  auto: Record<WhatIfPriority, string[]>;
  /** The current plan recalculated (no lever). */
  current: WhatIfResult;
  /** Results by lever-set key: the scenarios, one toggle away from each, the auto-level sets. */
  results: Record<string, WhatIfResult>;
  /** Stored plan figures (Schedule): forecast finish (ISO) and float (days). */
  plan: { forecastFinish: string | null; floatDays: number | null };
  /** Displayed baseline (code, ISO finish). */
  baseline: { code: string; finish: string } | null;
  /** Peak weekly load of the team, who and which week (ISO Monday). */
  peak: { pct: number; person: string; weekStart: string } | null;
  /** People above 100 % per window week. */
  overByWeek: number[];
  scenarios: WhatIfScenarioState[];
  /** EN source text when the plan cannot be scheduled. */
  error: string | null;
}

export const PRIORITY_LABEL: Record<WhatIfPriority, string> = { date: 'Protect date', budget: 'Protect budget', people: 'Protect people' };
export const PRIORITY_OPTIONS = WHATIF_PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABEL[v] }));

/** ISO date → local Date (no time-zone shift for display). */
const dateOfIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** "14 Jan 2027" (EN; translate with t()). */
export const dayMonthYear = (iso: string) => fmtDY(dateOfIso(iso));
/** "12 Oct" / "12 oct.". */
const dayMonth = (iso: string, lang: Lang) => {
  const d = dateOfIso(iso);
  return `${d.getDate()} ${lang === 'fr' ? FR_MONTHS[MO[d.getMonth()]] : MO[d.getMonth()]}`;
};
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v);
/** "+12 d" / "−27 d" through t() → FR "+12 j". */
const days = (v: number, t: T) => t(`${signed(v)} d`);

/**
 * "Scenario A" (FR "Scénario A"); new scenarios keep their own name after the word, unless the name already starts
 * with it ("Scenario C" stays "Scenario C", not "Scenario Scenario C").
 */
export const scenarioTitle = (name: string, t: T) => (/^sc[eé]nario\b/i.test(name) ? name : `${t('Scenario')} ${name}`);

/** "Critical-path float": "+3 days" / "−7 days" (FR "−7 jours"); ±1 is singular ("−1 day", FR "−1 jour"). */
export const floatDaysText = (fl: number, t: T) => t(`${fl >= 0 ? '+' : MINUS}${Math.abs(fl)} ${Math.abs(fl) === 1 ? 'day' : 'days'}`);

/** Cost impact: "+€5k" / "+5 k€"; below 0.5 k€ "+<€1k" / "+< 1 k€"; 0 → "—". */
export function costText(k: number, lang: Lang): string {
  if (!k) return '—';
  if (Math.abs(k) >= 0.5) return money(k, lang, { signed: true });
  return `${k > 0 ? '+' : MINUS}${lang === 'fr' ? '< 1 k€' : '<€1k'}`;
}

/** Lever row label, e.g. "Overtime A1250 · Steel erection crew 10 → 12 h/d" (FR "Heures sup. A1250 · … h/j"). */
export function leverText(l: Pick<WhatIfLeverData, 'kind' | 'activity' | 'resource' | 'person' | 'from' | 'to' | 'helper' | 'driving'>, t: T, lang: Lang): string {
  const fr = lang === 'fr';
  if (l.kind === 'overtime') return fr ? `Heures sup. ${l.activity} · ${l.resource} ${l.from} → ${l.to} h/j` : `Overtime ${l.activity} · ${l.resource} ${l.from} → ${l.to} h/d`;
  if (l.kind === 'shift') return fr ? `Décaler ${l.activity} de ${l.to} j · libère ${l.person}` : `Shift ${l.activity} by ${l.to} d · frees ${l.person}`;
  const h = l.helper;
  if (!h || h.kind === 'same') return fr ? `Ressource supplémentaire ${l.activity} · ${l.resource} ${l.from} → ${l.to}` : `Extra resource ${l.activity} · ${l.resource} ${l.from} → ${l.to}`;
  const who = h.kind === 'external' ? t(h.name) : h.name;
  if (l.driving) return fr ? `${who} rejoint ${l.person} sur ${l.activity}` : `${who} joins ${l.person} on ${l.activity}`;
  return fr ? `${who} soulage ${l.person} sur ${l.activity}` : `${who} relieves ${l.person} on ${l.activity}`;
}

/**
 * Lever effect, the lever alone vs the current plan: "+1 d · +€5k · peak +5 pts" (days gained on the finish, cost,
 * change of the peak load); a lever that moves neither the finish nor the peak also shows the team hours it frees
 * ("+€1k · load −40 h").
 */
export function leverEffectText(e: WhatIfResult, current: Pick<WhatIfResult, 'peakPct'>, t: T, lang: Lang): string {
  const parts: string[] = [];
  if (e.daysGained) parts.push(days(e.daysGained, t));
  if (e.costKeur) parts.push(costText(e.costKeur, lang));
  const peak = e.peakPct - current.peakPct;
  if (peak) parts.push(`${lang === 'fr' ? 'pointe' : 'peak'} ${signed(peak)} pts`);
  if (!e.daysGained && !peak && Math.round(e.loadDeltaH)) parts.push(`${lang === 'fr' ? 'charge' : 'load'} ${signed(Math.round(e.loadDeltaH))} h`);
  return parts.join(' · ') || (lang === 'fr' ? 'sans effet' : 'no effect');
}

/** Side effect of a scenario ("Pauline Noguès above 100% · week of 12 Oct", "A1520 becomes critical"). */
export function sideEffectText(s: WhatIfSideEffect, lang: Lang): string {
  const fr = lang === 'fr';
  if (s.kind === 'overload') return fr ? `${s.person} au-dessus de 100 % · semaine du ${dayMonth(s.weekStart, lang)}` : `${s.person} above 100% · week of ${dayMonth(s.weekStart, lang)}`;
  if (s.kind === 'critical') return fr ? `${s.activity} devient critique` : `${s.activity} becomes critical`;
  return fr ? `${s.activity} ne tient plus sa contrainte ${s.constraint}` : `${s.activity} misses its ${s.constraint}`;
}

/** ISO weeks where the most people are above 100 % ("Week 43", "Weeks 42–43"); none → "No week above 100%". */
export function overWeeksText(overByWeek: number[], weekStarts: string[], lang: Lang): string {
  const max = Math.max(0, ...overByWeek);
  if (!max) return lang === 'fr' ? 'Aucune semaine au-dessus de 100 %' : 'No week above 100%';
  const weeks = overByWeek.flatMap((n, i) => (n === max && weekStarts[i] ? [isoWeekOf(weekStarts[i])] : []));
  const range = weekRangesText(weeks);
  if (lang === 'fr') return `${weeks.length === 1 ? 'Semaine' : 'Semaines'} ${range}`;
  return `${weeks.length === 1 ? 'Week' : 'Weeks'} ${range}`;
}

/** Note under the side-by-side table: effects are computed on a copy of the plan at its data date. */
export function copyNote(dataDate: string, lang: Lang): string {
  const d = `${dayMonth(dataDate, lang)} ${dataDate.slice(0, 4)}`;
  return lang === 'fr'
    ? `Effets calculés par le moteur CPM sur une copie du plan à la date d’état (${d}) : le plan ne change qu’au prochain recalcul. Les demandes créées restent en brouillon jusqu’à leur envoi depuis Demandes de ressources.`
    : `Effects are computed by the CPM engine on a copy of the plan at the data date (${d}): the plan itself changes only at the next Reschedule. Requests are created as drafts until you send them from Resource requests.`;
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
  applied: boolean;
  /** "2 draft requests · 1 sent" (tooltip of the Applied tag). */
  appliedText: string;
  hypotheses: string | null;
  /** The results are those of the last saved lever set (an optimistic edit has no computed result yet). */
  pending: boolean;
  levers: { code: string; label: string; title: string; on: boolean; effect: string }[];
  bars: { label: string; height: string; bg: string }[];
  results: ScenarioResultView[];
}

export interface WhatIfView {
  kpis: KpiView[];
  scenarios: ScenarioCardView[];
  /** "Side by side": one column per scenario after "Current plan", one row per result key. */
  columns: string[];
  compare: { key: string; values: { value: string; color: string }[] }[];
  note: string;
}

const BAR_BG = { over: 'var(--color-accent-400)', stretched: 'var(--color-accent-600)', normal: 'var(--color-neutral-700)' } as const;
const band = (v: number) => (v > WHATIF_RULES.peakAlertPct ? 'over' : v > WHATIF_RULES.stretchedPct ? 'stretched' : 'normal');

export function whatIfKpis(d: Pick<WhatIfData, 'plan' | 'baseline' | 'peak' | 'overByWeek' | 'weekStarts' | 'scenarios'>, t: T, lang: Lang): KpiView[] {
  const fc = d.plan.forecastFinish ? t(dayMonthYear(d.plan.forecastFinish)) : '—';
  const fl = d.plan.floatDays;
  const fr = lang === 'fr';
  const subParts = [
    d.baseline?.code,
    `${fr ? 'prévision' : 'forecast'} ${fc}`,
    fl != null ? `${t('float')} ${days(fl, t)}` : null,
  ].filter(Boolean);
  const peak = d.peak;
  const weekOf = peak ? dateOfIso(peak.weekStart) : null;
  const over = Math.max(0, ...d.overByWeek);
  return [
    {
      // S-7: the tile shows the displayed baseline's finish (the prototype labelled the forecast "Baseline finish").
      label: t('Baseline finish'),
      value: d.baseline ? t(dayMonthYear(d.baseline.finish)) : '—',
      sub: subParts.join(' · '),
      color: (fl ?? 0) < 0 ? LO : OK,
    },
    {
      label: t('Peak load'),
      value: peak ? `${peak.pct}%` : '—',
      sub: peak && weekOf ? t(`${peak.person} · week of ${weekOf.getDate()} ${MO[weekOf.getMonth()]}`) : '',
      color: peak && peak.pct > 100 ? LO : OK,
    },
    { label: t('People above 100%'), value: String(over), sub: overWeeksText(d.overByWeek, d.weekStarts, lang), color: over > 0 ? LO : OK },
    { label: t('Scenarios'), value: String(d.scenarios.length), sub: t('Compared side by side · PM sets the priority'), color: OK },
  ];
}

/**
 * "Load change (h)": team hours over the horizon vs the current plan (`loadDeltaH`, rounded; "+16" / "−40", 0 → "0"). A
 * relief or a shorter activity frees hours (negative), an added colleague takes some on.
 */
export const loadChangeText = (h: number) => signed(Math.round(h)) || '0';

/**
 * The result rows of a lever set (scenario card and side-by-side column): the prototype's six plus "Load change (h)"
 * (chapter 4, S-7 — recommended option of DELIVERY-6-PLAN §3.3).
 */
export function resultRows(r: WhatIfResult, t: T, lang: Lang): ScenarioResultView[] {
  const fl = r.floatDays;
  const R = WHATIF_RULES;
  return [
    { key: t('Forecast finish'), value: r.finish ? t(dayMonthYear(r.finish)) : '—', color: fl != null && fl >= 0 ? OK : LO },
    { key: t('Critical-path float'), value: fl != null ? floatDaysText(fl, t) : '—', color: fl != null && fl < 0 ? LO : OK },
    { key: t('Cost impact (EAC)'), value: costText(r.costKeur, lang), color: r.costKeur > R.costAlertKeur ? LO : OK },
    { key: t('Peak load'), value: `${r.peakPct}%`, color: r.peakPct > R.peakAlertPct ? LO : OK },
    { key: t('People above 100%'), value: String(r.overPeople), color: r.overPeople ? LO : OK },
    { key: t('Load change (h)'), value: loadChangeText(r.loadDeltaH), color: 'var(--color-neutral-300)' },
    { key: t('Side effects'), value: r.sideEffects.map((s) => sideEffectText(s, lang)).join(' · ') || t('None'), color: 'var(--color-neutral-300)' },
  ];
}

const enabledCodes = (levers: Record<string, boolean>) => Object.keys(levers).filter((k) => levers[k]);

/** Result of a scenario state: the computed one for its lever set, else (optimistic edit not computed) the saved one. */
export function resultOf(d: Pick<WhatIfData, 'results' | 'current'>, s: Pick<WhatIfScenarioState, 'levers'>, fallback?: WhatIfResult): { result: WhatIfResult; pending: boolean } {
  const hit = d.results[leverSetKey(enabledCodes(s.levers))];
  return hit ? { result: hit, pending: false } : { result: fallback ?? d.current, pending: true };
}

export function scenarioCard(d: WhatIfData, s: WhatIfScenarioState, t: T, lang: Lang, saved?: WhatIfScenarioState): ScenarioCardView {
  const { result: o, pending } = resultOf(d, s, saved ? resultOf(d, saved).result : undefined);
  const fr = lang === 'fr';
  return {
    name: s.name,
    title: scenarioTitle(s.name, t),
    priority: s.priority,
    selected: s.selected,
    applied: s.applied,
    appliedText: fr
      ? `${s.requests.draft} demande(s) en brouillon · ${s.requests.sent} envoyée(s)`
      : `${s.requests.draft} draft ${s.requests.draft === 1 ? 'request' : 'requests'} · ${s.requests.sent} sent`,
    hypotheses: s.hypotheses,
    pending,
    levers: d.levers.map((l) => ({
      code: l.code, label: leverText(l, t, lang), title: `${l.activity} · ${dataText(l.activityName, lang)}`, on: !!s.levers[l.code], effect: leverEffectText(l.effect, d.current, t, lang),
    })),
    bars: o.bars.map((v, i) => ({ label: (d.weeks[i] ?? '').split(' ')[1] ?? '', height: `${Math.round(Math.min(100, (v / WHATIF_RULES.barFullPct) * 100) * 10) / 10}%`, bg: BAR_BG[band(v)] })),
    results: resultRows(o, t, lang),
  };
}

export function whatIfView(d: WhatIfData, t: T, lang: Lang, saved: WhatIfScenarioState[] = d.scenarios): WhatIfView {
  const scenarios = d.scenarios.map((s) => scenarioCard(d, s, t, lang, saved.find((x) => x.name === s.name)));
  const current = resultRows(d.current, t, lang);
  return {
    kpis: whatIfKpis(d, t, lang),
    scenarios,
    columns: [t('Current plan'), ...scenarios.map((s) => s.title)],
    compare: current.map((r, i) => ({ key: r.key, values: [{ value: r.value, color: r.color }, ...scenarios.map((s) => ({ value: s.results[i].value, color: s.results[i].color }))] })),
    note: copyNote(d.dataDate, lang),
  };
}

/** Optimistic edits of the board (mirrors the Server Functions in actions.ts). */
export type WhatIfAction =
  | { type: 'priority'; name: string; priority: WhatIfPriority }
  | { type: 'toggle'; name: string; lever: string }
  | { type: 'auto'; name: string }
  | { type: 'select'; name: string };

export function reduceScenarios(state: WhatIfScenarioState[], a: WhatIfAction, d: Pick<WhatIfData, 'levers' | 'auto'>): WhatIfScenarioState[] {
  if (a.type === 'select') return state.map((s) => ({ ...s, selected: s.name === a.name }));
  return state.map((s) => {
    if (s.name !== a.name) return s;
    if (a.type === 'priority') return { ...s, priority: a.priority };
    if (a.type === 'toggle') return { ...s, levers: { ...s.levers, [a.lever]: !s.levers[a.lever] } };
    const auto = d.auto[s.priority] ?? [];
    return { ...s, levers: Object.fromEntries(d.levers.map((l) => [l.code, auto.includes(l.code)])) };
  });
}

/** Toast of "Select scenario → create requests" (drafts created, already requested, shifts to enter in the plan). */
export function applyMessage(o: { created: string[]; skipped: number; shifts: number }, title: string, lang: Lang): string {
  const fr = lang === 'fr';
  const n = o.created.length;
  const parts = [fr ? `${title} retenu` : `${title} selected`];
  if (n) parts.push(fr ? `${n} demande(s) créée(s) en brouillon (${o.created.join(', ')}) — à envoyer depuis Demandes de ressources` : `${n} draft ${n === 1 ? 'request' : 'requests'} created (${o.created.join(', ')}) — send ${n === 1 ? 'it' : 'them'} from Resource requests`);
  else if (o.skipped) parts.push(fr ? 'ses demandes existent déjà' : 'its requests already exist');
  else if (!o.shifts) parts.push(fr ? 'aucun levier ne demande de ressource' : 'no lever needs a resource request');
  if (o.shifts) parts.push(fr ? `${o.shifts} décalage(s) à saisir dans le plan avant le prochain recalcul` : `${o.shifts} ${o.shifts === 1 ? 'shift' : 'shifts'} to enter in the plan before the next Reschedule`);
  return parts.join(' · ');
}

/** Toast of "Apply" on a suggested rebalancing line. */
export function suggestionMessage(number: string | null, lang: Lang): string {
  if (!number) return lang === 'fr' ? 'Ce levier est déjà demandé' : 'This lever is already requested';
  return lang === 'fr' ? `Demande ${number} créée en brouillon — à envoyer depuis Demandes de ressources` : `Draft request ${number} created — send it from Resource requests`;
}
