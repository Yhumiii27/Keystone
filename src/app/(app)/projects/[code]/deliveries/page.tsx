// Deliveries & goods receipt — /projects/[code]/deliveries (docs/spec/08 §3, template 1598–1657, logic 4447–4467).
// Goods receipts of the project: announced against purchase orders, registered on arrival, checked by quality
// (accept → stock, reject → quarantine, or per article) with their documents and photos.
// URL state (docs/spec/00 §8.3): `?status=<code>` (status chip; unknown → All), `?receipt=BL-2026-0533` opens the
// delivery drawer (unknown → none; `?deliv=`, the prototype's state key, is accepted as an alias). Primary action "Announce a delivery" for viewers who may edit the project;
// Register receipt and documents follow the same rule; the quality decision also needs a QC role (quality manager,
// procurement, director). Projects without receipts show the empty register.
import { PageHeader } from '@/components/app/shell/page-header';
import { canDecideQc, receiptFilterOf } from '@/domain/deliveries';
import { AnnounceDeliveryButton } from '@/features/deliveries/announce-button';
import { DeliveriesBody } from '@/features/deliveries/deliveries-view';
import { announceFormDef, deliveriesHref, deliveriesView, registerFormDef } from '@/features/deliveries/model';
import { getDeliveriesScreen } from '@/server/dal/deliveries';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DeliveriesPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'deliveries');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getDeliveriesScreen(projectCode)]);
  const canEdit = ctx.canEdit('deliveries');
  const canQc = canEdit && canDecideQc(ctx.viewer.role);

  const status = receiptFilterOf(first(sp.status));
  const receiptParam = first(sp.receipt ?? sp.deliv)?.trim().toUpperCase() || null;
  const view = deliveriesView(projectCode, data, { status, receipt: receiptParam }, t, lang);
  const registerForms = canEdit
    ? Object.fromEntries(data.receipts.filter((r) => r.status === 'announced').map((r) => [r.number, registerFormDef(r, t, lang)]))
    : {};

  const primary = canEdit ? (
    <AnnounceDeliveryButton
      code={projectCode}
      context={t(projectLabel(ctx.project))}
      form={data.announceable.length ? announceFormDef(data.announceable, data.putAway, t, lang) : null}
      path={deliveriesHref(projectCode)}
      status={status}
    />
  ) : undefined;

  return (
    <>
      <PageHeader screen="deliveries" projectCode={projectCode} primary={primary} />
      <DeliveriesBody code={projectCode} view={view} canEdit={canEdit} canQc={canQc} registerForms={registerForms} t={t} />
    </>
  );
}
