// Who may act on resource requests (docs/spec/08 §0.2, §5–§6; 01 §5.9). Pure.
// - Send: roles whose workspace holds a screen with the "New request" / "Request resource" primary action
//   (requests, resources, presources): director, pm, depthead, englead, procurement.
// - PM actions (withdraw, accept reschedule, re-request): the sender only, with Resource requests in their workspace.
// - Decide (approve, propose reschedule, reject): roles with Approvals in their workspace (director, depthead, quality),
//   for any department as in the prototype (08 OQ19 open).
// - Drafts (chapter 4, S-7 — what-if "Apply" / "Select scenario"): send or discard as for sending a request, from
//   Resource requests: the requester, the project's PM or the director; never on a project read-only for the viewer.
import { canSee, type RoleKey } from '@/config/screens';

export const canSendRequests = (role: RoleKey) => canSee(role, 'requests') || canSee(role, 'resources') || canSee(role, 'presources');

export const canDecideRequests = (role: RoleKey) => canSee(role, 'approvals');

export const canManageOwnRequests = (role: RoleKey) => canSee(role, 'requests');

/** The viewer sent (or drafted) the request: matched on the short ("R. Aubert") or full name. */
export const isRequester = (r: { requestedBy: string; requestedByName: string }, viewer: { name: string; short: string }) =>
  r.requestedBy === viewer.short || r.requestedByName === viewer.name;

export interface DraftFacts {
  /** The viewer drafted the request. */
  requester: boolean;
  /** The viewer leads the request's project (its PMs and deputies, R-041; always true for the director). */
  projectPm: boolean;
  /** The project is read-only for the viewer (`projReadOnly`). */
  readOnly: boolean;
}

/** S-7: the viewer may send a DRAFT request to its department, or discard it. Outside the workspace → refused. */
export function canHandleDraft(role: RoleKey, f: DraftFacts): boolean {
  if (!canSendRequests(role) || !canManageOwnRequests(role) || f.readOnly) return false;
  return role === 'director' || f.requester || f.projectPm;
}

/** The viewer's project scope (`getProjectScope`): projects with data, PM rights (`isLead`, R-041) and `projReadOnly`. */
export interface DraftScope<P extends { code: string }> {
  pool: readonly P[];
  /** PM of record, co-PM, deputy or the director (R-041). */
  isLead: (p: P) => boolean;
  readOnly: (p: P) => boolean;
}

/**
 * `canHandleDraft` per request for a viewer and their project scope — one rule for the Requests page (Send / Discard
 * shown) and the draft Server Functions (enforced). A project outside the scope (unknown, no data) → refused.
 */
export function draftRights<P extends { code: string }>(viewer: { role: RoleKey; name: string; short: string }, scope: DraftScope<P>) {
  return (r: { projectCode: string; requestedBy: string; requestedByName: string }): boolean => {
    const p = scope.pool.find((x) => x.code === r.projectCode);
    return !!p && canHandleDraft(viewer.role, { requester: isRequester(r, viewer), projectPm: scope.isLead(p), readOnly: scope.readOnly(p) });
  };
}
