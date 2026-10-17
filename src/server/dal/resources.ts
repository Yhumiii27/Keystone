import 'server-only';
// Resources DAL (docs/spec/06 §1, 05 §4, 11 §3.6 Allocation): the shared resource pool with its weekly loads over
// the 8-week window, departments with head and capacity, project teams, labour cost of a project, and what-if
// levelling (chapter 4, S-7: levers derived from the data, effects computed by the CPM engine on a copy of the plan,
// scenarios persisted per project, "Apply" → DRAFT resource requests) with its writers.
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  WHATIF_PRIORITIES, WHATIF_RULES, autoLevel, createsRequest, evaluateScenario, leverEffects, leverLabel, leverSetKey, legacyLeverSet, prepareWhatIf, rankLevers,
  scenarioRequests, type WhatIfContext, type WhatIfLever, type WhatIfModel, type WhatIfPriority, type WhatIfRequestDraft, type WhatIfResult,
} from '@/domain/whatif';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { isoOfDisplayDate, weekLabelOfIso, whatIfPriority } from '@/server/db/codes';
import { businessToday } from '@/server/clock';
import { yearOfIso } from '@/domain/clock';
import { isPastWindow, loadWindow, parseLoadViewParam, parseLoadWeekParam, type LoadWindow } from '@/domain/load-window';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  activities, activityAssignments, allocations, costCategories, departmentCapacities, departments, persons, projectControls, projectMembers, projects,
  resourceRequests, wbsNodes, whatIfLevers, whatIfScenarioActions, whatIfScenarioLevers, whatIfScenarios,
} from '@/server/db/schema';
import { multiplierAt, rateAt } from '@/domain/hr';
import { inExecution } from '@/domain/portfolio';
import type { ZoneKey } from '@/server/session';
import { listProjectBaselines } from './baselines';
import { listProjects } from './projects';
import { getRateGrid } from './hr';
import { createResourceRequest } from './requests';
import { loadScheduleNetwork } from './schedule-network';
import { markScenarioApplied } from './whatif-store';

type Q = DB | Tx;


export interface ResourceWeek {
  /** Monday (ISO). */
  start: string;
  /** "Sep 28" (English column label; translate with t()). */
  label: string;
}

export interface PoolPerson {
  name: string;
  shortName: string;
  initials: string;
  /** EN source string ("Structural engineer"). */
  jobTitle: string | null;
  department: string | null;
  /** % of available hours per week, one value per window week (0 when no allocation row). */
  loads: number[];
  /** Mean of the weekly loads (unrounded; the screens show round(avg) %). */
  avg: number;
  max: number;
}

export interface ResourcePool {
  weeks: ResourceWeek[];
  /** PEOPLE order. */
  people: PoolPerson[];
}

/**
 * R-085 (R-7 a): the load window shown — 8 weeks from the Monday of the business date's week, or from `?week=` (validated
 * here: malformed or out of bounds = the current window). Owner answers 17 Oct 2026: `?view=week` shows that one week
 * (anything else = the 8-week view). Resources, Project resources, Leave and the what-if (8 weeks only) read it.
 */
export async function getLoadWindow(week?: unknown, view?: unknown): Promise<LoadWindow> {
  const today = await businessToday();
  return loadWindow(today, parseLoadWeekParam(week, today), parseLoadViewParam(view));
}

/**
 * Week view (owner answers 17 Oct 2026): the allocation rows per project of one week (`allocations.project_id` set), by
 * person name, largest first. The demo data holds weekly totals only (the prototype's PEOPLE): empty there.
 */
export async function getWeekProjectSplit(weekStart: string): Promise<Record<string, { code: string; pct: number }[]>> {
  const db = await getDb();
  const rows = await db
    .select({ full: persons.fullName, short: persons.shortName, code: projects.code, pct: allocations.loadPct })
    .from(allocations)
    .innerJoin(persons, eq(persons.id, allocations.personId))
    .innerJoin(projects, eq(projects.id, allocations.projectId))
    .where(eq(allocations.weekStart, weekStart))
    .orderBy(asc(projects.sortOrder));
  const out: Record<string, { code: string; pct: number }[]> = {};
  for (const r of rows) (out[r.full ?? r.short] ??= []).push({ code: r.code, pct: Number(r.pct) });
  return out;
}

/**
 * Pool members and their weekly loads over `weeks` (ISO Mondays; R-085: any week, 0 where no allocation row). Without `weeks`,
 * every week that has an allocation row (the former rule, still used by the readers outside the load plans: Home, alerts,
 * Approvals, My work, Site conflicts).
 */
async function poolRows(personIds?: string[], weeks?: readonly string[]) {
  const db = await getDb();
  const rows = await db
    .select({ p: persons, dept: departments.name })
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(isNotNull(persons.resourcePoolPosition))
    .orderBy(asc(persons.resourcePoolPosition));
  const allocs = weeks && !weeks.length
    ? []
    : await db
      .select({ personId: allocations.personId, weekStart: allocations.weekStart, loadPct: allocations.loadPct })
      .from(allocations)
      .where(and(isNull(allocations.projectId), weeks ? inArray(allocations.weekStart, [...weeks]) : undefined))
      .orderBy(asc(allocations.weekStart));
  const weekStarts = weeks ? [...weeks] : [...new Set(allocs.map((a) => a.weekStart))].sort();
  const toPerson = (p: typeof persons.$inferSelect, dept: string | null): PoolPerson => {
    const own = new Map(allocs.filter((a) => a.personId === p.id).map((a) => [a.weekStart, a.loadPct]));
    const loads = weekStarts.map((w) => own.get(w) ?? 0);
    return {
      name: p.fullName ?? p.shortName, shortName: p.shortName, initials: p.initials, jobTitle: p.jobTitle, department: dept, loads,
      avg: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0, max: loads.length ? Math.max(...loads) : 0,
    };
  };
  const filtered = personIds ? rows.filter((r) => personIds.includes(r.p.id)) : rows;
  return { weekStarts, people: filtered.map((r) => toPerson(r.p, r.dept)), toPerson };
}

