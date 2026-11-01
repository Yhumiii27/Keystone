'use server';
// R-204 — Server Functions of the supplier schedules (Purchase orders screen, order drawer). Rights (src/domain/rights.ts):
// - the schedule itself (create / remove, activities, their logic, the progress the supplier reports): the project's leads and
//   the director, and procurement (the buyer), on a project whose orders they may edit (`canEditSupplierSchedule`);
// - the ties consolidating it into the project CPM: the project's leads and the director (`canTieSupplierSchedule`).
// The client is refused (getProjectContext). Validation by the pure rules (src/domain/supplier-schedule.ts) in the writers, logic
// loops refused through the whole network. With RECALCULATION_MODE 'automatic', a change that moves dates reschedules.
import { revalidatePath } from 'next/cache';
import { canEditSupplierSchedule, canTieSupplierSchedule } from '@/domain/rights';
import { SUPPLIER_ERRORS } from '@/domain/supplier-schedule';
import { linkCycleText } from '@/features/plan/i18n';
import { businessToday } from '@/server/clock';
import { getProject } from '@/server/dal/projects';
import { rescheduleIfAutomatic } from '@/server/dal/schedule';
import {
  SupplierScheduleError, addSupplierLink, addSupplierTie, createSupplierSchedule, recordSupplierProgress, removeSupplierActivity, removeSupplierLink,
  removeSupplierSchedule, removeSupplierTie, saveSupplierActivity,
} from '@/server/dal/supplier-schedules';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type SupplierActionResult = { ok: true } | { error: string };

const PO_RE = /^[A-Z0-9][A-Z0-9-]{0,30}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,12}$/;
const ACT_RE = /^[A-Za-z0-9._-]{1,20}$/;
const SCHEDULE_ONLY = 'Only procurement, the project manager or the director can edit the supplier schedules';
const TIES_ONLY = 'Only the project manager or the director can tie a supplier schedule to the project schedule';
const OTHER_ERRORS = {
  unknownOrder: 'Unknown purchase order',
  exists: 'This order already has a supplier schedule',
  noSchedule: 'This order has no supplier schedule',
  cancelled: 'A cancelled order has no supplier schedule',
} as const;

type Kind = 'schedule' | 'tie';

async function run(code: unknown, po: unknown, kind: Kind, write: (project: string, po: string, actor: { name: string; role: string }) => Promise<unknown>, reschedule = false): Promise<SupplierActionResult> {
  const { t, lang } = await getI18n();
  if (typeof code !== 'string' || !code || typeof po !== 'string' || !PO_RE.test(po)) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'orders');
  const ok = kind === 'tie'
    ? canTieSupplierSchedule(ctx.viewer.role, ctx.access, ctx.canEdit('plan'))
    : canEditSupplierSchedule(ctx.viewer.role, ctx.access, ctx.canEdit('orders'));
  if (!ok) return { error: t(kind === 'tie' ? TIES_ONLY : SCHEDULE_ONLY) };
  const actor = { name: ctx.viewer.name, role: ctx.viewer.role };
  try {
    await write(project.code, po, actor);
  } catch (e) {
    if (!(e instanceof SupplierScheduleError)) throw e;
    if (e.code === 'cycle' && e.cycle) return { error: linkCycleText(e.cycle, lang) };
    return { error: t(e.code in OTHER_ERRORS ? OTHER_ERRORS[e.code as keyof typeof OTHER_ERRORS] : SUPPLIER_ERRORS[e.code as keyof typeof SUPPLIER_ERRORS]) };
  }
  if (reschedule) await rescheduleIfAutomatic(project.code, actor.name);
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { ok: true };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const badCode = (v: unknown) => typeof v !== 'string' || !CODE_RE.test(v);

/** Creates the supplier schedule of an order, empty or with the standard steps. */
export async function createSupplierScheduleAction(code: string, po: string, template: boolean): Promise<SupplierActionResult> {
  return run(code, po, 'schedule', (p, n, actor) => createSupplierSchedule(p, n, { template: template === true }, actor));
}

export async function removeSupplierScheduleAction(code: string, po: string): Promise<SupplierActionResult> {
  return run(code, po, 'schedule', (p, n, actor) => removeSupplierSchedule(p, n, actor), true);
}

/** Adds (`existing` '') or updates the plan of a supplier activity: code, name, duration, committed dates. */
export async function saveSupplierActivityAction(code: string, po: string, existing: string, values: Record<string, string>): Promise<SupplierActionResult> {
  if (typeof existing !== 'string' || (existing !== '' && badCode(existing))) return { error: (await getI18n()).t('Invalid request') };
  const v = rec(values);
  return run(code, po, 'schedule', (p, n, actor) => saveSupplierActivity(p, n, existing || null, v, { chain: v.chain !== 'no' }, actor), true);
}

export async function removeSupplierActivityAction(code: string, po: string, activity: string): Promise<SupplierActionResult> {
  if (badCode(activity)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'schedule', (p, n, actor) => removeSupplierActivity(p, n, activity, actor), true);
}

/** Progress the supplier reports (actual start / finish, % complete), entered by the buyer. */
export async function recordSupplierProgressAction(code: string, po: string, activity: string, values: Record<string, string>): Promise<SupplierActionResult> {
  if (badCode(activity)) return { error: (await getI18n()).t('Invalid request') };
  const today = await businessToday();
  return run(code, po, 'schedule', (p, n, actor) => recordSupplierProgress(p, n, activity, rec(values), today, actor), true);
}

export async function addSupplierLinkAction(code: string, po: string, values: Record<string, string>): Promise<SupplierActionResult> {
  const v = rec(values);
  if (badCode(v.pred) || badCode(v.succ)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'schedule', (p, n, actor) => addSupplierLink(p, n, { pred: String(v.pred), succ: String(v.succ), type: v.type, lag: v.lag ?? '0' }, actor), true);
}

export async function removeSupplierLinkAction(code: string, po: string, pred: string, succ: string): Promise<SupplierActionResult> {
  if (badCode(pred) || badCode(succ)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'schedule', (p, n, actor) => removeSupplierLink(p, n, pred, succ, actor), true);
}

/** Ties a supplier activity to a project activity (finish-to-start, either direction). */
export async function addSupplierTieAction(code: string, po: string, values: Record<string, string>): Promise<SupplierActionResult> {
  const v = rec(values);
  if (badCode(v.supplier) || typeof v.activity !== 'string' || !ACT_RE.test(v.activity)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'tie', (p, n, actor) => addSupplierTie(p, n, { supplier: String(v.supplier), activity: String(v.activity), direction: v.direction, lag: v.lag ?? '0' }, actor), true);
}

export async function removeSupplierTieAction(code: string, po: string, supplier: string, activity: string): Promise<SupplierActionResult> {
  if (badCode(supplier) || typeof activity !== 'string' || !ACT_RE.test(activity)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'tie', (p, n, actor) => removeSupplierTie(p, n, supplier, activity, actor), true);
}
