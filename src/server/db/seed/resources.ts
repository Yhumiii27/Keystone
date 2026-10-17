// Resources and HR seed: weekly allocations (PEOPLE), the dated rate grid (RATE_ROLES, MULTS — R-083), skills
// (SKILLS, SKILL_LV, CERTS), leave (LEAVE_DAYS, LEAVE) and public holidays (SETTINGS0.holidays), Lucca hours
// (HOURS) and what-if levelling (LEVERS, AUTO, the HLT-026 scenarios of the initial state). See schema/resources.ts.
import { PROTO } from '@/server/prototype';
import { LEAVE_TYPE_ROWS } from '@/domain/absences';
import { addDaysIso, hoursMatching, isoOfDemoDate, leaveTypeOfNature, whatIfPriority, type WhatIfPriority } from '../codes';
import { sql } from 'drizzle-orm';
import { RATE_GRID_START, RATE_MULTIPLIER_DEFAULTS } from '@/domain/rate-defaults';
import {
  allocations, certifications, hoursImports, hoursLines, leaveEntries, leaveTypes, personSkills, persons, publicHolidays, rateMultiplierRates, rateMultipliers,
  rateRoleRates, rateRoles, skills, unassignedHours, whatIfAutoLevers, whatIfContexts, whatIfLevers, whatIfScenarioLevers, whatIfScenarios,
} from '../schema';
import type { DB, Tx } from '../types';
import { must, newId, personId, type SeedCtx } from './context';

/** Monday of the first week of the 8-week resource window (w/c 28 Sep 2026; `weeks` 5182). */
export const RESOURCE_WINDOW_START = '2026-09-28';
export const RESOURCE_WEEKS = 8;
export const resourceWeekStart = (i: number) => addDaysIso(RESOURCE_WINDOW_START, 7 * i);

/** Peak-load profile of the HLT-026 levelling scenarios (hard-coded in logic 4409–4416). */
export const WHATIF_BASE_LOAD = [100, 110, 130, 125, 110, 100, 80, 60];
/** Initial scenarios (state.whatif, line 3774). */
export const WHATIF_SCENARIOS: { name: string; priority: WhatIfPriority; levers: string[] }[] = [
  { name: 'A', priority: 'date', levers: ['contractor', 'overtime'] },
  { name: 'B', priority: 'people', levers: ['delay', 'move'] },
];

/** The skills matrix columns (SKILLS = the Settings skills list), in order. */
export const skillRowsOf = () => (PROTO.SKILLS as string[]).map((name, i) => ({ id: newId(), name, position: i + 1 }));

/**
 * Reference data of both seeds (R-011): skills, leave types, public holidays (Settings holiday list) and the what-if
 * levelling levers. Returns the skill rows (the demo rates people against them).
 */
export async function seedResourceReference(tx: Tx): Promise<{ id: string; name: string; position: number }[]> {
  const skillRows = skillRowsOf();
  await tx.insert(skills).values(skillRows);
  // NEW-CURSUS-4 (R-031, R-173): two simple types, Leave and Absence — never the reason of an absence.
  await tx.insert(leaveTypes).values(LEAVE_TYPE_ROWS.map((t, i) => ({ code: t.code, label: t.label, daysPerWeek: t.daysPerWeek, position: i + 1 })));
  await tx.insert(publicHolidays).values(
    (PROTO.SETTINGS0.holidays as string[]).map((h, i) => {
      const [day, name] = h.split(' · ');
      return { id: newId(), countryCode: 'FR', date: isoOfDemoDate(day)!, name, position: i + 1 };
    }),
  );
  await tx.insert(whatIfLevers).values(
    (PROTO.LEVERS as [string, string, { float: number; cost: number; peak: number; over: number; side?: string }][]).map(([code, label, e], i) => ({
      code, label, floatDays: e.float, costKeur: e.cost, peakPts: e.peak, overPeople: e.over, sideEffect: e.side ?? null, position: i + 1,
    })),
  );
  await tx.insert(whatIfAutoLevers).values(
    Object.entries(PROTO.AUTO as Record<string, string[]>).flatMap(([prio, levers]) =>
      levers.map((leverCode, position) => {
        if (!whatIfPriority.isCode(prio)) throw new Error(`Seed: unknown what-if priority "${prio}"`);
        return { priority: prio, leverCode, position };
      }),
    ),
  );
  return skillRows;
}

/**
 * R-178 / R-083: the five premium multipliers (shared constant RATE_MULTIPLIER_DEFAULTS — placeholder factors for the direction to
 * confirm) with their first versions from RATE_GRID_START. Idempotent and production-safe: a missing key is added, an existing
 * multiplier (and any factor edited since) is never overwritten. Used by the demo seed, the production seed and its backfill.
 * Returns the number of multipliers added.
 */
export async function seedRateMultipliers(q: Tx | DB): Promise<number> {
  const added = await q
    .insert(rateMultipliers)
    .values(RATE_MULTIPLIER_DEFAULTS.map(({ key, label }, i) => ({ key, label, position: i + 1 })))
    .onConflictDoNothing()
    .returning({ key: rateMultipliers.key });
  if (!added.length) return 0;
  const keys = new Set(added.map((a) => a.key));
  await q
    .insert(rateMultiplierRates)
    .values(RATE_MULTIPLIER_DEFAULTS.filter((m) => keys.has(m.key)).map(({ key, factor }) => ({ key, effectiveFrom: RATE_GRID_START, factor })))
    .onConflictDoNothing();
  return added.length;
}

