import 'server-only';
// Stock & storages DAL (docs/spec/08 §4; 11 §3.8 StockPosition, StockMovement). Positions imported from Sage X3, local
// movements flagged until pushed back (X3 remains the accounting reference), and the mock X3 exchange (Import from X3,
// Push to X3). Movement rules (`applyOp` 4479–4487) are the domain's (src/domain/stock.ts, SC-5): a count may be 0, no
// movement may take more than the quantity on hand, a reservation belongs to one project, an issue consumes the
// reservation of its own project only, a transfer of reserved goods moves their reservation to the destination,
// Import from X3 keeps local changes (merge) instead of discarding them. Delivery 7: an issue names its activity and its
// value is charged to the activity's work package (SC-5a, R-098 — `stockCostByWorkPackage` feeds the Budget's work
// packages); an issue or a scrap never takes another project's reservation, which its PM (or the director) releases
// first ("Release reservation"), unless the director overrides — audited (NEW-D4-2 / SC-5b, R-099).
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { movementValueEur, planStockMovement, planX3Import, type MovementPlan } from '@/domain/stock';
import { getDb } from '@/server/db/client';
import {
  STATUS_ISO, locationType, parisInstant, parisParts, stampText, stockMoveInstant, stockMovementType, stockOperation, stockSource,
  type LocationType, type StockMovementType, type StockOperation, type StockSource,
} from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { activities, parts, partLastPrices, projects, stockMovements, stockPositions, storageLocations, wbsNodes, x3SyncRuns } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { X3_LAST_IMPORT, x3StockSnapshot } from '@/server/integrations/x3/prototype-snapshot';

type Q = DB | Tx;

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

export interface StockRow {
  /** Position id (row key of the stock-line drawer). */
  id: string;
  ref: string;
  name: string;
  location: string;
  locationType: LocationType;
  /** "Central warehouse". */
  locationTypeLabel: string;
  onHand: number;
  reserved: number;
  /** Reservation project: code ("HLT-026") and the prototype's 3-letter key ("HLT"); null when none. */
  reservedForProject: string | null;
  reservedForShort: string | null;
  /** onHand − reserved (may be negative). */
  available: number;
  /** 0 = none. */
  minQty: number;
  belowMin: boolean;
  /** Unit cost (last purchase price, else list price). */
  unitCostEur: number;
  /** onHand × unit cost. */
  valueEur: number;
  source: StockSource;
  /** "X3" / "Local". */
  sourceLabel: string;
  lastMovementOn: string;
  position: number;
}

export interface MovementRow {
  /** ISO timestamp. */
  occurredAt: string;
  /** "25 Sep 14:10" (Europe/Paris; English). */
  when: string;
  type: StockMovementType;
  /** "Transfer", "Receipt"… (MOVES0 labels). */
  typeLabel: string;
  ref: string;
  qty: number;
  /** "Entrepôt central — Lyon → Atelier mécanique — Lyon". */
  where: string;
  who: string;
  /** Not yet pushed back to Sage X3. */
  pendingPush: boolean;
}

async function loadStock(q: Q, where?: ReturnType<typeof eq>): Promise<StockRow[]> {
  const rows = await q
    .select({ s: stockPositions, ref: parts.ref, name: parts.name, list: parts.listPriceEur, last: partLastPrices.unitPriceEur, loc: storageLocations.name, type: storageLocations.type, code: projects.code, short: projects.shortCode })
    .from(stockPositions)
    .innerJoin(parts, eq(parts.id, stockPositions.partId))
    .leftJoin(partLastPrices, eq(partLastPrices.partId, parts.id))
    .innerJoin(storageLocations, eq(storageLocations.id, stockPositions.locationId))
    .leftJoin(projects, eq(projects.id, stockPositions.reservedForProjectId))
    .where(where)
    .orderBy(asc(stockPositions.position));
  return rows.map(({ s, ref, name, list, last, loc, type, code, short }) => {
    const unit = last ?? list;
    return {
      id: s.id, ref, name, location: loc, locationType: type, locationTypeLabel: locationType.label(type), onHand: s.onHand, reserved: s.reserved,
      reservedForProject: code ?? null, reservedForShort: short ?? null, available: s.onHand - s.reserved, minQty: s.minQty, belowMin: s.minQty > 0 && s.onHand < s.minQty,
      unitCostEur: unit, valueEur: s.onHand * unit, source: s.source, sourceLabel: stockSource.label(s.source), lastMovementOn: s.lastMovementOn, position: s.position,
    };
  });
}

