import 'server-only';
// S-27 (owner, follow-up questionnaire of delivery 9): supplier schedule slips (R-204) told to the order's buyer and the project's
// leads, once per slip level (src/domain/supplier-slip-alerts.ts). Run every morning with the indicator alerts (job
// "indicator-alerts"): for each project in execution with supplier schedules, the forecast of each schedule at the project's
// data date (`supplierForecast`, as the Purchase orders drawer and the Plan card show it); a schedule of a cancelled order, or
// whose activities are all complete, is not watched. The send log (`reminder_sends`, kind "alert", item "supplier-slip:<PO>",
// one slot per level reached, occurrence "open") keeps each level told once to each person; a schedule back under the threshold
// has its rows renamed "cleared:<date>", so a later slip is told again. Bell notification kind "alert": the e-mail follows each
// person's preferences (R-036, family "Alerts and follow-up"). Read only on the schedules; best effort per order.
// S-31: the threshold (and the level step) is the Settings entry (default 5 working days). S-30: `supplierSlipsOf` also feeds the
// portfolio alerts.
// S-34: a slip that has lasted the Settings duration (working days since it first reached the threshold — the earliest level row
// of the episode) and pushes the project's forecast finish by the Settings impact (`supplierFinishImpact`) is also told to the
// portfolio directors, once per episode (send-log slot "directors", cleared with the levels).
import { and, eq, inArray, like, min } from 'drizzle-orm';
import { inExecution } from '@/domain/portfolio';
import { sendKeyText } from '@/domain/reminders';
import { supplierFinishImpact, supplierForecast } from '@/domain/supplier-schedule';
import {
  SUPPLIER_SLIP_DIRECTOR_SLOT, shouldEscalateSupplierSlip, supplierSlipEscalationTitle, supplierSlipLevel, supplierSlipRecipients, supplierSlipSlots, supplierSlipTitle,
} from '@/domain/supplier-slip-alerts';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { projects, purchaseOrders, reminderSends, rfqs, supplierSchedules } from '@/server/db/schema';
import { logError } from '@/server/log';
import { activePersonIds, notifyPersonIds, personIdsWithRoles, projectLeadIds } from './person-notices';
import { loadScheduleNetwork, toCpmActivity } from './schedule-network';
import { readSupplierSlipDays, readSupplierSlipEscalation } from './supplier-slip-threshold';

const OPEN = 'open';
const itemKeyOf = (po: string) => `supplier-slip:${po}`;

export interface SupplierSlipRun {
  today: string;
  /** Schedules watched (orders not cancelled, not all complete, on projects in execution). */
  watched: number;
  /** Schedules at 5 working days or more. */
  slipping: number;
  /** Schedules told at a new level to at least one person. */
  raised: number;
  /** Persons notified (one notice per person and new level). */
  notified: number;
  /** Schedules back under the threshold whose levels were cleared. */
  cleared: number;
  /** S-34: schedules told to the directors this run (lasted and pushing the project's finish). */
  escalated: number;
  /** S-34: directors notified (one notice per director and episode). */
  directorsNotified: number;
}

/** A watched supplier schedule and its slip (working days, the largest finish slip against the committed dates). */
export interface WatchedSupplierSlip {
  poId: string;
  poNumber: string;
  supplierName: string;
  slipDays: number;
  /** The name of the most late activity (as typed), null without one. */
  worstActivity: string | null;
  /**
   * S-33 / S-34: working days the slip pushes the project's forecast finish (`supplierFinishImpact`); computed for the schedules
   * slipping at least `impactFrom` only, else null.
   */
  finishImpactDays: number | null;
}

type Network = NonNullable<Awaited<ReturnType<typeof loadScheduleNetwork>>>;

/**
 * The watched supplier schedules of a loaded network (order not cancelled, not all complete) with their slip at `today` — the
 * forecast of the Purchase orders drawer and the Plan card (`supplierForecast`).
 */
