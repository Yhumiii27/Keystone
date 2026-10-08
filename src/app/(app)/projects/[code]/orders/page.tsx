// Purchase orders — /projects/[code]/orders (docs/spec/08 §2, template 2615–2688, logic 4306–4337).
// URL state (docs/spec/00 §8.3): `?status=<code>` (status chip, default All; unknown values fall back to All),
// `?po=PO-1052` opens the order drawer. Primary action "New purchase order" = the BOM shortfall assistant, shown only
// while BOM articles are short (`primary[1]` null otherwise). Edit controls (assistant, Send for approval, Approve &
// order, Push to X3) are hidden when the screen is outside the viewer's workspace or the project is read-only for
// them, and refused server-side; "Approve & order" also needs the portfolio director or the project's manager.
// Projects without orders show the empty list (never Harbor Line's orders).
import { PageHeader } from '@/components/app/shell/page-header';
import { isPoStatus } from '@/domain/orders';
import { ordersView } from '@/features/orders/model';
import { CreateDraftsButton } from '@/features/orders/order-buttons';
import { OrdersBody } from '@/features/orders/orders-view';
import { getOrdersScreen } from '@/server/dal/orders';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'orders');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getOrdersScreen(projectCode, ctx.viewer.name)]);
  const canEdit = ctx.canEdit('orders');
  const status = first(sp.status);
  const view = ordersView({ code: projectCode, data, filter: isPoStatus(status) ? status : null, selected: first(sp.po)?.toUpperCase() ?? null }, t, lang);

  const primary = canEdit && view.shortfall ? <CreateDraftsButton code={projectCode} place="header" afterHref={view.afterDraftsHref} /> : undefined;

  return (
    <>
      <PageHeader screen="orders" projectCode={projectCode} primary={primary} />
      <OrdersBody view={view} canEdit={canEdit} t={t} />
    </>
  );
}
