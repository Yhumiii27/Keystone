// Personal work and staffing (docs/spec/11 §3.4 Task, §3.6 ResourceRequest; screens 10 §6–7 My work / Task,
// 08 §5–6 Resource requests / Approvals): tasks with checklist, comments, attachments and time entries, and
// the resource requests that create tasks once a department head approves them.
//
// Dates: the prototype keeps working-day offsets from Mon 21 Sep 2026 (`start`, `due`, `propStart`…); they are
// stored as ISO dates and converted back with codes.ts dayOffsetOfIso (the DAL returns both).
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AttachmentKind, Priority, RequestEventAction, RequestStatus, TaskOrigin, TaskStatus, TimeEntrySource } from '../codes';
import { id, num, timestamps } from './_common';
import { storedFiles } from './files';
import { departments, persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';
import { whatIfScenarios } from './resources';

/** Tasks (TODOS 3228, DESC 3261; new tasks from approved resource requests T-2341…). */
export const tasks = pgTable('tasks', {
  id: id(),
  /** "T-2314" (global). */
  number: text('number').notNull().unique(),
  /** Null only for a contract role that is not a person yet (approved request for "Contract structural engineer"). */
  assigneePersonId: uuid('assignee_person_id').references(() => persons.id),
  contractRole: text('contract_role'),
  title: text('title').notNull(),
  /** DESC[id]; null → the Task screen generates its default sentence. */
  description: text('description'),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
  status: text('status').$type<TaskStatus>().notNull(),
  priority: text('priority').$type<Priority>().notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  estimateH: num('estimate_h').notNull(),
  /** Hours logged to date (prototype `logged`; time entries exist for some tasks only — logging adds to it). */
  loggedH: num('logged_h').notNull(),
  /** 0–100, coupled with the status (11 §3.4). */
  percentComplete: integer('percent_complete').notNull(),
  /** ['QA', 'Site']. */
  labels: text('labels').array().notNull(),
  /** Checklist counts shown when the task has no checklist items (prototype `cl`); derived from the items otherwise. */
  checklistDone: integer('checklist_done').notNull().default(0),
  checklistTotal: integer('checklist_total').notNull().default(0),
  /** "New · approved by {dept}" tag (prototype `fresh`, tasks created by an approval). */
  isFresh: boolean('is_fresh').notNull().default(false),
  /** Approving department (prototype `dept` of fresh tasks). */
  departmentId: uuid('department_id').references(() => departments.id),
  sourceRequestId: uuid('source_request_id').references((): AnyPgColumn => resourceRequests.id, { onDelete: 'set null' }),
  /** TODOS order (new tasks are appended). */
  sortOrder: integer('sort_order').notNull(),
  /** Chapter 4: where the task comes from ('activity_todo' = Plan drawer composer); null for the seed and older tasks. */
  origin: text('origin').$type<TaskOrigin>(),
  ...timestamps,
});

/** Checklist items (CHECKS 3257). */
export const taskChecklistItems = pgTable('task_checklist_items', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
  done: boolean('done').notNull(),
  doneAt: timestamp('done_at', { withTimezone: true }),
});

/** Comments (COMMENTS 3258). Author = the viewer who posts (not the prototype's hard-coded Marie Lefebvre). */
export const taskComments = pgTable('task_comments', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorPersonId: uuid('author_person_id').notNull().references(() => persons.id),
  /** Seed "Yesterday 16:40" / "Today 08:15" are relative to the status date (Fri 25 Sep 2026), Europe/Paris. */
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  text: text('text').notNull(),
  position: integer('position').notNull(),
});

/** Attachments (FILES 3259: name, "48 KB · H. Sauvage · today", icon). Upload storage is not modelled (storageRef). */
export const taskAttachments = pgTable('task_attachments', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** "48 KB". */
  sizeText: text('size_text').notNull(),
  uploadedByPersonId: uuid('uploaded_by_person_id').references(() => persons.id),
  uploadedOn: date('uploaded_on', { mode: 'string' }).notNull(),
  kind: text('kind').$type<AttachmentKind>().notNull(),
  storageRef: text('storage_ref'),
  position: integer('position').notNull(),
  /** Chapter 4 (R-8): the stored file (src/server/storage); null for the seed's FILES rows (no content). */
  fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
  mime: text('mime'),
  sizeBytes: integer('size_bytes'),
});

/** Time entries (ENTRIES 3260; "Log" on the Task screen). */
export const timeEntries = pgTable('time_entries', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').references(() => persons.id),
  workDate: date('work_date', { mode: 'string' }).notNull(),
  hours: num('hours').notNull(),
  note: text('note').notNull(),
  source: text('source').$type<TimeEntrySource>().notNull().default('keystone'),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Resource requests (REQUESTS 3270): a PM asks a department for a person or a contract role on an activity. */
export const resourceRequests = pgTable('resource_requests', {
  id: id(),
  /** "RQ-044" (global; new RQ-045…). */
  number: text('number').notNull().unique(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** The PM who sent it (prototype `pm`). */
  requestedByPersonId: uuid('requested_by_person_id').notNull().references(() => persons.id),
  /** Named person, or null with `contractRole` ("Contract structural engineer"). */
  personId: uuid('person_id').references(() => persons.id),
  contractRole: text('contract_role'),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  title: text('title').notNull(),
  activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
  hours: num('hours').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  priority: text('priority').$type<Priority>().notNull(),
  status: text('status').$type<RequestStatus>().notNull(),
  /** "Fri 25 Sep". */
  sentOn: date('sent_on', { mode: 'string' }).notNull(),
  /** "Note for the department head". */
  note: text('note').notNull().default(''),
  /** Decision line shown on both sides, EN source string ("Approved · Ines Duarte · Thu 24 Sep"; '' while pending). */
  response: text('response').notNull().default(''),
  /** Reschedule proposal (+1/+2/+3 weeks). */
  proposedStart: date('proposed_start', { mode: 'string' }),
  proposedDue: date('proposed_due', { mode: 'string' }),
  /** Task created on approval (prototype `todoId`). */
  taskId: uuid('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  /** Chapter 4 (S-7): the what-if scenario whose "Apply" drafted this request. */
  scenarioId: uuid('scenario_id').references(() => whatIfScenarios.id, { onDelete: 'set null' }),
  /** REQUESTS order (new requests are prepended with a lower value). */
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
});

/** Decision trail of a request (seeded from `sent` and the `response` text). */
export const resourceRequestEvents = pgTable('resource_request_events', {
  id: id(),
  requestId: uuid('request_id').notNull().references(() => resourceRequests.id, { onDelete: 'cascade' }),
  action: text('action').$type<RequestEventAction>().notNull(),
  /** Business date of the event. */
  onDate: date('on_date', { mode: 'string' }).notNull(),
  byPersonId: uuid('by_person_id').references(() => persons.id),
  note: text('note'),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Activities offered by the "New resource request" dialog of a project (NR_ACTS 3283 for HLT-026: A1250, A1260,
 * A1320, A1420, A1430 — a curated list). Projects without choices offer their open activities (DAL).
 */
export const requestActivityChoices = pgTable(
  'request_activity_choices',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.activityId] })],
);
