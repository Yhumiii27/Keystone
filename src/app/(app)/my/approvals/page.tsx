// My approvals (docs/spec/08 §7, 00 §7.8): one queue for every decision waiting for the viewer, built by the
// approval-provider registry (src/server/approvals). Kind chips filter via ?filter=<kind>. No primary action.
import { PageHeader } from '@/components/app/shell/page-header';
import { inboxView } from '@/domain/approvals';
import { MyApprovalsBody } from '@/features/myapprovals/inbox';
import { DelegationBanner, DelegationCard } from '@/features/myapprovals/delegation-card';
import { getApprovalInbox } from '@/server/approvals';
import { getDelegationPanel } from '@/server/dal/delegations';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MyApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, access] = await Promise.all([searchParams, getI18n(), getScreenAccess('myapprovals')]);
  // R-051 (P-7d): the viewer's delegations (and the approvers they stand in for) beside their queue.
  const [inbox, delegation] = await Promise.all([getApprovalInbox(access.viewer, { lang }), getDelegationPanel(access.viewer, access.canEdit)]);
  const view = inboxView(inbox.items, { decided: inbox.decided, roleTitle: access.viewer.title, filter: one(sp.filter) ?? null });
  return (
    <>
      <PageHeader screen="myapprovals" />
      <MyApprovalsBody view={view} t={t} lang={lang} canDecide={access.canEdit} delegation={access.viewer.role === 'client' ? null : <DelegationCard panel={delegation} />}
        banner={<DelegationBanner panel={delegation} />}
      />
    </>
  );
}
