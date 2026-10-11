'use server';
// Change control & Trends Server Functions (docs/spec/07 §2.2, §3 AF `changes`; docs/spec/04 §2.5 AF `trends`).
// Each one checks that the viewer may edit the project's screen (not outside the workspace, not a read-only
// project), validates the untrusted input, writes through the DAL writers with the viewer as the actor (never
// the prototype's fixed names, 00 §7.16) and revalidates the app (CR decisions feed Home, My approvals, Budget).
import { revalidatePath } from 'next/cache';
import { CR_STEPS, STEP_DECIDER, canDecideStep, deriveCrStatus } from '@/domain/change-control';
import type { ChangeStep } from '@/server/db/codes';
import { canEditCrActivities, parseCrActivities } from '@/domain/change-activities';
import { linkCrActivities, unknownActivityCodes } from '@/server/dal/change-activities';
import { createChangeRequest, decideChangeStep, listChangeRequestDetails, submitChangeRequest } from '@/server/dal/changes';
import { getWbs } from '@/server/dal/planning';
import { getProject } from '@/server/dal/projects';
import { recordStatusReport } from '@/server/dal/trends';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { canSchedulePlan } from '@/features/plan/rights';
import { getI18n } from '@/server/session';
import { NEW_CR_RESULT, STATUS_REPORT_RESULT, parseNewChangeRequest, parseStatusReport } from './forms';

export type ChangeActionResult = { ok: true } | { error: string };
export type ChangeFormResult = { toast?: string; error?: string };

const CR_RE = /^CR-\d{3,}$/;

/** Loads the project context after checking the viewer may edit `screen` on it. */
async function editable(code: unknown, screen: 'changes' | 'trends'): Promise<{ ctx: ProjectContext } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || !(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, screen);
  if (!ctx.canEdit(screen)) return { error: t(screen === 'changes' ? 'Change control is read-only for you' : 'Trends are read-only for you') };
  return { ctx };
}

const refresh = () => revalidatePath('/', 'layout');

/**
 * Toast text: the whole sentence when the dictionary has it ("Status report generated · PDF ready" →
 * "Rapport d’avancement généré · PDF prêt"), else per " · " segment like the prototype's showToast.
 */
async function toastOf(english: string) {
  const { t } = await getI18n();
  const whole = t(english);
  return whole !== english ? whole : english.split(' · ').map(t).join(' · ');
}

/**
 * "New change request" (AF `changes`): raises a CR submitted for review (CR-011…), toast "CR-011 · Change request submitted for review".
 * `opts.proposeBaseline` (Plan "Set baseline" after BL1, S-3): the request also proposes the project's next baseline BLn, filled
 * with the activity snapshot and made current when the request is approved.
 */
export async function createChangeRequestAction(code: string, values: Record<string, string>, opts?: { proposeBaseline?: boolean }): Promise<ChangeFormResult> {
  const r = await editable(code, 'changes');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const parsed = parseNewChangeRequest(values);
  if (!parsed.ok) return { error: t(parsed.error) };
  const known = new Set((await getWbs(r.ctx.project.code)).map((w) => w.code));
  const unknown = known.size ? parsed.value.wbsCodes.filter((c) => !known.has(c)) : [];
  if (unknown.length) return { error: `${t('Unknown WBS element')} ${unknown.join(', ')}` };
  // NEW-D2-2 (Delivery 7, R-062): the optional plan activities touched, checked against the plan before the request is raised.
  const acts = parseCrActivities(values?.acts);
  if (!acts.ok) return { error: t(acts.error) };
  if (acts.value.length && !canEditCrActivities(r.ctx.viewer, true)) return { error: t('Only the project team links plan activities to a change request') };
  const unknownActs = await unknownActivityCodes(r.ctx.project.code, acts.value.map((a) => a.code));
  if (unknownActs.length) return { error: `${t('Unknown activity')} ${unknownActs.join(', ')}` };
  // Baselines belong to the project's PM and the director (S-1 / S-3): a client's request never proposes one.
  const proposeBaseline = opts?.proposeBaseline === true && canSchedulePlan(r.ctx);
  const number = await createChangeRequest(r.ctx.project.code, { ...parsed.value, submit: true, proposeBaseline }, r.ctx.viewer.name);
  if (acts.value.length) {
    try {
      await linkCrActivities(r.ctx.project.code, number, acts.value, r.ctx.viewer.name);
    } catch (e) {
      // The request exists: say which part failed instead of inviting a second request.
      console.error('createChangeRequestAction: activities', e);
      refresh();
      return { toast: `${number} · ${await toastOf(NEW_CR_RESULT)} · ${t('The plan activities could not be linked')}` };
    }
  }
  refresh();
  if (proposeBaseline) {
    const bl = (await listChangeRequestDetails(r.ctx.project.code)).find((c) => c.id === number)?.baseline ?? '';
    return { toast: `${number} · ${await toastOf(NEW_CR_RESULT)} · ${bl} ${t('proposed')}` };
  }
  return { toast: `${number} · ${await toastOf(NEW_CR_RESULT)}` };
}

