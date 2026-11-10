import 'server-only';
// Meetings & minutes screen data (docs/spec/05 §5) on top of the Delivery 3 meetings DAL (src/server/dal/meetings.ts):
// one read for the page (register + client question bridge) and the composer's fallback for a meeting created
// without an agenda — the prototype appended such notes to a point that was never shown (they were lost); here the
// first note opens agenda point 1, titled like the meeting (as "Add to minutes" does for the transcript proposals).
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { meetingAgendaPoints, meetings } from '@/server/db/schema';
import { listClientQuestions, listMeetings, type ClientQuestionRow, type MeetingRow } from './meetings';

export interface MeetingsScreenData {
  meetings: MeetingRow[];
  questions: ClientQuestionRow[];
}

/** Register of the project (MEETINGS order) and its internal ⇄ client question bridge. */
export async function getMeetingsScreen(projectCode: string): Promise<MeetingsScreenData> {
  const [ms, questions] = await Promise.all([listMeetings(projectCode), listClientQuestions(projectCode)]);
  return { meetings: ms, questions };
}

/** Opens agenda point 0 (titled like the meeting) when the meeting has none; returns whether one was created. */
export async function ensureFirstAgendaPoint(meetingNumber: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ id: meetings.id, title: meetings.title }).from(meetings).where(eq(meetings.number, meetingNumber));
    if (!m) throw new Error(`Unknown meeting ${meetingNumber}`);
    const [pt] = await tx.select({ id: meetingAgendaPoints.id }).from(meetingAgendaPoints).where(and(eq(meetingAgendaPoints.meetingId, m.id), eq(meetingAgendaPoints.position, 0)));
    if (pt) return false;
    await tx.insert(meetingAgendaPoints).values({ meetingId: m.id, position: 0, title: m.title });
    return true;
  });
}
