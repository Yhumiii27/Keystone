import 'server-only';
// R-036 — the e-mail of the bell notifications (rules: src/domain/notification-mail.ts). Each recipient row starts in the state
// its preference gives (notification-routing.ts, inside createNotification's transaction); then:
// - immediate: sent right after the notice's commit by createNotification (`sendImmediateMails`), else by the job
//   "notification-mails" (every 5 minutes: what a crash or a restart left waiting). A row is claimed (immediate → sending, one
//   UPDATE … RETURNING) before anything is sent: two senders never send it twice; a row left "sending" for 30 minutes (the
//   sender died mid-way) is marked failed, never resent (at most once, like the reminders);
// - digest: the job "notification-digest", every morning at the reminders hour, sends each person one e-mail with the notices
//   kept for it and not read yet in the bell — once per person and business date (`reminder_sends`, kind "digest"); a notice
//   read in the bell before the digest is not mailed ("seen").
// Rights: a person is mailed only what the bell shows them — an internal account every notice addressed to it; a client only
// the notices of their organisation's projects on their workspace's screens, never NCRs or purchasing (`noticeVisibility`, the
// bell's read-time filter of src/server/dal/shell.ts). The texts are French (the default language), as the bell shows them.
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { DEFAULT_PROJECT } from '@/config/screens';
import { digestMail, digestSendKey, isClientOnly, noticeMail, type MailState, type NoticeForMail } from '@/domain/notification-mail';
import { clientRefusedProject, clientSeesTarget } from '@/domain/rights';
import { fieldsText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { stampText } from '@/server/db/codes';
import { notificationRecipients, notifications, projects, users } from '@/server/db/schema';
import { logError } from '@/server/log';
import { mailTransport, type MailTransport } from '@/server/mail/transport';
import { listProjects } from './projects';
import { absoluteLink, claimSends, recipientsOf, recordSendOutcome, type MailOutcome, type Recipient } from './reminders';

/** A row left "sending" this long is given up (failed). */
export const SENDING_TIMEOUT_MS = 30 * 60_000;

export interface NoticeMailRun {
  /** Rows claimed by this run. */
  claimed: number;
  sent: number;
  failed: number;
  /** Not sent: no address, not visible to the person, no transport, read before the digest. */
  skipped: number;
}

type Notice = { id: string; title: string; sub: string; screen: string; params: Record<string, unknown>; projectCode: string | null; occurredAt: Date };

/** Whether a recipient may see a notice — the bell's read-time rule (dal/shell.ts notificationsFor). */
export async function noticeVisibility(): Promise<(r: Pick<Recipient, 'roles' | 'organisation'>, n: Pick<Notice, 'screen' | 'params' | 'projectCode'>) => boolean> {
  const all = await listProjects();
  return (r, n) => {
    if (!isClientOnly(r.roles)) return true;
    const p = all.find((x) => x.code === (n.projectCode ?? DEFAULT_PROJECT));
    const own = !!p && !clientRefusedProject({ role: 'client', organisation: r.organisation }, p);
    return clientSeesTarget(n.screen, n.params, own);
  };
}

const fr = () => {
  const t = makeT('fr');
  return { t, fields: (s: string) => fieldsText(s, t, 'fr') };
};

const forMail = (n: Notice): NoticeForMail => ({
  title: n.title, sub: n.sub, projectCode: n.projectCode, when: stampText(n.occurredAt), link: absoluteLink(n.screen, n.params, n.projectCode),
});

async function noticesOf(ids: readonly string[]): Promise<Map<string, Notice>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.select({ n: notifications, code: projects.code }).from(notifications).leftJoin(projects, eq(projects.id, notifications.projectId))
    .where(inArray(notifications.id, [...new Set(ids)]));
  return new Map(rows.map(({ n, code }) => [n.id, {
    id: n.id, title: n.title, sub: n.body, screen: n.targetScreen, params: n.targetParams, projectCode: code, occurredAt: n.occurredAt,
  }]));
}

/** user id → recipient (active accounts only). */
async function recipientsOfUsers(userIds: readonly string[]): Promise<Map<string, Recipient>> {
  if (!userIds.length) return new Map();
  const db = await getDb();
  const rows = await db.select({ id: users.id, p: users.personId }).from(users).where(inArray(users.id, [...new Set(userIds)]));
  const byPerson = await recipientsOf(rows.map((r) => r.p), db);
  return new Map([...byPerson.values()].map((r) => [r.userId, r]));
}

async function setState(rows: readonly { notificationId: string; userId: string }[], state: MailState, error?: string): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      await db.update(notificationRecipients).set({ mailState: state, mailAt: new Date(), mailError: error?.slice(0, 500) ?? null })
        .where(or(...part.map((r) => and(eq(notificationRecipients.notificationId, r.notificationId), eq(notificationRecipients.userId, r.userId)))));
    }
  } catch (e) {
    logError('notification mail: state', e, { count: rows.length, state });
  }
}

