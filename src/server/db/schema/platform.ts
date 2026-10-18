// Platform (docs/spec/11 §3.4 Notification, §3.12 AuditEntry / ActivityEvent; screens 01 §5.5 notifications,
// 10 §2 activity feed and audit trail).
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ActivityKind, NotificationKind } from '../codes';
import { id } from './_common';
import { persons, users } from './organisation';
import { projects } from './portfolio';

/**
 * Notifications (NOTIFS 3545). The prototype addresses them to roles (`audience`); each one is expanded into
 * notification_recipients rows for the users holding those roles, which carry the per-user read state.
 */
export const notifications = pgTable('notifications', {
  id: id(),
  /** "n1" for seed rows; generated ids for new ones. */
  code: text('code').notNull().unique(),
  kind: text('kind').$type<NotificationKind>().notNull(),
  /** EN source strings: "CR-008 awaits your approval" / "Second steel crew — schedule recovery · +85 k€ · Romain Aubert". */
  title: text('title').notNull(),
  body: text('body').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  /** Project the notification is about (HLT-026 for the seed, null for portfolio-wide ones such as the Lucca sync). */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** Target screen id (src/config/screens.ts) and its parameters (`extra`: { cr: 'CR-008' }, { qTab: 'ncr', ncr: 'NCR-029' }…). */
  targetScreen: text('target_screen').notNull(),
  targetParams: jsonb('target_params').$type<Record<string, unknown>>().notNull().default({}),
  /** Role keys of the original audience (kept for reference; delivery is per recipient row). */
  audienceRoles: text('audience_roles').array().notNull(),
  /** Bell-panel order (NOTIFS order; new notifications are prepended with a lower value). */
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Delivery of a notification to a user, with the per-user read state (replaces `state.readNotifs`). */
export const notificationRecipients = pgTable(
  'notification_recipients',
  {
    notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

/** Cross-project activity feed (ACTIVITY 3557), newest first. Actors are persons or systems (Lucca, System, Sage X3). */
export const activityEvents = pgTable('activity_events', {
  id: id(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actorPersonId: uuid('actor_person_id').references(() => persons.id),
  /** Display name: the person's full name or the system name. */
  actorName: text('actor_name').notNull(),
  /** EN source sentence (also written for keyed rows: older readers and exports keep working). */
  text: text('text').notNull(),
  /**
   * R-184 (NEW-D1-2): the system message the sentence was built from (src/domain/system-messages.ts) and its typed
   * parameters, so the feed is shown in the viewer's language; null for rows written as plain text (legacy writers).
   */
  messageKey: text('message_key'),
  messageParams: jsonb('message_params').$type<Record<string, unknown>>(),
  kind: text('kind').$type<ActivityKind>().notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /** Share D18 (Matrix): keystone.pub_journal is read by period. */
  index('activity_events_occurred_at_idx').on(t.occurredAt),
]);

/**
 * Append-only audit trail (AUDIT 3572): who changed what, when — exportable for ISO 9001 audits (spec 11 §3.12).
 * R-168: a database trigger refuses UPDATE, DELETE and TRUNCATE (custom migration `audit_append_only`); no foreign key may
 * act on its rows (project_id is NO ACTION: a project with audit rows cannot be deleted). A maintenance script that must
 * rewrite rows (GDPR purge, R-173) disables the trigger inside one transaction as the table owner.
 */
export const auditEntries = pgTable('audit_entries', {
  id: id(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actorPersonId: uuid('actor_person_id').references(() => persons.id),
  /** R-168: the user account that acted (from the person, or the signed-in user); null for systems (Lucca, Codex, jobs…). */
  actorUserId: uuid('actor_user_id').references(() => users.id),
  /** Display name of the actor (person full name or system). */
  actorName: text('actor_name').notNull(),
  /** Business reference of the object: "CR-008", "Request RQ-014", "Rate card", "Stock SG-BRK-SS2". */
  objectRef: text('object_ref').notNull(),
  /** "status: Draft → In review" — byte-identical to what readers match (kpis.ts, quality.ts). */
  change: text('change').notNull(),
  /** "Change control", "Approvals", "Settings"… */
  area: text('area').notNull(),
  /** Optional structured target (table name + id) and project. */
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  projectId: uuid('project_id').references(() => projects.id),
  /** R-168: the values before and after the change (writers that hold them), and the reason given by the actor. */
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  reason: text('reason'),
  /** R-184: the system message the change text was built from, and its typed parameters (as on activity_events). */
  messageKey: text('message_key'),
  messageParams: jsonb('message_params').$type<Record<string, unknown>>(),
}, (t) => [
  /** Share D18 (Matrix): keystone.pub_journal is read by period. */
  index('audit_entries_occurred_at_idx').on(t.occurredAt),
]);