async function loadCr(code: string, number: unknown) {
  if (typeof number !== 'string' || !CR_RE.test(number)) return null;
  const cr = (await listChangeRequestDetails(code)).find((c) => c.id === number);
  return cr ? { ...cr, status: deriveCrStatus(cr.status, cr.chain) } : null;
}

/** "Submit for review" (row or drawer): Draft → In review. */
export async function submitChangeRequestAction(code: string, number: string): Promise<ChangeActionResult> {
  const r = await editable(code, 'changes');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const cr = await loadCr(r.ctx.project.code, number);
  if (!cr) return { error: t('Unknown change request') };
  if (cr.status !== 'draft') return { error: t('This change request has already been submitted') };
  await submitChangeRequest(r.ctx.project.code, cr.id, r.ctx.viewer.name);
  refresh();
  return { ok: true };
}

/**
 * Approve / Reject one step of the approval chain. Only the persona owning the step decides it (pm — one of the project's
 * PMs or deputies, R-041 —, director, client; the change control board is recorded by the director), on a request in review
 * whose step is pending.
 * The status is re-derived from the chain by the DAL (approved → BL2 becomes current for CR-009).
 */
export async function decideChangeStepAction(code: string, number: string, step: string, decision: string): Promise<ChangeActionResult> {
  const r = await editable(code, 'changes');
  if ('error' in r) return r;
  const { t } = await getI18n();
  if (!(CR_STEPS as string[]).includes(step) || (decision !== 'ok' && decision !== 'rejected')) return { error: t('Invalid request') };
  const s = step as ChangeStep;
  if (STEP_DECIDER[s] !== r.ctx.viewer.role) return { error: t('This approval step is not yours to decide') };
  // R-041: the PM step belongs to the project's PMs (PM of record, co-PMs, deputies), not to any PM on its team.
  if (s === 'pm' && !r.ctx.isLead) return { error: t('This approval step is not yours to decide') };
  const cr = await loadCr(r.ctx.project.code, number);
  if (!cr) return { error: t('Unknown change request') };
  if (!canDecideStep(r.ctx.viewer.role, cr, s)) return { error: t('This approval step is no longer pending') };
  await decideChangeStep(r.ctx.project.code, cr.id, s, decision, r.ctx.viewer.name);
  refresh();
  return { ok: true };
}

/** "Generate status report" (AF `trends`): records the request; toast "Status report generated · PDF ready" (no PDF yet, 04 OQ9). */
export async function generateStatusReportAction(code: string, values: Record<string, string>): Promise<ChangeFormResult> {
  const r = await editable(code, 'trends');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const parsed = parseStatusReport(values);
  if (!parsed.ok) return { error: t(parsed.error) };
  await recordStatusReport(r.ctx.project.code, parsed.value, r.ctx.viewer.name);
  revalidatePath(`/projects/${r.ctx.project.code}/trends`);
  return { toast: await toastOf(STATUS_REPORT_RESULT) };
}
