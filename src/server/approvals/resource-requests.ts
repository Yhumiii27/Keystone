import 'server-only';
// Kind "Resource request" (DB): pending staffing requests of the departments the viewer heads (apprItems 4722 —
// by person: the head of the request's department, instead of the depthead role and the department picked on
// Approvals). Decided on the Approvals screen (approve, reject with a reason, propose +1/+2/+3 weeks), not inline.
// Fixes 08 OQ22: the item carries the sent date and its real sender instead of '' and "R. Aubert".
import type { ApprovalItem } from '@/domain/approvals';
import { approvalsHref } from '@/features/requests/routes';
import { shortDateOfIso } from '@/server/db/codes';
import { listResourceRequests } from '@/server/dal/requests';
import type { ApprovalProvider } from './types';

export const resourceRequestProvider: ApprovalProvider = {
  kind: 'request',
  scope: 'global',
  source: 'db',
  async items({ viewer }) {
    if (!viewer.departments.length) return [];
    const rows = await listResourceRequests({ status: 'pending' });
    return rows
      .filter((r) => viewer.departments.includes(r.department))
      .map(
        (r): ApprovalItem => ({
          kind: 'request',
          id: r.id,
          title: r.title,
          sub: `${r.resource} · ${r.projectShortName ?? r.projectName} · ${r.hours} h`,
          when: shortDateOfIso(r.sent),
          whenIso: r.sent,
          who: r.requestedBy,
          href: approvalsHref(r.department), // /resources/approvals/[dept] (00 §8.3)
          decision: null,
        }),
      );
  },
  // Prototype dDecided: every request of the department that is no longer pending.
  async decided({ viewer }) {
    if (!viewer.departments.length) return 0;
    const rows = await listResourceRequests();
    return rows.filter((r) => viewer.departments.includes(r.department) && r.status !== 'pending').length;
  },
};