function slipsOfNetwork(net: Network, today: string, impactFrom?: number): WatchedSupplierSlip[] {
  const watched = net.suppliers
    .filter((s) => s.poStatus !== 'cancelled' && s.activities.some((a) => !(a.actualFinish || a.percentComplete >= 100)))
    .map((s) => {
      const f = supplierForecast(s.input, { dataDate: net.dataDate, projectCalendar: net.projectCalendar, calendars: net.calendars, today, options: net.input.options });
      const worst = s.activities
        .map((a) => ({ a, slip: f.ok ? f.activities[a.code]?.finishSlip ?? 0 : 0 }))
        .sort((x, y) => y.slip - x.slip)[0];
      return { poId: s.poId, poNumber: s.poNumber, supplierName: s.supplierName, slipDays: f.ok ? f.slip : 0, worstActivity: worst?.a.name ?? null, finishImpactDays: null as number | null };
    });
  if (impactFrom != null) for (const w of watched) if (w.slipDays >= impactFrom) w.finishImpactDays = finishImpactOf(net, w.poNumber);
  return watched;
}

/** S-34: working days the schedule `po` pushes the project's forecast finish (the network's own activities); null if not computable. */
function finishImpactOf(net: Network, po: string): number | null {
  const base = { ...net.input, activities: net.activities.map(toCpmActivity), links: net.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })) };
  return supplierFinishImpact(base, net.suppliers.map((s) => s.input), po);
}

/**
 * S-30: the watched supplier schedules of each given project that has some (projects without a supplier schedule are left out), at
 * `today`. Read only; a project whose network cannot be read is left out.
 */
export async function supplierSlipsOf(codes: readonly string[], today: string, opts: { impactFrom?: number } = {}): Promise<Map<string, WatchedSupplierSlip[]>> {
  const out = new Map<string, WatchedSupplierSlip[]>();
  if (!codes.length) return out;
  const db = await getDb();
  const withSchedules = await db
    .selectDistinct({ code: projects.code })
    .from(supplierSchedules)
    .innerJoin(projects, eq(projects.id, supplierSchedules.projectId))
    .where(inArray(projects.code, [...codes]));
  for (const { code } of withSchedules) {
    try {
      const net = await loadScheduleNetwork(code, undefined, { suppliers: true });
      if (!net) continue;
      const slips = slipsOfNetwork(net, today, opts.impactFrom);
      if (slips.length) out.set(code, slips);
    } catch (e) {
      logError('supplierSlipsOf', e, { projectCode: code });
    }
  }
  return out;
}

