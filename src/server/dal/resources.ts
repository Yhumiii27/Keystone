import 'server-only';
// Resources DAL (docs/spec/06 §1, 05 §4, 11 §3.6 Allocation): the shared resource pool with its weekly loads over
// the 8-week window, departments with head and capacity, project teams, labour cost of a project, and what-if
// levelling (levers, auto-level rules, scenarios) with its writers.
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Tx } from '@/server/db/client';
import { isoOfDisplayDate, weekLabelOfIso, whatIfPriority, type WhatIfLeverCode, type WhatIfPriority } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import {
  allocations, baselines, costCategories, departmentCapacities, departments, persons, projectControls, projectMembers, projects, wbsNodes,
  whatIfAutoLevers, whatIfContexts, whatIfLevers, whatIfScenarioLevers, whatIfScenarios,
} from '@/server/db/schema';

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

async function poolRows(personIds?: string[]) {
  const db = await getDb();
  const rows = await db
    .select({ p: persons, dept: departments.name })
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(isNotNull(persons.resourcePoolPosition))
    .orderBy(asc(persons.resourcePoolPosition));
  const allocs = await db
    .select({ personId: allocations.personId, weekStart: allocations.weekStart, loadPct: allocations.loadPct })
    .from(allocations)
    .where(isNull(allocations.projectId))
    .orderBy(asc(allocations.weekStart));
  const weekStarts = [...new Set(allocs.map((a) => a.weekStart))].sort();
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

/** The shared pool: every person with a pool position, with the 8 weekly loads (Resources heatmap). */
export async function getResourcePool(): Promise<ResourcePool> {
  const { weekStarts, people } = await poolRows();
  return { weeks: weekStarts.map((start) => ({ start, label: weekLabelOfIso(start) })), people };
}

/**
 * Team of a project (projectData().team order) with their loads — Project resources. Members outside the pool
 * get zero loads. Empty for projects without a team.
 */
export async function getProjectTeam(projectCode: string): Promise<PoolPerson[]> {
  const db = await getDb();
  const members = await db
    .select({ p: persons, dept: departments.name })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(persons, eq(persons.id, projectMembers.personId))
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(projectMembers.position));
  const { toPerson } = await poolRows([]);
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

/** First cost category of a project whose name matches /labor|staff/i (Resources KPI "Labor cost to date"). */
export async function getLaborCost(projectCode: string): Promise<LaborCost | null> {
  const db = await getDb();
  const cats = await db
    .select({ name: costCategories.name, budget: costCategories.budgetKeur, actual: costCategories.actualKeur })
    .from(costCategories)
    .innerJoin(projects, eq(projects.id, costCategories.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(costCategories.position));
  return cats.find((c) => /labor|staff/i.test(c.name)) ?? null;
}

// ── What-if levelling ──────────────────────────────────────────────────────────────────────────────────

export interface WhatIfLever {
  code: WhatIfLeverCode;
  /** EN source string. */
  label: string;
  floatDays: number;
  costKeur: number;
  peakPts: number;
  overPeople: number;
  sideEffect: string | null;
}

export interface WhatIfScenario {
  /** "A". */
  name: string;
  priority: WhatIfPriority;
  /** 'Protect date' | 'Protect budget' | 'Protect people'. */
  priorityLabel: string;
  selected: boolean;
  /** Lever code → enabled, in lever order. */
  levers: Record<string, boolean>;
  basis: string | null;
  horizonMonths: number | null;
  hypotheses: string | null;
}

export interface WhatIf {
  projectCode: string;
  levers: WhatIfLever[];
  /** AUTO: levers set by "Auto-level for this priority". */
  autoLevers: Record<WhatIfPriority, WhatIfLeverCode[]>;
  weeks: ResourceWeek[];
  /** Peak-load profile the bars start from (8 values). */
  baseLoad: number[];
  scenarios: WhatIfScenario[];
  /** Current forecast finish (WBS root finish, "14 Jan ’27" → ISO), float (days), current baseline finish. */
  forecastFinish: string | null;
  floatDays: number | null;
  baselineFinish: string | null;
  /** Peak weekly load of the pool and who / when (KPI "Peak load 130% · Julien Wagner · week of 12 Oct"). */
  peak: { pct: number; person: string; weekStart: string } | null;
  /**
   * People above 100 % per window week ([0, 1, 2, 3, 2, 0, 1, 0]). The prototype's KPI "People above 100% · 3 ·
   * Weeks 41–43" is a static string (OPEN QUESTION A-12); 3 is the most in any one week.
   */
  overByWeek: number[];
}

/** What-if levelling of a project (HLT-026 in the prototype); null when the project has no levelling context. */
export async function getWhatIf(projectCode: string): Promise<WhatIf | null> {
  const db = await getDb();
  const [ctx] = await db
    .select({ c: whatIfContexts, projectId: projects.id, float: projectControls.floatDays })
    .from(whatIfContexts)
    .innerJoin(projects, eq(projects.id, whatIfContexts.projectId))
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!ctx) return null;
  const pid = ctx.projectId;
  const [levers, auto, scen, scenLevers, [root], [bl], pool] = await Promise.all([
    db.select().from(whatIfLevers).orderBy(asc(whatIfLevers.position)),
    db.select().from(whatIfAutoLevers).orderBy(asc(whatIfAutoLevers.position)),
    db.select().from(whatIfScenarios).where(eq(whatIfScenarios.projectId, pid)).orderBy(asc(whatIfScenarios.position)),
    db.select({ l: whatIfScenarioLevers }).from(whatIfScenarioLevers).innerJoin(whatIfScenarios, eq(whatIfScenarios.id, whatIfScenarioLevers.scenarioId)).where(eq(whatIfScenarios.projectId, pid)),
    db.select({ finish: wbsNodes.finishText }).from(wbsNodes).where(and(eq(wbsNodes.projectId, pid), eq(wbsNodes.level, 0))),
    db.select({ finish: baselines.finishDate }).from(baselines).where(and(eq(baselines.projectId, pid), eq(baselines.state, 'current'))),
    getResourcePool(),
  ]);
  const autoLevers = { date: [], budget: [], people: [] } as Record<WhatIfPriority, WhatIfLeverCode[]>;
  for (const a of auto) autoLevers[a.priority].push(a.leverCode);
  let peak: WhatIf['peak'] = null;
  for (const p of pool.people)
    p.loads.forEach((v, i) => {
      if (!peak || v > peak.pct) peak = { pct: v, person: p.name, weekStart: pool.weeks[i].start };
    });
  return {
    projectCode,
    levers: levers.map((l) => ({ code: l.code, label: l.label, floatDays: l.floatDays, costKeur: l.costKeur, peakPts: l.peakPts, overPeople: l.overPeople, sideEffect: l.sideEffect })),
    autoLevers,
    weeks: ctx.c.peakLoad.map((_, i) => {
      const start = pool.weeks[i]?.start ?? ctx.c.weekStart;
      return { start, label: weekLabelOfIso(start) };
    }),
    baseLoad: ctx.c.peakLoad,
    scenarios: scen.map((s) => ({
      name: s.name, priority: s.priority, priorityLabel: whatIfPriority.label(s.priority), selected: s.selected,
      levers: Object.fromEntries(levers.map((l) => [l.code, !!scenLevers.find((x) => x.l.scenarioId === s.id && x.l.leverCode === l.code)?.l.enabled])),
      basis: s.basis, horizonMonths: s.horizonMonths, hypotheses: s.hypotheses,
    })),
    forecastFinish: root?.finish ? isoOfDisplayDate(root.finish) : null,
    floatDays: ctx.float ?? null,
    baselineFinish: bl?.finish ?? null,
    peak,
    overByWeek: pool.weeks.map((_, i) => pool.people.filter((p) => p.loads[i] > 100).length),
  };
}

async function scenarioOf(projectCode: string, name: string, q?: Tx) {
  const db = q ?? (await getDb());
  const [s] = await db
    .select({ id: whatIfScenarios.id, projectId: whatIfScenarios.projectId })
    .from(whatIfScenarios)
    .innerJoin(projects, eq(projects.id, whatIfScenarios.projectId))
    .where(and(eq(projects.code, projectCode), eq(whatIfScenarios.name, name)));
  if (!s) throw new Error(`Unknown what-if scenario ${name} on ${projectCode}`);
  return s;
}

/** Priority segment (does not change the levers, as in the prototype). */
export async function setScenarioPriority(projectCode: string, name: string, priority: WhatIfPriority): Promise<void> {
  const db = await getDb();
  const s = await scenarioOf(projectCode, name);
  await db.update(whatIfScenarios).set({ priority, updatedAt: new Date() }).where(eq(whatIfScenarios.id, s.id));
}

/** Lever row click: toggles one lever of a scenario. */
export async function toggleScenarioLever(projectCode: string, name: string, lever: WhatIfLeverCode): Promise<boolean> {
  const db = await getDb();
  const s = await scenarioOf(projectCode, name);
  const [cur] = await db.select({ enabled: whatIfScenarioLevers.enabled }).from(whatIfScenarioLevers).where(and(eq(whatIfScenarioLevers.scenarioId, s.id), eq(whatIfScenarioLevers.leverCode, lever)));
  const enabled = !cur?.enabled;
  await db
    .insert(whatIfScenarioLevers)
    .values({ scenarioId: s.id, leverCode: lever, enabled })
    .onConflictDoUpdate({ target: [whatIfScenarioLevers.scenarioId, whatIfScenarioLevers.leverCode], set: { enabled } });
  return enabled;
}

/** "Auto-level for this priority": the scenario's levers become exactly AUTO[priority]. */
export async function autoLevelScenario(projectCode: string, name: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    const [sc] = await tx.select({ priority: whatIfScenarios.priority }).from(whatIfScenarios).where(eq(whatIfScenarios.id, s.id));
    const auto = (await tx.select({ code: whatIfAutoLevers.leverCode }).from(whatIfAutoLevers).where(eq(whatIfAutoLevers.priority, sc.priority))).map((a) => a.code);
    const levers = await tx.select({ code: whatIfLevers.code }).from(whatIfLevers);
    for (const l of levers)
      await tx
        .insert(whatIfScenarioLevers)
        .values({ scenarioId: s.id, leverCode: l.code, enabled: auto.includes(l.code) })
        .onConflictDoUpdate({ target: [whatIfScenarioLevers.scenarioId, whatIfScenarioLevers.leverCode], set: { enabled: auto.includes(l.code) } });
  });
}

