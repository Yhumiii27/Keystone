'use server';
// R-199 / R-036 — reminder and report preferences: each viewer reads and changes their own (the notifications bell ›
// "Reminders & reports"; the user is the viewer's — signed-in user or demo persona — never one named by the request), and the
// portfolio director changes the company default (Settings, A-14). Input validated with the domain parser; writes through the DAL
// (audit with before / after; the default also an activity line); then the app is revalidated.
import { revalidatePath } from 'next/cache';
import { formOfPrefs, prefsOfForm } from '@/domain/reminders';
import { canEditSettings, SETTINGS_DIRECTOR_ONLY } from '@/domain/settings-rules';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { getUserReminderPrefs, saveReminderDefaults, saveUserReminderPrefs } from '@/server/dal/reminder-preferences';
import { userIdOf } from '@/server/dal/users';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getViewer } from '@/server/session';

export type ReminderActionResult = { ok: true; toast: string } | { error: string };

export interface MyReminderPreferences {
  /** Form values (src/domain/reminders.ts formOfPrefs) and `apply` = own | default. */
  values: Record<string, string>;
  own: boolean;
  /** The company default, as form values. */
  defaults: Record<string, string>;
  /** KEYSTONE_MAIL_TRANSPORT: none = nothing leaves Keystone yet. */
  transport: 'none' | 'file';
}

const isValues = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 10;

/** The viewer's preferences (null when the viewer has no user account). */
export async function getMyReminderPreferencesAction(): Promise<MyReminderPreferences | null> {
  const viewer = await getViewer();
  const userId = await userIdOf(await getDb(), viewer);
  if (!userId) return null;
  const p = await getUserReminderPrefs(userId);
  return { values: { ...formOfPrefs(p.prefs), apply: p.own ? 'own' : 'default' }, own: p.own, defaults: formOfPrefs(p.defaults), transport: getConfig().mail.transport };
}

/** Saves the viewer's own preferences, or (`apply` = default) goes back to the company default. */
export async function saveMyReminderPreferencesAction(values: unknown): Promise<ReminderActionResult> {
  const [{ t }, viewer] = await Promise.all([getI18n(), getViewer()]);
  if (!isValues(values) || (values.apply !== 'own' && values.apply !== 'default')) return { error: t('Invalid preferences') };
  const prefs = values.apply === 'default' ? 'reset' : prefsOfForm(values);
  if (!prefs) return { error: t('Invalid preferences') };
  const userId = await userIdOf(await getDb(), viewer);
  if (!userId) return { error: t('Invalid request') };
  try {
    await saveUserReminderPrefs(userId, prefs, { name: viewer.name, role: viewer.role, personId: viewer.personId });
  } catch {
    return { error: t('The change could not be saved') };
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: t('Preferences saved') };
}

/** The company default (Settings): the portfolio director only (A-14), re-checked by the DAL. */
export async function saveReminderDefaultsAction(values: unknown): Promise<ReminderActionResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('settings')]);
  if (!access.canEdit) return { error: t('Settings are read-only for you') };
  if (!canEditSettings(access.viewer.role)) return { error: t(SETTINGS_DIRECTOR_ONLY) };
  const prefs = isValues(values) ? prefsOfForm(values) : null;
  if (!prefs) return { error: t('Invalid preferences') };
  try {
    await saveReminderDefaults(prefs, { name: access.viewer.name, role: access.viewer.role });
  } catch {
    return { error: t('The change could not be saved') };
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: t('Default saved') };
}

