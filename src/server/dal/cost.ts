import 'server-only';
// Cost DAL (docs/spec/04 §1.8): EVM series, offer quotes, cost streams, categories, work-package budgets,
// Budget change list, reconciliation and note — plus the change-request register (HLT_CRS_X).
// Delivery 7 (lot cost-control):
//  - R-073: PV / EV / AC, progress, the work packages' actual / EAC and the orders placed are computed from Keystone data
//    (src/server/dal/evm.ts); the seeded series (`evm_periods`) stay only for a project without activity budgets;
//  - R-068 (A-4): the change list, "Approved changes", "Pending" and the work packages' "Changes" read the single register
//    (`change_requests`) — `budget_change_lines` and the seeded reconciliation figures are no longer read;
//  - R-070 (A-8): the contingency drawn is the register's validated draw-downs; the forecast consumption shows apart.
import { asc, eq, inArray } from 'drizzle-orm';
import { budgetChangeRows, contingencyTile, pendingSubText, registerReconciliation, workPackageChanges } from '@/domain/cost-control';
import { monthLabels } from '@/lib/format';
import { getDb } from '@/server/db/client';
import {
  ACTUALS_SOURCE, changeStatus, costType,
  type ChangeStatus, type ChangeStep, type ChangeType, type CostType, type StepDecision,
} from '@/server/db/codes';
import {
  activities, changeRequestSteps, changeRequestWbs, changeRequests, costCategories, costStreamPeriods, costStreams, evmPeriods,
  offerQuotes, projectControls, projects, wbsNodes, wpBudgets,
} from '@/server/db/schema';
import { getContingencyTotals } from './contingency';
import { getOpenCommitment, getProjectEvm } from './evm';
import { stockCostByWorkPackage } from './stock';

export interface OfferQuoteRow {
  /** "Structural steel — columns, beams, purlins". */
  system: string;
  supplier: string;
  amount: number;
  /** "30 / 60 / 10" (deposit / delivery / acceptance %, positional). */
  terms: string;
  depositPct: number | null;
  deliveryPct: number | null;
  acceptancePct: number | null;
  /** Month indexes from the project start (chartMonths). */
  orderMonth: number;
  deliveryMonth: number;
  acceptanceMonth: number | null;
  leadWeeks: number;
}

export interface CostStreamRow {
  name: string;
  basis: string;
  /** 12 monthly k€ values when known (HLT-026), else null. */
  monthly: number[] | null;
}

export interface CostCategoryRow {
  /** "C01". */
  code: string;
  name: string;
  costType: CostType;
  /** 'Labor' | 'Material' | 'Equipment' | 'Subcontract' | 'Fees' | 'Reserve'. */
  costTypeLabel: string;
  /** Actuals source (SRC_OF), EN source string. */
  source: string;
  budget: number;
  actual: number;
  committed: number;
  forecast: number;
}

export interface WpBudgetRow {
  /** "1.4", or "—" for the unallocated contingency. */
  wbs: string;
  name: string;
  original: number;
  changes: number;
  actual: number;
  eac: number;
}

/** Budget › Structure & changes list: the change-request register without its drafts (delivery 7, A-4). */
export interface BudgetChangeRow {
  /** "CR-008". */
  id: string;
  title: string;
  amount: number;
  days: number;
  status: ChangeStatus;
  /** 'In review' | 'Approved' | 'Rejected'. */
  statusLabel: string;
  /** "24 Sep · R. Aubert" (raised on · by). */
  meta: string;
}

export interface CostControl {
  /** Budget at completion (k€). */
  bac: number;
  /** Cumulative monthly series (k€); PV has 12 months, EV/AC stop at the data date. */
  pv: number[];
  ev: number[];
  ac: number[];
  /** Project start (month offset from Jan 2026), data date (months since start), progress %, float. */
  start: number;
  tNow: number;
  pct: number;
  floatDays: number;
  chartMonths: string[];
  baselineSet: string;
  offer: OfferQuoteRow[];
  streams: CostStreamRow[];
  categories: CostCategoryRow[];
  workPackages: WpBudgetRow[];
  changes: BudgetChangeRow[];
  /**
   * Reconciliation: original budget (BL1), approved and pending changes of the register (A-4), the contingency provision,
   * its drawn part — the register's validated draw-downs (A-8) — the forecast consumption shown apart and the draw-downs
   * awaiting validation (C-4).
   */
  recon: {
    orig: number; chg: number; crCount: number; pending: number; pendingSub: string; cont: number; contUsed: number; contForecast: number; contPending: number;
  };
  note: string;
  /** Orders placed and not yet received, k€ (R-073: the project's purchase orders). */
  ordersPlaced: number;
  /** 'keystone' = PV / EV / AC computed from the activities and the baseline (R-073); 'seed' = the prototype's series (no activity budget). */
  evmSource: 'keystone' | 'seed';
}

