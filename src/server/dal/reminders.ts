import 'server-only';
// R-199 — deadline reminders (daily job `deadline-reminders`, at the reminders hour): the open records with a due date and a
// responsible person (src/domain/reminders.ts lists them and the windows), filtered by what each person may receive (R-041,
// R-042, R-043: an internal role opens every project read-only; a client only their own portal's screens), then:
// 1. claimed in `reminder_sends` (one row per person, item, window and due date; a conflict = already sent, by this run's
//    predecessor or a racing worker — nothing is sent twice);
// 2. per person, one bell notice listing the items (always), and one e-mail (French, the default language) when the person kept
//    e-mail reminders on, a transport is configured (KEYSTONE_MAIL_TRANSPORT) and an address is known;
// 3. the outcome written back on the claimed rows (notification code, e-mail status).
// A failure after the claim is logged and never resent (at most once: a duplicate reminder is worse than a missed one).
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { RoleKey, ScreenId } from '@/config/screens';
import {
  REMINDER_NOTICE_TITLE, dueWindow, groupByPerson, planReminders, reminderMail, reminderNoticeSub, reminderSendKey, reminderTarget, sendKeyText,
  type DueItem, type PlannedReminder, type ReminderPrefs,
} from '@/domain/reminders';
import { clientRefusedProject, clientSeesMeeting, clientSeesTarget } from '@/domain/rights';
import { sortRoles } from '@/domain/auth';
import { dataText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { businessToday } from '@/server/clock';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import {
  activities, activityAssignments, clients, deliverableRaci, deliverables, meetingAgendaPoints, meetingLines, meetings, milestones, persons, projectControls, projects,
  reminderSends, sitePrerequisites, tasks, users,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { monthIso } from '@/server/export/providers/common';
import { monthIndex } from '@/server/interchange/model';
import { logError } from '@/server/log';
import { mailTransport } from '@/server/mail/transport';
import { createNotification } from './notifications';
import { listProjects } from './projects';
import { userReminderPrefsMap } from './reminder-preferences';
import { deepLink } from './shell';

type Q = DB | Tx;

/** Stages whose records are not reminded (a closed or cancelled project). */
const ENDED_STAGES = ['clos', 'annule'] as const;

/**
 * Every open item with a due date in the run's window (OVERDUE_LOOKBACK_DAYS back, the largest offset ahead) and a responsible
 * person, on the projects still running. Exported for the tests and the notes.
 */
export async function collectDueItems(today: string, q?: Q): Promise<DueItem[]> {
  const db = q ?? (await getDb());
  const { from, to } = dueWindow(today);
  const live = notInArray(projects.stage, [...ENDED_STAGES]);
  const items: DueItem[] = [];

  // Tasks: the assignee (a contract role without a person is nobody's yet).
  const taskRows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, due: tasks.dueDate, person: tasks.assigneePersonId, code: projects.code })
    .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(live, ne(tasks.status, 'done'), isNotNull(tasks.assigneePersonId), gte(tasks.dueDate, from), lte(tasks.dueDate, to)));
  for (const r of taskRows)
    items.push({ kind: 'task', id: r.id, projectCode: r.code, ref: r.number, title: r.title, dueOn: r.due, personIds: [r.person!], screen: 'task', params: { taskId: r.number } });

  // Plan activities that need work (not a milestone, not complete): the owner and the people named on the assignments.
  const actRows = await db
    .select({ id: activities.id, code: activities.code, name: activities.name, finish: activities.finishDate, owner: activities.ownerPersonId, project: projects.code })
    .from(activities).innerJoin(projects, eq(projects.id, activities.projectId))
    .where(and(live, lt(activities.percentComplete, 100), eq(activities.finishActual, false), sqlPositive(activities.durationDays), gte(activities.finishDate, from), lte(activities.finishDate, to)));
  const assigned = actRows.length
    ? await db.select({ a: activityAssignments.activityId, p: activityAssignments.personId }).from(activityAssignments)
      .where(and(inArray(activityAssignments.activityId, actRows.map((r) => r.id)), isNotNull(activityAssignments.personId)))
    : [];
  const byAct = new Map<string, string[]>();
  for (const x of assigned) byAct.set(x.a, [...(byAct.get(x.a) ?? []), x.p!]);
  for (const r of actRows) {
    const personIds = [...new Set([...(r.owner ? [r.owner] : []), ...(byAct.get(r.id) ?? [])])];
    if (personIds.length) items.push({ kind: 'activity', id: r.id, projectCode: r.project, ref: r.code, title: r.name, dueOn: r.finish!, personIds, screen: 'plan', params: { sel: r.code } });
  }

  // Schedule milestones not done: the PM of record. Date: the linked activity's finish, else the date the schedule draws.
  const anchor = alias(activities, 'anchor');
  const msRows = await db
    .select({
      id: milestones.id, name: milestones.name, forecast: milestones.forecastMonth, anchorFinish: anchor.finishDate, project: projects.code, pm: projects.pmPersonId,
      controlsStart: projectControls.startMonth, projectStart: projects.startMonth, plannedStart: projects.plannedStartDate,
    })
    .from(milestones).innerJoin(projects, eq(projects.id, milestones.projectId))
    .leftJoin(anchor, eq(anchor.id, milestones.activityId))
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(and(live, ne(milestones.status, 'done'), isNotNull(projects.pmPersonId)));
  for (const r of msRows) {
    const start = r.controlsStart ?? (r.projectStart != null ? Math.floor(r.projectStart) : r.plannedStart ? Math.floor(monthIndex(r.plannedStart)) : null);
    const due = r.anchorFinish ?? (start != null ? monthIso(start + r.forecast) : null);
    if (!due || due < from || due > to) continue;
    items.push({ kind: 'milestone', id: r.id, projectCode: r.project, ref: r.name, title: r.name, dueOn: due, personIds: [r.pm!], screen: 'schedule', params: {} });
  }

  // Deliverables still to issue (planned, in progress, internal review, rejected): R of the RACI, else the PM of record.
  const raciR = alias(deliverableRaci, 'raci_r');
  const dlvRows = await db
    .select({ id: deliverables.id, number: deliverables.number, title: deliverables.title, due: deliverables.dueOn, r: raciR.personId, pm: projects.pmPersonId, project: projects.code })
    .from(deliverables).innerJoin(projects, eq(projects.id, deliverables.projectId))
    .leftJoin(raciR, and(eq(raciR.deliverableId, deliverables.id), eq(raciR.role, 'R')))
    .where(and(live, inArray(deliverables.status, ['planned', 'in_progress', 'internal_review', 'rejected']), gte(deliverables.dueOn, from), lte(deliverables.dueOn, to)));
  for (const r of dlvRows) {
    const person = r.r ?? r.pm;
    if (person) items.push({ kind: 'deliverable', id: r.id, projectCode: r.project, ref: r.number, title: r.title, dueOn: r.due, personIds: [person], screen: 'quality', params: { qTab: 'dlv', dlv: r.number } });
  }

  // Meeting actions not done, with an owner who is a person, and no task made of them ("Send minutes": the task is reminded).
  const actionRows = await db
    .select({ id: meetingLines.id, text: meetingLines.text, due: meetingLines.dueDate, owner: meetingLines.ownerPersonId, meeting: meetings.number, type: meetings.type, project: projects.code })
    .from(meetingLines)
    .innerJoin(meetingAgendaPoints, eq(meetingAgendaPoints.id, meetingLines.agendaPointId))
    .innerJoin(meetings, eq(meetings.id, meetingAgendaPoints.meetingId))
    .innerJoin(projects, eq(projects.id, meetings.projectId))
    .where(and(live, eq(meetingLines.type, 'action'), eq(meetingLines.done, false), isNotNull(meetingLines.ownerPersonId), isNull(meetingLines.taskId), gte(meetingLines.dueDate, from), lte(meetingLines.dueDate, to)));
  for (const r of actionRows)
    items.push({
      kind: 'meeting_action', id: r.id, projectCode: r.project, ref: r.meeting, title: r.text, dueOn: r.due!, personIds: [r.owner!], screen: 'meetings', params: { meeting: r.meeting },
      meetingType: r.type,
    });

  // Client prerequisites still pending: the PM of record (R-121 adds its J-15 alert; these are the J-n reminders of the date).
  const preRows = await db
    .select({ id: sitePrerequisites.id, title: sitePrerequisites.title, activity: sitePrerequisites.activityCode, due: sitePrerequisites.neededBy, position: sitePrerequisites.position, pm: projects.pmPersonId, project: projects.code })
    .from(sitePrerequisites).innerJoin(projects, eq(projects.id, sitePrerequisites.projectId))
    .where(and(live, eq(sitePrerequisites.status, 'pending'), isNotNull(projects.pmPersonId), gte(sitePrerequisites.neededBy, from), lte(sitePrerequisites.neededBy, to)));
  for (const r of preRows)
    items.push({ kind: 'prerequisite', id: r.id, projectCode: r.project, ref: r.activity, title: r.title, dueOn: r.due, personIds: [r.pm!], screen: 'site', params: { prereq: r.position } });

  return items.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.projectCode.localeCompare(b.projectCode) || a.ref.localeCompare(b.ref) || a.kind.localeCompare(b.kind));
}

