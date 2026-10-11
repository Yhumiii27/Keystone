import 'server-only';
// The local mirror of Vigie's ECOs and the outbox of progress recorded in Keystone (schema/vigie.ts). Shared by the
// mock and HTTP connectors and the seed: `upsertMirror` is the only writer of the mirror tables (seed and Vigie
// refresh), `readMirror` overlays the progress Vigie has not reflected yet (progress.ts queues it).
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { claimExpiry } from '../outbox';
import { ecoStatus, type EcoApproverKey } from '@/server/db/codes';
import { findPerson } from '@/server/db/helpers';
import { vigieEcoApprovals, vigieEcoEffectivity, vigieEcoParts, vigieEcoProgress, vigieEcoProjects, vigieEcos } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { vigieEcoUrl } from './links';
import type { EcoListFilter, EcoProgressEntry, VigieEco, VigieEcoRecord } from './types';

type Q = DB | Tx;

// ── Refresh (the only writer of the mirror) ─────────────────────────────────────────────────────────────

/**
 * Writes Vigie's records into the mirror (insert or replace by number). With `prune`, mirror rows absent from the
 * records are deleted (a full refresh), together with their outbox entries.
 */
export async function upsertMirror(q: Q, records: VigieEcoRecord[], syncedAt: Date, opts: { prune?: boolean } = {}): Promise<number> {
  const existing = await q.select({ id: vigieEcos.id, number: vigieEcos.number, position: vigieEcos.position }).from(vigieEcos);
  const byNumber = new Map(existing.map((e) => [e.number, e]));
  let next = existing.reduce((m, e) => Math.max(m, e.position + 1), 0);
  for (const r of records) {
    if (!ecoStatus.isCode(r.status)) throw new Error(`Vigie ECO ${r.number}: unknown status "${r.status}"`);
    const person = await findPerson(q, r.requestedBy);
    const values = {
      number: r.number, title: r.title, type: r.type, status: r.status, interchangeability: r.interchangeability, fromRevision: r.fromRevision,
      toRevision: r.toRevision, costEur: r.costEur, scheduleDays: r.scheduleDays, stockImpact: r.stockImpact, documentRefs: r.documentRefs,
      requestedByName: r.requestedBy, requestedByPersonId: person?.id ?? null, raisedOn: r.raisedOn, pendingDispositions: r.pendingDispositions,
      locked: r.locked, vigieUpdatedAt: r.updatedAt ? new Date(r.updatedAt) : null, lastSyncedAt: syncedAt,
    };
    const old = byNumber.get(r.number);
    let ecoId: string;
    if (old) {
      ecoId = old.id;
      await q.update(vigieEcos).set(values).where(eq(vigieEcos.id, ecoId));
      await q.delete(vigieEcoApprovals).where(eq(vigieEcoApprovals.ecoId, ecoId));
      await q.delete(vigieEcoParts).where(eq(vigieEcoParts.ecoId, ecoId));
      await q.delete(vigieEcoProjects).where(eq(vigieEcoProjects.ecoId, ecoId));
      await q.delete(vigieEcoEffectivity).where(eq(vigieEcoEffectivity.ecoId, ecoId));
    } else {
      [{ id: ecoId }] = await q.insert(vigieEcos).values({ ...values, position: next++ }).returning({ id: vigieEcos.id });
    }
    if (r.approvals.length)
      await q.insert(vigieEcoApprovals).values(r.approvals.map((a) => ({
        ecoId, key: a.key, decision: a.decision, approverText: a.approver, decidedByName: a.decidedBy, decidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
      })));
    if (r.parts.length) await q.insert(vigieEcoParts).values(r.parts.map((partRef, position) => ({ ecoId, partRef, position })));
    if (r.projects.length) await q.insert(vigieEcoProjects).values(r.projects.map((projectCode, position) => ({ ecoId, projectCode, position })));
    if (r.effectivity.length) await q.insert(vigieEcoEffectivity).values(r.effectivity.map((t, position) => ({ ecoId, ...t, position })));
  }
  if (opts.prune) {
    const keep = new Set(records.map((r) => r.number));
    const gone = existing.filter((e) => !keep.has(e.number)).map((e) => e.id);
    if (gone.length) await q.delete(vigieEcos).where(inArray(vigieEcos.id, gone));
  }
  return records.length;
}

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

export const entryOf = (r: typeof vigieEcoProgress.$inferSelect): EcoProgressEntry => ({
  id: r.id, ecoNumber: r.ecoNumber, kind: r.kind, approvalKey: r.approvalKey ?? null, decision: r.decision ?? null, targetStatus: r.targetStatus ?? null,
  fromStatus: r.fromStatus, comment: r.comment, actorName: r.actorName, actorRole: r.actorRole, recordedAt: r.recordedAt.toISOString(),
  syncStatus: r.syncStatus, attempts: r.attempts, lastError: r.lastError,
});

/**
 * Progress Vigie has not reflected yet: entries not delivered (pending, failed) and delivered ones recorded after the
 * row's last refresh.
 */
const unreflected = (r: typeof vigieEcoProgress.$inferSelect, lastSyncedAt: Date) =>
  r.syncStatus !== 'sent' || r.recordedAt.getTime() > lastSyncedAt.getTime();

