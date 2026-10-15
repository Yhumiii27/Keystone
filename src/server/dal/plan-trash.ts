import 'server-only';
// Plan trash (chapter 4, S-5: "confirmation and keep the possibility to undo"). Removing a work package or an activity on the
// Plan moves, in one transaction, every row that belongs to it out of the business tables and into one `plan_trash` row:
//   - the node itself (work package, or activity);
//   - for a work package: its activities and its Schedule bar (A-7 roll-up);
//   - for every removed activity: its logic links (both directions, with type, lag, position and driving flag), resource
//     assignments, request activity choices, what-if scenario actions, and its Plan to-dos — the tasks created by the drawer
//     composer without logged time (with their checklist, comments and attachment rows);
//   - the references other modules had to these rows (milestones, Budget WP lines, change-request WBS, risks, purchase orders,
//     other tasks…), which are cleared as before and remembered.
// Nothing stays behind in the business tables, so no read of the app (Plan, Schedule, CPM network, KPIs, Home, exports, MSPDI
// export…) has to filter "deleted" rows. "Undo" (toast) and "Recently deleted" (Plan) re-insert the rows with their original ids
// and values and re-attach the references; the trash row is then dropped.
//
// Which tables are concerned is read from the Drizzle schema's foreign keys (cascading children are taken with their parent,
// other references are cleared and remembered), so a table added later that points at an activity is handled too.
//
// Purge rule: each new removal on a project first purges that project's trash rows older than PLAN_TRASH_RETENTION_DAYS (real
// clock, S-4: timestamps follow the real clock) and keeps at most PLAN_TRASH_MAX_ENTRIES; an expired row can no longer be restored.
// Both values are S-5 defaults still to be confirmed by the owner (src/domain/ch4-defaults.ts).
//
// Positions (R-064, "ghost slots"): work packages and activities share one position sequence per project. A removed row keeps
// its slot: a writer that opens a slot below it (insertActivity) shifts the positions stored in the trash with the live rows
// (`shiftTrashedPositions`), a new work package goes after the trashed ones too (`maxTrashedPosition`), so a restore puts the
// rows back between the same neighbours with unique positions. If a stored slot is taken anyway, the rows at or above it are
// shifted by the block size first. A restored link whose position among its successor's predecessors was taken since goes last.
// The writers of the sequence lock the project row (FOR UPDATE) so concurrent inserts, removals and restores are serialised.
// R-006: the worker's "plan-trash-purge" job applies the same rule to every project on a schedule (`purgeExpiredPlanTrash`),
// so expired entries and their attachment files also leave the projects nobody edits.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import { PLAN_TRASH_MAX_ENTRIES, PLAN_TRASH_RETENTION_DAYS } from '@/domain/ch4-defaults';
import { trashEntriesToPurge } from '@/domain/jobs';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, nextNumber, recordActivity, writeAudit } from '@/server/db/helpers';
import * as schema from '@/server/db/schema';
import { activities, activityLinks, planTrash, projects, tasks, timeEntries, wbsNodes } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { deleteStoredFile } from '@/server/storage/files';

/** S-5 defaults (src/domain/ch4-defaults.ts), re-exported for the Plan page and the tests. */
export { PLAN_TRASH_MAX_ENTRIES, PLAN_TRASH_RETENTION_DAYS };
/** Entries shown in the Plan "Recently deleted" list. */
export const PLAN_TRASH_LIST_LIMIT = 5;

type Row = Record<string, unknown>;

/** What a trash row keeps: removed rows per table (insert order) and the references that were cleared. */
export interface TrashPayload {
  v: 1;
  tables: { table: string; rows: Row[] }[];
  /** `table`.`column` (TS key) of row `id` pointed at `value`, a row of `target`. */
  refs: { table: string; column: string; id: string; value: string; target: string }[];
}

export interface PlanTrashEntry {
  id: string;
  kind: 'wp' | 'act';
  code: string;
  name: string;
  activityCount: number;
  deletedAt: Date;
  deletedByName: string;
}

