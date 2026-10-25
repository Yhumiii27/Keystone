// R-189 (Arche K-04): the custom data migration NNNN_capex_milestone_backfill.sql — found by name. Runs AFTER the generated
// migration that adds milestones.capex_milestone_code. A database of before R-189 (no milestone tagged) gets the tags the seed
// writes today (same rule, src/domain/capex-milestones.ts); a code set by hand is kept and never given twice; re-run: no change.
// The SQL is run as written on an in-memory PGlite seeded with today's data and put back in the state before R-189.
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
const BACKFILL = file('capex_milestone_backfill');
const run = async (db: DB) => {
  for (const stmt of BACKFILL.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const tags = async (db: DB) =>
  (
    await db.execute(sql.raw(`SELECT p.code, m.name, m.capex_milestone_code AS c FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.capex_milestone_code IS NOT NULL ORDER BY p.code, m.position`))
  ).rows as { code: string; name: string; c: string }[];

describe('NNNN_capex_milestone_backfill (R-189, custom, after the generated column)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('a database of before R-189 gets the tags the seed writes, without touching updated_at; re-run: no change', async () => {
    const seeded = await tags(db);
    expect(seeded.map((r) => [r.code, r.c])).toEqual([['HLT-026', 'pv_reception'], ['MSR-012', 'pv_reception'], ['NDC-031', 'sat'], ['WSA-044', 'sat']]);
    const stamp = async () => (await db.execute(sql.raw(`SELECT string_agg(updated_at::text, ',' ORDER BY id) AS s FROM milestones`))).rows[0];
    const before = await stamp();
    await db.execute(sql.raw(`UPDATE milestones SET capex_milestone_code = NULL`));
    await run(db);
    expect(await tags(db)).toEqual(seeded);
    await run(db);
    expect(await tags(db)).toEqual(seeded);
    expect(await stamp()).toEqual(before);
  });

  it('a code set by hand stays, and is not given to another milestone', async () => {
    await db.execute(sql.raw(`UPDATE milestones SET capex_milestone_code = NULL`));
    // The lead tagged « Systems energised » as the PV: « Handover » (also a PV by its name) stays untagged.
    await db.execute(sql.raw(`UPDATE milestones SET capex_milestone_code = 'pv_reception' WHERE name = 'Systems energised'`));
    await run(db);
    const hlt = (await tags(db)).filter((r) => r.code === 'HLT-026');
    expect(hlt.map((r) => [r.name, r.c])).toEqual([['Systems energised', 'pv_reception']]);
  });
});
