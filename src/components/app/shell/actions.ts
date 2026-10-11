'use server';
// Shell server functions: global search (docs/spec/01 §5.4) and the notification read state (§5.5), persisted per
// user (the signed-in user, or the demo persona's user) in the database.
import { searchShell } from '@/server/dal/shell';
import { markAllNotificationsRead, markNotificationRead } from '@/server/dal/notifications';
import { getI18n, getViewer } from '@/server/session';
import type { SearchHitView } from './types';

/** Global search hits for `query` (≥ 2 chars), translated for the viewer's language. `code` = current project. */
export async function searchAction(query: string, code: string): Promise<SearchHitView[]> {
  if (typeof query !== 'string' || typeof code !== 'string') return [];
  const { t } = await getI18n();
  const hits = await searchShell(query.slice(0, 120), code.slice(0, 32));
  return hits.map((h) => ({ kind: t(h.kind), title: t(h.title), sub: t(h.sub), href: h.href }));
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