/**
 * The shared pool: every person with a pool position, with their weekly loads (Resources heatmap). `weeks` = the load window's
 * Mondays (R-085, `getLoadWindow`); omitted = every week with an allocation row (see `poolRows`).
 */
export async function getResourcePool(weeks?: readonly string[]): Promise<ResourcePool> {
  const { weekStarts, people } = await poolRows(undefined, weeks);
  return { weeks: weekStarts.map((start) => ({ start, label: weekLabelOfIso(start) })), people };
}

/**
 * Team of a project (projectData().team order) with their loads over `weeks` (as `getResourcePool`) — Project resources,
 * what-if. Members outside the pool get zero loads. Empty for projects without a team.
 */
export async function getProjectTeam(projectCode: string, weeks?: readonly string[]): Promise<PoolPerson[]> {
  const db = await getDb();
  const members = await db
    .select({ p: persons, dept: departments.name })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(persons, eq(persons.id, projectMembers.personId))
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(projectMembers.position));
  const { toPerson } = await poolRows([], weeks);
  return members.map((m) => toPerson(m.p, m.dept));
}

export interface DepartmentRow {
  name: string;
  head: { name: string; shortName: string; initials: string } | null;
  /** EN source string ("Head of engineering"). */
  headTitle: string | null;
  /** Capacity vs committed demand over the window (ROLES), hours; null when not planned. */
  capacityH: number | null;
  demandH: number | null;
  /** ROLES order of the capacity bars (DEPTS order is the list order). */
  capacityPosition: number | null;
}

/** Departments in DEPTS order with head and 8-week capacity / demand (Resources bars, Approvals). */
export async function listDepartments(): Promise<DepartmentRow[]> {
  const db = await getDb();
  const head = alias(persons, 'head');
  const rows = await db
    .select({
      name: departments.name, headTitle: departments.headTitle, full: head.fullName, short: head.shortName, initials: head.initials,
      cap: departmentCapacities.capacityH, dem: departmentCapacities.demandH, pos: departmentCapacities.position,
    })
    .from(departments)
    .leftJoin(head, eq(head.id, departments.headPersonId))
    .leftJoin(departmentCapacities, eq(departmentCapacities.departmentId, departments.id))
    .orderBy(asc(departments.sortOrder));
  return rows.map((r) => ({
    name: r.name, headTitle: r.headTitle, head: r.short ? { name: r.full ?? r.short, shortName: r.short, initials: r.initials! } : null,
    capacityH: r.cap, demandH: r.dem, capacityPosition: r.pos,
  }));
}

export interface LaborCost {
  /** Category name ("Labor", "Internal staff"). */
  name: string;
  budget: number;
  actual: number;
}

/**
 * Labour cost of a project (Project resources KPI "Labor cost to date"): Σ budget and actual of its cost categories typed
 * 'labor' (R-086: one rule with the portfolio figure — the former /labor|staff/ name match on the first category is retired; no
 * seeded value changes, every such category is typed Labor). Null when the project has no labour category.
 */
export async function getLaborCost(projectCode: string): Promise<LaborCost | null> {
  const db = await getDb();
  const cats = await db
    .select({ name: costCategories.name, budget: costCategories.budgetKeur, actual: costCategories.actualKeur })
    .from(costCategories)
    .innerJoin(projects, eq(projects.id, costCategories.projectId))
    .where(and(eq(projects.code, projectCode), eq(costCategories.costType, 'labor')))
    .orderBy(asc(costCategories.position));
  if (!cats.length) return null;
  return { name: cats[0].name, budget: cats.reduce((a, c) => a + c.budget, 0), actual: cats.reduce((a, c) => a + c.actual, 0) };
}

export interface PortfolioLaborCost {
  /** Σ labour budget and actual, k€. */
  budget: number;
  actual: number;
  /** Codes of the projects counted. */
  projects: string[];
}

/**
 * R-086 (R-2 a): labour cost of the portfolio in the displayed zone (Resources KPI "Labor cost to date"): the projects in the zone
 * (`null` = all zones) and in execution (A-3 — the Overview's population; a delivery-8 default the owner may overturn), Σ budget
 * and actual over every cost category typed 'labor'.
 */
export async function getPortfolioLaborCost(zone: ZoneKey | null): Promise<PortfolioLaborCost> {
  const db = await getDb();
  const codes = (await listProjects()).filter((p) => inExecution(p) && (!zone || p.zone === zone)).map((p) => p.code);
  if (!codes.length) return { budget: 0, actual: 0, projects: [] };
  const [row] = await db
    .select({ budget: sql<number>`coalesce(sum(${costCategories.budgetKeur}), 0)::float`, actual: sql<number>`coalesce(sum(${costCategories.actualKeur}), 0)::float` })
    .from(costCategories)
    .innerJoin(projects, eq(projects.id, costCategories.projectId))
    .where(and(inArray(projects.code, codes), eq(costCategories.costType, 'labor')));
  return { budget: Number(row?.budget ?? 0), actual: Number(row?.actual ?? 0), projects: codes };
}


// ── What-if levelling (chapter 4, S-7) ─────────────────────────────────────────────────────────────────────────────────

const WHATIF_AREA = 'What-if levelling';

