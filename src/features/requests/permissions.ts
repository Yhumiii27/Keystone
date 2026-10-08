// Who may act on resource requests (docs/spec/08 §0.2, §5–§6; 01 §5.9). Pure.
// - Send: roles whose workspace holds a screen with the "New request" / "Request resource" primary action
//   (requests, resources, presources): director, pm, depthead, englead, procurement.
// - PM actions (withdraw, accept reschedule, re-request): the sender only, with Resource requests in their workspace.
// - Decide (approve, propose reschedule, reject): roles with Approvals in their workspace (director, depthead, quality),
//   for any department as in the prototype (08 OQ19 open).
import { canSee, type RoleKey } from '@/config/screens';

export const canSendRequests = (role: RoleKey) => canSee(role, 'requests') || canSee(role, 'resources') || canSee(role, 'presources');

export const canDecideRequests = (role: RoleKey) => canSee(role, 'approvals');

export const canManageOwnRequests = (role: RoleKey) => canSee(role, 'requests');
