import 'server-only';
// Notifications, activity feed and audit trail DAL (docs/spec/01 §5.5, 10 §2, 11 §3.4 Notification, §3.12):
// a viewer's notifications with a persisted per-user read state (replacing the session-only `readNotifs`),
// the cross-project activity feed, the audit trail, and their writers.
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { NOTIFICATION_ICON, stampText, type ActivityKind, type NotificationKind } from '@/server/db/codes';
import { nextNumber, recordActivity, writeAudit, type ActivityInput, type AuditInput } from '@/server/db/helpers';
import { activityEvents, auditEntries, notificationRecipients, notifications, projects, users } from '@/server/db/schema';
import { userIdOf, userIdsOfPersons, userIdsWithRoles, type UserRef } from './users';

export interface NotificationRow {
  /** "n1". */
  id: string;
  kind: NotificationKind;
  /** Phosphor class (NOTIF_ICON). */
  icon: string;
  /** EN source strings. */
  title: string;
  sub: string;
  occurredAt: string;
  /** "25 Sep 09:12". */
  when: string;
  read: boolean;
  /** Target screen id (src/config/screens.ts) + parameters, and the project it is about (null = portfolio-wide). */
  screen: string;
  params: Record<string, unknown>;
  projectCode: string | null;
}

/**
 * Notifications delivered to a user (bell panel order), with that user's read state. `who` = the viewer (signed-in user
 * or demo persona), or a role standing for its demo persona's user.
 */
export async function listNotifications(who: UserRef): Promise<NotificationRow[]> {
  const db = await getDb();
  const userId = await userIdOf(db, who);
  if (!userId) return [];
  const rows = await db
    .select({ n: notifications, readAt: notificationRecipients.readAt, code: projects.code })
    .from(notificationRecipients)
    .innerJoin(notifications, eq(notifications.id, notificationRecipients.notificationId))
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .where(eq(notificationRecipients.userId, userId))
    .orderBy(asc(notifications.sortOrder));
  return rows.map(({ n, readAt, code }) => ({
    id: n.code, kind: n.kind, icon: NOTIFICATION_ICON[n.kind], title: n.title, sub: n.body, occurredAt: n.occurredAt.toISOString(), when: stampText(n.occurredAt),
    read: readAt != null, screen: n.targetScreen, params: n.targetParams, projectCode: code,
  }));
}

/** Unread count of a user (bell badge; Activity & integrations KPI). */
export async function countUnreadNotifications(who: UserRef): Promise<number> {
  const db = await getDb();
  const userId = await userIdOf(db, who);
  if (!userId) return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationRecipients)
    .where(and(eq(notificationRecipients.userId, userId), isNull(notificationRecipients.readAt)));
  return r?.n ?? 0;
}

/** Opening a notification marks it read for that user only. */
export async function markNotificationRead(who: UserRef, code: string): Promise<void> {
  const db = await getDb();
  const userId = await userIdOf(db, who);
  if (!userId) return;
  const [n] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.code, code));
  if (!n) return;
  await db
    .update(notificationRecipients)
    .set({ readAt: new Date() })
    .where(and(eq(notificationRecipients.notificationId, n.id), eq(notificationRecipients.userId, userId), isNull(notificationRecipients.readAt)));
}

/** "Mark all read" — every notification of that user. */
export async function markAllNotificationsRead(who: UserRef): Promise<void> {
  const db = await getDb();
  const userId = await userIdOf(db, who);
  if (!userId) return;
  await db.update(notificationRecipients).set({ readAt: new Date() }).where(and(eq(notificationRecipients.userId, userId), isNull(notificationRecipients.readAt)));
}

export interface NewNotificationInput {
  kind: NotificationKind;
  title: string;
  sub: string;
  screen: string;
  params?: Record<string, unknown>;
  projectCode?: string | null;
  /** Roles whose users receive it (kept on the notification as its audience). */
  audience: string[];
  /**
   * Addressed to these persons instead (their active user accounts), e.g. the recipient of a resource request: with real
   * users several people hold the same role, so a personal notice must not go to the whole role.
   */
  toPersonIds?: string[];
  occurredAt?: Date;
}

