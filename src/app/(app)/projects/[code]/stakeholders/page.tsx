// Stakeholders & RACI — /projects/[code]/stakeholders (docs/spec/05 §6, template 870–879, logic 4930–4936).
// Register of the people and organisations around the project with their relationship owner and last contact (stale
// after 30 days), and the project RACI matrix. Primary action "Add stakeholder" (AF `stakeholders`), hidden when the
// screen is outside the viewer's workspace or the project is read-only for them. Projects without a register show the
// empty register and no RACI card (no Harbor Line data, 00 §7.16).
// R-137 (L-6): the "Client issues" card — the issues the client raised in the portal, handled here by the project's
// manager (and the director): Take in charge, Answer, Close. `?issue=CI-08` (the PM's notification) highlights one.
// Internal: not shown to the client (P-10b).
import { PageHeader } from '@/components/app/shell/page-header';
import { CLIENT_ISSUE_HANDLER_ROLES } from '@/domain/client-issues';
import { ClientIssuesCard } from '@/features/client-issues/issues-card';
import { clientIssuesView } from '@/features/client-issues/model';
import { AddStakeholderButton } from '@/features/team/add-buttons';
import { localizeForm, stakeholderFormDef } from '@/features/team/forms';
import { formT } from '@/features/team/i18n';
import { stakeholdersView } from '@/features/team/model';
import { StakeholdersBody } from '@/features/team/stakeholders-view';
import { listClientIssuesForTeam } from '@/server/dal/client';
import { projectLabel } from '@/server/dal/projects';
import { getStakeholdersScreen } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function StakeholdersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams ?? Promise.resolve({} as SP)]);
  const ctx = await getProjectContext(code, 'stakeholders');
  const projectCode = ctx.project.code;
  const internal = ctx.viewer.role !== 'client';
  const [{ t, lang }, data, issues] = await Promise.all([getI18n(), getStakeholdersScreen(projectCode), internal ? listClientIssuesForTeam(projectCode) : Promise.resolve(null)]);

  const primary =
    ctx.canEdit('stakeholders') && data ? (
      <AddStakeholderButton code={projectCode} context={t(projectLabel(ctx.project))} form={localizeForm(stakeholderFormDef(data.team), formT(t, lang))} />
    ) : undefined;
  const canHandle = ctx.canEdit('stakeholders') && CLIENT_ISSUE_HANDLER_ROLES.includes(ctx.viewer.role) && (ctx.viewer.role === 'director' || ctx.isMine);
  const selected = first(sp.issue)?.trim().toUpperCase().slice(0, 12) ?? null;

  return (
    <>
      <PageHeader screen="stakeholders" projectCode={projectCode} primary={primary} />
      {data && <StakeholdersBody view={stakeholdersView(data.register, t, lang)} t={t} />}
      {issues && <ClientIssuesCard code={projectCode} view={clientIssuesView(issues, { canHandle, selected }, t, lang)} t={t} />}
    </>
  );
}
