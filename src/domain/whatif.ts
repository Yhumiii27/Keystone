// What-if levelling (chapter 4, open question S-7; docs/spec/05 §4). Pure and deterministic.
//
// The prototype compared two scenarios built from five static levers (LEVERS / AUTO, logic 3462–3463, 4405–4419). Here the
// levers are DERIVED from the project's data and their effects are COMPUTED with the CPM engine (domain/cpm.ts) on an
// in-memory copy of the network — the plan itself is never written: it changes only at the next "Reschedule".
//
// Levers (one row each; a scenario enables a subset):
// - overtime — CRITICAL activity with labour assignments: the driving assignment works more hours per day
//   (WHATIF_RULES.overtimeHoursPerDay, or +overtimeStepHours when already there, never above maxHoursPerDay);
// - extra resource — CRITICAL activity with labour assignments: one more unit on the driving assignment (a crew gets one
//   more unit; a named person gets a colleague or a contractor);
// - relief (extra resource that shares the work, duration unchanged) — a named assignment of an OVERLOADED person (a
//   horizon week above 100 %) or of a person of an OVERLOADED department (8-week demand above capacity);
// - shift — a NOT-STARTED, NON-CRITICAL activity whose assignee / owner is overloaded while it runs: start no earlier than
//   N working days later (SNET), within its total float.
//
// Duration model: an activity's remaining duration is driven by its labour assignment with the most hours per day
// (units × h/d); R' = ⌈R × (u·h) / (u'·h')⌉. Load model (units/time): an assignment loads its person with h/d over the
// remaining span; an activity owner without an assignment carries WHATIF_RULES.ownerHoursPerDay — unless the context counts
// owners on their trade (`ownerLoad: 'trade'`, R-084: the application's rule since the owner's answer of 17 Oct 2026). The
// base loads (`people[].loads`) are the schedules' (src/domain/planning-load.ts) in the application. Cost model: labour of the
// remaining work at the rate card (internal rate by job title, external role, overtime multiplier above
// normalHoursPerDay); equipment and material are not costed. Every rule the chapter-5 questionnaire may change is in
// WHATIF_RULES. Formatting stays in the UI (src/features/resources/whatif-model.ts). Golden values: whatif.test.ts.
import { addCalendarDays, calendarDaysBetween, type IsoDate, type WorkCalendar } from './calendar';
import { CpmCycleError, CpmInputError, schedule, type CpmActivityInput, type CpmActivityResult, type CpmInput, type CpmResult } from './cpm';

export type WhatIfPriority = 'date' | 'budget' | 'people';
export const WHATIF_PRIORITIES: WhatIfPriority[] = ['date', 'budget', 'people'];

/** S-7 defaults (chapter-5 questionnaire). */
export const WHATIF_RULES = {
  /** Hours per day above this are paid with the overtime multiplier. */
  normalHoursPerDay: 8,
  /** Overtime raises the driving assignment to this many hours per day… */
  overtimeHoursPerDay: 10,
  /** …or by this many hours when it already works that much… */
  overtimeStepHours: 2,
  /** …never above this. */
  maxHoursPerDay: 12,
  /** Units added by an extra-resource lever. */
  extraUnits: 1,
  /** A shift moves the start by at most this many working days (and never beyond the total float). */
  shiftMaxDays: 5,
  /** Load of an activity owner who has no assignment on it (coordination), hours per working day. */
  ownerHoursPerDay: 2,
  /** Weekly hours of a person at 100 % load. */
  weekHours: 40,
  /** A person is overloaded in a week above this load (%). */
  overloadPct: 100,
  /** An internal colleague may help while staying at or below this load (%); otherwise a contractor is proposed. */
  helperMaxLoadPct: 100,
  /** Overtime multiplier when the rate card has no "ot" multiplier. */
  overtimeFactor: 1.25,
  /**
   * R-083 (A-10): hourly cost of a resource the rate grid does not value — a crew or a subcontractor without a grid role of its
   * name, a person without a rate role — an isolated PLACEHOLDER (not a grid rate) until the grid has a crew role, so a crew's
   * cost is never dropped from the comparison. €.
   */
  unratedFallbackEur: 60,
  /** External rate = internal rate × this when the rate card has no matching external role. */
  externalPremium: 1.4,
  /** Critical = total float ≤ this (working days), as the CPM engine. */
  criticalFloat: 0,
  /** Display thresholds kept from the prototype (05 §4.4): cost impact > 12 k€, peak > 115 %, bars > 100 %, full bar at 140 %. */
  costAlertKeur: 12,
  peakAlertPct: 115,
  stretchedPct: 100,
  barFullPct: 140,
} as const;

export type WhatIfLeverKind = 'overtime' | 'extra_resource' | 'shift';
/** Who an extra-resource lever adds: one more unit of a crew, a contractor, or an internal colleague. */
export type WhatIfHelperKind = 'same' | 'external' | 'internal';

