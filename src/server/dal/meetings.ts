import 'server-only';
// Meetings & minutes DAL (docs/spec/05 §5; 11 §3.4 Meeting, ClientQuestion). The project meeting register with
// attendance, agenda and minutes lines, transcripts with their analysis and its human review (chapter 4, S-10 — writers in
// meetings-transcripts.ts), the internal ⇄ client question bridge, and the writers: new meeting (MTG-130…), minutes lines
// (Scheduled → Notes in progress), action ticks, and "Send minutes" — a numbered MIN document released in the Codex index,
// a task for every action (S-12 a, R-067: the internal owner, else a follow-up for the external owner's relationship owner or
// the PM), read receipts for every invitee but the organizer.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { FOLLOW_UP_LABEL, followUpTarget, followUpTitle, minutesTaskDates } from '@/domain/meetings';
import { workdayOffsetOf } from '@/domain/clock';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import {
  isoOfDayOffset, meetingLineType, meetingSeries, meetingStatus, meetingType, monthIndexOfIso,
  nextBusinessNumber, parisInstant, shortDateOfIso, displayOfIso,
  type MeetingLineOrigin, type MeetingLineType, type MeetingSeries, type MeetingStatus, type MeetingType, type TranscriptAnalyzer,
  type TranscriptProposalStatus, type TranscriptProposalType, type TranscriptSource,
} from '@/server/db/codes';
import { demoFloor, findPerson, nextNumber, requireProject } from '@/server/db/helpers';
import {
  activities, clientQuestions, documents, meetingAgendaPoints, meetingLines, meetingParticipants, meetingTranscriptProposals, meetingTranscripts, meetings, persons,
  projects, stakeholders, storedFiles, tasks, users,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { createMinutesDocument } from './documents';
import { appendLines, auditMeeting as audit, loadMeeting, type NewMeetingLine } from './meetings-core';
import { notifyTasksAssigned } from './task-notices';

export type { NewMeetingLine } from './meetings-core';
export { analyseTranscript, applyTranscriptToMinutes } from './meetings-transcripts';

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

export interface MeetingLineRow {
  /** Agenda point index and line index (the prototype's `{id}|{i}|{j}` key). */
  point: number;
  position: number;
  type: MeetingLineType;
  text: string;
  /** Actions: owner as typed ("J. Wagner") and its full name when the owner is in the resource pool (`fullName`). */
  owner: string | null;
  ownerFull: string | null;
  /** Actions: due as typed ("2 Oct", "—") and its date (2026 assumed). */
  due: string | null;
  dueDate: string | null;
  done: boolean;
  /** Open action due before the business date's month index (the prototype's PG_NOW; R-013). */
  overdue: boolean;
  /** Task created by "Send minutes". */
  taskNumber: string | null;
  origin: MeetingLineOrigin;
  /** Actions (S-12 a): the plan activity code the action serves, null when none. */
  activity: string | null;
}

export interface MeetingParticipantRow {
  name: string;
  present: boolean;
  /** Receives the minutes (every invitee but the organizer once sent) and the read date. */
  minutesRecipient: boolean;
  readOn: string | null;
  /** "27 Sep" or "". */
  readText: string;
}

/** Chapter 4 schema: proposals may also be risks / client questions; the minutes take decisions and actions only. */
const isMinutesProposal = <P extends { type: string }>(x: P): x is P & { type: 'decision' | 'action' } => x.type === 'decision' || x.type === 'action';

export interface TranscriptProposal {
  type: 'decision' | 'action';
  text: string;
  owner: string | null;
  due: string | null;
}

/** One proposal of the analysis with its review state (chapter 4, S-10). */
export interface TranscriptItemRow {
  position: number;
  type: TranscriptProposalType;
  text: string;
  owner: string | null;
  /** "6 Oct" as stored and its date. */
  due: string | null;
  dueDate: string | null;
  speaker: string | null;
  quote: string | null;
  /** proposed → rejected (discarded by a reviewer) / applied (in the minutes, the risk register or the client questions). */
  status: TranscriptProposalStatus;
  /** "MTG-119|2|3" (minutes line), "R-21" (risk), "Q&A" (client question). */
  appliedRef: string | null;
  reviewedBy: string | null;
}

export interface MeetingTranscriptView {
  text: string;
  analysed: boolean;
  /** Revealed once analysed. */
  summary: string | null;
  /** Decisions and actions for the minutes (not discarded), analysis order. */
  proposals: TranscriptProposal[];
  applied: boolean;
  // ── Chapter 4 (S-10) ──
  /** teams (seed recording) / paste / file. */
  source: TranscriptSource;
  /** Uploaded file name (stored by Keystone), null for a paste. */
  fileName: string | null;
  language: string | null;
  /** Who analysed: 'local' rules, 'claude', or 'prototype' / null for the prototype's pre-recorded analysis. */
  analyzer: TranscriptAnalyzer | null;
  analyzerModel: string | null;
  /** EN source notice (Claude failed → local analysis), translated per " · " segment. */
  notice: string | null;
  importedBy: string | null;
  /** ISO date of the import. */
  importedOn: string | null;
  /** Every proposal with its review state (empty until analysed). */
  items: TranscriptItemRow[];
}

export interface MeetingRow {
  /** "MTG-118". */
  number: string;
  projectCode: string;
  title: string;
  series: MeetingSeries;
  seriesLabel: string;
  type: MeetingType;
  typeLabel: string;
  startsOn: string;
  /** "29 Sep 2026". */
  dateText: string;
  /** Month index of the meeting date (prototype `mIdx(date)`), for "this week" / "this month". */
  monthIndex: number;
  time: string;
  durationMin: number;
  /** "45 min", "1 h", "1 h 30". */
  durationText: string;
  location: string;
  organizer: string;
  /** The organiser's person (P-9b: they and the project's PM write and send the minutes); null when only a name is known. */
  organizerPersonId: string | null;
  /** S-11 (R-037): synced from Outlook / Teams (an external calendar id is recorded); false for every meeting today. */
  syncedFromOutlook: boolean;
  status: MeetingStatus;
  statusLabel: string;
  /** "MIN-HLT-023"; `minutesIndexed` = the record exists in the Codex index ("Open minutes"). */
  minutesNumber: string | null;
  minutesIndexed: boolean;
  minutesSentOn: string | null;
  /** "26 Sep". */
  sentText: string;
  participants: MeetingParticipantRow[];
  agenda: { position: number; title: string; lines: MeetingLineRow[] }[];
  transcript: MeetingTranscriptView | null;
  /** Action lines of the meeting. */
  actionCount: number;
  /** Register order. */
  sortOrder: number;
}

/** Register order of a created meeting: below the seeded register (1…n), ascending with the global number (MTG-130, MTG-131…). */
export const createdSortOrder = (number: string) => parseInt(number.replace(/^MTG-/, ''), 10) - 1_000_000;

export const durationText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) : ''}`);
const before = (iso: string | null, today: string) => !!iso && monthIndexOfIso(iso) < monthIndexOfIso(today);

/** Meetings of a project with everything the register, detail card and registers need (MEETINGS order). */
export async function listMeetings(projectCode: string): Promise<MeetingRow[]> {
  const db = await getDb();
  const today = await businessToday();
  const ms = await db
    .select({ m: meetings, code: projects.code, docNumber: documents.number })
    .from(meetings)
    .innerJoin(projects, eq(projects.id, meetings.projectId))
    .leftJoin(documents, eq(documents.id, meetings.minutesDocumentId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(meetings.sortOrder));
  if (!ms.length) return [];
  const ids = ms.map((r) => r.m.id);
  const [parts, points, lines, trs, props, pool] = await Promise.all([
    db.select().from(meetingParticipants).where(inArray(meetingParticipants.meetingId, ids)).orderBy(asc(meetingParticipants.position)),
    db.select().from(meetingAgendaPoints).where(inArray(meetingAgendaPoints.meetingId, ids)).orderBy(asc(meetingAgendaPoints.position)),
    db.select({ l: meetingLines, meetingId: meetingAgendaPoints.meetingId, task: tasks.number, act: activities.code }).from(meetingLines)
      .innerJoin(meetingAgendaPoints, eq(meetingAgendaPoints.id, meetingLines.agendaPointId))
      .leftJoin(tasks, eq(tasks.id, meetingLines.taskId))
      .leftJoin(activities, eq(activities.id, meetingLines.activityId))
      .where(inArray(meetingAgendaPoints.meetingId, ids)).orderBy(asc(meetingLines.position)),
    db.select().from(meetingTranscripts).where(inArray(meetingTranscripts.meetingId, ids)),
    db.select().from(meetingTranscriptProposals).where(inArray(meetingTranscriptProposals.meetingId, ids)).orderBy(asc(meetingTranscriptProposals.position)),
    db.select({ id: persons.id, full: persons.fullName }).from(persons).where(isNotNull(persons.resourcePoolPosition)),
  ]);
  const poolName = new Map(pool.map((p) => [p.id, p.full]));
  const fileIds = trs.map((t) => t.fileId).filter((x): x is string => !!x);
  const files = fileIds.length ? await db.select({ id: storedFiles.id, name: storedFiles.name }).from(storedFiles).where(inArray(storedFiles.id, fileIds)) : [];
  const fileName = new Map(files.map((f) => [f.id, f.name]));
  return ms.map(({ m, code, docNumber }) => {
    const agenda = points.filter((p) => p.meetingId === m.id).map((p) => ({
      position: p.position, title: p.title,
      lines: lines.filter((x) => x.l.agendaPointId === p.id).map(({ l, task, act }) => ({
        point: p.position, position: l.position, type: l.type, text: l.text, owner: l.ownerName,
        ownerFull: l.ownerName ? ((l.ownerPersonId && poolName.get(l.ownerPersonId)) || l.ownerName) : null, due: l.dueText, dueDate: l.dueDate, done: l.done,
        overdue: l.type === 'action' && !l.done && before(l.dueDate, today), taskNumber: task, origin: l.origin, activity: act,
      })),
    }));
    const tr = trs.find((t) => t.meetingId === m.id);
    return {
      number: m.number, projectCode: code, title: m.title, series: m.series, seriesLabel: meetingSeries.label(m.series), type: m.type, typeLabel: meetingType.label(m.type),
      startsOn: m.startsOn, dateText: displayOfIso(m.startsOn), monthIndex: monthIndexOfIso(m.startsOn), time: m.startTime, durationMin: m.durationMin,
      durationText: durationText(m.durationMin), location: m.location, organizer: m.organizerName, organizerPersonId: m.organizerPersonId,
      syncedFromOutlook: !!m.externalCalendarId, status: m.status, statusLabel: meetingStatus.label(m.status),
      minutesNumber: m.minutesNumber, minutesIndexed: !!docNumber, minutesSentOn: m.minutesSentOn, sentText: m.minutesSentOn ? shortDateOfIso(m.minutesSentOn) : '',
      participants: parts.filter((p) => p.meetingId === m.id).map((p) => ({
        name: p.name, present: p.present, minutesRecipient: p.minutesRecipient, readOn: p.minutesReadOn, readText: p.minutesReadOn ? shortDateOfIso(p.minutesReadOn) : '',
      })),
      agenda,
      transcript: tr ? transcriptView(tr, props.filter((x) => x.meetingId === m.id), tr.fileId ? fileName.get(tr.fileId) ?? null : null) : null,
      actionCount: agenda.reduce((s, a) => s + a.lines.filter((l) => l.type === 'action').length, 0),
      sortOrder: m.sortOrder,
    };
  });
}

/** Transcript of a meeting as the screen reads it: proposals and review items only once analysed. */
function transcriptView(
  tr: typeof meetingTranscripts.$inferSelect,
  props: (typeof meetingTranscriptProposals.$inferSelect)[],
  fileName: string | null,
): MeetingTranscriptView {
  const analysed = !!tr.analysedAt;
  const shown = analysed ? props : [];
  return {
    text: tr.rawText, analysed, summary: analysed ? tr.summary : null, applied: !!tr.appliedAt,
    // Decisions then actions — the order "Add to minutes" appends them in.
    proposals: [...shown.filter((x) => x.type === 'decision'), ...shown.filter((x) => x.type === 'action')]
      .filter(isMinutesProposal)
      .filter((x) => x.status !== 'rejected')
      .map((x) => ({ type: x.type, text: x.text, owner: x.ownerName, due: x.dueText })),
    source: tr.source, fileName, language: tr.language, analyzer: tr.analyzer, analyzerModel: tr.analyzerModel, notice: tr.analysisNotice,
    importedBy: tr.importedByName, importedOn: tr.importedAt ? tr.importedAt.toISOString().slice(0, 10) : null,
    items: shown.map((x) => ({
      position: x.position, type: x.type, text: x.text, owner: x.ownerName, due: x.dueText, dueDate: x.dueDate, speaker: x.speaker, quote: x.quote, status: x.status,
      appliedRef: x.appliedRef, reviewedBy: x.reviewedByName,
    })),
  };
}

/** One meeting by number, null when unknown. */
export async function getMeeting(number: string): Promise<MeetingRow | null> {
  const db = await getDb();
  const [r] = await db.select({ code: projects.code }).from(meetings).innerJoin(projects, eq(projects.id, meetings.projectId)).where(eq(meetings.number, number));
  if (!r) return null;
  return (await listMeetings(r.code)).find((m) => m.number === number) ?? null;
}

/** Meetings with notes in progress per project code (Meetings nav badge, `mtgBadge`). */
export async function meetingsToWriteByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, n: sql<number>`count(*)::int` })
    .from(meetings)
    .innerJoin(projects, eq(projects.id, meetings.projectId))
    .where(eq(meetings.status, 'notes_in_progress'))
    .groupBy(projects.code);
  return Object.fromEntries(rows.map((r) => [r.code, r.n]));
}

export interface ClientQuestionRow {
  text: string;
  /** "N. Bensaïd", "Infrastructure BU". */
  askedBy: string;
  department: string;
  owner: string;
  state: 'open' | 'answered';
  answer: string | null;
}

/**
 * S-12 a (R-067): the project's plan activities for the composer's optional "Activity" select — plan order, code and name (the
 * name is typed text: shown with dataText).
 */
export async function listMeetingActivityOptions(projectCode: string): Promise<{ code: string; name: string }[]> {
  const db = await getDb();
  return db
    .select({ code: activities.code, name: activities.name })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(activities.position));
}

/** Internal ⇄ client question bridge of a project (MTG_EXCHANGE order). */
export async function listClientQuestions(projectCode: string): Promise<ClientQuestionRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ q: clientQuestions })
    .from(clientQuestions)
    .innerJoin(projects, eq(projects.id, clientQuestions.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(clientQuestions.position));
  return rows.map(({ q }) => ({ text: q.text, askedBy: q.askedByName, department: q.department, owner: q.ownerName, state: q.state, answer: q.answer }));
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface NewMeeting {
  title: string;
  type: MeetingType;
  series: MeetingSeries;
  /** ISO date and "09:00". */
  date: string;
  time?: string | null;
  location?: string | null;
  /** Short names as typed ("R. Aubert, L. Fabre"). */
  invitees: string[];
  /** One point per line. */
  agenda: string[];
}

/**
 * "New meeting" (AF.meetings, "Create meeting" — R-037, was "Create & invite"): MTG-130… (global sequence), organized by the viewer, Scheduled,
 * 1 h, on top of the register — created meetings come before the seeded register, in creation order, as the
 * prototype's `[...added.meetings, ...MEETINGS]`. Returns the number (toast "{title} · Meeting created").
 */
export async function createMeeting(projectCode: string, input: NewMeeting, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const title = input.title.trim();
    if (!title) throw new Error('The title is required');
    if (!meetingType.isCode(input.type) || !meetingSeries.isCode(input.series)) throw new Error('Invalid meeting type or series');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Invalid date');
    const invitees = [...new Set(input.invitees.map((x) => x.trim()).filter(Boolean))];
    if (!invitees.length) throw new Error('Invite at least one person');
    const time = input.time?.trim() || '09:00';
    if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Invalid time');
    const hhmm = time.padStart(5, '0');
    const actor = await findPerson(tx, actorName);
    const number = await nextNumber(tx, meetings, meetings.number, 'MTG-', 3, 129);
    const [m] = await tx
      .insert(meetings)
      .values({
        projectId: p.id, number, title, series: input.series, type: input.type, startsOn: input.date, startTime: hhmm, startsAt: parisInstant(input.date, hhmm),
        durationMin: 60, location: input.location?.trim() || 'Teams', organizerPersonId: actor?.id ?? null, organizerName: actor?.shortName ?? actorName,
        status: 'scheduled', sortOrder: createdSortOrder(number),
      })
      .returning({ id: meetings.id });
    const people = await Promise.all(invitees.map((n) => findPerson(tx, n)));
    await tx.insert(meetingParticipants).values(invitees.map((name, position) => ({ meetingId: m.id, position, personId: people[position]?.id ?? null, name })));
    const points = input.agenda.map((x) => x.trim()).filter(Boolean);
    if (points.length) await tx.insert(meetingAgendaPoints).values(points.map((t, position) => ({ meetingId: m.id, position, title: t })));
    await audit(tx, actorName, number, `created · ${title} · ${displayOfIso(input.date)} ${hhmm}`, p.id, m.id);
    return number;
  });
}

/**
 * Composer "+ Add" (`addLine`): appends a line to an agenda point; a Scheduled meeting moves to Notes in progress.
 * Minutes already sent cannot be edited.
 */
export async function addMeetingLine(meetingNumber: string, point: number, line: NewMeetingLine, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    if (m.status === 'minutes_sent') throw new Error(`${meetingNumber}: minutes already sent`);
    if (!meetingLineType.isCode(line.type)) throw new Error('Invalid line type');
    if (!line.text.trim()) throw new Error('The note is empty');
    await appendLines(tx, m, point, [{ ...line, origin: 'manual' }]);
    if (m.status === 'scheduled') await tx.update(meetings).set({ status: 'notes_in_progress', updatedAt: new Date() }).where(eq(meetings.id, m.id));
    await audit(tx, actorName, meetingNumber, `${line.type} added · ${line.text.trim()}${m.status === 'scheduled' ? ' · status: Scheduled → Notes in progress' : ''}`, m.projectId, m.id);
  });
}

/** Action checkbox (`toggleLine`): ticks / unticks an action line (any meeting status, as the prototype). Returns the new state. */
export async function toggleMeetingAction(meetingNumber: string, point: number, position: number, actorName: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    const [row] = await tx
      .select({ l: meetingLines })
      .from(meetingLines)
      .innerJoin(meetingAgendaPoints, eq(meetingAgendaPoints.id, meetingLines.agendaPointId))
      .where(and(eq(meetingAgendaPoints.meetingId, m.id), eq(meetingAgendaPoints.position, point), eq(meetingLines.position, position)));
    if (!row) throw new Error(`Unknown line ${meetingNumber}|${point}|${position}`);
    if (row.l.type !== 'action') throw new Error('Only actions can be ticked');
    const done = !row.l.done;
    await tx.update(meetingLines).set({ done, doneAt: done ? new Date() : null }).where(eq(meetingLines.id, row.l.id));
    await audit(tx, actorName, meetingNumber, `action ${done ? 'closed' : 'reopened'} · ${row.l.text}`, m.projectId, m.id);
    return done;
  });
}

/**
 * Minutes number: `MIN-{project short code}-{seq}` with seq = max(24 + minutes already sent on the project, the
 * project's highest MIN number) + 1 — HLT-026's first send is MIN-HLT-027 as in the prototype, whose prefix was
 * hard-coded to HLT for every project (S-12).
 */
async function minutesNumberOf(tx: Tx, projectId: string, shortCode: string): Promise<string> {
  const [{ sent }] = await tx.select({ sent: sql<number>`count(*)::int` }).from(meetings).where(and(eq(meetings.projectId, projectId), eq(meetings.status, 'minutes_sent')));
  const prefix = `MIN-${shortCode}-`;
  const existing = (await tx.select({ n: documents.number }).from(documents)).map((r) => r.n).filter((n) => n.startsWith(prefix));
  return nextBusinessNumber(existing, prefix, 3, (await demoFloor(tx, 24)) + sent);
}

export interface SentMinutes {
  /** "MIN-HLT-027". */
  minutesNumber: string;
  /** Everyone invited (the toast's "{n} invitees"). */
  invited: number;
  /** Tasks created for the actions (internal owners and follow-ups), in agenda order. */
  tasks: string[];
}

/**
 * "Send minutes to all invitees" (`sendMinutes`): Minutes sent on `on`, a Released MIN record in the Codex index,
 * read receipts for every invitee but the organizer, and a task (T-2341…) for each action (S-12 a, R-067; the prototype made
 * one only for owners of the resource pool): an internal owner gets it (title = the action, labels Meeting + meeting number);
 * an external owner's action becomes a follow-up ("{action} — {owner as typed}", labels + Follow-up) for the relationship owner
 * of the matching stakeholder, else the project's PM (src/domain/meetings.ts `followUpTarget`); no PM → no task. Due = the typed
 * due date, else today + 3 working days (today = the business date's last working day, R-013: Fri 25 Sep on the demo data set);
 * start today, or the typed due when earlier; 2 h; the line's plan activity. Sent on `on` (default the business date).
 * Once committed, each assignee but the sender is told (R-015, "Task assigned · T-xxxx").
 */
export async function sendMinutes(meetingNumber: string, actorName: string, onDate?: string): Promise<SentMinutes> {
  const db = await getDb();
  const businessDay = await businessToday();
  const on = onDate ?? businessDay;
  const sent = await db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    if (m.status === 'minutes_sent') throw new Error(`${meetingNumber}: minutes already sent`);
    const [p] = await tx.select().from(projects).where(eq(projects.id, m.projectId));
    const minutesNumber = await minutesNumberOf(tx, p.id, p.shortCode);
    const docId = await createMinutesDocument(
      tx,
      { number: minutesNumber, title: m.title, projectId: p.id, authorPersonId: m.organizerPersonId, authorName: m.organizerName, external: m.type === 'external', tags: [m.number, meetingSeries.label(m.series)] },
      on,
    );
    const parts = await tx.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, m.id));
    // Every invitee but the organizer (by name, as the prototype, or by person when invited under another form).
    const isOrganizer = (x: typeof meetingParticipants.$inferSelect) => x.name === m.organizerName || (!!x.personId && x.personId === m.organizerPersonId);
    for (const x of parts)
      if (!isOrganizer(x)) await tx.update(meetingParticipants).set({ minutesRecipient: true, minutesReadOn: null }).where(eq(meetingParticipants.id, x.id));
    const actions = await tx
      .select({ l: meetingLines, clientId: persons.clientId, external: users.isExternal, userClientId: users.clientId })
      .from(meetingLines)
      .innerJoin(meetingAgendaPoints, eq(meetingAgendaPoints.id, meetingLines.agendaPointId))
      .leftJoin(persons, eq(persons.id, meetingLines.ownerPersonId))
      .leftJoin(users, eq(users.personId, meetingLines.ownerPersonId))
      .where(and(eq(meetingAgendaPoints.meetingId, m.id), eq(meetingLines.type, 'action')))
      .orderBy(asc(meetingAgendaPoints.position), asc(meetingLines.position));
    const register = await tx
      .select({ personId: stakeholders.personId, name: stakeholders.name, ownerPersonId: stakeholders.ownerPersonId, position: stakeholders.position })
      .from(stakeholders)
      .where(eq(stakeholders.projectId, p.id));
    const created: string[] = [];
    const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks);
    // Working-day offset of the business date (the prototype's TODAY; a weekend counts as its Friday).
    const day = workdayOffsetOf(businessDay);
    const today = isoOfDayOffset(day);
    const defaultDue = isoOfDayOffset(day + 3);
    for (const { l, clientId, external, userClientId } of actions) {
      if (l.taskId) continue;
      // Internal: a known person outside any client organisation who is not an external user (S-12 a).
      const owner = l.ownerPersonId ? { personId: l.ownerPersonId, internal: !clientId && !external && !userClientId } : null;
      const target = followUpTarget({ ownerName: l.ownerName ?? '', owner, stakeholders: register, pmPersonId: p.pmPersonId });
      if (!target) continue;
      const { start, due } = minutesTaskDates(l.dueDate, today, defaultDue);
      const number = await nextNumber(tx, tasks, tasks.number, 'T-', 4, 2340);
      const [t] = await tx
        .insert(tasks)
        .values({
          number, assigneePersonId: target.personId, title: target.followUp ? followUpTitle(l.text, l.ownerName ?? '') : l.text, projectId: p.id,
          activityId: l.activityId, status: 'todo', priority: 'med', startDate: start, dueDate: due, estimateH: 2, loggedH: 0, percentComplete: 0,
          labels: target.followUp ? ['Meeting', m.number, FOLLOW_UP_LABEL] : ['Meeting', m.number], checklistDone: 0, checklistTotal: 0,
          sortOrder: maxOrder + 1 + created.length, origin: 'meeting',
        })
        .returning({ id: tasks.id });
      await tx.update(meetingLines).set({ taskId: t.id }).where(eq(meetingLines.id, l.id));
      created.push(number);
    }
    await tx.update(meetings).set({ status: 'minutes_sent', minutesNumber, minutesDocumentId: docId, minutesSentOn: on, updatedAt: new Date() }).where(eq(meetings.id, m.id));
    await audit(tx, actorName, meetingNumber, `minutes sent · ${minutesNumber} · ${parts.length} invitees · ${created.length} actions added to tasks`, p.id, m.id);
    return { minutesNumber, invited: parts.length, tasks: created };
  });
  await notifyTasksAssigned(sent.tasks, actorName);
  return sent;
}

/**
 * Read receipt recorded in Keystone (S-11 a, R-037 — the Outlook receipt waits for the Microsoft 365 link): the reader opened
 * the sent minutes from the meeting ("Open minutes"). Only a minutes recipient (every invitee but the organizer) whose receipt
 * is still empty: matched by person, else — a participant invited by a name Keystone could not link — by the reader's full or
 * short name. Recorded once, audited; returns whether a receipt was recorded (false: not a recipient, already read, not sent).
 */
export async function recordMinutesRead(
  meetingNumber: string, reader: { personId: string; fullName: string | null; shortName: string }, onDate?: string,
): Promise<boolean> {
  const db = await getDb();
  const on = onDate ?? (await businessToday());
  return db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    if (m.status !== 'minutes_sent') return false;
    const parts = await tx
      .select()
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, m.id), eq(meetingParticipants.minutesRecipient, true)));
    const names = [reader.fullName, reader.shortName].filter((x): x is string => !!x);
    const p = parts.find((x) => x.personId === reader.personId) ?? parts.find((x) => !x.personId && names.includes(x.name));
    if (!p || p.minutesReadOn) return false;
    await tx.update(meetingParticipants).set({ minutesReadOn: on }).where(and(eq(meetingParticipants.id, p.id), sql`${meetingParticipants.minutesReadOn} is null`));
    await audit(tx, reader.fullName ?? reader.shortName, meetingNumber, `minutes read · ${m.minutesNumber ?? ''} · ${p.name} · ${shortDateOfIso(on)}`, m.projectId, m.id);
    return true;
  });
}

/** The person of a viewer (R-037 read receipts): by person id when signed in (Entra), else the demo persona's short name. */
export async function readerOf(v: { personId: string | null; short: string }): Promise<{ personId: string; fullName: string | null; shortName: string } | null> {
  const db = await getDb();
  const [p] = await db
    .select({ personId: persons.id, fullName: persons.fullName, shortName: persons.shortName })
    .from(persons)
    .where(v.personId ? eq(persons.id, v.personId) : eq(persons.shortName, v.short));
  return p ?? null;
}
