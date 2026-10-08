import 'server-only';
// Kind "RFQ award" (prototype data, TODO(db): RFQs are not modelled yet): RFQs comparing quotes, for the project
// manager and procurement (apprItems 4728). Awarded on Sourcing only (no inline decision).
import { rfqItems, type ProtoRfq } from '@/domain/approvals';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

const ROLES = ['pm', 'procurement'];

export const rfqAwardProvider: ApprovalProvider = {
  kind: 'rfq',
  scope: 'global',
  source: 'prototype',
  async items({ viewer }) {
    return ROLES.includes(viewer.role) ? rfqItems(PROTO.RFQS as ProtoRfq[]) : [];
  },
  async decided() {
    return 0;
  },
};
