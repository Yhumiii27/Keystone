// View model of Resources (portfolio pool) and Project resources (docs/spec/06 §1.4; prototype logic 3866–3886,
// template 573–637). Pure: takes the DAL data and the translator, returns the strings and colours the template
// renders. Load / capacity rules live in src/domain/resources.ts. Chapter 4 (A-12, R-3): "Unmet demand", the peak weeks
// and the suggested rebalancing are computed from the data (the suggestions are what-if levers, src/domain/whatif.ts).
import { LO, OK, shade } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  capacityBar, laborShare, overAllocatedCount, peakWeeksText, personLoad, projectDepartmentDemand, shortfallText, teamUtilization, unmetDemand, type CapacityRow,
} from '@/domain/resources';
import type { WhatIfResult } from '@/domain/whatif';
import { FR_MONTHS } from '@/i18n/fr-rules';
import { money } from '@/lib/format';
import type { Lang, T } from '@/i18n/translate';
import { leverEffectText, leverText, type WhatIfLeverData } from './whatif-model';
import { dataText } from '@/i18n/data-text';

/** Moved to src/domain/resources.ts (shared with the department head's Home). */
export { peakWeeksText, shortfallText };

export interface ResourcePerson {
  /** Full name ("Julien Wagner"). */
  name: string;
  initials: string;
  /** EN source job title ("Structural engineer"). */
  jobTitle: string | null;
  /** EN source department name. */
  department: string | null;
  /** % of available hours per window week. */
  loads: number[];
}

export interface ResourcesInput {
  /** `resources` (whole pool) or `presources` (team of one project). */
  scope: 'portfolio' | 'project';
  /** Window week labels, EN ("Sep 28"). */
  weeks: string[];
  /** ISO Mondays of the window weeks (peak week numbers). */
  weekStarts: string[];
  /** Pool order (PEOPLE order); for a project, only its team members. */
  people: ResourcePerson[];
  /** Portfolio: department capacity vs demand over the window (ROLES order). Ignored for a project (derived from the team). */
  departments: CapacityRow[];
  /** Labour cost category of the current project (first /labor|staff/i category), null when none. */
  labor: { budget: number; actual: number } | null;
  /** Pending resource requests (all projects, or the project's). */
  openRequests: number;
  /**
   * "Suggested rebalancing" (R-3): what-if levers that become a resource request, ranked (the portfolio's on Resources, the
   * project's on Project resources); null hides the card.
   */
  suggestions: SuggestionInput[] | null;
}

