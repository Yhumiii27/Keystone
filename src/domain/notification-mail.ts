// R-036 (X-6b « Keystone + e-mail, préférences par utilisateur ») — which bell notifications also leave Keystone by e-mail, and
// how. Pure: the DAL (src/server/dal/notification-mail.ts) reads the records and sends; the business date comes as a parameter.
//
// - Families: every notification kind (src/server/db/codes.ts NotificationKind) belongs to one family the person sets —
//   approvals (approval, eco, request: something waits for their decision or answer), assigned tasks (task), @mentions
//   (mention), alerts and follow-up (alert, quality, delivery, invoice, sync: to know, nothing to decide).
// - Modes per family: an immediate e-mail, the daily digest, or no e-mail. Keystone's default (the company default of Settings
//   overrides it, each person's choice overrides that): immediate for what waits for an action (approvals, tasks, mentions),
//   the digest for the rest (`DEFAULT_NOTIFICATION_MODES`).
// - Clients (an account holding the client role only): what reaches them is sent at once — the digest becomes immediate
//   (R-036 « envoi immédiat … pour les clients »); "no e-mail" stays their choice.
// - The bell always receives the notice; the deadline reminders and weekly reports have their own e-mail (R-199) and are not
//   routed here.
// - State of each recipient's e-mail (notification_recipients.mail_state): chosen when the notice is created
//   (`initialMailState`), then moved by the sender — immediate → sending → sent | failed | no_address | not_visible; digest →
//   digested (or seen: read in the bell before the digest, not mailed) …; off, no_transport are final.
import { shortDateOfIso, type NotificationKind } from '@/server/db/codes';

export type NotificationFamily = 'approvals' | 'tasks' | 'mentions' | 'alerts';
export type NotificationMode = 'immediate' | 'digest' | 'off';
export type NotificationModes = Record<NotificationFamily, NotificationMode>;

export const NOTIFICATION_FAMILIES: readonly NotificationFamily[] = ['approvals', 'tasks', 'mentions', 'alerts'];
export const NOTIFICATION_MODES: readonly NotificationMode[] = ['immediate', 'digest', 'off'];

/** EN labels (FR in src/i18n/extra/d9-notification-mail.json). */
export const NOTIFICATION_FAMILY_LABEL: Record<NotificationFamily, string> = {
  approvals: 'Approvals and answers awaited',
  tasks: 'Tasks assigned to me',
  mentions: 'Mentions (@)',
  alerts: 'Alerts and follow-up',
};
export const NOTIFICATION_MODE_LABEL: Record<NotificationMode, string> = { immediate: 'Immediate e-mail', digest: 'Daily digest', off: 'No e-mail' };

/** The family of each notification kind. */
export const FAMILY_OF_KIND: Record<NotificationKind, NotificationFamily> = {
  approval: 'approvals', eco: 'approvals', request: 'approvals',
  task: 'tasks',
  mention: 'mentions',
  alert: 'alerts', quality: 'alerts', delivery: 'alerts', invoice: 'alerts', sync: 'alerts',
};

/** Keystone's default until the director saves a company default (Settings). */
export const DEFAULT_NOTIFICATION_MODES: NotificationModes = { approvals: 'immediate', tasks: 'immediate', mentions: 'immediate', alerts: 'digest' };

const isMode = (v: unknown): v is NotificationMode => typeof v === 'string' && (NOTIFICATION_MODES as readonly string[]).includes(v);

/** A stored value (jsonb) → valid modes, each missing or invalid family from `fallback`. */
export function normaliseModes(v: unknown, fallback: NotificationModes = DEFAULT_NOTIFICATION_MODES): NotificationModes {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(NOTIFICATION_FAMILIES.map((f) => [f, isMode(o[f]) ? o[f] : fallback[f]])) as NotificationModes;
}

/** Form field of a family ("notifApprovals"). */
export const modeField = (f: NotificationFamily) => `notif${f[0].toUpperCase()}${f.slice(1)}`;

/**
 * Form values → modes: a field left out keeps `fallback` (a form of an older page); a value the form does not offer → null
 * (refused).
 */
export function modesOfForm(v: Record<string, unknown>, fallback: NotificationModes = DEFAULT_NOTIFICATION_MODES): NotificationModes | null {
  const out = { ...fallback };
  for (const f of NOTIFICATION_FAMILIES) {
    const x = v[modeField(f)];
    if (x === undefined) continue;
    if (!isMode(x)) return null;
    out[f] = x;
  }
  return out;
}

