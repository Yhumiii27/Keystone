import 'server-only';
// Data of the two screens, read through the DAL and shaped by ./model: Lessons learned & closure (getRex) and the
// client portal (getClientPortal + the schedule / EVM series of getScheduleData + the billing plan; the "Schedule" tab's
// Gantt from the same schedule data). One call per page.
import type { ClientTab } from '@/domain/rexclient';
import type { Lang, T } from '@/i18n/translate';
import { businessToday } from '@/server/clock';
import { getBillingPlan } from '@/server/dal/cashflow';
import { getClientPortal } from '@/server/dal/client';
import { getRex } from '@/server/dal/rex';
import { getScheduleData } from '@/server/dal/schedule';
import { clientPlanningView, clientScreenView, rexScreenView, type ClientScreenView, type RexScreenView } from './model';

export async function getRexScreen(code: string, t: T, lang: Lang): Promise<RexScreenView> {
  return rexScreenView(await getRex(code), t, lang);
}

export async function getClientScreen(code: string, tab: ClientTab, t: T, lang: Lang): Promise<ClientScreenView> {
  const [portal, schedule, billing, today] = await Promise.all([getClientPortal(code), getScheduleData(code), getBillingPlan(code), businessToday()]);
  const view = clientScreenView(
    {
      code, tab, portal, billing: billing ? { internal: billing.internal } : null, today,
      schedule: schedule && { header: schedule.header, milestones: schedule.milestones, pv: schedule.pv, ev: schedule.ev, bac: schedule.bac },
    },
    t,
    lang,
  );
  return { ...view, planning: tab === 'planning' && schedule ? clientPlanningView(schedule, t, lang) : null };
}