export interface WhatIfAssignment {
  /** Activity code. */
  activity: string;
  /** "Steel erection crew", "Julien Wagner". */
  resource: string;
  /** Full name of a named person; null for crews, equipment and material. */
  person: string | null;
  jobTitle: string | null;
  department: string | null;
  /** Units and hours per day per unit (null when not counted in hours: equipment, material). */
  units: number | null;
  hoursPerDay: number | null;
  /** Hourly cost rate when known (R-083: a person's grid role, a crew's grid role of its name, at the horizon start). */
  rateEur: number | null;
}

export interface WhatIfPerson {
  name: string;
  jobTitle: string | null;
  department: string | null;
  /** Load % per horizon week. */
  loads: number[];
  /** R-083: the person's grid rate at the horizon start (a helper colleague is valued with it); null / absent when not valued. */
  rateEur?: number | null;
}

export interface WhatIfDepartment {
  name: string;
  capacityH: number;
  demandH: number;
}

export interface WhatIfRates {
  /** Internal hourly cost per grid role at the horizon start (R-083; people carry their own rate). */
  internal: Readonly<Record<string, number>>;
  /** External roles of the rate card ("Contractor — structural (external)"). */
  external: readonly { role: string; rateEur: number }[];
  /** Overtime multiplier ("Overtime > 8 h/day"). */
  overtimeFactor: number;
}

export interface WhatIfContext {
  /** The project network at its data date (an in-memory copy: never persisted). Activity ids are activity codes. */
  network: CpmInput;
  activities: Readonly<Record<string, { name: string; owner: string | null }>>;
  assignments: readonly WhatIfAssignment[];
  /** The project team with their weekly loads over the horizon. */
  people: readonly WhatIfPerson[];
  /** ISO Mondays of the horizon weeks. */
  weeks: readonly IsoDate[];
  /** 8-week capacity vs demand per department (overloaded when demand > capacity). */
  departments: readonly WhatIfDepartment[];
  rates: WhatIfRates;
  /**
   * Where the coordination share of an owner without an assignment goes: on the owner ('person', WHATIF_RULES.ownerHoursPerDay —
   * the chapter-4 rule, the default) or on their trade ('trade': R-084, owner answer 17 Oct 2026 — « les compter par rapport à un
   * métier et non une personne »; the person's load is then their assignments only, and a shift frees no owner).
   */
  ownerLoad?: 'person' | 'trade';
}

export interface WhatIfLever {
  /** Stable code: "overtime:A1250:steel-erection-crew", "extra_resource:A1250:julien-wagner", "shift:A1520". */
  code: string;
  kind: WhatIfLeverKind;
  activity: string;
  /** EN source name of the activity. */
  activityName: string;
  /** Assignment resource; null for a shift. */
  resource: string | null;
  /** The named person concerned: assignee, or the overloaded owner / assignee a shift frees. */
  person: string | null;
  department: string | null;
  /** overtime: hours/day from → to · extra_resource: units from → to · shift: 0 → working days. */
  from: number;
  to: number;
  helper: { kind: WhatIfHelperKind; name: string; rateEur: number } | null;
  /** The assignment drives the activity's duration: overtime / an extra unit shorten it. */
  driving: boolean;
  /** The activity is critical in the current plan. */
  critical: boolean;
}

export type WhatIfSideEffect =
  | { kind: 'overload'; person: string; weekStart: IsoDate }
  | { kind: 'critical'; activity: string }
  | { kind: 'violation'; activity: string; constraint: string };

export interface WhatIfResult {
  /** Project finish (CPM on the copy); null when the network cannot be scheduled or is empty. */
  finish: IsoDate | null;
  /** Critical-path float: lowest total float of the unfinished activities (working days). */
  floatDays: number | null;
  /** Working days gained on the project finish vs the current plan (positive = earlier). */
  daysGained: number;
  /** Labour-cost delta of the remaining work, k€ (0.1). */
  costKeur: number;
  /** Unrounded cost delta in € (auto-level "protect the budget" must not take +€40 for "0.0 k€"). */
  costEur?: number;
  /** Highest weekly load of the team (%). */
  peakPct: number;
  /** Most people above 100 % in one week. */
  overPeople: number;
  /** "Peak load by week": highest load of the team per horizon week (%). */
  bars: number[];
  /** Team hours over the horizon, delta vs the current plan. */
  loadDeltaH: number;
  /** Hours delta of overloaded people and people of overloaded departments over the horizon (negative = relief). */
  overloadDeltaH: number;
  /** Person-weeks above 100 %, delta vs the current plan. */
  overWeeksDelta: number;
  sideEffects: WhatIfSideEffect[];
  /** EN source text when the network cannot be scheduled. */
  error: string | null;
}