export interface WhatIfScenario {
  /** "A". */
  name: string;
  priority: WhatIfPriority;
  /** 'Protect date' | 'Protect budget' | 'Protect people'. */
  priorityLabel: string;
  selected: boolean;
  /** Derived lever code → enabled, in lever order. */
  levers: Record<string, boolean>;
  /** The scenario's levers were saved; false = read from the seed's prototype lever codes (domain LEGACY_LEVERS). */
  saved: boolean;
  basis: string | null;
  horizonMonths: number | null;
  hypotheses: string | null;
  createdByName: string | null;
  /** ISO timestamp of the last "Apply" / "Select scenario → create requests". */
  appliedAt: string | null;
  appliedByName: string | null;
  /** Resource requests drafted from the scenario: still drafts, and sent (any later status). */
  requests: { draft: number; sent: number };
  /** Effects of the enabled levers (CPM on a copy of the plan). */
  result: WhatIfResult;
}

export interface WhatIf {
  projectCode: string;
  /** Data date the copy of the plan is scheduled from. */
  dataDate: string;
  /**
   * Horizon weeks: the 8-week load window of the page (R-085; owner answers 17 Oct 2026 — previous / current / next, the
   * current window by default).
   */
  weeks: ResourceWeek[];
  /** The horizon: its window, and whether it lies entirely in the past (read-only: no levelling, no Apply). */
  horizon: { window: LoadWindow; past: boolean };
  /** Levers derived from the data (domain/whatif.ts). */
  levers: WhatIfLever[];
  /** Each lever alone vs the current plan. */
  effects: Record<string, WhatIfResult>;
  /** "Auto-level for this priority": the derived lever set per priority. */
  autoLevers: Record<WhatIfPriority, string[]>;
  /** The current plan recalculated by the engine (no lever) — "Current plan" column. */
  current: WhatIfResult;
  /** Results by lever-set key (`leverSetKey`): every scenario, one toggle away from each, and the auto-level sets. */
  results: Record<string, WhatIfResult>;
  scenarios: WhatIfScenario[];
  /** Stored forecast finish (WBS root, as Schedule shows it until the next Reschedule) and float (project controls, days). */
  forecastFinish: string | null;
  floatDays: number | null;
  /** Displayed baseline (S-3 chip, BL1 by default) and its finish. */
  baseline: { code: string; finish: string } | null;
  baselineFinish: string | null;
  /** Peak weekly load of the project team, who and which week (ISO Monday). */
  peak: { pct: number; person: string; weekStart: string } | null;
  /** People of the team above 100 % per horizon week. */
  overByWeek: number[];
  /** EN source text when the plan cannot be scheduled (cycle, invalid input): no lever, no effect. */
  error: string | null;
}

interface WhatIfState {
  projectId: string;
  projectCode: string;
  dataDate: string;
  /** The horizon's 8-week window and whether it is entirely past. */
  window: LoadWindow;
  past: boolean;
  weeks: ResourceWeek[];
  team: PoolPerson[];
  model: WhatIfModel;
  effects: Record<string, WhatIfResult>;
  auto: Record<WhatIfPriority, string[]>;
}

/**
 * The what-if horizon (owner answers 17 Oct 2026): the 8-week window starting at `horizon` — a window start the page passes
 * through every action, validated as `?week=` (snapped to its Monday, ±52 weeks) — or the current window when absent. An
 * invalid start is refused (an action never falls back silently to another horizon than the screen's).
 */
export async function whatIfWindow(horizon?: string | null): Promise<{ window: LoadWindow; past: boolean }> {
  const today = await businessToday();
  const start = horizon == null ? null : parseLoadWeekParam(horizon, today);
  if (horizon != null && !start) throw new Error(`Invalid what-if horizon ${String(horizon)}`);
  const window = loadWindow(today, start, '8w');
  return { window, past: isPastWindow(window, today) };
}

/**
 * Loads a project's what-if context (network, assignments, team loads, departments, rate card) over the horizon (`horizon` =
 * its window start, see `whatIfWindow`) and derives its levers.
 */