/** "Select scenario → create requests": marks it selected (the others unselected). Requests are not created (05 §4.5). */
export async function selectScenario(projectCode: string, name: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await scenarioOf(projectCode, name, tx);
    await tx.update(whatIfScenarios).set({ selected: sql`${whatIfScenarios.id} = ${s.id}`, updatedAt: new Date() }).where(eq(whatIfScenarios.projectId, s.projectId));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Scenario ${name}`, change: 'selected', area: 'What-if levelling', entityType: 'whatif_scenario', entityId: s.id, projectId: s.projectId });
  });
}

export interface NewScenarioInput {
  name: string;
  basis?: string;
  horizonMonths?: number;
  hypotheses?: string;
  priority?: WhatIfPriority;
}

/** "New scenario" (AF.whatif): a scenario with no lever enabled, audited under the viewer when `actorName` is given. */
export async function createScenario(projectCode: string, input: NewScenarioInput, actorName?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${whatIfScenarios.position}), -1)::int` }).from(whatIfScenarios).where(eq(whatIfScenarios.projectId, p.id));
    const [s] = await tx
      .insert(whatIfScenarios)
      .values({
        projectId: p.id, name: input.name.trim(), priority: input.priority ?? 'date', basis: input.basis ?? null, horizonMonths: input.horizonMonths ?? null,
        hypotheses: input.hypotheses?.trim() || null, position: pos + 1,
      })
      .returning({ id: whatIfScenarios.id });
    const levers = await tx.select({ code: whatIfLevers.code }).from(whatIfLevers);
    if (levers.length) await tx.insert(whatIfScenarioLevers).values(levers.map((l) => ({ scenarioId: s.id, leverCode: l.code, enabled: false })));
    if (actorName) {
      const actor = await findPerson(tx, actorName);
      await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Scenario ${input.name.trim()}`, change: 'created', area: 'What-if levelling', entityType: 'whatif_scenario', entityId: s.id, projectId: p.id });
    }
  });
}