/** Creates a notification on top of the bell list for its recipients (persons, else the audience roles). Returns its code. */
export async function createNotification(input: NewNotificationInput): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [{ minOrder }] = await tx.select({ minOrder: sql<number>`coalesce(min(${notifications.sortOrder}), 1)::int` }).from(notifications);
    const code = await nextNumber(tx, notifications, notifications.code, 'n', 1);
    let projectId: string | null = null;
    if (input.projectCode) [{ id: projectId }] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, input.projectCode));
    const [n] = await tx
      .insert(notifications)
      .values({
        code, kind: input.kind, title: input.title, body: input.sub, occurredAt: input.occurredAt ?? new Date(), projectId, targetScreen: input.screen,
        targetParams: input.params ?? {}, audienceRoles: input.audience, sortOrder: minOrder - 1,
      })
      .returning({ id: notifications.id });
    const to = input.toPersonIds ? await userIdsOfPersons(tx, input.toPersonIds) : await userIdsWithRoles(tx, input.audience);
    if (to.length) await tx.insert(notificationRecipients).values(to.map((u) => ({ notificationId: n.id, userId: u.id })));
    return code;
  });
}

// ── Activity feed ──────────────────────────────────────────────────────────────────────────────────────

export interface ActivityRow {
  occurredAt: string;
  /** "25 Sep 16:45". */
  when: string;
  /** Person full name or system ("Lucca", "System", "Sage X3"). */
  who: string;
  /** EN text as stored. */
  what: string;
  /** R-184: the system message the text was built from (null for plain-text rows): readers render it in the viewer's language. */
  messageKey: string | null;
  messageParams: Record<string, unknown> | null;
  kind: ActivityKind;
  projectCode: string | null;
}

/** Activity feed, newest first (optionally one kind — the source chips). */
export async function listActivity(opts: { kind?: ActivityKind; limit?: number } = {}): Promise<ActivityRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ a: activityEvents, code: projects.code })
    .from(activityEvents)
    .leftJoin(projects, eq(projects.id, activityEvents.projectId))
    .where(opts.kind ? eq(activityEvents.kind, opts.kind) : undefined)
    .orderBy(desc(activityEvents.occurredAt), asc(activityEvents.createdAt))
    .limit(opts.limit ?? 500);
  return rows.map(({ a, code }) => ({
    occurredAt: a.occurredAt.toISOString(), when: stampText(a.occurredAt), who: a.actorName, what: a.text, messageKey: a.messageKey, messageParams: a.messageParams,
    kind: a.kind, projectCode: code,
  }));
}

/** Appends an activity-feed event (server functions; the DAL writers of this delivery add audit rows). */
export async function addActivity(e: ActivityInput): Promise<void> {
  await recordActivity(await getDb(), e);
}

// ── Audit trail ────────────────────────────────────────────────────────────────────────────────────────

export interface AuditRow {
  occurredAt: string;
  /** "25 Sep 09:12". */
  when: string;
  who: string;
  /** "CR-008". */
  object: string;
  /** "status: Draft → In review". */
  change: string;
  /** "Change control". */
  area: string;
  projectCode: string | null;
  /** R-168: sign-in e-mail of the user account that acted (null for a system actor or a person without account). */
  userEmail: string | null;
  /** R-168: the reason given, and the values before / after the change, when the writer recorded them. */
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** R-184: the system message the change text was built from (null for plain-text rows). */
  messageKey: string | null;
  messageParams: Record<string, unknown> | null;
}

/** Audit trail, newest first. */
export async function listAudit(opts: { limit?: number; projectCode?: string } = {}): Promise<AuditRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ a: auditEntries, code: projects.code, email: users.email })
    .from(auditEntries)
    .leftJoin(projects, eq(projects.id, auditEntries.projectId))
    .leftJoin(users, eq(users.id, auditEntries.actorUserId))
    .where(opts.projectCode ? eq(projects.code, opts.projectCode) : undefined)
    .orderBy(desc(auditEntries.occurredAt))
    .limit(opts.limit ?? 500);
  return rows.map(({ a, code, email }) => ({
    occurredAt: a.occurredAt.toISOString(), when: stampText(a.occurredAt), who: a.actorName, object: a.objectRef, change: a.change, area: a.area, projectCode: code,
    userEmail: email, reason: a.reason, before: a.before, after: a.after, messageKey: a.messageKey, messageParams: a.messageParams,
  }));
}

/** Appends an audit row (for server functions writing outside this delivery's DAL writers); R-168: user, before / after, reason. */
export async function addAudit(e: AuditInput): Promise<void> {
  await writeAudit(await getDb(), e);
}