/** Every stock position (STOCK0 order; positions created by transfers or receipts appended). */
export async function listStock(): Promise<StockRow[]> {
  return loadStock(await getDb());
}

/** Σ on hand per reference across every location (PU/PR list "N in stock" — the prototype's STOCK_BY_REF read tuple indexes on objects and always found 0, 00 §7.16). */
export async function stockOnHandByRef(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ ref: parts.ref, n: sql<number>`sum(${stockPositions.onHand})::float8` }).from(stockPositions).innerJoin(parts, eq(parts.id, stockPositions.partId)).groupBy(parts.ref);
  return Object.fromEntries(rows.map((r) => [r.ref, r.n]));
}

async function loadMoves(q: Q, opts: { limit?: number; ref?: string } = {}): Promise<MovementRow[]> {
  const rows = await q
    .select({ m: stockMovements, ref: parts.ref })
    .from(stockMovements)
    .innerJoin(parts, eq(parts.id, stockMovements.partId))
    .where(opts.ref ? eq(parts.ref, opts.ref) : undefined)
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.createdAt))
    .limit(opts.limit ?? 1000);
  return rows.map(({ m, ref }) => ({
    occurredAt: m.occurredAt.toISOString(), when: stampText(m.occurredAt), type: m.type, typeLabel: stockMovementType.label(m.type), ref, qty: m.qty, where: m.whereText,
    who: m.personName, pendingPush: !m.pushedToX3At,
  }));
}

/** Recent movements, newest first (the card shows 8). */
export async function listStockMovements(opts: { limit?: number; ref?: string } = {}): Promise<MovementRow[]> {
  return loadMoves(await getDb(), opts);
}

export interface StockPositionDetail extends StockRow {
  /** Latest movements of the reference (6, any location — as the drawer lists them). */
  movements: MovementRow[];
  /** Locations a transfer may target (configured ones except this one), Settings order. */
  transferTargets: { name: string; shortLabel: string }[];
}

export async function getStockPosition(id: string): Promise<StockPositionDetail | null> {
  const db = await getDb();
  const [row] = await loadStock(db, eq(stockPositions.id, id));
  if (!row) return null;
  const [movements, locs] = await Promise.all([
    loadMoves(db, { ref: row.ref, limit: 6 }),
    db.select({ name: storageLocations.name }).from(storageLocations).where(eq(storageLocations.active, true)).orderBy(asc(storageLocations.position)),
  ]);
  return { ...row, movements, transferTargets: locs.filter((l) => l.name !== row.location).map((l) => ({ name: l.name, shortLabel: l.name.split(' — ')[0] })) };
}

export interface X3StockSync {
  /** "07:15" (Paris). */
  time: string;
  syncedAt: string;
  /** Lines currently as imported from X3 ("Today · 15 lines from Sage X3"). */
  x3Lines: number;
  /** Lines changed in Keystone, to push back. */
  localLines: number;
  /** Movements not yet pushed. */
  pendingMovements: number;
}

export async function getX3StockSync(): Promise<X3StockSync | null> {
  const db = await getDb();
  const [run] = await db.select().from(x3SyncRuns).where(eq(x3SyncRuns.kind, 'stock_import')).orderBy(desc(x3SyncRuns.occurredAt)).limit(1);
  if (!run) return null;
  const [counts] = await db
    .select({ x3: sql<number>`count(*) filter (where ${stockPositions.source} = 'x3')::int`, local: sql<number>`count(*) filter (where ${stockPositions.source} = 'local')::int` })
    .from(stockPositions);
  const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(stockMovements).where(isNull(stockMovements.pushedToX3At));
  const p = parisParts(run.occurredAt);
  return { time: `${p.hh}:${p.mm}`, syncedAt: run.occurredAt.toISOString(), x3Lines: counts.x3, localLines: counts.local, pendingMovements: pending };
}

