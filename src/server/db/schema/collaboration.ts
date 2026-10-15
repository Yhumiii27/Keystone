// Collaboration (docs/spec/11 §3.4 Meeting, ClientQuestion, Stakeholder / RaciMatrix; screens 05 §5 Meetings &
// minutes, §6 Stakeholders & RACI): the project meeting register (synced from Outlook in the target), its
// participants, agenda, minutes lines, transcripts with their (simulated) analysis, the internal ⇄ client question
// bridge, the stakeholder register and the RACI matrix.
//
// People are cited by short name in the prototype and some are external ("K. Lindqvist (Nordvolt)", "Infrastructure
// BU"): every person reference keeps the displayed name and links the person when one is known.
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  ClientQuestionState, MeetingLineOrigin, MeetingLineType, MeetingSeries, MeetingStatus, MeetingType, RaciCode, StakeholderType, TranscriptAnalyzer,
  TranscriptProposalStatus, TranscriptProposalType, TranscriptSource,
} from '../codes';
import { id, timestamps } from './_common';
import { documents } from './documents';
import { storedFiles } from './files';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';
import { tasks } from './work';

/** Meetings (MEETINGS 3703: HLT-026 × 5, NDC-031 × 1). */
export const meetings = pgTable('meetings', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** "MTG-118" (global; new meetings MTG-130…). */
  number: text('number').notNull().unique(),
  title: text('title').notNull(),
  series: text('series').$type<MeetingSeries>().notNull(),
  type: text('type').$type<MeetingType>().notNull(),
  /** "29 Sep 2026" + "08:30" (Europe/Paris) — `startsAt` is the instant. */
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  startTime: text('start_time').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  /** "45 min" → 45, "1 h 30" → 90. */
  durationMin: integer('duration_min').notNull(),
  /** "Site office · Le Havre", "Teams". */
  location: text('location').notNull(),
  organizerPersonId: uuid('organizer_person_id').references(() => persons.id),
  organizerName: text('organizer_name').notNull(),
  status: text('status').$type<MeetingStatus>().notNull(),
  /** Minutes document number ("MIN-HLT-023") and its index record when indexed (MIN-HLT-022 is not). */
  minutesNumber: text('minutes_number'),
  minutesDocumentId: uuid('minutes_document_id').references(() => documents.id, { onDelete: 'set null' }),
  minutesSentOn: date('minutes_sent_on', { mode: 'string' }),
  /** Outlook event id (OPEN QUESTION S-11). */
  externalCalendarId: text('external_calendar_id'),
  /** MEETINGS order 1…n; created meetings come first, in creation order (`createdSortOrder`, MTG-130 → −999870). */
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
});

/** Invitees, attendance and read receipts of the minutes (`invited`, `present`, `read`). */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: id(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    /** As invited: "R. Aubert", "K. Lindqvist (Nordvolt)". */
    name: text('name').notNull(),
    present: boolean('present').notNull().default(false),
    /** Receives the minutes with a read receipt (every invitee but the organizer, once sent). */
    minutesRecipient: boolean('minutes_recipient').notNull().default(false),
    minutesReadOn: date('minutes_read_on', { mode: 'string' }),
  },
  (t) => [unique().on(t.meetingId, t.name)],
);

