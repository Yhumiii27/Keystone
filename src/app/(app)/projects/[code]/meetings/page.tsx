// Meetings & minutes — /projects/[code]/meetings (docs/spec/05 §5, template 753–813, logic 4817–4867).
// URL state (docs/spec/00 §8.3): `?view=meetings|decisions|actions` (Display segment), `?filter=todo|upcoming|sent`
// (status chips), `?meeting=MTG-118` (selected meeting; default = first of the sorted list).
// Primary action "New meeting" (AF `meetings`). Notes, ticks, transcript analysis and "Send minutes" go through
// src/features/meetings/actions.ts; every edit control is hidden when the screen is outside the viewer's workspace
// or the project is read-only for them. Projects without meetings show the empty register (no Harbor Line data).
import { PageHeader } from '@/components/app/shell/page-header';
import { parseMeetingFilter, parseMeetingsView, selectMeeting } from '@/domain/meetings';
import { defaultInvitees, meetingFormDef } from '@/features/meetings/forms';
import { MeetingsBody } from '@/features/meetings/meetings-view';
import { meetingsScreenView } from '@/features/meetings/model';
import { NewMeetingButton } from '@/features/meetings/new-meeting-button';
import { getMeetingsScreen } from '@/server/dal/meetings-screen';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MeetingsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'meetings');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getMeetingsScreen(projectCode)]);
  const canEdit = ctx.canEdit('meetings');

  const requested = first(sp.meeting)?.toUpperCase() ?? null;
  const pinned = !!requested && data.meetings.some((m) => m.number === requested);
  const query = { view: parseMeetingsView(first(sp.view)), filter: parseMeetingFilter(first(sp.filter)), meeting: pinned ? requested : null };
  const view = meetingsScreenView({ code: projectCode, meetings: data.meetings, questions: data.questions, query }, t, lang);
  const selected = selectMeeting(data.meetings, query.meeting);

  const primary = canEdit ? (
    <NewMeetingButton code={projectCode} context={t(projectLabel(ctx.project))} form={meetingFormDef(t, lang, defaultInvitees(ctx.viewer.short, ctx.project.pm))} />
  ) : undefined;

  return (
    <>
      <PageHeader screen="meetings" projectCode={projectCode} primary={primary} />
      <MeetingsBody code={projectCode} view={view} canEdit={canEdit} pinned={pinned} organizer={selected?.organizer ?? ''} t={t} />
    </>
  );
}