/** durationDays > 0 (an activity of zero duration is a milestone, reminded as a milestone). */
const sqlPositive = (c: typeof activities.durationDays) => gte(c, 1);

/** A person who can be reminded: an active user account, its roles, its organisation (client), its address. */
export interface Recipient {
  userId: string;
  personId: string;
  name: string;
  /** persons.short_name ("R. Aubert"). */
  short: string;
  email: string | null;
  roles: RoleKey[];
  organisation: string | null;
}

/** The active user accounts of `personIds` (person id → recipient). E-mail: the sign-in address, else the person's. */
export async function recipientsOf(personIds: readonly string[], q?: Q): Promise<Map<string, Recipient>> {
  const db = q ?? (await getDb());
  if (!personIds.length) return new Map();
  const org = alias(clients, 'user_org');
  const rows = await db
    .select({ userId: users.id, personId: users.personId, roles: users.roles, email: users.email, personEmail: persons.email, full: persons.fullName, short: persons.shortName, org: org.name })
    .from(users).innerJoin(persons, eq(persons.id, users.personId)).leftJoin(org, eq(org.id, users.clientId))
    .where(and(eq(users.active, true), inArray(users.personId, [...new Set(personIds)])));
  return new Map(rows.map((r) => [r.personId, {
    userId: r.userId, personId: r.personId, name: r.full ?? r.short, short: r.short, email: r.email || r.personEmail || null, roles: sortRoles(r.roles), organisation: r.org,
  }]));
}

