import 'server-only';
// R-159 (P1) and R-162 (P4) — daily alerts, run with the indicator alerts (job "indicator-alerts"), through the same mechanism as
// the supplier slips (S-27): the send log (`reminder_sends`, kind "alert") keeps each alert told once to each person, and a bell
// notification of kind "alert" (the e-mail follows each person's preferences, R-036).
// - Late supplier inspections (R-159): an inspection of a long-lead order (≥ 12 weeks from order to expected delivery) past its
//   planned date without a result — told to the order's buyer (else procurement) and to quality, once per inspection and planned
//   date (item "po-inspection:<PO>/<I-n>", slot "late:<planned date>": a re-planned inspection that slips again is told again).
// - FX hedging alerts (R-162): a project whose net FX exposure or rate drift passes the Settings threshold — told to Finance and
//   the portfolio directors, once per project, currency and kind while it lasts (item "fx:<project>:<currency>:<kind>", occurrence
//   "open"); back under the threshold, the rows are renamed "cleared:<date>" and a later passage is told again.
import { and, eq, inArray, like } from 'drizzle-orm';
import { lateInspectionTitle, lateInspectionsToTell, type PoInspectionFacts } from '@/domain/expediting';
import { fxAlertTitle } from '@/domain/fx-exposure';
import { orderBuyer } from '@/domain/receipt-notices';
import { sendKeyText } from '@/domain/reminders';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { poInspections, projects, purchaseOrders, reminderSends, rfqs, suppliers } from '@/server/db/schema';
import { logError } from '@/server/log';
import { getPortfolioFxExposure } from './fx';
import { activePersonIds, notifyPersonIds, personIdsWithRoles } from './person-notices';

const OPEN = 'open';

export interface ExpeditingAlertRun {
  today: string;
  /** Late inspections of long-lead orders. */
  late: number;
  /** Persons notified of a late inspection. */
  notified: number;
  /** FX alerts in force; told this run; persons notified; alerts cleared. */
  fxAlerts: number;
  fxRaised: number;
  fxNotified: number;
  fxCleared: number;
}

export async function runExpeditingAlerts(on?: string): Promise<ExpeditingAlertRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const { claimSends } = await import('./reminders');
  const run: ExpeditingAlertRun = { today, late: 0, notified: 0, fxAlerts: 0, fxRaised: 0, fxNotified: 0, fxCleared: 0 };
  const [active, procurement, quality, finance, directors] = await Promise.all([
    activePersonIds(db),
    personIdsWithRoles(db, ['procurement']),
    personIdsWithRoles(db, ['quality']),
    personIdsWithRoles(db, ['finance']),
    personIdsWithRoles(db, ['director']),
  ]);

  // ── Late supplier inspections ──
  try {
    const rows = await db
      .select({
        i: poInspections, po: purchaseOrders.number, poId: purchaseOrders.id, status: purchaseOrders.status, orderedOn: purchaseOrders.orderedOn,
        expectedOn: purchaseOrders.expectedOn, sub: purchaseOrders.submittedByPersonId, by: purchaseOrders.createdByPersonId, code: projects.code, supplier: suppliers.name,
      })
      .from(poInspections)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, poInspections.poId))
      .innerJoin(projects, eq(projects.id, poInspections.projectId))
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(poInspections.result, 'planned'));
    const byPo = new Map<string, typeof rows>();
    for (const r of rows) byPo.set(r.poId, [...(byPo.get(r.poId) ?? []), r]);
    const rfqRows = byPo.size ? await db.select({ po: rfqs.purchaseOrderId, owner: rfqs.ownerPersonId }).from(rfqs).where(inArray(rfqs.purchaseOrderId, [...byPo.keys()])) : [];
    for (const [poId, list] of byPo) {
      const head = list[0];
      const facts: PoInspectionFacts[] = list.map(({ i }) => ({ number: i.number, kind: i.kind, plannedOn: i.plannedOn, result: i.result, resultOn: i.resultOn, position: i.position }));
      const late = lateInspectionsToTell({ number: head.po, status: head.status, orderedOn: head.orderedOn, expectedOn: head.expectedOn }, facts, today);
      if (!late.length) continue;
      const buyer = orderBuyer([head.sub, head.by, rfqRows.find((r) => r.po === poId)?.owner ?? null], active);
      const to = [...new Set([...(buyer ? [buyer] : procurement), ...quality])].filter((id) => active.has(id));
      for (const l of late) {
        run.late++;
        if (!to.length) continue;
        const itemKey = `po-inspection:${l.ref}`;
        const slot = `late:${l.plannedOn}`;
        const got = await claimSends(to.map((personId) => ({ personId, itemKey, slot, occurrence: OPEN })), 'alert', today);
        const fresh = to.filter((personId) => got.has(sendKeyText({ personId, itemKey, slot, occurrence: OPEN })));
        if (!fresh.length) continue;
        const name = list.find((r) => r.i.number === l.number)?.i.name ?? '';
        const sent = await notifyPersonIds({
          kind: 'alert', title: lateInspectionTitle(l.ref, l.daysLate), sub: [head.code, head.supplier, name].filter(Boolean).join(' · '),
          screen: 'orders', params: { po: head.po }, projectCode: head.code,
        }, fresh, null);
        run.notified += sent.length;
      }
    }
  } catch (e) {
    logError('runExpeditingAlerts', e, { part: 'inspections' });
  }

  // ── FX hedging alerts ──
  try {
    const { lines } = await getPortfolioFxExposure(today, db);
    const to = [...new Set([...finance, ...directors])].filter((id) => active.has(id));
    const inForce = new Set<string>();
    for (const l of lines) {
      for (const a of l.alerts) {
        run.fxAlerts++;
        const itemKey = `fx:${l.code}:${a.currency}:${a.kind}`;
        inForce.add(itemKey);
        if (!to.length) continue;
        const got = await claimSends(to.map((personId) => ({ personId, itemKey, slot: 'alert', occurrence: OPEN })), 'alert', today);
        const fresh = to.filter((personId) => got.has(sendKeyText({ personId, itemKey, slot: 'alert', occurrence: OPEN })));
        if (!fresh.length) continue;
        run.fxRaised++;
        const c = l.currencies.find((x) => x.currency === a.currency)!;
        const sent = await notifyPersonIds({
          kind: 'alert', title: fxAlertTitle(a.kind, l.code, c), sub: l.name, screen: 'contract', params: {}, projectCode: l.code,
        }, fresh, null);
        run.fxNotified += sent.length;
      }
    }
    const open = await db.selectDistinct({ itemKey: reminderSends.itemKey }).from(reminderSends)
      .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, OPEN), like(reminderSends.itemKey, 'fx:%')));
    const gone = open.map((r) => r.itemKey).filter((k) => !inForce.has(k));
    if (gone.length) {
      await db.update(reminderSends).set({ occurrence: `cleared:${today}:${Date.now()}` })
        .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, OPEN), inArray(reminderSends.itemKey, gone)));
      run.fxCleared = gone.length;
    }
  } catch (e) {
    logError('runExpeditingAlerts', e, { part: 'fx' });
  }
  return run;
}
