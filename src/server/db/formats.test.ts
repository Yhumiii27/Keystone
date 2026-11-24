// R-N02 (Norma §4, formats in the database): a migrated database holds exactly the domain CHECKs the schema declares
// (src/server/db/schema/_checks.ts — each list is checked against its column's TypeScript type at compile time), and the
// CHECKs refuse a state Keystone does not know, a blank name, a malformed code, an out-of-range value and an end before its
// start. A value added to a type without `npm run db:generate` breaks this test.
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import { DOMAIN_CHECKS } from './schema/_checks';
import type { DB } from './types';
import './schema';

/** The values of `col = ANY (ARRAY['a'::text, …])`, `col <@ ARRAY[…]` or `col = ANY (ARRAY[1, 2])` as PostgreSQL prints a CHECK. */
function valuesOf(def: string): (string | number)[] {
  const arr = /ARRAY\[(.*)\]/.exec(def)?.[1] ?? '';
  const texts = [...arr.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1].replace(/''/g, "'"));
  return texts.length ? texts : arr.split(',').map((x) => Number(x.trim()));
}

let db: DB;
beforeAll(async () => {
  db = await openDatabase();
}, 120_000);

const rows = async <T>(q: string) => (await db.execute(sql.raw(q))).rows as T[];
/** The statement fails on `constraint` (drizzle wraps the driver's error: its cause names the constraint). */
const refused = async (q: string, constraint: string) => {
  const error = await db.execute(sql.raw(q)).then(() => null, (e: Error & { cause?: { message?: string } }) => `${e.message} ${e.cause?.message ?? ''}`);
  expect(error ?? `accepted: ${q}`).toMatch(constraint);
};

describe('formats in the database (R-N02)', () => {
  it('holds every domain CHECK of the schema with its exact values, and none other', async () => {
    const checks = await rows<{ name: string; def: string }>(
      `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`,
    );
    const inDb = new Map(checks.map((r) => [r.name, r.def]));
    for (const [name, values] of DOMAIN_CHECKS) {
      expect(inDb.has(name), `${name} missing: run npm run db:generate`).toBe(true);
      expect(valuesOf(inDb.get(name)!), name).toEqual([...values]);
    }
    expect(checks.filter((r) => r.name.endsWith('_domain') && !DOMAIN_CHECKS.has(r.name)).map((r) => r.name)).toEqual([]);
    expect(DOMAIN_CHECKS.size).toBeGreaterThan(200);
    expect(checks.length).toBeGreaterThan(450);
  });

  it('refuses an unknown state, a blank name, a malformed code, an out-of-range value and an end before its start', async () => {
    const [p] = await rows<{ id: string }>(`select id from projects where code = 'HLT-026'`);
    await refused(`update projects set name = '   ' where id = '${p.id}'`, 'projects_name_filled');
    await refused(`update projects set code = 'hlt-26' where id = '${p.id}'`, 'projects_code_shape');
    await refused(`update projects set progress = 1.5 where id = '${p.id}'`, 'projects_progress_range');
    await refused(`update projects set planned_start_date = '2026-05-01', planned_finish_date = '2026-04-30' where id = '${p.id}'`, 'projects_planned_finish_date_order');
    await refused(`update risks set status = 'archived' where number = (select min(number) from risks)`, 'risks_status_domain');
    await refused(`update risks set number = 'RISK-1' where number = (select min(number) from risks)`, 'risks_number_shape');
    await refused(`update change_requests set types = array['budget', 'other'] where number = (select min(number) from change_requests)`, 'change_requests_types_domain');
  });
});