async function loadWhatIfState(projectCode: string, horizon?: string | null): Promise<WhatIfState | null> {
  const network = await loadScheduleNetwork(projectCode);
  if (!network || !network.activities.length) return null;
  const db = await getDb();
  const pid = network.projectId;
  const owner = alias(persons, 'owner');
  const who = alias(persons, 'who');
  const adept = alias(departments, 'adept');
  const pdept = alias(departments, 'pdept');
  // R-085, owner answers 17 Oct 2026: the horizon is the page's 8-week window (`?week=`, the current one by default), carried
  // through every action so that the levers, the saved scenario effects and the requests "Apply" drafts are those shown.
  const { window, past } = await whatIfWindow(horizon);
  const { weeks } = window;
  const [acts, asg, team, depts, grid, rated] = await Promise.all([
    db
      .select({ code: activities.code, name: activities.name, full: owner.fullName, short: owner.shortName })
      .from(activities)
      .leftJoin(owner, eq(owner.id, activities.ownerPersonId))
      .where(eq(activities.projectId, pid)),
    db
      .select({
        act: activities.code, resource: activityAssignments.resource, full: who.fullName, short: who.shortName, job: who.jobTitle, adept: adept.name, pdept: pdept.name,
        units: activityAssignments.resourceCount, hpd: activityAssignments.hoursPerDay, rateRoleId: who.rateRoleId,
      })
      .from(activityAssignments)
      .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
      .leftJoin(who, eq(who.id, activityAssignments.personId))
      .leftJoin(adept, eq(adept.id, activityAssignments.departmentId))
      .leftJoin(pdept, eq(pdept.id, who.departmentId))
      .where(eq(activities.projectId, pid))
      .orderBy(asc(activities.position), asc(activityAssignments.position)),
    getProjectTeam(projectCode, weeks),
    listDepartments(),
    getRateGrid(),
    db.select({ full: persons.fullName, short: persons.shortName, rateRoleId: persons.rateRoleId }).from(persons).where(isNotNull(persons.rateRoleId)),
  ]);
  // R-083 (A-10): everybody is valued through their grid role at the horizon start (the first week of the window); a crew or a
  // subcontractor through the grid role bearing its name; otherwise the what-if's isolated placeholder (WHATIF_RULES).
  const rateDate = weeks[0] ?? network.dataDate;
  const at = (role: string | null) => rateAt(grid, role, rateDate);
  const gridRates = grid.roles.map((r) => ({ role: r.role, isExternal: r.isExternal, rateEur: at(r.id) })).filter((r): r is typeof r & { rateEur: number } => r.rateEur != null);
  const internal: Record<string, number> = Object.fromEntries(gridRates.filter((r) => !r.isExternal).map((r) => [r.role, r.rateEur]));
  const roleOfPerson = new Map(rated.flatMap((p) => [[p.full ?? p.short, p.rateRoleId], [p.short, p.rateRoleId]] as [string, string | null][]));
  const ctx: WhatIfContext = {
    network: network.input,
    activities: Object.fromEntries(acts.map((a) => [a.code, { name: a.name, owner: a.short ? (a.full ?? a.short) : null }])),
    assignments: asg.map((a) => ({
      activity: a.act, resource: a.resource, person: a.short ? (a.full ?? a.short) : null, jobTitle: a.job, department: a.adept ?? a.pdept, units: a.units, hoursPerDay: a.hpd,
      rateEur: a.short ? at(a.rateRoleId) : (gridRates.find((r) => r.role.toLowerCase() === a.resource.trim().toLowerCase())?.rateEur ?? null),
    })),
    people: team.map((p) => ({ name: p.name, jobTitle: p.jobTitle, department: p.department, loads: p.loads, rateEur: at(roleOfPerson.get(p.name) ?? null) })),
    weeks,
    departments: depts.filter((d) => d.capacityH != null && d.demandH != null).map((d) => ({ name: d.name, capacityH: d.capacityH!, demandH: d.demandH! })),
    rates: {
      internal,
      external: gridRates.filter((r) => r.isExternal).map((r) => ({ role: r.role, rateEur: r.rateEur })),
      overtimeFactor: multiplierAt(grid, 'ot', rateDate) ?? WHATIF_RULES.overtimeFactor,
    },
  };
  const model = prepareWhatIf(ctx);
  const effects = leverEffects(model);
  const auto = Object.fromEntries(WHATIF_PRIORITIES.map((p) => [p, autoLevel(model.levers, effects, p)])) as Record<WhatIfPriority, string[]>;
  return {
    projectId: pid, projectCode: network.projectCode, dataDate: network.dataDate, window, past, weeks: weeks.map((start) => ({ start, label: weekLabelOfIso(start) })), team, model,
    effects, auto,
  };
}

interface ScenarioRow {
  row: typeof whatIfScenarios.$inferSelect;
  enabled: string[];
  saved: boolean;
  requests: { draft: number; sent: number };
}

/** Scenarios of a project with their enabled levers (saved rows, else the seed's prototype codes mapped) and requests. */
async function scenarioRows(st: WhatIfState, q?: Q): Promise<ScenarioRow[]> {
  const db = q ?? (await getDb());
  const pid = st.projectId;
  const [scen, actions, legacy, reqs] = await Promise.all([
    db.select().from(whatIfScenarios).where(eq(whatIfScenarios.projectId, pid)).orderBy(asc(whatIfScenarios.position)),
    db
      .select({ sid: whatIfScenarioActions.scenarioId, params: whatIfScenarioActions.params, enabled: whatIfScenarioActions.enabled })
      .from(whatIfScenarioActions)
      .innerJoin(whatIfScenarios, eq(whatIfScenarios.id, whatIfScenarioActions.scenarioId))
      .where(eq(whatIfScenarios.projectId, pid))
      .orderBy(asc(whatIfScenarioActions.position)),
    db
      .select({ sid: whatIfScenarioLevers.scenarioId, code: whatIfScenarioLevers.leverCode, enabled: whatIfScenarioLevers.enabled })
      .from(whatIfScenarioLevers)
      .innerJoin(whatIfScenarios, eq(whatIfScenarios.id, whatIfScenarioLevers.scenarioId))
      .innerJoin(whatIfLevers, eq(whatIfLevers.code, whatIfScenarioLevers.leverCode))
      .where(eq(whatIfScenarios.projectId, pid))
      .orderBy(asc(whatIfLevers.position)),
    db
      .select({ sid: resourceRequests.scenarioId, status: resourceRequests.status, n: sql<number>`count(*)::int` })
      .from(resourceRequests)
      .where(and(eq(resourceRequests.projectId, pid), isNotNull(resourceRequests.scenarioId)))
      .groupBy(resourceRequests.scenarioId, resourceRequests.status),
  ]);
  const known = new Set(st.model.levers.map((l) => l.code));
  return scen.map((row) => {
    const own = actions.filter((a) => a.sid === row.id);
    const saved = own.length > 0 || row.computedAt != null;
    const enabled = saved
      ? own.filter((a) => a.enabled && typeof a.params.leverCode === 'string' && known.has(a.params.leverCode)).map((a) => a.params.leverCode as string)
      : legacyLeverSet(st.model.levers, legacy.filter((l) => l.sid === row.id && l.enabled).map((l) => l.code));
    const mine = reqs.filter((r) => r.sid === row.id);
    return {
      row, enabled: st.model.levers.map((l) => l.code).filter((c) => enabled.includes(c)), saved,
      requests: { draft: mine.filter((r) => r.status === 'draft').reduce((a, r) => a + r.n, 0), sent: mine.filter((r) => r.status !== 'draft').reduce((a, r) => a + r.n, 0) },
    };
  });
}

