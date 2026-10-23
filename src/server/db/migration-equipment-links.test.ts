// R-185 part 2: the custom data migration NNNN_equipment_links_backfill.sql — found by name, whatever number the integrator
// gives it. Runs AFTER the generated migration that adds the equipment_id columns (itp_plans, punch_items, commissioning_systems,
// project_bom_lines, machines) and replaces the one-plan-per-project key. A database of before part 2 (no equipment_id anywhere,
// Harbor Line without EQ-02 plan) gets: each plan on its project's main line; the items raised by an inspection on the plan's
// line; the commissioning systems of a single-line project on that line (a multi-line project's stay common); each machine on
// its project's line of the same type, else the main line. Re-run: no change. The SQL is run as written, statement by
// statement, on an in-memory PGlite seeded with today's data and put back in the state before part 2.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import type { DB } from './types';

const file = (suffix: string) => {
  const f = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((x) => new RegExp(`^\\d{4}_${suffix}\\.sql$`).test(x));
  return fs.readFileSync(path.join(process.cwd(), 'drizzle', f ?? `missing_${suffix}.sql`), 'utf8');
};
const BACKFILL = file('equipment_links_backfill');
const run = async (db: DB, text: string) => {
  for (const stmt of text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const rows = async <T,>(db: DB, q: string) => (await db.execute(sql.raw(q))).rows as T[];

const plans = (db: DB) =>
  rows<{ code: string; eq: string | null; mt: string }>(db, `
    SELECT p.code, e.ref AS eq, ip.machine_type_code AS mt FROM itp_plans ip JOIN projects p ON p.id = ip.project_id
    LEFT JOIN project_equipments e ON e.id = ip.equipment_id ORDER BY p.code, e.ref`);
const punch = (db: DB) =>
  rows<{ number: string; eq: string | null }>(db, `
    SELECT pi.number, e.ref AS eq FROM punch_items pi JOIN projects p ON p.id = pi.project_id LEFT JOIN project_equipments e ON e.id = pi.equipment_id
    WHERE p.code = 'HLT-026' ORDER BY pi.number`);
const systems = (db: DB) =>
  rows<{ code: string; name: string; eq: string | null }>(db, `
    SELECT p.code, s.name, e.ref AS eq FROM commissioning_systems s JOIN projects p ON p.id = s.project_id LEFT JOIN project_equipments e ON e.id = s.equipment_id
    ORDER BY p.code, s.position`);
const fleet = (db: DB) =>
  rows<{ number: string; code: string | null; eq: string | null }>(db, `
    SELECT m.number, p.code, e.ref AS eq FROM machines m LEFT JOIN projects p ON p.id = m.project_id LEFT JOIN project_equipments e ON e.id = m.equipment_id
    ORDER BY m.number`);

describe('NNNN_equipment_links_backfill (R-185 part 2, custom, after the generated columns)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('the seed already writes the links the migration writes', async () => {
    expect((await plans(db)).map((p) => [p.code, p.eq, p.mt])).toEqual([['HLT-026', 'EQ-01', 'EMP'], ['HLT-026', 'EQ-02', 'MEMU']]);
    const items = Object.fromEntries((await punch(db)).map((p) => [p.number, p.eq]));
    expect(items).toMatchObject({ 'P-01': null, 'P-02': 'EQ-01', 'P-06': null, 'P-09': 'EQ-02' });
    expect((await systems(db)).map((s) => s.eq)).toEqual(['EQ-01', 'EQ-01', 'EQ-01', 'EQ-01', 'EQ-01', 'EQ-01', 'EQ-02']);
    // The demo machines' projects (QFR-015, DRR-009, ALP-021) have no machine type, so no line.
    expect((await fleet(db)).every((m) => m.eq === null)).toBe(true);
  });

  it('a database of before part 2: plans, inspection items, single-line systems and machines on their line, once', async () => {
    // The state before part 2: Harbor Line's EQ-02 data did not exist, nothing carries an equipment line.
    await db.execute(sql.raw(`DELETE FROM itp_plans WHERE equipment_id = (SELECT e.id FROM project_equipments e JOIN projects p ON p.id = e.project_id WHERE p.code = 'HLT-026' AND e.ref = 'EQ-02')`));
    await db.execute(sql.raw(`DELETE FROM punch_items WHERE number = 'P-09'`));
    await db.execute(sql.raw(`DELETE FROM commissioning_systems WHERE name = 'MEMU modules M1–M3'`));
    for (const t of ['itp_plans', 'punch_items', 'commissioning_systems', 'project_bom_lines', 'machines']) await db.execute(sql.raw(`UPDATE ${t} SET equipment_id = NULL`));
    // An untyped project's plan (no line) stays without line; a single-line project's commissioning goes to its line.
    await db.execute(sql.raw(`INSERT INTO itp_plans (project_id, machine_type_code) SELECT id, 'AUTRE' FROM projects WHERE machine_type_code IS NULL AND code NOT IN ('QFR-015', 'ALP-021') ORDER BY code LIMIT 1`));
    await db.execute(sql.raw(`INSERT INTO commissioning_systems (project_id, name, position) SELECT id, 'Track', 0 FROM projects WHERE code = 'WSA-044'`));
    // Machines of projects with lines: QFR-015 supplies an EMP (EQ-01) and a SPUR (EQ-02) line — its EMP and SPUR machines go to
    // the line of their type; ALP-021 an EMP line only — its MEMU machine goes to the main line. DRR-009 has no line.
    await db.execute(sql.raw(`INSERT INTO project_equipments (project_id, ref, machine_type_code, quantity, position)
      SELECT id, 'EQ-01', 'EMP', 1, 0 FROM projects WHERE code = 'QFR-015' UNION ALL SELECT id, 'EQ-02', 'SPUR', 1, 1 FROM projects WHERE code = 'QFR-015'
      UNION ALL SELECT id, 'EQ-01', 'EMP', 1, 0 FROM projects WHERE code = 'ALP-021'`));
    const untyped = await rows<{ n: number }>(db, 'SELECT count(*)::int AS n FROM itp_plans WHERE equipment_id IS NULL');

    await run(db, BACKFILL);
    const after = { plans: await plans(db), punch: await punch(db), systems: await systems(db), fleet: await fleet(db) };
    expect(after.plans.filter((p) => p.code === 'HLT-026').map((p) => [p.eq, p.mt])).toEqual([['EQ-01', 'EMP']]);
    expect(after.plans.filter((p) => p.eq === null)).toHaveLength(untyped[0].n - 1);
    expect(Object.fromEntries(after.punch.map((p) => [p.number, p.eq]))).toMatchObject({ 'P-01': null, 'P-02': 'EQ-01', 'P-03': null, 'P-06': null });
    // Harbor Line has two lines: its systems stay common; WSA-044 has one: its system joins EQ-01.
    expect(after.systems.filter((s) => s.code === 'HLT-026').every((s) => s.eq === null)).toBe(true);
    expect(after.systems.filter((s) => s.code === 'WSA-044').map((s) => s.eq)).toEqual(['EQ-01']);
    expect(after.fleet.filter((m) => m.eq).map((m) => [m.number, m.code, m.eq])).toEqual([
      ['MCH-031', 'ALP-021', 'EQ-01'], ['MCH-035', 'QFR-015', 'EQ-02'], ['MCH-041', 'QFR-015', 'EQ-01'],
    ]);

    // Run again: nothing moves.
    await run(db, BACKFILL);
    expect({ plans: await plans(db), punch: await punch(db), systems: await systems(db), fleet: await fleet(db) }).toEqual(after);
  });
});
