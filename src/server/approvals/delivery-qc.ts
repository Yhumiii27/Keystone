import 'server-only';
// Kind "Delivery — quality check" (database, Delivery 4): goods receipts of the current project waiting for their
// incoming inspection, for the quality manager and procurement (apprItems 4725), in the register's order. The row
// opens the delivery drawer (`?receipt=`); the inline Approve / Reject record the same decision as the Deliveries
// screen — Accept → stock, Reject → quarantine, default remarks (src/features/deliveries/actions.ts) — where the
// prototype's inbox call threw (event-less handler, 08 OQ28). The submitter is the receiving clerk who registered
// the delivery (the prototype wrote "Fabien Bertrand" for every receipt).
import { screenHref } from '@/config/screens';
import type { ApprovalItem } from '@/domain/approvals';
import { yearOfIso } from '@/domain/clock';
import { QC_INBOX_ROLES, qcInboxItems } from '@/domain/deliveries';
import { qcDecidedCount, qcQueue } from '@/server/dal/deliveries';
import { projectsWithReceiptsInQc } from '@/server/dal/approval-candidates';
import type { ApprovalContext, ApprovalProvider } from './types';

const inScope = ({ viewer, project }: ApprovalContext) => !!project && QC_INBOX_ROLES.includes(viewer.role);

export const deliveryQcProvider: ApprovalProvider = {
  kind: 'delivery',
  scope: 'project',
  source: 'db',
  async items(ctx) {
    if (!inScope(ctx)) return [];
    const code = ctx.project!.code;
    return qcInboxItems(await qcQueue(code), yearOfIso(ctx.today)).map(
      (i): ApprovalItem => ({
        kind: 'delivery', id: i.id, title: i.title, sub: i.sub, who: i.who, when: i.when, whenIso: i.whenIso,
        href: `${screenHref('deliveries', { code })}?receipt=${encodeURIComponent(i.id)}`,
        decision: { mode: 'delivery-qc', projectCode: code, number: i.id },
      }),
    );
  },
  // Quality checks the viewer recorded on the project's receipts.
  async decided(ctx) {
    return inScope(ctx) ? qcDecidedCount(ctx.project!.code, ctx.viewer.name) : 0;
  },
  // The quality manager and procurement only, on the projects with a receipt waiting for its check.
  candidates: async (ctx) => (QC_INBOX_ROLES.includes(ctx.viewer.role) ? projectsWithReceiptsInQc() : new Set()),
};
