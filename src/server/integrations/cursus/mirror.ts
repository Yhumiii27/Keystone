import 'server-only';
// Local mirror of the Cursus approvals and the outbox of what Keystone sends to Cursus (schema/cursus.ts). Shared by
// the mock and HTTP connectors and the seed: `upsertClearances` is the only writer of `cursus_clearances`.
import { and, asc, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { claimExpiry } from '../outbox';
import { findPerson } from '@/server/db/helpers';
import { cursusClearances, cursusRequests, cursusSyncRuns, persons } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { CursusClearanceRecord, CursusClearanceView, CursusGoNoGo } from './types';

type Q = DB | Tx;

/**
 * The name a clearance row keeps (R-027). A row keeps the name it was first stored under: reminders and the unique
 * (project, name) key use it. Exception: a row only named after its matricule ("EMP-0018": Cursus sends no names, and no
 * person carried that matricule yet) takes the directory's name once one is known, unless another row of the project
 * already has that name.
 */
export function keptClearanceName(old: { personName: string; matricule: string | null } | undefined, r: { personName: string; matricule: string | null }, takenByOthers: ReadonlySet<string>): string {
  if (!old || !r.matricule || old.matricule !== r.matricule) return r.personName;
  const placeholder = old.personName === old.matricule;
  return placeholder && r.personName !== r.matricule && !takenByOthers.has(r.personName) ? r.personName : old.personName;
}

/**
 * Replaces a project's clearances with Cursus's records (matched by person; rows Cursus no longer lists are removed). R-027:
 * the Keystone person is the one carrying the matricule (staff directory), else the person of that name; the row's name
 * follows keptClearanceName (a placeholder matricule name is replaced, with its reminders, by the directory's name).
 */
export async function upsertClearances(q: Q, projectCode: string, records: CursusClearanceRecord[], syncedAt: Date, mode: 'mock' | 'http'): Promise<number> {
  const existing = await q.select({ id: cursusClearances.id, personName: cursusClearances.personName, matricule: cursusClearances.matricule })
    .from(cursusClearances).where(eq(cursusClearances.projectCode, projectCode));
  const keep = new Set<string>();
  // Names in use on the project (the stored ones, then those given in this loop): a rename never breaks the unique key.
  const names = new Map(existing.map((e) => [e.id, e.personName]));
  for (const [position, r] of records.entries()) {
    const old = existing.find((e) => (r.matricule && e.matricule === r.matricule) || e.personName === r.personName);
    const [byMatricule] = r.matricule ? await q.select({ id: persons.id }).from(persons).where(eq(persons.matricule, r.matricule)) : [];
    const person = byMatricule ?? (await findPerson(q, r.personName));
    const personName = keptClearanceName(old, r, new Set([...names].filter(([id]) => id !== old?.id).map(([, n]) => n)));
    if (old) names.set(old.id, personName);
    // The reminders recorded under the placeholder name follow the row (readClearances matches them by name).
    if (old && personName !== old.personName)
      await q.update(cursusRequests).set({ personName }).where(and(eq(cursusRequests.projectCode, projectCode), eq(cursusRequests.personName, old.personName)));
    const values = {
      projectCode, chantierId: r.chantierId, matricule: r.matricule, personName,
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

/** Claims an outbox entry before sending it (R-010, ../outbox.ts): true when this delivery may send it. */
export async function claimRequestDelivery(q: Q, id: string, at = new Date()): Promise<boolean> {
  const rows = await q
    .update(cursusRequests)
    .set({ claimedAt: at })
    .where(and(eq(cursusRequests.id, id), ne(cursusRequests.syncStatus, 'sent'), or(isNull(cursusRequests.claimedAt), lt(cursusRequests.claimedAt, claimExpiry(at)))))
    .returning({ id: cursusRequests.id });
  return rows.length > 0;
}

/** Marks a delivery attempt of an outbox entry (and releases its claim). */
export async function markRequestDelivery(q: Q, id: string, result: { ok: true; cursusRef?: string | null } | { ok: false; error: string }, at = new Date()): Promise<void> {
  await q
    .update(cursusRequests)
    .set(result.ok
      ? { syncStatus: 'sent', sentAt: at, lastAttemptAt: at, attempts: sql`${cursusRequests.attempts} + 1`, lastError: null, cursusRef: result.cursusRef ?? null, claimedAt: null }
      : { syncStatus: 'failed', lastAttemptAt: at, attempts: sql`${cursusRequests.attempts} + 1`, lastError: result.error.slice(0, 500), claimedAt: null })
    .where(eq(cursusRequests.id, id));
}