/** A context ready to evaluate scenarios: the current plan scheduled once, the derived levers and the base loads. */
export interface WhatIfModel {
  ctx: WhatIfContext;
  base: CpmResult | null;
  /** EN source text when the current plan cannot be scheduled (cycle, invalid input). */
  error: string | null;
  levers: WhatIfLever[];
  /** Base result: the current plan recalculated (no lever). */
  current: WhatIfResult;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

const R = WHATIF_RULES;
const EPS = 1e-9;
const round1 = (v: number) => Math.round(v * 10) / 10;
const ceilDays = (v: number) => Math.max(0, Math.ceil(v - EPS));
const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** Lever code (stable across loads while the data does not change). */
export const leverCode = (kind: WhatIfLeverKind, activity: string, resource?: string | null) =>
  kind === 'shift' ? `shift:${activity}` : `${kind}:${activity}:${slug(resource ?? '')}`;

/** Order-independent signature of a lever set ("" for none). */
export const leverSetKey = (codes: Iterable<string>) => [...new Set(codes)].sort().join('|');

const isLabour = (a: WhatIfAssignment): a is WhatIfAssignment & { units: number; hoursPerDay: number } =>
  a.units != null && a.hoursPerDay != null && a.units > 0 && a.hoursPerDay > 0;

/** Index of the driving labour assignment (most hours per day; ties: the first), −1 without labour. */
export function drivingIndex(labour: readonly { units: number; hoursPerDay: number }[]): number {
  let best = -1;
  labour.forEach((a, i) => {
    if (best < 0 || a.units * a.hoursPerDay > labour[best].units * labour[best].hoursPerDay + EPS) best = i;
  });
  return best;
}

/** Overtime target of an assignment working `h` hours per day; null when it is already at the maximum. */
export function overtimeTarget(h: number): number | null {
  const to = h < R.overtimeHoursPerDay ? R.overtimeHoursPerDay : Math.min(R.maxHoursPerDay, h + R.overtimeStepHours);
  return to > h + EPS ? to : null;
}

/** Remaining duration after a change of the driving assignment's units × hours/day: ⌈R × (u·h)/(u'·h')⌉. */
export const scaledRemaining = (remaining: number, before: number, after: number) => (after > 0 ? ceilDays((remaining * before) / after) : remaining);

/** External hourly rate for a job title: a rate-card external role sharing a word (≥ 5 letters), else internal × premium. */
export function externalRateFor(rates: WhatIfRates, jobTitle: string | null, internalRate: number | null): number {
  const words = (jobTitle ?? '').toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 5);
  const hit = rates.external.find((e) => words.some((w) => e.role.toLowerCase().includes(w)));
  if (hit) return hit.rateEur;
  return Math.round((internalRate ?? R.unratedFallbackEur) * R.externalPremium);
}

/** "Contract structural engineer" — the contract role named after a job title (the prototype's RQ-043 wording). */
export const contractRoleOf = (jobTitle: string | null, resource: string) => {
  const base = jobTitle || resource;
  return `Contract ${/^[A-Z]{2,}/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1)}`;
};

/** Working dates of [from, to] on `cal`, bucketed into the horizon weeks: hours per week at `hoursPerDay`. */
export function weeklyHours(cal: WorkCalendar, from: IsoDate | null, to: IsoDate | null, hoursPerDay: number, weeks: readonly IsoDate[]): number[] {
  const out = weeks.map(() => 0);
  if (!from || !to || to < from || hoursPerDay <= 0 || !weeks.length) return out;
  const horizonEnd = addCalendarDays(weeks[weeks.length - 1], 6);
  const start = from < weeks[0] ? weeks[0] : from;
  const end = to > horizonEnd ? horizonEnd : to;
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    if (!cal.isWorkDay(d)) continue;
    const i = Math.floor(calendarDaysBetween(weeks[0], d) / 7);
    if (i >= 0 && i < out.length) out[i] += hoursPerDay;
  }
  return out;
}

const calendarOf = (input: CpmInput, a: CpmActivityInput) => (a.calendar && input.calendars[a.calendar]) || input.calendars[input.projectCalendar];

/** Remaining span of an activity in a CPM result (null when complete or without remaining work). */
function spanOf(r: CpmActivityResult | undefined): { from: IsoDate; to: IsoDate } | null {
  if (!r || r.state === 'complete' || !r.remainingStart || r.remaining <= 0) return null;
  return { from: r.remainingStart, to: r.finish };
}

const cpmError = (e: unknown): string => {
  if (e instanceof CpmCycleError) return `Circular logic: ${e.cycle.join(' → ')}`;
  if (e instanceof CpmInputError) return e.issues[0] ?? 'Invalid schedule';
  throw e;
};

// ── Model ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Indexes {
  labour: Map<string, (WhatIfAssignment & { units: number; hoursPerDay: number })[]>;
  people: Map<string, WhatIfPerson>;
  overloadedPeople: Set<string>;
  overloadedDepts: Set<string>;
}

function indexes(ctx: WhatIfContext): Indexes {
  const labour = new Map<string, (WhatIfAssignment & { units: number; hoursPerDay: number })[]>();
  for (const a of ctx.assignments) if (isLabour(a)) labour.set(a.activity, [...(labour.get(a.activity) ?? []), a]);
  return {
    labour,
    people: new Map(ctx.people.map((p) => [p.name, p])),
    overloadedPeople: new Set(ctx.people.filter((p) => p.loads.some((v) => v > R.overloadPct)).map((p) => p.name)),
    overloadedDepts: new Set(ctx.departments.filter((d) => d.demandH > d.capacityH).map((d) => d.name)),
  };
}

