// R-017 — grows a DEMO database to a realistic EPC2i size, for the load measurements (npm run load:measure).
//   npm run load:seed                                  PGlite of KEYSTONE_DATA_DIR (default ./.data): created and seeded if empty
//   KEYSTONE_DATA_DIR=/tmp/ks-load npm run load:seed   a throw-away data directory (recommended)
//   DATABASE_URL=postgres://… npm run load:seed        a PostgreSQL server already migrated with the demo seed (db:migrate)
// Options: --projects=150 (portfolio size), --scale=1 (multiplies the fan-out targets), --dry (one clone, rolled back, prints
// the per-table copy). Refuses a production database (KEYSTONE_SEED=production). Each step tops the database up to its target,
// so a second run adds nothing. Never run it on a server whose data is kept: it writes tens of thousands of rows that nothing
// removes.
//
// What it does (docs/delivery-9/notes-r017-volumes.md):
//  1. clones the demo projects that have data (round robin) until the portfolio holds --projects projects, each with every
//     row hanging off it (scripts/load/clone-graph.ts), with a new code, number and analytic code;
//  2. fans out the big tables inside every project (activities, milestones, documents and their revisions, purchase orders
//     and their lines, punch items) and the people (with their skills, allocations and leave);
//  3. generates two years of hours (time entries on the tasks, one a week) and leave, and audit rows up to the target;
//  4. ANALYZE, then prints the row counts.
process.env.KEYSTONE_CLOCK ??= '2026-09-25';
import { loadEnvFiles } from '@/server/config/env-files';

const arg = (name: string, def: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};

/** Targets of the realistic size (owner's order of magnitude for EPC2i, R-017), multiplied by --scale. */
export const VOLUME_TARGETS = {
  projects: 150,
  activities: 30_000,
  milestones: 5_000,
  documents: 20_000,
  purchaseOrders: 8_000,
  punchItems: 3_000,
  auditEntries: 50_000,
  persons: 500,
  /** Weeks of hours and leave generated back from the business date. */
  weeks: 104,
};

/** Tables never copied with a project: shared references, mirrors of other apps' global records, files and jobs. */
const DENY = new Set([
  'persons', 'users', 'clients', 'departments', 'parts', 'suppliers', 'storage_locations', 'stock_positions', 'stored_files',
  'cursus_events', 'vigie_ecos', 'machine_catalogue_entries', 'capex_mirror', 'capex_needs', 'capex_sync_runs', 'need_answers',
  'import_jobs', 'import_job_rows', 'export_log', 'job_locks', 'matrix_subsidiaries', 'connectors', 'connector_sync_runs',
  'share_project_progress', 'zones', 'countries', 'cities',
]);