export type RestoreResult =
  | { ok: true; kind: 'wp' | 'act'; code: string; name: string; activityCount: number; links: number }
  /** unknown: no such entry for the project (or expired); conflict: a row with the same code was created since; parent: the work package is gone. */
  | { error: 'unknown' | 'conflict' | 'parent'; code?: string };

// ── Schema graph ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Edge {
  /** Referencing table and its column (TS key + Drizzle column). */
  from: PgTable;
  fromName: string;
  key: string;
  column: PgColumn;
  /** Referenced table name. */
  to: string;
  onDelete: string | undefined;
}

let graph: { tables: Map<string, PgTable>; edges: Edge[] } | null = null;

function schemaGraph() {
  if (graph) return graph;
  const tables = new Map<string, PgTable>();
  const edges: Edge[] = [];
  for (const v of Object.values(schema)) {
    if (!(v instanceof PgTable)) continue;
    const cfg = getTableConfig(v);
    tables.set(cfg.name, v);
    const cols = colsOf(v);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length !== 1) continue;
      const key = Object.keys(cols).find((k) => cols[k] === ref.columns[0]);
      if (!key) continue;
      edges.push({ from: v, fromName: cfg.name, key, column: ref.columns[0], to: getTableConfig(ref.foreignTable).name, onDelete: fk.onDelete });
    }
  }
  graph = { tables, edges };
  return graph;
}

const nameOfTable = (t: PgTable) => getTableConfig(t).name;
const colsOf = (t: PgTable) => getTableColumns(t) as Record<string, PgColumn>;
const idColumn = (t: PgTable): PgColumn | undefined => colsOf(t).id;

/** Rows owned by their parent besides the cascading ones: a package's activities and its Schedule bar (no cascade in the schema). */
const OWNED: ReadonlySet<string> = new Set(['activities.wbsNodeId', 'schedule_bars.wbsNodeId']);
/** Never followed: the WBS tree itself (only level-1 packages without child nodes are removable). */
const IGNORED: ReadonlySet<string> = new Set(['wbs_nodes.parentId']);

// ── Ghost slots (R-064) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Tables of the shared WBS position sequence (work packages and activities). */
const POSITIONED: ReadonlySet<string> = new Set(['wbs_nodes', 'activities']);

/** Positions stored in a trash payload (work packages and activities). */
const storedPositions = (p: TrashPayload) =>
  p.tables.filter((g) => POSITIONED.has(g.table)).flatMap((g) => g.rows.map((r) => r.position)).filter((x): x is number => typeof x === 'number');

/**
 * Shifts by `by` the positions stored in the project's trash entries (work packages and activities) at or above `from` — the
 * ghost slots move with the live rows when a writer opens a slot below them. Every entry of the project (rows handed over
 * between entries included); `exceptId` = the entry being restored. Inside the writer's transaction.
 */
export async function shiftTrashedPositions(tx: Tx, projectId: string, from: number, by: number, exceptId?: string): Promise<void> {
  const entries = await tx.select({ id: planTrash.id, payload: planTrash.payload }).from(planTrash).where(eq(planTrash.projectId, projectId));
  for (const e of entries) {
    if (e.id === exceptId) continue;
    const pl = e.payload as unknown as TrashPayload;
    let changed = false;
    for (const g of pl.tables) {
      if (!POSITIONED.has(g.table)) continue;
      for (const r of g.rows) {
        if (typeof r.position !== 'number' || r.position < from) continue;
        r.position += by;
        changed = true;
      }
    }
    if (changed) await tx.update(planTrash).set({ payload: pl as unknown as Record<string, unknown> }).where(eq(planTrash.id, e.id));
  }
}

/** Highest position held by a trashed work package or activity of the project (its ghost slot), null when none. */
export async function maxTrashedPosition(tx: Tx, projectId: string): Promise<number | null> {
  const entries = await tx.select({ payload: planTrash.payload }).from(planTrash).where(eq(planTrash.projectId, projectId));
  const all = entries.flatMap((e) => storedPositions(e.payload as unknown as TrashPayload));
  return all.length ? Math.max(...all) : null;
}

