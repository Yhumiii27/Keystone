// R-199 — deadline reminders and scheduled reports (src/domain/reminders.ts): each user's reminder and report preferences
// (R-036 part: e-mail on / off, reminder offsets), and the send log that makes the jobs idempotent. The company default is the
// app setting `reminders.defaults` (Settings, the director). Relative imports only (drizzle-kit loads this file directly).
import { boolean, date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id } from './_common';
import { persons, users } from './organisation';

/** A user's own choices; no row = the company default. */
export const reminderPreferences = pgTable('reminder_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** E-mail copy of the deadline reminders (the bell notice is always sent). */
  emailReminders: boolean('email_reminders').notNull(),
  /** E-mail copy of the weekly reports (the bell notice is always sent). */
  emailReports: boolean('email_reports').notNull(),
  /** Days before the due date, largest first ({7,1} = J-7 and J-1). */
  offsets: integer('offsets').array().notNull(),
  /** One reminder once the due date has passed. */
  overdue: boolean('overdue').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per reminder or report sent to a person — claimed (inserted) before anything is sent, so a re-run, a second worker or a
 * restart never sends twice. `item_key` = "task:<uuid>", "deliverable:<uuid>"…, "project_weekly:HLT-026", "portfolio_weekly";
 * `slot` = "J-7", "J-1", "overdue", "weekly"; `occurrence` = the due date (a moved due date restarts the windows) or the ISO
 * week ("2026-W40").
 */
export const reminderSends = pgTable(
  'reminder_sends',
  {
    id: id(),
    personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'reminder' | 'report'>().notNull(),
    itemKey: text('item_key').notNull(),
    slot: text('slot').notNull(),
    occurrence: text('occurrence').notNull(),
    /** Business date of the run. */
    runOn: date('run_on', { mode: 'string' }).notNull(),
    /** Bell notification of the run ("n214"); null when the person had no active account any more. */
    notificationCode: text('notification_code'),
    /** E-mail outcome: sent | off (the person's choice) | no_transport | no_address | failed. */
    emailStatus: text('email_status').$type<'sent' | 'off' | 'no_transport' | 'no_address' | 'failed'>(),
    emailError: text('email_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('reminder_sends_key_unique').on(t.personId, t.itemKey, t.slot, t.occurrence), index('reminder_sends_run_on_idx').on(t.runOn)],
);
