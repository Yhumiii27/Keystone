import 'server-only';
// Cost DAL (docs/spec/04 §1.8): EVM series, offer quotes, cost streams, categories, work-package budgets,
// Budget change lines, reconciliation and note — plus the change-request register (HLT_CRS_X).
import { asc, eq, inArray } from 'drizzle-orm';
import { monthLabels } from '@/lib/format';
import { getDb } from '@/server/db/client';
import {
  ACTUALS_SOURCE, budgetChangeStatus, changeStatus, costType,
  type BudgetChangeStatus, type ChangeStatus, type ChangeStep, type ChangeType, type CostType, type StepDecision,
} from '@/server/db/codes';
import {
  budgetChangeLines, changeRequestSteps, changeRequestWbs, changeRequests, costCategories, costStreamPeriods, costStreams, evmPeriods,
  offerQuotes, projectControls, projects, wpBudgets,
} from '@/server/db/schema';
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

/** Budget › Structure & changes list (projectData().CRS). */
export interface BudgetChangeRow {
  /** "CR-008". */
  id: string;
  title: string;
  amount: number;
  days: number;
  status: BudgetChangeStatus;
  /** 'Approved' | 'Pending' | 'Rejected'. */
  statusLabel: string;
  /** "Review 30 Sep · Steering committee". */
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
  recon: { orig: number; chg: number; crCount: number; pending: number; pendingSub: string; cont: number; contUsed: number };
  note: string;
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
  const [evm, offer, streams, cats, wps, lines, stockByWp] = await Promise.all([
    db.select().from(evmPeriods).where(eq(evmPeriods.projectId, pid)).orderBy(asc(evmPeriods.monthIndex)),
    db.select().from(offerQuotes).where(eq(offerQuotes.projectId, pid)).orderBy(asc(offerQuotes.position)),
    db.select().from(costStreams).where(eq(costStreams.projectId, pid)).orderBy(asc(costStreams.position)),
    db.select().from(costCategories).where(eq(costCategories.projectId, pid)).orderBy(asc(costCategories.position)),
    db.select().from(wpBudgets).where(eq(wpBudgets.projectId, pid)).orderBy(asc(wpBudgets.position)),
    db.select().from(budgetChangeLines).where(eq(budgetChangeLines.projectId, pid)).orderBy(asc(budgetChangeLines.position)),
    stockCostByWorkPackage(pid),
  ]);
  const periods = streams.length
    ? await db.select().from(costStreamPeriods).where(inArray(costStreamPeriods.streamId, streams.map((s) => s.id))).orderBy(asc(costStreamPeriods.monthIndex))
    : [];
  const c = head.c;
  return {
    bac: head.bac,
    pv: evm.map((e) => e.pvKeur),
    ev: evm.filter((e) => e.evKeur != null).map((e) => e.evKeur!),
    ac: evm.filter((e) => e.acKeur != null).map((e) => e.acKeur!),
    start: c.startMonth, tNow: c.tNow, pct: Math.round(head.progress * 100), floatDays: c.floatDays,
    chartMonths: monthLabels(c.startMonth, 12), baselineSet: c.baselineSet,
    offer: offer.map((q) => ({
      system: q.system, supplier: q.supplierName, amount: q.amountKeur, terms: q.terms, depositPct: q.depositPct, deliveryPct: q.deliveryPct,
      acceptancePct: q.acceptancePct, orderMonth: q.orderMonth, deliveryMonth: q.deliveryMonth, acceptanceMonth: q.acceptanceMonth, leadWeeks: q.leadWeeks,
    })),
    streams: streams.map((s) => {
      const own = periods.filter((p) => p.streamId === s.id);
      return { name: s.name, basis: s.basis, monthly: own.length ? own.map((p) => p.amountKeur) : null };
    }),
    categories: cats.map((k) => ({
      code: k.code, name: k.name, costType: k.costType, costTypeLabel: costType.label(k.costType), source: ACTUALS_SOURCE[k.costType],
      budget: k.budgetKeur, actual: k.actualKeur, committed: k.committedKeur, forecast: k.forecastKeur,
    })),
    // SC-5a (R-098): stock material issued to the package's activities in Keystone is added to its actual cost.
    workPackages: wps.map((w) => ({
      wbs: w.wbsCode, name: w.name, original: w.originalKeur, changes: w.changesKeur, actual: w.actualKeur + (stockByWp.get(w.wbsCode) ?? 0), eac: w.eacKeur,
    })),
    changes: lines.map((l) => ({
      id: l.number, title: l.title, amount: l.amountKeur, days: l.scheduleDays, status: l.status, statusLabel: budgetChangeStatus.label(l.status), meta: l.meta,
    })),
    recon: {
      orig: c.reconOrigKeur, chg: c.reconChangesKeur, crCount: c.reconCrCount, pending: c.reconPendingKeur, pendingSub: c.reconPendingSub,
      cont: c.contingencyKeur, contUsed: c.contingencyUsedKeur,
    },
    note: c.note,
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
    bl: cr.baselineCode,
  }));
}
