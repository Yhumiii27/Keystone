import 'server-only';
// Kind "Invoice — 3-way match" (prototype data, TODO(db): supplier invoices are not modelled yet): invoices
// blocked by the 3-way match or without PO, for procurement and the portfolio director (apprItems 4729).
// Decided on Sourcing › Invoices only (no inline decision).
import { invoiceItems, type ProtoInvoice } from '@/domain/approvals';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

const ROLES = ['procurement', 'director'];

export const invoiceProvider: ApprovalProvider = {
  kind: 'invoice',
  scope: 'global',
  source: 'prototype',
  async items({ viewer, lang }) {
    return ROLES.includes(viewer.role) ? invoiceItems(PROTO.INVOICES as ProtoInvoice[], lang) : [];
  },
  async decided() {
    return 0;
  },
};