export interface SuggestionInput {
  projectCode: string;
  /** EN source short name of the project ("Harbor Line"), shown on the portfolio screen. */
  projectLabel: string | null;
  lever: Omit<WhatIfLeverData, 'effect'>;
  effect: WhatIfResult;
  /** Peak load of the project's current plan (effect "peak ±n pts"). */
  currentPeakPct: number;
  /** Open request already drafted for the lever ("RQ-045"). */
  requested: string | null;
  /** The viewer may draft a request on this project. */
  canApply: boolean;
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface PersonRowView {
  name: string;
  role: string;
  initials: string;
  /** My work filtered on that person. */
  href: string;
  cells: { v: number; bg: string; fg: string }[];
  avgText: string;
  avgColor: string;
}

export interface RoleBarView {
  name: string;
  /** "{demand} / {capacity} h". */
  text: string;
  color: string;
  demandH: number;
  capacityH: number;
}

export interface SuggestionView {
  /** Key and Apply target. */
  projectCode: string;
  leverCode: string;
  title: string;
  /** Activity tooltip ("A1250 · Steel erection — Bays 3–4"). */
  hint: string;
  impact: string;
  /** "Requested · RQ-045" (FR "Demandée · RQ-045") instead of Apply once a request exists; null otherwise. */
  requested: string | null;
  canApply: boolean;
}

export interface ResourcesView {
  kpis: KpiView[];
  weeks: string[];
  people: PersonRowView[];
  roles: RoleBarView[];
  suggestions: SuggestionView[] | null;
}

const WEEK_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/;

/**
 * Week column label: "Sep 28" (EN) / "28 sept." (FR). The prototype's month substitution gave "sept. 28" (06 OQ13);
 * the French order matches the Leave calendar.
 */
export function weekLabel(label: string, t: T, lang: Lang): string {
  const m = lang === 'fr' ? WEEK_RE.exec(label) : null;
  return m ? `${m[2]} ${FR_MONTHS[m[1]]}` : t(label);
}

/** `?person=` link of the heatmap person cell (prototype `setState({screen:'mywork', person})`). */
export const myWorkHref = (name: string) => `${screenHref('mywork')}?person=${encodeURIComponent(name)}`;

export function resourcesView(input: ResourcesInput, t: T, lang: Lang): ResourcesView {
  const isProject = input.scope === 'project';
  const people = input.people.map((p) => ({ ...p, load: personLoad(p.loads) }));
  const roles: CapacityRow[] = isProject
    ? projectDepartmentDemand(people.map((p) => ({ department: p.department, avgPct: p.load.avgPct })))
    : input.departments;
  const n = people.length;
  const over = overAllocatedCount(people.map((p) => p.load));
  const share = input.labor ? laborShare(input.labor) : null;
  const unmet = unmetDemand(roles);

  const kpis: KpiView[] = [
    {
      label: t(isProject ? 'Project team load' : 'Team utilization'),
      value: t(`${teamUtilization(people.map((p) => p.load))}%`),
      sub: t(isProject ? `${n}${n === 1 ? ' person assigned' : ' people assigned'}` : 'Target 85–95%'),
      color: OK,
    },
    { label: t('Over-allocated'), value: t(`${over}${over === 1 ? ' person' : ' people'}`), sub: peakWeeksText(people, input.weekStarts, lang), color: over ? LO : OK },
    {
      // A-12: computed on both screens (the portfolio showed the constant 240 h), attention colour only when > 0.
      label: t('Unmet demand'),
      value: t(`${unmet} h`),
      sub: isProject ? t('Next 8 weeks, by department') : shortfallText(roles, t, lang),
      color: unmet > 0 ? LO : OK,
    },
    {
      label: t('Labor cost to date'),
      value: input.labor ? money(input.labor.actual, lang) : '—',
      sub: share != null ? t(`${share}% of labor budget`) : '',
      color: OK,
    },
    { label: t('Open requests'), value: String(input.openRequests), sub: t(isProject ? 'Awaiting department approval' : 'Across all projects'), color: OK },
  ];

  return {
    kpis,
    weeks: input.weeks.map((w) => weekLabel(w, t, lang)),
    people: people.map((p) => ({
      name: p.name,
      role: p.jobTitle ? t(p.jobTitle) : '',
      initials: p.initials,
      href: myWorkHref(p.name),
      cells: p.loads.map((v) => ({ v, ...shade(v) })),
      avgText: `${p.load.avgPct}%`,
      avgColor: p.load.avgAlert ? LO : OK,
    })),
    roles: roles.map((r) => {
      const bar = capacityBar(r);
      return { name: t(r.name), text: `${r.demandH} / ${r.capacityH} h`, color: bar.over ? LO : 'var(--color-neutral-300)', demandH: r.demandH, capacityH: r.capacityH };
    }),
    suggestions: input.suggestions
      ? input.suggestions.map((s) => ({
          projectCode: s.projectCode,
          leverCode: s.lever.code,
          title: leverText(s.lever, t, lang),
          hint: `${s.lever.activity} · ${dataText(s.lever.activityName, lang)}`,
          impact: [s.projectLabel ? t(s.projectLabel) : null, leverEffectText(s.effect, { peakPct: s.currentPeakPct }, t, lang)].filter(Boolean).join(' · '),
          requested: s.requested ? `${lang === 'fr' ? 'Demandée' : 'Requested'} · ${s.requested}` : null,
          canApply: s.canApply,
        }))
      : null,
  };
}
