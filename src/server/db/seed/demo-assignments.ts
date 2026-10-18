// Demo seed: named person assignments on the demo schedules (owner answer 18 Oct 2026, fourth round: « Ajouter des
// affectations nominatives aux plannings de démo : oui »). Since R-084 a person's load is the hours the schedules assign them
// (src/domain/planning-load.ts); the prototype names one person on a schedule (Julien Wagner on HLT-026 A1250, A1250_RES), so the
// load screens were nearly empty. These rows put the eight people of the resource pool on the activities of the six projects
// that have a schedule, so that the Resources heatmap at the demo date (Fri 25 Sep 2026) roughly reproduces the prototype's
// picture.
//
// Derivation (done once, offline; the table below is the result, so the seed stays deterministic and readable):
// - Target: each person's weekly allocation in the prototype (PEOPLE: % of the 40 h week for the 8 weeks from w/c 28 Sep), the
//   week of 21 Sep taking the first week's value (the current week is not empty).
// - Candidates: the activities the person OWNS in the window (the prototype's activity owners — every owner is one of the eight)
//   plus activities of the same projects that call on their trade and skills (department, job title, skills matrix: Julien
//   Wagner, structural 5 / crane 4, on crane delivery & rigging and load tests; Hélène Sauvage, QA/QC, on the inspections,
//   tests and handovers; Fabien Bertrand, procurement, on the procurement activities; Thomas Kerbrat, crane operations, on the
//   lifts).
// - Hours per day: a bounded least-squares fit of Σ (h/d × working days of each activity in the week) to the target, at 0.5 h
//   steps between 0.5 and 8 h/d, then a local search keeping who is above 110 % in which week as in the prototype.
// Result on the window 21 Sep – 9 Nov (default R-085 window at 25 Sep): team utilization 84 % (83 % on the prototype's window
// 28 Sep – 16 Nov, as the prototype); three people over 110 % in weeks 42–44 (Amélie Ollivier 131 % in week 42, Julien Wagner
// 125 · 125 in weeks 42–43, Pauline Noguès 113 · 113 in weeks 43–44), as the prototype; Julien Wagner 100 · 100 · 106 · 125 · 125 ·
// 108 · 88 · 65 (prototype 0 · 90 · 100 · 130 · 125 · 110 · 100 · 80: A1250's "40 h/wk" until 9 Oct is the prototype's own
// assignment, so the first weeks cannot be lower). Hélène Sauvage's fire-detection rate was lowered by hand (6.5 → 5 h/d) so
// nobody else crosses 110 % in week 47. Golden values in src/server/dal/planning-load.test.ts.
//
// Left without an assignment on purpose (owner answer 18 Oct 2026: the J-15 alert): HLT-026 A1410 "HV connection & switchgear"
// (Pauline Noguès owns it; started 17 Aug) — the Project resources card and the PM's morning notice show the rule. Activities
// starting after the window keep their owner only.
//
// The quantities are numbers (1 × h/d, planned hours = h/d × the activity's original duration, actual = planned × % complete),
// the department is the person's (as the table import does). Production seed unchanged.
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { activities, activityAssignments, persons, projects } from '../schema';
import type { DB, Tx } from '../types';

/** Person (full name) → [project code, activity code, hours per day][]. */
export const DEMO_ASSIGNMENTS: readonly [string, readonly (readonly [string, string, number])[]][] = [
  ['Amélie Ollivier', [['HLT-026', 'A1320', 1], ['HLT-026', 'A1510', 0.5], ['HLT-026', 'A1520', 0.5], ['RCF-019', 'A2340', 0.5], ['RCF-019', 'A2610', 4], ['WSA-044', 'A5220', 7.5], ['WSA-044', 'A5230', 7.5], ['WSA-044', 'A5410', 0.5]]],
  ['Julien Wagner', [['HLT-026', 'A1260', 0.5], ['HLT-026', 'A1320', 7.5], ['HLT-026', 'A1330', 6.5], ['MSR-012', 'A6540', 0.5], ['RCF-019', 'A2440', 1.5]]],
  ['Pauline Noguès', [['HLT-026', 'A1420', 2.5], ['HLT-026', 'A1430', 4], ['NDC-031', 'A3230', 0.5], ['NDC-031', 'A3510', 0.5], ['RCF-019', 'A2430', 0.5], ['RCF-019', 'A2520', 4.5], ['RCF-019', 'A2530', 4], ['WSA-044', 'A5310', 2]]],
  ['Thomas Kerbrat', [['HLT-026', 'A1260', 2.5], ['HLT-026', 'A1320', 2], ['HLT-026', 'A1330', 0.5], ['HLT-026', 'A1510', 0.5], ['WSA-044', 'A5220', 4], ['WSA-044', 'A5230', 1.5]]],
  ['Léa Marchand', [['ERP-202', 'A4140', 1], ['ERP-202', 'A4320', 1.5], ['ERP-202', 'A4330', 2.5], ['ERP-202', 'A4510', 0.5], ['NDC-031', 'A3320', 2], ['NDC-031', 'A3330', 3.5]]],
  ['Damien Roux', [['ERP-202', 'A4230', 0.5], ['ERP-202', 'A4240', 0.5], ['ERP-202', 'A4410', 5.5], ['ERP-202', 'A4420', 5], ['ERP-202', 'A4430', 6], ['MSR-012', 'A6610', 1.5], ['MSR-012', 'A6620', 1], ['MSR-012', 'A6630', 0.5], ['MSR-012', 'A6640', 0.5], ['NDC-031', 'A3230', 1], ['NDC-031', 'A3240', 0.5]]],
  ['Hélène Sauvage', [['HLT-026', 'A1330', 2.5], ['HLT-026', 'A1430', 5], ['MSR-012', 'A6530', 0.5], ['MSR-012', 'A6540', 3], ['MSR-012', 'A6630', 5.5], ['NDC-031', 'A3240', 1.5], ['RCF-019', 'A2430', 3], ['RCF-019', 'A2440', 0.5], ['RCF-019', 'A2540', 0.5]]],
  ['Fabien Bertrand', [['NDC-031', 'A3410', 4], ['NDC-031', 'A3420', 4.5], ['NDC-031', 'A3430', 1], ['NDC-031', 'A3520', 1.5], ['RCF-019', 'A2520', 1], ['WSA-044', 'A5140', 0.5], ['WSA-044', 'A5220', 2.5], ['WSA-044', 'A5320', 1]]],
];

