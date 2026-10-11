// Approvals — {department} (docs/spec/08 §6; template 2731–2812, logic 4130–4145). Department in the path
// (`/resources/approvals/engineering`); unknown slug → 404. P-8a (R-048): the director decides (approve, propose reschedule,
// reject) for every department; a department head sees and decides only the departments they head — another department's
// page sends them to theirs, and the department chips list theirs only. Others read it outside their workspace.
// Primary action "Team capacity" opens Resources.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { notFound, redirect } from 'next/navigation';
import { screenHref } from '@/config/screens';
import { ButtonLink } from '@/components/ds/Button';
import { PageHeader } from '@/components/app/shell/page-header';
import { deptOfSlug } from '@/domain/requests';
import { canDecideDepartment, canViewDepartmentApprovals } from '@/domain/rights';
import { ApprovalsScreen } from '@/features/requests/approvals-screen';
import { approvalsTitle, reqT } from '@/features/requests/i18n';
import { approvalsModel } from '@/features/requests/model';
import { approvalsHref } from '@/features/requests/routes';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { myWorkAccess } from '@/server/dal/mywork-data';
import { getApprovalsScreenData, listApprovalDepartmentsFull } from '@/server/dal/requests-screens';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

/** Slug as typed; a malformed escape ("%E0%A4%A") is a 404, not a server error. */
const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

export default async function ApprovalsPage({ params }: { params: Promise<{ dept: string }> }) {
  const { dept } = await params;
  const d = deptOfSlug(await listApprovalDepartmentsFull(), safeDecode(dept));
  if (!d) notFound();
  const [{ t, lang }, access, data] = await Promise.all([getI18n(), getScreenAccess('approvals'), getApprovalsScreenData(d.name)]);
  if (!data) notFound();
  const headed = (await getApproverIdentity(access.viewer)).departments;
  if (!canViewDepartmentApprovals(access.viewer.role, headed, d.name)) redirect(approvalsHref(headed[0]));
  const canDecide = access.canEdit && canDecideDepartment(access.viewer.role, headed, d.name);
  const departments = access.viewer.role === 'director' || !headed.length ? data.departments : data.departments.filter((x) => headed.includes(x.name));
  const tt = reqT(t, lang);
  const model = approvalsModel(data, t, lang, access.viewer);
  const work = await myWorkAccess(access.viewer);
  return (
    <>
      <PageHeader
        screen="approvals"
        title={approvalsTitle(d.name, tt)}
        crumbExtra={d.head ? `${d.head} · ${d.headTitle ?? ''}` : ''}
        primary={
          <ButtonLink variant="primary" icon={Plus} href={screenHref('resources')}>
            {t('Team capacity')}
          </ButtonLink>
        }
      />
      <ApprovalsScreen
        model={model}
        department={d.name}
        departments={departments.map((x) => ({ name: x.name, pending: x.pending }))}
        canDecide={canDecide}
        workable={model.team.map((p) => p.name).filter(work.canView)}
        t={tt}
      />
    </>
  );
}
