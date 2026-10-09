import 'server-only';
// Kind "Forced stage change" (DB): stage moves forced on Projects without their deliverables, pending the portfolio
// director's validation (apprItems 4726; stage_transitions mode 'forced', validation 'pending'). Chapter 4 (L-1 default,
// src/domain/forced-stage.ts): decided inline — Approve keeps the stage, Reject reverts the project to the stage it left
// (decideForcedStageChangeAction → src/server/dal/lifecycle.ts decideForcedStageChange). The row still opens the
// Projects register on that project. "Decided this week": the forced moves the viewer approved or rejected.
import { screenHref } from '@/config/screens';
import type { ApprovalItem } from '@/domain/approvals';
import { isForcedStageDecider } from '@/domain/forced-stage';
import { displayOfIso } from '@/server/db/codes';
import { countForcedStageDecisions, listPendingForcedTransitions } from '@/server/dal/lifecycle';
import { listProjects, projectLabel } from '@/server/dal/projects';
import type { ApprovalProvider } from './types';

export const forcedStageChangeProvider: ApprovalProvider = {
  kind: 'stage',
  scope: 'global',
  source: 'db',
  async items({ viewer }) {
    if (!isForcedStageDecider(viewer.role)) return [];
    const [rows, projects] = await Promise.all([listPendingForcedTransitions(), listProjects()]);
    return rows.map((r): ApprovalItem => {
      const p = projects.find((x) => x.code === r.projectCode);
      return {
        kind: 'stage',
        id: r.projectCode,
        title: `${p ? projectLabel(p) : r.projectName} → ${r.stageLabel}`,
        sub: r.reason ?? '',
        when: displayOfIso(r.effectiveOn),
        whenIso: r.effectiveOn,
        // Who forced it (the prototype showed the project's PM).
        who: r.requestedBy ?? p?.pm ?? r.pm ?? '—',
        href: `${screenHref('projects')}?${new URLSearchParams({ q: r.projectCode })}`,
        decision: { mode: 'stage', projectCode: r.projectCode, transitionId: r.id, fromLabel: r.fromLabel },
      };
    });
  },
  async decided({ viewer }) {
    if (!isForcedStageDecider(viewer.role)) return 0;
    return countForcedStageDecisions(viewer.name);
  },
};