const fmtH = (h: number) => Math.round(h).toLocaleString('en-US');
const fmtN = (n: number) => String(n);

/**
 * Inserts the demo assignments against the database's own people and activities (fresh demo seed, and the backfill of a demo
 * database seeded before). An activity or a person missing, or already assigned to that person, is skipped. Returns the rows added.
 */
export async function seedDemoAssignments(tx: Tx): Promise<number> {
  const names = DEMO_ASSIGNMENTS.map(([n]) => n);
  const codes = [...new Set(DEMO_ASSIGNMENTS.flatMap(([, list]) => list.map(([p]) => p)))];
  const [people, acts, existing] = await Promise.all([
    tx.select({ id: persons.id, name: persons.fullName, title: persons.jobTitle, dept: persons.departmentId }).from(persons).where(inArray(persons.fullName, names)),
    tx
      .select({ id: activities.id, project: projects.code, code: activities.code, dur: activities.durationDays, pc: activities.percentComplete })
      .from(activities)
      .innerJoin(projects, eq(projects.id, activities.projectId))
      .where(inArray(projects.code, codes)),
    tx
      .select({ act: activityAssignments.activityId, person: activityAssignments.personId, pos: sql<number>`max(${activityAssignments.position})::int` })
      .from(activityAssignments)
      .groupBy(activityAssignments.activityId, activityAssignments.personId),
  ]);
  const personOf = new Map(people.map((p) => [p.name, p]));
  const actOf = new Map(acts.map((a) => [`${a.project}|${a.code}`, a]));
  const has = new Set(existing.map((e) => `${e.act}|${e.person}`));
  const nextPos = new Map<string, number>();
  for (const e of existing) nextPos.set(e.act, Math.max(nextPos.get(e.act) ?? 0, e.pos + 1));
  const rows: (typeof activityAssignments.$inferInsert)[] = [];
  for (const [name, list] of DEMO_ASSIGNMENTS) {
    const p = personOf.get(name);
    if (!p) continue;
    for (const [project, code, hpd] of list) {
      const a = actOf.get(`${project}|${code}`);
      if (!a || has.has(`${a.id}|${p.id}`)) continue;
      const planned = hpd * a.dur;
      const actual = Math.round((planned * a.pc) / 100);
      const position = nextPos.get(a.id) ?? 0;
      nextPos.set(a.id, position + 1);
      rows.push({
        activityId: a.id, position, resource: name, personId: p.id, detail: p.title ?? '', units: `1 × ${fmtN(hpd)} h/d`,
        progressText: `${fmtH(actual)} / ${fmtH(planned)} h`, plannedHours: planned, actualHours: actual, resourceCount: 1, hoursPerDay: hpd, departmentId: p.dept,
      });
    }
  }
  if (rows.length) await tx.insert(activityAssignments).values(rows);
  return rows.length;
}

/**
 * A demo database seeded before these assignments: at most one named assignment (the prototype's Julien Wagner on A1250) and
 * the demo activities present. Backfilled once (index.ts); a database whose schedules name more people is left as it is.
 */
export async function demoAssignmentsToBackfill(db: DB | Tx): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(activityAssignments).where(isNotNull(activityAssignments.personId));
  if (n > 1) return false;
  const [{ a }] = await db
    .select({ a: sql<number>`count(*)::int` })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(and(eq(projects.code, 'HLT-026'), eq(activities.code, 'A1320')));
  return a > 0;
}
