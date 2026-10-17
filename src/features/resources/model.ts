// View model of Resources (portfolio pool) and Project resources (docs/spec/06 §1.4; prototype logic 3866–3886,
// template 573–637). Pure: takes the DAL data and the translator, returns the strings and colours the template
// renders. Load / capacity rules live in src/domain/resources.ts. Chapter 4 (A-12, R-3): "Unmet demand", the peak weeks
// and the suggested rebalancing are computed from the data (the suggestions are what-if levers, src/domain/whatif.ts).
import { LO, OK, shade } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  capacityBar, laborShare, overAllocatedCount, peakWeeksText, personLoad, projectDepartmentDemand, shortfallText, teamUtilization, unmetDemand, unnamedDemand, type CapacityRow,
} from '@/domain/resources';
import type { WhatIfResult } from '@/domain/whatif';
import { HOURS_PER_PERSON_WEEK, weekLoad, weekSplitText, type WeekProjectHours } from '@/domain/load-week';
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
  /** % of the 40 h week per window week (R-084: the hours the schedules assign the person). */
  loads: number[];
  /** Hours the schedules assign per window week (week view: the hours column); absent = from the load %. */
  hours?: number[];
}

export interface ResourcesInput {
  /** `resources` (whole pool) or `presources` (team of one project). */
  scope: 'portfolio' | 'project';
  /** Project resources: the project's code (links to its plan). */
  projectCode?: string;
  /** R-049: whose My work the viewer may open (the person cell links there); default: everyone's. */
  canOpenWork?: (name: string) => boolean;
  /** Window week labels, EN ("Sep 28"). */
  weeks: string[];
  /** ISO Mondays of the window weeks (peak week numbers). */
  weekStarts: string[];
  /** R-085: the weeks are the current load window (default) — false names "8 weeks" instead of "next 8 weeks". */
  windowIsCurrent?: boolean;
  /**
   * Owner answers 17 Oct 2026: `week` = the one week shown in detail (`weekRows`; the project bars on a 40 h week); default
   * the 8-week heatmap.
   */
  view?: 'week' | '8w';
  /**
   * Week view: hours the projects' schedules assign each person that week, by person name (`getWeekProjectSplit` — owner answer
   * 17 Oct 2026, second round: the split comes from the project assignments).
   */
  weekSplit?: Record<string, WeekProjectHours[]>;
  /** Pool order (PEOPLE order); for a project, only its team members. */
  people: ResourcePerson[];
  /**
   * Portfolio: capacity vs demand over the window — the departments (ROLES order), then the trades outside them (R-084,
   * `getCapacityDemand`). Ignored for a project (derived from the team and `projectTrades`).
   */
  departments: CapacityRow[];
  /** Project: the project's work no named person carries, by trade, over the weeks shown (R-084, `getProjectTradeDemand`). */
  projectTrades?: { trade: string; kind: 'department' | 'resource' | 'other'; hours: number }[];
  /**
   * Project: activities that need work and declare no resource at all — no assignment, no owner (R-084, owner answer B: an
   * alert); a card lists them with a link to the plan. Absent = no card.
   */
  undeclared?: { code: string; name: string }[];
  /**
   * "Labor cost to date": portfolio — Σ labour categories of the projects in execution of the displayed zone (R-086, R-2 a);
   * project — the project's labour categories. Null when none.
   */
  labor: { budget: number; actual: number } | null;
  /** Portfolio scope: EN label of the displayed zone ('' or null = all zones), named in the sub-line (R-086). */
  zoneLabel?: string | null;
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
  /** My work filtered on that person; null when the viewer may not open their work (R-049). */
  href: string | null;
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

/** Week view: one person's load that week (owner answers 17 Oct 2026). */
export interface WeekRowView {
  name: string;
  role: string;
  initials: string;
  href: string | null;
  /** Load cell (% and heat colours). */
  cell: { v: number; bg: string; fg: string };
  /** "36 h / 40 h". */
  hoursText: string;
  /** Hours above capacity ("+12 h"), '' within capacity. */
  overText: string;
  /** Above 110 % (the "Over-allocated" tile's rule). */
  overAllocated: boolean;
  /**
   * "HLT-026 40 h · 12 h not assigned" — hours assigned per project, then the load no assignment covers or the hours assigned
   * beyond the load ('' when the schedules assign the person nothing that week; `weekSplitText`).
   */
  projectsText: string;
}

export interface ResourcesView {
  kpis: KpiView[];
  weeks: string[];
  people: PersonRowView[];
  /** Week view: the rows of the week shown; null in the 8-week view. */
  weekRows: WeekRowView[] | null;
  /** Week view: the schedules assign some person of the table that week (else the "By project" column is empty: footnote). */
  weekHasSplit: boolean;
  /** Sub-line of the "Capacity vs demand" card. */
  rolesSub: string;
  roles: RoleBarView[];
  /** "Of which 124 h not assigned to a person, counted by trade" under the bars; null when none (R-084). */
  rolesNote: string | null;
  /** Project: activities without any declared resource (code · name, link to the plan); empty = no card. */
  undeclared: { code: string; name: string; href: string }[];
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
  const isWeek = input.view === 'week';
  const people = input.people.map((p) => ({ ...p, load: personLoad(p.loads) }));
  const roles: CapacityRow[] = isProject
    ? projectDepartmentDemand(people.map((p) => ({ department: p.department, avgPct: p.load.avgPct })), isWeek ? HOURS_PER_PERSON_WEEK : undefined, input.projectTrades ?? [])
    : input.departments;
  const unnamed = unnamedDemand(roles);
  const roleName = (r: CapacityRow) => (r.kind === 'resource' ? dataText(r.name, lang) : t(r.name));
  const hrefOf = (name: string) => (!input.canOpenWork || input.canOpenWork(name) ? myWorkHref(name) : null);
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
      sub: isProject
        ? t(isWeek ? 'Week shown, by department' : input.windowIsCurrent === false ? '8 weeks, by department' : 'Next 8 weeks, by department')
        : shortfallText(roles, t, lang),
      color: unmet > 0 ? LO : OK,
    },
    {
      label: t('Labor cost to date'),
      value: input.labor ? money(input.labor.actual, lang) : '—',
      // R-086: the portfolio figure names its zone (Resources has no zone bar: the zone is the one chosen on the zone screens).
      sub: isProject
        ? (share != null ? t(`${share}% of labor budget`) : '')
        : [share != null ? t(`${share}% of labor budget`) : '', t(input.zoneLabel || 'All zones')].filter(Boolean).join(' · '),
      color: OK,
    },
    { label: t('Open requests'), value: String(input.openRequests), sub: t(isProject ? 'Awaiting department approval' : 'Across all projects'), color: OK },
  ];

  const fr = lang === 'fr';
  const hText = (v: number) => `${fr ? String(v).replace('.', ',') : v} h`;
  const weekRows: WeekRowView[] | null = isWeek
    ? people.map((p) => {
        const w = weekLoad(p.loads[0] ?? 0, input.weekSplit?.[p.name] ?? [], p.hours?.[0]);
        return {
          name: p.name, role: p.jobTitle ? t(p.jobTitle) : '', initials: p.initials, href: hrefOf(p.name), cell: { v: w.pct, ...shade(w.pct) },
          hoursText: `${hText(w.hours)} / ${hText(w.capacityH)}`, overText: w.overH > 0 ? `+${hText(w.overH)}` : '', overAllocated: w.overAllocated, projectsText: weekSplitText(w, lang),
        };
      })
    : null;

  return {
    kpis,
    weeks: input.weeks.map((w) => weekLabel(w, t, lang)),
    weekRows,
    weekHasSplit: !!weekRows && weekRows.some((r) => r.projectsText !== ''),
    // R-084: the bars follow the weeks shown on both screens (the portfolio's were the stored 8-week department totals).
    rolesSub: t(isWeek ? 'Hours by role, week shown' : input.windowIsCurrent === false ? 'Hours by role, 8 weeks' : 'Hours by role, next 8 weeks'),
    rolesNote: unnamed > 0
      ? (lang === 'fr' ? `Dont ${unnamed} h non affectées à une personne, comptées par métier` : `Of which ${unnamed} h not assigned to a person, counted by trade`)
      : null,
    undeclared: (input.undeclared ?? []).map((a) => ({ code: a.code, name: dataText(a.name, lang), href: `${screenHref('plan', { code: input.projectCode })}?act=${encodeURIComponent(a.code)}` })),
    people: people.map((p) => ({
      name: p.name,
      role: p.jobTitle ? t(p.jobTitle) : '',
      initials: p.initials,
      href: hrefOf(p.name),
      cells: p.loads.map((v) => ({ v, ...shade(v) })),
      avgText: `${p.load.avgPct}%`,
      avgColor: p.load.avgAlert ? LO : OK,
    })),
    roles: roles.map((r) => {
      const bar = capacityBar(r);
      return { name: roleName(r), text: `${r.demandH} / ${r.capacityH} h`, color: bar.over ? LO : 'var(--color-neutral-300)', demandH: r.demandH, capacityH: r.capacityH };
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