/**
 * Who may receive which item (R-041, R-042, R-043): a person holding an internal role receives every item of a running project
 * (an internal role opens any project read-only); a client only the items of their organisation's projects that their portal
 * shows (`clientSeesTarget`), never an internal meeting's action.
 */
export async function receiveRule(): Promise<(r: Recipient, item: DueItem) => boolean> {
  const projectRows = await listProjects();
  const byCode = new Map(projectRows.map((p) => [p.code, p]));
  return (r, item) => {
    const p = byCode.get(item.projectCode);
    if (!p) return false;
    if (r.roles.some((role) => role !== 'client')) return true;
    if (!r.roles.length) return false;
    const own = !clientRefusedProject({ role: 'client', organisation: r.organisation }, p);
    if (!own) return false;
    if (item.kind === 'meeting_action' && !clientSeesMeeting(item.meetingType ?? 'internal')) return false;
    return clientSeesTarget(item.screen as ScreenId, item.params, own);
  };
}

export interface ReminderRun {
  today: string;
  /** Items with a due date in the window. */
  items: number;
  /** Reminders claimed by this run (one per person and item). */
  reminders: number;
  /** Persons notified (one bell notice each). */
  persons: number;
  /** E-mails written by the transport, failed, and not sent (the person's choice, no transport, no address). */
  emailed: number;
  emailFailed: number;
  emailSkipped: number;
}

/** Keystone's address + the screen's link ("https://pm.epc2i.fr/projects/HLT-026/plan?act=A1250"). */
export const absoluteLink = (screen: string, params: Record<string, unknown>, projectCode: string | null) =>
  `${getConfig().mail.publicUrl}${deepLink(screen as ScreenId, params, projectCode ?? undefined)}`;

