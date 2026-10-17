// Load of people and demand by trade from the project schedules (R-084; owner answers 17 Oct 2026, third round):
// (A) « Oui il faut partir des allocations du planning pour faire les calculs de charge » — a person's load is the hours the
//     schedules' assignments put on them (`activity_assignments` with a person × activity dates × working calendar, the rule of
//     the week split `assignmentHoursInWeek`), set against the weekly capacity (40 h, unchanged: HOURS_PER_PERSON_WEEK). The
//     seeded weekly allocation percentages (`allocations`) are no longer read for load.
// (B) « Il faut les compter par rapport à un métier et non une personne ; si pas de déclaration du tout alors il faut faire une
//     alerte » — work no named person carries is demand on a TRADE, not on a person:
//     - an assignment without a person (crew, team, role, subcontractor) → the trade of the assignment: its department
//       (`activity_assignments.department_id`, the field the levelling by department uses), else the resource itself ("Steel
//       erection crew"), at the same spreading rule (units × h/d, else planned hours);
//     - an activity whose only resource is its owner (no assignment at all) → the owner's department (else "Other"), at the
//       what-if's coordination rate WHATIF_RULES.ownerHoursPerDay (2 h per working day) — the owner is not loaded with it;
//     - an activity that needs work (not a milestone, not complete) with no assignment and no owner is "undeclared": it raises an
//       alert (`undeclaredActivities`).
// Equipment and material (no hours) add nothing; a complete activity or a milestone adds nothing. Pure; golden values in
// planning-load.test.ts.
import type { IsoDate, WorkCalendar } from './calendar';
import { HOURS_PER_PERSON_WEEK, assignmentHoursInWeek } from './load-week';
import { OTHER_DEPARTMENT } from './resources';

/** A schedule activity as the load rules read it. */
export interface PlanActivity {
  /** Project code ("HLT-026"). */
  project: string;
  /** Activity code ("A1250"). */
  code: string;
  /** EN source name, as typed. */
  name: string;
  /** Dates as the schedule stores them (actual start / forecast finish, inclusive); null = not dated. */
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Original duration, working days (0 = milestone). */
  durationDays: number;
  percentComplete: number;
  /** Owner (a person key — id or name); null when none. */
  owner: string | null;
  /** The owner's department (their trade); null when none. */
  ownerTrade: string | null;
  /** Working calendar of the activity (its own, else the project's). */
  calendar: Pick<WorkCalendar, 'isWorkDay'>;
}

/** An assignment of a schedule activity. */
export interface PlanAssignment {
  project: string;
  activity: string;
  /** "Julien Wagner", "Steel erection crew". */
  resource: string;
  /** Person key (id or name) of a named assignment; null for a crew, a role, equipment or material. */
  person: string | null;
  /** Department of the assignment (unnamed: its trade); null when none. */
  department: string | null;
  units: number | null;
  hoursPerDay: number | null;
  plannedHours: number | null;
}

/** A milestone (no duration): no work. */
export const isMilestone = (a: Pick<PlanActivity, 'durationDays'>): boolean => a.durationDays <= 0;

/** The activity still needs work: not a milestone, not complete. */
export const needsWork = (a: Pick<PlanActivity, 'durationDays' | 'percentComplete'>): boolean => !isMilestone(a) && a.percentComplete < 100;

/** Trade of an unnamed assignment: its department, else the resource it names ("Steel erection crew"), else "Other". */
export function tradeOfAssignment(a: Pick<PlanAssignment, 'department' | 'resource'>): Pick<TradeLoad, 'trade' | 'kind'> {
  if (a.department) return { trade: a.department, kind: 'department' };
  const r = a.resource.trim();
  return r ? { trade: r, kind: 'resource' } : { trade: OTHER_DEPARTMENT, kind: 'other' };
}

/** Trade of an owner-only activity: the owner's department, else "Other". */
export const tradeOfOwner = (a: Pick<PlanActivity, 'ownerTrade'>): Pick<TradeLoad, 'trade' | 'kind'> =>
  a.ownerTrade ? { trade: a.ownerTrade, kind: 'department' } : { trade: OTHER_DEPARTMENT, kind: 'other' };

/**
 * What a trade is: a department (EN source name, capacity planned per department), the resource an unnamed assignment names
 * when it has no department ("Steel erection crew" — typed text, no planned capacity), or "Other" (no department at all).
 */