export const formOfModes = (m: NotificationModes): Record<string, string> => Object.fromEntries(NOTIFICATION_FAMILIES.map((f) => [modeField(f), m[f]]));

/** "approvals immediate · tasks immediate · mentions digest · alerts off" (audit text). */
export const modesLabel = (m: NotificationModes) => NOTIFICATION_FAMILIES.map((f) => `${f} ${m[f]}`).join(' · ');

export const sameModes = (a: NotificationModes, b: NotificationModes) => NOTIFICATION_FAMILIES.every((f) => a[f] === b[f]);

/** How a notice of `kind` reaches a recipient by e-mail (client accounts: the digest becomes immediate). */
export function mailRoute(kind: NotificationKind, modes: NotificationModes, isClient: boolean): NotificationMode {
  const mode = modes[FAMILY_OF_KIND[kind] ?? 'alerts'];
  return mode === 'digest' && isClient ? 'immediate' : mode;
}

export type MailState = 'immediate' | 'digest' | 'sending' | 'sent' | 'digested' | 'seen' | 'off' | 'no_transport' | 'no_address' | 'not_visible' | 'failed';

/** The e-mail state a new recipient row starts in. */
export function initialMailState(kind: NotificationKind, modes: NotificationModes, isClient: boolean, transport: 'none' | 'file'): MailState {
  const route = mailRoute(kind, modes, isClient);
  if (route === 'off') return 'off';
  if (transport === 'none') return 'no_transport';
  return route;
}

/** A person whose every role is the client's (an internal role opens every project read-only, R-041). */
export const isClientOnly = (roles: readonly string[]) => roles.length > 0 && roles.every((r) => r === 'client');

/** The idempotency key of a person's daily digest (one per person and business date, `reminder_sends`). */
export const digestSendKey = (personId: string, today: string) => ({ personId, itemKey: 'notification_digest', slot: 'daily', occurrence: today });

// ── E-mail texts (French by default, like the reminders) ─────────────────────────────────────────────────────────────

export interface NoticeForMail {
  /** EN template (t() translates it, like the bell). */
  title: string;
  /** Fields joined with " · " (the bell's fieldsText). */
  sub: string;
  projectCode: string | null;
  /** "25 Sep 09:12". */
  when: string;
  link: string;
}

export interface NoticeMailT {
  t: (english: string) => string;
  /** fieldsText bound to the language. */
  fields: (s: string) => string;
}

export const NOTICE_MAIL_FOOT = 'Automatic message from Keystone · change your notification e-mails from the notifications bell › Notifications & reminders';
export const DIGEST_TITLE = 'Daily digest';

/** One notice, sent at once: greeting, the notice as the bell shows it, its project, the link, the footer. */
export function noticeMail(name: string, n: NoticeForMail, { t, fields }: NoticeMailT): { subject: string; body: string } {
  const title = t(n.title);
  const lines = [`${t('Hello')} ${name},`, '', title];
  if (n.sub) lines.push(fields(n.sub));
  if (n.projectCode) lines.push(`${t('Project')} ${n.projectCode}`);
  lines.push('', `${t('Open in Keystone')}: ${n.link}`, '', '—', t(NOTICE_MAIL_FOOT));
  return { subject: `Keystone — ${title}${n.projectCode ? ` · ${n.projectCode}` : ''}`, body: lines.join('\n') };
}

/** The daily digest of one person: the notices not read yet, newest first, each with its project, time and link. */
export function digestMail(name: string, list: readonly NoticeForMail[], today: string, home: string, { t, fields }: NoticeMailT): { subject: string; body: string } {
  const lines = [`${t('Hello')} ${name},`, '', `${t('Your notifications in Keystone')} · ${t(shortDateOfIso(today))}`, ''];
  for (const n of list) {
    lines.push(`- ${n.projectCode ? `${n.projectCode} · ` : ''}${t(n.title)}`);
    if (n.sub) lines.push(`  ${fields(n.sub)}`);
    lines.push(`  ${t(n.when)} · ${n.link}`);
  }
  lines.push('', `${t('Open Keystone')}: ${home}`, '', '—', t(NOTICE_MAIL_FOOT));
  return { subject: `Keystone — ${t(DIGEST_TITLE)} · ${list.length} ${t(list.length > 1 ? 'notifications' : 'notification')}`, body: lines.join('\n') };
}