/** One run at the business date (`on`: tests). Idempotent (see the file header). */
export async function runDeadlineReminders(on?: string): Promise<ReminderRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const items = await collectDueItems(today, db);
  const run: ReminderRun = { today, items: items.length, reminders: 0, persons: 0, emailed: 0, emailFailed: 0, emailSkipped: 0 };
  if (!items.length) return run;
  const recipients = await recipientsOf(items.flatMap((i) => i.personIds), db);
  const prefsByUser = await userReminderPrefsMap([...recipients.values()].map((r) => r.userId), db);
  const prefsOf = (personId: string): ReminderPrefs | null => {
    const r = recipients.get(personId);
    return r ? prefsByUser.get(r.userId) ?? null : null;
  };
  const may = await receiveRule();
  const planned = planReminders(items, today, prefsOf, (personId, item) => may(recipients.get(personId)!, item));
  if (!planned.length) return run;

  // 1. The claim: rows that already exist (sent before) come back empty.
  const keyOf = (p: PlannedReminder) => reminderSendKey(p.personId, p.item, p.slot.slot);
  const claimed = await claimSends(planned.map(keyOf), 'reminder', today);
  const mine = planned.filter((p) => claimed.has(sendKeyText(keyOf(p))));
  run.reminders = mine.length;

  // 2. One reminder per person.
  const t = makeT('fr');
  const dt = (s: string) => dataText(s, 'fr');
  const transport = mailTransport();
  for (const [personId, list] of groupByPerson(mine)) {
    const r = recipients.get(personId)!;
    const prefs = prefsOf(personId)!;
    let code: string | null = null;
    try {
      const target = reminderTarget(list);
      code = await createNotification({
        kind: list.some((p) => p.slot.overdue) ? 'alert' : 'task', title: REMINDER_NOTICE_TITLE, sub: reminderNoticeSub(list), screen: target.screen, params: target.params,
        projectCode: target.projectCode, audience: r.roles, toPersonIds: [personId], email: false,
      });
      run.persons++;
    } catch (e) {
      logError('runDeadlineReminders', e, { personId });
    }
    const mail = await sendReminderMail(r, prefs, list, today, transport, { t, dt });
    if (mail.status === 'sent') run.emailed++;
    else if (mail.status === 'failed') run.emailFailed++;
    else run.emailSkipped++;
    await recordSendOutcome(list.map(keyOf), code, mail);
  }
  return run;
}

export type MailOutcome = { status: 'sent' | 'off' | 'no_transport' | 'no_address' | 'failed'; error?: string };

async function sendReminderMail(
  r: Recipient, prefs: ReminderPrefs, list: readonly PlannedReminder[], today: string, transport: ReturnType<typeof mailTransport>, tr: { t: (s: string) => string; dt: (s: string) => string },
): Promise<MailOutcome> {
  if (!prefs.emailReminders) return { status: 'off' };
  if (transport.mode === 'none') return { status: 'no_transport' };
  if (!r.email) return { status: 'no_address' };
  try {
    const m = reminderMail(r.name, list, today, (p) => absoluteLink(p.item.screen, p.item.params, p.item.projectCode), absoluteLink('mywork', {}, null), tr);
    const sent = await transport.send({ to: r.email, toName: r.name, subject: m.subject, text: m.body });
    return sent.status === 'sent' ? { status: 'sent' } : sent.status === 'failed' ? { status: 'failed', error: sent.error } : { status: 'no_transport' };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

export type SendKey = { personId: string; itemKey: string; slot: string; occurrence: string };

/** Inserts the send rows; returns the keys this run claimed (`sendKeyText`; a conflict = already sent). */
export async function claimSends(keys: readonly SendKey[], kind: 'reminder' | 'report' | 'digest' | 'alert', today: string): Promise<Set<string>> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const got = new Set<string>();
    for (let i = 0; i < keys.length; i += 200) {
      const rows = keys.slice(i, i + 200).map((k) => ({ ...k, kind, runOn: today }));
      const back = await tx.insert(reminderSends).values(rows).onConflictDoNothing({ target: [reminderSends.personId, reminderSends.itemKey, reminderSends.slot, reminderSends.occurrence] })
        .returning({ personId: reminderSends.personId, itemKey: reminderSends.itemKey, slot: reminderSends.slot, occurrence: reminderSends.occurrence });
      for (const b of back) got.add(sendKeyText(b));
    }
    return got;
  });
}

/** Writes the notice code and the e-mail outcome on claimed rows. */
export async function recordSendOutcome(keys: readonly SendKey[], code: string | null, mail: MailOutcome): Promise<void> {
  if (!keys.length) return;
  const db = await getDb();
  try {
    await db.update(reminderSends).set({ notificationCode: code, emailStatus: mail.status, emailError: mail.error?.slice(0, 500) ?? null }).where(or(...keys.map((k) =>
      and(eq(reminderSends.personId, k.personId), eq(reminderSends.itemKey, k.itemKey), eq(reminderSends.slot, k.slot), eq(reminderSends.occurrence, k.occurrence)))));
  } catch (e) {
    logError('recordSendOutcome', e, { count: keys.length });
  }
}
