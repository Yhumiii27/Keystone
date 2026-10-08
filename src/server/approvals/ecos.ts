import 'server-only';
// Kind "ECO" (prototype data, TODO(db): ECOs are not modelled yet): ECOs in approval whose approval key of the
// viewer's role is pending (apprItems 4724; keys englead / quality / pm, ecoRoleKey 4341). Inline Approve / Reject
// are previews until the ECO module persists `appr[key]`.
import { ecoDecided, ecoItems, ecoKeyOf, type ProtoEco } from '@/domain/approvals';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

const ECOS = PROTO.ECOS as ProtoEco[];

export const ecoProvider: ApprovalProvider = {
  kind: 'eco',
  scope: 'global',
  source: 'prototype',
  async items({ viewer }) {
    const key = ecoKeyOf(viewer.role);
    return key ? ecoItems(ECOS, key, PROTO.ECO_TYPES, PROTO.PROJ_NAMES) : [];
  },
  // Prototype term: ECOs approved on the viewer's key.
  async decided({ viewer }) {
    const key = ecoKeyOf(viewer.role);
    return key ? ecoDecided(ECOS, key) : 0;
  },
};
