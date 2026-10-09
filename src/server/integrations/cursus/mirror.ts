import 'server-only';
// Local mirror of the Cursus approvals and the outbox of what Keystone sends to Cursus (schema/cursus.ts). Shared by
// the mock and HTTP connectors and the seed: `upsertClearances` is the only writer of `cursus_clearances`.
import { and, asc, desc, eq } from 'drizzle-orm';
import { findPerson } from '@/server/db/helpers';
import { cursusClearances, cursusRequests, cursusSyncRuns } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { CursusClearanceRecord, CursusClearanceView, CursusGoNoGo } from './types';

type Q = DB | Tx;

/** Replaces a project's clearances with Cursus's records (matched by person; rows Cursus no longer lists are removed). */
export async function upsertClearances(q: Q, projectCode: string, records: CursusClearanceRecord[], syncedAt: Date, mode: 'mock' | 'http'): Promise<number> {
  const existing = await q.select({ id: cursusClearances.id, personName: cursusClearances.personName, matricule: cursusClearances.matricule })
    .from(cursusClearances).where(eq(cursusClearances.projectCode, projectCode));
  const keep = new Set<string>();
  for (const [position, r] of records.entries()) {
    const old = existing.find((e) => (r.matricule && e.matricule === r.matricule) || e.personName === r.personName);
    const person = await findPerson(q, r.personName);
    const values = {
      projectCode, chantierId: r.chantierId, matricule: r.matricule, personName: old && r.matricule && old.matricule === r.matricule ? old.personName : r.personName,
      personId: person?.id ?? null, visa: r.visa, vaccination: r.vaccination, clearance: r.clearance, clearanceNote: r.clearanceNote, verdict: r.verdict,
      reasonCodes: r.reasonCodes, receivedAt: new Date(r.receivedAt), position, lastSyncedAt: syncedAt,
    };
    if (old) {
      keep.add(old.id);
      await q.update(cursusClearances).set(values).where(eq(cursusClearances.id, old.id));
    } else {
      const [row] = await q.insert(cursusClearances).values(values).returning({ id: cursusClearances.id });
      keep.add(row.id);
    }
  }
  for (const e of existing) if (!keep.has(e.id)) await q.delete(cursusClearances).where(eq(cursusClearances.id, e.id));
  await q.insert(cursusSyncRuns).values({ projectCode, syncedAt, volume: records.length, mode, ok: true });
  return records.length;
}

/** Records a failed refresh (the mirror is kept). */
export async function recordFailedSync(q: Q, projectCode: string, at: Date, error: string): Promise<void> {
  await q.insert(cursusSyncRuns).values({ projectCode, syncedAt: at, volume: 0, mode: 'http', ok: false, error: error.slice(0, 500) });
}

/** Overall verdict (Cursus `evaluateChantiers`): NO GO if anyone is, GO with reserve if anyone has one, else GO. */
export const overallVerdict = (people: { verdict: CursusClearanceRecord['verdict'] }[]) =>
  !people.length ? null : people.some((p) => p.verdict === 'no_go') ? 'no_go' as const : people.some((p) => p.verdict === 'go_with_reserve') ? 'go_with_reserve' as const : 'go' as const;

/** A project's people Go / No Go as last received, with the reminders sent from Keystone. */
export async function readClearances(q: Q, projectCode: string): Promise<CursusGoNoGo> {
  const [rows, reminders, [lastRun]] = await Promise.all([
    q.select().from(cursusClearances).where(eq(cursusClearances.projectCode, projectCode)).orderBy(asc(cursusClearances.position)),
    q.select().from(cursusRequests).where(and(eq(cursusRequests.projectCode, projectCode), eq(cursusRequests.kind, 'reminder'))).orderBy(asc(cursusRequests.recordedAt)),
    q.select().from(cursusSyncRuns).where(and(eq(cursusSyncRuns.projectCode, projectCode), eq(cursusSyncRuns.ok, true))).orderBy(desc(cursusSyncRuns.syncedAt)).limit(1),
  ]);
  const people: CursusClearanceView[] = rows.map((r) => {
    const rem = reminders.filter((x) => x.personName === r.personName).at(-1);
    return {
      id: r.id, projectCode: r.projectCode, chantierId: r.chantierId, matricule: r.matricule, personName: r.personName, visa: r.visa, vaccination: r.vaccination,
      clearance: r.clearance, clearanceNote: r.clearanceNote, verdict: r.verdict, reasonCodes: r.reasonCodes, receivedAt: r.receivedAt.toISOString(),
      reminded: !!rem, reminderSyncStatus: rem?.syncStatus ?? null, lastSyncedAt: r.lastSyncedAt.toISOString(),
    };
  });
  return {
    projectCode, chantierId: rows[0]?.chantierId ?? null, verdict: overallVerdict(people), people,
    lastSyncedAt: lastRun?.syncedAt.toISOString() ?? rows[0]?.lastSyncedAt.toISOString() ?? null,
  };
}

/** Outbox entries waiting for delivery (pending or failed), oldest first. */
export async function undeliveredRequests(q: Q) {
  const rows = await q.select().from(cursusRequests).orderBy(asc(cursusRequests.recordedAt));
  return rows.filter((r) => r.syncStatus !== 'sent');
}

/** Marks a delivery attempt of an outbox entry. */
export async function markRequestDelivery(q: Q, id: string, result: { ok: true; cursusRef?: string | null } | { ok: false; error: string }, at = new Date()): Promise<void> {
  const [r] = await q.select({ attempts: cursusRequests.attempts }).from(cursusRequests).where(eq(cursusRequests.id, id));
  if (!r) return;
  await q
    .update(cursusRequests)
    .set(result.ok
      ? { syncStatus: 'sent', sentAt: at, lastAttemptAt: at, attempts: r.attempts + 1, lastError: null, cursusRef: result.cursusRef ?? null }
      : { syncStatus: 'failed', lastAttemptAt: at, attempts: r.attempts + 1, lastError: result.error.slice(0, 500) })
    .where(eq(cursusRequests.id, id));
}
