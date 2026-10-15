import 'server-only';
// Local mirrors of Vigie's project non-conformities (NCR) and site HSE register, and the outbox of the NCR progress
// recorded in Keystone (schema/vigie.ts). Shared by the mock and HTTP quality connectors and the seed: the upsert
// functions are the only writers of the mirror tables (seed and Vigie refresh); `readNcrMirror` overlays the progress
// Vigie has not reflected yet (quality-progress.ts queues it).
import { and, asc, eq, inArray, isNull, lt, ne, notExists, or, sql } from 'drizzle-orm';
import { claimExpiry } from '../outbox';
import { hseStatus, ncrStatus } from '@/server/db/codes';
import { findPerson } from '@/server/db/helpers';
import { vigieHseItems, vigieNcrProgress, vigieNcrs } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { vigieHseUrl, vigieNcrUrl } from './links';
import type { NcrListFilter, NcrProgressEntry, VigieHseItem, VigieHseRecord, VigieNcr, VigieNcrRecord } from './types';

type Q = DB | Tx;
const key = (projectCode: string, number: string) => `${projectCode}|${number}`;

// ── NCR refresh (the only writer of vigie_ncrs) ─────────────────────────────────────────────────────────

/**
 * Writes Vigie's NCRs into the mirror (insert or replace by project and number). With `prune`, mirror rows absent from
 * the records are deleted (a full refresh), together with their delivered outbox entries — except a row that still has
 * progress Vigie has not received (pending or failed), kept until every entry is sent (R-023, V-2; NOT EXISTS inside the
 * DELETE, as in upsertMirror).
 */
export async function upsertNcrMirror(q: Q, records: VigieNcrRecord[], syncedAt: Date, opts: { prune?: boolean } = {}): Promise<number> {
  const existing = await q.select({ id: vigieNcrs.id, projectCode: vigieNcrs.projectCode, number: vigieNcrs.number, position: vigieNcrs.position }).from(vigieNcrs);
  const byKey = new Map(existing.map((e) => [key(e.projectCode, e.number), e]));
  let next = existing.reduce((m, e) => Math.max(m, e.position + 1), 0);
  for (const r of records) {
    if (!ncrStatus.isCode(r.status)) throw new Error(`Vigie NCR ${r.number}: unknown status "${r.status}"`);
    const [raised, owner] = await Promise.all([findPerson(q, r.raisedBy), findPerson(q, r.owner)]);
    const values = {
      projectCode: r.projectCode, number: r.number, vigieRef: r.vigieRef, title: r.title, severity: r.severity, source: r.source, status: r.status,
      activityCode: r.activityCode, partRef: r.partRef, deliverableNumber: r.deliverableNumber, supplierName: r.supplierName,
      inspectionNumber: r.inspectionNumber ?? null, raisedByName: r.raisedBy,
      raisedByPersonId: raised?.id ?? null, raisedOn: r.raisedOn, ownerName: r.owner, ownerPersonId: owner?.id ?? null, rootCause: r.rootCause, action: r.action,
      dueOn: r.dueOn, costKeur: r.costKeur, isoClause: r.isoClause, vigieUpdatedAt: r.updatedAt ? new Date(r.updatedAt) : null, lastSyncedAt: syncedAt,
    };
    const old = byKey.get(key(r.projectCode, r.number));
    if (old) await q.update(vigieNcrs).set(values).where(eq(vigieNcrs.id, old.id));
    else await q.insert(vigieNcrs).values({ ...values, position: next++ });
  }
  if (opts.prune) {
    const keep = new Set(records.map((r) => key(r.projectCode, r.number)));
    const gone = existing.filter((e) => !keep.has(key(e.projectCode, e.number))).map((e) => e.id);
    if (gone.length)
      await q.delete(vigieNcrs).where(and(
        inArray(vigieNcrs.id, gone),
        notExists(q.select({ one: sql`1` }).from(vigieNcrProgress).where(and(eq(vigieNcrProgress.ncrId, vigieNcrs.id), ne(vigieNcrProgress.syncStatus, 'sent')))),
      ));
  }
  return records.length;
}

// ── NCR read model ────────────────────────────────────────────────────────────────────────────────────

export const ncrEntryOf = (r: typeof vigieNcrProgress.$inferSelect): NcrProgressEntry => ({
  id: r.id, projectCode: r.projectCode, ncrNumber: r.ncrNumber, kind: r.kind, decision: r.decision ?? null, fromStatus: r.fromStatus, targetStatus: r.targetStatus,
  comment: r.comment, actorName: r.actorName, actorRole: r.actorRole, recordedAt: r.recordedAt.toISOString(), syncStatus: r.syncStatus, attempts: r.attempts,
  lastError: r.lastError,
});

/** Progress Vigie has not reflected yet: entries not delivered, and delivered ones recorded after the row's last refresh. */
const unreflected = (r: typeof vigieNcrProgress.$inferSelect, lastSyncedAt: Date) => r.syncStatus !== 'sent' || r.recordedAt.getTime() > lastSyncedAt.getTime();

