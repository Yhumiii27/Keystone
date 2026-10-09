import 'server-only';
// Meetings DAL — writer helpers shared by the minutes writers (meetings.ts) and the transcript writers
// (meetings-transcripts.ts): load a meeting in a transaction, write its audit row, append minutes lines to an agenda point.
import { and, eq, sql } from 'drizzle-orm';
import { isoOfDisplayDate, type MeetingLineOrigin, type MeetingLineType } from '@/server/db/codes';
import { findPerson, nameOf, writeAudit } from '@/server/db/helpers';
import { meetingAgendaPoints, meetingLines, meetings } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';

export type MeetingRecord = typeof meetings.$inferSelect;

export async function loadMeeting(tx: Tx, number: string): Promise<MeetingRecord> {
  const [m] = await tx.select().from(meetings).where(eq(meetings.number, number));
  if (!m) throw new Error(`Unknown meeting ${number}`);
  return m;
}

/** Audit row of a meeting change, the viewer as the actor (full name when known). Returns the actor's person. */
export async function auditMeeting(tx: Tx, actorName: string, objectRef: string, change: string, projectId: string, entityId: string) {
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef, change, area: 'Meetings', entityType: 'meeting', entityId, projectId });
  return actor;
}

export interface NewMeetingLine {
  type: MeetingLineType;
  text: string;
  /** Actions: owner (default the organizer) and due as typed (default "—"). */
  owner?: string | null;
  due?: string | null;
}

/** Appends lines to an agenda point; returns their positions. Actions default to the organizer and "—". */
export async function appendLines(tx: Tx, m: MeetingRecord, point: number, lines: (NewMeetingLine & { origin: MeetingLineOrigin })[]): Promise<number[]> {
  const [pt] = await tx.select().from(meetingAgendaPoints).where(and(eq(meetingAgendaPoints.meetingId, m.id), eq(meetingAgendaPoints.position, point)));
  if (!pt) throw new Error(`${m.number} has no agenda point ${point}`);
  const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${meetingLines.position}), -1)::int` }).from(meetingLines).where(eq(meetingLines.agendaPointId, pt.id));
  const rows = [];
  for (const [k, l] of lines.entries()) {
    const isAction = l.type === 'action';
    const owner = isAction ? l.owner?.trim() || m.organizerName : null;
    const due = isAction ? l.due?.trim() || '—' : null;
    rows.push({
      agendaPointId: pt.id, position: maxPos + 1 + k, type: l.type, text: l.text.trim(), ownerName: owner, ownerPersonId: owner ? (await findPerson(tx, owner))?.id ?? null : null,
      dueText: due, dueDate: due && due !== '—' ? isoOfDisplayDate(due) : null, origin: l.origin,
    });
  }
  if (rows.length) await tx.insert(meetingLines).values(rows);
  return rows.map((r) => r.position);
}
