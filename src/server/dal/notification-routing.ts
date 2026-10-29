import 'server-only';
// R-036 — the e-mail state each recipient of a new bell notification starts in (src/domain/notification-mail.ts
// initialMailState): their preference for the notice's family (their own, else the company default — reminder_preferences,
// app setting `reminders.defaults`), the client rule (a client account receives at once) and the transport IT configured
// (KEYSTONE_MAIL_TRANSPORT none = nothing will leave: "no_transport" at once). Read inside createNotification's transaction.
// Kept apart from the sender (notification-mail.ts) so createNotification imports no module that imports it back.
import { initialMailState, isClientOnly, type MailState } from '@/domain/notification-mail';
import type { NotificationKind } from '@/server/db/codes';
import { getConfig } from '@/server/config';
import type { DB, Tx } from '@/server/db/types';
import { userReminderPrefsMap } from './reminder-preferences';

/** user id → the e-mail state of its new recipient row. */
export async function mailStatesFor(q: DB | Tx, kind: NotificationKind, recipients: readonly { id: string; roles: readonly string[] }[]): Promise<Map<string, MailState>> {
  if (!recipients.length) return new Map();
  const transport = getConfig().mail.transport;
  const prefs = await userReminderPrefsMap(recipients.map((r) => r.id), q);
  return new Map(recipients.map((r) => [r.id, initialMailState(kind, prefs.get(r.id)!.notifications, isClientOnly(r.roles), transport)]));
}
