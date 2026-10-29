// R-199 (owner's validation of 29 Oct 2026) — deadline reminders and scheduled reports, pure rules. The jobs
// (src/server/jobs: `deadline-reminders`, `scheduled-reports`) read the records and send; everything decided here takes the
// business date `today` as a parameter (R-013: never a frozen date, never a default date).
//
// Reminders
// - What is reminded: the open records Keystone owns that carry a due date and a responsible person — tasks (assignee),
//   plan activities (owner and named assignees), schedule milestones (PM of record), deliverables (R of the RACI, else the PM of
//   record), meeting actions (owner; not when "Send minutes" made a task of it — the task is reminded), client prerequisites
//   (PM of record).
// - When (`reminderSlot`): each person chooses the offsets (default J-7 and J-1, `DEFAULT_REMINDER_PREFS`); an item is reminded
//   once per window — at J-7, then at J-1 — and once when overdue. A window missed (worker stopped, item created inside it) is
//   caught up at the next run inside it: the window is the smallest offset at or above the days left. Overdue items are
//   reminded once, up to OVERDUE_LOOKBACK_DAYS after their due date (an old backlog is not mailed on the first run).
// - Idempotency (`reminderSendKey`): one send row per person, item, window and due date — a re-run, a second worker or a
//   restart sends nothing twice; a due date moved restarts the windows.
// - One reminder per person and run (`reminderDigest`): one bell notice listing the items, and one e-mail when the person
//   kept e-mail reminders on and a transport is configured.
//
// Reports
// - Weekly (`reportPeriodKey`, ISO week): the project status report (R-131, steering audience) to each lead of each active
//   project (PM of record, co-PMs, deputies), and the portfolio overview to the directors. Sent by the first run of the week —
//   Monday at the reminders hour; a Monday missed is caught up the next morning, never twice in a week.
import { addDaysIso, daysBetweenIso, shortDateOfIso } from '@/server/db/codes';
import { DEFAULT_NOTIFICATION_MODES, formOfModes, modesOfForm, modesLabel, normaliseModes, sameModes, type NotificationModes } from './notification-mail';

// ── Preferences ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReminderPrefs {
  /** E-mail copy of the deadline reminders (the bell notice is always sent). */
  emailReminders: boolean;
  /** E-mail copy of the weekly reports (the bell notice is always sent). */
  emailReports: boolean;
  /** Days before the due date, largest first ([7, 1] = J-7 and J-1). */
  offsets: number[];
  /** Remind once when the due date has passed. */
  overdue: boolean;
  /** R-036: the e-mail of the other bell notifications, per family (src/domain/notification-mail.ts). */
  notifications: NotificationModes;
}

/** Keystone's default until the director changes it in Settings (app setting `reminders.defaults`). */
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  emailReminders: true, emailReports: true, offsets: [7, 1], overdue: true, notifications: { ...DEFAULT_NOTIFICATION_MODES },
};

/** Offsets a person may choose (days before the due date). */
export const OFFSET_RANGE = { min: 0, max: 30, count: 4 } as const;

/** Overdue items older than this are not reminded (the first run on a database with an old backlog stays quiet). */
export const OVERDUE_LOOKBACK_DAYS = 30;

/** The offset choices offered by the preferences form (value = the offsets, comma-separated). */
export const OFFSET_PRESETS: readonly string[] = ['7,1', '14,7,1', '7,3,1', '3,1', '7', '1'];

/** "7,1" / "J-7, J-1" / [7, 1] → [7, 1] (unique, largest first); null when invalid (out of range, none, too many). */
export function parseOffsets(raw: unknown): number[] | null {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\s]+/).filter(Boolean) : null;
  if (!parts || !parts.length) return null;
  const out = new Set<number>();
  for (const p of parts) {
    const s = String(p).trim().replace(/^J-/i, '');
    if (!/^\d{1,2}$/.test(s)) return null;
    const n = Number(s);
    if (n < OFFSET_RANGE.min || n > OFFSET_RANGE.max) return null;
    out.add(n);
  }
  if (out.size > OFFSET_RANGE.count) return null;
  return [...out].sort((a, b) => b - a);
}

/** [7, 1] → "J-7 · J-1" (the same in French). */
export const offsetsLabel = (offsets: readonly number[]) => offsets.map((o) => `J-${o}`).join(' · ');

