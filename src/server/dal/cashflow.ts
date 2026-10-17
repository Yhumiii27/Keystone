import 'server-only';
// Cash flow & billing DAL (docs/spec/03 §7 Cash flow, §6 margins, §8.5 client invoices; 11 §7 #3). One billing plan
// per project: derived from the contract when one exists (`billingOf`, logic 4515: value = base + signed
// amendments; milestones "{M} {label before ' ('}" — the base contract's and the signed amendments' own ones (NEW-D3-3) —
// at the contract's amounts, live status), else the legacy plan migrated from BILLING (fixed amounts). A plan is in its
// document's currency (C-9); the portfolio screens read it consolidated in euros at the project's budget rate
// (`listEurBillingPlans`). The 6-month cash forecast is computed from the billing plans and cost forecasts (A-12, chapter 4;
// the stored portfolio plan of the prototype is kept but no longer read).
import { businessToday } from '@/server/clock';
import { asc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import { BASE_CURRENCY, eurRate, type CurrencyCode } from '@/domain/currency';
import { cashForecast, lowestCumulativePoint, projectEacKeur, projectMarginPct } from '@/domain/kpis';
import type { PaymentTerms } from '@/domain/payment-terms';
import { yearOfIso } from '@/domain/clock';
import { inExecution } from '@/domain/portfolio';
import { getDb } from '@/server/db/client';
import { billingModel, paymentMilestoneStatus, type BillingModel, type PaymentMilestoneStatus } from '@/server/db/codes';
import { billingPlans, paymentMilestones, portfolioCashForecasts, projects } from '@/server/db/schema';
import type { ZoneKey } from '@/server/session';
import { getContract } from './contract';
import { cashProjectInputs } from './kpis';
import { listProjects, type ProjectRow } from './projects';

export interface BillingPlanMilestone {
  /** "M4" for contractual milestones, null for legacy plan rows. */
  number: string | null;
  /** "M4 Cranes operational" (contract) / "Jun", "Strip-out" (legacy plan). */
  label: string;
  /** In the plan's currency. */
  amountKeur: number;
  status: PaymentMilestoneStatus;
  statusLabel: string;
  /** Contractual date (contract milestones), null for legacy rows. */
  contractualDue: string | null;
  /** Due date of the milestone's invoice (invoiced / paid contract milestones, payment rule R-076), else null. */
  paymentDueOn: string | null;
  /** Invoice number and payment date (contract milestones). */
  invoiceNumber: string | null;
  paidOn: string | null;
}

export interface BillingPlan {
  projectCode: string;
  model: BillingModel;
  /** "Client · milestones", "Internal · capex". */
  modelLabel: string;
  /** C-9: currency of the amounts of this plan (the contract's; EUR for legacy plans, or once consolidated). */
  currency: CurrencyCode;
  /** Euros per unit of `currency` at the project's budget rate (1 for EUR). */
  eurRate: number;
  /** Contract value; 0 for internal projects. */
  contractValueKeur: number;
  /** No client revenue (contract value 0). */
  internal: boolean;
  /** The plan is derived from a registered contract. */
  fromContract: boolean;
  /** Payment rule of the contract (R-076); null for a legacy plan (Net 30 by default). */
  terms: PaymentTerms | null;
  milestones: BillingPlanMilestone[];
  /** Σ milestones not planned, Σ paid, Σ invoiced not paid. */
  invoicedKeur: number;
  paidKeur: number;
  outstandingKeur: number;
  /** First planned milestone, null when everything is invoiced. */
  next: BillingPlanMilestone | null;
}

function summarise(
  projectCode: string, model: BillingModel, value: number, fromContract: boolean, milestones: BillingPlanMilestone[],
  currency: CurrencyCode, rate: number, terms: PaymentTerms | null,
): BillingPlan {
  const invoicedKeur = milestones.filter((m) => m.status !== 'planned').reduce((s, m) => s + m.amountKeur, 0);
  const paidKeur = milestones.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amountKeur, 0);
  return {
    projectCode, model, modelLabel: billingModel.label(model), currency, eurRate: rate, contractValueKeur: value, internal: !value, fromContract, terms, milestones,
    invoicedKeur, paidKeur, outstandingKeur: invoicedKeur - paidKeur, next: milestones.find((m) => m.status === 'planned') ?? null,
  };
}