/** Locks the project row: the writers of its position sequence (insert, remove, restore) run one at a time. */
export async function lockProjectRow(tx: Tx, where: { id: string } | { code: string }): Promise<{ id: string } | null> {
  const [p] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where('id' in where ? eq(projects.id, where.id) : eq(projects.code, where.code))
    .for('update');
  return p ?? null;
}

/**
 * Restored links (R-064): a link whose position among its successor's predecessors was taken since the removal (the successor's
 * logic rewritten by updateActivity) goes after the successor's last predecessor instead.
 */
async function freeLinkPositions(tx: Tx, values: Row[]): Promise<Row[]> {
  const succIds = [...new Set(values.map((v) => v.successorId).filter((x): x is string => typeof x === 'string'))];
  if (!succIds.length) return values;
  const live = await tx.select({ succ: activityLinks.successorId, position: activityLinks.position }).from(activityLinks).where(inArray(activityLinks.successorId, succIds));
  const used = new Map<string, Set<number>>();
  for (const l of live) used.set(l.succ, (used.get(l.succ) ?? new Set()).add(l.position));
  return values.map((v) => {
    const succ = v.successorId as string;
    const taken = used.get(succ) ?? new Set<number>();
    const position = taken.has(v.position as number) ? Math.max(...taken) + 1 : (v.position as number);
    used.set(succ, taken.add(position));
    return position === v.position ? v : { ...v, position };
  });
}

// ── Capture & delete ───────────────────────────────────────────────────────────────────────────────────────────────