export type TradeKind = 'department' | 'resource' | 'other';

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Demand of one trade over the weeks, with its sources. */
export interface TradeLoad {
  /** Department name (EN source), the resource an unnamed assignment names (typed text) when it has none, or "Other". */
  trade: string;
  kind: TradeKind;
  /** Hours per week (Σ of the two sources). */
  hours: number[];
  /** Of which: unnamed assignments, and activities carried by their owner only (2 h per working day). */
  unnamedH: number[];
  ownersH: number[];
  /** Hours per week by project code. */
  byProject: Record<string, number[]>;
}

export interface PlanningLoad {
  /** ISO Mondays. */
  weeks: IsoDate[];
  /** Hours per week by person key (named assignments). */
  people: Record<string, number[]>;
  /** Hours per week by person key, then project code. */
  personProjects: Record<string, Record<string, number[]>>;
  /** Unnamed demand by trade (first-appearance order). */
  trades: TradeLoad[];
}

/**
 * Hours per week of every person (named assignments) and of every trade (unnamed assignments, owner-only activities) over
 * `weeks` (ISO Mondays). `ownerHoursPerDay`: the hours an owner-only activity puts on its trade per working day.
 */
export function planningLoad(
  activities: readonly PlanActivity[], assignments: readonly PlanAssignment[], weeks: readonly IsoDate[], ownerHoursPerDay: number,
): PlanningLoad {
  const act = new Map(activities.map((a) => [`${a.project}|${a.code}`, a]));
  const declared = new Set(assignments.map((a) => `${a.project}|${a.activity}`));
  const zero = () => weeks.map(() => 0);
  const people: Record<string, number[]> = {};
  const personProjects: Record<string, Record<string, number[]>> = {};
  const trades = new Map<string, TradeLoad>();
  const tradeRow = ({ trade, kind }: Pick<TradeLoad, 'trade' | 'kind'>) => {
    const key = `${kind}|${trade}`;
    let row = trades.get(key);
    if (!row) trades.set(key, (row = { trade, kind, hours: zero(), unnamedH: zero(), ownersH: zero(), byProject: {} }));
    return row;
  };
  const spread = (a: PlanActivity, units: number | null, hoursPerDay: number | null, plannedHours: number | null) =>
    weeks.map((w) => assignmentHoursInWeek({ start: a.start, finish: a.finish, units, hoursPerDay, plannedHours, calendar: a.calendar }, w));
  const add = (into: number[], hours: number[]) => hours.forEach((h, i) => (into[i] = round1(into[i] + h)));

  for (const s of assignments) {
    const a = act.get(`${s.project}|${s.activity}`);
    if (!a || !needsWork(a)) continue;
    const hours = spread(a, s.units, s.hoursPerDay, s.plannedHours);
    if (!hours.some((h) => h > 0)) continue;
    if (s.person) {
      add((people[s.person] ??= zero()), hours);
      add(((personProjects[s.person] ??= {})[s.project] ??= zero()), hours);
      continue;
    }
    const row = tradeRow(tradeOfAssignment(s));
    add(row.hours, hours);
    add(row.unnamedH, hours);
    add((row.byProject[s.project] ??= zero()), hours);
  }
  for (const a of activities) {
    if (!a.owner || !needsWork(a) || declared.has(`${a.project}|${a.code}`)) continue;
    const hours = spread(a, 1, ownerHoursPerDay, null);
    if (!hours.some((h) => h > 0)) continue;
    const row = tradeRow(tradeOfOwner(a));
    add(row.hours, hours);
    add(row.ownersH, hours);
    add((row.byProject[a.project] ??= zero()), hours);
  }
  return { weeks: [...weeks], people, personProjects, trades: [...trades.values()] };
}

/** Load % of a week's hours on the weekly capacity (40 h), rounded: 40 h → 100 %, 52 h → 130 %. */
export const loadPctOfHours = (hours: number, capacityH = HOURS_PER_PERSON_WEEK): number => (capacityH > 0 ? Math.round((hours / capacityH) * 100) : 0);

/**
 * Activities that need work and declare no resource at all — no assignment and no owner (owner answer B: « si pas de
 * déclaration du tout alors il faut faire une alerte »). In the given order.
 */
export function undeclaredActivities<A extends Pick<PlanActivity, 'project' | 'code' | 'owner' | 'durationDays' | 'percentComplete'>>(
  activities: readonly A[], assignments: readonly Pick<PlanAssignment, 'project' | 'activity'>[],
): A[] {
  const declared = new Set(assignments.map((a) => `${a.project}|${a.activity}`));
  return activities.filter((a) => needsWork(a) && !a.owner && !declared.has(`${a.project}|${a.code}`));
}

/** Σ of the hours (one decimal). */
export const sumHours = (hours: readonly number[]): number => round1(hours.reduce((s, h) => s + h, 0));