/**
 * What-if levelling of a project: levers derived from its data, every scenario with its computed effects, the current plan
 * recalculated, and the stored plan figures of the KPI tiles. Null for an unknown project or one without activities.
 */
export async function getWhatIf(projectCode: string, horizon?: string | null): Promise<WhatIf | null> {
  const st = await loadWhatIfState(projectCode, horizon);
  if (!st) return null;
  const db = await getDb();
  const [rows, [root], [ctl], bls, today] = await Promise.all([
    scenarioRows(st),
    db.select({ finish: wbsNodes.finishText, finishDate: wbsNodes.finishDate }).from(wbsNodes).where(and(eq(wbsNodes.projectId, st.projectId), eq(wbsNodes.level, 0))),
    db.select({ float: projectControls.floatDays }).from(projectControls).where(eq(projectControls.projectId, st.projectId)),
    listProjectBaselines(st.projectCode),
    businessToday(),
  ]);
  const { model } = st;
  const cache = new Map<string, WhatIfResult>([['', model.current]]);
  for (const [code, r] of Object.entries(st.effects)) cache.set(leverSetKey([code]), r);
  const evalSet = (codes: string[]) => {
    const k = leverSetKey(codes);
    let r = cache.get(k);
    if (!r) cache.set(k, (r = evaluateScenario(model, codes)));
    return r;
  };
  const scenarios: WhatIfScenario[] = rows.map(({ row: s, enabled, saved, requests }) => ({
    name: s.name, priority: s.priority, priorityLabel: whatIfPriority.label(s.priority), selected: s.selected,
    levers: Object.fromEntries(model.levers.map((l) => [l.code, enabled.includes(l.code)])), saved,
    basis: s.basis, horizonMonths: s.horizonMonths, hypotheses: s.hypotheses, createdByName: s.createdByName,
    appliedAt: s.appliedAt ? s.appliedAt.toISOString() : null, appliedByName: s.appliedByName, requests, result: evalSet(enabled),
  }));
  // Optimistic display: one toggle away from every scenario, and the auto-level sets.
  for (const { enabled } of rows) for (const l of model.levers) evalSet(enabled.includes(l.code) ? enabled.filter((c) => c !== l.code) : [...enabled, l.code]);
  for (const p of WHATIF_PRIORITIES) evalSet(st.auto[p]);

  let peak: WhatIf['peak'] = null;
  for (const p of st.team)
    p.loads.forEach((v, i) => {
      if (st.weeks[i] && (!peak || v > peak.pct)) peak = { pct: v, person: p.name, weekStart: st.weeks[i].start };
    });
  const shown = bls.find((b) => b.displayed) ?? bls.find((b) => b.state === 'current') ?? null;
  return {
    projectCode: st.projectCode, dataDate: st.dataDate, weeks: st.weeks, horizon: { window: st.window, past: st.past }, levers: model.levers, effects: st.effects, autoLevers: st.auto, current: model.current,
    results: Object.fromEntries(cache), scenarios,
    // The rescheduled date, else the stored text (a year-less text is in the business year, R-013).
    forecastFinish: root?.finishDate ?? (root?.finish ? isoOfDisplayDate(root.finish, yearOfIso(today)) : null), floatDays: ctl?.float ?? null,
    baseline: shown?.finishDate ? { code: shown.code, finish: shown.finishDate } : null, baselineFinish: shown?.finishDate ?? null,
    peak, overByWeek: st.weeks.map((_, i) => st.team.filter((p) => (p.loads[i] ?? 0) > WHATIF_RULES.overloadPct).length), error: model.error,
  };
}

/** A project has a what-if levelling when it has a plan (activities). */
export async function hasWhatIf(projectCode: string): Promise<boolean> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(eq(projects.code, projectCode));
  return (r?.n ?? 0) > 0;
}

/** Scenario names of a project, in card order (form validation). */
export async function listScenarioNames(projectCode: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ name: whatIfScenarios.name })
    .from(whatIfScenarios)
    .innerJoin(projects, eq(projects.id, whatIfScenarios.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(whatIfScenarios.position));
  return rows.map((r) => r.name);
}

async function scenarioOf(projectCode: string, name: string, q?: Q) {
  const db = q ?? (await getDb());
  const [s] = await db
    .select({ id: whatIfScenarios.id, projectId: whatIfScenarios.projectId, priority: whatIfScenarios.priority })
    .from(whatIfScenarios)
    .innerJoin(projects, eq(projects.id, whatIfScenarios.projectId))
    .where(and(eq(projects.code, projectCode), eq(whatIfScenarios.name, name)));
  if (!s) throw new Error(`Unknown what-if scenario ${name} on ${projectCode}`);
  return s;
}

async function audit(q: Q, actorName: string | undefined, s: { id: string; projectId: string }, objectRef: string, change: string) {
  if (!actorName) return;
  const actor = await findPerson(q, actorName);
  await writeAudit(q, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef, change, area: WHATIF_AREA, entityType: 'whatif_scenario', entityId: s.id, projectId: s.projectId });
}

/**
 * Saves a scenario's levers: one `whatif_scenario_actions` row per derived lever (enabled flag; `params.leverCode` and the
 * lever's figures), and the computed effects (`result`, `computed_at`).
 */
