// Meetings & minutes — /projects/[code]/meetings (docs/spec/05 §5, template 753–813, logic 4817–4867).
// URL state (docs/spec/00 §8.3): `?view=meetings|decisions|actions` (Display segment), `?filter=todo|upcoming|sent`
// (status chips), `?meeting=MTG-118` (selected meeting; default = first of the sorted list), `?decisions=client` (D-5:
// the Decisions register limited to meetings with the client — the Site's "Client communication log" opens it).
// Primary action "New meeting" (AF `meetings`). Notes, ticks, the transcript (import, analysis — Claude only when the server
// has ANTHROPIC_API_KEY, else the local rules — and the review of its proposals, S-10) and "Send minutes" go through
// src/features/meetings/actions.ts; every edit control is hidden when the screen is outside the viewer's workspace
// or the project is read-only for them. Projects without meetings show the empty register (no Harbor Line data).
// P-9b (R-050): the project's internal team creates meetings, adds notes and ticks actions; the transcript and "Send minutes"
// belong to the meeting's organiser and the project's PM; the client reads. P-10b (R-043): the client sees the external
// meetings only, without transcript or question bridge.
import { PageHeader } from '@/components/app/shell/page-header';
import { parseDecisionScope, parseMeetingFilter, parseMeetingsView, selectMeeting } from '@/domain/meetings';
import { defaultInvitees, meetingFormDef } from '@/features/meetings/forms';
import { MeetingsBody } from '@/features/meetings/meetings-view';
import { meetingsScreenView } from '@/features/meetings/model';
import { NewMeetingButton } from '@/features/meetings/new-meeting-button';
import { riskFormDef } from '@/features/risks/forms';
import { transcriptAiInfo } from '@/server/ai/config';
import { getMeetingsScreen } from '@/server/dal/meetings-screen';
import { riskOwnerOptions } from '@/server/dal/risks-screen';
import { canWriteMinutes } from '@/domain/rights';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MeetingsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'meetings');
  const projectCode = ctx.project.code;
  const client = ctx.viewer.role === 'client';
  const [{ t, lang }, data] = await Promise.all([getI18n(), getMeetingsScreen(projectCode, { client })]);
  const canEdit = ctx.canEdit('meetings') && !client;

  const requested = first(sp.meeting)?.toUpperCase() ?? null;
  const pinned = !!requested && data.meetings.some((m) => m.number === requested);
  const query = { view: parseMeetingsView(first(sp.view)), filter: parseMeetingFilter(first(sp.filter)), meeting: pinned ? requested : null, decisions: parseDecisionScope(first(sp.decisions)) };
  const view = meetingsScreenView({ code: projectCode, meetings: data.meetings, questions: data.questions, query }, t, lang);
  const selected = selectMeeting(data.meetings, query.meeting);
  const canWrite = canEdit && !!selected && canWriteMinutes(ctx.viewer, ctx.access, selected);
  // A risk proposal of the selected meeting's transcript opens the risk register's "New risk" form (risk editors only).
  const riskProposal = canWrite && !!selected?.transcript?.items.some((x) => x.type === 'risk' && x.status === 'proposed');
  const riskTeam = riskProposal && (await getProjectContext(projectCode, 'risks')).canEdit('risks') ? await riskOwnerOptions(projectCode) : null;

  const primary = canEdit ? (
    <NewMeetingButton code={projectCode} context={projectLabelText(ctx.project, lang)} form={meetingFormDef(t, lang, defaultInvitees(ctx.viewer.short, ctx.project.pm))} />
  ) : undefined;

  return (
    <>
      <PageHeader screen="meetings" projectCode={projectCode} primary={primary} />
      <MeetingsBody
        code={projectCode}
        view={view}
        canEdit={canEdit}
        canWrite={canWrite}
        pinned={pinned}
        organizer={selected?.organizer ?? ''}
        t={t}
        ai={transcriptAiInfo()}
        riskForm={riskTeam ? riskFormDef(riskTeam) : null}
        riskTeam={riskTeam ?? []}
      />
    </>
  );
}
