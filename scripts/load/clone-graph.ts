// R-017 — generic row-graph cloning for the load data set (scripts/load/seed-volume.ts).
//
// The volume generator grows a demo database by copying real rows, so every module keeps rows that satisfy its constraints
// and the readers it was built for: a project is cloned with every row that hangs off it through the foreign keys (its plan,
// budget, documents, orders, ITP, site sheet, meetings…), and big tables are then "fanned out" inside each project (one copy
// of each activity, document, order… per round). The schema is read from the catalogue (pg_constraint / information_schema
// of the current schema), so the same code runs on PGlite (`public`) and on the shared PostgreSQL server (`keystone`).
//
// How a clone works:
//  1. ownership: the root rows are put in a temporary map (old id → new id); then every row of a table that references a
//     mapped row through a uuid foreign key is mapped too (following only `follow` tables), until nothing new is found;
//  2. copy: each table with mapped rows is copied in foreign-key order with one INSERT … SELECT, uuid foreign keys remapped
//     through the map (a reference to an unmapped row is kept: shared people, parts, suppliers…);
//  3. uniqueness: a unique constraint none of whose columns is remapped would be violated by the copy, so its text columns
//     are rewritten (the template project's code replaced by the new one, else the trailing number renumbered, else a
//     suffix); integer columns of such a constraint are offset.
// Scripts only (never imported by the application).
import { sql } from 'drizzle-orm';
import type { DB, Tx } from '@/server/db/types';

type Q = DB | Tx;

export interface Column { name: string; type: string; nullable: boolean }
export interface ForeignKey { table: string; columns: string[]; refTable: string; refColumns: string[] }
export interface TableInfo {
  name: string;
  columns: Column[];
  /** Single-column uuid primary key named `id`. */
  hasId: boolean;
  primaryKey: string[];
  fks: ForeignKey[];
  uniques: string[][];
}
export type Catalogue = Map<string, TableInfo>;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function rows<T>(q: Q, text: string): Promise<T[]> {
  return (await q.execute<T & Record<string, unknown>>(sql.raw(text))).rows as T[];
}

/** Base tables, columns, keys and unique constraints of the current schema. */
export async function readCatalogue(q: Q): Promise<Catalogue> {
  const cols = await rows<{ t: string; c: string; ty: string; n: string; g: string; i: string }>(q, `
    select c.table_name t, c.column_name c, c.udt_name ty, c.is_nullable n, c.is_generated g, c.identity_generation i
    from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = current_schema() and t.table_type = 'BASE TABLE' order by c.table_name, c.ordinal_position`);
  const cat: Catalogue = new Map();
  for (const r of cols) {
    if (r.g === 'ALWAYS' || r.i === 'ALWAYS') continue;
    let t = cat.get(r.t);
    if (!t) cat.set(r.t, (t = { name: r.t, columns: [], hasId: false, primaryKey: [], fks: [], uniques: [] }));
    t.columns.push({ name: r.c, type: r.ty, nullable: r.n === 'YES' });
  }
  const cons = await rows<{ t: string; ty: string; cols: string[]; rt: string | null; rcols: string[] | null }>(q, `
    select cl.relname t, co.contype ty,
      array(select a.attname::text from unnest(co.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.n order by k.o) cols,
      rc.relname rt,
      case when co.contype = 'f' then array(select a.attname::text from unnest(co.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = co.confrelid and a.attnum = k.n order by k.o) end rcols
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid left join pg_class rc on rc.oid = co.confrelid
    where co.connamespace = current_schema()::regnamespace and co.contype in ('p', 'u', 'f')`);
  for (const c of cons) {
    const t = cat.get(c.t);
    if (!t) continue;
    if (c.ty === 'p') t.primaryKey = c.cols;
    else if (c.ty === 'u') t.uniques.push(c.cols);
    else t.fks.push({ table: c.t, columns: c.cols, refTable: c.rt!, refColumns: c.rcols! });
  }
  // Unique indexes that are not constraints (partial ones included: treated as plain uniques, which is stricter).
  const idx = await rows<{ t: string; cols: string[] }>(q, `
    select cl.relname t, array(select a.attname::text from unnest(i.indkey) k(n) join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n) cols
    from pg_index i join pg_class ix on ix.oid = i.indexrelid join pg_class cl on cl.oid = i.indrelid
    where cl.relnamespace = current_schema()::regnamespace and i.indisunique and not i.indisprimary
      and not exists (select 1 from pg_constraint co where co.conindid = i.indexrelid)`);
  for (const i of idx) cat.get(i.t)?.uniques.push(i.cols);
  for (const t of cat.values()) {
    const idCol = t.columns.find((c) => c.name === 'id');
    t.hasId = !!idCol && idCol.type === 'uuid' && t.primaryKey.length === 1 && t.primaryKey[0] === 'id';
  }
  return cat;
}

