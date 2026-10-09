import 'server-only';
// Cash flow & billing DAL (docs/spec/03 §7 Cash flow, §6 margins, §8.5 client invoices; 11 §7 #3). One billing plan
// per project: derived from the contract when one exists (`billingOf`, logic 4515: value = base + signed
// amendments, milestones "{M} {label before ' ('}" priced round(value × share / 100), live status), else the legacy
// plan migrated from BILLING (fixed amounts). The 6-month cash forecast is computed from the billing plans and cost
// forecasts (A-12, chapter 4; the stored portfolio plan of the prototype is kept but no longer read).
import { asc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import { DEFAULT_DATA_DATE } from '@/domain/ch4-defaults';
import { cashForecast, lowestCumulativePoint } from '@/domain/kpis';
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
  amountKeur: number;
  status: PaymentMilestoneStatus;
  statusLabel: string;
}

export interface BillingPlan {
  projectCode: string;
  model: BillingModel;
  /** "Client · milestones", "Internal · capex". */
  modelLabel: string;
  /** Contract value (k€); 0 for internal projects. */
  contractValueKeur: number;
  /** No client revenue (contract value 0). */
  internal: boolean;
  /** The plan is derived from a registered contract. */
  fromContract: boolean;
  milestones: BillingPlanMilestone[];
  /** Σ milestones not planned, Σ paid, Σ invoiced not paid. */
  invoicedKeur: number;
  paidKeur: number;
  outstandingKeur: number;
  /** First planned milestone, null when everything is invoiced. */
  next: BillingPlanMilestone | null;
}

function summarise(projectCode: string, model: BillingModel, value: number, fromContract: boolean, milestones: BillingPlanMilestone[]): BillingPlan {
  const invoicedKeur = milestones.filter((m) => m.status !== 'planned').reduce((s, m) => s + m.amountKeur, 0);
  const paidKeur = milestones.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amountKeur, 0);
  return {
    projectCode, model, modelLabel: billingModel.label(model), contractValueKeur: value, internal: !value, fromContract, milestones, invoicedKeur, paidKeur,
    outstandingKeur: invoicedKeur - paidKeur, next: milestones.find((m) => m.status === 'planned') ?? null,
  };
}

/** Billing plans keyed by project code (projects with a billing plan only: the 6 with data). Memoised per request. */
export const listBillingPlans = cache(async (): Promise<Record<string, BillingPlan>> => {
  const db = await getDb();
  const plans = await db
    .select({ code: projects.code, plan: billingPlans })
    .from(billingPlans)
    .innerJoin(projects, eq(projects.id, billingPlans.projectId))
    .orderBy(asc(projects.sortOrder));
  const legacy = await db
    .select({ code: projects.code, m: paymentMilestones })
    .from(paymentMilestones)
    .innerJoin(projects, eq(projects.id, paymentMilestones.projectId))
    .where(isNull(paymentMilestones.contractId))
    .orderBy(asc(paymentMilestones.position));
  const out: Record<string, BillingPlan> = {};
  for (const { code, plan } of plans) {
    if (plan.contractValueKeur == null) {
      const c = await getContract(code);
      if (c) {
        out[code] = summarise(code, plan.model, c.valueKeur, true, c.milestones.map((m) => ({
          number: m.number, label: `${m.number} ${m.label.split(' (')[0]}`, amountKeur: m.amountKeur, status: m.status, statusLabel: m.statusLabel,
        })));
        continue;
      }
    }
    out[code] = summarise(code, plan.model, plan.contractValueKeur ?? 0, false, legacy.filter((r) => r.code === code).map(({ m }) => ({
      number: m.number, label: m.label, amountKeur: m.amountKeur ?? 0, status: m.status, statusLabel: paymentMilestoneStatus.label(m.status),
    })));
  }
  return out;
});

/** Billing plan of one project, null when it has none. */
export async function getBillingPlan(projectCode: string): Promise<BillingPlan | null> {
  return (await listBillingPlans())[projectCode] ?? null;
}

/** Margin of a project (`(contract − budget) / contract`, rounded %), null for internal projects or without a plan. */
export const marginPct = (plan: BillingPlan | null | undefined, budgetKeur: number): number | null =>
  plan && plan.contractValueKeur ? Math.round(((plan.contractValueKeur - budgetKeur) / plan.contractValueKeur) * 100) : null;

export interface CashForecastMonth {
  /** First day of the month (ISO). */
  month: string;
  /** "Oct", "Jan ’27" (CASH_M). */
  label: string;
  cashInKeur: number;
  cashOutKeur: number;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map((x) => parseInt(x, 10));
  return MON[m - 1] + (y > 2026 && m === 1 ? ' ’' + String(y).slice(2) : '');
};

/** The prototype's stored portfolio cash plan (next 6 months, k€) — no longer read by the screens since A-12 (chapter 4). */
export async function getPortfolioCashForecast(): Promise<CashForecastMonth[]> {
  const db = await getDb();
  const rows = await db.select().from(portfolioCashForecasts).orderBy(asc(portfolioCashForecasts.position));
  return rows.map((r) => ({ month: r.month, label: monthLabel(r.month), cashInKeur: r.cashInKeur, cashOutKeur: r.cashOutKeur }));
}

export interface CashFlowRow {
  project: ProjectRow;
  plan: BillingPlan;
  /** Margin %, null for internal projects. */
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

const EXECUTION = new Set(['etudes', 'approvisionnements', 'fabrication_assemblage', 'fat', 'expedition', 'chantier', 'mise_en_service_sat']);

/** Everything the Cash flow screen reads (03 §7). */
export async function getCashFlow(zone: ZoneKey | null): Promise<CashFlowData> {
  const [projects_, plans] = await Promise.all([listProjects(), listBillingPlans()]);
  const all = projects_.filter((p) => plans[p.code] && EXECUTION.has(p.stage));
  const inZone = all.filter((p) => !zone || p.zone === zone);
  const cv = (rows: ProjectRow[]) => rows.reduce((s, p) => s + plans[p.code].contractValueKeur, 0);
  const zoneShare = zone ? (cv(all) ? cv(inZone) / cv(all) : 0) : 1;
  const rows = inZone.map((p) => ({ project: p, plan: plans[p.code], marginPct: marginPct(plans[p.code], p.budget) }));
  // A-12: billing plan in, cost forecast out, at the portfolio data date (was the stored plan × zone share).
  const months = cashForecast(await cashProjectInputs(rows), DEFAULT_DATA_DATE);
  const low = lowestCumulativePoint(months);
  return {
    rows,
    zoneShare,
    forecast: months.map((m) => ({ month: m.month, label: monthLabel(m.month), cashInKeur: m.cashInKeur, cashOutKeur: m.cashOutKeur })),
    lowPoint: low ? { month: months[low.index].month, cumKeur: low.cumKeur, next: low.next && { project: low.next.project, label: low.next.label, progressMonth: low.next.progressMonth } } : null,
  };
}