/** The supplier slip alerts at the business date (`on`: tests). */
export async function runSupplierSlipAlerts(on?: string): Promise<SupplierSlipRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const { claimSends } = await import('./reminders');
  const run: SupplierSlipRun = { today, watched: 0, slipping: 0, raised: 0, notified: 0, cleared: 0, escalated: 0, directorsNotified: 0 };
  const heads = await db
    .selectDistinct({ code: projects.code, stage: projects.stage })
    .from(supplierSchedules)
    .innerJoin(projects, eq(projects.id, supplierSchedules.projectId));
  const codes = heads.filter(inExecution).map((h) => h.code);
  if (!codes.length) return run;

  const [active, procurement, directors, openRows, threshold, escalation] = await Promise.all([
    activePersonIds(db),
    personIdsWithRoles(db, ['procurement']),
    personIdsWithRoles(db, ['director']),
    // Per open episode: the day its first level was claimed (S-34 duration) and whether the directors were told.
    db.select({ itemKey: reminderSends.itemKey, slot: reminderSends.slot, since: min(reminderSends.runOn) }).from(reminderSends)
      .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, OPEN), like(reminderSends.itemKey, 'supplier-slip:%')))
      .groupBy(reminderSends.itemKey, reminderSends.slot),
    // S-31: the Settings threshold (default 5 working days), also the step of the levels.
    readSupplierSlipDays(db),
    // S-34: the escalation thresholds (defaults 10 working days lasted, 5 working days of finish impact).
    readSupplierSlipEscalation(db),
  ]);
  const wasOpen = new Set(openRows.map((r) => r.itemKey));
  const since = new Map<string, string>();
  const directorsTold = new Set<string>();
  for (const r of openRows) {
    if (r.slot === SUPPLIER_SLIP_DIRECTOR_SLOT) directorsTold.add(r.itemKey);
    else if (r.slot.startsWith('level:') && r.since && (!since.has(r.itemKey) || r.since < since.get(r.itemKey)!)) since.set(r.itemKey, r.since);
  }
  const boardIds = directors.filter((id) => active.has(id));
  const below = new Set<string>();

  for (const code of codes) {
    try {
      const net = await loadScheduleNetwork(code, undefined, { suppliers: true });
      if (!net) continue;
      const watched = slipsOfNetwork(net, today);
      if (!watched.length) continue;
      const poIds = watched.map((s) => s.poId);
      const [orders, rfqRows, leads] = await Promise.all([
        db.select({ id: purchaseOrders.id, sub: purchaseOrders.submittedByPersonId, by: purchaseOrders.createdByPersonId }).from(purchaseOrders).where(inArray(purchaseOrders.id, poIds)),
        db.select({ po: rfqs.purchaseOrderId, owner: rfqs.ownerPersonId }).from(rfqs).where(inArray(rfqs.purchaseOrderId, poIds)),
        projectLeadIds(db, code),
      ]);
      for (const s of watched) {
        run.watched++;
        const slip = s.slipDays;
        const level = supplierSlipLevel(slip, threshold);
        const itemKey = itemKeyOf(s.poNumber);
        if (!level) {
          below.add(itemKey);
          continue;
        }
        run.slipping++;
        // S-34: lasted long enough (working days since the episode's first level) and pushing the project's finish → the directors.
        const cal = net.calendars[net.projectCalendar] ?? Object.values(net.calendars)[0];
        const start = since.get(itemKey) ?? today;
        const lastedDays = cal ? Math.max(0, cal.workDaysBetween(start, today)) : 0;
        if (boardIds.length && !directorsTold.has(itemKey) && lastedDays >= escalation.days) {
          const impact = finishImpactOf(net, s.poNumber);
          if (shouldEscalateSupplierSlip({ lastedDays, finishImpactDays: impact }, escalation)) {
            const got = await claimSends(boardIds.map((personId) => ({ personId, itemKey, slot: SUPPLIER_SLIP_DIRECTOR_SLOT, occurrence: OPEN })), 'alert', today);
            const fresh = boardIds.filter((personId) => got.has(sendKeyText({ personId, itemKey, slot: SUPPLIER_SLIP_DIRECTOR_SLOT, occurrence: OPEN })));
            if (fresh.length) {
              run.escalated++;
              const sent = await notifyPersonIds({
                kind: 'alert', title: supplierSlipEscalationTitle(s.poNumber, slip, impact ?? 0), sub: [code, s.supplierName, s.worstActivity].filter(Boolean).join(' · '),
                screen: 'orders', params: { po: s.poNumber }, projectCode: code,
              }, fresh, null);
              run.directorsNotified += sent.length;
            }
          }
        }
        const o = orders.find((x) => x.id === s.poId);
        const buyerChain = [o?.sub ?? null, o?.by ?? null, rfqRows.find((r) => r.po === s.poId)?.owner ?? null];
        const to = supplierSlipRecipients({ buyerChain, procurement, leads }, active);
        if (!to.length) continue;
        const slots = supplierSlipSlots(level);
        const top = slots[slots.length - 1];
        const got = await claimSends(to.flatMap((personId) => slots.map((slot) => ({ personId, itemKey, slot, occurrence: OPEN }))), 'alert', today);
        const fresh = to.filter((personId) => got.has(sendKeyText({ personId, itemKey, slot: top, occurrence: OPEN })));
        if (!fresh.length) continue;
        run.raised++;
        const sent = await notifyPersonIds({
          kind: 'alert', title: supplierSlipTitle(s.poNumber, slip), sub: [s.supplierName, s.worstActivity].filter(Boolean).join(' · '),
          screen: 'orders', params: { po: s.poNumber }, projectCode: code,
        }, fresh, null);
        run.notified += sent.length;
      }
    } catch (e) {
      logError('runSupplierSlipAlerts', e, { projectCode: code });
    }
  }

  // Schedules back under the threshold: their levels are cleared (a later slip is told again).
  const gone = [...wasOpen].filter((k) => below.has(k));
  if (gone.length) {
    await db.update(reminderSends).set({ occurrence: `cleared:${today}:${Date.now()}` })
      .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, OPEN), inArray(reminderSends.itemKey, gone)));
    run.cleared = gone.length;
  }
  return run;
}