async function send(transport: MailTransport, r: Recipient, m: { subject: string; body: string }): Promise<MailOutcome> {
  if (transport.mode === 'none') return { status: 'no_transport' };
  if (!r.email) return { status: 'no_address' };
  try {
    const sent = await transport.send({ to: r.email, toName: r.name, subject: m.subject, text: m.body });
    return sent.status === 'sent' ? { status: 'sent' } : sent.status === 'failed' ? { status: 'failed', error: sent.error } : { status: 'no_transport' };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sends the e-mails waiting to go at once — one notice's (`notificationId`, createNotification after its commit) or all of them
 * (the job). Never throws for one recipient's failure (written on its row).
 */
export async function sendImmediateMails(opts: { notificationId?: string } = {}): Promise<NoticeMailRun> {
  const db = await getDb();
  const run: NoticeMailRun = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const claimed = await db.update(notificationRecipients).set({ mailState: 'sending', mailAt: new Date() })
    .where(and(eq(notificationRecipients.mailState, 'immediate'), opts.notificationId ? eq(notificationRecipients.notificationId, opts.notificationId) : undefined))
    .returning({ notificationId: notificationRecipients.notificationId, userId: notificationRecipients.userId });
  run.claimed = claimed.length;
  if (!claimed.length) return run;
  const [notices, people, may] = await Promise.all([noticesOf(claimed.map((c) => c.notificationId)), recipientsOfUsers(claimed.map((c) => c.userId)), noticeVisibility()]);
  const transport = mailTransport();
  const tr = fr();
  for (const row of claimed) {
    const n = notices.get(row.notificationId);
    const r = people.get(row.userId);
    if (!n || !r || !may(r, n)) {
      await setState([row], 'not_visible');
      run.skipped++;
      continue;
    }
    const out = await send(transport, r, noticeMail(r.name, forMail(n), tr));
    await setState([row], out.status === 'off' ? 'off' : out.status, out.error);
    if (out.status === 'sent') run.sent++;
    else if (out.status === 'failed') run.failed++;
    else run.skipped++;
  }
  return run;
}

/** Rows left "sending" longer than SENDING_TIMEOUT_MS (a sender stopped mid-way) → failed (never resent). */
export async function expireStaleSending(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const rows = await db.update(notificationRecipients).set({ mailState: 'failed', mailAt: now, mailError: 'interrupted while sending' })
    .where(and(eq(notificationRecipients.mailState, 'sending'), lt(notificationRecipients.mailAt, new Date(now.getTime() - SENDING_TIMEOUT_MS))))
    .returning({ id: notificationRecipients.notificationId });
  return rows.length;
}

export interface DigestRun extends NoticeMailRun {
  today: string;
  /** Persons e-mailed a digest. */
  persons: number;
}

/**
 * The daily digest (job "notification-digest", at the reminders hour): per person, the notices kept for the digest and still
 * unread, in one e-mail; once per person and business date (`on`: tests). Idempotent (see the file header).
 */
export async function runNotificationDigest(on?: string): Promise<DigestRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const run: DigestRun = { today, claimed: 0, sent: 0, failed: 0, skipped: 0, persons: 0 };
  const waiting = await db.selectDistinct({ userId: notificationRecipients.userId }).from(notificationRecipients).where(eq(notificationRecipients.mailState, 'digest'));
  if (!waiting.length) return run;
  const [people, may] = await Promise.all([recipientsOfUsers(waiting.map((w) => w.userId)), noticeVisibility()]);
  const transport = mailTransport();
  const tr = fr();
  for (const { userId } of waiting) {
    const r = people.get(userId);
    // The rows of this person, claimed at once (a racing run claims none of them).
    const rows = await db.update(notificationRecipients).set({ mailState: 'sending', mailAt: new Date() })
      .where(and(eq(notificationRecipients.userId, userId), eq(notificationRecipients.mailState, 'digest')))
      .returning({ notificationId: notificationRecipients.notificationId, userId: notificationRecipients.userId, readAt: notificationRecipients.readAt });
    if (!rows.length) continue;
    run.claimed += rows.length;
    if (!r) {
      await setState(rows, 'not_visible');
      run.skipped += rows.length;
      continue;
    }
    const notices = await noticesOf(rows.map((x) => x.notificationId));
    const seen = rows.filter((x) => x.readAt);
    const hidden = rows.filter((x) => !x.readAt && (!notices.get(x.notificationId) || !may(r, notices.get(x.notificationId)!)));
    const due = rows.filter((x) => !seen.includes(x) && !hidden.includes(x));
    await setState(seen, 'seen');
    await setState(hidden, 'not_visible');
    run.skipped += seen.length + hidden.length;
    if (!due.length) continue;
    // One digest per person and day: a second run the same day puts the rows back for tomorrow's.
    const key = digestSendKey(r.personId, today);
    const got = await claimSends([key], 'digest', today);
    if (!got.size) {
      await setState(due, 'digest');
      run.claimed -= due.length;
      continue;
    }
    const list = due.map((x) => notices.get(x.notificationId)!).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).map(forMail);
    const out = await send(transport, r, digestMail(r.name, list, today, absoluteLink('mywork', {}, null), tr));
    await setState(due, out.status === 'sent' ? 'digested' : out.status === 'off' ? 'off' : out.status, out.error);
    await recordSendOutcome([key], null, out);
    if (out.status === 'sent') {
      run.sent += due.length;
      run.persons++;
    } else if (out.status === 'failed') run.failed += due.length;
    else run.skipped += due.length;
  }
  return run;
}
