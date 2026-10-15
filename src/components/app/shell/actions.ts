'use server';
// Shell server functions: global search (docs/spec/01 §5.4) and the notification read state (§5.5), persisted per
// user (the signed-in user, or the demo persona's user) in the database.
import { searchShell } from '@/server/dal/shell';
import { searchHitView } from './search-view';
import { markAllNotificationsRead, markNotificationRead } from '@/server/dal/notifications';
import { getI18n, getViewer } from '@/server/session';
import type { SearchHitView } from './types';

/**
 * Global search hits for `query` (≥ 2 chars) in the viewer's language. `code` = current project. R-148: what people typed
 * (titles, names) is shown as typed; only Keystone's own labels (kind, statuses, categories, dates) are translated.
 */
export async function searchAction(query: string, code: string): Promise<SearchHitView[]> {
  if (typeof query !== 'string' || typeof code !== 'string') return [];
  const [{ t, lang }, viewer] = await Promise.all([getI18n(), getViewer()]);
  const hits = await searchShell(query.slice(0, 120), code.slice(0, 32), viewer);
  return hits.map((h) => searchHitView(h, t, lang));
}

/** Opening a notification marks it read for the viewer only. Unknown ids are ignored. */
export async function markNotificationReadAction(id: string): Promise<void> {
  if (typeof id !== 'string' || !/^n\d{1,6}$/.test(id)) return;
  const viewer = await getViewer();
  await markNotificationRead(viewer, id);
}

/** "Mark all read": every notification of the viewer. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const viewer = await getViewer();
  await markAllNotificationsRead(viewer);
}
