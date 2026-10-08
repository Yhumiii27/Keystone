// Cost seed: materialises the cost side of projectData() — categories (CAT_ROWS + CATS), work-package
// budgets (WPS), offer quotes (OFFER), cost streams (STREAMS; HLT monthly values from HLT_STREAMS) and the
// cumulative PV / EV / AC series.
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { costType } from '../codes';
import { costCategories, costStreamPeriods, costStreams, evmPeriods, offerQuotes, wpBudgets } from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';

interface ProtoOffer { sys: string; sup: string; amt: number; terms: string; order: number; deliv: number; acc: number | null; lead: number }

export async function seedCost(tx: Tx, ctx: SeedCtx): Promise<void> {
  const hltMonthly = new Map((PROTO.HLT_STREAMS as [string, string, number[]][]).map(([name, , monthly]) => [name, monthly]));

  for (const [code, pd] of Object.entries(PROTO_GEN.projectData)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const wbs = must(ctx.wbs, code, 'project WBS');

    const cats = pd.CATS as [string, number, number, number, number][];
    const catRows = pd.CAT_ROWS as [string, string, string, string, number][];
    await tx.insert(costCategories).values(
      catRows.map(([catCode, name, type, , budget], position) => {
        const [cName, cBudget, actual, committed, forecast] = cats[position];
        if (cName !== name || cBudget !== budget) throw new Error(`Seed: CATS/CAT_ROWS mismatch for ${code} ${catCode}`);
        return {
          id: newId(), projectId, code: catCode, name, costType: costType.code(type),
          budgetKeur: budget, actualKeur: actual, committedKeur: committed, forecastKeur: forecast, position,
        };
      }),
    );

    await tx.insert(wpBudgets).values(
      (pd.WPS as [string, string, number, number, number, number][]).map(([wbsCode, name, original, changes, actual, eac], position) => ({
        id: newId(), projectId, wbsNodeId: wbs.get(wbsCode) ?? null, wbsCode, name,
        originalKeur: original, changesKeur: changes, actualKeur: actual, eacKeur: eac, position,
      })),
    );

    const offer = pd.OFFER as ProtoOffer[];
    if (offer.length)
      await tx.insert(offerQuotes).values(
        offer.map((q, position) => {
          const t = q.terms.split('/').map((x) => parseInt(x, 10));
          return {
            id: newId(), projectId, position, system: q.sys, supplierName: q.sup, amountKeur: q.amt, terms: q.terms,
            depositPct: t[0] ?? null, deliveryPct: t[1] ?? null, acceptancePct: t[2] ?? null,
            orderMonth: q.order, deliveryMonth: q.deliv, acceptanceMonth: q.acc, leadWeeks: q.lead,
          };
        }),
      );

    const streams = (pd.STREAMS as [string, string][]).map(([name, basis], position) => ({ id: newId(), projectId, position, name, basis }));
    await tx.insert(costStreams).values(streams);
    if (code === 'HLT-026') {
      const periods = streams.flatMap((s) =>
        must(hltMonthly, s.name, 'HLT stream').map((amountKeur, monthIndex) => ({ streamId: s.id, monthIndex, amountKeur })),
      );
      await tx.insert(costStreamPeriods).values(periods);
    }

    const PV = pd.PV as number[];
    const EV = pd.EV as number[];
    const AC = pd.AC as number[];
    await tx.insert(evmPeriods).values(
      PV.map((pv, monthIndex) => ({ projectId, monthIndex, pvKeur: pv, evKeur: EV[monthIndex] ?? null, acKeur: AC[monthIndex] ?? null })),
    );
  }
}
