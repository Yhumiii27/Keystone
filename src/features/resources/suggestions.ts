// "Suggested rebalancing" inputs (chapter 4, R-3 / S-7): DAL suggestions (ranked what-if levers) → view-model input, with
// the viewer's right to draft a request on each project (screen editable, project not read-only for them).
import type { ProjectRow } from '@/server/dal/projects';
import type { RebalancingSuggestion } from '@/server/dal/resources';
import type { SuggestionInput } from './model';
import { leverData } from './whatif-model';

export function suggestionInputs(rows: RebalancingSuggestion[], opts: { portfolio: boolean; canEdit: boolean; readOnly: (code: string) => boolean }): SuggestionInput[] {
  return rows.map((s) => {
    const { effect, ...lever } = leverData(s.lever, s.effect);
    return {
      projectCode: s.projectCode,
      projectLabel: opts.portfolio ? (s.projectShortName ?? s.projectName) : null,
      lever,
      effect,
      currentPeakPct: s.currentPeakPct,
      requested: s.requested,
      canApply: opts.canEdit && !opts.readOnly(s.projectCode),
    };
  });
}

/** `readOnly(code)` over the scope's pool (projects outside the pool are read-only). */
export const readOnlyIn = (pool: ProjectRow[], readOnly: (p: ProjectRow) => boolean) => (code: string) => {
  const p = pool.find((x) => x.code === code);
  return !p || readOnly(p);
};