/** The mirror (Vigie order) with the progress recorded in Keystone overlaid; optionally filtered. */
export async function readMirror(q: Q, filter: EcoListFilter = {}): Promise<VigieEco[]> {
  const rows = await q.select().from(vigieEcos).orderBy(asc(vigieEcos.position));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [approvals, partRows, projectRows, effect, progress] = await Promise.all([
    q.select().from(vigieEcoApprovals).where(inArray(vigieEcoApprovals.ecoId, ids)),
    q.select().from(vigieEcoParts).where(inArray(vigieEcoParts.ecoId, ids)).orderBy(asc(vigieEcoParts.position)),
    q.select().from(vigieEcoProjects).where(inArray(vigieEcoProjects.ecoId, ids)).orderBy(asc(vigieEcoProjects.position)),
    q.select().from(vigieEcoEffectivity).where(inArray(vigieEcoEffectivity.ecoId, ids)).orderBy(asc(vigieEcoEffectivity.position)),
    q.select().from(vigieEcoProgress).where(inArray(vigieEcoProgress.ecoId, ids)).orderBy(asc(vigieEcoProgress.recordedAt)),
  ]);
  const group = <T extends { ecoId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.ecoId, [...(m.get(x.ecoId) ?? []), x]);
    return m;
  };
  const [apprBy, partsBy, projBy, effBy, progBy] = [group(approvals), group(partRows), group(projectRows), group(effect), group(progress)];
  const out: VigieEco[] = rows.map((r) => {
    const pending = (progBy.get(r.id) ?? []).filter((p) => unreflected(p, r.lastSyncedAt)).map(entryOf);
    const appr = new Map((apprBy.get(r.id) ?? []).map((a) => [a.key, a]));
    return {
      number: r.number, title: r.title, type: r.type, status: r.status, interchangeability: r.interchangeability ?? null, fromRevision: r.fromRevision,
      toRevision: r.toRevision, costEur: r.costEur, scheduleDays: r.scheduleDays, stockImpact: r.stockImpact, documentRefs: r.documentRefs,
      requestedBy: r.requestedByName, raisedOn: r.raisedOn, pendingDispositions: r.pendingDispositions, locked: r.locked,
      parts: (partsBy.get(r.id) ?? []).map((p) => p.partRef),
      projects: (projBy.get(r.id) ?? []).map((p) => p.projectCode),
      approvals: (['englead', 'quality', 'pm'] as EcoApproverKey[]).filter((k) => appr.has(k)).map((k) => {
        const a = appr.get(k)!;
        return {
          key: k, decision: a.decision, approver: a.approverText, decidedBy: a.decidedByName, decidedAt: a.decidedAt?.toISOString() ?? null,
          pending: pending.filter((p) => p.kind === 'approval' && p.approvalKey === k).at(-1) ?? null,
        };
      }),
      effectivity: (effBy.get(r.id) ?? []).map((t) => ({
        targetType: t.targetType, targetRef: t.targetRef, label: t.label, disposition: t.disposition ?? null, isAutomatic: t.isAutomatic, note: t.note,
        fittedPartRef: t.fittedPartRef, fittedRevision: t.fittedRevision,
      })),
      requestedStatus: pending.filter((p) => p.kind === 'step').at(-1)?.targetStatus ?? null,
      pendingProgress: pending,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      vigieUrl: vigieEcoUrl(r.number),
    };
  });
  const parts = filter.partRefs?.length ? new Set(filter.partRefs) : null;
  const codes = filter.projectCodes?.length ? new Set(filter.projectCodes) : null;
  const numbers = filter.numbers?.length ? new Set(filter.numbers) : null;
  if (!parts && !codes && !numbers) return out;
  return out.filter((e) =>
    (numbers && numbers.has(e.number)) || (parts && e.parts.some((p) => parts.has(p))) || (codes && e.projects.some((c) => codes.has(c))),
  );
}

// ── Progress (outbox) ──────────────────────────────────────────────────────────────────────────────────

/** Outbox entries waiting for delivery (pending or failed), oldest first. */
export async function undeliveredProgress(q: Q): Promise<EcoProgressEntry[]> {
  const rows = await q.select().from(vigieEcoProgress).orderBy(asc(vigieEcoProgress.recordedAt));
  return rows.filter((r) => r.syncStatus !== 'sent').map(entryOf);
}

/** Delivery state of an outbox entry (null when unknown). */
export async function progressSyncStatus(q: Q, id: string) {
  const [r] = await q.select({ s: vigieEcoProgress.syncStatus }).from(vigieEcoProgress).where(eq(vigieEcoProgress.id, id));
  return r?.s ?? null;
}

/**
 * Claims an outbox entry before sending it (R-010, ../outbox.ts): true when it is still undelivered and no other delivery
 * holds it — the caller then sends it and records the result with markDelivery.
 */
export async function claimProgressDelivery(q: Q, id: string, at = new Date()): Promise<boolean> {
  const rows = await q
    .update(vigieEcoProgress)
    .set({ claimedAt: at })
    .where(and(eq(vigieEcoProgress.id, id), ne(vigieEcoProgress.syncStatus, 'sent'), or(isNull(vigieEcoProgress.claimedAt), lt(vigieEcoProgress.claimedAt, claimExpiry(at)))))
    .returning({ id: vigieEcoProgress.id });
  return rows.length > 0;
}

/** Marks a delivery attempt of an outbox entry (and releases its claim). */
export async function markDelivery(q: Q, id: string, result: { ok: true; vigieRef?: string | null } | { ok: false; error: string }, at = new Date()): Promise<void> {
  await q
    .update(vigieEcoProgress)
    .set(result.ok
      ? { syncStatus: 'sent', sentAt: at, lastAttemptAt: at, attempts: sql`${vigieEcoProgress.attempts} + 1`, lastError: null, vigieRef: result.vigieRef ?? null, claimedAt: null }
      : { syncStatus: 'failed', lastAttemptAt: at, attempts: sql`${vigieEcoProgress.attempts} + 1`, lastError: result.error.slice(0, 500), claimedAt: null })
    .where(eq(vigieEcoProgress.id, id));
}
