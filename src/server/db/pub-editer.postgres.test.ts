// Matrix M-19 on a real PostgreSQL server — opt-in, like postgres.integration.test.ts: runs only when KEYSTONE_TEST_DATABASE_URL
// names a server where the test may create and drop a database and a role. The migrator puts keystone.pub_editer in the schema
// `keystone` with search_path `keystone, pg_temp`; PUBLIC may not run it (Matrix's droits.verifier() would flag it); a role given
// EXECUTE (what Matrix's link matrix_app → keystone.pub_editer does) runs it and is named in the audit row (session_user).
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateAndSeedPostgres, openPostgres, type PostgresHandle } from './postgres';

const ADMIN_URL = process.env.KEYSTONE_TEST_DATABASE_URL?.trim();

function urlOf(name: string, user?: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  if (user) u.username = user;
  return u.toString();
}

async function run<R = Record<string, unknown>>(sqlText: string, opts: { database?: string; user?: string; values?: unknown[] } = {}): Promise<R[]> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: opts.database ? urlOf(opts.database, opts.user) : ADMIN_URL });
  await c.connect();
  try {
    return (await c.query(sqlText, opts.values)).rows as R[];
  } finally {
    await c.end();
  }
}

describe.skipIf(!ADMIN_URL)('M-19 keystone.pub_editer on a PostgreSQL server (KEYSTONE_TEST_DATABASE_URL)', () => {
  const suffix = randomBytes(4).toString('hex');
  const name = `ks_m19_${suffix}`;
  const caller = `ks_m19_caller_${suffix}`;
  let pg: PostgresHandle;

  beforeAll(async () => {
    await run(`create database ${name}`);
    await run('create schema keystone', { database: name });
    pg = await openPostgres({ url: urlOf(name), poolMax: 4 });
    await migrateAndSeedPostgres(pg, 'demo');
    // A stand-in for matrix_app: a login role with USAGE on the schema only (the test's own grant, never a migration's).
    await run(`create role ${caller} login`);
    await run(`grant usage on schema keystone to ${caller}`, { database: name });
  }, 300_000);

  afterAll(async () => {
    await pg?.close();
    if (ADMIN_URL) {
      await run(`drop database if exists ${name} with (force)`);
      await run(`drop role if exists ${caller}`);
    }
  });

  it('lives in `keystone`, SECURITY DEFINER, search_path keystone then pg_temp, EXECUTE revoked from PUBLIC', async () => {
    const rows = await run(`
      select n.nspname, p.prosecdef, p.proconfig, p.proacl is not null as has_acl,
             exists (select from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('pub_editer', 'ks_edit_text', 'ks_edit_slug') order by p.proname`, { database: name });
    expect(rows).toEqual([
      { nspname: 'keystone', prosecdef: false, proconfig: ['search_path=keystone, pg_temp'], has_acl: true, public_execute: false },
      { nspname: 'keystone', prosecdef: false, proconfig: ['search_path=keystone, pg_temp'], has_acl: true, public_execute: false },
      { nspname: 'keystone', prosecdef: true, proconfig: ['search_path=keystone, pg_temp'], has_acl: true, public_execute: false },
    ]);
  });

  it('a role without the Matrix link may not run it', async () => {
    const [c] = await run<{ id: string }>('select id from keystone.clients order by sort_order limit 1', { database: name });
    await expect(run(`select keystone.pub_editer('clients', 'corriger', $1::jsonb, '{"name": "X"}', 'Camille', 'essai')`, { database: name, user: caller, values: [JSON.stringify({ id: c.id })] }))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('with EXECUTE (the Matrix link), the caller corrects a row; the audit row names the user and the connection', async () => {
    await run(`grant execute on function keystone.pub_editer(text, text, jsonb, jsonb, text, text) to ${caller}`, { database: name });
    const [c] = await run<{ id: string; name: string }>('select id, name from keystone.clients order by sort_order limit 1', { database: name });
    const [{ row }] = await run<{ row: Record<string, unknown> }>(
      `select keystone.pub_editer('clients', 'corriger', $1::jsonb, $2::jsonb, 'Camille Admin-IT', 'Raison sociale corrigée') as row`,
      { database: name, user: caller, values: [JSON.stringify({ id: c.id }), JSON.stringify({ name: `${c.name} SAS` })] },
    );
    expect(row).toMatchObject({ id: c.id, name: `${c.name} SAS` });
    const [a] = await run(`select actor_name, change, area, reason, before, after from keystone.audit_entries where entity_id = $1 order by occurred_at desc limit 1`, { database: name, values: [c.id] });
    expect(a).toEqual({
      actor_name: 'Camille Admin-IT', change: `Matrix (${caller}) · name: ${c.name} → ${c.name} SAS`, area: 'Matrix', reason: 'Raison sociale corrigée',
      before: { name: c.name }, after: { name: `${c.name} SAS` },
    });
    // The caller still may not write in Keystone's tables itself.
    await expect(run(`update keystone.clients set name = 'X' where id = $1`, { database: name, user: caller, values: [c.id] })).rejects.toMatchObject({ code: '42501' });
    // A refusal reaches the caller as raised: SQLSTATE and French message.
    await expect(run(`select keystone.pub_editer('users', 'corriger', '{"id": "00000000-0000-0000-0000-000000000000"}', '{"roles": "{director}"}', 'Camille', 'essai')`, { database: name, user: caller }))
      .rejects.toMatchObject({ code: 'P0K01', message: expect.stringContaining('Table « users » non modifiable depuis Matrix') });
  });

  it('nothing of Keystone in `public`', async () => {
    const rows = await run(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['pub\\_%', 'ks\\_%'])`, { database: name });
    expect(rows).toEqual([]);
  });
});