/** uuid foreign key columns of a table (single-column keys), with the referenced table. */
const uuidFks = (cat: Catalogue, t: TableInfo) =>
  t.fks.filter((f) => f.columns.length === 1 && t.columns.find((c) => c.name === f.columns[0])?.type === 'uuid' && cat.has(f.refTable));

export interface CloneSpec {
  /** Root table and the SQL condition (on alias `s`) selecting its root rows. */
  root: { table: string; where: string };
  /** Extra roots: rows of other tables selected by a condition (e.g. mirrors keyed by project code). */
  extraRoots?: { table: string; where: string }[];
  /** Tables whose rows are followed (owned) when they reference a mapped row; the root tables are always copied. */
  follow: (table: string) => boolean;
  /** Per-table column overrides: SQL expressions on alias `s` (the source row). */
  overrides?: Record<string, Record<string, string>>;
  /** Text replacements applied to the rewritten unique columns and to text columns equal to `from` (project code). */
  rename?: { from: string; to: string; digitsFrom?: string; digitsTo?: string };
  /** Base of the renumbering of trailing numbers (unique per clone round). */
  numberBase: number;
  /** Suffix of the unique text values without a trailing number. */
  tag: string;
}

export interface CloneResult { rows: Record<string, number> }

/**
 * The id map of a clone: a work table of the load script (the shared server refuses temporary tables to keystone_app), emptied
 * at the start of each clone and dropped by `dropCloneMap` at the end of the script.
 */
async function ensureMap(q: Q): Promise<void> {
  await q.execute(sql.raw(`create unlogged table if not exists ks_clone_map (old uuid primary key, new uuid not null, tbl text not null)`));
  await q.execute(sql.raw(`truncate ks_clone_map`));
}

/** Drops the work table of the clones (end of the load script). */
export async function dropCloneMap(q: Q): Promise<void> {
  await q.execute(sql.raw(`drop table if exists ks_clone_map`));
}

/** Tables in foreign-key order (parents first), restricted to `names`; edges inside a cycle are reported as deferred. */
function topoOrder(cat: Catalogue, names: Set<string>): { order: string[]; deferred: Set<string> } {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const deferred = new Set<string>();
  const visit = (n: string) => {
    state.set(n, 1);
    for (const f of uuidFks(cat, cat.get(n)!)) {
      if (!names.has(f.refTable) || f.refTable === n) continue;
      const s = state.get(f.refTable);
      if (s === 1) deferred.add(`${n}.${f.columns[0]}`);
      else if (!s) visit(f.refTable);
    }
    state.set(n, 2);
    order.push(n);
  };
  for (const n of [...names].sort()) if (!state.get(n)) visit(n);
  return { order, deferred };
}

/** Rewrite of a text value of a unique column (see the header). */
function uniqueTextExpr(col: string, spec: CloneSpec): string {
  const c = `s.${ident(col)}`;
  const parts = [`when ${c} is null then null`];
  if (spec.rename) {
    parts.push(`when strpos(${c}, ${lit(spec.rename.from)}) > 0 then replace(${c}, ${lit(spec.rename.from)}, ${lit(spec.rename.to)})`);
    if (spec.rename.digitsFrom && spec.rename.digitsTo)
      parts.push(`when ${c} ~ ${lit('-' + spec.rename.digitsFrom + '$')} then regexp_replace(${c}, ${lit(spec.rename.digitsFrom + '$')}, ${lit(spec.rename.digitsTo)})`);
  }
  parts.push(`when ${c} ~ '[0-9]+$' then regexp_replace(${c}, '[0-9]+$', '') || (${spec.numberBase} + row_number() over ())::text`);
  parts.push(`else ${c} || ${lit('-' + spec.tag)}`);
  return `(case ${parts.join(' ')} end)`;
}

/**
 * Clones the row graph of `spec` and returns the copied row count per table. Runs inside the caller's transaction (`q`); the
 * temporary map lives on that connection.
 */
