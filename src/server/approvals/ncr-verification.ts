import 'server-only';
// Kind "NCR verification" (prototype data, TODO(db): NCRs are not modelled yet): open NCRs of the current project
// in Verification, for the quality manager (apprItems 4730). Inline Close / back to Corrective action are previews
// until the Quality module persists NCR status.
import { ncrItems, ncrsOf, type ProtoNcr } from '@/domain/approvals';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

export const ncrVerificationProvider: ApprovalProvider = {
  kind: 'ncr',
  scope: 'project',
  source: 'prototype',
  async items({ viewer, project }) {
    if (!project || viewer.role !== 'quality') return [];
    return ncrItems(ncrsOf(project.code, PROTO.HLT_NCRS as ProtoNcr[], project.hasData), project.code);
  },
  async decided() {
    return 0;
  },
};