/** A stored preferences value (jsonb or row) → valid preferences, each missing or invalid field from `fallback`. */
export function normalisePrefs(v: unknown, fallback: ReminderPrefs = DEFAULT_REMINDER_PREFS): ReminderPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  return {
    emailReminders: bool(o.emailReminders, fallback.emailReminders),
    emailReports: bool(o.emailReports, fallback.emailReports),
    offsets: parseOffsets(o.offsets) ?? [...fallback.offsets],
    overdue: bool(o.overdue, fallback.overdue),
    notifications: normaliseModes(o.notifications, fallback.notifications ?? DEFAULT_NOTIFICATION_MODES),
  };
}

/**
 * Form values ("on" / "off", offsets preset, a mode per notification family) → preferences; null when a value is not one the form
 * offers. A notification family left out keeps `fallback` (R-036).
 */
export function prefsOfForm(v: Record<string, unknown>, fallback: NotificationModes = DEFAULT_NOTIFICATION_MODES): ReminderPrefs | null {
  const onOff = (x: unknown) => (x === 'on' ? true : x === 'off' ? false : null);
  const emailReminders = onOff(v.emailReminders);
  const emailReports = onOff(v.emailReports);
  const overdue = onOff(v.overdue);
  const offsets = parseOffsets(v.offsets);
  const notifications = modesOfForm(v, fallback);
  if (emailReminders == null || emailReports == null || overdue == null || !offsets || !notifications) return null;
  return { emailReminders, emailReports, offsets, overdue, notifications };
}

/** Preferences → the form's values. */
export const formOfPrefs = (p: ReminderPrefs): Record<string, string> => ({
  emailReminders: p.emailReminders ? 'on' : 'off', emailReports: p.emailReports ? 'on' : 'off', offsets: p.offsets.join(','), overdue: p.overdue ? 'on' : 'off',
  ...formOfModes(p.notifications),
});

/** The fields that differ (audit before / after, R-168). */
export function prefsChanges(before: ReminderPrefs, after: ReminderPrefs): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of ['emailReminders', 'emailReports', 'overdue'] as const) if (before[k] !== after[k]) [b[k], a[k]] = [before[k], after[k]];
  if (before.offsets.join(',') !== after.offsets.join(',')) [b.offsets, a.offsets] = [offsetsLabel(before.offsets), offsetsLabel(after.offsets)];
  if (!sameModes(before.notifications, after.notifications)) [b.notifications, a.notifications] = [modesLabel(before.notifications), modesLabel(after.notifications)];
  return Object.keys(a).length ? { before: b, after: a } : null;
}

// ── Due items ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type DueItemKind = 'task' | 'activity' | 'milestone' | 'deliverable' | 'meeting_action' | 'prerequisite';

/** EN labels (FR in src/i18n/extra/d9-reminders.json). */
export const DUE_ITEM_KIND_LABEL: Record<DueItemKind, string> = {
  task: 'Task', activity: 'Activity', milestone: 'Milestone', deliverable: 'Deliverable', meeting_action: 'Meeting action', prerequisite: 'Client prerequisite',
};

export interface DueItem {
  kind: DueItemKind;
  /** The record's id (uuid). */
  id: string;
  projectCode: string;
  /** Reference shown ("T-2314", "A1250", "D-021", "MTG-118"; a milestone's name). */
  ref: string;
  /** As typed (shown with dataText). */
  title: string;
  /** ISO due date. */
  dueOn: string;
  /** Responsible persons (persons.id). */
  personIds: string[];
  /** Where the bell notice and the e-mail link open (src/config/screens.ts) and its parameters (deepLink). */
  screen: string;
  params: Record<string, unknown>;
  /** Meeting actions: the meeting's type (a client never receives an internal meeting's action, P-10b). */
  meetingType?: string;
}

/** Window of a reminder: "J-7" (days-before window) or "overdue". */
export type ReminderSlot = { slot: string; daysLeft: number; overdue: boolean };

/** Earliest due date a run looks at, and the latest (the largest offset any person may choose). */
export const dueWindow = (today: string) => ({ from: addDaysIso(today, -OVERDUE_LOOKBACK_DAYS), to: addDaysIso(today, OFFSET_RANGE.max) });

