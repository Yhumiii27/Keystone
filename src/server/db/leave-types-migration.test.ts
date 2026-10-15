// Custom data migration drizzle/NNNN_leave_types_simple.sql (delivery 8, lot connectors; R-031 / R-173, NEW-CURSUS-4 "a"):
// a database seeded before it (leave types CP, RTT, Sick, Training) gets the two simple types Leave and Absence, its absences
// mapped onto them with their days unchanged; a new database (no leave type yet) is left for the seed. The SQL is run as
// written, statement by statement, on an in-memory PGlite.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import type { DB } from './types';

// Found by its name, whatever number the integrator gives it when migrations are regenerated in merge order.
const FILE = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((f) => /^\d{4}_leave_types_simple\.sql$/.test(f));
const SQL = fs.readFileSync(path.join(process.cwd(), 'drizzle', FILE ?? 'missing_leave_types_simple.sql'), 'utf8');
const run = async (db: DB) => {
  for (const stmt of SQL.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const rows = async <T,>(db: DB, q: string) => (await db.execute(sql.raw(q))).rows as T[];

describe('NNNN_leave_types_simple (custom data migration)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('maps a database seeded with CP / RTT / Sick / Training: Leave and Absence, days unchanged, old types removed', async () => {
    // The state before the migration: the prototype's four types (LEAVE_DAYS) and its absences on them (by their days).
    await db.execute(sql.raw(`INSERT INTO leave_types (code, label, days_per_week, position) VALUES ('cp', 'CP', 5, 1), ('rtt', 'RTT', 1, 2), ('sick', 'Sick', 2, 3), ('training', 'Training', 3, 4)`));
    await db.execute(sql.raw(`UPDATE leave_entries SET leave_type = CASE WHEN days = 2 THEN 'sick' WHEN days = 3 THEN 'training' WHEN days = 1 THEN 'rtt' ELSE 'cp' END`));
    await db.execute(sql.raw(`DELETE FROM leave_types WHERE code IN ('leave', 'absence')`));
    const before = await rows<{ t: string; d: number }>(db, `SELECT leave_type AS t, sum(days)::int AS d FROM leave_entries GROUP BY 1 ORDER BY 1`);
    expect(before).toEqual([{ t: 'cp', d: 35 }, { t: 'rtt', d: 3 }, { t: 'sick', d: 2 }, { t: 'training', d: 3 }]);
    await run(db);
    expect(await rows(db, `SELECT code, label, days_per_week FROM leave_types ORDER BY position`)).toEqual([
      { code: 'leave', label: 'Leave', days_per_week: 5 }, { code: 'absence', label: 'Absence', days_per_week: 5 },
    ]);
    expect(await rows(db, `SELECT leave_type AS t, sum(days)::int AS d FROM leave_entries GROUP BY 1 ORDER BY 1`)).toEqual([{ t: 'absence', d: 5 }, { t: 'leave', d: 38 }]);
    // Run twice: nothing changes.
    await run(db);
    expect((await rows(db, `SELECT code FROM leave_types`)).length).toBe(2);
  });

  it('a new database (no leave type yet) is left to the seed', async () => {
    await db.execute(sql.raw('DELETE FROM leave_entries'));
    await db.execute(sql.raw('DELETE FROM leave_types'));
    await run(db);
    expect(await rows(db, 'SELECT code FROM leave_types')).toEqual([]);
  });
});