/** Tasks linked to `activityIds` that the drawer may remove (composer to-dos without logged time) — they go with the activity. */
async function plannedTodoIds(tx: Tx, activityIds: string[]): Promise<Set<string>> {
  if (!activityIds.length) return new Set();
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        inArray(tasks.activityId, activityIds), eq(tasks.origin, 'activity_todo'), sql`${tasks.loggedH} = 0`,
        sql`not exists (select 1 from ${timeEntries} where ${timeEntries.taskId} = ${tasks.id})`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

async function capture(tx: Tx, root: PgTable, rootIds: string[]): Promise<TrashPayload> {
  const { edges } = schemaGraph();
  const order: string[] = [];
  const owned = new Map<string, Map<string, Row>>();
  const refs: TrashPayload['refs'] = [];
  const add = (table: string, rows: Row[]) => {
    if (!owned.has(table)) {
      owned.set(table, new Map());
      order.push(table);
    }
    const m = owned.get(table)!;
    const fresh: string[] = [];
    for (const r of rows) {
      const k = typeof r.id === 'string' ? r.id : JSON.stringify(r);
      if (m.has(k)) continue;
      m.set(k, r);
      if (typeof r.id === 'string') fresh.push(r.id);
    }
    return fresh;
  };
  const rootId = idColumn(root)!;
  const queue: { table: string; ids: string[] }[] = [{ table: nameOfTable(root), ids: add(nameOfTable(root), await tx.select().from(root).where(inArray(rootId, rootIds))) }];
  while (queue.length) {
    const { table, ids } = queue.shift()!;
    if (!ids.length) continue;
    const todos = table === 'activities' ? await plannedTodoIds(tx, ids) : new Set<string>();
    for (const e of edges.filter((x) => x.to === table)) {
      const tag = `${e.fromName}.${e.key}`;
      if (IGNORED.has(tag)) continue;
      const rows = (await tx.select().from(e.from).where(inArray(e.column, ids))) as Row[];
      if (!rows.length) continue;
      const own = (r: Row) => e.onDelete === 'cascade' || OWNED.has(tag) || (tag === 'tasks.activityId' && todos.has(r.id as string));
      const mine = rows.filter(own);
      if (mine.length) {
        const fresh = add(e.fromName, mine);
        if (fresh.length) queue.push({ table: e.fromName, ids: fresh });
      }
      for (const r of rows) {
        if (own(r)) continue;
        if (typeof r.id !== 'string') throw new Error(`plan trash: ${e.fromName} has no id column`);
        refs.push({ table: e.fromName, column: e.key, id: r.id, value: r[e.key] as string, target: table });
      }
    }
  }
  // A reference held by a row that is itself removed is restored with that row.
  const keptRefs = refs.filter((r) => !owned.get(r.table)?.has(r.id));
  return { v: 1, tables: order.map((table) => ({ table, rows: [...owned.get(table)!.values()] })), refs: keptRefs };
}

async function removeCaptured(tx: Tx, p: TrashPayload): Promise<void> {
  const { tables } = schemaGraph();
  for (const r of p.refs) {
    const t = tables.get(r.table)!;
    await tx.update(t).set({ [r.column]: null }).where(eq(idColumn(t)!, r.id));
  }
  for (const { table, rows } of [...p.tables].reverse()) {
    const t = tables.get(table)!;
    const id = idColumn(t);
    // Tables without an id (composite keys) are cascading children: they leave with their parent.
    if (!id) continue;
    const ids = rows.map((r) => r.id as string);
    if (ids.length) await tx.delete(t).where(inArray(id, ids));
  }
}

/**
 * Purges the project's expired trash rows and those beyond the `keep` newest (src/domain/jobs.ts `trashEntriesToPurge`);
 * returns the stored files of their attachments. A removal keeps PLAN_TRASH_MAX_ENTRIES - 1 (room for its own entry).
 */
async function purge(tx: Tx, projectId: string, now: Date, keep = PLAN_TRASH_MAX_ENTRIES - 1): Promise<string[]> {
  const all = await tx.select({ id: planTrash.id, deletedAt: planTrash.deletedAt, payload: planTrash.payload }).from(planTrash).where(eq(planTrash.projectId, projectId));
  const gone = trashEntriesToPurge(all, now, PLAN_TRASH_RETENTION_DAYS, keep);
  if (!gone.length) return [];
  await tx.delete(planTrash).where(inArray(planTrash.id, gone.map((g) => g.id)));
  return gone.flatMap((g) => ((g.payload as unknown as TrashPayload).tables.find((t) => t.table === 'task_attachments')?.rows ?? []).map((r) => r.fileId as string | null).filter((x): x is string => !!x));
}

/**
 * Scheduled purge (R-006, worker job "plan-trash-purge"): every project's trash entries older than PLAN_TRASH_RETENTION_DAYS
 * or beyond PLAN_TRASH_MAX_ENTRIES are deleted, one transaction per project, then the stored files of their attachments.
 * Idempotent (a second run finds nothing). Returns the entries and files removed.
 */
export async function purgeExpiredPlanTrash(now = new Date()): Promise<{ entries: number; files: number; projects: number }> {
  const db = await getDb();
  const owners = await db.selectDistinct({ projectId: planTrash.projectId }).from(planTrash);
  let entries = 0;
  let files = 0;
  let projectsPurged = 0;
  for (const { projectId } of owners) {
    const out = await db.transaction(async (tx) => {
      const before = await tx.select({ id: planTrash.id }).from(planTrash).where(eq(planTrash.projectId, projectId));
      const stored = await purge(tx, projectId, now, PLAN_TRASH_MAX_ENTRIES);
      const after = await tx.select({ id: planTrash.id }).from(planTrash).where(eq(planTrash.projectId, projectId));
      return { removed: before.length - after.length, stored };
    });
    if (out.removed) projectsPurged++;
    entries += out.removed;
    for (const f of out.stored) if (await deleteStoredFile(f).catch(() => false)) files++;
  }
  return { entries, files, projects: projectsPurged };
}

/**
 * Removes a work package (with its activities) or an activity into the trash. Returns the trash entry id, or null when the
 * node does not exist (or is the WBS root). Audited, with an activity-feed line.
 */
export async function trashPlanRow(code: string, kind: 'wp' | 'act', key: string, actorName: string, now = new Date()): Promise<string | null> {
  const db = await getDb();
  const out = await db.transaction(async (tx) => {
    const p = await lockProjectRow(tx, { code });
    if (!p) return null;
    let root: { id: string; name: string };
    let activityCount: number;
    if (kind === 'wp') {
      const [n] = await tx.select({ id: wbsNodes.id, name: wbsNodes.name, level: wbsNodes.level }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), eq(wbsNodes.code, key)));
      if (!n || n.level !== 1) return null;
      const [child] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(eq(wbsNodes.parentId, n.id)).limit(1);
      if (child) return null;
      root = n;
      [{ n: activityCount }] = await tx.select({ n: sql<number>`count(*)::int` }).from(activities).where(eq(activities.wbsNodeId, n.id));
    } else {
      const [a] = await tx.select({ id: activities.id, name: activities.name }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, key)));
      if (!a) return null;
      root = a;
      activityCount = 1;
    }
    const files = await purge(tx, p.id, now);
    const payload = await capture(tx, kind === 'wp' ? wbsNodes : activities, [root.id]);
    await removeCaptured(tx, payload);
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const [t] = await tx
      .insert(planTrash)
      .values({ projectId: p.id, kind, code: key, name: root.name, activityCount, payload: payload as unknown as Record<string, unknown>, deletedAt: now, deletedByPersonId: actor?.id ?? null, deletedByName: who })
      .returning({ id: planTrash.id });
    const what = kind === 'wp' ? `work package ${key} · ${root.name} removed · ${activityCount} activities` : `activity ${key} · ${root.name} removed`;
    const links = payload.tables.find((x) => x.table === 'activity_links')?.rows.length ?? 0;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: `${code} ${key}`, change: `${what} · ${links} links (restorable)`, area: 'Planning', entityType: kind === 'wp' ? 'wbs_node' : 'activity', entityId: root.id, projectId: p.id });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: kind === 'wp' ? `Removed work package ${key} · ${root.name}` : `Removed activity ${key} · ${root.name}`, kind: 'change', projectId: p.id });
    return { id: t.id, files };
  });
  if (!out) return null;
  for (const f of out.files) await deleteStoredFile(f).catch(() => false);
  return out.id;
}

