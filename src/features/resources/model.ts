// View model of Resources (portfolio pool) and Project resources (docs/spec/06 §1.4; prototype logic 3866–3886,
// template 573–637). Pure: takes the DAL data and the translator, returns the strings and colours the template
// renders. Load / capacity rules live in src/domain/resources.ts.
import { LO, OK, shade } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  capacityBar, laborShare, overAllocatedCount, personLoad, projectDepartmentDemand, PORTFOLIO_UNMET_DEMAND_H, teamUtilization,
  unmetDemand, type CapacityRow,
} from '@/domain/resources';
import { FR_MONTHS } from '@/i18n/fr-rules';
import { money } from '@/lib/format';
import type { Lang, T } from '@/i18n/translate';

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
  /** Pool order (PEOPLE order); for a project, only its team members. */
  people: ResourcePerson[];
  /** Portfolio: department capacity vs demand over the window (ROLES order). Ignored for a project (derived from the team). */
  departments: CapacityRow[];
  /** Labour cost category of the current project (first /labor|staff/i category), null when none. */
  labor: { budget: number; actual: number } | null;
  /** Pending resource requests (all projects, or the project's). */
  openRequests: number;
  /** "Suggested rebalancing" card (always on Resources, Harbor Line only on Project resources). */
  showSuggestions: boolean;
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
  title: string;
  impact: string;
}

export interface ResourcesView {
  kpis: KpiView[];
  weeks: string[];
  people: PersonRowView[];
  roles: RoleBarView[];
  suggestions: SuggestionView[] | null;
}

/** Department head Home and the prototype keep this sub as a constant (00 OPEN QUESTION A-12). */
export const PEAK_WEEKS_SUB = 'Peak weeks 41–43';

/**
 * Static "Suggested rebalancing" list of the prototype (logic 3883–3886, Harbor Line steel slip). `impact` of the
 * contractor line is completed with the signed money amount.
 */
export const SUGGESTIONS: { title: string; impact: string; costKeur?: number }[] = [
  { title: 'Move steel QA checks from Julien Wagner to Hélène Sauvage in weeks 41–42', impact: 'Julien 130% → 105% · no cost' },
  { title: 'Bring in a contract structural engineer for 3 weeks', impact: 'Recovers ~12 days float', costKeur: 18 },
  { title: 'Shift paving prep 1 week later to free Amélie Ollivier', impact: 'Site lead 120% → 100% · off critical path' },
];

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

  const kpis: KpiView[] = [
    {
      label: t(isProject ? 'Project team load' : 'Team utilization'),
      value: t(`${teamUtilization(people.map((p) => p.load))}%`),
      sub: t(isProject ? `${n}${n === 1 ? ' person assigned' : ' people assigned'}` : 'Target 85–95%'),
      color: OK,
    },
    { label: t('Over-allocated'), value: t(`${over}${over === 1 ? ' person' : ' people'}`), sub: t(PEAK_WEEKS_SUB), color: over ? LO : OK },
    {
      label: t('Unmet demand'),
      value: t(`${isProject ? unmetDemand(roles) : PORTFOLIO_UNMET_DEMAND_H} h`),
      sub: t(isProject ? 'Next 8 weeks, by department' : 'Mostly engineering'),
      color: LO,
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
    suggestions: input.showSuggestions
      ? SUGGESTIONS.map((s) => ({
          title: t(s.title),
          impact: s.costKeur != null ? `${t(s.impact)} · ${money(s.costKeur, lang, { signed: true })}` : t(s.impact),
        }))
      : null,
  };
}
