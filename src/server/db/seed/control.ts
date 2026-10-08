// Control seed: risk registers (RISKS_HLT + the prototype's generated registers), weekly status snapshots
// (HLT_SNAPS + generated series) and contingency (CONTINGENCY). See schema/control.ts.
import { evmCore } from '@/domain/evm';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { addDaysIso, contingencyLinkTypeOf, isoOfDisplayDate, isoWeekOf, riskCategory, riskResponse, riskStatus, type RiskTrend } from '../codes';
import { contingencyDraws, contingencyRegisters, risks, statusSnapshots } from '../schema';
import type { Tx } from '../types';
import { must, newId, personId, type SeedCtx } from './context';

interface ProtoRisk {
  id: string; title: string; cat: string; p: number; i: number; owner: string; resp: string; plan: string; act: string; emv: number;
  trig: string; status: string; trend: RiskTrend;
}

const HLT = 'HLT-026';

/**
 * Risk register of a project as the prototype builds it (logic 4572): RISKS_HLT for HLT-026; for the other
 * projects with data, RISKS_HLT[0..3] renumbered R-01…R-04, owned by the PM, no activity, EMV scaled to the BAC.
 * Projects without data get no register (the prototype would show Harbor Line's risks — 00 §7.16).
 */
export function protoRisks(code: string, pm: string, bac: number): ProtoRisk[] {
  const base = PROTO.RISKS_HLT as ProtoRisk[];
  if (code === HLT) return base;
  return base.slice(0, 4).map((r, i) => ({ ...r, id: 'R-0' + (i + 1), owner: pm, act: '', emv: Math.round((r.emv * bac) / 4800) }));
}

export interface SnapshotSeries {
  cpi: number[]; spi: number[]; eac: number[]; float: number[]; risk: number[]; slip: number[];
}

/**
 * 13 weekly snapshots of a project (logic 4558): HLT_SNAPS for HLT-026; otherwise linear series ending at the
 * live EVM values — g(end, start)[i] = start + (end − start)·i/12 rounded to 3 decimals.
 */
export function snapshotSeries(code: string): SnapshotSeries {
  if (code === HLT) return PROTO.HLT_SNAPS as SnapshotSeries;
  const pd = PROTO_GEN.projectData[code];
  const { cpi, spi, eac } = evmCore({ pv: pd.PV, ev: pd.EV, ac: pd.AC, bac: pd.BAC });
  const n = 13;
  const g = (end: number, start: number) => Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(3));
  const fd = pd.floatDays as number;
  return {
    cpi: g(cpi, Math.min(1.02, cpi + 0.04)),
    spi: g(spi, Math.min(1.02, spi + 0.03)),
    eac: g(eac, pd.BAC).map(Math.round),
    float: g(fd, Math.max(0, fd + 20)).map(Math.round),
    risk: g(90, 60).map(Math.round),
    slip: g(Math.max(0, -fd), 0).map(Math.round),
  };
}

/** Friday status dates of the 13 snapshots: 3 Jul … 25 Sep 2026 (SNAP_DATES 4566). */
export const SNAPSHOT_DATES: string[] = Array.from({ length: 13 }, (_, i) => addDaysIso('2026-07-03', 7 * i));

export async function seedControl(tx: Tx, ctx: SeedCtx): Promise<void> {
  const projectsWithData = Object.keys(PROTO_GEN.projectData);
  const initial = new Map(PROTO_GEN.initialProjects.map((p) => [p.code as string, p as { pm: string; budget: number }]));

  // Risks.
  const riskRows: (typeof risks.$inferInsert)[] = [];
  for (const code of projectsWithData) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const acts = must(ctx.activity, code, 'project activities');
    const ids = new Map<string, string>();
    ctx.risk.set(code, ids);
    const p = must(initial, code, 'project');
    protoRisks(code, p.pm, p.budget).forEach((r, i) => {
      const id = newId();
      ids.set(r.id, id);
      riskRows.push({
        id, projectId, number: r.id, title: r.title, category: riskCategory.code(r.cat), probability: r.p, impact: r.i,
        ownerPersonId: personId(ctx, r.owner), response: riskResponse.code(r.resp), responsePlan: r.plan,
        activityId: r.act ? must(acts, r.act, `activity of ${r.id}`) : null, emvKeur: r.emv, trigger: r.trig,
        status: riskStatus.code(r.status), trend: r.trend, sortOrder: i + 1,
      });
    });
  }
  await tx.insert(risks).values(riskRows);

  // Weekly status snapshots.
  const weeks = PROTO.SNAP_WEEKS as string[];
  if (weeks.some((w, i) => w !== `W${isoWeekOf(SNAPSHOT_DATES[i])}`)) throw new Error('Seed: SNAP_WEEKS do not match the Friday status dates');
  await tx.insert(statusSnapshots).values(
    projectsWithData.flatMap((code) => {
      const s = snapshotSeries(code);
      const projectId = must(ctx.projectByCode, code, 'project');
      return weeks.map((weekCode, i) => ({
        id: newId(), projectId, weekCode, statusDate: SNAPSHOT_DATES[i], cpi: s.cpi[i], spi: s.spi[i], eacKeur: s.eac[i],
        floatDays: s.float[i], riskEmvKeur: s.risk[i], milestoneSlipDays: s.slip[i], frozenAt: new Date(`${SNAPSHOT_DATES[i]}T07:40:00+02:00`),
      }));
    }),
  );

  // Contingency registers and draw-downs.
  for (const [code, reg] of Object.entries(PROTO.CONTINGENCY as Record<string, { initial: number; draws: [string, number, string, string, string][] }>)) {
    const registerId = newId();
    await tx.insert(contingencyRegisters).values({ id: registerId, projectId: must(ctx.projectByCode, code, 'project'), initialKeur: reg.initial });
    await tx.insert(contingencyDraws).values(
      reg.draws.map(([dateText, amount, reason, linkRef, approver], position) => {
        const linkedEntityType = contingencyLinkTypeOf(linkRef);
        const linkedEntityId =
          linkedEntityType === 'change_request' ? (ctx.changeRequest.get(code)?.get(linkRef) ?? null)
            : linkedEntityType === 'risk' ? (ctx.risk.get(code)?.get(linkRef) ?? null)
              : null;
        return {
          id: newId(), registerId, drawnOn: isoOfDisplayDate(dateText)!, amountKeur: amount, reason, linkRef: linkRef || null,
          linkedEntityType, linkedEntityId, approvedByPersonId: personId(ctx, approver), position,
        };
      }),
    );
  }
}