// ── Restore ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** JSON → column values (timestamps back to Date). */
function revive(t: PgTable, r: Row): Row {
  const cols = colsOf(t);
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    const c = cols[k];
    if (!c) continue;
    out[k] = c.dataType === 'date' && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}

async function existingIds(tx: Tx, table: string, ids: string[]): Promise<Set<string>> {
  const t = schemaGraph().tables.get(table);
  const id = t && idColumn(t);
  if (!t || !id || !ids.length) return new Set();
  return new Set(((await tx.select({ id }).from(t).where(inArray(id, ids))) as { id: string }[]).map((r) => r.id));
}

/** Adds rows / references waiting for a removed row to the project's trash entry holding that row (others are dropped). */
async function handOver(tx: Tx, projectId: string, exceptId: string, rows: { table: string; row: Row; target: string; id: string }[], refs: TrashPayload['refs']) {
  const others = await tx.select({ id: planTrash.id, payload: planTrash.payload }).from(planTrash).where(and(eq(planTrash.projectId, projectId), sql`${planTrash.id} <> ${exceptId}`));
  const changed = new Set<string>();
  const holder = (table: string, id: string) =>
    others.find((o) => (o.payload as unknown as TrashPayload).tables.some((g) => g.table === table && g.rows.some((r) => r.id === id)));
  for (const w of rows) {
    const o = holder(w.target, w.id);
    if (!o) continue;
    const pl = o.payload as unknown as TrashPayload;
    let group = pl.tables.find((g) => g.table === w.table);
    if (!group) pl.tables.push((group = { table: w.table, rows: [] }));
    if (!group.rows.some((r) => r.id === w.row.id)) group.rows.push(JSON.parse(JSON.stringify(w.row)) as Row);
    changed.add(o.id);
  }
  for (const r of refs) {
    const o = holder(r.target, r.value);
    if (!o) continue;
    (o.payload as unknown as TrashPayload).refs.push(r);
    changed.add(o.id);
  }
  for (const o of others.filter((x) => changed.has(x.id))) await tx.update(planTrash).set({ payload: o.payload }).where(eq(planTrash.id, o.id));
}

class RestoreRefused extends Error {
  constructor(public reason: 'conflict' | 'parent', public code?: string) {
    super(reason);
  }
}

