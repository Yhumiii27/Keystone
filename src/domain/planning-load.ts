// Load of people and demand by trade from the project schedules (R-084; owner answers 17 Oct 2026, third round):
// (A) « Oui il faut partir des allocations du planning pour faire les calculs de charge » — a person's load is the hours the
//     schedules' assignments put on them (`activity_assignments` with a person × activity dates × working calendar, the rule of
//     the week split `assignmentHoursInWeek`), set against the weekly capacity (40 h, unchanged: HOURS_PER_PERSON_WEEK). The
//     seeded weekly allocation percentages (`allocations`) are no longer read for load.
// (B) « Il faut les compter par rapport à un métier et non une personne ; si pas de déclaration du tout alors il faut faire une
//     alerte » — work no named person carries is demand on a TRADE, not on a person:
//     - an assignment without a person (crew, team, role, subcontractor) → the trade of the assignment: its department
//       (`activity_assignments.department_id`, the field the levelling by department uses), at the same spreading rule (units ×
//       h/d, else planned hours) — one without a department (the "Steel erection crew") is external labour since 18 Oct (below);
//     - an activity whose only resource is its owner (no assignment at all) → the owner's department (else "Other"), at the
//       what-if's coordination rate WHATIF_RULES.ownerHoursPerDay (2 h per working day) — the owner is not loaded with it;
//     - an activity that needs work (not a milestone, not complete) with no assignment and no owner is "undeclared": it raises an
//       alert (`undeclaredActivities`).
// Equipment and material (no hours) add nothing; a complete activity or a milestone adds nothing.
//
// Owner answers 18 Oct 2026, fourth round:
// (1) « Les équipes externes ne rentrent pas dans le plan de charge » — EXTERNAL labour is left out of the load plan: no person
//     load, no trade demand, no unmet demand (it stays in the schedule). An assignment is external when it carries hours
//     (`isLabour`) and is not EPC2i staff: unnamed and without a department (a crew, a subcontractor, an imported labour resource
//     matched to nobody), or named after a person whose rate-grid role is external (R-083 `isExternal`). EPC2i labour is a named
//     person (staff role) or an unnamed assignment carrying an EPC2i department (`isInternalLabour`).
// (2) « Aucune activité ne devrait être sans affectation, donc laisse 2 h » — the owner's 2 h per working day on their trade is
//     kept, and applies whenever the activity has no EPC2i labour assignment: owner only, but also external crews, equipment or
//     material only (the owner coordinates the subcontractor / the hire). « … mais à 15 jours d'une activité sans affectation
//     préviens le chef de projet » — `unassignedActivitiesAt`: the activities that need work, have no labour assignment at all
//     (an external crew IS an assignment — the work is staffed, by a subcontractor), have an owner (the ones without are the
//     "undeclared" alert above) and start within UNASSIGNED_ALERT_DAYS of the business date (already started included).
// (3) « Le service et les niveaux de compétences de la matrice de compétences sont suffisants » — the trade stays the department;
//     no assignment carries a required skill, so the competence levels cannot refine it yet (notes-planning-load.md §5).
// Pure; golden values in planning-load.test.ts.
import { addCalendarDays, type IsoDate, type WorkCalendar } from './calendar';
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
  /** Named person whose rate-grid role is external (R-083 `rate_roles.is_external`): not EPC2i staff. Absent = staff. */
  personExternal?: boolean;
  units: number | null;
  hoursPerDay: number | null;
  plannedHours: number | null;
}

/** A milestone (no duration): no work. */
export const isMilestone = (a: Pick<PlanActivity, 'durationDays'>): boolean => a.durationDays <= 0;

/** The activity still needs work: not a milestone, not complete. */
export const needsWork = (a: Pick<PlanActivity, 'durationDays' | 'percentComplete'>): boolean => !isMilestone(a) && a.percentComplete < 100;

type LabourFacts = Pick<PlanAssignment, 'units' | 'hoursPerDay' | 'plannedHours'>;

/** The assignment carries working hours (units × h/d, else planned hours): labour — not equipment days or material tonnes. */
export const isLabour = (a: LabourFacts): boolean =>
  ((a.units ?? 0) > 0 && (a.hoursPerDay ?? 0) > 0) || (a.plannedHours ?? 0) > 0;

/**
 * External labour (owner answer 18 Oct 2026: « Les équipes externes ne rentrent pas dans le plan de charge »): labour that is not
 * EPC2i staff — unnamed without a department (crew, subcontractor), or a named person with an external rate role.
 */
export const isExternalLabour = (a: LabourFacts & Pick<PlanAssignment, 'person' | 'department' | 'personExternal'>): boolean =>
  isLabour(a) && (a.person ? !!a.personExternal : !a.department);

/** EPC2i labour: counted in the load plan (a person's load, or its department's demand). */
export const isInternalLabour = (a: LabourFacts & Pick<PlanAssignment, 'person' | 'department' | 'personExternal'>): boolean =>
  isLabour(a) && !isExternalLabour(a);

/**
 * Trade of an unnamed assignment: its department, else the resource it names, else "Other". `planningLoad` only reads it for EPC2i
 * labour (a department), the other branches are kept for callers that classify any assignment.
 */
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
  // Owner answer 18 Oct 2026 (2): the owner's coordination share applies unless EPC2i labour is assigned.
  const staffed = new Set(assignments.filter(isInternalLabour).map((a) => `${a.project}|${a.activity}`));
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
    // Owner answer 18 Oct 2026 (1): external crews and subcontractors stay out of the load plan.
    if (!a || !needsWork(a) || !isInternalLabour(s)) continue;
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
    if (!a.owner || !needsWork(a) || staffed.has(`${a.project}|${a.code}`)) continue;
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

/** J-15 (owner answer 18 Oct 2026): the PM is told when an activity without an assignment starts within 15 days. */
export const UNASSIGNED_ALERT_DAYS = 15;

/**
 * Activities the PM is warned about at J-15 (owner answer 18 Oct 2026, fourth round: « à 15 jours d'une activité sans affectation
 * préviens le chef de projet »): they need work, have an owner but no labour assignment at all (owner only, or equipment /
 * material only — an external crew is an assignment), are dated and start no later than `today` + `days` calendar days. An
 * activity already started (or late) and still without an assignment is included: it is warned once like the others. Without an
 * owner it is "undeclared" (`undeclaredActivities`, its own notice), not listed here. In the given order.
 */
export function unassignedActivitiesAt<A extends Pick<PlanActivity, 'project' | 'code' | 'owner' | 'start' | 'durationDays' | 'percentComplete'>>(
  activities: readonly A[], assignments: readonly (Pick<PlanAssignment, 'project' | 'activity'> & LabourFacts)[], today: IsoDate, days = UNASSIGNED_ALERT_DAYS,
): A[] {
  const assigned = new Set(assignments.filter(isLabour).map((a) => `${a.project}|${a.activity}`));
  const horizon = addCalendarDays(today, days);
  return activities.filter((a) => needsWork(a) && !!a.owner && !!a.start && a.start <= horizon && !assigned.has(`${a.project}|${a.code}`));
}

/** Σ of the hours (one decimal). */
export const sumHours = (hours: readonly number[]): number => round1(hours.reduce((s, h) => s + h, 0));
