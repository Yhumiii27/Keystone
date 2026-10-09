import 'server-only';
// Kind "NCR verification" (database — the Vigie NCR mirror, src/server/integrations/vigie): NCRs of the current project
// in Verification in Vigie with nothing already waiting for Vigie, for the quality manager (apprItems 4730). Decided
// inline: Approve → Closed, Reject → back to Corrective action, recorded through the Vigie connector's outbox
// (verifyNcrAction → verifyNcr, "pending sync with Vigie"); the row opens the NCR drawer on the Quality screen and
// "Open in Vigie" opens it where it is managed.
import { ncrVerificationItems } from '@/domain/quality';
import { ncrHref } from '@/features/quality/links';
import { ncrVerificationDecidedCount, ncrVerificationQueue } from '@/server/dal/quality';
import type { ApprovalContext, ApprovalProvider } from './types';

const actorOf = ({ viewer }: ApprovalContext) => ({ name: viewer.name, role: viewer.role });

export const ncrVerificationProvider: ApprovalProvider = {
  kind: 'ncr',
  scope: 'project',
  source: 'db',
  async items(ctx) {
    if (!ctx.project) return [];
    const code = ctx.project.code;
    return ncrVerificationItems(await ncrVerificationQueue(code, actorOf(ctx)), code, { ncr: (n) => ncrHref(code, n) });
  },
  // Verifications the viewer recorded in Keystone (sent to Vigie or still pending).
  async decided(ctx) {
    return ctx.viewer.role === 'quality' ? ncrVerificationDecidedCount(actorOf(ctx)) : 0;
  },
};
