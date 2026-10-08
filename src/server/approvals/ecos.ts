import 'server-only';
// Kind "ECO" (database — the Vigie mirror, src/server/integrations/vigie): ECOs in approval in Vigie whose approval key
// of the viewer is still pending and not already decided in Keystone (apprItems 4724; keys englead / quality / pm,
// ecoRoleKey 4341 — the director holds none; the PM key goes to the PMs of the ECO's projects). Decided inline: the
// decision is recorded through the Vigie connector (decideEcoApprovalAction → recordEcoProgress, "pending sync with
// Vigie"); the row opens the ECO in Keystone and "Open in Vigie" opens it where it is managed.
import { screenHref } from '@/config/screens';
import { ecoApprovalItems } from '@/domain/eco';
import { fmtDOfIso } from '@/server/db/codes';
import { ecoApprovalQueue, ecoDecidedCount } from '@/server/dal/eco';
import { vigieEcoUrl } from '@/server/integrations/vigie/links';
import type { ApprovalProvider } from './types';

const keystoneEcoHref = (n: string) => `${screenHref('eco')}?eco=${encodeURIComponent(n)}`;

export const ecoProvider: ApprovalProvider = {
  kind: 'eco',
  scope: 'global',
  source: 'db',
  async items({ viewer }) {
    const queue = await ecoApprovalQueue({ name: viewer.name, role: viewer.role });
    return ecoApprovalItems(queue, { keystone: keystoneEcoHref, vigie: vigieEcoUrl }, fmtDOfIso);
  },
  // Prototype term: ECOs approved on the viewer's key (decisions waiting for Vigie included).
  async decided({ viewer }) {
    return ecoDecidedCount({ name: viewer.name, role: viewer.role });
  },
};