const IDX = new WeakMap<WhatIfContext, Indexes>();
const idx = (ctx: WhatIfContext) => {
  let i = IDX.get(ctx);
  if (!i) IDX.set(ctx, (i = indexes(ctx)));
  return i;
};

/** R-083: the assignment's own rate (person or crew role at the horizon start), else the isolated placeholder. */
const rateOf = (a: WhatIfAssignment) => a.rateEur ?? R.unratedFallbackEur;

/** Prepares a what-if: schedules the current plan once and derives the levers. */
export function prepareWhatIf(ctx: WhatIfContext): WhatIfModel {
  let base: CpmResult | null = null;
  let error: string | null = null;
  if (ctx.network.activities.length) {
    try {
      base = schedule(ctx.network);
    } catch (e) {
      error = cpmError(e);
    }
  }
  const model: WhatIfModel = { ctx, base, error, levers: [], current: emptyResult(ctx, error) };
  if (!base) return model;
  model.levers = deriveLevers(ctx, base);
  model.current = evaluateScenario(model, []);
  return model;
}

function emptyResult(ctx: WhatIfContext, error: string | null): WhatIfResult {
  const bars = ctx.weeks.map((_, w) => Math.max(0, ...ctx.people.map((p) => p.loads[w] ?? 0)));
  const over = ctx.weeks.map((_, w) => ctx.people.filter((p) => (p.loads[w] ?? 0) > R.overloadPct).length);
  return {
    finish: null, floatDays: null, daysGained: 0, costKeur: 0, peakPct: Math.max(0, ...bars), overPeople: Math.max(0, ...over), bars, loadDeltaH: 0,
    overloadDeltaH: 0, overWeeksDelta: 0, sideEffects: [], error,
  };
}

/** Derives the levers of the current plan (see the module header), in activity order. */
export function deriveLevers(ctx: WhatIfContext, base: CpmResult): WhatIfLever[] {
  const ix = idx(ctx);
  const out: WhatIfLever[] = [];
  const seen = new Set<string>();
  const push = (l: WhatIfLever) => {
    if (!seen.has(l.code)) {
      seen.add(l.code);
      out.push(l);
    }
  };
  const horizonEnd = ctx.weeks.length ? addCalendarDays(ctx.weeks[ctx.weeks.length - 1], 6) : null;
  const weeksOf = (span: { from: IsoDate; to: IsoDate } | null) =>
    span && ctx.weeks.length ? ctx.weeks.map((w, i) => (span.from <= addCalendarDays(w, 6) && span.to >= w ? i : -1)).filter((i) => i >= 0) : [];
  const isOverloaded = (person: string, dept: string | null) => ix.overloadedPeople.has(person) || (!!dept && ix.overloadedDepts.has(dept));

  for (const a of ctx.network.activities) {
    const r = base.activities[a.id];
    const span = spanOf(r);
    if (!span) continue;
    const info = ctx.activities[a.id] ?? { name: a.id, owner: null };
    const critical = r.totalFloat != null && r.totalFloat <= R.criticalFloat;
    const labour = ix.labour.get(a.id) ?? [];
    const di = drivingIndex(labour);
    const remaining = r.remaining;
    const inHorizon = !!horizonEnd && span.from <= horizonEnd && span.to >= ctx.weeks[0];
    const common = { activity: a.id, activityName: info.name, critical };

    labour.forEach((j, i) => {
      const driving = i === di;
      const person = j.person;
      const dept = j.department ?? (person ? (ix.people.get(person)?.department ?? null) : null);
      if (driving && critical) {
        const to = overtimeTarget(j.hoursPerDay);
        if (to != null && scaledRemaining(remaining, j.hoursPerDay, to) < remaining)
          push({ ...common, code: leverCode('overtime', a.id, j.resource), kind: 'overtime', resource: j.resource, person, department: dept, from: j.hoursPerDay, to, helper: null, driving });
      }
      // Extra resource: on a critical activity's driving assignment it shortens the duration (date lever); on the
      // assignment of an overloaded person / department it shares the work (relief, duration unchanged).
      const relief = !!person && inHorizon && isOverloaded(person, dept);
      const shortens = driving && critical && scaledRemaining(remaining, j.units, j.units + R.extraUnits) < remaining;
      if (!shortens && !relief) return;
      push({
        ...common, code: leverCode('extra_resource', a.id, j.resource), kind: 'extra_resource', resource: j.resource, person, department: dept,
        from: j.units, to: j.units + R.extraUnits,
        helper: helperFor(ctx, j, dept, shortens ? j.hoursPerDay : (j.units * j.hoursPerDay) / (j.units + R.extraUnits), weeksOf(span)), driving: shortens,
      });
    });

    // Shift: not started, non-critical, SNET-compatible, an overloaded contributor while it runs (within the horizon).
    const cons = a.constraint?.type && a.constraint.type !== 'ASAP' ? a.constraint.type : null;
    if (r.state === 'not_started' && !critical && r.totalFloat != null && r.totalFloat >= 1 && (!cons || cons === 'SNET')) {
      const ownerCounts = ctx.ownerLoad !== 'trade' && !!info.owner && !labour.some((j) => j.person === info.owner);
      const contributors = [...labour.filter((j) => j.person).map((j) => j.person!), ...(ownerCounts ? [info.owner!] : [])];
      const weeks = weeksOf(span);
      const freed = contributors.find((p) => weeks.some((w) => (ix.people.get(p)?.loads[w] ?? 0) > R.overloadPct));
      const days = Math.min(r.totalFloat, R.shiftMaxDays);
      if (freed && days >= 1)
        push({ ...common, code: leverCode('shift', a.id), kind: 'shift', resource: null, person: freed, department: ix.people.get(freed)?.department ?? null, from: 0, to: days, helper: null, driving: false });
    }
  }
  return out;
}

