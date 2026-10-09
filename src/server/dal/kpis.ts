import 'server-only';
// Chapter 4 — A-12: the database reads behind the KPIs that used to be prototype constants. The formulas live in
// src/domain/kpis.ts (pure, tested); this module only gathers their inputs and is called by the screen getters
// (cash flow, prioritisation, sourcing, deliveries, site, drawings, quality, My work, Home, Activity & integrations).
// Values are computed at the project's data date (`projects.data_date`, default the status date) or the portfolio data
// date — never the real clock. No writer here.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lt, or } from 'drizzle-orm';
import { projectDataDate, DEFAULT_DATA_DATE } from '@/domain/ch4-defaults';
import {
  CAPACITY_WINDOW_WEEKS, DEFAULT_PAYMENT_DAYS, demandPerMeur, departmentCapacity, eventsOnDay, finishOfMonthText,
  latestVaultSync, leadingCount, loggedInWeek, nextWeeksLoad, onTimeDeliveryPct, parisDateOf, projectEacKeur, projectValueKeur, weekHoursOf, weekMondayOf,
  type CashProjectInput, type RfqKpiFacts, type VaultSyncFacts,
} from '@/domain/kpis';
import { clientDecisionCount } from '@/domain/meetings';
import { getDb } from '@/server/db/client';
import { addDaysIso, parisInstant } from '@/server/db/codes';
import {
  activityEvents, allocations, auditEntries, connectors, departmentCapacities, departments, goodsReceipts, parts, pdmVaultSyncs, persons, projects,
  purchaseOrders, rfqQuotes, rfqs, timeEntries, vigieNcrs,
} from '@/server/db/schema';
import type { BillingPlan } from './cashflow';
import { getContract } from './contract';
import { listMeetings } from './meetings';
import type { ProjectRow } from './projects';

// ── Data date ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Data date of a project (`projects.data_date`, else the status date); the portfolio data date for an unknown code. */
export async function projectDataDateOf(code: string): Promise<string> {
  const db = await getDb();
  const [p] = await db.select({ dataDate: projects.dataDate }).from(projects).where(eq(projects.code, code));
  return p ? projectDataDate(p) : DEFAULT_DATA_DATE;
}

// ── Cash flow & billing (03 OQ7) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Inputs of the cash forecast for the Cash flow rows (project + billing plan): contract milestones with their dates and
 * the invoices' due dates (payment delay of the terms), legacy plans undated at Net 30, monthly progress plans billing
 * the rest of the contract value month by month; ETC = max(0, EAC − actual);
 * finish = `planned_finish_date`, else the end of the register's finish month.
 */
export async function cashProjectInputs(rows: readonly { project: ProjectRow; plan: BillingPlan }[]): Promise<CashProjectInput[]> {
  if (!rows.length) return [];
  const db = await getDb();
  const finishes = new Map(
    (await db.select({ code: projects.code, finish: projects.plannedFinishDate }).from(projects).where(inArray(projects.code, rows.map((r) => r.project.code))))
      .map((r) => [r.code, r.finish]),
  );
  return Promise.all(rows.map(async ({ project: p, plan }) => {
    const contract = plan.fromContract ? await getContract(p.code) : null;
    const milestones = contract
      ? contract.milestones.map((m) => ({ label: m.number, amountKeur: m.amountKeur, status: m.status, dueOn: m.contractualDue, paymentDueOn: m.invoice?.dueOn ?? null }))
      : plan.milestones.map((m) => ({ label: m.number ?? m.label, amountKeur: m.amountKeur, status: m.status, dueOn: null }));
    return {
      code: p.code, milestones, paymentDays: contract ? contract.sheet.termsDays || DEFAULT_PAYMENT_DAYS : DEFAULT_PAYMENT_DAYS,
      etcKeur: Math.max(0, projectEacKeur(p) - p.actual), finishOn: finishes.get(p.code) ?? finishOfMonthText(p.finish),
      progressBillingKeur: plan.model === 'client_monthly_progress' ? Math.max(0, plan.contractValueKeur - plan.invoicedKeur) : 0,
    };
  }));
}

// ── Capacity what-if (03 OQ9) ────────────────────────────────────────────────────────────────────────────────────────

export interface CapacityModelRow {
  department: string;
  capacityH: number;
  committedH: number;
  /** Demand per €1M of project value over the window. */
  hoursPerMeur: number;
}