/** Agenda points (`agenda[].pt`). */
export const meetingAgendaPoints = pgTable(
  'meeting_agenda_points',
  {
    id: id(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
  },
  (t) => [unique().on(t.meetingId, t.position)],
);

/** Minutes lines per agenda point: info / decision / action (owner, due, done, task created on "Send minutes"). */
export const meetingLines = pgTable(
  'meeting_lines',
  {
    id: id(),
    agendaPointId: uuid('agenda_point_id').notNull().references(() => meetingAgendaPoints.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').$type<MeetingLineType>().notNull(),
    text: text('text').notNull(),
    /** Actions only: owner as typed (external owners allowed) and the resolved person. */
    ownerName: text('owner_name'),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    /** Actions only: due as typed ("2 Oct", "—") and the parsed date (2026 assumed, as the prototype). */
    dueText: text('due_text'),
    dueDate: date('due_date', { mode: 'string' }),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    /** Actions (S-12 a, R-067): the plan activity the action serves (same project) — carried to the task "Send minutes" creates. */
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    origin: text('origin').$type<MeetingLineOrigin>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.agendaPointId, t.position)],
);

/**
 * Meeting transcript (MTG_TRANSCRIPTS 3711) and its analysis. The analysis is simulated (OPEN QUESTION S-10): the
 * prototype's pre-baked summary and proposals are stored with the transcript and revealed by "Analyse transcript".
 */
export const meetingTranscripts = pgTable('meeting_transcripts', {
  meetingId: uuid('meeting_id').primaryKey().references(() => meetings.id, { onDelete: 'cascade' }),
  rawText: text('raw_text').notNull(),
  /** "teams" (seed recording), 'paste' or 'file' (chapter 4 import, S-10). */
  source: text('source').$type<TranscriptSource>().notNull(),
  summary: text('summary').notNull(),
  analysedAt: timestamp('analysed_at', { withTimezone: true }),
  /** "Add to minutes" applied the proposals (once). */
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  // ── Chapter 4 (S-10) ──
  /** Uploaded .txt / .vtt / .srt (stored by Keystone); null for pasted text and the seed. */
  fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
  /** Detected language ('fr' / 'en'). */
  language: text('language'),
  /** Who produced the proposals: the prototype's pre-baked analysis, the local rule-based analyser or Claude. */
  analyzer: text('analyzer').$type<TranscriptAnalyzer>(),
  /** Model id when analysed by Claude. */
  analyzerModel: text('analyzer_model'),
  /** Notice shown with the analysis (fallback to the local analyser, refusal…; EN source text). */
  analysisNotice: text('analysis_notice'),
  importedAt: timestamp('imported_at', { withTimezone: true }),
  importedByPersonId: uuid('imported_by_person_id').references(() => persons.id),
  importedByName: text('imported_by_name'),
});

/** Decisions and actions proposed by the transcript analysis. */
export const meetingTranscriptProposals = pgTable(
  'meeting_transcript_proposals',
  {
    meetingId: uuid('meeting_id').notNull().references(() => meetingTranscripts.meetingId, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** decision / action (prototype), risk / question (chapter 4 analysers). */
    type: text('type').$type<TranscriptProposalType>().notNull(),
    text: text('text').notNull(),
    ownerName: text('owner_name'),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    dueText: text('due_text'),
    dueDate: date('due_date', { mode: 'string' }),
    // ── Chapter 4 (S-10): human review — nothing reaches minutes / tasks / risks without a click. ──
    status: text('status').$type<TranscriptProposalStatus>().notNull().default('proposed'),
    /** Speaker label (VTT / SRT / "Name:" lines) and the transcript excerpt the proposal comes from. */
    speaker: text('speaker'),
    quote: text('quote'),
    reviewedByPersonId: uuid('reviewed_by_person_id').references(() => persons.id),
    reviewedByName: text('reviewed_by_name'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** What the proposal became ("T-2345", "R-21", minutes line id…). */
    appliedRef: text('applied_ref'),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.position] })],
);

/** Internal ⇄ client question bridge (MTG_EXCHANGE 3712: HLT-026 × 3, NDC-031 × 2). */
export const clientQuestions = pgTable('client_questions', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
  /** "N. Bensaïd", "Infrastructure BU". */
  askedByName: text('asked_by_name').notNull(),
  askedByPersonId: uuid('asked_by_person_id').references(() => persons.id),
  /** Answering department ("Electrical"). */
  department: text('department').notNull(),
  ownerName: text('owner_name').notNull(),
  ownerPersonId: uuid('owner_person_id').references(() => persons.id),
  state: text('state').$type<ClientQuestionState>().notNull(),
  answer: text('answer'),
  ...timestamps,
});

/** Stakeholder register (STAKEHOLDERS 3714: HLT-026 × 8). Stale when the last contact is more than 30 days old. */
export const stakeholders = pgTable('stakeholders', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  organisation: text('organisation').notNull(),
  role: text('role').notNull(),
  type: text('type').$type<StakeholderType>().notNull(),
  /** Always 0 / 0 / '' in the seed (OPEN QUESTION S-13). */
  influence: integer('influence').notNull().default(0),
  interest: integer('interest').notNull().default(0),
  attitude: text('attitude').notNull().default(''),
  contactEmail: text('contact_email'),
  /** Relationship owner (normalised to the person; the seed cites short names). */
  ownerPersonId: uuid('owner_person_id').references(() => persons.id),
  ownerName: text('owner_name').notNull(),
  lastContactOn: date('last_contact_on', { mode: 'string' }).notNull(),
  notes: text('notes').notNull().default(''),
  /** The stakeholder as a known person (client PM, sponsor), when one matches. */
  personId: uuid('person_id').references(() => persons.id),
  /** Register order (added stakeholders are appended). */
  position: integer('position').notNull(),
  ...timestamps,
});

/** RACI matrix of a project (RACI 3715: HLT-026, 6 columns × 7 rows). Columns are dynamic. */
export const raciMatrices = pgTable('raci_matrices', {
  id: id(),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  ...timestamps,
});

/** Matrix columns ("Project manager", "Client PM", "Port HSE"…). */
export const raciColumns = pgTable(
  'raci_columns',
  {
    matrixId: uuid('matrix_id').notNull().references(() => raciMatrices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matrixId, t.position] })],
);

/** Matrix rows (responsibilities: "Design release (BPE)"). */
export const raciRows = pgTable(
  'raci_rows',
  {
    id: id(),
    matrixId: uuid('matrix_id').notNull().references(() => raciMatrices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
  },
  (t) => [unique().on(t.matrixId, t.position)],
);

/** Non-empty cells (empty = no row). */
export const raciCells = pgTable(
  'raci_cells',
  {
    rowId: uuid('row_id').notNull().references(() => raciRows.id, { onDelete: 'cascade' }),
    columnPosition: integer('column_position').notNull(),
    code: text('code').$type<RaciCode>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.rowId, t.columnPosition] })],
);