/** The prototype's generated notes quote the CPI: rebuilt from the computed CPI (A-12); a written narrative is kept. */
export function costNote(stored: string, cpi: number | null): string {
  if (cpi == null || !/^(Spending is running ahead of earned value|Cost performance is healthy) \(CPI [\d.]+\)/.test(stored)) return stored;
  const c = cpi.toFixed(2);
  return cpi < 0.97
    ? `Spending is running ahead of earned value (CPI ${c}); the forecast at completion exceeds the budget.`
    : `Cost performance is healthy (CPI ${c}); the forecast at completion sits within budget.`;
}

/** Cost-control data of a project (projectData() cost side); null for projects without data. */
export async function getCostControl(code: string): Promise<CostControl | null> {
  const db = await getDb();
  const [head] = await db
    .select({ c: projectControls, projectId: projects.id, bac: projects.budgetKeur, progress: projects.progress })
    .from(projectControls)
    .innerJoin(projects, eq(projects.id, projectControls.projectId))
    .where(eq(projects.code, code));
  if (!head) return null;
  const pid = head.projectId;
  const [evmRows, offer, streams, cats, wps, crs, acts, evm, ordersPlaced, contingency, stockByWp] = await Promise.all([
    db.select().from(evmPeriods).where(eq(evmPeriods.projectId, pid)).orderBy(asc(evmPeriods.monthIndex)),
    db.select().from(offerQuotes).where(eq(offerQuotes.projectId, pid)).orderBy(asc(offerQuotes.position)),
    db.select().from(costStreams).where(eq(costStreams.projectId, pid)).orderBy(asc(costStreams.position)),
    db.select().from(costCategories).where(eq(costCategories.projectId, pid)).orderBy(asc(costCategories.position)),
    db.select().from(wpBudgets).where(eq(wpBudgets.projectId, pid)).orderBy(asc(wpBudgets.position)),
    listChangeRequests(code),
    db
      .select({ wbs: wbsNodes.code, actual: activities.actualKeur, eac: activities.eacKeur })
      .from(activities)
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .where(eq(activities.projectId, pid)),
    getProjectEvm(code),
    getOpenCommitment(code),
    getContingencyTotals(code),
    stockCostByWorkPackage(pid),
  ]);
  const periods = streams.length
    ? await db.select().from(costStreamPeriods).where(inArray(costStreamPeriods.streamId, streams.map((s) => s.id))).orderBy(asc(costStreamPeriods.monthIndex))
    : [];
  const c = head.c;
  // Register (A-4): reconciliation and work-package changes.
  const register = crs.map((r) => ({ id: r.id, amount: r.amount, status: r.status, wbs: r.wbsAlloc, clientStep: r.chain.client ?? null }));
  const rec = registerReconciliation(register);
  const wpChanges = workPackageChanges(register, wps.map((w) => ({ code: w.wbsCode, original: w.originalKeur })));
  // Contingency (A-8): drawn from the register, the forecast consumption apart.
  const provision = contingency?.initial ?? c.contingencyKeur;
  const drawn = contingency?.drawn ?? 0;
  const tile = contingencyTile(provision, drawn, c.contingencyUsedKeur);
  const firstMaterial = cats.find((k) => k.costType === 'material')?.id;
  const sumBy = (wbs: string, key: 'actual' | 'eac') => acts.filter((a) => a.wbs === wbs).reduce((t, a) => t + a[key], 0);
  return {
    bac: head.bac,
    // R-073: computed from Keystone data; the seeded series only for a project without activity budgets.
    pv: evm ? evm.series.pv : evmRows.map((e) => e.pvKeur),
    ev: evm ? evm.series.ev : evmRows.filter((e) => e.evKeur != null).map((e) => e.evKeur!),
    ac: evm ? evm.series.ac : evmRows.filter((e) => e.acKeur != null).map((e) => e.acKeur!),
    start: c.startMonth, tNow: c.tNow, pct: Math.round((evm?.progress ?? head.progress) * 100), floatDays: c.floatDays,
    chartMonths: monthLabels(c.startMonth, 12), baselineSet: c.baselineSet,
    offer: offer.map((q) => ({
      system: q.system, supplier: q.supplierName, amount: q.amountKeur, terms: q.terms, depositPct: q.depositPct, deliveryPct: q.deliveryPct,
      acceptancePct: q.acceptancePct, orderMonth: q.orderMonth, deliveryMonth: q.deliveryMonth, acceptanceMonth: q.acceptanceMonth, leadWeeks: q.leadWeeks,
    })),
    streams: streams.map((s) => {
      const own = periods.filter((p) => p.streamId === s.id);
      return { name: s.name, basis: s.basis, monthly: own.length ? own.map((p) => p.amountKeur) : null };
    }),
    categories: cats.map((k) => {
      const reserve = k.costType === 'reserve';
      return {
        code: k.code, name: k.name, costType: k.costType, costTypeLabel: costType.label(k.costType), source: ACTUALS_SOURCE[k.costType], budget: k.budgetKeur,
        // A-8: the reserve line is the contingency register (drawn; forecast apart). R-073: the (first) material line commits the
        // open purchase orders ("Purchase orders + receipts"); the other lines keep their figures until Cursus / Sage X3 (R-074).
        actual: reserve ? drawn : k.actualKeur,
        committed: k.id === firstMaterial ? ordersPlaced : k.committedKeur,
        forecast: reserve ? tile.forecast : k.forecastKeur,
      };
    }),
    workPackages: wps.map((w) => {
      if (w.wbsCode === '—') return { wbs: w.wbsCode, name: w.name, original: w.originalKeur, changes: 0, actual: drawn, eac: tile.forecast };
      const has = acts.some((a) => a.wbs === w.wbsCode);
      return {
        wbs: w.wbsCode, name: w.name, original: w.originalKeur, changes: wpChanges.get(w.wbsCode) ?? 0,
        // SC-5a (R-098): stock material issued to the package's activities in Keystone is added to its actual cost.
        actual: (has ? sumBy(w.wbsCode, 'actual') : w.actualKeur) + (stockByWp.get(w.wbsCode) ?? 0), eac: has ? sumBy(w.wbsCode, 'eac') : w.eacKeur,
      };
    }),
    changes: budgetChangeRows(crs).map((r) => ({
      id: r.id, title: r.title, amount: r.amount, days: r.days, status: r.status, statusLabel: r.statusLabel, meta: `${r.date} · ${r.by}`,
    })),
    recon: {
      orig: c.reconOrigKeur, chg: rec.approved, crCount: rec.approvedCount, pending: rec.pending, pendingSub: pendingSubText(rec.pendingIds, crs.length),
      cont: provision, contUsed: drawn, contForecast: tile.forecast, contPending: contingency?.pending ?? 0,
    },
    note: costNote(c.note, evm?.cpi ?? null),
    ordersPlaced,
    evmSource: evm ? 'keystone' : 'seed',
  };
}

