import 'server-only';
// Inbox of the events Cursus pushes (R-029, NEW-CURSUS-7 "a"; table cursus_events). One transaction per received event:
// - a known event id is a duplicate: nothing changes, the caller answers 200 { duplicate: true };
// - an event with a replacement key replaces the previous event of that key (hours of a person's week, an absence), unless the
//   stored one is newer (emitted later): the late one is kept as "ignored". An absence's validation and its cancellation share
//   the key (Cursus's absence id): Keystone applies an event only when it is newer than the last one applied for that object
//   (Cursus API-KEYSTONE.md « Ordre » — the HR department can resend an old failed event after newer ones);
// - the dispatch runs in the same transaction for what lives in Keystone's database:
//     heures.validees  stored, never applied (the Cursus timesheet link awaits the owner, R-030);
//     absence.validee  written to the leave calendar when the matricule names a person (persons.matricule, R-027, else the
//                      Cursus mirror's person), else "unresolved" — kept for replay (R-031); a correction (same Cursus absence
//                      id, new dates) replaces the weeks written before;
//     absence.annulee  the absence's weeks are removed from the leave calendar (by its key, whoever carries them); when none
//                      were there and no person carries the matricule, "unresolved" — kept for replay like a validation;
//     verdict.modifie  the Keystone project whose site sheet carries that Cursus site; refreshed after the commit in HTTP
//                      mode (./events.ts), recorded only with the mock; "unresolved" when no site sheet carries it;
//     demande.decision stored only; unknown types "ignored";
// - one audit row per new event (actor "Cursus", area "Integrations"); none for a duplicate. No activity event: what Cursus
//   sends is about people (R-173).
// Unresolved events are replayed after a staff-directory import (R-027) and can be replayed by IT (replayUnresolvedCursusEvents).
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { cursusEventsCutoff, sameObjectTypes, type CursusEvent } from '@/domain/cursus-events';
import { getDb } from '@/server/db/client';
import type { CursusEventStatus } from '@/server/db/codes';
import { writeAudit } from '@/server/db/helpers';
import { cursusClearances, cursusEvents, persons, projects, siteSheets } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { removeCursusAbsence, replaceCursusAbsence } from '@/server/dal/hr';
import { cursusConnectorMode } from './connection';

type Q = DB | Tx;

/** Actor of the audit rows of what Cursus pushes (a system, like "IT · configuration file"). */
export const CURSUS_EVENTS_ACTOR = 'Cursus';

export interface ReceivedEvent {
  duplicate: boolean;
  status: CursusEventStatus;
  /** The Keystone project to refresh after the commit (verdict.modifie in HTTP mode); null otherwise. */
  refreshProject: string | null;
}

/** The person a matricule names: the one carrying it (staff directory, R-027), else the Cursus mirror's person for it. */
export async function personOfMatricule(q: Q, matricule: string): Promise<string | null> {
  const [p] = await q.select({ id: persons.id }).from(persons).where(eq(persons.matricule, matricule));
  if (p) return p.id;
  const [c] = await q.select({ id: cursusClearances.personId }).from(cursusClearances)
    .where(and(eq(cursusClearances.matricule, matricule), sql`${cursusClearances.personId} is not null`)).limit(1);
  return c?.id ?? null;
}

/** The dispatch of one event inside the inbox transaction: its status, a note, and the project to refresh after the commit. */
async function dispatch(q: Q, e: { type: string; data: Record<string, unknown>; matricule: string | null; replaceKey: string | null }):
  Promise<{ status: CursusEventStatus; note: string | null; refreshProject: string | null }> {
  switch (e.type) {
    case 'heures.validees':
      return { status: 'received', note: 'Stored only: the Cursus timesheet link is not switched on (R-030)', refreshProject: null };
    case 'absence.validee': {
      const d = e.data as { matricule: string; start: string; end: string; type: 'leave' | 'absence' };
      const personId = await personOfMatricule(q, d.matricule);
      if (!personId) return { status: 'unresolved', note: 'No Keystone person carries this matricule yet', refreshProject: null };
      const weeks = await replaceCursusAbsence(q, { personId, type: d.type, start: d.start, end: d.end, key: e.replaceKey! });
      return { status: 'received', note: `Leave calendar · ${weeks} week${weeks === 1 ? '' : 's'}`, refreshProject: null };
    }
    case 'absence.annulee': {
      const d = e.data as { matricule: string };
      // By its key (Cursus's absence id): the weeks go whoever carries them (the matricule may have changed since, Cursus's
      // switch to payroll matricules).
      const removed = await removeCursusAbsence(q, e.replaceKey!);
      if (removed) return { status: 'received', note: `Leave calendar · ${removed} week${removed === 1 ? '' : 's'} removed`, refreshProject: null };
      if (!(await personOfMatricule(q, d.matricule))) return { status: 'unresolved', note: 'No Keystone person carries this matricule yet', refreshProject: null };
      return { status: 'received', note: 'Leave calendar · nothing to remove', refreshProject: null };
    }
    case 'verdict.modifie': {
      const chantier = String(e.data.chantier ?? '');
      const [site] = await q.select({ code: projects.code }).from(siteSheets).innerJoin(projects, eq(projects.id, siteSheets.projectId))
        .where(eq(siteSheets.cursusChantierId, chantier));
      if (!site) return { status: 'unresolved', note: 'No Keystone site sheet is linked to this Cursus site', refreshProject: null };
      if (cursusConnectorMode() !== 'http') return { status: 'received', note: `Recorded only (simulated Cursus connector) · ${site.code}`, refreshProject: null };
      return { status: 'received', note: `Go / No Go refreshed · ${site.code}`, refreshProject: site.code };
    }
    case 'demande.decision':
      return { status: 'received', note: 'Stored only', refreshProject: null };
    default:
      return { status: 'ignored', note: 'Event type not read by Keystone', refreshProject: null };
  }
}