/** Stock lines below their minimum (sidebar badge of Stock & storages). */
export async function countStockBelowMin(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(stockPositions).where(sql`${stockPositions.minQty} > 0 and ${stockPositions.onHand} < ${stockPositions.minQty}`);
  return n;
}

/** Sidebar badge of Stock & storages (`navs` 5150): lines below their minimum, '' when none. */
export async function stockNavBadge(): Promise<string> {
  const n = await countStockBelowMin();
  return n ? String(n) : '';
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface StockMovementInput {
  op: StockOperation;
  /** Counted quantity (adjust, ≥ 0) or moved quantity (> 0), whole units. */
  qty: number;
  /** Transfer destination (location name). */
  targetLocation?: string | null;
  /** Current project (reserve, issue, return — prototype `PD.p3`). */
  projectCode?: string | null;
  /** Activity issued to ("A1250"), within the project: required for an issue (SC-5a), optional on a return. */
  activityCode?: string | null;
  /** The portfolio director takes units reserved for another project (R-099; the Server Function checks the role). */
  override?: boolean;
}

/** Work package (level-1 WBS code, "1.4") of a WBS node: the node itself or its level-1 ancestor; null above level 1. */
async function workPackageCodeOf(q: Q, wbsNodeId: string): Promise<string | null> {
  let id: string | null = wbsNodeId;
  for (let guard = 0; id && guard < 20; guard++) {
    const [n]: { code: string; level: number; parentId: string | null }[] = await q
      .select({ code: wbsNodes.code, level: wbsNodes.level, parentId: wbsNodes.parentId }).from(wbsNodes).where(eq(wbsNodes.id, id));
    if (!n) return null;
    if (n.level <= 1) return n.level === 1 ? n.code : null;
    id = n.parentId;
  }
  return null;
}

/** Activities a stock issue may name (the project's plan, plan order): "A1250 · Steel erection — Bays 3–4". */
export async function listIssueActivityOptions(projectCode: string): Promise<{ code: string; name: string; label: string }[]> {
  const db = await getDb();
  const rows = await db.select({ code: activities.code, name: activities.name }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId))
    .where(eq(projects.code, projectCode)).orderBy(asc(activities.position));
  return rows.map((r) => ({ ...r, label: `${r.code} · ${r.name}` }));
}

/**
 * Stock material charged to each work package of a project (SC-5a, R-098), in k€: Σ value of the issues recorded in
 * Keystone − Σ value of the returns credited to a work package, by level-1 WBS code. Movements without a value (the X3
 * seed, whose cost is already in the actuals) count for nothing.
 */
export async function stockCostByWorkPackage(projectId: string, q?: Q): Promise<Map<string, number>> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ wbs: stockMovements.wbsCode, type: stockMovements.type, value: sql<number>`sum(${stockMovements.valueEur})::float8` })
    .from(stockMovements)
    .where(and(eq(stockMovements.projectId, projectId), inArray(stockMovements.type, ['issue', 'return'])))
    .groupBy(stockMovements.wbsCode, stockMovements.type);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.wbs || !r.value) continue;
    out.set(r.wbs, (out.get(r.wbs) ?? 0) + (r.type === 'issue' ? r.value : -r.value) / 1000);
  }
  return out;
}

/**
 * Internal: one stock movement on a position, inside the caller's transaction (stock-line drawer, goods receipts).
 * Updates the quantities, flags the touched positions Local (last movement = the status date) and appends the
 * movement (pending push to X3).
 */
