// Purchase orders — /projects/[code]/orders (docs/spec/08 §2, template 2615–2688, logic 4306–4337).
// URL state (docs/spec/00 §8.3): `?status=<code>` (status chip, default All; unknown values fall back to All),
// `?po=PO-1052` opens the order drawer. Primary action "New purchase order" = the BOM shortfall assistant, shown only
// while BOM articles are short (`primary[1]` null otherwise). Edit controls (assistant, Send for approval, Approve &
// order, Push to X3) are hidden when the screen is outside the viewer's workspace or the project is read-only for
// them, and refused server-side; "Approve & order" also needs the portfolio director or the project's manager. R-034:
// "Push to X3" is a simulation offered on a demo database only. R-095: the drawer's "Cancel order" for whom
// `poCancelRight` allows.
// Projects without orders show the empty list (never Harbor Line's orders).
import { PageHeader } from '@/components/app/shell/page-header';
import { isPoStatus } from '@/domain/orders';
import { canEditSupplierSchedule, canSeeSupplierPrices, canTieSupplierSchedule } from '@/domain/rights';
import { supplierSchedulesView } from '@/features/supplier-schedules/model';
import { SupplierScheduleSection } from '@/features/supplier-schedules/supplier-schedule-section';
import { ordersView } from '@/features/orders/model';
import { CreateDraftsButton } from '@/features/orders/order-buttons';
import { OrdersBody } from '@/features/orders/orders-view';
import { getOrdersScreen } from '@/server/dal/orders';
import { x3Simulated } from '@/server/integrations/x3/mock-mode';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'orders');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, x3] = await Promise.all([getI18n(), getOrdersScreen(projectCode, ctx.viewer.name), x3Simulated()]);
  const canEdit = ctx.canEdit('orders');
  const status = first(sp.status);
  // R-046 (NEW-D2-1): order values and supplier prices only for the director, the PMs and procurement.
  const prices = canSeeSupplierPrices(ctx.viewer.role);
  const view = ordersView({ code: projectCode, data, filter: isPoStatus(status) ? status : null, selected: first(sp.po)?.toUpperCase() ?? null, prices, x3 }, t, lang);

  // R-204: the open order's supplier schedule (procurement, the project's leads and the director edit it; the leads tie it).
  const po = view.drawer?.number ?? null;
  const suppliers = po ? await supplierSchedulesView(projectCode) : null;
  const supplierSchedule = po && suppliers && suppliers.orderStatus[po] ? (
    <SupplierScheduleSection
      code={projectCode}
      po={po}
      schedule={suppliers.schedules.find((x) => x.po === po) ?? null}
      projectActivities={suppliers.projectActivities}
      canEdit={canEditSupplierSchedule(ctx.viewer.role, ctx.access, canEdit)}
      canTie={canTieSupplierSchedule(ctx.viewer.role, ctx.access, ctx.canEdit('plan'))}
      cancelled={suppliers.orderStatus[po] === 'cancelled'}
    />
  ) : undefined;

  const primary = canEdit && view.shortfall ? <CreateDraftsButton code={projectCode} place="header" afterHref={view.afterDraftsHref} /> : undefined;

  return (
    <>
      <PageHeader screen="orders" projectCode={projectCode} primary={primary} />
      <OrdersBody view={view} canEdit={canEdit} t={t} supplierSchedule={supplierSchedule} />
    </>
  );
}