async function saveScenarioLevers(tx: Tx, st: WhatIfState, scenarioId: string, enabled: readonly string[]): Promise<WhatIfResult> {
  const levers = st.model.levers;
  const [acts, people, depts] = await Promise.all([
    tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, st.projectId)),
    levers.some((l) => l.person) ? tx.select({ id: persons.id, full: persons.fullName, short: persons.shortName }).from(persons) : Promise.resolve([]),
    tx.select({ id: departments.id, name: departments.name }).from(departments),
  ]);
  const actId = new Map(acts.map((a) => [a.code, a.id]));
  const personId = (n: string | null) => (n ? (people.find((p) => p.full === n || p.short === n)?.id ?? null) : null);
  const deptId = (n: string | null) => (n ? (depts.find((d) => d.name === n)?.id ?? null) : null);
  // Owner answers 17 Oct 2026 (navigable horizon): the rows of levers this horizon does not derive (saved on another
  // horizon) are kept — saving on one horizon never drops what was enabled on another; this horizon's rows are replaced.
  const codes = new Set(levers.map((l) => l.code));
  const own = await tx.select({ id: whatIfScenarioActions.id, params: whatIfScenarioActions.params }).from(whatIfScenarioActions).where(eq(whatIfScenarioActions.scenarioId, scenarioId));
  const replaced = own.filter((r) => typeof r.params.leverCode !== 'string' || codes.has(r.params.leverCode)).map((r) => r.id);
  if (replaced.length) await tx.delete(whatIfScenarioActions).where(inArray(whatIfScenarioActions.id, replaced));
  if (levers.length)
    await tx.insert(whatIfScenarioActions).values(
      levers.map((l, position) => ({
        scenarioId, position, kind: l.kind, activityId: actId.get(l.activity) ?? null, personId: personId(l.person), departmentId: deptId(l.department),
        params: { leverCode: l.code, resource: l.resource, from: l.from, to: l.to, driving: l.driving, helper: l.helper }, enabled: enabled.includes(l.code), label: leverLabelEn(l),
      })),
    );
  const result = evaluateScenario(st.model, enabled);
  await tx.update(whatIfScenarios).set({ result: { ...result, levers: [...enabled], horizonStart: st.window.start }, computedAt: new Date(), updatedAt: new Date() }).where(eq(whatIfScenarios.id, scenarioId));
  return result;
}

const leverLabelEn = leverLabel;

/** The what-if state of a write: refused on a horizon entirely in the past (read-only, owner answers 17 Oct 2026). */
async function requireState(projectCode: string, horizon?: string | null): Promise<WhatIfState> {
  const st = await loadWhatIfState(projectCode, horizon);
  if (!st) throw new Error(`No what-if levelling for ${projectCode}`);
  if (st.past) throw new Error(`The what-if horizon ${st.window.start} is in the past`);
  return st;
}

async function enabledOf(st: WhatIfState, name: string, q?: Q): Promise<ScenarioRow> {
  const row = (await scenarioRows(st, q)).find((r) => r.row.name === name);
  if (!row) throw new Error(`Unknown what-if scenario ${name} on ${st.projectCode}`);
  return row;
}

/** Priority segment (does not change the levers, as in the prototype). Audited when `actorName` is given. */
export async function setScenarioPriority(projectCode: string, name: string, priority: WhatIfPriority, actorName?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    await tx.update(whatIfScenarios).set({ priority, updatedAt: new Date() }).where(eq(whatIfScenarios.id, s.id));
    await audit(tx, actorName, s, `Scenario ${name}`, `priority → ${whatIfPriority.label(priority)}`);
  });
}

/** Lever row click: toggles one derived lever of a scenario (saving the scenario's levers and effects). Returns the new state. */
export async function toggleScenarioLever(projectCode: string, name: string, lever: string, actorName?: string, horizon?: string | null): Promise<boolean> {
  const st = await requireState(projectCode, horizon);
  const l = st.model.levers.find((x) => x.code === lever);
  if (!l) throw new Error(`Unknown what-if lever ${lever} on ${projectCode}`);
  const sc = await enabledOf(st, name);
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Saved levers: flip the one row (concurrent toggles of other levers are kept); otherwise save every lever.
    const rows = await tx
      .select({ id: whatIfScenarioActions.id, params: whatIfScenarioActions.params, enabled: whatIfScenarioActions.enabled })
      .from(whatIfScenarioActions)
      .where(eq(whatIfScenarioActions.scenarioId, sc.row.id));
    const row = rows.find((r) => r.params.leverCode === lever);
    let on: boolean;
    if (row) {
      on = !row.enabled;
      await tx.update(whatIfScenarioActions).set({ enabled: on, updatedAt: new Date() }).where(eq(whatIfScenarioActions.id, row.id));
      const known = new Set(st.model.levers.map((x) => x.code));
      const next = rows.filter((r) => (r.id === row.id ? on : r.enabled)).map((r) => r.params.leverCode as string).filter((c) => known.has(c));
      const result = evaluateScenario(st.model, next);
      await tx.update(whatIfScenarios).set({ result: { ...result, levers: next, horizonStart: st.window.start }, computedAt: new Date(), updatedAt: new Date() }).where(eq(whatIfScenarios.id, sc.row.id));
    } else {
      on = !sc.enabled.includes(lever);
      await saveScenarioLevers(tx, st, sc.row.id, on ? [...sc.enabled, lever] : sc.enabled.filter((c) => c !== lever));
    }
    await audit(tx, actorName, sc.row, `Scenario ${name}`, `${on ? 'lever on' : 'lever off'}: ${leverLabelEn(l)}`);
    return on;
  });
}

/** "Auto-level for this priority": the scenario's levers become the derived set of its priority (domain autoLevel). */
export async function autoLevelScenario(projectCode: string, name: string, actorName?: string, horizon?: string | null): Promise<string[]> {
  const st = await requireState(projectCode, horizon);
  const sc = await enabledOf(st, name);
  const next = st.auto[sc.row.priority] ?? [];
  const db = await getDb();
  await db.transaction(async (tx) => {
    await saveScenarioLevers(tx, st, sc.row.id, next);
    await audit(tx, actorName, sc.row, `Scenario ${name}`, `auto-level (${whatIfPriority.label(sc.row.priority)}): ${next.length} levers`);
  });
  return next;
}

