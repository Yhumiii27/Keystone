import 'server-only';
// Kind "Contingency draw-down" (DB, delivery 7: R-071, owner decision C-4 "Lien obligatoire, validation du directeur"):
// draw-downs recorded on the Contingency register of any project and awaiting the portfolio director's validation — a
// draw-down only counts in "drawn" once validated. Decided inline (Approve → validated, Reject → rejected with an optional
// comment) through src/features/risks/actions.ts decideDrawDownAction; the row opens the project's Contingency register.
// "Decided this week": the draw-downs the viewer validated or rejected in Keystone.
import { screenHref } from '@/config/screens';
import type { ApprovalItem } from '@/domain/approvals';
import { isDrawDecider } from '@/domain/cost-control';
import { money } from '@/lib/format';
import { countDrawDecisions, listDrawsAwaitingValidation } from '@/server/dal/contingency';
import type { ApprovalProvider } from './types';

export const contingencyDrawProvider: ApprovalProvider = {
  kind: 'contingency',
  scope: 'global',
  source: 'db',
  async items({ viewer, lang }) {
    if (!isDrawDecider(viewer.role)) return [];
    return (await listDrawsAwaitingValidation()).map(
      (d): ApprovalItem => ({
        kind: 'contingency',
        id: d.projectCode,
        title: d.reason,
        sub: `${money(d.amount, lang)}${d.linkRef ? ' · ' + d.linkRef : ''}`,
        who: d.requestedBy ?? '—',
        when: d.dateText,
        whenIso: d.date,
        href: screenHref('contingency', { code: d.projectCode }),
        decision: { mode: 'contingency-draw', projectCode: d.projectCode, drawId: d.id },
      }),
    );
  },
  async decided({ viewer }) {
    if (!isDrawDecider(viewer.role)) return 0;
    return countDrawDecisions(viewer.name);
  },
};
