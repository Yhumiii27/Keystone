// Migration drizzle/0085_contract_type_turnkey.sql (owner, 27 Nov 2026: « remplace par clé en main »): a contract
// stored with the former code `lump_sum_epc` becomes `lump_sum_turnkey`, the other types are untouched, and the domain CHECK
// then refuses the former code. The SQL is run as written, statement by statement, on a migrated database brought back to the
// state before it.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import type { DB } from './types';

const FILE = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((f) => /^\d{4}_contract_type_turnkey\.sql$/.test(f));
const SQL = fs.readFileSync(path.join(process.cwd(), 'drizzle', FILE ?? 'missing_contract_type_turnkey.sql'), 'utf8');
const run = async (db: DB) => {
  for (const stmt of SQL.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
};
const rows = async <T,>(db: DB, q: string) => (await db.execute(sql.raw(q))).rows as T[];

describe('NNNN_contract_type_turnkey (data migration)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('rewrites the former code, keeps the other types, and the CHECK refuses the former code', async () => {
    // The demo data hold one contract (HLT-026): a second one, on another project, keeps another type.
    await db.execute(sql.raw(
      `INSERT INTO contracts (project_id, reference, client_name, type, base_amount_keur, payment_terms, retention_pct, retention_note,
         liquidated_damages, warranty, governing_law, scope)
       SELECT p.id, 'CTR-TST-001', 'Test client', 'unit_rates', 100, 'Net 45 days', 5, '', '', '', '', ''
       FROM projects p WHERE p.id NOT IN (SELECT project_id FROM contracts) LIMIT 1`,
    ));
    const ids = await rows<{ id: string }>(db, 'SELECT id FROM contracts ORDER BY id');
    expect(ids.length).toBeGreaterThan(1);
    // The state before: the CHECK of 0084 and a contract stored with the former code.
    await db.execute(sql.raw('ALTER TABLE contracts DROP CONSTRAINT contracts_type_domain'));
    await db.execute(sql.raw(`UPDATE contracts SET type = 'cost_plus'`));
    await db.execute(sql.raw(`UPDATE contracts SET type = 'lump_sum_epc' WHERE id = '${ids[0].id}'`));
    await db.execute(sql.raw(
      `ALTER TABLE contracts ADD CONSTRAINT contracts_type_domain CHECK (type in ('lump_sum_epc', 'unit_rates', 'cost_plus', 'framework'))`,
    ));
    await run(db);
    expect(await rows(db, `SELECT type, count(*)::int AS n FROM contracts GROUP BY 1 ORDER BY 1`)).toEqual([
      { type: 'cost_plus', n: ids.length - 1 }, { type: 'lump_sum_turnkey', n: 1 },
    ]);
    const error = await db.execute(sql.raw(`UPDATE contracts SET type = 'lump_sum_epc' WHERE id = '${ids[0].id}'`)).then(
      () => null, (e: Error & { cause?: { message?: string } }) => `${e.message} ${e.cause?.message ?? ''}`,
    );
    expect(error).toMatch('contracts_type_domain');
  });
});
