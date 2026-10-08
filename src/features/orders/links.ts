// Links of the Purchase orders screen (docs/spec/00 §8.3 URL state, 08 §2.7 cross-links). The screen keeps its
// status chip in `?status=<code>` and the open order in `?po=PO-1082`; it links out to the Plan activity
// (`?act=`), the Project BOM part (`?part=`), the goods receipts (`?receipt=`) and the supplier invoices
// (`?tab=inv&inv=`) of an order.
import { screenHref } from '@/config/screens';
import type { PoStatus } from '@/server/db/codes';

const withQuery = (base: string, q: Record<string, string | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) u.set(k, v);
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
};

/** The Orders screen of a project with its chip filter and open order. */
export const ordersHref = (code: string, q: { status?: PoStatus | null; po?: string | null } = {}) =>
  withQuery(screenHref('orders', { code }), { status: q.status, po: q.po });

/** "Open activity" (drawer): the Plan with the activity drawer open; the Plan alone when no activity is linked. */
export const planActivityHref = (code: string, activity: string | null) => withQuery(screenHref('plan', { code }), { act: activity });

/** Order line → the part in the Project BOM (prototype `{screen:'bom', part}`). */
export const bomPartHref = (code: string, ref: string) => withQuery(screenHref('bom', { code }), { part: ref });

/** Goods receipt of an order → Deliveries with its drawer open. */
export const receiptHref = (code: string, number: string) => withQuery(screenHref('deliveries', { code }), { receipt: number });

/** Supplier invoice of an order → Sourcing, Invoices tab, with its drawer open. */
export const invoiceHref = (number: string) => withQuery(screenHref('procurement'), { tab: 'inv', inv: number });