/**
 * Billing plans keyed by project code (projects with a billing plan only), each in its document's currency — the client portal
 * shows them so. Memoised per request. Portfolio screens read `listEurBillingPlans`.
 */
export const listBillingPlans = cache(async (): Promise<Record<string, BillingPlan>> => {
  const db = await getDb();
  const [plans, legacy] = await Promise.all([
    db.select({ code: projects.code, plan: billingPlans }).from(billingPlans).innerJoin(projects, eq(projects.id, billingPlans.projectId)).orderBy(asc(projects.sortOrder)),
    db.select({ code: projects.code, m: paymentMilestones }).from(paymentMilestones).innerJoin(projects, eq(projects.id, paymentMilestones.projectId))
      .where(isNull(paymentMilestones.contractId)).orderBy(asc(paymentMilestones.position)),
  ]);
  const out: Record<string, BillingPlan> = {};
  for (const { code, plan } of plans) {
    if (plan.contractValueKeur == null) {
      const c = await getContract(code);
      if (c) {
        out[code] = summarise(code, plan.model, c.valueKeur, true, c.milestones.filter((m) => m.billable).map((m) => ({
          number: m.number, label: `${m.number} ${m.label.split(' (')[0]}`, amountKeur: m.amountKeur, status: m.status, statusLabel: m.statusLabel,
          contractualDue: m.contractualDue, paymentDueOn: m.invoice?.dueOn ?? null, invoiceNumber: m.invoice?.number ?? null, paidOn: m.invoice?.paidOn ?? null,
        })), c.sheet.currency, eurRate(c.sheet.currency, c.fx), { rule: c.sheet.paymentRule, days: c.sheet.paymentDays });
        continue;
      }
    }
    // Legacy plans are the prototype's k€ figures (no contract, no currency).
    out[code] = summarise(code, plan.model, plan.contractValueKeur ?? 0, false, legacy.filter((r) => r.code === code).map(({ m }) => ({
      number: m.number, label: m.label, amountKeur: m.amountKeur ?? 0, status: m.status, statusLabel: paymentMilestoneStatus.label(m.status),
      contractualDue: null, paymentDueOn: null, invoiceNumber: null, paidOn: null,
    })), BASE_CURRENCY, 1, null);
  }
  return out;
});

/** A plan consolidated in euros at its budget rate (C-9): every amount × `eurRate`; currency EUR. */
export function inEuros(plan: BillingPlan): BillingPlan {
  if (plan.currency === BASE_CURRENCY && plan.eurRate === 1) return plan;
  const r = plan.eurRate;
  const milestones = plan.milestones.map((m) => ({ ...m, amountKeur: m.amountKeur * r }));
  return {
    ...plan, currency: BASE_CURRENCY, eurRate: 1, contractValueKeur: plan.contractValueKeur * r, milestones,
    invoicedKeur: plan.invoicedKeur * r, paidKeur: plan.paidKeur * r, outstandingKeur: plan.outstandingKeur * r,
    next: plan.next ? milestones[plan.milestones.indexOf(plan.next)] : null,
  };
}

/** Billing plans consolidated in euros (Cash flow, Prioritisation, capacity, portfolio margin, alerts). Memoised per request. */
export const listEurBillingPlans = cache(async (): Promise<Record<string, BillingPlan>> =>
  Object.fromEntries(Object.entries(await listBillingPlans()).map(([code, p]) => [code, inEuros(p)])),
);

/** Billing plan of one project in its document's currency, null when it has none. */
export async function getBillingPlan(projectCode: string): Promise<BillingPlan | null> {
  return (await listBillingPlans())[projectCode] ?? null;
}

/**
 * Margin at completion of a project (C-10b, R-132): (contract in euros − EAC) / contract — `projectMarginPct` over the plan
 * consolidated in euros and `projectEacKeur`; null for internal projects or without a plan.
 */
