// The bell of the shell (docs/spec/01 §5.5): the viewer's notifications, translated, in the page header (> 1024 px) and in
// the top bar (≤ 1024 px). Loaded on the server, rendered by the Notifications island. The read marks of the session live
// in the ShellProvider, so both copies agree.
import { getConfig } from '@/server/config';
import { fieldsText } from '@/i18n/data-text';
import { notificationsFor } from '@/server/dal/shell';
import { getI18n, getViewer } from '@/server/session';
import { Notifications } from './header-islands';

/** The bell, its notifications loaded (awaited by the caller: no async component in the tree). */
export async function shellBell() {
  const [{ t, lang }, viewer] = await Promise.all([getI18n(), getViewer()]);
  const rawNotifs = await notificationsFor(viewer);
  // R-148: a notification's sub-line joins typed fields (titles, people) with Keystone's amounts and dates.
  const notifs = rawNotifs.map((n) => ({ ...n, title: t(n.title), sub: fieldsText(n.sub, t, lang), when: t(n.when) }));
  return <Notifications items={notifs} role={viewer.role} emailOn={getConfig().mail.transport !== 'none'} />;
}