/**
 * Who an extra-resource lever adds to assignment `j`: one more unit of a crew; for a named person, the least-loaded
 * colleague of a department that is not overloaded when they stay ≤ helperMaxLoadPct in the weeks concerned, else a
 * contractor at the rate card's external rate.
 */
function helperFor(ctx: WhatIfContext, j: WhatIfAssignment & { units: number; hoursPerDay: number }, dept: string | null, helperHoursPerDay: number, weeks: number[]): WhatIfLever['helper'] {
  const ix = idx(ctx);
  const internalRate = rateOf(j);
  if (!j.person) return { kind: 'same', name: j.resource, rateEur: internalRate };
  if (dept && !ix.overloadedDepts.has(dept)) {
    const addPts = ((helperHoursPerDay * 5) / R.weekHours) * 100;
    const candidates = ctx.people
      .filter((p) => p.name !== j.person && p.department === dept)
      .map((p) => ({ p, worst: Math.max(0, ...(weeks.length ? weeks : ctx.weeks.map((_, i) => i)).map((w) => p.loads[w] ?? 0)) }))
      .filter((c) => c.worst + addPts <= R.helperMaxLoadPct + EPS)
      .sort((x, y) => x.worst - y.worst);
    const c = candidates[0];
    if (c) return { kind: 'internal', name: c.p.name, rateEur: c.p.rateEur ?? internalRate };
  }
  return { kind: 'external', name: contractRoleOf(j.jobTitle, j.resource), rateEur: externalRateFor(ctx.rates, j.jobTitle, internalRate) };
}

// ── Scenario evaluation ───────────────────────────────────────────────────────────────────────────────────────────────

interface Entry {
  /** Pool person loaded by this entry (null: crew, contractor). */
  person: string | null;
  /** Hours per working day (all units). */
  daily: number;
  /** Overtime hours per working day (all units). */
  premium: number;
  rate: number;
  /** Counted in the labour cost (owners' coordination share is not). */
  costed: boolean;
}

/** Entries (load and cost) of an activity under a set of levers, and its new remaining duration (null = unchanged). */
function activityPlan(model: WhatIfModel, code: string, levers: readonly WhatIfLever[], remaining: number): { entries: Entry[]; remaining: number | null } {
  const { ctx } = model;
  const ix = idx(ctx);
  const labour = ix.labour.get(code) ?? [];
  const di = drivingIndex(labour);
  const entries: Entry[] = [];
  const premiumOf = (units: number, h: number) => units * Math.max(0, h - R.normalHoursPerDay);
  let newRemaining: number | null = null;
  labour.forEach((j, i) => {
    const rate = rateOf(j);
    const ot = levers.find((l) => l.kind === 'overtime' && l.resource === j.resource);
    const extra = levers.find((l) => l.kind === 'extra_resource' && l.resource === j.resource);
    const h = ot ? ot.to : j.hoursPerDay;
    const u = j.units;
    if (i === di && (ot || (extra && extra.driving))) {
      const after = (extra && extra.driving ? u + (extra.to - extra.from) : u) * h;
      newRemaining = scaledRemaining(remaining, u * j.hoursPerDay, after);
    }
    if (extra && !(i === di && extra.driving)) {
      // Relief: the work of the assignment is shared with the helper; the duration does not change.
      const added = extra.to - extra.from;
      const share = u / (u + added);
      entries.push({ person: j.person, daily: u * h * share, premium: premiumOf(u, h) * share, rate, costed: true });
      if (extra.helper) entries.push({ person: extra.helper.kind === 'internal' ? extra.helper.name : null, daily: u * h * (1 - share), premium: premiumOf(u, h) * (1 - share), rate: extra.helper.rateEur, costed: true });
      return;
    }
    entries.push({ person: j.person, daily: u * h, premium: premiumOf(u, h), rate, costed: true });
    if (extra && extra.helper) {
      const added = extra.to - extra.from;
      entries.push({ person: extra.helper.kind === 'internal' ? extra.helper.name : null, daily: added * h, premium: premiumOf(added, h), rate: extra.helper.rateEur, costed: true });
    }
  });
  const owner = ctx.activities[code]?.owner;
  if (ctx.ownerLoad !== 'trade' && owner && ix.people.has(owner) && !labour.some((j) => j.person === owner)) entries.push({ person: owner, daily: R.ownerHoursPerDay, premium: 0, rate: 0, costed: false });
  return { entries, remaining: newRemaining };
}