async function main(): Promise<void> {
  loadEnvFiles(process.cwd());
  const { sql } = await import('drizzle-orm');
  const { getDb } = await import('@/server/db/client');
  const { readCatalogue, cloneGraph, dropCloneMap } = await import('./clone-graph');
  const { readSeedRecord } = await import('@/server/db/seed/mode');
  const db = await getDb();
  const q = async <T,>(text: string) => (await db.execute<T & Record<string, unknown>>(sql.raw(text))).rows as T[];
  const one = async (text: string) => Number((await q<{ n: number }>(text))[0]?.n ?? 0);
  const scale = arg('scale', 1);
  const target = arg('projects', VOLUME_TARGETS.projects);
  const dry = process.argv.includes('--dry');
  const t0 = Date.now();
  const lap = (what: string) => console.log(`${what} — ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const record = await readSeedRecord(db);
  if (record?.mode === 'production') throw new Error('Refused: production database (KEYSTONE_SEED=production) — the load data set grows demo databases only');
  // Every step tops the database up to its target: a second run adds nothing (or what a larger --scale asks for).
  const existing = await one(`select count(*)::int n from projects`);

  // The clones' work table must not be read as a table of the schema (left over by an interrupted run).
  await dropCloneMap(db);
  const cat = await readCatalogue(db);
  const follow = (t: string) => !DENY.has(t);
  const templates = await q<{ id: string; code: string; number: string; name: string; analytic_code: string | null }>(
    `select p.id, p.code, p.number, p.name, p.analytic_code from projects p where exists (select 1 from project_controls c where c.project_id = p.id) order by p.sort_order`);
  if (!templates.length) throw new Error('No demo project with data to clone');
  const codeTables = [...cat.values()].filter((t) => t.columns.some((c) => c.name === 'project_code') && follow(t.name) && t.name !== 'projects').map((t) => t.name);

  // ── 1. Projects ──
  const toCreate = dry ? 1 : Math.max(0, target - existing);
  const totals: Record<string, number> = {};
  let maxNumber = await one(`select coalesce(max(cast(substring(number from 2) as integer)), 0)::int n from projects where number ~ '^#[0-9]+$'`);
  const minSort = await one(`select coalesce(min(sort_order), 0)::int n from projects`);
  for (let i = 0; i < toCreate; i++) {
    const tpl = templates[i % templates.length];
    const n = Math.max(100, maxNumber + 1);
    maxNumber = n;
    const prefix = tpl.code.slice(0, 3);
    const code = `${prefix}-${n}`;
    const digits = String(n);
    const analytic = `${(tpl.analytic_code ?? prefix).slice(0, 3)}${String(n % 1000).padStart(3, '0')}`;
    const run = async () => db.transaction(async (tx) => {
      const r = await cloneGraph(tx, cat, {
        root: { table: 'projects', where: `s.id = '${tpl.id}'` },
        extraRoots: codeTables.map((t) => ({ table: t, where: `s.project_code = '${tpl.code}'` })),
        follow,
        overrides: {
          projects: {
            code: `'${code}'`, number: `'#${digits}'`, short_code: `'${prefix}'`, analytic_code: `'${analytic}'`,
            name: `s.name || ' · L${digits}'`, sort_order: String(minSort - 1 - i), capex_code: 'null', besoin_ref: 'null',
          },
          project_equipments: { besoin_ref: 'null' },
        },
        rename: { from: tpl.code, to: code, digitsFrom: tpl.number.slice(1), digitsTo: digits },
        numberBase: 1_000_000 + i * 10_000,
        tag: `L${digits}`,
      });
      if (dry) {
        console.log(JSON.stringify(Object.entries(r.rows).filter(([, v]) => v).sort((a, b) => b[1] - a[1])));
        throw new Error('dry run: rolled back');
      }
      return r;
    });
    const r = await run().catch((e) => { if (dry) { console.log(String(e.message)); return null; } throw e; });
    if (!r) return;
    for (const [k, v] of Object.entries(r.rows)) totals[k] = (totals[k] ?? 0) + v;
    if ((i + 1) % 10 === 0) lap(`${i + 1}/${toCreate} projects cloned`);
  }
  lap(`projects: ${await one('select count(*)::int n from projects')}`);

  // ── 2. Fan-out inside every project ──
  // One round copies every row of `table` (with its `children`) once; rounds = ceil(target / current) - 1.
  const fanOut = async (table: string, goal: number, children: string[], overrides: Record<string, Record<string, string>> = {}, rootWhere = 'true') => {
    let round = 0;
    for (;;) {
      const current = await one(`select count(*)::int n from ${table}`);
      if (current >= goal) break;
      // A round copies at most what is missing (oldest rows first: the demo rows, then the copies).
      const missing = goal - current;
      const keep = new Set(children);
      await db.transaction(async (tx) => {
        await cloneGraph(tx, cat, {
          root: { table, where: `${rootWhere} and s.id in (select id from ${table} order by id limit ${missing})` },
          follow: (t) => keep.has(t),
          overrides,
          numberBase: 5_000_000 + round * 100_000,
          tag: `F${round + 1}`,
        });
      });
      round++;
    }
    lap(`${table}: ${await one(`select count(*)::int n from ${table}`)} (${round} rounds)`);
  };
  const S = (n: number) => Math.round(n * scale);
  if (!dry) {
    await fanOut('activities', S(VOLUME_TARGETS.activities), ['activity_assignments']);
    await fanOut('milestones', S(VOLUME_TARGETS.milestones), [], { milestones: { capex_milestone_code: 'null', activity_id: 'null' } });
    await fanOut('documents', S(VOLUME_TARGETS.documents), ['document_revisions', 'document_approvals', 'document_acknowledgements']);
    await fanOut('purchase_orders', S(VOLUME_TARGETS.purchaseOrders), ['po_lines']);
    await fanOut('punch_items', S(VOLUME_TARGETS.punchItems), []);
    await fanOut('persons', S(VOLUME_TARGETS.persons), ['person_skills', 'allocations', 'leave_entries', 'certifications'],
      { persons: { email: 'null', resource_pool_position: 'null' } }, "s.client_id is null and s.is_contract_role = false");

    // ── 3. Two years of hours and leave, audit rows ──
    const weeks = VOLUME_TARGETS.weeks;
    const today = process.env.KEYSTONE_CLOCK && /^\d{4}-\d{2}-\d{2}$/.test(process.env.KEYSTONE_CLOCK) ? process.env.KEYSTONE_CLOCK : new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`insert into time_entries (task_id, person_id, work_date, hours, note, source, position)
        select t.id, t.assignee_person_id, (date '${today}' - (w * 7 + 3))::date, 4 + (w % 5), 'Load data set', 'keystone', 100 + w
        from tasks t cross join generate_series(1, ${weeks}) w where t.assignee_person_id is not null
        and not exists (select 1 from time_entries e where e.task_id = t.id and e.note = 'Load data set')`));
      // Leave: one week every two months per internal person, over the two years (Cursus absences).
      await tx.execute(sql.raw(`insert into leave_entries (person_id, leave_type, week_start, start_date, end_date, days, status, source)
        select p.id, 'leave', d::date, d::date, (d + interval '4 days')::date, 5, 'approved', 'cursus'
        from persons p cross join lateral (
          select (date_trunc('week', date '${today}') - (k * 8 + (abs(hashtext(p.id::text)) % 8)) * interval '1 week') d from generate_series(0, ${Math.floor(weeks / 8)}) k
        ) x where p.client_id is null
        and not exists (select 1 from leave_entries l where l.person_id = p.id and l.week_start = x.d::date)`));
    });
    lap(`time_entries: ${await one('select count(*)::int n from time_entries')}, leave_entries: ${await one('select count(*)::int n from leave_entries')}`);
    const audit = await one('select count(*)::int n from audit_entries');
    const auditGoal = S(VOLUME_TARGETS.auditEntries);
    if (audit < auditGoal) {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`insert into audit_entries (occurred_at, actor_person_id, actor_name, object_ref, change, area, entity_type, project_id)
          with pp as (select array_agg(id order by id) ids, array_agg(coalesce(full_name, short_name, 'Load user') order by id) names from persons where client_id is null),
            pr as (select array_agg(id order by id) ids from projects),
            ar as (select array['Change control','Approvals','Plan','Budget','Documents','Purchasing','Site','Quality'] a)
          select timestamptz '${today} 18:00:00+00' - (g * interval '23 minutes'), pp.ids[1 + g % array_length(pp.ids, 1)], pp.names[1 + g % array_length(pp.ids, 1)],
            'Load ' || g, 'status: Draft → In review', ar.a[1 + g % 8], 'load', pr.ids[1 + g % array_length(pr.ids, 1)]
          from generate_series(1, ${auditGoal - audit}) g, pp, pr, ar`));
      });
    }
    lap(`audit_entries: ${await one('select count(*)::int n from audit_entries')}`);
    await dropCloneMap(db);
    await db.execute(sql.raw('analyze'));
  }

  const counts = ['projects', 'activities', 'milestones', 'documents', 'document_revisions', 'purchase_orders', 'po_lines', 'punch_items', 'audit_entries',
    'persons', 'time_entries', 'leave_entries', 'tasks', 'notifications', 'risks', 'meetings', 'activity_assignments', 'allocations'];
  for (const t of counts) console.log(`${t.padEnd(22)} ${await one(`select count(*)::int n from ${t}`)}`);
  lap('done');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? `${e.message}${e.cause instanceof Error ? `\ncause: ${e.cause.message}` : ''}` : e);
    process.exit(1);
  },
);