/** "Select scenario": marks it selected (the others unselected), audited by the viewer. `applyScenario` drafts the requests. */
export async function selectScenario(projectCode: string, name: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    await tx.update(whatIfScenarios).set({ selected: sql`${whatIfScenarios.id} = ${s.id}`, updatedAt: new Date() }).where(eq(whatIfScenarios.projectId, s.projectId));
    await audit(tx, actorName, s, `Scenario ${name}`, 'selected');
  });
}

export interface ApplyOutcome {
  /** Draft requests created ("RQ-045"…). */
  created: string[];
  /** Levers whose request already exists for the scenario (draft or sent), not drafted twice. */
  skipped: number;
  /** Enabled shifts: plan changes to enter before the next Reschedule (no request). */
  shifts: number;
}

/** Open (not closed) statuses: a lever with such a request is not drafted again. */
const OPEN_REQUEST = ['draft', 'pending', 'approved', 'reschedule'] as const;

async function draftRequests(
  tx: Tx, st: WhatIfState, drafts: WhatIfRequestDraft[], scenario: { id: string; name: string } | null, actorName: string, existing: { title: string; act: string | null }[],
) {
  const created: string[] = [];
  let skipped = 0;
  for (const d of drafts) {
    if (existing.some((e) => e.title === d.title && e.act === d.activity)) {
      skipped++;
      continue;
    }
    created.push(
      await createResourceRequest(
        {
          projectCode: st.projectCode, title: d.title, activityCode: d.activity, person: d.person ?? undefined, contractRole: d.contractRole ?? undefined, hours: d.hours,
          startDate: d.start, dueDate: d.due, priority: d.priority, note: scenario ? `Drafted from what-if scenario ${scenario.name}` : 'Drafted from a suggested rebalancing',
          draft: true, scenarioId: scenario?.id ?? null,
        },
        actorName,
        tx,
      ),
    );
  }
  return { created, skipped };
}

async function openRequests(q: Q, projectId: string, scenarioId?: string) {
  return q
    .select({ number: resourceRequests.number, title: resourceRequests.title, act: activities.code })
    .from(resourceRequests)
    .leftJoin(activities, eq(activities.id, resourceRequests.activityId))
    .where(and(eq(resourceRequests.projectId, projectId), inArray(resourceRequests.status, [...OPEN_REQUEST]), scenarioId ? eq(resourceRequests.scenarioId, scenarioId) : undefined));
}

/**
 * "Apply" / "Select scenario → create requests": turns the scenario's enabled levers into DRAFT resource requests through
 * the requests DAL (not sent to the departments until "Send"; the plan changes only at the next Reschedule), skips levers
 * already requested from this scenario, and — when it drafted something — stamps the scenario applied and records the
 * activity. The duplicate check, the drafts and the stamp run in ONE transaction: a double-click or a concurrent apply
 * finds the first one's drafts (transactions are SERIALIZABLE, src/server/db/transactions.ts — the second is run again on
 * fresh data), and a failure leaves no draft without the stamp.
 * `actorName` must be a person.
 */
export async function applyScenario(projectCode: string, name: string, actorName: string, horizon?: string | null): Promise<ApplyOutcome> {
  const st = await requireState(projectCode, horizon);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const sc = await enabledOf(st, name, tx);
    const drafts = scenarioRequests(st.model, sc.enabled);
    const shifts = st.model.levers.filter((l) => sc.enabled.includes(l.code) && !createsRequest(l)).length;
    const { created, skipped } = await draftRequests(tx, st, drafts, { id: sc.row.id, name }, actorName, await openRequests(tx, st.projectId, sc.row.id));
    if (!sc.saved) await saveScenarioLevers(tx, st, sc.row.id, sc.enabled);
    if (created.length) {
      await markScenarioApplied(st.projectCode, name, actorName, tx);
      const actor = await findPerson(tx, actorName);
      await recordActivity(tx, {
        actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, kind: 'request', projectId: st.projectId,
        text: `Drafted ${created.length} resource ${created.length === 1 ? 'request' : 'requests'} from what-if scenario ${name} · ${created.join(', ')}`,
      });
    }
    return { created, skipped, shifts };
  });
}

/** "Apply" on a Suggested rebalancing line: one DRAFT request for one lever (no scenario). Null when already requested. */
export async function applyLever(projectCode: string, lever: string, actorName: string): Promise<string | null> {
  const st = await requireState(projectCode);
  const l = st.model.levers.find((x) => x.code === lever);
  if (!l || !createsRequest(l)) throw new Error(`Unknown what-if lever ${lever} on ${projectCode}`);
  const db = await getDb();
  // One transaction: a double-click finds the first draft instead of drafting the lever twice.
  return db.transaction(async (tx) => {
    const { created } = await draftRequests(tx, st, scenarioRequests(st.model, [lever]), null, actorName, await openRequests(tx, st.projectId));
    if (!created.length) return null;
    const actor = await findPerson(tx, actorName);
    await recordActivity(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, kind: 'request', projectId: st.projectId,
      text: `Drafted ${created[0]} from a suggested rebalancing · ${leverLabelEn(l)}`,
    });
    return created[0];
  });
}

export interface NewScenarioInput {
  name: string;
  /** 'current_plan' (default: no lever) or 'last_approved' (the levers and priority of `retainedScenario`). Stored as given. */
  basis?: string;
  /** Kept for the stored column only: the form no longer asks for it (the horizon is the 8-week load window, R-085). */
  horizonMonths?: number;
  hypotheses?: string;
  priority?: WhatIfPriority;
}

