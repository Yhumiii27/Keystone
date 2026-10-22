// R-084 (absences), owner 22 Oct 2026: demo leave shifted off the assignments (./demo-leave.ts). A fresh demo seed carries the
// shifted leave; a demo database seeded before carries the prototype's dates and is shifted once, at its next open
// (seedIfEmpty), never when its seeded leave was edited since; Cursus's own absences are never touched.
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PROTO } from '@/server/prototype';
import { leaveTypeOfNature } from '../codes';
import { openDatabase } from '../open';
import { leaveEntries, persons } from '../schema';
import type { DB } from '../types';
import { seedIfEmpty } from '.';
import { DEMO_LEAVE, demoLeaveToShift, leaveSeedRows, shiftDemoLeave } from './demo-leave';

let db: DB;
const seeded = async () =>
  (await db
    .select({ name: persons.fullName, type: leaveEntries.leaveType, start: leaveEntries.startDate, end: leaveEntries.endDate, days: leaveEntries.days })
    .from(leaveEntries)
    .innerJoin(persons, eq(persons.id, leaveEntries.personId))
    .where(isNull(leaveEntries.externalId)))
    .map((r) => `${r.name}|${r.type}|${r.start}|${r.end}|${r.days}`)
    .sort();
const expected = (table: Readonly<Record<string, Readonly<Record<string, string>>>>) =>
  leaveSeedRows(table).map((r) => `${r.name}|${leaveTypeOfNature(r.label)}|${r.startDate}|${r.endDate}|${r.days}`).sort();
const PROTO_LEAVE = PROTO.LEAVE as Record<string, Record<string, string>>;

/** Puts the seeded leave back on the prototype's dates (a demo database seeded before the shift). */
async function backToPrototype() {
  await db.delete(leaveEntries).where(isNull(leaveEntries.externalId));
  const people = new Map((await db.select({ id: persons.id, name: persons.fullName }).from(persons)).map((p) => [p.name, p.id]));
  await db.insert(leaveEntries).values(leaveSeedRows(PROTO_LEAVE).map((r) => ({
    personId: people.get(r.name)!, leaveType: leaveTypeOfNature(r.label), weekStart: r.weekStart, startDate: r.startDate, endDate: r.endDate, days: r.days,
  })));
}

beforeAll(async () => {
  db = await openDatabase();
}, 60_000);

describe('demo leave shifted off the assignments (R-084 absences, owner 22 Oct 2026)', () => {
  it('the same people, types and days as the prototype\'s LEAVE, on other weeks; never on a public holiday', () => {
    const count = (t: Readonly<Record<string, Readonly<Record<string, string>>>>) =>
      Object.fromEntries(Object.entries(t).map(([n, ws]) => [n, Object.values(ws).sort()]));
    expect(count(DEMO_LEAVE)).toEqual(count(PROTO_LEAVE));
    const holidays = ['2026-11-11', '2026-12-25', '2027-01-01'];
    for (const r of leaveSeedRows(DEMO_LEAVE)) expect(holidays.filter((h) => h >= r.startDate && h <= r.endDate)).toEqual([]);
  });

  it('a fresh demo seed carries the shifted leave', async () => {
    expect(await seeded()).toEqual(expected(DEMO_LEAVE));
    expect(await demoLeaveToShift(db)).toBe(false);
  });

  it('a demo database seeded before: shifted once at its next open; Cursus\'s absences untouched; idempotent', async () => {
    await backToPrototype();
    const [damien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Damien Roux'));
    await db.insert(leaveEntries).values({ personId: damien.id, leaveType: 'leave', weekStart: '2026-10-19', startDate: '2026-10-19', endDate: '2026-10-19', days: 1, externalId: 'cursus:probe' });
    expect(await seeded()).toEqual(expected(PROTO_LEAVE));
    expect(await demoLeaveToShift(db)).toBe(true);
    await seedIfEmpty(db);
    expect(await seeded()).toEqual(expected(DEMO_LEAVE));
    expect(await db.select({ start: leaveEntries.startDate }).from(leaveEntries).where(eq(leaveEntries.externalId, 'cursus:probe'))).toEqual([{ start: '2026-10-19' }]);
    expect(await demoLeaveToShift(db)).toBe(false);
    expect(await db.transaction((tx) => shiftDemoLeave(tx))).toBe(0);
  });

  it('a seeded leave edited since is left as it is', async () => {
    await backToPrototype();
    await db.execute(sql`update leave_entries set days = 4 where external_id is null and start_date = '2026-11-09' and person_id = (select id from persons where full_name = 'Fabien Bertrand')`);
    expect(await demoLeaveToShift(db)).toBe(false);
    expect(await db.transaction((tx) => shiftDemoLeave(tx))).toBe(0);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(leaveEntries).where(and(isNull(leaveEntries.externalId), eq(leaveEntries.startDate, '2026-10-12'))))[0].n).toBe(1);
  });
});