/**
 * Capacity model of the departments (department_capacities order): capacity and commitments from the resource pool's
 * weekly loads (people with a pool position, allocations without project), demand per €1M = commitments ÷ value of the active portfolio (`activeProjects`: contract
 * value from `plans`, else budget). The window starts at the week of `asOf` (the portfolio data date).
 */
export async function capacityModel(
  activeProjects: readonly ProjectRow[], plans: Readonly<Record<string, Pick<BillingPlan, 'contractValueKeur'>>>, asOf: string = DEFAULT_DATA_DATE,
): Promise<CapacityModelRow[]> {
  const db = await getDb();
  const [depts, pool, allocs] = await Promise.all([
    db.select({ name: departments.name }).from(departmentCapacities).innerJoin(departments, eq(departments.id, departmentCapacities.departmentId)).orderBy(asc(departmentCapacities.position)),
    db.select({ id: persons.id, dept: departments.name }).from(persons).leftJoin(departments, eq(departments.id, persons.departmentId)).where(isNotNull(persons.resourcePoolPosition)),
    db.select({ personId: allocations.personId, weekStart: allocations.weekStart, loadPct: allocations.loadPct }).from(allocations).where(isNull(allocations.projectId)).orderBy(asc(allocations.weekStart)),
  ]);
  // The window: the 8 pool weeks from the data date's week on (the seed's pool starts the Monday after, 28 Sep).
  const from = weekMondayOf(asOf);
  const weeks = [...new Set(allocs.map((a) => a.weekStart))].filter((w) => w >= from).sort().slice(0, CAPACITY_WINDOW_WEEKS);
  const people = pool.map((p) => ({
    department: p.dept, loads: weeks.map((w) => allocs.find((a) => a.personId === p.id && a.weekStart === w)?.loadPct ?? 0),
  }));
  const valueKeur = activeProjects.reduce((s, p) => s + projectValueKeur(plans[p.code]?.contractValueKeur, p.budget), 0);
  return depts.map(({ name }) => {
    const c = departmentCapacity(people, name, weekHoursOf(), weeks.length || CAPACITY_WINDOW_WEEKS);
    return { department: name, capacityH: c.capacityH, committedH: c.committedH, hoursPerMeur: demandPerMeur(c.committedH, valueKeur) };
  });
}

// ── Sourcing (08 OQ23) ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * RFQ facts of the "Savings vs list" and "Average cycle" tiles: catalogue list price, awarded unit price, award date
 * (`awarded_at`; the seed's awarded RFQ has none, so its quotes-due date stands for it) and the date the RFQ went to the
 * suppliers, from the audit trail: "Send to suppliers" on a draft (status Draft → Open), or "New RFQ", which creates it
 * Open and audits "RFQ sent to …". The earliest such entry counts.
 */
export async function rfqKpiFacts(): Promise<RfqKpiFacts[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: rfqs.id, status: rfqs.status, qty: rfqs.quantity, due: rfqs.replyDueOn, awardedAt: rfqs.awardedAt, list: parts.listPriceEur, price: rfqQuotes.unitPriceEur })
    .from(rfqs)
    .leftJoin(parts, eq(parts.id, rfqs.partId))
    .leftJoin(rfqQuotes, eq(rfqQuotes.id, rfqs.awardedQuoteId));
  if (!rows.length) return [];
  const sent = await db
    .select({ id: auditEntries.entityId, at: auditEntries.occurredAt })
    .from(auditEntries)
    .where(and(
      eq(auditEntries.entityType, 'rfq'),
      or(eq(auditEntries.change, 'status: Draft → Open'), like(auditEntries.change, 'RFQ sent to %')),
      inArray(auditEntries.entityId, rows.map((r) => r.id)),
    ))
    .orderBy(asc(auditEntries.occurredAt));
  const sentOn = new Map<string | null, string>();
  for (const s of sent) if (!sentOn.has(s.id)) sentOn.set(s.id, parisDateOf(s.at));
  return rows.map((r) => ({
    awardedOn: r.status === 'awarded' ? (r.awardedAt ? parisDateOf(r.awardedAt) : r.due) : null,
    sentOn: sentOn.get(r.id) ?? null,
    listPriceEur: r.list ?? null,
    awardedUnitPriceEur: r.price ?? null,
    quantity: r.qty ?? null,
  }));
}

// ── Deliveries (08 OQ23) ─────────────────────────────────────────────────────────────────────────────────────────────