/** Stores and dispatches one validated event (one transaction; see the header). */
export async function receiveCursusEvent(ev: CursusEvent, now: Date = new Date()): Promise<ReceivedEvent> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ status: cursusEvents.status }).from(cursusEvents).where(eq(cursusEvents.eventId, ev.id));
    if (dup) return { duplicate: true, status: dup.status, refreshProject: null };
    let superseded = false;
    if (ev.replaceKey) {
      const previous = await tx.select({ id: cursusEvents.id, emittedAt: cursusEvents.emittedAt }).from(cursusEvents)
        .where(and(inArray(cursusEvents.type, sameObjectTypes(ev.type)), eq(cursusEvents.replaceKey, ev.replaceKey), sql`${cursusEvents.status} <> 'ignored'`));
      superseded = previous.some((p) => p.emittedAt.getTime() > ev.emittedAt.getTime());
      if (!superseded && previous.length) await tx.delete(cursusEvents).where(inArray(cursusEvents.id, previous.map((p) => p.id)));
    }
    const d = superseded
      ? { status: 'ignored' as const, note: 'Older than the event already received for the same key', refreshProject: null }
      : await dispatch(tx, { type: ev.type, data: ev.data, matricule: ev.matricule, replaceKey: ev.replaceKey });
    const [row] = await tx.insert(cursusEvents).values({
      eventId: ev.id, type: ev.type, emittedAt: ev.emittedAt, receivedAt: now, replaceKey: ev.replaceKey, matricule: ev.matricule, data: ev.data, status: d.status,
      note: d.note, processedAt: now,
    }).returning({ id: cursusEvents.id });
    await writeAudit(tx, {
      actorName: CURSUS_EVENTS_ACTOR, objectRef: `Cursus event ${ev.id}`, change: `${ev.type} · ${d.status}`, area: 'Integrations', entityType: 'cursus_event',
      entityId: row.id, occurredAt: now,
    });
    return { duplicate: false, status: d.status, refreshProject: d.refreshProject };
  });
}

/** Marks an event's dispatch failed after the commit (the verdict refresh): kept for replay. */
export async function markCursusEventError(eventId: string, note: string): Promise<void> {
  const db = await getDb();
  await db.update(cursusEvents).set({ status: 'error', note: note.slice(0, 300), processedAt: new Date() }).where(eq(cursusEvents.eventId, eventId));
}

/**
 * Replays the unresolved (and failed) absence and verdict events — after a staff-directory import names new matricules, or
 * a site sheet gets its Cursus site. Each event in its own transaction (the oldest first, so a later absence still replaces
 * an earlier one). Returns how many ended received / unresolved / in error. Verdict refreshes are not re-run here (the next
 * read of the site refreshes it).
 */
export async function replayUnresolvedCursusEvents(): Promise<{ received: number; unresolved: number; error: number }> {
  const db = await getDb();
  const rows = await db.select().from(cursusEvents)
    .where(and(inArray(cursusEvents.status, ['unresolved', 'error']), inArray(cursusEvents.type, ['absence.validee', 'absence.annulee', 'verdict.modifie'])))
    .orderBy(asc(cursusEvents.emittedAt));
  const out = { received: 0, unresolved: 0, error: 0 };
  for (const r of rows) {
    try {
      const status = await db.transaction(async (tx) => {
        const d = await dispatch(tx, { type: r.type, data: r.data, matricule: r.matricule, replaceKey: r.replaceKey });
        await tx.update(cursusEvents).set({ status: d.status, note: d.note, processedAt: new Date() }).where(eq(cursusEvents.id, r.id));
        return d.status;
      });
      if (status === 'received') out.received++;
      else out.unresolved++;
    } catch (e) {
      await markCursusEventError(r.eventId, e instanceof Error ? e.message : String(e)).catch(() => null);
      out.error++;
    }
  }
  return out;
}

/** Deletes the events received more than 13 months ago (job "cursus-events-purge"). Returns how many. */
export async function purgeOldCursusEvents(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const gone = await db.delete(cursusEvents).where(lt(cursusEvents.receivedAt, cursusEventsCutoff(now))).returning({ id: cursusEvents.id });
  return gone.length;
}

/** The Cursus row of Activity & integrations (R-029): when the last event arrived, and how many wait for a person or a site. */
export async function cursusInboxState(q?: Q): Promise<{ lastReceivedAt: Date | null; unresolved: number }> {
  const db = q ?? (await getDb());
  const [[last], [{ n }]] = await Promise.all([
    db.select({ at: cursusEvents.receivedAt }).from(cursusEvents).orderBy(desc(cursusEvents.receivedAt)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(cursusEvents).where(inArray(cursusEvents.status, ['unresolved', 'error'])),
  ]);
  return { lastReceivedAt: last?.at ?? null, unresolved: n };
}
