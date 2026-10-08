import 'server-only';
// Kind "Forced stage change" (DB): stage moves forced on Projects without their deliverables, pending the portfolio
// director's validation (apprItems 4726; stage_transitions mode 'forced', validation 'pending'). Informational:
// no validation workflow yet (OPEN QUESTION L-1), the row opens the Projects register on that project.
import { screenHref } from '@/config/screens';
import type { ApprovalItem } from '@/domain/approvals';
import { displayOfIso } from '@/server/db/codes';
import { listProjects, projectLabel } from '@/server/dal/projects';
import { listPendingForcedStageChanges } from '@/server/dal/requests';
import type { ApprovalProvider } from './types';

export const forcedStageChangeProvider: ApprovalProvider = {
  kind: 'stage',
  scope: 'global',
  source: 'db',
  async items({ viewer }) {
    if (viewer.role !== 'director') return [];
    const [rows, projects] = await Promise.all([listPendingForcedStageChanges(), listProjects()]);
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
        decision: null,
      };
    });
  },
  async decided() {
    return 0;
  },
};
