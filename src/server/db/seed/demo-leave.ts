// Demo seed: the seeded leave, shifted off the named demo assignments. R-084 (absences), owner 22 Oct 2026: demo leave shifted
// off the assignments (option 1 of docs/delivery-9/notes-cursus-contract.md §2).
//
// Since R-084 (absences) a week's capacity is 40 h less 8 h per day off; the prototype's LEAVE (src/server/prototype, kept as the
// golden reference of the pure tests) was never meant to meet the demo assignments (./demo-assignments.ts), so a full week of CP
// on a loaded week read 200 % and more. The same people keep the same leave — type and number of days — on other weeks, chosen
// against the assigned hours per person-week (done once, offline): a full week of leave on a week with no hours assigned, a day
// or two on a light week (at most 100 % left), never on a week with a public holiday (25 Dec, 1 Jan, 11 Nov), and a few days in
// the default load window so that Leave & calendar, its week view and the site conflicts still show leave.
//
// Week indexes from the resource window's first Monday (28 Sep 2026, ./resources.ts `resourceWeekStart`); prototype → demo:
// - Amélie Ollivier CP 12 and 19 Oct (2, 3; 53 h and 43 h assigned)           → 7 and 14 Dec (10, 11; 0 h)
// - Thomas Kerbrat CP 26 Oct and 2 Nov (4, 5; 30 h, 23 h)                        → 23 and 30 Nov (8, 9; 0 h)
// - Pauline Noguès Training 3 days 28 Sep (0; 32 h), CP 2 Nov (5; 41 h)          → Training 11 Jan 2027 (15), CP 4 Jan 2027 (14; 0 h)
// - Fabien Bertrand CP 9 and 16 Nov (6, 7; 14 h, 18 h; Wed 11 Nov a holiday)     → 4 and 11 Jan 2027 (14, 15; 0 h)
// - Léa Marchand RTT 5 Oct (1; 29 h, kept) and 16 Nov (7; 33 h)                  → 5 Oct and 23 Nov (1, 8; 6 h)
// - Hélène Sauvage Sick 2 days 19 Oct (3; 31 h)                                  → 28 Sep (0; 18 h)
// - Julien Wagner RTT 9 Nov (6; 26 h) kept (the site sheet's leave conflict on HLT-026).
// The production seed has no leave.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PROTO } from '@/server/prototype';
import { addDaysIso, leaveTypeOfNature } from '../codes';
import { leaveEntries, persons } from '../schema';
import type { DB, Tx } from '../types';
import { resourceWeekStart } from './resources';

/** Person (full name) → week index (from 28 Sep 2026) → the prototype's leave label (CP, RTT, Sick, Training). */
export const DEMO_LEAVE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'Amélie Ollivier': { 10: 'CP', 11: 'CP' },
  'Julien Wagner': { 6: 'RTT' },
  'Pauline Noguès': { 14: 'CP', 15: 'Training' },
  'Thomas Kerbrat': { 8: 'CP', 9: 'CP' },
  'Léa Marchand': { 1: 'RTT', 8: 'RTT' },
  'Damien Roux': {},
  'Hélène Sauvage': { 0: 'Sick' },
  'Fabien Bertrand': { 14: 'CP', 15: 'CP' },
};

interface LeaveSeedRow { name: string; label: string; weekStart: string; startDate: string; endDate: string; days: number }

/** The leave rows of a leave table (person → week index → label): one per week, from its Monday, LEAVE_DAYS working days. */
export function leaveSeedRows(table: Readonly<Record<string, Readonly<Record<string, string>>>>): LeaveSeedRow[] {
  const leaveDays = PROTO.LEAVE_DAYS as Record<string, number>;
  return Object.entries(table).flatMap(([name, byWeek]) =>
    Object.entries(byWeek).map(([week, label]) => {
      const weekStart = resourceWeekStart(+week);
      const days = leaveDays[label];
      return { name, label, weekStart, startDate: weekStart, endDate: addDaysIso(weekStart, days - 1), days };
    }),
  );
}

const key = (r: { name: string; label: string; weekStart: string; startDate: string; endDate: string; days: number }) =>
  `${r.name}|${leaveTypeOfNature(r.label)}|${r.weekStart}|${r.startDate}|${r.endDate}|${r.days}`;

/** The seeded leave rows (no Cursus key) of the people of the demo leave table. */
async function seededLeave(db: DB | Tx) {
  const rows = await db
    .select({ id: leaveEntries.id, name: persons.fullName, leaveType: leaveEntries.leaveType, weekStart: leaveEntries.weekStart, startDate: leaveEntries.startDate, endDate: leaveEntries.endDate, days: leaveEntries.days })
    .from(leaveEntries)
    .innerJoin(persons, eq(persons.id, leaveEntries.personId))
    .where(and(isNull(leaveEntries.externalId), inArray(persons.fullName, Object.keys(DEMO_LEAVE))));
  return rows.map((r) => ({ ...r, key: `${r.name}|${r.leaveType}|${r.weekStart}|${r.startDate}|${r.endDate}|${r.days}` }));
}

/** The prototype's rows still seeded as they were (else null), and those to move with their demo week. */
async function plannedShift(db: DB | Tx) {
  const proto = leaveSeedRows(PROTO.LEAVE as Record<string, Record<string, string>>);
  const demo = leaveSeedRows(DEMO_LEAVE);
  const seeded = await seededLeave(db);
  const byKey = new Map(seeded.map((r) => [r.key, r]));
  if (seeded.length !== proto.length || !proto.every((r) => byKey.has(key(r)))) return null;
  const demoKeys = new Set(demo.map(key));
  const protoKeys = new Set(proto.map(key));
  const to = demo.filter((r) => !protoKeys.has(key(r)));
  return proto.filter((r) => !demoKeys.has(key(r))).map((r) => {
    // The same person and leave label on its demo week (one target per row, in order).
    const target = to.splice(to.findIndex((t) => t.name === r.name && t.label === r.label), 1)[0];
    return { id: byKey.get(key(r))!.id, target };
  });
}

/** True when a demo database still carries the prototype's seeded leave dates (the backfill has rows to move). */
export async function demoLeaveToShift(db: DB | Tx): Promise<boolean> {
  return ((await plannedShift(db))?.length ?? 0) > 0;
}

/**
 * A demo database seeded before the shift (one-time backfill, index.ts — never on a production database) whose seeded leave (rows
 * without a Cursus key) is still exactly the prototype's: each prototype row that moves goes to its demo week. Cursus's own
 * absences, and a database whose seeded leave was edited since, are left as they are. Returns the rows moved.
 */
export async function shiftDemoLeave(tx: Tx): Promise<number> {
  const moves = (await plannedShift(tx)) ?? [];
  for (const { id, target } of moves) {
    await tx.update(leaveEntries).set({ weekStart: target.weekStart, startDate: target.startDate, endDate: target.endDate, days: target.days }).where(eq(leaveEntries.id, id));
  }
  return moves.length;
}
