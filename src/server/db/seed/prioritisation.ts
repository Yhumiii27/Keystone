// Prioritisation seed: scoring axes (SCORE_AXES 3539), project scores (SCORES 3540 — the obsolete keys EWA-041,
// RBR-038 and CER-045 remapped to EWA-051, RBR-048 and CER-047, 11 §7 #12) and the capacity what-if demand rates
// per €1M of budget (`demandOf`, logic 4506). See schema/prioritisation.ts.
import { PROTO } from '@/server/prototype';
import { SCORE_CODE_REMAP, type ScoreAxis } from '../codes';
import { capacityDemandRates, portfolioScores, scoreAxes } from '../schema';
import type { Tx } from '../types';
import { must, type SeedCtx } from './context';

/** Hours of demand per €1M of budget by department (logic 4506), in ROLES order. */
export const DEMAND_HOURS_PER_MEUR: readonly [string, number][] = [
  ['Engineering', 140], ['Site operations', 90], ['MEP', 60], ['Controls & planning', 70], ['Quality', 40],
];

export async function seedPrioritisation(tx: Tx, ctx: SeedCtx): Promise<void> {
  const axes = PROTO.SCORE_AXES as [ScoreAxis, string, number][];
  await tx.insert(scoreAxes).values(axes.map(([code, label, defaultWeight], position) => ({ code, label, defaultWeight, position })));
  await tx.insert(portfolioScores).values(
    Object.entries(PROTO.SCORES as Record<string, number[]>).flatMap(([key, scores]) => {
      const projectId = must(ctx.projectByCode, SCORE_CODE_REMAP[key] ?? key, 'project');
      return axes.map(([axis], i) => ({ projectId, axis, score: scores[i] }));
    }),
  );
  await tx.insert(capacityDemandRates).values(
    DEMAND_HOURS_PER_MEUR.map(([name, hoursPerMeur], position) => ({ departmentId: must(ctx.departmentByName, name, 'department'), hoursPerMeur, position })),
  );
}
