import 'server-only';
// Kind "Purchase order" (prototype data, TODO(db): purchase orders are not modelled yet): POs of the current
// project awaiting approval, for its project manager and the portfolio director (apprItems 4723). Inline
// Approve / Reject are previews until the Orders module persists PO status (Approve → Ordered, Reject → Cancelled).
import { purchaseOrderItems, type ProtoPurchaseOrder } from '@/domain/approvals';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import type { ApprovalContext, ApprovalProvider } from './types';

const PRICES: Record<string, number> = Object.fromEntries((PROTO.PARTS as { ref: string; price: number }[]).map((p) => [p.ref, p.price]));

/** POs of a project (genPOs 3415; Harbor Line = HLT_POS). */
const posOf = (code: string): ProtoPurchaseOrder[] => (PROTO_GEN.genPOs[code] ?? []) as ProtoPurchaseOrder[];

/** PO approvers: the project's manager and the portfolio director. */
const approves = ({ viewer, project }: ApprovalContext) => !!project && (viewer.role === 'director' || viewer.managedProjects.includes(project.code));

export const purchaseOrderProvider: ApprovalProvider = {
  kind: 'po',
  scope: 'project',
  source: 'prototype',
  async items(ctx) {
    return approves(ctx) ? purchaseOrderItems(posOf(ctx.project!.code), PRICES, ctx.project!.code, ctx.lang) : [];
  },
  // Prototype term: POs of the project in status Ordered (counted for PO approvers only).
  async decided(ctx) {
    return approves(ctx) ? posOf(ctx.project!.code).filter((o) => o.status === 'Ordered').length : 0;
  },
};