const costOf = (entries: Entry[], days: number, factor: number) =>
  entries.filter((e) => e.costed).reduce((a, e) => a + days * (e.daily * e.rate + e.premium * e.rate * (factor - 1)), 0);

/**
 * Effects of a lever set: CPM on a copy of the network (overtime / extra unit → shorter remaining duration, shift → SNET),
 * then loads, cost and side effects against the current plan. Unknown codes are ignored.
 */
export function evaluateScenario(model: WhatIfModel, enabled: Iterable<string>): WhatIfResult {
  const { ctx, base } = model;
  if (!base) return emptyResult(ctx, model.error);
  const run = scheduleScenario(model, enabled);
  if ('error' in run) return emptyResult(ctx, run.error);
  const { scen, byActivity, plans } = run;

  // Loads: every unfinished activity contributes over its remaining span (base vs scenario).
  const ix = idx(ctx);
  const delta = new Map<string, number[]>(ctx.people.map((p) => [p.name, ctx.weeks.map(() => 0)]));
  let costDelta = 0;
  for (const a of ctx.network.activities) {
    const rb = base.activities[a.id];
    const rs = scen.activities[a.id];
    const bSpan = spanOf(rb);
    const sSpan = spanOf(rs);
    const lv = byActivity.get(a.id);
    const plan = plans.get(a.id);
    if (!lv && bSpan?.from === sSpan?.from && bSpan?.to === sSpan?.to) continue;
    const cal = calendarOf(ctx.network, a);
    const basePlan = activityPlan(model, a.id, [], rb?.remaining ?? 0);
    const scenEntries = plan?.entries ?? basePlan.entries;
    const sides: [Entry[], { from: IsoDate; to: IsoDate } | null, number][] = [[basePlan.entries, bSpan, -1], [scenEntries, sSpan, 1]];
    for (const [entries, span, sign] of sides) {
      for (const e of entries) {
        const d = e.person ? delta.get(e.person) : undefined;
        if (!d || !span) continue;
        weeklyHours(cal, span.from, span.to, e.daily, ctx.weeks).forEach((h, w) => (d[w] += sign * h));
      }
    }
    if (lv && rb && rs) costDelta += costOf(scenEntries, rs.remaining, ctx.rates.overtimeFactor) - costOf(basePlan.entries, rb.remaining, ctx.rates.overtimeFactor);
  }

  const loadsAfter = ctx.people.map((p) => ({ p, loads: p.loads.map((v, w) => v + ((delta.get(p.name)?.[w] ?? 0) / R.weekHours) * 100) }));
  const bars = ctx.weeks.map((_, w) => Math.round(Math.max(0, ...loadsAfter.map((x) => x.loads[w] ?? 0))));
  const overByWeek = ctx.weeks.map((_, w) => loadsAfter.filter((x) => (x.loads[w] ?? 0) > R.overloadPct + EPS).length);
  const overWeeks = (rows: { loads: number[] }[]) => rows.reduce((a, x) => a + x.loads.filter((v) => v > R.overloadPct + EPS).length, 0);
  let loadDeltaH = 0;
  let overloadDeltaH = 0;
  for (const p of ctx.people) {
    const h = (delta.get(p.name) ?? []).reduce((a, b) => a + b, 0);
    loadDeltaH += h;
    if (ix.overloadedPeople.has(p.name) || (p.department && ix.overloadedDepts.has(p.department))) overloadDeltaH += h;
  }

  // Side effects: people newly above 100 %, activities newly critical, new constraint violations.
  const sideEffects: WhatIfSideEffect[] = [];
  for (const x of loadsAfter) {
    const w = x.loads.findIndex((v, i) => v > R.overloadPct + EPS && (x.p.loads[i] ?? 0) <= R.overloadPct);
    if (w >= 0) sideEffects.push({ kind: 'overload', person: x.p.name, weekStart: ctx.weeks[w] });
  }
  for (const id of scen.order) {
    const b = base.activities[id];
    const s = scen.activities[id];
    if (byActivity.has(id) || !b || !s || s.state === 'complete') continue;
    if (!b.critical && s.critical) sideEffects.push({ kind: 'critical', activity: id });
    if (!b.violation && s.violation) sideEffects.push({ kind: 'violation', activity: id, constraint: s.violation.type });
  }

  const projectCal = ctx.network.calendars[ctx.network.projectCalendar];
  const open = Object.values(scen.activities).filter((a) => a.state !== 'complete' && a.totalFloat != null);
  return {
    finish: scen.projectFinish,
    floatDays: open.length ? Math.min(...open.map((a) => a.totalFloat!)) : null,
    daysGained: projectCal.workDaysBetween(addCalendarDays(scen.projectFinish, 1), addCalendarDays(base.projectFinish, 1)),
    costKeur: round1(costDelta / 1000),
    costEur: costDelta,
    peakPct: Math.max(0, ...bars),
    overPeople: Math.max(0, ...overByWeek),
    bars,
    loadDeltaH: round1(loadDeltaH),
    overloadDeltaH: round1(overloadDeltaH),
    overWeeksDelta: overWeeks(loadsAfter) - overWeeks(ctx.people.map((p) => ({ loads: p.loads }))),
    sideEffects,
    error: null,
  };
}

