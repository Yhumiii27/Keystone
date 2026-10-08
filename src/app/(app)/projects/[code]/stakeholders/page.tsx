// Stakeholders & RACI — /projects/[code]/stakeholders (docs/spec/05 §6, template 870–879, logic 4930–4936).
// Register of the people and organisations around the project with their relationship owner and last contact (stale
// after 30 days), and the project RACI matrix. Primary action "Add stakeholder" (AF `stakeholders`), hidden when the
// screen is outside the viewer's workspace or the project is read-only for them. Projects without a register show the
// empty register and no RACI card (no Harbor Line data, 00 §7.16).
import { PageHeader } from '@/components/app/shell/page-header';
import { AddStakeholderButton } from '@/features/team/add-buttons';
import { localizeForm, stakeholderFormDef } from '@/features/team/forms';
import { formT } from '@/features/team/i18n';
import { stakeholdersView } from '@/features/team/model';
import { StakeholdersBody } from '@/features/team/stakeholders-view';
import { projectLabel } from '@/server/dal/projects';
import { getStakeholdersScreen } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function StakeholdersPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'stakeholders');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getStakeholdersScreen(projectCode)]);

  const primary =
    ctx.canEdit('stakeholders') && data ? (
      <AddStakeholderButton code={projectCode} context={t(projectLabel(ctx.project))} form={localizeForm(stakeholderFormDef(data.team), formT(t, lang))} />
    ) : undefined;

  return (
    <>
      <PageHeader screen="stakeholders" projectCode={projectCode} primary={primary} />
      {data && <StakeholdersBody view={stakeholdersView(data.register, t, lang)} t={t} />}
    </>
  );
}