/** The NCR mirror (Vigie order) with the progress recorded in Keystone overlaid; optionally filtered. */
export async function readNcrMirror(q: Q, filter: NcrListFilter = {}): Promise<VigieNcr[]> {
  const conds = [];
  if (filter.projectCodes?.length) conds.push(inArray(vigieNcrs.projectCode, filter.projectCodes));
  if (filter.partRefs?.length) conds.push(inArray(vigieNcrs.partRef, filter.partRefs));
  const rows = await q.select().from(vigieNcrs).where(conds.length ? and(...conds) : undefined).orderBy(asc(vigieNcrs.position));
  if (!rows.length) return [];
  const progress = await q.select().from(vigieNcrProgress).where(inArray(vigieNcrProgress.ncrId, rows.map((r) => r.id))).orderBy(asc(vigieNcrProgress.recordedAt));
  const byNcr = new Map<string, (typeof progress)[number][]>();
  for (const p of progress) byNcr.set(p.ncrId, [...(byNcr.get(p.ncrId) ?? []), p]);
  return rows.map((r) => {
    const pending = (byNcr.get(r.id) ?? []).filter((p) => unreflected(p, r.lastSyncedAt)).map(ncrEntryOf);
    return {
      projectCode: r.projectCode, number: r.number, vigieRef: r.vigieRef, title: r.title, severity: r.severity, source: r.source, status: r.status,
      activityCode: r.activityCode, partRef: r.partRef, deliverableNumber: r.deliverableNumber, supplierName: r.supplierName,
      inspectionNumber: r.inspectionNumber, raisedBy: r.raisedByName,
      raisedOn: r.raisedOn, owner: r.ownerName, rootCause: r.rootCause, action: r.action, dueOn: r.dueOn, costKeur: r.costKeur, isoClause: r.isoClause,
      requestedStatus: pending.at(-1)?.targetStatus ?? null, pendingProgress: pending, lastSyncedAt: r.lastSyncedAt.toISOString(),
      vigieUrl: vigieNcrUrl({ number: r.number, vigieRef: r.vigieRef }),
    };
  });
}

// ── NCR outbox ─────────────────────────────────────────────────────────────────────────────────────────

/** NCR progress waiting for delivery (pending or failed), oldest first. */
export async function undeliveredNcrProgress(q: Q): Promise<NcrProgressEntry[]> {
  const rows = await q.select().from(vigieNcrProgress).orderBy(asc(vigieNcrProgress.recordedAt));
  return rows.filter((r) => r.syncStatus !== 'sent').map(ncrEntryOf);
}

export async function ncrProgressSyncStatus(q: Q, id: string) {
  const [r] = await q.select({ s: vigieNcrProgress.syncStatus }).from(vigieNcrProgress).where(eq(vigieNcrProgress.id, id));
  return r?.s ?? null;
}

/** Claims an NCR outbox entry before sending it (R-010, ../outbox.ts): true when this delivery may send it. */
export async function claimNcrDelivery(q: Q, id: string, at = new Date()): Promise<boolean> {
  const rows = await q
    .update(vigieNcrProgress)
    .set({ claimedAt: at })
    .where(and(eq(vigieNcrProgress.id, id), ne(vigieNcrProgress.syncStatus, 'sent'), or(isNull(vigieNcrProgress.claimedAt), lt(vigieNcrProgress.claimedAt, claimExpiry(at)))))
    .returning({ id: vigieNcrProgress.id });
  return rows.length > 0;
}

/** Marks a delivery attempt of an NCR outbox entry (and releases its claim). */
export async function markNcrDelivery(q: Q, id: string, result: { ok: true; vigieRef?: string | null } | { ok: false; error: string }, at = new Date()): Promise<void> {
  await q
    .update(vigieNcrProgress)
    .set(result.ok
      ? { syncStatus: 'sent', sentAt: at, lastAttemptAt: at, attempts: sql`${vigieNcrProgress.attempts} + 1`, lastError: null, vigieRef: result.vigieRef ?? null, claimedAt: null }
      : { syncStatus: 'failed', lastAttemptAt: at, attempts: sql`${vigieNcrProgress.attempts} + 1`, lastError: result.error.slice(0, 500), claimedAt: null })
    .where(eq(vigieNcrProgress.id, id));
}

// ── Site HSE mirror ───────────────────────────────────────────────────────────────────────────────────

/** Replaces the HSE register of the projects present in `records` (a project's register is always sent whole). */
export async function upsertHseMirror(q: Q, records: VigieHseRecord[], syncedAt: Date, opts: { prune?: boolean } = {}): Promise<number> {
  const codes = [...new Set(records.map((r) => r.projectCode))];
  if (opts.prune) await q.delete(vigieHseItems);
  else if (codes.length) await q.delete(vigieHseItems).where(inArray(vigieHseItems.projectCode, codes));
  for (const code of codes) {
    const rows = records.filter((r) => r.projectCode === code);
    for (const r of rows) if (!hseStatus.isCode(r.status)) throw new Error(`Vigie HSE item "${r.title}": unknown status "${r.status}"`);
    await q.insert(vigieHseItems).values(rows.map((r, position) => ({ ...r, position, lastSyncedAt: syncedAt })));
  }
  return records.length;
}

/** The HSE register of a project as Vigie last reported it (Vigie order). */
export async function readHseMirror(q: Q, projectCode: string): Promise<VigieHseItem[]> {
  const rows = await q.select().from(vigieHseItems).where(eq(vigieHseItems.projectCode, projectCode)).orderBy(asc(vigieHseItems.position));
  return rows.map((r) => ({
    projectCode: r.projectCode, vigieRef: r.vigieRef, kind: r.kind, title: r.title, status: r.status, statusText: r.statusText, dateOn: r.dateOn,
    lastSyncedAt: r.lastSyncedAt.toISOString(), vigieUrl: vigieHseUrl({ kind: r.kind, vigieRef: r.vigieRef, projectCode: r.projectCode }),
  }));
}