export const marginAtCompletion = (plan: BillingPlan | null | undefined, p: Pick<ProjectRow, 'budget' | 'actual' | 'progress'>): number | null =>
  plan ? projectMarginPct(inEuros(plan).contractValueKeur, projectEacKeur(p)) : null;

export interface CashForecastMonth {
  /** First day of the month (ISO). */
  month: string;
  /** "Oct", "Jan ’27" (CASH_M). */
  label: string;
  cashInKeur: number;
  cashOutKeur: number;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct" / "Jan ’28": a January after the business year `year` carries its year (R-013; the prototype compared with 2026). */
const monthLabel = (iso: string, year: number) => {
  const [y, m] = iso.split('-').map((x) => parseInt(x, 10));
  return MON[m - 1] + (y > year && m === 1 ? ' ’' + String(y).slice(2) : '');
};

/** The prototype's stored portfolio cash plan (next 6 months, k€) — no longer read by the screens since A-12 (chapter 4). */
export async function getPortfolioCashForecast(): Promise<CashForecastMonth[]> {
  const db = await getDb();
  const rows = await db.select().from(portfolioCashForecasts).orderBy(asc(portfolioCashForecasts.position));
  const year = yearOfIso(await businessToday());
  return rows.map((r) => ({ month: r.month, label: monthLabel(r.month, year), cashInKeur: r.cashInKeur, cashOutKeur: r.cashOutKeur }));
}

export interface CashFlowRow {
  project: ProjectRow;
  /** Billing plan consolidated in euros (C-9). */
  plan: BillingPlan;
  /** Margin at completion % (C-10b), null for internal projects. */
  marginPct: number | null;
}

export interface CashFlowData {
  /** Projects in execution with a billing plan, zone-filtered, register order (`cashRows`). */
  rows: CashFlowRow[];
  /** Contract value of the zone ÷ contract value of every cash project (1 without a zone, 0 when nothing to share). */
  zoneShare: number;
  /**
   * A-12 (chapter 4): the 6 months after the portfolio data date, computed from the rows' billing plans (cash in) and
   * cost forecasts (cash out) — `cashForecast`, src/domain/kpis.ts. The prototype scaled a stored plan by the zone share.
   */
  forecast: CashForecastMonth[];
  /** "Lowest cumulative point": month (ISO first day), cumulative net and the payment it waits for; null when no month. */
  lowPoint: { month: string; cumKeur: number; next: { project: string; label: string; progressMonth?: string } | null } | null;
}


/** Everything the Cash flow screen reads (03 §7). */
export async function getCashFlow(zone: ZoneKey | null): Promise<CashFlowData> {
  // C-9: the portfolio is consolidated in euros at each project's budget rate.
  const [projects_, plans, today] = await Promise.all([listProjects(), listEurBillingPlans(), businessToday()]);
  const all = projects_.filter((p) => plans[p.code] && inExecution(p));
  const inZone = all.filter((p) => !zone || p.zone === zone);
  const cv = (rows: ProjectRow[]) => rows.reduce((s, p) => s + plans[p.code].contractValueKeur, 0);
  const zoneShare = zone ? (cv(all) ? cv(inZone) / cv(all) : 0) : 1;
  // C-10b (R-132): margin at completion (contract − EAC) / contract.
  const rows = inZone.map((p) => ({ project: p, plan: plans[p.code], marginPct: marginAtCompletion(plans[p.code], p) }));
  // A-12: billing plan in, cost forecast out, at the business date (R-013; was the stored plan × zone share).
  const months = cashForecast(await cashProjectInputs(rows), today);
  const low = lowestCumulativePoint(months);
  return {
    rows,
    zoneShare,
    forecast: months.map((m) => ({ month: m.month, label: monthLabel(m.month, yearOfIso(today)), cashInKeur: m.cashInKeur, cashOutKeur: m.cashOutKeur })),
    lowPoint: low ? { month: months[low.index].month, cumKeur: low.cumKeur, next: low.next && { project: low.next.project, label: low.next.label, progressMonth: low.next.progressMonth } } : null,
  };
}