export async function cloneGraph(q: Q, cat: Catalogue, spec: CloneSpec): Promise<CloneResult> {
  await ensureMap(q);
  const rootTables = new Set([spec.root.table, ...(spec.extraRoots ?? []).map((r) => r.table)]);
  const owned = (t: string) => rootTables.has(t) || spec.follow(t);
  // 1. Ownership.
  const leafRoots: { table: string; where: string }[] = [];
  for (const r of [spec.root, ...(spec.extraRoots ?? [])]) {
    const t = cat.get(r.table)!;
    if (t.hasId) await q.execute(sql.raw(`insert into ks_clone_map select s.id, gen_random_uuid(), ${lit(r.table)} from ${ident(r.table)} s where ${r.where} on conflict do nothing`));
    else leafRoots.push(r);
  }
  const idTables = [...cat.values()].filter((t) => t.hasId && owned(t.name) && !rootTables.has(t.name));
  const { order: idOrder } = topoOrder(cat, new Set(idTables.map((t) => t.name)));
  for (let pass = 0; pass < 6; pass++) {
    let added = 0;
    for (const name of idOrder) {
      const t = cat.get(name)!;
      const fks = uuidFks(cat, t);
      if (!fks.length) continue;
      const cond = fks.map((f) => `s.${ident(f.columns[0])} in (select old from ks_clone_map)`).join(' or ');
      const r = await rows<{ n: number }>(q, `with i as (insert into ks_clone_map select s.id, gen_random_uuid(), ${lit(name)} from ${ident(name)} s
        where (${cond}) on conflict do nothing returning 1) select count(*)::int n from i`);
      added += r[0].n;
    }
    if (!added) break;
  }
  const mappedTables = new Set((await rows<{ tbl: string }>(q, `select distinct tbl from ks_clone_map`)).map((r) => r.tbl));
  // Tables without an id (composite keys) referencing a mapped row are copied too, after their parents.
  const leafTables = [...cat.values()].filter((t) => !t.hasId && owned(t.name) && uuidFks(cat, t).some((f) => mappedTables.has(f.refTable) || cat.get(f.refTable)?.hasId === false));
  const copyTables = new Set<string>([...mappedTables, ...leafTables.map((t) => t.name), ...leafRoots.map((r) => r.table)]);
  const { order, deferred } = topoOrder(cat, copyTables);
  // 2–3. Copy.
  const result: Record<string, number> = {};
  const deferredUpdates: string[] = [];
  for (const name of order) {
    const t = cat.get(name)!;
    const fks = uuidFks(cat, t);
    const remapped = new Set<string>();
    const joins: string[] = [];
    const exprs: string[] = [];
    let j = 0;
    const fkAlias = new Map<string, string>();
    for (const f of fks) {
      const col = f.columns[0];
      // A key into a table that is copied (mapped ids or a leaf keyed by a mapped id) is remapped.
      if (!copyTables.has(f.refTable) && !mappedTables.has(f.refTable)) continue;
      const a = `m${j++}`;
      joins.push(`left join ks_clone_map ${a} on ${a}.old = s.${ident(col)}`);
      fkAlias.set(col, a);
      remapped.add(col);
    }
    if (t.hasId) remapped.add('id');
    const ov = spec.overrides?.[name] ?? {};
    const mutate = new Map<string, string>();
    for (const u of t.uniques) {
      if (u.some((c) => remapped.has(c) || ov[c] !== undefined)) continue;
      for (const c of u) {
        const ty = t.columns.find((x) => x.name === c)?.type;
        if (ty === 'text' || ty === 'varchar') mutate.set(c, uniqueTextExpr(c, spec));
        else if (ty === 'int4' || ty === 'int8' || ty === 'int2') mutate.set(c, `(s.${ident(c)} + ${spec.numberBase})`);
      }
    }
    for (const c of t.columns) {
      const s = `s.${ident(c.name)}`;
      if (ov[c.name] !== undefined) exprs.push(ov[c.name]);
      else if (c.name === 'id' && t.hasId) exprs.push('m_id.new');
      else if (fkAlias.has(c.name)) {
        if (deferred.has(`${name}.${c.name}`)) {
          exprs.push('null');
          deferredUpdates.push(`update ${ident(name)} d set ${ident(c.name)} = m.new from ks_clone_map m, ks_clone_map me, ${ident(name)} s
            where me.tbl = ${lit(name)} and me.new = d.id and s.id = me.old and m.old = s.${ident(c.name)}`);
        } else exprs.push(`coalesce(${fkAlias.get(c.name)}.new, ${s})`);
      } else if (mutate.has(c.name)) exprs.push(mutate.get(c.name)!);
      else if (spec.rename && (c.type === 'text' || c.type === 'varchar')) exprs.push(`(case when ${s} = ${lit(spec.rename.from)} then ${lit(spec.rename.to)} else ${s} end)`);
      else exprs.push(s);
    }
    let from = `${ident(name)} s`;
    let where = '';
    if (t.hasId) from += ` join ks_clone_map m_id on m_id.old = s.id`;
    else {
      const leafRoot = leafRoots.find((r) => r.table === name);
      const conds = [...fkAlias.values()].map((a) => `${a}.old is not null`);
      if (leafRoot) conds.push(`(${leafRoot.where})`);
      where = `where ${conds.join(' or ') || 'false'}`;
    }
    const text = `with i as (insert into ${ident(name)} (${t.columns.map((c) => ident(c.name)).join(', ')})
      select ${exprs.join(', ')} from ${from} ${joins.join(' ')} ${where} returning 1) select count(*)::int n from i`;
    try {
      const r = await rows<{ n: number }>(q, text);
      result[name] = r[0].n;
    } catch (e) {
      const cause = (e as { cause?: Error }).cause ?? (e as Error);
      throw new Error(`clone ${name}: ${cause.message}`);
    }
  }
  for (const u of deferredUpdates) await q.execute(sql.raw(u));
  return { rows: result };
}