/** CPM on a modified copy of the network: overtime / extra unit → shorter remaining duration, shift → SNET. */
type ScenarioRun = { scen: CpmResult; byActivity: Map<string, WhatIfLever[]>; plans: Map<string, ReturnType<typeof activityPlan>> } | { error: string };

function scheduleScenario(model: WhatIfModel, enabled: Iterable<string>): ScenarioRun {
  const { ctx, base } = model;
  const on = new Set(enabled);
  const levers = model.levers.filter((l) => on.has(l.code));
  const byActivity = new Map<string, WhatIfLever[]>();
  for (const l of levers) byActivity.set(l.activity, [...(byActivity.get(l.activity) ?? []), l]);
  const plans = new Map<string, ReturnType<typeof activityPlan>>();
  if (!base) return { error: model.error ?? 'Invalid schedule' };
  const activities = ctx.network.activities.map((a): CpmActivityInput => {
    const ls = byActivity.get(a.id);
    const r = base.activities[a.id];
    if (!ls || !r || r.state === 'complete') return a;
    const plan = activityPlan(model, a.id, ls, r.remaining);
    plans.set(a.id, plan);
    let next: CpmActivityInput = a;
    if (plan.remaining != null && plan.remaining !== r.remaining) next = { ...next, remaining: plan.remaining };
    const shift = ls.find((l) => l.kind === 'shift');
    if (shift && r.state === 'not_started' && r.remainingStart) {
      const cal = calendarOf(ctx.network, a);
      const date = cal.addWorkDays(r.remainingStart, shift.to);
      const cur = a.constraint?.type === 'SNET' && a.constraint.date ? a.constraint.date : null;
      if (!a.constraint || a.constraint.type === 'ASAP' || a.constraint.type === 'SNET') next = { ...next, constraint: { type: 'SNET', date: cur && cur > date ? cur : date } };
    }
    return next;
  });
  try {
    const scen = levers.length ? schedule({ ...ctx.network, activities }) : base;
    return { scen, byActivity, plans };
  } catch (e) {
    return { error: cpmError(e) };
  }
}

/** A DRAFT resource request a scenario's lever turns into ("Apply" / "Select scenario → create requests"). EN texts. */
export interface WhatIfRequestDraft {
  leverCode: string;
  activity: string;
  /** EN source title ("Overtime 10 → 12 h/d — Steel erection crew"). */
  title: string;
  /** Named person asked for (assignee working overtime, internal colleague); otherwise a contract role. */
  person: string | null;
  contractRole: string | null;
  /** Hours asked for, over the scenario's remaining span of the activity. */
  hours: number;
  start: IsoDate;
  due: IsoDate;
  priority: 'high' | 'med';
}

/**
 * The resource requests of a lever set (shifts need none: they are entered in the plan): overtime → the extra hours of the
 * assignee (or of the crew, as a contract role); extra resource → the hours of the added unit, colleague or contractor.
 * Hours and dates follow the scenario's schedule of the activity.
 */
