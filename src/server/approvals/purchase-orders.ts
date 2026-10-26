import 'server-only';
// Kind "Purchase order" (DB): orders of the current project awaiting approval, for the portfolio director and the
// project's manager (apprItems 4724, routed per person by the data layer). Decided inline: Approve → Ordered,
// Reject → Cancelled, through the Orders Server Function `decidePurchaseOrderAction` (src/features/orders/actions.ts)
// and the purchasing writers. "Submitted by" is whoever sent the order for approval (the buyer for the seed orders).
import { yearOfIso } from '@/domain/clock';
import { poApprovalItems } from '@/domain/orders';
import { fmtDOfIso } from '@/server/db/codes';
import { poApprovalQueue, poDecidedCount, posAwaitingApprovalByProject, purchaseOrderApprovableProjects } from '@/server/dal/purchasing';
import { projectsWithOrdersAwaitingApproval } from '@/server/dal/approval-candidates';
import type { ApprovalProvider } from './types';

export const purchaseOrderProvider: ApprovalProvider = {
  kind: 'po',
  scope: 'project',
  source: 'db',
  async items({ viewer, project, lang, today }) {
    if (!project) return [];
    return poApprovalItems(await poApprovalQueue(project.code, viewer.name), project.code, lang, (iso) => fmtDOfIso(iso, yearOfIso(today)));
  },
  // Prototype term kept by the data layer: the project's orders in status Ordered, for its approvers only.
  async decided({ viewer, project }) {
    return project ? poDecidedCount(project.code, viewer.name) : 0;
  },
  // The projects with an order awaiting approval (the approver check stays in `items`).
  candidates: () => projectsWithOrdersAwaitingApproval(),
  // The orders awaiting approval of the projects the viewer approves for (`poApprovalQueue`), counted in SQL.
  async countByProject({ viewer }, codes) {
    const waiting = await posAwaitingApprovalByProject();
    const allowed = await purchaseOrderApprovableProjects(viewer.name, codes.filter((c) => waiting[c]));
    return new Map([...allowed].map((c) => [c, waiting[c]] as const));
  },
};
