// Custom data migrations of delivery 8, lot site-quality — found by name, whatever number the integrator gives them:
// - NNNN_punch_unified_renumber.sql (R-117, A-6 'a'): runs BEFORE the generated swap of the unique key (project, register,
//   number) → (project, number). A database seeded before it (two registers, both with a P-01) gets its Site items renumbered
//   after the ITP items, category B on Site items and the Keystone party on ITP items; the swap then succeeds. Re-run: no change.
// - NNNN_itp_plan_systems_backfill.sql (R-057, E-9 'a'): runs AFTER the generated table; every plan without frozen systems
//   gets its machine type's systems of the day (AUTRE's when the type has none), in order, once. Re-run: no change.
// The SQL is run as written, statement by statement, on an in-memory PGlite seeded with today's data and put back in the
// state of a database seeded before delivery 8.
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
const RENUMBER = file('punch_unified_renumber');
const BACKFILL = file('itp_plan_systems_backfill');
const run = async (db: DB, text: string) => {
  for (const stmt of text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const rows = async <T,>(db: DB, q: string) => (await db.execute(sql.raw(q))).rows as T[];
const punchOf = (db: DB, code: string) =>
  rows<{ number: string; register: string; position: number; category: string | null; owner_party: string | null; description: string }>(db, `
    SELECT p.number, p.register, p.position, p.category, p.owner_party, p.description FROM punch_items p JOIN projects pr ON pr.id = p.project_id
    WHERE pr.code = '${code}' ORDER BY p.position, p.number`);

describe('NNNN_punch_unified_renumber (R-117, custom, before the unique-key swap)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('a database with the two registers: Site items renumbered after the ITP items, categories and parties backfilled, then the swap', async () => {
    // The state before delivery 8: the per-register key, the Site items numbered P-01…P-03, no category, ITP items without party
    // — and none of Harbor Line's EQ-02 demo data (R-185 part 2: its item P-09) nor its shipment's reception (R-158 lot B: P-10).
    await db.execute(sql.raw(`DELETE FROM punch_items WHERE number IN ('P-09', 'P-10')`));
    await db.execute(sql.raw('ALTER TABLE punch_items DROP CONSTRAINT punch_items_project_id_number_unique'));
    await db.execute(sql.raw('ALTER TABLE punch_items ADD CONSTRAINT punch_items_project_id_register_number_unique UNIQUE("project_id","register","number")'));
    await db.execute(sql.raw(`UPDATE punch_items SET number = 'P-0' || (position - 4)::text, position = position - 5, category = NULL WHERE register = 'site'`));
    await db.execute(sql.raw(`UPDATE punch_items SET owner_party = NULL WHERE register = 'itp'`));
    // A project with Site items only (no clash): left as it is.
    await db.execute(sql.raw(`INSERT INTO punch_items (project_id, register, number, description, location, status, position, owner_party)
      SELECT id, 'site', 'P-01', 'Fence gap', '', 'open', 0, 'client' FROM projects WHERE code = 'RCF-019'`));
    const ids = await rows<{ id: string; number: string }>(db, `SELECT p.id, p.number FROM punch_items p JOIN projects pr ON pr.id = p.project_id WHERE pr.code = 'HLT-026' AND p.register = 'site' ORDER BY p.position`);
    expect(ids.map((r) => r.number)).toEqual(['P-01', 'P-02', 'P-03']);
    // The generated swap alone fails on such a database (both registers have a P-01).
    await expect(db.execute(sql.raw('ALTER TABLE punch_items ADD CONSTRAINT punch_items_try_unique UNIQUE("project_id","number")'))).rejects.toThrow();

    await run(db, RENUMBER);
    await db.execute(sql.raw('ALTER TABLE punch_items DROP CONSTRAINT punch_items_project_id_register_number_unique'));
    await db.execute(sql.raw('ALTER TABLE punch_items ADD CONSTRAINT punch_items_project_id_number_unique UNIQUE("project_id","number")'));

    const hlt = await punchOf(db, 'HLT-026');
    expect(hlt.map((p) => [p.number, p.register, p.position, p.category, p.owner_party])).toEqual([
      ['P-01', 'itp', 0, 'A', 'keystone'], ['P-02', 'itp', 1, 'B', 'keystone'], ['P-03', 'itp', 2, 'C', 'keystone'], ['P-04', 'itp', 3, 'B', 'keystone'],
      ['P-05', 'itp', 4, 'C', 'keystone'], ['P-06', 'site', 5, 'B', 'client'], ['P-07', 'site', 6, 'B', 'keystone'], ['P-08', 'site', 7, 'B', 'client'],
    ]);
    // Same rows (ids kept: photos stay attached through stored_files.owner_id), in their order.
    const after = await rows<{ id: string; number: string }>(db, `SELECT p.id, p.number FROM punch_items p JOIN projects pr ON pr.id = p.project_id WHERE pr.code = 'HLT-026' AND p.register = 'site' ORDER BY p.position`);
    expect(after.map((r) => r.id)).toEqual(ids.map((r) => r.id));
    expect((await punchOf(db, 'RCF-019')).map((p) => [p.number, p.category])).toEqual([['P-01', 'B']]);

    // Run again: nothing moves.
    await run(db, RENUMBER);
    expect(await punchOf(db, 'HLT-026')).toEqual(hlt);
  });

  it('numbers past 99 keep every digit; a new database (no punch item) is left to the seed', async () => {
    const fresh = await openDatabase();
    await fresh.execute(sql.raw('DELETE FROM punch_items'));
    await run(fresh, RENUMBER);
    expect(await rows(fresh, 'SELECT count(*)::int AS n FROM punch_items')).toEqual([{ n: 0 }]);
    // An ITP list up to P-120 with a clashing Site P-120.
    await fresh.execute(sql.raw('ALTER TABLE punch_items DROP CONSTRAINT punch_items_project_id_number_unique'));
    await fresh.execute(sql.raw(`INSERT INTO punch_items (project_id, register, number, description, location, status, position)
      SELECT id, 'itp', 'P-120', 'x', '', 'open', 0 FROM projects WHERE code = 'HLT-026'`));
    await fresh.execute(sql.raw(`INSERT INTO punch_items (project_id, register, number, description, location, status, position)
      SELECT id, 'site', 'P-120', 'y', '', 'open', 0 FROM projects WHERE code = 'HLT-026'`));
    await run(fresh, RENUMBER);
    expect((await punchOf(fresh, 'HLT-026')).map((p) => [p.number, p.register, p.position])).toEqual([['P-120', 'itp', 0], ['P-121', 'site', 1]]);
  }, 60_000);
});