export async function insertMovement(
  tx: Tx,
  m: {
    type: StockMovementType; partId: string; qty: number; fromLocationId?: string | null; toLocationId?: string | null; projectId?: string | null; activityId?: string | null;
    receiptId?: string | null; whereText: string; personName: string; personId: string | null;
    unitCostEur?: number | null; valueEur?: number | null; wbsCode?: string | null; overrideQty?: number | null; overrideFromProjectId?: string | null;
  },
): Promise<void> {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(stockMovements);
  await tx.insert(stockMovements).values({ ...m, occurredAt: stockMoveInstant(n), pushedToX3At: null });
}

/** Internal: the position of a part at a location, created empty (Local) when missing. */
export async function ensurePosition(tx: Tx, partId: string, locationId: string) {
  const [s] = await tx.select().from(stockPositions).where(and(eq(stockPositions.partId, partId), eq(stockPositions.locationId, locationId)));
  if (s) return s;
  const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${stockPositions.position}), -1)::int` }).from(stockPositions);
  const [c] = await tx
    .insert(stockPositions)
    .values({ partId, locationId, onHand: 0, reserved: 0, minQty: 0, source: 'local', lastMovementOn: STATUS_ISO, position: pos + 1 })
    .returning();
  return c;
}


/** Configured (active) storage locations, Settings order — the transfer destinations. */
async function activeLocations(q: Q) {
  return q.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations).where(eq(storageLocations.active, true)).orderBy(asc(storageLocations.position));
}

/**
 * "Apply movement" of the stock-line drawer. The rules are the domain's (`planStockMovement`, src/domain/stock.ts):
 * the line is updated, a transfer feeds (or creates) the destination line — with the reservation of the reserved goods
 * it moves —, both are flagged Local, the movement is appended pending push to X3, with the audit and activity rows.
 * Throws the rule's English message when refused.
 */
export async function applyStockMovement(positionId: string, input: StockMovementInput, actorName: string): Promise<MovementPlan> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // The line is locked for the transaction: two movements on it never read the same quantities.
    const [s] = await tx.select().from(stockPositions).where(eq(stockPositions.id, positionId)).for('update');
    if (!s) throw new Error('Unknown stock line');
    const [{ ref, loc, list, last }] = await tx
      .select({ ref: parts.ref, loc: storageLocations.name, list: parts.listPriceEur, last: partLastPrices.unitPriceEur })
      .from(parts)
      .innerJoin(storageLocations, eq(storageLocations.id, s.locationId))
      .leftJoin(partLastPrices, eq(partLastPrices.partId, parts.id))
      .where(eq(parts.id, s.partId));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const project = input.projectCode
      ? (await tx.select({ id: projects.id, code: projects.code, short: projects.shortCode }).from(projects).where(eq(projects.code, input.projectCode)))[0]
      : undefined;
    if (input.projectCode && !project) throw new Error(`Unknown project ${input.projectCode}`);
    let activity: { id: string; code: string; name: string; wbsNodeId: string } | undefined;
    if (input.activityCode && (input.op === 'issue' || input.op === 'return')) {
      if (!project) throw new Error('A project is required');
      [activity] = await tx.select({ id: activities.id, code: activities.code, name: activities.name, wbsNodeId: activities.wbsNodeId }).from(activities)
        .where(and(eq(activities.projectId, project.id), eq(activities.code, input.activityCode)));
      if (!activity) throw new Error('Choose an activity of the project plan');
    }
    const reservedFor = s.reservedForProjectId
      ? (await tx.select({ code: projects.code }).from(projects).where(eq(projects.id, s.reservedForProjectId)))[0]?.code ?? null
      : null;
    const locs = await activeLocations(tx);
    // Reservation held on the destination line of a transfer (a carried reservation may not mix two projects).
    const targetLoc = input.op === 'transfer' ? locs.find((l) => l.name === input.targetLocation) : undefined;
    const [targetLine] = targetLoc
      ? await tx.select({ reserved: stockPositions.reserved, code: projects.code }).from(stockPositions)
        .leftJoin(projects, eq(projects.id, stockPositions.reservedForProjectId))
        .where(and(eq(stockPositions.partId, s.partId), eq(stockPositions.locationId, targetLoc.id)))
      : [];
    const planned = planStockMovement(
      { location: loc, onHand: s.onHand, reserved: s.reserved, reservedFor },
      {
        op: input.op, qty: input.qty, target: input.targetLocation ?? null, targetReservedFor: targetLine && targetLine.reserved > 0 ? targetLine.code : null,
        project: project ? { code: project.code, short: project.short } : null, activity: activity ?? null, override: input.override === true,
      },
      locs.map((l) => l.name),
    );
    if (!planned.ok) throw new Error(planned.error);
    const plan = planned.value;
    const reservedForProjectId = plan.reservedFor === null ? null : plan.reservedFor === project?.code ? project.id : s.reservedForProjectId;
    // SC-5a (R-098): an issue (and a return naming an activity) is valued at the stock unit cost and charged (credited)
    // to the activity's work package.
    const unitCostEur = last ?? list;
    const charged = activity && (plan.type === 'issue' || plan.type === 'return');
    const wbsCode = charged ? await workPackageCodeOf(tx, activity!.wbsNodeId) : null;
    const valueEur = charged ? movementValueEur(plan.qty, unitCostEur) : null;
    await tx.update(stockPositions)
      .set({ onHand: plan.onHand, reserved: plan.reserved, reservedForProjectId, source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date() })
      .where(eq(stockPositions.id, s.id));
    let toLocationId: string | null = null;
    if (plan.transferTo) {
      const t = locs.find((l) => l.name === plan.transferTo)!;
      const dest = await ensurePosition(tx, s.partId, t.id);
      const carried = plan.transferReserved;
      await tx.update(stockPositions).set({
        onHand: dest.onHand + plan.qty, reserved: dest.reserved + carried, reservedForProjectId: carried ? s.reservedForProjectId : dest.reservedForProjectId,
        source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date(),
      }).where(eq(stockPositions.id, dest.id));
      toLocationId = t.id;
    }
    const inward = plan.type === 'return';
    await insertMovement(tx, {
      type: plan.type, partId: s.partId, qty: plan.qty, fromLocationId: inward ? null : s.locationId, toLocationId: inward ? s.locationId : toLocationId,
      projectId: plan.projectCode ? project!.id : plan.transferReserved ? s.reservedForProjectId : null, activityId: activity?.id ?? null, whereText: plan.whereText, personName: who, personId: actor?.id ?? null,
      unitCostEur: charged ? unitCostEur : null, valueEur, wbsCode, overrideQty: plan.overrideTaken || null, overrideFromProjectId: plan.overrideTaken ? s.reservedForProjectId : null,
    });
    const reservedChange = plan.reserved !== s.reserved ? ` · reserved ${s.reserved} → ${plan.reserved}` : '';
    const chargedText = charged ? ` · ${plan.type === 'issue' ? 'charged to' : 'credited to'} ${activity!.code}${wbsCode ? ` (WP ${wbsCode})` : ''} · €${valueEur!.toFixed(2)}` : '';
    const overrideText = plan.overrideTaken ? ` · director override: ${plan.overrideTaken} reserved for ${plan.overrideFrom} taken` : '';
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: `${ref} · ${loc}`,
      change: `${stockOperation.label(plan.type)} × ${plan.qty} · on hand ${s.onHand} → ${plan.onHand}${reservedChange}${chargedText}${overrideText} · ${stockSource.label('local')}`,
      area: 'Stock', entityType: 'stock_position', entityId: s.id, projectId: project?.id ?? null,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `${stockMovementType.label(plan.type)} ${ref} × ${plan.qty} · ${plan.whereText}`, kind: 'stock', projectId: project?.id ?? null });
    if (plan.overrideTaken && s.reservedForProjectId) {
      // The reserving project sees what was taken from its reservation, and by whom.
      await writeAudit(tx, {
        actorName: who, actorPersonId: actor?.id, objectRef: `${ref} · ${loc}`, area: 'Stock', entityType: 'stock_position', entityId: s.id, projectId: s.reservedForProjectId,
        change: `reservation ${s.reserved} → ${plan.reserved} · ${plan.overrideTaken} taken for ${project?.code ?? stockOperation.label(plan.type)} · director override`,
      });
      await recordActivity(tx, {
        actorName: who, actorPersonId: actor?.id, kind: 'stock', projectId: s.reservedForProjectId,
        text: `Reservation reduced · ${ref} × ${plan.overrideTaken} · ${loc} · director override`,
      });
    }
    return plan;
  });
}

// ── Sage X3 (mock connector) ───────────────────────────────────────────────────────────────────────────

/** Instant of the X3 snapshot the database was seeded with (STOCK0 imported at 07:15 on the status date). */
export const X3_SNAPSHOT_AT = parisInstant(STATUS_ISO, X3_LAST_IMPORT);

// Stock positions as Sage X3 reports them: the X3 mock connector (src/server/integrations/x3), until the X3 extracts.

export interface X3ImportResult {
  /** "14:37" (Paris). */
  time: string;
  /** Lines now as in Sage X3 ("Today · 15 lines from Sage X3"). */
  lines: number;
  /** X3 lines whose values changed (reset or created from the snapshot). */
  updated: number;
  /** Local lines kept (changed in Keystone, pending push). */
  keptLocal: number;
}

/**
 * "Import from X3" (mock connector): every X3 line takes the snapshot values, lines changed in Keystone and not yet
 * pushed keep theirs (merge — the prototype discarded them, 08 OQ15), lines Keystone pushed after the snapshot keep
 * theirs too (X3 holds them). Records the import run and the audit row.
 */
export async function importStockFromX3(actorName: string, at: Date = new Date()): Promise<X3ImportResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [rows, pushed, locs, partRows, projectRows] = await Promise.all([
      tx.select({ s: stockPositions, ref: parts.ref, loc: storageLocations.name, code: projects.code })
        .from(stockPositions)
        .innerJoin(parts, eq(parts.id, stockPositions.partId))
        .innerJoin(storageLocations, eq(storageLocations.id, stockPositions.locationId))
        .leftJoin(projects, eq(projects.id, stockPositions.reservedForProjectId)),
      tx.selectDistinct({ partId: stockMovements.partId, from: stockMovements.fromLocationId, to: stockMovements.toLocationId })
        .from(stockMovements)
        .where(gt(stockMovements.pushedToX3At, X3_SNAPSHOT_AT)),
      tx.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations),
      tx.select({ id: parts.id, ref: parts.ref }).from(parts),
      tx.select({ id: projects.id, code: projects.code, short: projects.shortCode, acts: sql<number>`(select count(*) from ${activities} where ${activities.projectId} = ${projects.id})::int` }).from(projects),
    ]);
    const pushedKeys = new Set(pushed.flatMap((m) => [m.from, m.to].filter(Boolean).map((l) => `${m.partId}|${l}`)));
    // 3-letter key → project (the one with a plan first, as the seed resolves them).
    const projectOfShort = (short: string) =>
      short ? [...projectRows].filter((p) => p.short === short).sort((a, b) => b.acts - a.acts || a.code.localeCompare(b.code))[0] ?? null : null;
    const snapshot = x3StockSnapshot().map((l) => ({ ...l, project: projectOfShort(l.projectShort) }));
    const plan = planX3Import(
      rows.map(({ s, ref, loc, code }) => ({
        id: s.id, ref, location: loc, onHand: s.onHand, reserved: s.reserved, reservedFor: code ?? null, minQty: s.minQty, lastMovementOn: s.lastMovementOn,
        source: s.source, pushedFromKeystone: pushedKeys.has(`${s.partId}|${s.locationId}`),
      })),
      snapshot.map((l) => ({ ref: l.ref, location: l.location, onHand: l.onHand, reserved: l.reserved, reservedFor: l.project?.code ?? null, minQty: l.minQty, lastMovementOn: l.lastMovementOn })),
    );
    const projectIdOf = (code: string | null) => (code ? projectRows.find((p) => p.code === code)?.id ?? null : null);
    for (const { id, line } of plan.update) {
      await tx.update(stockPositions)
        .set({ onHand: line.onHand, reserved: line.reserved, reservedForProjectId: projectIdOf(line.reservedFor), minQty: line.minQty, lastMovementOn: line.lastMovementOn, source: 'x3', updatedAt: at })
        .where(eq(stockPositions.id, id));
    }
    let created = 0;
    for (const line of plan.create) {
      const partId = partRows.find((p) => p.ref === line.ref)?.id;
      const locationId = locs.find((l) => l.name === line.location)?.id;
      if (!partId || !locationId) continue;
      const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${stockPositions.position}), -1)::int` }).from(stockPositions);
      await tx.insert(stockPositions).values({
        partId, locationId, onHand: line.onHand, reserved: line.reserved, reservedForProjectId: projectIdOf(line.reservedFor), minQty: line.minQty, source: 'x3',
        lastMovementOn: line.lastMovementOn, position: pos + 1,
      });
      created++;
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(stockPositions).where(eq(stockPositions.source, 'x3'));
    const actor = await findPerson(tx, actorName);
    await tx.insert(x3SyncRuns).values({ kind: 'stock_import', occurredAt: at, lineCount: n, requestedByPersonId: actor?.id ?? null });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: 'Sage X3',
      change: `stock import · ${n} lines · ${plan.update.length + created} updated · ${plan.keptLocal} local kept`, area: 'Stock', occurredAt: at,
    });
    const p = parisParts(at);
    return { time: `${p.hh}:${p.mm}`, lines: n, updated: plan.update.length + created, keptLocal: plan.keptLocal };
  });
}