/** Scenario the PM retained, the basis "last_approved" copies: the selected one, else the one applied last; null when none. */
export async function retainedScenario(projectCode: string, q?: Q): Promise<string | null> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ name: whatIfScenarios.name, selected: whatIfScenarios.selected, appliedAt: whatIfScenarios.appliedAt })
    .from(whatIfScenarios)
    .innerJoin(projects, eq(projects.id, whatIfScenarios.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(whatIfScenarios.position));
  const applied = rows.filter((r) => r.appliedAt).sort((a, b) => b.appliedAt!.getTime() - a.appliedAt!.getTime());
  return (rows.find((r) => r.selected) ?? applied[0])?.name ?? null;
}

/**
 * "New scenario" (AF.whatif), audited under the viewer when `actorName` is given: no lever enabled, or — basis
 * "last_approved" — the levers and priority of the retained scenario (refused when there is none).
 */
export async function createScenario(projectCode: string, input: NewScenarioInput, actorName?: string, horizon?: string | null): Promise<void> {
  const st = input.basis === 'last_approved' ? await requireState(projectCode, horizon) : null;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    let source: ScenarioRow | null = null;
    if (st) {
      const name = await retainedScenario(projectCode, tx);
      source = name ? ((await scenarioRows(st, tx)).find((r) => r.row.name === name) ?? null) : null;
      if (!source) throw new Error(`No selected or applied scenario on ${projectCode}`);
    }
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${whatIfScenarios.position}), -1)::int` }).from(whatIfScenarios).where(eq(whatIfScenarios.projectId, p.id));
    const actor = actorName ? await findPerson(tx, actorName) : null;
    const [s] = await tx
      .insert(whatIfScenarios)
      .values({
        projectId: p.id, name: input.name.trim(), priority: input.priority ?? source?.row.priority ?? 'date', basis: input.basis ?? null, horizonMonths: input.horizonMonths ?? null,
        hypotheses: input.hypotheses?.trim() || null, position: pos + 1, createdByPersonId: actor?.id ?? null, createdByName: actor ? nameOf(actor) : (actorName ?? null),
        // Saved with no lever: the seed's prototype lever codes never apply to it.
        computedAt: new Date(),
      })
      .returning({ id: whatIfScenarios.id });
    if (st && source) await saveScenarioLevers(tx, st, s.id, source.enabled);
    await audit(tx, actorName, { id: s.id, projectId: p.id }, `Scenario ${input.name.trim()}`, source ? `created from scenario ${source.row.name} (${source.enabled.length} levers)` : 'created');
  });
}

/** Renames a scenario (and replaces its hypotheses when given). */
export async function renameScenario(projectCode: string, name: string, input: { name: string; hypotheses?: string | null }, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    const next = input.name.trim();
    await tx
      .update(whatIfScenarios)
      .set({ name: next, ...(input.hypotheses !== undefined ? { hypotheses: input.hypotheses?.trim() || null } : {}), updatedAt: new Date() })
      .where(eq(whatIfScenarios.id, s.id));
    await audit(tx, actorName, s, `Scenario ${next}`, next === name ? 'hypotheses edited' : `renamed from ${name}`);
  });
}

/** Deletes a scenario (its levers go with it; requests it drafted stay, unlinked). */
export async function deleteScenario(projectCode: string, name: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    await tx.delete(whatIfScenarios).where(eq(whatIfScenarios.id, s.id));
    await audit(tx, actorName, { id: s.id, projectId: s.projectId }, `Scenario ${name}`, 'deleted');
  });
}

// ── Suggested rebalancing (Resources, Project resources) ─────────────────────────────────────────────────────────────

export interface RebalancingSuggestion {
  projectCode: string;
  /** EN source name ("Harbor Line Terminal Expansion") and short name ("Harbor Line"). */
  projectName: string;
  projectShortName: string | null;
  lever: WhatIfLever;
  /** The lever alone vs the current plan. */
  effect: WhatIfResult;
  /** Peak load of the project's current plan (effect "peak ±n pts"). */
  currentPeakPct: number;
  /** Open request already drafted / sent for this lever ("RQ-045"), else null. */
  requested: string | null;
}

/**
 * "Suggested rebalancing" (06 §1.4e, R-3): the levers that become a resource request, ranked (most days gained, most relief
 * of overloaded people, cheapest) — of one project, or of every project with a plan (portfolio Resources).
 */
export async function getRebalancingSuggestions(opts: { projectCode?: string; limit?: number } = {}): Promise<RebalancingSuggestion[]> {
  const db = await getDb();
  const list = await db
    .selectDistinct({ id: projects.id, code: projects.code, name: projects.name, short: projects.shortName, pos: projects.sortOrder })
    .from(projects)
    .innerJoin(activities, eq(activities.projectId, projects.id))
    .where(opts.projectCode ? eq(projects.code, opts.projectCode) : undefined)
    .orderBy(asc(projects.sortOrder));
  const rows: RebalancingSuggestion[] = [];
  for (const p of list) {
    const st = await loadWhatIfState(p.code);
    if (!st) continue;
    const open = await openRequests(db, p.id);
    for (const lever of st.model.levers) {
      if (!createsRequest(lever)) continue;
      const effect = st.effects[lever.code];
      if (!effect || effect.error || (effect.daysGained <= 0 && effect.overloadDeltaH >= 0)) continue;
      const titles = scenarioRequests(st.model, [lever.code]).map((d) => d.title);
      const hit = open.find((o) => o.act === lever.activity && titles.includes(o.title));
      rows.push({ projectCode: p.code, projectName: p.name, projectShortName: p.short, lever, effect, currentPeakPct: st.model.current.peakPct, requested: hit?.number ?? null });
    }
  }
  return rankLevers(rows).slice(0, opts.limit ?? 3);
}
