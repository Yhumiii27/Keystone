import 'server-only';
// R-204 — view model of the supplier schedules (Purchase orders drawer, Plan card): each schedule with its forecast at the
// project's data date (src/domain/supplier-schedule.ts `supplierForecast`), the slip of each activity against the supplier's
// committed dates, its logic and its ties to the project. Serialisable (ISO dates, formatted by the components).
import { eq } from 'drizzle-orm';
import { supplierForecast, type SupplierTieDirection } from '@/domain/supplier-schedule';
import { getDb } from '@/server/db/client';
import { purchaseOrders } from '@/server/db/schema';
import { businessToday } from '@/server/clock';
import type { PoStatus } from '@/server/db/codes';
import { loadScheduleNetwork } from '@/server/dal/schedule-network';

export interface SupplierActivityView {
  code: string;
  name: string;
  duration: number;
  committedStart: string | null;
  committedFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  pct: number;
  /** Working days late (+) or early (−) at the finish against the committed finish; null without one. */
  finishSlip: number | null;
  late: boolean;
}

export interface SupplierScheduleView {
  po: string;
  poStatus: PoStatus;
  supplier: string;
  activities: SupplierActivityView[];
  links: { pred: string; succ: string; type: string; lag: number }[];
  ties: { supplier: string; activity: string; activityName: string; direction: SupplierTieDirection; lag: number }[];
  /** Forecast finish and largest finish slip of the schedule. */
  finish: string | null;
  slip: number;
  late: boolean;
  /** Tied to the project (its dates drive the project's activities at Reschedule). */
  consolidated: boolean;
  /** The schedule cannot be dated (logic loop / invalid data): its forecast columns stay empty. */
  invalid: boolean;
}

export interface SupplierSchedulesView {
  dataDate: string;
  schedules: SupplierScheduleView[];
  /** The project's activities (tie targets), in plan order. */
  projectActivities: { code: string; name: string }[];
  /** Status of each order of the project (a cancelled order gets no schedule). */
  orderStatus: Record<string, PoStatus>;
}

/** The project's supplier schedules with their forecast; null for an unknown project. */
export async function supplierSchedulesView(projectCode: string): Promise<SupplierSchedulesView | null> {
  const net = await loadScheduleNetwork(projectCode, undefined, { suppliers: true });
  if (!net) return null;
  const today = await businessToday();
  const schedules = net.suppliers.map((s): SupplierScheduleView => {
    const f = supplierForecast(s.input, { dataDate: net.dataDate, projectCalendar: net.projectCalendar, calendars: net.calendars, today, options: net.input.options });
    const fa = f.ok ? f.activities : {};
    return {
      po: s.poNumber, poStatus: s.poStatus, supplier: s.supplierName,
      activities: s.activities.map((a) => ({
        code: a.code, name: a.name, duration: a.durationDays, committedStart: a.committedStart, committedFinish: a.committedFinish,
        forecastStart: fa[a.code]?.start ?? null, forecastFinish: fa[a.code]?.finish ?? null, actualStart: a.actualStart, actualFinish: a.actualFinish,
        pct: a.actualStart && a.actualFinish ? 100 : a.percentComplete, finishSlip: fa[a.code]?.finishSlip ?? null, late: fa[a.code]?.late ?? false,
      })),
      links: s.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })),
      ties: s.ties.map((t) => ({ supplier: t.supplier, activity: t.activity, activityName: t.activityName, direction: t.direction, lag: t.lag })),
      finish: f.ok ? f.finish : null, slip: f.ok ? f.slip : 0, late: f.ok ? f.late : false, consolidated: s.ties.length > 0, invalid: !f.ok,
    };
  });
  const orders = await (await getDb()).select({ number: purchaseOrders.number, status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.projectId, net.projectId));
  return {
    dataDate: net.dataDate, schedules, projectActivities: net.activities.map((a) => ({ code: a.code, name: a.name })),
    orderStatus: Object.fromEntries(orders.map((o) => [o.number, o.status])),
  };
}
