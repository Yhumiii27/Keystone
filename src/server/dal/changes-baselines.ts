import 'server-only';
// Baseline register of the Change control screen (docs/spec/07 §2.2 › Baselines, 4.3). Harbor Line has recorded
// baselines (BASELINES: BL0, BL1, BL2 proposed by CR-009). The other projects with planning data only carry their
// approved baseline in the project controls (`baselineSet`, `baselineText`, `recon.orig`) — the date the Plan
// chip and the Budget reconciliation show as "BL1 · 9 Apr 2026" — so their register lists that BL1 instead of the
// prototype's Harbor Line rows (00 §7.16). Projects without data have no baseline.
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { baselineState, isoOfDisplayDate } from '@/server/db/codes';
import { projectControls, projects } from '@/server/db/schema';
import { getBaselines, type BaselineRow } from './planning';

/** Recorded baselines, else the approved BL1 implied by the project controls; [] without data. */
export async function getBaselineRegister(code: string): Promise<BaselineRow[]> {
  const recorded = await getBaselines(code);
  if (recorded.length) return recorded;
  const db = await getDb();
  const [c] = await db
    .select({ setOn: projectControls.baselineSet, finish: projectControls.baselineText, orig: projectControls.reconOrigKeur })
    .from(projectControls)
    .innerJoin(projects, eq(projects.id, projectControls.projectId))
    .where(eq(projects.code, code));
  if (!c) return [];
  return [
    {
      code: 'BL1', name: 'Approved baseline', setOn: c.setOn, setOnDate: isoOfDisplayDate(c.setOn), bac: c.orig, finish: c.finish,
      finishDate: isoOfDisplayDate(c.finish) ?? '', state: 'current', stateLabel: baselineState.label('current'), changeRequest: null,
    },
  ];
}
