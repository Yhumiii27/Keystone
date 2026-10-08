import 'server-only';
// Kind "Deliverable acceptance" (prototype data, TODO(db): client deliverables are not modelled yet): submitted
// deliverables of the current project, for the client contact of that project's client organisation (apprItems
// 4727 by person instead of the client role). Inline Accept / Reject (PV) are previews until the Quality module
// persists them (Accepted, acc "25 Sep · N. Bensaïd" / Rejected, "comments issued").
import { deliverableItems, deliverablesOf, type ProtoDeliverable } from '@/domain/approvals';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

export const deliverableProvider: ApprovalProvider = {
  kind: 'deliverable',
  scope: 'project',
  source: 'prototype',
  async items({ viewer, project }) {
    if (!project || !viewer.clientProjects.includes(project.code)) return [];
    return deliverableItems(deliverablesOf(project.code, PROTO.HLT_DELIVS as ProtoDeliverable[], project.hasData, project.pm), project.code);
  },
  async decided() {
    return 0;
  },
};
