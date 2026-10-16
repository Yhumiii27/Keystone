// Change seed: change-request register (HLT_CRS_X + CR-005 from HCRS), approval steps, WBS links, the Budget
// screen's change lines (projectData().CRS) and baselines (BASELINES). See schema/change.ts for the two datasets.
// Delivery 7 (NEW-D2-2, R-062): the activity the prototype tied to a request in its own code — A1250's drawer read "second
// crew (CR-008) pending approval" — becomes a real link (CR-008 touches A1250, no new duration given).
import { inferredContractImpact } from '@/domain/change-control';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { baselineState, budgetChangeStatus, CHANGE_STEPS, changeStatus, isoOfDemoDate, stepDecision, type ChangeType } from '../codes';
import { baselines, budgetChangeLines, changeRequestActivities, changeRequestSteps, changeRequestWbs, changeRequests } from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';

interface ProtoCr {
  id: string; title: string; types: ChangeType[]; amt: number; days: number; wbs: string[]; status: string; by: string; date: string;
  chain: Record<string, string>; bl: string;
}

export async function seedChange(tx: Tx, ctx: SeedCtx): Promise<void> {
  const code = 'HLT-026';
  const projectId = must(ctx.projectByCode, code, 'project');
  const wbs = must(ctx.wbs, code, 'project WBS');
  const crIds = new Map<string, string>();
  ctx.changeRequest.set(code, crIds);

  const register = PROTO.HLT_CRS_X as ProtoCr[];
  // Delivery 8 (R-069): the prototype has no contractual impact — inferred from its chain and figures (CR-007's client step
  // "n/a" → internal); the seeded decisions are kept as they are.
  const crRows = register.map((c, position) => ({
    id: newId(), projectId, number: c.id, title: c.title, types: c.types, amountKeur: c.amt, scheduleDays: c.days,
    status: changeStatus.code(c.status), requestedBy: c.by, requestedByPersonId: ctx.personByShort.get(c.by) ?? null,
    requestedOnText: c.date, requestedOn: isoOfDemoDate(c.date), baselineCode: c.bl, position,
    contractImpact: inferredContractImpact({ clientStep: stepDecision.code(c.chain.client), amountKeur: c.amt, scheduleDays: c.days }),
  }));
  // CR-005 only exists in the Budget dataset (HCRS): add it to the register (11 §7 #2).
  for (const [num, title, amt, days, status, meta] of PROTO.HCRS as [string, string, number, number, string, string][]) {
    if (register.some((c) => c.id === num)) continue;
    const [date, by] = meta.split(' · ');
    crRows.push({
      id: newId(), projectId, number: num, title, types: ['budget'], amountKeur: amt, scheduleDays: days,
      status: changeStatus.code(status), requestedBy: by, requestedByPersonId: ctx.personByShort.get(by) ?? null,
      requestedOnText: date, requestedOn: isoOfDemoDate(date), baselineCode: 'BL1', position: crRows.length,
      contractImpact: inferredContractImpact({ clientStep: null, amountKeur: amt, scheduleDays: days }),
    });
  }
  for (const c of crRows) crIds.set(c.number, c.id);
  await tx.insert(changeRequests).values(crRows);

  await tx.insert(changeRequestSteps).values(
    register.flatMap((c) =>
      CHANGE_STEPS.map((step, position) => ({ changeRequestId: crIds.get(c.id)!, step, decision: stepDecision.code(c.chain[step]), position })),
    ),
  );
  await tx.insert(changeRequestWbs).values(
    register.flatMap((c) =>
      c.wbs.map((wbsCode, position) => ({ id: newId(), changeRequestId: crIds.get(c.id)!, wbsCode, wbsNodeId: wbs.get(wbsCode) ?? null, position })),
    ),
  );

  /** The prototype's hard-coded activity of a request (`drawerVals`: A1250 · "second crew (CR-008) pending approval"). */
  const SEED_CR_ACTIVITIES: [cr: string, activity: string][] = [['CR-008', 'A1250']];
  const links = SEED_CR_ACTIVITIES.filter(([cr]) => crIds.has(cr));
  if (links.length) {
    await tx.insert(changeRequestActivities).values(
      links.map(([cr, activityCode], position) => ({ id: newId(), changeRequestId: crIds.get(cr)!, activityCode, newDurationDays: null, position })),
    );
  }

  // Budget change lines for every project with data (only HLT-026 has some).
  for (const [pCode, pd] of Object.entries(PROTO_GEN.projectData)) {
    const lines = pd.CRS as [string, string, number, number, string, string][];
    if (!lines.length) continue;
    const pid = must(ctx.projectByCode, pCode, 'project');
    const ids = ctx.changeRequest.get(pCode);
    await tx.insert(budgetChangeLines).values(
      lines.map(([num, title, amt, days, status, meta], position) => ({
        id: newId(), projectId: pid, number: num, title, amountKeur: amt, scheduleDays: days, status: budgetChangeStatus.code(status), meta,
        changeRequestId: ids?.get(num) ?? null, position,
      })),
    );
  }

  await tx.insert(baselines).values(
    (PROTO.BASELINES as [string, string, string, number, string, string][]).map(([blCode, name, setOn, bac, finish, state], position) => {
      const pending = /^Pending (CR-\d+)$/.exec(setOn);
      return {
        id: newId(), projectId, code: blCode, name, setOn: pending ? null : isoOfDemoDate(setOn), bacKeur: bac,
        finishDate: isoOfDemoDate(finish)!, state: baselineState.code(state), changeRequestId: pending ? must(crIds, pending[1], 'CR') : null, position,
      };
    }),
  );
}