describe('NNNN_itp_plan_systems_backfill (R-057, custom, after the generated table)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  const frozen = async (code: string) =>
    (await rows<{ name: string }>(db, `SELECT s.name FROM itp_plan_systems s JOIN itp_plans p ON p.id = s.plan_id JOIN projects pr ON pr.id = p.project_id
      WHERE pr.code = '${code}' ORDER BY s.position`)).map((r) => r.name);

  it('a plan without frozen systems gets its type’s systems of the day, once; a type without systems gives AUTRE’s', async () => {
    // R-185 part 2: a database of before delivery 8 has one plan per project — Harbor Line's EQ-02 (MEMU) demo plan did not exist.
    await db.execute(sql.raw(`DELETE FROM itp_plans WHERE machine_type_code = 'MEMU'`));
    // The seed froze HLT-026's EMP template; a database seeded before delivery 8 has no rows.
    expect(await frozen('HLT-026')).toEqual(['Structure', 'Hoist mechanisms', 'Travel (gantry)', 'Electrical HV/LV', 'Automation & safety', 'Anti-collision']);
    await db.execute(sql.raw('DELETE FROM itp_plan_systems'));
    // A second plan, of a type whose systems were removed.
    await db.execute(sql.raw(`INSERT INTO itp_plans (project_id, machine_type_code) SELECT id, 'SPUR' FROM projects WHERE code = 'NDC-031'`));
    await db.execute(sql.raw(`DELETE FROM machine_type_itp_systems WHERE machine_type_code = 'SPUR'`));
    await run(db, BACKFILL);
    expect(await frozen('HLT-026')).toEqual(['Structure', 'Hoist mechanisms', 'Travel (gantry)', 'Electrical HV/LV', 'Automation & safety', 'Anti-collision']);
    expect(await frozen('NDC-031')).toEqual(['General']);
    // Run again: nothing is added; a plan that already has rows keeps them even when its type changed since.
    await db.execute(sql.raw(`UPDATE machine_type_itp_systems SET name = 'Steel structure' WHERE machine_type_code = 'EMP' AND name = 'Structure'`));
    await run(db, BACKFILL);
    expect(await frozen('HLT-026')).toEqual(['Structure', 'Hoist mechanisms', 'Travel (gantry)', 'Electrical HV/LV', 'Automation & safety', 'Anti-collision']);
    expect(await rows(db, 'SELECT count(*)::int AS n FROM itp_plan_systems')).toEqual([{ n: 7 }]);
  });
});
