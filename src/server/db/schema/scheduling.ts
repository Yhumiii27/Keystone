// Scheduling (chapter 4 — docs/spec/11 §3.3 Calendar, spec 05 §0 / §2, open questions S-1, S-2, S-8): work calendars and
// their exceptions, and the log of "Reschedule" runs (the CPM engine is src/domain/cpm.ts, the calendars src/domain/calendar.ts).
import { boolean, date, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ScheduleRunOutcome } from '../codes';
import { id, num, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/**
 * Work calendars. The four built-in ones (S-2: Standard 5d · 8h, Atelier 5d · 8h, Chantier 6d · 10h, Continu 24h / 7d) are
 * seeded with the codes of `CalendarCode`; an MS Project / P6 import may add project calendars (`projectId` set). Projects
 * reference a calendar by `projects.calendar`, activities by `activities.calendar_code` (codes, no foreign key: the DAL checks).
 */
export const calendars = pgTable('calendars', {
  code: text('code').primaryKey(),
  /** EN source name ("Chantier 6d · 10h"). */
  name: text('name').notNull(),
  /** Working weekdays, ISO numbering (1 = Monday … 7 = Sunday). */
  workDays: integer('work_days').array().notNull(),
  hoursPerDay: num('hours_per_day').notNull(),
  /** Public-holiday set computed per year ('FR' = metropolitan France); null = no public holiday (Continu). */
  holidaySet: text('holiday_set'),
  /** Settings › Public holidays (company list) also apply. */
  useSettingsHolidays: boolean('use_settings_holidays').notNull().default(true),
  builtIn: boolean('built_in').notNull().default(false),
  active: boolean('active').notNull().default(true),
  /** Imported project calendar (S-9); null for company calendars. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** Calendar UID in the imported file. */
  externalUid: text('external_uid'),
  position: integer('position').notNull(),
  ...timestamps,
});

/** Exceptions of one calendar: an extra non-working day (closure) or an exceptional working day (Saturday worked). */
export const calendarExceptions = pgTable(
  'calendar_exceptions',
  {
    id: id(),
    calendarCode: text('calendar_code').notNull().references(() => calendars.code, { onDelete: 'cascade', onUpdate: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** true = worked although normally off; false = off although normally worked. */
    working: boolean('working').notNull().default(false),
    name: text('name').notNull().default(''),
    ...timestamps,
  },
  (t) => [unique().on(t.calendarCode, t.date)],
);

/** "Reschedule" runs (S-1: manual, like F9 in P6): what changed, for the toast, the audit and "a second run changes nothing". */
export const scheduleRuns = pgTable('schedule_runs', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  ranByPersonId: uuid('ran_by_person_id').references(() => persons.id),
  ranByName: text('ran_by_name').notNull(),
  dataDate: date('data_date', { mode: 'string' }).notNull(),
  outcome: text('outcome').$type<ScheduleRunOutcome>().notNull(),
  /** Project finish before / after the run. */
  previousFinishDate: date('previous_finish_date', { mode: 'string' }),
  finishDate: date('finish_date', { mode: 'string' }),
  changedActivities: integer('changed_activities').notNull().default(0),
  criticalActivities: integer('critical_activities').notNull().default(0),
  constraintViolations: integer('constraint_violations').notNull().default(0),
  /** Error / cycle message (EN source text). */
  message: text('message'),
  /** Free details (cycle path, changed activity codes…). */
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
});
