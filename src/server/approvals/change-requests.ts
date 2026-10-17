import 'server-only';
// Kind "Change request" (DB): change requests of the current project in review whose pm / director / client step
// names the viewer as approver and is pending (apprItems 4726 by person: the project's PM, the portfolio director,
// the project's client contact), plus the change control board step for the persona that records it on Change
// control (the director, STEP_DECIDER — no persona holds it, 07 OQ2). Decided inline through the Change control
// writer `decideChangeStep` (src/features/myapprovals/actions.ts), status derived from the chain.
import { changeRequestItems } from '@/domain/approvals';
import { yearOfIso } from '@/domain/clock';
import { listChangeRequestDetails } from '@/server/dal/changes';
import type { ApprovalProvider } from './types';

export const changeRequestProvider: ApprovalProvider = {
  kind: 'cr',
  scope: 'project',
  source: 'db',
  async items({ viewer, project, lang, today }) {
    if (!project) return [];
    return changeRequestItems(await listChangeRequestDetails(project.code), viewer, project.code, lang, yearOfIso(today));
  },
  // Steps of the project's change requests the viewer decided in Keystone (the seed carries no decider).
  async decided({ viewer, project }) {
    if (!project) return 0;
    const crs = await listChangeRequestDetails(project.code);
    return crs.reduce((n, cr) => n + cr.chain.filter((s) => s.decidedAt && s.decidedBy === viewer.name && (s.decision === 'ok' || s.decision === 'rejected')).length, 0);
  },
};