/** "On-time deliveries" of a project at its data date (null when nothing was received in the window). */
export async function onTimeDeliveriesOf(projectCode: string): Promise<number | null> {
  const db = await getDb();
  const [asOf, rows] = await Promise.all([
    projectDataDateOf(projectCode),
    db.select({ receivedOn: goodsReceipts.receivedOn, poExpectedOn: purchaseOrders.expectedOn })
      .from(goodsReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
      .innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
      .where(eq(projects.code, projectCode)),
  ]);
  return onTimeDeliveryPct(rows, asOf);
}

// ── Site (10 OQ7) ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Client decisions logged" of a project — A-12 / D-5: the decisions recorded in the minutes of the project's meetings with
 * the client (external meetings; the owner answered D-5 "use the project's meetings and decisions"). It counted the change
 * requests whose client step was decided before D-5 (HLT-026: 2 → 2, the same value from another source).
 */
export async function clientDecisionsOf(projectCode: string): Promise<number> {
  return clientDecisionCount(await listMeetings(projectCode));
}

// ── Quality (07 OQ23) ────────────────────────────────────────────────────────────────────────────────────────────────

/** Closure dates of a project's closed NCRs: Vigie's last update of the record (ISO date), by NCR number. */
export async function ncrClosureDates(projectCode: string): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ number: vigieNcrs.number, at: vigieNcrs.vigieUpdatedAt })
    .from(vigieNcrs).where(and(eq(vigieNcrs.projectCode, projectCode), eq(vigieNcrs.status, 'closed')));
  return new Map(rows.filter((r) => r.at).map((r) => [r.number, parisDateOf(r.at!)]));
}

// ── Drawings (09 OQ17) ───────────────────────────────────────────────────────────────────────────────────────────────

/** The PDM connector row of Activity & integrations (SolidWorks PDM). */
export const PDM_CONNECTOR = 'SolidWorks PDM';

/** Latest vault run: the PDM connector row's last sync (its volume text gives the count) or Keystone's last "Sync vault". */
export async function latestVaultRun(): Promise<VaultSyncFacts | null> {
  const db = await getDb();
  const [[c], [s]] = await Promise.all([
    db.select({ at: connectors.lastSyncAt, volume: connectors.lastVolume }).from(connectors).where(eq(connectors.name, PDM_CONNECTOR)),
    db.select({ at: pdmVaultSyncs.syncedAt, n: pdmVaultSyncs.drawingsInVault }).from(pdmVaultSyncs).orderBy(desc(pdmVaultSyncs.syncedAt)).limit(1),
  ]);
  return latestVaultSync([
    c?.at ? { at: c.at.toISOString(), drawingsInVault: leadingCount(c.volume) } : null,
    s ? { at: s.at.toISOString(), drawingsInVault: s.n } : null,
  ]);
}

// ── My work, Home (10 OQ18) ──────────────────────────────────────────────────────────────────────────────────────────

/** Hours a person logged in the week of the data date (time entries, Monday → data date). */
export async function loggedThisWeek(personName: string, asOf: string = DEFAULT_DATA_DATE): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ workDate: timeEntries.workDate, hours: timeEntries.hours })
    .from(timeEntries)
    .innerJoin(persons, eq(persons.id, timeEntries.personId))
    .where(and(eq(persons.fullName, personName), gte(timeEntries.workDate, addDaysIso(asOf, -7))));
  return loggedInWeek(rows, asOf);
}

/** "Load next 2 wks" of a person: mean of the pool loads of the two weeks after the data date; null outside the pool. */
export async function loadNextWeeks(personName: string, asOf: string = DEFAULT_DATA_DATE, n = 2): Promise<number | null> {
  const db = await getDb();
  const rows = await db
    .select({ weekStart: allocations.weekStart, loadPct: allocations.loadPct })
    .from(allocations)
    .innerJoin(persons, eq(persons.id, allocations.personId))
    .where(and(eq(persons.fullName, personName), isNull(allocations.projectId)))
    .orderBy(asc(allocations.weekStart));
  if (!rows.length) return null;
  return nextWeeksLoad(rows.map((r) => r.weekStart), rows.map((r) => r.loadPct), asOf, n);
}

// ── Activity & integrations (10 OQ4) ─────────────────────────────────────────────────────────────────────────────────

/** "Events today": activity events of the portfolio data date (Paris day). */
export async function eventsToday(day: string = DEFAULT_DATA_DATE): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ at: activityEvents.occurredAt }).from(activityEvents)
    .where(and(gte(activityEvents.occurredAt, parisInstant(addDaysIso(day, -1), '00:00')), lt(activityEvents.occurredAt, parisInstant(addDaysIso(day, 2), '00:00'))));
  return eventsOnDay(rows.map((r) => r.at), day);
}