export function scenarioRequests(model: WhatIfModel, enabled: Iterable<string>): WhatIfRequestDraft[] {
  if (!model.base) return [];
  const run = scheduleScenario(model, enabled);
  if ('error' in run) return [];
  const ix = idx(model.ctx);
  const out: WhatIfRequestDraft[] = [];
  for (const [activity, levers] of run.byActivity) {
    const s = run.scen.activities[activity];
    const span = spanOf(s);
    if (!span) continue;
    const days = s.remaining;
    const labour = ix.labour.get(activity) ?? [];
    for (const l of levers) {
      if (!createsRequest(l)) continue;
      const j = labour.find((x) => x.resource === l.resource);
      if (!j) continue;
      const ot = levers.find((x) => x.kind === 'overtime' && x.resource === l.resource);
      const h = ot ? ot.to : j.hoursPerDay;
      const base = { leverCode: l.code, activity, start: span.from, due: span.to, priority: l.critical ? ('high' as const) : ('med' as const) };
      if (l.kind === 'overtime') {
        out.push({ ...base, title: `Overtime ${l.from} → ${l.to} h/d — ${j.resource}`, person: j.person, contractRole: j.person ? null : j.resource, hours: Math.round(j.units * (l.to - l.from) * days) });
        continue;
      }
      const added = l.to - l.from;
      // Driving: the added units work the whole remaining span. Relief: the helpers take their share added / (units + added)
      // of the assignee's load units × h (correctness review: the share was missing `added`, right only for +1).
      const hours = Math.round(l.driving ? added * h * days : ((j.units * h * added) / (j.units + added)) * days);
      const helper = l.helper;
      if (!helper) continue;
      if (helper.kind === 'same') out.push({ ...base, title: `Extra resource ${l.from} → ${l.to} — ${j.resource}`, person: null, contractRole: j.resource, hours });
      else if (helper.kind === 'internal') out.push({ ...base, title: `Help ${j.person} — ${activity} ${model.ctx.activities[activity]?.name ?? ''}`.trim(), person: helper.name, contractRole: null, hours });
      else out.push({ ...base, title: l.driving ? `${helper.name} — ${activity} ${model.ctx.activities[activity]?.name ?? ''}`.trim() : `${helper.name} — relieve ${j.person}`, person: null, contractRole: helper.name, hours });
    }
  }
  return out;
}

/** Each lever alone vs the current plan (lever effect texts, auto-level, suggestions). */
export function leverEffects(model: WhatIfModel): Record<string, WhatIfResult> {
  return Object.fromEntries(model.levers.map((l) => [l.code, evaluateScenario(model, [l.code])]));
}

/**
 * "Auto-level for this priority" (replaces the prototype's AUTO table): protect the DATE → every lever that gains days;
 * protect the BUDGET → levers that cost nothing and gain days or relieve overloaded people; protect PEOPLE → extra
 * resources and shifts that relieve overloaded people / departments without putting anyone else above 100 % (no
 * overtime).
 */
export function autoLevel(levers: readonly WhatIfLever[], effects: Readonly<Record<string, WhatIfResult>>, priority: WhatIfPriority): string[] {
  return levers
    .filter((l) => {
      const e = effects[l.code];
      if (!e || e.error) return false;
      if (priority === 'date') return e.daysGained > 0;
      if (priority === 'budget') return (e.costEur ?? e.costKeur * 1000) <= 0 && e.daysGained >= 0 && (e.daysGained > 0 || e.overloadDeltaH < 0);
      return l.kind !== 'overtime' && e.overloadDeltaH < 0 && e.overWeeksDelta <= 0 && !e.sideEffects.some((s) => s.kind === 'overload');
    })
    .map((l) => l.code);
}

/**
 * Seeded scenarios A / B kept the prototype's lever codes (whatif_scenario_levers). Until a scenario is edited, its
 * derived levers are read through this mapping: overtime → overtime; contractor → extra resources that are not an
 * internal colleague; move → internal colleagues; delay → shifts; split → none.
 */
export const LEGACY_LEVERS: Readonly<Record<string, (l: WhatIfLever) => boolean>> = {
  overtime: (l) => l.kind === 'overtime',
  contractor: (l) => l.kind === 'extra_resource' && l.helper?.kind !== 'internal',
  move: (l) => l.kind === 'extra_resource' && l.helper?.kind === 'internal',
  delay: (l) => l.kind === 'shift',
  split: () => false,
};

export function legacyLeverSet(levers: readonly WhatIfLever[], legacyEnabled: readonly string[]): string[] {
  return levers.filter((l) => legacyEnabled.some((c) => LEGACY_LEVERS[c]?.(l))).map((l) => l.code);
}

/** Lever order for "Suggested rebalancing": most days gained, then most relief of overloaded people, then cheapest. */
export function rankLevers<T extends { lever: WhatIfLever; effect: WhatIfResult }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => b.effect.daysGained - a.effect.daysGained || a.effect.overloadDeltaH - b.effect.overloadDeltaH || a.effect.costKeur - b.effect.costKeur || (a.lever.code < b.lever.code ? -1 : 1),
  );
}

/** EN label of a lever (audit trail, stored action label); the screen builds its translated text itself. */
export function leverLabel(l: WhatIfLever): string {
  if (l.kind === 'overtime') return `Overtime ${l.from} → ${l.to} h/d — ${l.resource} (${l.activity})`;
  if (l.kind === 'shift') return `Shift ${l.activity} by ${l.to} d — frees ${l.person}`;
  if (l.helper?.kind === 'same') return `Extra resource ${l.from} → ${l.to} — ${l.resource} (${l.activity})`;
  return `${l.helper?.name ?? 'Contractor'} ${l.driving ? 'joins' : 'relieves'} ${l.person} (${l.activity})`;
}

/** Levers that become a resource request when a scenario is applied (a shift is a plan change: no request). */
export const createsRequest = (l: Pick<WhatIfLever, 'kind'>) => l.kind !== 'shift';

/** Most people above 100 % in any one week. */
export const maxOverPeople = (overByWeek: number[]) => (overByWeek.length ? Math.max(...overByWeek) : 0);
