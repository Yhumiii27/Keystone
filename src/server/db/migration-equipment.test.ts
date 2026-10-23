// R-185: the custom data migration NNNN_project_equipments_backfill.sql — found by name, whatever number the integrator gives it.
// Runs AFTER the generated migration that creates project_equipments and the per_equipment / equipment_id columns. A database
// seeded before R-185 (no line, no phase flag) gets one line per project with a machine type (EQ-01, quantity 1) and the
// standard phases specific to an equipment flagged; projects without type stay without line. Re-run: no change. The SQL is run
// as written, statement by statement, on an in-memory PGlite seeded with today's data and put back in the state before R-185.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PER_EQUIPMENT_PHASES } from '@/domain/project-equipment';
import { openDatabase } from './open';
import type { DB } from './types';

const file = (suffix: string) => {
  const f = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((x) => new RegExp(`^\\d{4}_${suffix}\\.sql$`).test(x));
  return fs.readFileSync(path.join(process.cwd(), 'drizzle', f ?? `missing_${suffix}.sql`), 'utf8');
};
const BACKFILL = file('project_equipments_backfill');
const run = async (db: DB, text: string) => {
  for (const stmt of text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const rows = async <T,>(db: DB, q: string) => (await db.execute(sql.raw(q))).rows as T[];
const lines = (db: DB) =>
  rows<{ code: string; ref: string; mt: string; quantity: number; position: number }>(db, `
    SELECT p.code, e.ref, e.machine_type_code AS mt, e.quantity, e.position FROM project_equipments e JOIN projects p ON p.id = e.project_id
    ORDER BY p.code, e.position`);
const flagged = async (db: DB) =>
  (await rows<{ mt: string; name: string }>(db, `SELECT machine_type_code AS mt, name FROM machine_type_phases WHERE per_equipment ORDER BY machine_type_code, position`))
    .map((r) => `${r.mt} · ${r.name}`);

describe('NNNN_project_equipments_backfill (R-185, custom, after the generated table)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('the seed already wrote the lines and flags the migration writes', async () => {
    expect((await lines(db)).filter((l) => l.ref === 'EQ-01').map((l) => [l.code, l.mt])).toEqual([
      ['ERP-202', 'rnd'], ['HLT-026', 'EMP'], ['MSR-012', 'MEMU'], ['NDC-031', 'AUTRE'], ['RCF-019', 'MEMU'], ['WSA-044', 'SPUR'],
    ]);
    const expected = Object.entries(PER_EQUIPMENT_PHASES).flatMap(([mt, names]) => names.map((n) => `${mt} · ${n}`)).sort();
    expect((await flagged(db)).sort()).toEqual(expected);
  });

  it('a database seeded before R-185: one line per typed project and the standard flags, once', async () => {
    // The state before R-185: no line, no flag; a project's main type changed since the seed.
    await db.execute(sql.raw('DELETE FROM project_equipments'));
    await db.execute(sql.raw('UPDATE machine_type_phases SET per_equipment = false'));
    await db.execute(sql.raw(`UPDATE projects SET machine_type_code = 'SPUR' WHERE code = 'RCF-019'`));
    // A phase renamed on the Machine types screen stays common.
    await db.execute(sql.raw(`UPDATE machine_type_phases SET name = 'Fabrication charpente' WHERE machine_type_code = 'EMP' AND name = 'Fabrication structure'`));

    await run(db, BACKFILL);
    const after = await lines(db);
    expect(after.map((l) => [l.code, l.ref, l.mt, l.quantity, l.position])).toEqual([
      ['ERP-202', 'EQ-01', 'rnd', 1, 0], ['HLT-026', 'EQ-01', 'EMP', 1, 0], ['MSR-012', 'EQ-01', 'MEMU', 1, 0],
      ['NDC-031', 'EQ-01', 'AUTRE', 1, 0], ['RCF-019', 'EQ-01', 'SPUR', 1, 0], ['WSA-044', 'EQ-01', 'SPUR', 1, 0],
    ]);
    const typed = await rows<{ n: number }>(db, 'SELECT count(*)::int AS n FROM projects WHERE machine_type_code IS NOT NULL');
    expect(after).toHaveLength(typed[0].n);
    const flags = await flagged(db);
    expect(flags).toContain('EMP · Montage mécanique');
    expect(flags).not.toContain('EMP · Fabrication charpente');
    expect(flags).toContain('MEMU · Fabrication modules');
    expect(flags.some((f) => f.startsWith('rnd'))).toBe(false);

    // Run again: nothing moves.
    await run(db, BACKFILL);
    expect(await lines(db)).toEqual(after);
    expect(await flagged(db)).toEqual(flags);
  });
});
