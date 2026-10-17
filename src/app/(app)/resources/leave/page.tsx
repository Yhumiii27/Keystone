// Leave & working calendar — /resources/leave (docs/spec/06 §4; template 1477–1502, logic 4398–4404).
// Read-only mirror of the absences Cursus pushes to Keystone (R-031: NEW-CURSUS-4 / NEW-CURSUS-7 "a", Lucca unplugged) —
// two simple types, Leave and Absence, never the reason (R-173) — and the public holidays of Settings, as available
// hours per person over 8 weeks from the current week (R-085, R-7 a: `?week=` slides the window, validated server-side) or,
// `?view=week` (owner answers 17 Oct 2026), one week day by day. No primary action: absences arrive from Cursus by
// themselves (the prototype's "Sync Lucca" is gone, NEW-CURSUS-7).
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { hrT } from '@/features/hr/i18n';
import { LeaveView, LeaveWeekView } from '@/features/hr/leave-view';
import { getLeaveCalendar, getLeaveWeek } from '@/server/dal/hr';
import { getLoadWindow } from '@/server/dal/resources';
import { LoadWindowNav } from '@/features/resources/window-nav';
import { screenHref } from '@/config/screens';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function LeavePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The screen gate (the client and roles without Leave are sent home) runs before anything is read.
  await getScreenAccess('leave');
  const sp = await searchParams;
  const win = await getLoadWindow(sp.week, sp.view);
  const i18n = await getI18n();
  const t = hrT(i18n.t, i18n.lang);
  const nav = <LoadWindowNav window={win} path={screenHref('leave')} t={i18n.t} lang={i18n.lang} />;
  return (
    <>
      <PageHeader screen="leave" />
      <Stack>
        {win.view === 'week' ? (
          <LeaveWeekView data={await getLeaveWeek('FR', win.start)} t={t} lang={i18n.lang} windowNav={nav} />
        ) : (
          <LeaveView data={await getLeaveCalendar('FR', win.weeks)} t={t} windowIsCurrent={win.isCurrent} windowNav={nav} />
        )}
      </Stack>
    </>
  );
}
