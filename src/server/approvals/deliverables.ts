import 'server-only';
// Kind "Deliverable acceptance" (database): submitted deliverables of the current project waiting for the client's decision. D9-06
// (owner, 10 Nov 2026): clients never see Keystone — the PV is signed outside and the project's leads (PM of record, co-PM,
// deputy) and the director record the client's acceptance (date, reference of the signed document) or rejection in the
// deliverable drawer (Quality writer `decideDeliverable`). No inline decision: the row opens the deliverable drawer.
import { yearOfIso } from '@/domain/clock';
import { deliverableAcceptanceItems } from '@/domain/quality';
import { deliverableHref } from '@/features/quality/links';
import { listProjects } from '@/server/dal/projects';
import { deliverableAcceptanceQueue, deliverableDecidedCount } from '@/server/dal/quality';
import type { ApprovalContext, ApprovalProvider } from './types';

const actorOf = ({ viewer }: ApprovalContext) => ({ name: viewer.name, role: viewer.role });

export const deliverableProvider: ApprovalProvider = {
  kind: 'deliverable',
  scope: 'project',
  source: 'db',
  async items(ctx) {
    if (!ctx.project) return [];
    const code = ctx.project.code;
    return deliverableAcceptanceItems(await deliverableAcceptanceQueue(code, actorOf(ctx)), code, { deliverable: (n) => deliverableHref(code, n) }, yearOfIso(ctx.today));
  },
  // Client decisions the viewer recorded in Keystone (register, drawer).
  async decided(ctx) {
    return deliverableDecidedCount(actorOf(ctx));
  },
  // The projects the viewer leads (the director: every project).
  candidates: async (ctx) => (ctx.viewer.role === 'director' ? new Set((await listProjects()).map((p) => p.code)) : new Set(ctx.viewer.managedProjects)),
};