/**
 * The window `dueOn` is in at `today` for these preferences, or null (too early, or overdue and not reminded). Days left = 0
 * (due today) belongs to the smallest window (J-1 by default).
 */
export function reminderSlot(dueOn: string, today: string, prefs: Pick<ReminderPrefs, 'offsets' | 'overdue'>): ReminderSlot | null {
  const daysLeft = daysBetweenIso(today, dueOn);
  if (daysLeft < 0) return prefs.overdue && -daysLeft <= OVERDUE_LOOKBACK_DAYS ? { slot: 'overdue', daysLeft, overdue: true } : null;
  const fits = prefs.offsets.filter((o) => o >= daysLeft);
  if (!fits.length) return null;
  return { slot: `J-${Math.min(...fits)}`, daysLeft, overdue: false };
}

/** The idempotency key of one reminder: person + item + window + due date (the unique key of `reminder_sends`). */
export const reminderSendKey = (personId: string, item: Pick<DueItem, 'kind' | 'id' | 'dueOn'>, slot: string) => ({
  personId, itemKey: `${item.kind}:${item.id}`, slot, occurrence: item.dueOn,
});

export interface PlannedReminder {
  personId: string;
  item: DueItem;
  slot: ReminderSlot;
}

/**
 * The reminders due at `today`: for each item, each responsible person who may receive it (`mayReceive`) and whose window it is
 * in — not yet sent (`sent` holds the keys already in the send log, `${personId}|${itemKey}|${slot}|${occurrence}`).
 */
export function planReminders(
  items: readonly DueItem[], today: string, prefsOf: (personId: string) => ReminderPrefs | null, mayReceive: (personId: string, item: DueItem) => boolean,
  sent: ReadonlySet<string> = new Set(),
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const personId of new Set(item.personIds)) {
      const prefs = prefsOf(personId);
      if (!prefs) continue;
      const slot = reminderSlot(item.dueOn, today, prefs);
      if (!slot) continue;
      const k = sendKeyText(reminderSendKey(personId, item, slot.slot));
      if (seen.has(k) || sent.has(k)) continue;
      if (!mayReceive(personId, item)) continue;
      seen.add(k);
      out.push({ personId, item, slot });
    }
  }
  return out;
}

/** "person|item|slot|occurrence" — the key of a send as one string. */
export const sendKeyText = (k: { personId: string; itemKey: string; slot: string; occurrence: string }) => `${k.personId}|${k.itemKey}|${k.slot}|${k.occurrence}`;

/** Reminders grouped by person (one reminder per person and run), each person's items overdue first, then by due date. */
export function groupByPerson(planned: readonly PlannedReminder[]): Map<string, PlannedReminder[]> {
  const by = new Map<string, PlannedReminder[]>();
  for (const p of planned) by.set(p.personId, [...(by.get(p.personId) ?? []), p]);
  for (const list of by.values()) list.sort((a, b) => a.slot.daysLeft - b.slot.daysLeft || a.item.projectCode.localeCompare(b.item.projectCode) || a.item.ref.localeCompare(b.item.ref));
  return by;
}

// ── Rights (R-041, R-042, R-043) ─────────────────────────────────────────────────────────────────────────────────

/**
 * A person may receive an item: an internal role opens every screen (read-only outside its workspace), on a project that is not
 * refused; a client only what their own portal shows — a screen of the client workspace, never an internal meeting's action
 * (`clientSees` = clientSeesTarget and clientSeesMeeting).
 */
export function mayReceiveItem(
  holder: { internal: boolean; refused: boolean },
  clientSees: boolean,
): boolean {
  if (holder.refused) return false;
  return holder.internal || clientSees;
}

// ── Bell notice and e-mail of a reminder ─────────────────────────────────────────────────────────────────────────

/** Fixed EN title of the reminder notice (the bell translates it). */
export const REMINDER_NOTICE_TITLE = 'Deadline reminder';
/** Fixed EN titles of the report notices. */
export const PROJECT_REPORT_TITLE = 'Weekly status report';
export const PORTFOLIO_REPORT_TITLE = 'Weekly portfolio report';

/** Bell sub-line of a reminder: the first three references, then "+n" (references shown as typed). */
export function reminderNoticeSub(list: readonly PlannedReminder[]): string {
  const refs = list.map((p) => `${p.item.projectCode} ${p.item.ref}`);
  return [...refs.slice(0, 3), ...(refs.length > 3 ? [`+${refs.length - 3}`] : [])].join(' · ');
}

