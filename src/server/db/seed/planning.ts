// Planning seed: materialises projectData() (HLT_PD + the 5 generated projects) — WBS nodes, activities,
// links, milestones, schedule bars, the project control header — plus A1250_RES.
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { isoOfDisplayDate, milestoneStatus, parseConstraint, splitActual, type LinkType } from '../codes';
import { activities, activityAssignments, activityLinks, milestones, projectControls, scheduleBars, wbsNodes } from '../schema';
import type { Tx } from '../types';
import { must, newId, personId, type SeedCtx } from './context';

/** Orders placed not yet in actual cost on HLT-026 (`openCommit = 713`, 04 §1.6) until purchase orders are modelled. */
const HLT_ORDERS_PLACED_KEUR = 713;

/** Prototype ACTS row (docs/spec/05 Data entities). */
export interface ProtoAct {
  id?: string;
  w: string;
  n: string;
  lv?: number;
  d?: number;
  s?: string;
  f?: string;
  bl?: string;
  v?: number;
  p?: [string, LinkType, number][];
  c?: string;
  viol?: boolean;
  tf?: number | null;
  pc?: number;
  o?: string;
  b?: [number, number, number];
  pkg?: string;
}

export async function seedPlanning(tx: Tx, ctx: SeedCtx): Promise<void> {
  for (const [code, pd] of Object.entries(PROTO_GEN.projectData)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const acts = pd.ACTS as ProtoAct[];

    // WBS nodes (root + work packages) and activities share ACTS positions.
    const wbsIds = new Map<string, string>();
    const actIds = new Map<string, string>();
    ctx.wbs.set(code, wbsIds);
    ctx.activity.set(code, actIds);
    let rootId: string | null = null;
    const nodeRows: (typeof wbsNodes.$inferInsert)[] = [];
    const actRows: (typeof activities.$inferInsert)[] = [];
    acts.forEach((a, position) => {
      if (!a.id) {
        const id = newId();
        if (a.lv === 0) rootId = id;
        wbsIds.set(a.w, id);
        nodeRows.push({
          id, projectId, code: a.w, name: a.n, level: a.lv ?? 1, parentId: a.lv === 0 ? null : rootId, position,
          startText: a.s ?? null, finishText: a.f ?? null, baselineFinishText: a.bl ?? null, totalFloatDays: a.tf ?? null,
        });
        return;
      }
      const id = newId();
      actIds.set(a.id, id);
      const s = splitActual(a.s!);
      const f = splitActual(a.f!);
      const cons = parseConstraint(a.c);
      actRows.push({
        id, projectId, wbsNodeId: must(wbsIds, a.w, `WBS node of ${a.id}`), code: a.id, name: a.n, durationDays: a.d!,
        startText: s.text, startActual: s.actual, finishText: f.text, finishActual: f.actual,
        startDate: isoOfDisplayDate(s.text), finishDate: isoOfDisplayDate(f.text),
        baselineFinishText: a.bl!, baselineFinishDate: isoOfDisplayDate(a.bl), varianceDays: a.v!,
        constraintType: cons?.type ?? null, constraintDateText: cons?.date ?? null, constraintDate: cons ? isoOfDisplayDate(cons.date) : null,
        constraintViolated: !!a.viol, totalFloatDays: a.tf ?? null, percentComplete: a.pc!,
        ownerPersonId: a.o ? must(ctx.personByOwner, a.o, 'owner') : null,
        budgetKeur: a.b![0], actualKeur: a.b![1], eacKeur: a.b![2], packageName: a.pkg ?? null, position,
      });
    });
    await tx.insert(wbsNodes).values(nodeRows);
    await tx.insert(activities).values(actRows);

    const links = acts.flatMap((a) =>
      (a.p ?? []).map(([pred, type, lag], position) => ({
        id: newId(), projectId, predecessorId: must(actIds, pred, `predecessor of ${a.id}`), successorId: actIds.get(a.id!)!, type, lagDays: lag, position,
      })),
    );
    if (links.length) await tx.insert(activityLinks).values(links);

    await tx.insert(milestones).values(
      (pd.MILES as [string, number, number, string][]).map(([name, baselineMonth, forecastMonth, status], position) => ({
        id: newId(), projectId, position, name, baselineMonth, forecastMonth, status: milestoneStatus.code(status),
      })),
    );

    // Schedule bars: one per work package (matched by name, else by order).
    const wpByName = new Map(nodeRows.filter((n) => n.level === 1).map((n) => [n.name, n.id!]));
    await tx.insert(scheduleBars).values(
      (pd.TASKS as [string, string, number, number, number, number, number, boolean][]).map(([name, owner, bs, be, as, ae, pc, crit], position) => ({
        id: newId(), projectId, wbsNodeId: wpByName.get(name) ?? wbsIds.get(`1.${position + 1}`) ?? null, position, name,
        ownerPersonId: personId(ctx, owner), baselineStart: bs, baselineEnd: be, forecastStart: as, forecastEnd: ae, percentComplete: pc, critical: crit,
      })),
    );

    const r = pd.recon;
    await tx.insert(projectControls).values({
      projectId, startMonth: pd.start, tNow: pd.tNow, floatDays: pd.floatDays, finishText: pd.finishText, baselineText: pd.baselineText,
      floatText: pd.floatText, floatShort: pd.floatShort, critText: pd.critText, milesText: pd.milesText, milesSub: pd.milesSub,
      baselineSet: pd.baselineSet, reconOrigKeur: r.orig, reconChangesKeur: r.chg, reconCrCount: r.crCount, reconPendingKeur: r.pending,
      reconPendingSub: r.pendingSub, contingencyKeur: r.cont, contingencyUsedKeur: r.contUsed, note: pd.note,
      // Cash & recovery "orders placed": the prototype's literal for HLT-026 (logic 4908); the others use the PV rule.
      ordersPlacedKeur: code === 'HLT-026' ? HLT_ORDERS_PLACED_KEUR : null,
    });
  }

  // Resource assignments of A1250 (HLT-026).
  const a1250 = must(must(ctx.activity, 'HLT-026', 'project activities'), 'A1250', 'activity');
  await tx.insert(activityAssignments).values(
    (PROTO.A1250_RES as [string, string, string, string][]).map(([resource, detail, units, progressText], position) => ({
      id: newId(), activityId: a1250, position, resource, personId: ctx.personByFull.get(resource) ?? null, detail, units, progressText,
    })),
  );
}