/**
 * "Push to X3" (mock connector): local positions become X3 lines again and their movements are marked pushed.
 * With `positionId` (the stock-line drawer), only that line and the pending movements that touched it are pushed.
 * Returns the lines and movements pushed.
 */
export async function pushStockToX3(actorName: string, at: Date = new Date(), opts: { positionId?: string } = {}): Promise<{ lines: number; movements: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    let local: { id: string }[];
    let moves: { id: string }[];
    let objectRef = 'Sage X3';
    if (opts.positionId) {
      const [s] = await tx.select().from(stockPositions).where(eq(stockPositions.id, opts.positionId));
      if (!s) throw new Error('Unknown stock line');
      local = s.source === 'local' ? [{ id: s.id }] : [];
      moves = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(
        isNull(stockMovements.pushedToX3At), eq(stockMovements.partId, s.partId),
        or(eq(stockMovements.fromLocationId, s.locationId), eq(stockMovements.toLocationId, s.locationId)),
      ));
      const [{ ref, loc }] = await tx.select({ ref: parts.ref, loc: storageLocations.name }).from(parts).innerJoin(storageLocations, eq(storageLocations.id, s.locationId)).where(eq(parts.id, s.partId));
      objectRef = `${ref} · ${loc}`;
    } else {
      local = await tx.select({ id: stockPositions.id }).from(stockPositions).where(eq(stockPositions.source, 'local'));
      moves = await tx.select({ id: stockMovements.id }).from(stockMovements).where(isNull(stockMovements.pushedToX3At));
    }
    if (!local.length && !moves.length) return { lines: 0, movements: 0 };
    if (local.length) await tx.update(stockPositions).set({ source: 'x3', updatedAt: at }).where(inArray(stockPositions.id, local.map((x) => x.id)));
    if (moves.length) await tx.update(stockMovements).set({ pushedToX3At: at }).where(inArray(stockMovements.id, moves.map((x) => x.id)));
    const actor = await findPerson(tx, actorName);
    await tx.insert(x3SyncRuns).values({ kind: 'stock_push', occurredAt: at, lineCount: local.length, requestedByPersonId: actor?.id ?? null });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef,
      change: `stock push · ${local.length} lines · ${moves.length} movements`, area: 'Stock', occurredAt: at,
      entityType: opts.positionId ? 'stock_position' : undefined, entityId: opts.positionId,
    });
    return { lines: local.length, movements: moves.length };
  });
}

export type { MovementPlan, StockOperation };