/** Change-control register entry (HLT_CRS_X shape with codes). */
export interface ChangeRequestRow {
  /** "CR-008". */
  id: string;
  title: string;
  types: ChangeType[];
  amount: number;
  days: number;
  status: ChangeStatus;
  /** 'Draft' | 'In review' | 'Approved' | 'Rejected'. */
  statusLabel: string;
  /** "R. Aubert" / "Steering committee". */
  by: string;
  /** "24 Sep". */
  date: string;
  /** Approval chain decisions (codes: 'na' is the prototype's 'n/a'); empty when unknown (CR-005). */
  chain: Partial<Record<ChangeStep, StepDecision>>;
  wbs: string[];
  /** WBS with the amount allocated to each when entered (delivery 7: the Budget's work-package changes, A-4). */
  wbsAlloc: { code: string; amount: number | null }[];
  /** Baseline code "BL1" / "BL2". */
  bl: string | null;
}

/** Change requests of a project, register order (HLT_CRS_X, then CR-005 from the Budget dataset). */
export async function listChangeRequests(code: string): Promise<ChangeRequestRow[]> {
  const db = await getDb();
  const crs = await db
    .select({ cr: changeRequests })
    .from(changeRequests)
    .innerJoin(projects, eq(projects.id, changeRequests.projectId))
    .where(eq(projects.code, code))
    .orderBy(asc(changeRequests.position));
  if (!crs.length) return [];
  const ids = crs.map(({ cr }) => cr.id);
  const [steps, wbs] = await Promise.all([
    db.select().from(changeRequestSteps).where(inArray(changeRequestSteps.changeRequestId, ids)).orderBy(asc(changeRequestSteps.position)),
    db.select().from(changeRequestWbs).where(inArray(changeRequestWbs.changeRequestId, ids)).orderBy(asc(changeRequestWbs.position)),
  ]);
  return crs.map(({ cr }) => ({
    id: cr.number, title: cr.title, types: cr.types, amount: cr.amountKeur, days: cr.scheduleDays, status: cr.status,
    statusLabel: changeStatus.label(cr.status), by: cr.requestedBy, date: cr.requestedOnText,
    chain: Object.fromEntries(steps.filter((s) => s.changeRequestId === cr.id).map((s) => [s.step, s.decision])),
    wbs: wbs.filter((w) => w.changeRequestId === cr.id).map((w) => w.wbsCode),
    wbsAlloc: wbs.filter((w) => w.changeRequestId === cr.id).map((w) => ({ code: w.wbsCode, amount: w.amountKeur })),
    bl: cr.baselineCode,
  }));
}
