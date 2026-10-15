// Delivery 8, R-083 (A-10, R-4a): the migrations that date the rate grid convert a database that already has one. A PGlite is
// migrated up to the migration before the change (the old rate_roles.base_rate_eur / effective_from, rate_multipliers.factor and
// persons without rate role), filled, then migrated to the end: each rate and factor becomes a first version (the role's former
// "effective from", else 1 Jan 2026), a person gets the grid role named exactly as their job title, the old columns are gone.
// The migrations are found by the custom backfill's tag (`*_rate_versions_backfill`), so the test survives the renumbering at
// integration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrations';

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A copy of ./drizzle whose journal stops before the generated migration that precedes the backfill. */
function foldersBeforeChange(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-rates-'));
  tmp.push(dir);
  fs.cpSync(MIGRATIONS_FOLDER(), dir, { recursive: true });
  const file = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag.endsWith('_rate_versions_backfill'));
  expect(at).toBeGreaterThan(1);
  journal.entries = journal.entries.slice(0, at - 1);
  fs.writeFileSync(file, JSON.stringify(journal));
  return dir;
}

describe('migration: dated rate grid (R-083)', () => {
  it('converts an existing grid into first versions and links people to roles by job title', async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: foldersBeforeChange() });
    await db.execute(sql`insert into rate_roles (id, role, base_rate_eur, is_external, effective_from, position) values
      ('00000000-0000-0000-0000-000000000001', 'Planner', 74, false, null, 1),
      ('00000000-0000-0000-0000-000000000002', 'Contractor — structural (external)', 118, true, '2025-07-01', 2)`);
    await db.execute(sql`insert into rate_multipliers (key, label, factor, position) values ('sat', 'Saturday', 1.5, 1), ('ot', 'Overtime > 8 h/day', 1.3, 2)`);
    await db.execute(sql`insert into persons (full_name, short_name, initials, job_title, sort_order) values
      ('Damien Roux', 'D. Roux', 'DR', 'Planner', 1), ('Marie Lefebvre', 'M. Lefebvre', 'ML', 'Portfolio director', 2), ('No Title', 'N. Title', 'NT', null, 3)`);

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER() });

    const roles = await db.execute(sql`select r.role, v.effective_from::text as d, v.base_rate_eur::float as v from rate_role_rates v join rate_roles r on r.id = v.rate_role_id order by r.position`);
    expect(roles.rows).toEqual([
      { role: 'Planner', d: '2026-01-01', v: 74 },
      { role: 'Contractor — structural (external)', d: '2025-07-01', v: 118 },
    ]);
    const mults = await db.execute(sql`select key, effective_from::text as d, factor::float as f from rate_multiplier_rates order by key`);
    expect(mults.rows).toEqual([{ key: 'ot', d: '2026-01-01', f: 1.3 }, { key: 'sat', d: '2026-01-01', f: 1.5 }]);
    const people = await db.execute(sql`select p.full_name as name, r.role from persons p left join rate_roles r on r.id = p.rate_role_id order by p.sort_order`);
    expect(people.rows).toEqual([{ name: 'Damien Roux', role: 'Planner' }, { name: 'Marie Lefebvre', role: null }, { name: 'No Title', role: null }]);
    // The single source: the former columns and the job-title rates are gone.
    const cols = await db.execute(sql`select table_name, column_name from information_schema.columns
      where (table_name = 'rate_roles' and column_name in ('base_rate_eur', 'effective_from')) or (table_name = 'rate_multipliers' and column_name = 'factor')`);
    expect(cols.rows).toEqual([]);
    const legacy = await db.execute(sql`select to_regclass('public.job_title_rates') as t`);
    expect(legacy.rows).toEqual([{ t: null }]);
    await client.close();
  }, 60_000);
});
