import 'server-only';
// Kind "RFQ award" (DB): RFQs ready to award — Comparing, no winner yet — for the project manager and procurement
// (apprItems 4728), all projects. Awarded on Sourcing only (row opens `?tab=rfq&rfq=…`; no inline decision): the award
// (pm, procurement, director) records the winner and drafts the purchase order, and the RFQ leaves every queue.
// "Decided this week": the RFQs the viewer awarded in Keystone.
import { RFQ_INBOX_ROLES, rfqAwardItems } from '@/domain/procurement';
import { makeT } from '@/i18n/translate';
import { listRfqs, rfqAwardQueue } from '@/server/dal/purchasing';
import type { ApprovalProvider } from './types';

export const rfqAwardProvider: ApprovalProvider = {
  kind: 'rfq',
  scope: 'global',
  source: 'db',
  async items({ viewer, lang }) {
    if (!RFQ_INBOX_ROLES.includes(viewer.role)) return [];
    const rfqs = await rfqAwardQueue();
    return rfqAwardItems(
      rfqs.map((r) => ({
        number: r.number, title: r.title, status: r.status, awardedTo: r.awardedTo, quoteCount: r.quotes.length, awardRuleLabel: r.awardRuleLabel,
        replyDueOn: r.replyDueOn, owner: r.owner,
      })),
      makeT(lang),
    );
  },
  async decided({ viewer }) {
    return (await listRfqs()).filter((r) => r.awardedBy === viewer.name).length;
  },
};
