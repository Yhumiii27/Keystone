import 'server-only';
// R-199 / R-036 — reminder and report preferences: the company default (app setting `reminders.defaults`, Settings, the
// portfolio director — A-14) and each user's own choice (`reminder_preferences`, no row = the default). Writers record an audit
// row (R-168: before / after); the company default also an activity line. Rules: src/domain/reminders.ts.
import { eq, inArray } from 'drizzle-orm';
import { DEFAULT_REMINDER_PREFS, normalisePrefs, offsetsLabel, prefsChanges, type ReminderPrefs } from '@/domain/reminders';
import { canEditSettings, SETTINGS_DIRECTOR_ONLY } from '@/domain/settings-rules';
import { getDb } from '@/server/db/client';
import { appSettings, reminderPreferences, users } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { requireWorkspace, trace, whoIs, type Actor } from './ops-common';

type Q = DB | Tx;

export const APP_SETTING_REMINDERS = 'reminders.defaults';

/** The company default (Keystone's own until the director saves one). */
export async function readReminderDefaults(q?: Q): Promise<ReminderPrefs> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_REMINDERS));
  return normalisePrefs(row?.value, DEFAULT_REMINDER_PREFS);
}

const prefsOfRow = (r: typeof reminderPreferences.$inferSelect): ReminderPrefs =>
  normalisePrefs({ emailReminders: r.emailReminders, emailReports: r.emailReports, offsets: r.offsets, overdue: r.overdue });

export interface UserReminderPrefs {
  prefs: ReminderPrefs;
  /** The user chose them (false = the company default applies). */
  own: boolean;
  defaults: ReminderPrefs;
}

/** A user's preferences (their own row, else the company default). */
export async function getUserReminderPrefs(userId: string, q?: Q): Promise<UserReminderPrefs> {
  const db = q ?? (await getDb());
  const defaults = await readReminderDefaults(db);
  const [row] = await db.select().from(reminderPreferences).where(eq(reminderPreferences.userId, userId));
  return { prefs: row ? prefsOfRow(row) : defaults, own: !!row, defaults };
}

/** Preferences of several users at once (the jobs): user id → preferences. */
export async function userReminderPrefsMap(userIds: readonly string[], q?: Q): Promise<Map<string, ReminderPrefs>> {
  const db = q ?? (await getDb());
  const defaults = await readReminderDefaults(db);
  const rows = userIds.length ? await db.select().from(reminderPreferences).where(inArray(reminderPreferences.userId, [...userIds])) : [];
  const own = new Map(rows.map((r) => [r.userId, prefsOfRow(r)]));
  return new Map(userIds.map((id) => [id, own.get(id) ?? defaults]));
}

const describe = (p: ReminderPrefs) =>
  `e-mail reminders ${p.emailReminders ? 'on' : 'off'} · e-mail reports ${p.emailReports ? 'on' : 'off'} · ${offsetsLabel(p.offsets)}${p.overdue ? ' · overdue' : ''}`;

/**
 * Saves a user's own preferences (the signed-in user, or the demo persona's user — `userId` is resolved by the caller from the
 * viewer, never from the request). `reset` removes the row: the company default applies again. Audit row with before / after.
 */
export async function saveUserReminderPrefs(userId: string, prefs: ReminderPrefs | 'reset', actor: Actor & { personId?: string | null }): Promise<UserReminderPrefs> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) throw new Error('Unknown user');
    const cur = await getUserReminderPrefs(userId, tx);
    const next = prefs === 'reset' ? cur.defaults : normalisePrefs(prefs, cur.defaults);
    if (prefs === 'reset') await tx.delete(reminderPreferences).where(eq(reminderPreferences.userId, userId));
    else {
      const values = { emailReminders: next.emailReminders, emailReports: next.emailReports, offsets: next.offsets, overdue: next.overdue, updatedAt: new Date() };
      await tx.insert(reminderPreferences).values({ userId, ...values }).onConflictDoUpdate({ target: reminderPreferences.userId, set: values });
    }
    const diff = prefsChanges(cur.prefs, next);
    if (diff || cur.own !== (prefs !== 'reset')) {
      const who = await whoIs(tx, actor);
      await trace(tx, { ...who, personId: actor.personId ?? who.personId, userId }, {
        objectRef: 'Reminders & reports', change: prefs === 'reset' ? `company default restored · ${describe(next)}` : describe(next), area: 'My preferences',
        entityType: 'reminder_preferences', entityId: userId, before: diff?.before ?? null, after: diff?.after ?? null,
      });
    }
    return getUserReminderPrefs(userId, tx);
  });
}

/** Saves the company default (Settings, the portfolio director — A-14). Audit and activity lines. */
export async function saveReminderDefaults(prefs: ReminderPrefs, actor: Actor): Promise<ReminderPrefs> {
  requireWorkspace('settings', actor, 'Settings');
  if (!canEditSettings(actor.role)) throw new Error(SETTINGS_DIRECTOR_ONLY);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const cur = await readReminderDefaults(tx);
    const next = normalisePrefs(prefs, cur);
    const who = await whoIs(tx, actor);
    await tx.insert(appSettings).values({ key: APP_SETTING_REMINDERS, value: next, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId } });
    const diff = prefsChanges(cur, next);
    if (diff) {
      await trace(tx, who, {
        objectRef: 'Reminders & reports', change: `company default · ${describe(next)}`, area: 'Settings', entityType: 'app_setting', before: diff.before, after: diff.after,
        activity: { text: `Reminders & reports default · ${describe(next)}`, kind: 'change' },
      });
    }
    return next;
  });
}
