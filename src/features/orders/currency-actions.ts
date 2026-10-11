'use server';
// C-9 (R-075): "Currency" of a Draft purchase order (Orders drawer). The viewer may edit Orders on the project (not outside the
// workspace, not a read-only project); the order must belong to the project and still be a draft; the currency must be EUR or
// the project currency with a budget rate. Line prices are converted at the budget rate (src/server/dal/order-currency.ts).
// Results carry English source messages (the client translates them).
import { revalidatePath } from 'next/cache';
import { isCurrency } from '@/domain/currency';
import { setPurchaseOrderCurrency } from '@/server/dal/order-currency';
import { getProject } from '@/server/dal/projects';
import { getPurchaseOrder } from '@/server/dal/purchasing';
import { getProjectContext } from '@/server/project-context';
import type { OrderActionResult } from './actions';

const CODE_RE = /^[A-Z]{3}-\d{3}$/;
const PO_RE = /^PO-\d{3,}$/;
const KNOWN = new Set(['A document is in euros or in the project currency', 'Ask the portfolio director to set the project’s budget rate first', 'This order is no longer a draft']);

export async function setOrderCurrencyAction(code: string, number: string, currency: string): Promise<OrderActionResult> {
  if (typeof code !== 'string' || !CODE_RE.test(code) || typeof number !== 'string' || !PO_RE.test(number) || !isCurrency(currency)) return { ok: false, error: 'Invalid request' };
  const project = await getProject(code);
  if (!project) return { ok: false, error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'orders');
  if (!ctx.canEdit('orders')) return { ok: false, error: 'Purchase orders are read-only for you' };
  const po = await getPurchaseOrder(number);
  if (!po || po.projectCode !== project.code) return { ok: false, error: 'Unknown purchase order' };
  if (po.status !== 'draft') {
    revalidatePath('/', 'layout');
    return { ok: false, error: 'This order is no longer a draft' };
  }
  try {
    await setPurchaseOrderCurrency(po.number, currency, ctx.viewer.name);
  } catch (e) {
    const msg = e instanceof Error && KNOWN.has(e.message) ? e.message : 'The change could not be saved';
    return { ok: false, error: msg };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