/**
 * Restores a trash entry exactly: rows re-inserted with their ids and values (links with type, lag, position; assignments;
 * to-dos…), references re-attached where still empty. Rows whose other end has disappeared since (a link to an activity removed
 * later, an assignment's what-if scenario deleted) are left out. Refused when a work package or activity with the same code was
 * created since ('conflict') or when an activity's work package is gone ('parent' — restore the package first).
 */
export async function restorePlanTrash(code: string, trashId: string, actorName: string, now = new Date()): Promise<RestoreResult> {
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const p = await lockProjectRow(tx, { code });
      if (!p) return { error: 'unknown' as const };
      const cutoff = new Date(now.getTime() - PLAN_TRASH_RETENTION_DAYS * 86_400_000);
      const [entry] = await tx.select().from(planTrash).where(and(eq(planTrash.id, trashId), eq(planTrash.projectId, p.id)));
      if (!entry || entry.deletedAt < cutoff) return { error: 'unknown' as const };
      const payload = entry.payload as unknown as TrashPayload;
      const rowsOf = (table: string) => payload.tables.find((x) => x.table === table)?.rows ?? [];
      // Codes taken since the removal.
      const nodes = rowsOf('wbs_nodes');
      const acts = rowsOf('activities');
      if (nodes.length) {
        const [dup] = await tx.select({ code: wbsNodes.code }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), inArray(wbsNodes.code, nodes.map((n) => n.code as string))));
        if (dup) return { error: 'conflict' as const, code: dup.code };
      }
      if (acts.length) {
        const [dup] = await tx.select({ code: activities.code }).from(activities).where(and(eq(activities.projectId, p.id), inArray(activities.code, acts.map((a) => a.code as string))));
        if (dup) return { error: 'conflict' as const, code: dup.code };
      }
      // A to-do number (global sequence) given to a new task since the removal: the restored to-do takes the next number that is
      // free both in the database and among the numbers the other restored to-dos keep.
      const todoRows = rowsOf('tasks');
      const takenRows = new Set(
        todoRows.length
          ? (await tx.select({ number: tasks.number }).from(tasks).where(inArray(tasks.number, todoRows.map((t) => t.number as string)))).map((r) => r.number)
          : [],
      );
      const kept = new Set(todoRows.map((t) => t.number as string).filter((n) => !takenRows.has(n)));
      let free: number | null = null;
      for (const t of todoRows) {
        if (!takenRows.has(t.number as string)) continue;
        free ??= parseInt((await nextNumber(tx, tasks, tasks.number, 'T-', 4, 2340)).slice(2), 10);
        while (kept.has(`T-${String(free).padStart(4, '0')}`)) free++;
        t.number = `T-${String(free++).padStart(4, '0')}`;
        kept.add(t.number as string);
      }
      // R-064: the stored slots are kept free by the ghost-slot rule; if one is taken anyway (a writer that does not shift the
      // trash), the rows at or above the block move up by its size first, so the rows come back in place with unique positions.
      const slots = storedPositions(payload);
      if (slots.length) {
        const [lo, hi] = [Math.min(...slots), Math.max(...slots)];
        const [[node], [act]] = await Promise.all([
          tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), inArray(wbsNodes.position, slots))).limit(1),
          tx.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, p.id), inArray(activities.position, slots))).limit(1),
        ]);
        if (node || act) {
          const by = hi - lo + 1;
          await tx.update(wbsNodes).set({ position: sql`${wbsNodes.position} + ${by}` }).where(and(eq(wbsNodes.projectId, p.id), sql`${wbsNodes.position} >= ${lo}`));
          await tx.update(activities).set({ position: sql`${activities.position} + ${by}` }).where(and(eq(activities.projectId, p.id), sql`${activities.position} >= ${lo}`));
          await shiftTrashedPositions(tx, p.id, lo, by, entry.id);
        }
      }
      const { tables, edges } = schemaGraph();
      const restored = new Map<string, Set<string>>();
      // Rows / references whose other end is not there (e.g. a link to an activity removed after this one): handed over to the
      // trash entry that holds that end, so they come back with it.
      const waiting: { table: string; row: Row; target: string; id: string }[] = [];
      const waitingRefs: TrashPayload['refs'] = [];
      for (const { table, rows } of payload.tables) {
        const t = tables.get(table);
        if (!t || !rows.length) continue;
        let values = rows.map((r) => revive(t, r));
        // Drop (cascading parent gone) or clear (nullable reference gone) what points at rows that no longer exist.
        for (const e of edges.filter((x) => x.fromName === table)) {
          const wanted = [...new Set(values.map((v) => v[e.key]).filter((x): x is string => typeof x === 'string'))];
          if (!wanted.length) continue;
          const have = await existingIds(tx, e.to, wanted);
          const missing = (v: Row) => typeof v[e.key] === 'string' && !have.has(v[e.key] as string);
          if (!values.some(missing)) continue;
          if (table === 'activities' && e.key === 'wbsNodeId') throw new RestoreRefused('parent', (values.find(missing)!.code as string) ?? undefined);
          if (e.onDelete === 'cascade' || e.column.notNull) {
            for (const v of values.filter(missing)) waiting.push({ table, row: v, target: e.to, id: v[e.key] as string });
            values = values.filter((v) => !missing(v));
          } else {
            for (const v of values.filter(missing)) if (typeof v.id === 'string') waitingRefs.push({ table, column: e.key, id: v.id, value: v[e.key] as string, target: e.to });
            values = values.map((v) => (missing(v) ? { ...v, [e.key]: null } : v));
          }
        }
        if (!values.length) continue;
        if (table === 'activity_links') values = await freeLinkPositions(tx, values);
        await tx.insert(t).values(values as never);
        restored.set(table, new Set(values.map((v) => v.id).filter((x): x is string => typeof x === 'string')));
      }
      for (const r of payload.refs) {
        if (!restored.get(r.target)?.has(r.value)) continue;
        const t = tables.get(r.table);
        const id = t && idColumn(t);
        const col = t && colsOf(t)[r.column];
        if (!t || !id || !col) continue;
        await tx.update(t).set({ [r.column]: r.value }).where(and(eq(id, r.id), sql`${col} is null`));
      }
      for (const r of payload.refs) if (!restored.get(r.target)?.has(r.value)) waitingRefs.push(r);
      if (waiting.length || waitingRefs.length) await handOver(tx, p.id, entry.id, waiting, waitingRefs);
      await tx.delete(planTrash).where(eq(planTrash.id, entry.id));
      const links = restored.get('activity_links')?.size ?? 0;
      const actor = await findPerson(tx, actorName);
      const who = actor ? nameOf(actor) : actorName;
      await writeAudit(tx, {
        actorName: who, actorPersonId: actor?.id, objectRef: `${code} ${entry.code}`,
        change: `${entry.kind === 'wp' ? 'work package' : 'activity'} ${entry.code} restored · ${entry.activityCount} activities · ${links} links`,
        area: 'Planning', entityType: entry.kind === 'wp' ? 'wbs_node' : 'activity', projectId: p.id,
      });
      await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Restored ${entry.kind === 'wp' ? 'work package' : 'activity'} ${entry.code} · ${entry.name}`, kind: 'change', projectId: p.id });
      return { ok: true as const, kind: entry.kind, code: entry.code, name: entry.name, activityCount: entry.activityCount, links };
    });
  } catch (e) {
    if (e instanceof RestoreRefused) return { error: e.reason, code: e.code };
    throw e;
  }
}

/** "Recently deleted" of a project: restorable entries, newest first. */
export async function listPlanTrash(code: string, opts: { limit?: number; now?: Date } = {}): Promise<PlanTrashEntry[]> {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PLAN_TRASH_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select({ id: planTrash.id, kind: planTrash.kind, code: planTrash.code, name: planTrash.name, activityCount: planTrash.activityCount, deletedAt: planTrash.deletedAt, deletedByName: planTrash.deletedByName })
    .from(planTrash)
    .innerJoin(projects, eq(projects.id, planTrash.projectId))
    .where(and(eq(projects.code, code), sql`${planTrash.deletedAt} >= ${cutoff.toISOString()}`))
    .orderBy(desc(planTrash.deletedAt))
    .limit(opts.limit ?? PLAN_TRASH_LIST_LIMIT);
  return rows;
}

