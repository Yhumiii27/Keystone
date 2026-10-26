// R-017 (hold the load with real data volumes): every single-column foreign key of the schema either has an index whose first
// column it is — a unique constraint, a primary key or an index of its own — or is on the reviewed list of deliberate
// exceptions (./fk-without-index.json, with the reason). A new foreign key therefore needs a decision: an index when the
// readers filter or join on it (or rows of its parent are deleted), else an entry on the list. The indexes added for the load
// are in migration 0062 (docs/delivery-9/notes-r017-volumes.md).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import EXCEPTIONS from './fk-without-index.json';
import { closeDatabase, openDatabase } from './open';
import type { DB } from './types';

let db: DB;

beforeAll(async () => {
  db = await openDatabase(undefined, undefined, { seed: 'production' });
}, 120_000);

afterAll(async () => {
  await closeDatabase(db);
});

/** Single-column foreign keys without an index starting with their column ("table.column"). */
async function foreignKeysWithoutIndex(): Promise<string[]> {
  const r = await db.execute<{ fk: string }>(sql`
    select cl.relname || '.' || a.attname as fk
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
    where co.contype = 'f' and co.connamespace = current_schema()::regnamespace and array_length(co.conkey, 1) = 1
      and not exists (select 1 from pg_index i where i.indrelid = co.conrelid and i.indkey[0] = co.conkey[1])
    order by 1`);
  return r.rows.map((x) => x.fk);
}

describe('foreign-key indexes (R-017)', () => {
  it('indexes every foreign key the readers use; the others are reviewed exceptions', async () => {
    const missing = await foreignKeysWithoutIndex();
    const reviewed = new Set(Object.keys(EXCEPTIONS));
    expect(missing.filter((fk) => !reviewed.has(fk)), 'foreign keys without an index and not on fk-without-index.json').toEqual([]);
  });

  it('lists no exception that has an index now (or no longer exists)', async () => {
    const missing = new Set(await foreignKeysWithoutIndex());
    expect(Object.keys(EXCEPTIONS).filter((fk) => !missing.has(fk))).toEqual([]);
  });

  it('gives every exception a reason', () => {
    expect(Object.entries(EXCEPTIONS).filter(([, why]) => typeof why !== 'string' || why.length < 10)).toEqual([]);
  });

  it('keeps the indexes of the load lot (R-017) on the hot paths', async () => {
    const r = await db.execute<{ name: string }>(sql`select indexname as name from pg_indexes where schemaname = current_schema()`);
    const names = new Set(r.rows.map((x) => x.name));
    for (const name of [
      'documents_project_id_idx', 'documents_status_idx', 'activity_assignments_activity_id_idx', 'purchase_orders_project_id_idx', 'purchase_orders_status_idx',
      'time_entries_task_id_idx', 'time_entries_person_id_work_date_idx', 'leave_entries_start_date_end_date_idx', 'audit_entries_project_id_idx', 'tasks_assignee_person_id_idx',
    ]) expect(names.has(name), name).toBe(true);
  });
});