export async function seedResources(tx: Tx, ctx: SeedCtx): Promise<void> {
  const people = PROTO.PEOPLE as [string, string, number[]][];
  const skillRows = await seedResourceReference(tx);

  // Allocations: 8 persons × 8 weeks.
  await tx.insert(allocations).values(
    people.flatMap(([name, , loads]) =>
      loads.map((loadPct, i) => ({ id: newId(), personId: personId(ctx, name), weekStart: resourceWeekStart(i), loadPct, projectId: null })),
    ),
  );

  // Rates (R-083: the grid is dated — the prototype's RATE_ROLES are first versions from 1 Jan 2026; a person gets the grid role
  // named exactly as their job title). The prototype's job-title rates (RATES) are retired (A-10: one valuation of hours).
  const roleRows = (PROTO.RATE_ROLES as [string, number][]).map(([role, rate], i) => ({ id: newId(), role, rate, isExternal: /external/.test(role), position: i + 1 }));
  await tx.insert(rateRoles).values(roleRows.map(({ id, role, isExternal, position }) => ({ id, role, isExternal, position })));
  await tx.insert(rateRoleRates).values(roleRows.map((r) => ({ rateRoleId: r.id, effectiveFrom: RATE_GRID_START, baseRateEur: r.rate })));
  await seedRateMultipliers(tx);
  await tx.execute(sql`update ${persons} set rate_role_id = r.id from ${rateRoles} r where ${persons.rateRoleId} is null and ${persons.jobTitle} = r.role`);

  // Skill levels, certifications (the skills are reference data).
  await tx.insert(personSkills).values(
    Object.entries(PROTO.SKILL_LV as Record<string, number[]>).flatMap(([name, levels]) =>
      levels.map((level, i) => ({ personId: personId(ctx, name), skillId: skillRows[i].id, level })),
    ),
  );
  await tx.insert(certifications).values(
    Object.entries(PROTO.CERTS as Record<string, string>).flatMap(([name, text]) =>
      text.split(' · ').map((cert, position) => ({ id: newId(), personId: personId(ctx, name), name: cert, position })),
    ),
  );

  // Leave (leave types and public holidays are reference data). NEW-CURSUS-4: the prototype's CP / RTT weeks are Leave,
  // its Sick / Training weeks Absence; their working days are kept (availability and KPIs unchanged).
  const leaveDays = PROTO.LEAVE_DAYS as Record<string, number>;
  const leaveRows = Object.entries(PROTO.LEAVE as Record<string, Record<string, string>>).flatMap(([name, byWeek]) =>
    Object.entries(byWeek).map(([week, label]) => {
      const weekStart = resourceWeekStart(+week);
      const days = leaveDays[label];
      return {
        id: newId(), personId: personId(ctx, name), leaveType: leaveTypeOfNature(label), weekStart, startDate: weekStart,
        endDate: addDaysIso(weekStart, days - 1), days,
      };
    }),
  );
  await tx.insert(leaveEntries).values(leaveRows);

  // Lucca hours (HLT-026, September 2026).
  for (const [code, h] of Object.entries(PROTO.HOURS as Record<string, { imported: string; code: string; lines: [string, string, number, number][]; unassigned: [string, number, string][] }>)) {
    const importId = newId();
    const wbs = must(ctx.wbs, code, 'project WBS');
    await tx.insert(hoursImports).values({
      id: importId, projectId: must(ctx.projectByCode, code, 'project'), analyticCode: h.code, periodStart: '2026-09-01',
      importedOn: isoOfDemoDate(h.imported)!, matchingMode: hoursMatching.code('Resource × work package (planning)'),
    });
    await tx.insert(hoursLines).values(
      h.lines.map(([person, wbsLabel, plannedH, declaredH], position) => ({
        id: newId(), importId, personId: personId(ctx, person), wbsNodeId: wbs.get(wbsLabel.split(' · ')[0]) ?? null, wbsLabel, plannedH, declaredH, position,
      })),
    );
    await tx.insert(unassignedHours).values(
      h.unassigned.map(([person, hours, reason], position) => ({ id: newId(), importId, personId: personId(ctx, person), hours, reason, position })),
    );
  }

  // What-if levelling (the levers are reference data): the HLT-026 context and scenarios.
  const hlt = must(ctx.projectByCode, 'HLT-026', 'project');
  await tx.insert(whatIfContexts).values({ projectId: hlt, weekStart: RESOURCE_WINDOW_START, peakLoad: WHATIF_BASE_LOAD });
  const allLevers = (PROTO.LEVERS as [string][]).map(([code]) => code);
  for (const [position, s] of WHATIF_SCENARIOS.entries()) {
    const scenarioId = newId();
    await tx.insert(whatIfScenarios).values({ id: scenarioId, projectId: hlt, name: s.name, priority: s.priority, position });
    await tx.insert(whatIfScenarioLevers).values(allLevers.map((leverCode) => ({ scenarioId, leverCode, enabled: s.levers.includes(leverCode) })));
  }
}
