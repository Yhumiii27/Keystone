// Leave & working calendar — /resources/leave (docs/spec/06 §4; template 1477–1502, logic 4398–4404).
// Read-only mirror of Lucca: leave, RTT, sick leave, training and public holidays as available hours per person over
// the next 8 weeks. Primary action "Sync Lucca" (AF `leave`).
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { hrT } from '@/features/hr/i18n';
import { LeaveView } from '@/features/hr/leave-view';
import { SyncLuccaButton } from '@/features/hr/primary-buttons';
import { getLeaveCalendar } from '@/server/dal/hr';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function LeavePage() {
  const [i18n, { outside }, data] = await Promise.all([getI18n(), getScreenAccess('leave'), getLeaveCalendar()]);
  const t = hrT(i18n.t, i18n.lang);
  return (
    <>
      <PageHeader screen="leave" primary={outside ? undefined : <SyncLuccaButton />} />
      <Stack>
        <LeaveView data={data} t={t} />
      </Stack>
    </>
  );
}
