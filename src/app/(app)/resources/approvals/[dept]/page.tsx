// Approvals — {department} (docs/spec/08 §6; template 2731–2812, logic 4130–4145). Department in the path
// (`/resources/approvals/engineering`); unknown slug → 404. Decisions (approve, propose reschedule, reject) for viewers
// with Approvals in their workspace (director, department head, quality — any department, 08 OQ19); read-only otherwise.
// Primary action "Team capacity" opens Resources.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { notFound } from 'next/navigation';
import { screenHref } from '@/config/screens';
import { ButtonLink } from '@/components/ds/Button';
import { PageHeader } from '@/components/app/shell/page-header';
import { deptOfSlug } from '@/domain/requests';
import { ApprovalsScreen } from '@/features/requests/approvals-screen';
import { approvalsTitle, reqT } from '@/features/requests/i18n';
import { approvalsModel } from '@/features/requests/model';
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
  const tt = reqT(t, lang);
  const model = approvalsModel(data, t, lang, access.viewer);
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
        departments={data.departments.map((x) => ({ name: x.name, pending: x.pending }))}
        canDecide={access.canEdit}
        t={tt}
      />
    </>
  );
}
