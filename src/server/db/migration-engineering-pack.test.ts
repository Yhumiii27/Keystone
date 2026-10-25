// R-191 (Arche K-08): the custom data migration NNNN_engineering_pack_backfill.sql — found by name. Runs AFTER the generated
// migration that adds machine_type_pack_families and document_types.pack_family. A database of before R-191 (no standard list, no
// type classified) gets the reference data the seeds write today (src/domain/engineering-pack.ts); a list or a classification
// already set is kept; re-run: no change. The SQL is run as written on an in-memory PGlite seeded with today's data and put back
// in the state before R-191.
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
const BACKFILL = file('engineering_pack_backfill');
const run = async (db: DB) => {
  for (const stmt of BACKFILL.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const lists = async (db: DB) =>
  (await db.execute(sql.raw(`SELECT machine_type_code || ':' || family || ':' || weight || ':' || min_expected AS r FROM machine_type_pack_families ORDER BY 1`)))
    .rows.map((r) => (r as { r: string }).r);
const mapping = async (db: DB) =>
  (await db.execute(sql.raw(`SELECT code || ':' || pack_family AS r FROM document_types WHERE pack_family IS NOT NULL ORDER BY 1`))).rows.map((r) => (r as { r: string }).r);

describe('NNNN_engineering_pack_backfill (R-191, custom, after the generated table and column)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('a database of before R-191 gets the seeds’ provisional list and mapping; re-run: no change', async () => {
    const seededLists = await lists(db);
    const seededMapping = await mapping(db);
    expect(seededLists).toHaveLength(5 * 5);
    expect(seededMapping).toEqual(['BOM:bom', 'FDS:analyse_fonctionnelle', 'GA:layout', 'PID:pid', 'SCH:electrique']);
    await db.execute(sql.raw(`DELETE FROM machine_type_pack_families`));
    await db.execute(sql.raw(`UPDATE document_types SET pack_family = NULL`));
    await run(db);
    expect(await lists(db)).toEqual(seededLists);
    expect(await mapping(db)).toEqual(seededMapping);
    await run(db);
    expect(await lists(db)).toEqual(seededLists);
  });

  it('a list or a classification already set stays', async () => {
    await db.execute(sql.raw(`DELETE FROM machine_type_pack_families WHERE machine_type_code = 'EMP'`));
    await db.execute(sql.raw(`INSERT INTO machine_type_pack_families (machine_type_code, family, weight, min_expected) VALUES ('EMP', 'pid', 100, 2)`));
    await db.execute(sql.raw(`UPDATE document_types SET pack_family = 'electrique' WHERE code = 'LST'`));
    await db.execute(sql.raw(`UPDATE document_types SET pack_family = 'layout' WHERE code = 'SCH'`));
    await run(db);
    expect((await lists(db)).filter((r) => r.startsWith('EMP:'))).toEqual(['EMP:pid:100:2']);
    expect(await mapping(db)).toEqual(['BOM:bom', 'FDS:analyse_fonctionnelle', 'GA:layout', 'LST:electrique', 'PID:pid', 'SCH:layout']);
  });
});
