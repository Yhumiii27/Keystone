import 'server-only';
// Kind "Deliverable acceptance" (database): submitted deliverables of the current project, for the client contact of
// that project's client organisation (apprItems 4727 by person instead of the client role). Decided inline:
// Approve → Accepted (PV, the viewer and the status date stamped), Reject → Rejected ("comments issued"), through the
// Quality writer (decideDeliverableAction → decideDeliverable); the row opens the deliverable drawer.
import { yearOfIso } from '@/domain/clock';
import { deliverableAcceptanceItems } from '@/domain/quality';
import { deliverableHref } from '@/features/quality/links';
import { deliverableAcceptanceQueue, deliverableDecidedCount } from '@/server/dal/quality';
import type { ApprovalContext, ApprovalProvider } from './types';

const actorOf = ({ viewer }: ApprovalContext) => ({ name: viewer.name, role: viewer.role });

export const deliverableProvider: ApprovalProvider = {
  kind: 'deliverable',
  scope: 'project',
  source: 'db',
  async items(ctx) {
    if (!ctx.project || !ctx.viewer.clientProjects.includes(ctx.project.code)) return [];
    const code = ctx.project.code;
    return deliverableAcceptanceItems(await deliverableAcceptanceQueue(code, actorOf(ctx)), code, { deliverable: (n) => deliverableHref(code, n) }, yearOfIso(ctx.today));
  },
  // Deliverables the viewer accepted or rejected in Keystone (register, drawer, inbox, client portal).
  async decided(ctx) {
    return ctx.viewer.role === 'client' ? deliverableDecidedCount(actorOf(ctx)) : 0;
  },
  // Only the client contact's projects.
  candidates: async (ctx) => new Set(ctx.viewer.clientProjects),
};
