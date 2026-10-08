import 'server-only';
// Kind "Delivery — quality check" (prototype data, TODO(db): goods receipts are not modelled yet): receipts of the
// current project waiting for QC, for the quality manager and procurement (apprItems 4725). The prototype's inline
// Accept / Reject threw (event-less handler, 08 OQ28); here they are previews until the Deliveries module
// persists the QC result (Accept → stock, Reject → quarantine).
import { deliveriesOf, deliveryItems, type ProtoDelivery, type ProtoPurchaseOrder } from '@/domain/approvals';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import type { ApprovalContext, ApprovalProvider } from './types';

const QC_ROLES = ['quality', 'procurement'];

const receiptsOf = (code: string) =>
  deliveriesOf(
    code,
    PROTO.HLT_DELIV as ProtoDelivery[],
    (PROTO_GEN.genPOs[code] ?? []) as (ProtoPurchaseOrder & { expected: string })[],
    (PROTO.DEFS[code]?.idx as number | undefined) ?? null,
  );

const inScope = ({ viewer, project }: ApprovalContext) => !!project && QC_ROLES.includes(viewer.role);

export const deliveryQcProvider: ApprovalProvider = {
  kind: 'delivery',
  scope: 'project',
  source: 'prototype',
  async items(ctx) {
    return inScope(ctx) ? deliveryItems(receiptsOf(ctx.project!.code), ctx.project!.code) : [];
  },
  // QC results recorded by the viewer (none in the data set; the prototype does not count them).
  async decided(ctx) {
    if (!inScope(ctx)) return 0;
    return receiptsOf(ctx.project!.code).filter((d) => d.status !== 'QC pending' && d.qc.by === ctx.viewer.name).length;
  },
};
