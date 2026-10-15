// Leave & working calendar — /resources/leave (docs/spec/06 §4; template 1477–1502, logic 4398–4404).
// Read-only mirror of the absences Cursus pushes to Keystone (R-031: NEW-CURSUS-4 / NEW-CURSUS-7 "a", Lucca unplugged) —
// two simple types, Leave and Absence, never the reason (R-173) — and the public holidays of Settings, as available
// hours per person over the next 8 weeks. No primary action: absences arrive from Cursus by themselves (the prototype's
// "Sync Lucca" is gone, NEW-CURSUS-7).
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { hrT } from '@/features/hr/i18n';
import { LeaveView } from '@/features/hr/leave-view';
import { getLeaveCalendar } from '@/server/dal/hr';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function LeavePage() {
  // The screen gate (the client and roles without Leave are sent home) runs before anything is read.
  await getScreenAccess('leave');
  const [i18n, data] = await Promise.all([getI18n(), getLeaveCalendar()]);
  const t = hrT(i18n.t, i18n.lang);
  return (
    <>
      <PageHeader screen="leave" />
      <Stack>
        <LeaveView data={data} t={t} />
      </Stack>
    </>
  );
}