/** Where a reminder notice opens: the item itself when there is one, else My tasks. */
export function reminderTarget(list: readonly PlannedReminder[]): { screen: string; params: Record<string, unknown>; projectCode: string | null } {
  if (list.length === 1) return { screen: list[0].item.screen, params: list[0].item.params, projectCode: list[0].item.projectCode };
  return { screen: 'mywork', params: {}, projectCode: null };
}

/** "in 7 d", "due today", "3 d late" — EN source strings the French rules translate. */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return daysLeft > 0 ? `in ${daysLeft} d` : `${-daysLeft} d late`;
}

export interface MailText {
  subject: string;
  /** Plain-text body (lines joined with \n). */
  body: string;
}

/** Translators the e-mail models need: t() for Keystone's words, dt() for typed text (dataText). */
export interface MailT {
  t: (english: string) => string;
  dt: (typed: string) => string;
}

const MAIL_FOOT = 'Automatic message from Keystone · change your reminder and report e-mails from the notifications bell › Notifications & reminders';

/**
 * The e-mail of one person's reminders (French by default): greeting, the items overdue then by window, each with its project,
 * reference, title as typed, kind, due date and days left; the link to Keystone; the footer.
 */
export function reminderMail(name: string, list: readonly PlannedReminder[], today: string, link: (p: PlannedReminder) => string, home: string, { t, dt }: MailT): MailText {
  const overdue = list.filter((p) => p.slot.overdue).length;
  const subject = `Keystone — ${t(REMINDER_NOTICE_TITLE)} · ${list.length} ${t(list.length > 1 ? 'items' : 'item')}${overdue ? ` · ${t(`${overdue} overdue`)}` : ''}`;
  const lines: string[] = [`${t('Hello')} ${name},`, '', `${t('Your deadlines in Keystone')} · ${t(shortDateOfIso(today))}`, ''];
  for (const p of list) {
    const i = p.item;
    lines.push(`- ${i.projectCode} · ${i.ref} · ${dt(i.title)}`);
    lines.push(`  ${t(DUE_ITEM_KIND_LABEL[i.kind])} · ${t(`due ${shortDateOfIso(i.dueOn)}`)} · ${t(daysLeftText(p.slot.daysLeft))}`);
    lines.push(`  ${link(p)}`);
  }
  lines.push('', `${t('Open Keystone')}: ${home}`, '', '—', t(MAIL_FOOT));
  return { subject, body: lines.join('\n') };
}

// ── Reports ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** ISO week of a date as "2026-W39" (the year of the week's Thursday). */
export function reportPeriodKey(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export type ReportKind = 'project_weekly' | 'portfolio_weekly';

/** The idempotency key of a report: person + report (+ project) + ISO week. */
export const reportSendKey = (personId: string, kind: ReportKind, projectCode: string | null, today: string) => ({
  personId, itemKey: projectCode ? `${kind}:${projectCode}` : kind, slot: 'weekly', occurrence: reportPeriodKey(today),
});

/** A document's KPI tiles and fields as "label: value" lines (the e-mail body of a report; the PDF / workbook is attached). */
export function summaryLines(blocks: readonly { kind: string; items?: unknown }[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'kpis' && Array.isArray(b.items))
      for (const k of b.items as { label: string; value: string; sub?: string }[]) out.push(`- ${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ''}`);
    else if (b.kind === 'fields' && Array.isArray(b.items))
      for (const [label, value] of b.items as [string, string][]) out.push(`- ${label}: ${value}`);
  }
  return out;
}

/** The e-mail of a report: greeting, what is attached, the summary lines, the link, the footer. */
export function reportMail(
  name: string, r: { title: string; about: string; period: string; lines: readonly string[]; attachment: string; link: string }, { t }: Pick<MailT, 't'>,
): MailText {
  const lines = [
    `${t('Hello')} ${name},`, '', `${r.title} · ${r.about} · ${r.period}`, '', ...r.lines, '', `${t('Attached file')}: ${r.attachment}`, `${t('Open in Keystone')}: ${r.link}`, '', '—', t(MAIL_FOOT),
  ];
  return { subject: `Keystone — ${r.title} · ${r.about} · ${r.period}`, body: lines.join('\n') };
}
