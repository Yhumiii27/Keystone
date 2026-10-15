// Client communication log (chapter 4; Site › "Client communication log", Keystone-owned — docs/spec/00 D-5): every
// exchange with the client of a project (date, channel, direction, client contact, subject, summary) and its follow-up
// (owner, due date, done). Pure rules; every default the chapter-5 questionnaire may change is a constant here.
// D-5 (owner's answer "a": use the project's meetings and decisions): the log is retired from the Site screen — its
// drawer and Server Functions are removed, the Site button opens the client decisions of the project meetings. These
// rules, the table and its DAL (src/server/dal/client-comms.ts) stay until the owner confirms deleting the data.
import type { RoleKey } from '@/config/screens';
import { clientCommChannel, clientCommDirection, type ClientCommChannel, type ClientCommDirection } from '@/server/db/codes';

/** Channels in the form's order (codes; labels from the codec). */
export const CLIENT_COMM_CHANNELS: readonly ClientCommChannel[] = ['email', 'phone', 'meeting', 'video', 'site_visit', 'letter', 'other'];
export const CLIENT_COMM_DIRECTIONS: readonly ClientCommDirection[] = ['outbound', 'inbound'];

/** Defaults of a new entry: an e-mail to the client, dated the status date (the frozen "today"). */
export const DEFAULT_CLIENT_COMM_CHANNEL: ClientCommChannel = 'email';
export const DEFAULT_CLIENT_COMM_DIRECTION: ClientCommDirection = 'outbound';

/**
 * Who may read the log: everyone who can open the project's Site screen except a client contact (the summaries are
 * internal notes about the client).
 */
export const canReadClientLog = (role: RoleKey) => role !== 'client';

/**
 * Who may log an exchange and tick its follow-up: whoever may edit the project's Site (Site in their workspace, project
 * not read-only — the PM on their projects, the director, department heads and team members on site).
 */
export const canWriteClientLog = (role: RoleKey, canEditSite: boolean) => canReadClientLog(role) && canEditSite;

export const CLIENT_COMM_LIMITS = { contact: 120, subject: 200, summary: 4000, owner: 120 } as const;

export interface ClientCommForm {
  occurredOn: string;
  channel: ClientCommChannel;
  direction: ClientCommDirection;
  contactName: string;
  subject: string;
  summary: string;
  followUpOwner: string | null;
  followUpDueOn: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v: string) => ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Validates the raw form values (strings). `team` = the follow-up owners offered (the project manager and the project team);
 * an owner outside it is refused. A follow-up needs both an owner and a due date, on or after the exchange. EN errors.
 */
export function parseClientCommForm(raw: Record<string, unknown>, team: readonly string[]): { ok: true; value: ClientCommForm } | { ok: false; error: string } {
  const occurredOn = str(raw.occurredOn, 10);
  if (!isIsoDate(occurredOn)) return { ok: false, error: 'Enter the date of the exchange' };
  const channel = str(raw.channel, 20);
  if (!clientCommChannel.isCode(channel)) return { ok: false, error: 'Unknown channel' };
  const direction = str(raw.direction, 20) || DEFAULT_CLIENT_COMM_DIRECTION;
  if (!clientCommDirection.isCode(direction)) return { ok: false, error: 'Unknown direction' };
  const contactName = str(raw.contactName, CLIENT_COMM_LIMITS.contact);
  if (!contactName) return { ok: false, error: 'Enter the client contact' };
  const subject = str(raw.subject, CLIENT_COMM_LIMITS.subject);
  if (!subject) return { ok: false, error: 'Enter a subject' };
  const summary = str(raw.summary, CLIENT_COMM_LIMITS.summary);
  const owner = str(raw.followUpOwner, CLIENT_COMM_LIMITS.owner) || null;
  const due = str(raw.followUpDueOn, 10) || null;
  if (owner && !team.includes(owner)) return { ok: false, error: 'Choose the follow-up owner in the project team' };
  if (due && !isIsoDate(due)) return { ok: false, error: 'Invalid follow-up date' };
  if (!!owner !== !!due) return { ok: false, error: 'A follow-up needs an owner and a due date' };
  if (due && due < occurredOn) return { ok: false, error: 'The follow-up cannot be due before the exchange' };
  return { ok: true, value: { occurredOn, channel, direction, contactName, subject, summary, followUpOwner: owner, followUpDueOn: due } };
}

/** Follow-up state of an exchange at `today` (ISO). */
export function followUpState(c: { followUpDueOn: string | null; followUpDone: boolean }, today: string): 'none' | 'done' | 'overdue' | 'open' {
  if (!c.followUpDueOn) return 'none';
  if (c.followUpDone) return 'done';
  return c.followUpDueOn < today ? 'overdue' : 'open';
}

/** "3 exchanges · 1 follow-up open" counts. */
export function clientLogCounts(rows: readonly { followUpDueOn: string | null; followUpDone: boolean }[]): { exchanges: number; openFollowUps: number } {
  return { exchanges: rows.length, openFollowUps: rows.filter((r) => r.followUpDueOn && !r.followUpDone).length };
}
