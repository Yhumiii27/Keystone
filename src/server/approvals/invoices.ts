import 'server-only';
// Kind "Invoice — 3-way match" (DB): supplier invoices Blocked by the 3-way match or without PO, for procurement and
// the portfolio director (apprItems 4729), all projects. Decided on Sourcing only (row opens `?tab=inv&inv=…`; no
// inline decision): approving the payment, approving the received part or rejecting takes the invoice out of the queue.
// "Decided this week": the invoices the viewer decided in Keystone.
import { INVOICE_DECIDER_ROLES, invoiceApprovalItems } from '@/domain/procurement';
import { invoiceQueue, listSupplierInvoices } from '@/server/dal/purchasing';
import type { ApprovalProvider } from './types';

export const invoiceProvider: ApprovalProvider = {
  kind: 'invoice',
  scope: 'global',
  source: 'db',
  async items({ viewer, lang }) {
    if (!INVOICE_DECIDER_ROLES.includes(viewer.role)) return [];
    const invoices = await invoiceQueue();
    return invoiceApprovalItems(
      invoices.map((i) => ({
        number: i.number, supplier: i.supplier, status: i.status, amountEur: i.amountEur, currency: i.currency, invoiceDate: i.invoiceDate,
        // The row's own match (C-9: an invoice in another currency than its order does not match it).
        match: i.match,
      })),
      lang,
    );
  },
  async decided({ viewer }) {
    return (await listSupplierInvoices()).filter((i) => i.decidedBy === viewer.name).length;
  },
};
