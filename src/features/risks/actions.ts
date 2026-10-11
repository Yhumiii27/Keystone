'use server';
// Risk register and Contingency register Server Functions (docs/spec/07 §2.1, §3 AF `risks`; 04 §5.5 AF
// `contingency`). Each one validates the raw input with the domain parsers, checks the viewer may edit the screen
// for this project (not outside the workspace, not a read-only project), writes through the data-layer writers
// with the viewer as the actor, then revalidates the project's pages (register, heat map, contingency exposure,
// trends, sidebar badge).
// Delivery 7: "New risk" and the drawer take the cost if it occurs (Q-1, EMV derived); a draw-down is linked to a change
// request, a risk or an NCR, checked against the provision left and submitted to the portfolio director, who validates or
// rejects it from My approvals (`decideDrawDownAction`, C-4) — notified both ways.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseDrawDown } from '@/domain/contingency';
import { isDrawDecider } from '@/domain/cost-control';
import { FORM_CATEGORIES, parseNewRisk, parseRiskEdit, type RiskEdit } from '@/domain/risk';
import { orderedOptions } from '@/domain/settings-rules';
import { ContingencyError, decideContingencyDraw, drawLinkOptions, submitContingencyDraw } from '@/server/dal/contingency';
import { getProject } from '@/server/dal/projects';
import { notifyRequestEvent, type NoticeActor, type RequestNotice } from '@/server/dal/requests-screens';
import { createRisk, listRisks, updateRisk } from '@/server/dal/risks';
import { riskOwnerOptions } from '@/server/dal/risks-screen';
import { riskCategoryOptions } from '@/server/dal/settings-lists';
import { getProjectContext, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { DRAW_RESULT, RISK_RESULT } from './forms';

export type RiskEditResult = { ok: true } | { error: string };

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** Toast / error text translated per " · " segment, like the prototype's showToast. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** Resolves the project and checks the viewer may edit `screen` on it; returns the canonical code or an error. */
async function editable(code: unknown, screen: 'risks' | 'contingency'): Promise<{ code: string; actor: string; role: string; notice: NoticeActor } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen))
    return { error: await tr(screen === 'risks' ? 'This risk register is read-only for you' : 'This contingency register is read-only for you') };
  return { code: project.code, actor: ctx.viewer.name, role: ctx.viewer.role, notice: { name: ctx.viewer.name, short: ctx.viewer.short, personId: ctx.viewer.personId } };
}

/** "New risk" (AF `risks`): numbers the risk R-21… and answers "R-21 · Risk registered". */
export async function createRiskAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'risks');
  if ('error' in ok) return ok;
  // A-14: the category must be one of the active Settings › Risk categories (what the form offers).
  const [team, cats] = await Promise.all([riskOwnerOptions(ok.code), riskCategoryOptions()]);
  const parsed = parseNewRisk(strings(values), team, orderedOptions(cats.active, FORM_CATEGORIES).map((c) => c.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  const number = await createRisk(
    ok.code,
    { title: v.title, category: v.category, probability: v.probability, impact: v.impact, owner: v.owner, response: v.response, costKeur: v.costKeur, plan: v.plan },
    ok.actor,
  );
  refresh(ok.code);
  return { toast: `${number} · ${await tr(RISK_RESULT)}` };
}

/** Drawer edits (riskOv): probability / impact segments, response strategy, cost if it occurs (Q-1), "Close risk" / "Reopen". */
export async function updateRiskAction(code: string, riskId: string, patch: RiskEdit): Promise<RiskEditResult> {
  const ok = await editable(code, 'risks');
  if ('error' in ok) return ok;
  const parsed = parseRiskEdit(patch);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  if (typeof riskId !== 'string' || !(await listRisks(ok.code)).some((r) => r.id === riskId)) return { error: await tr('Unknown risk') };
  try {
    await updateRisk(ok.code, riskId, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { ok: true };
}

/** The portfolio director, notified of a draw-down to validate (never the actor's own role). */
async function notify(notices: RequestNotice[], actor: NoticeActor) {
  try {
    await notifyRequestEvent(notices, actor);
  } catch (e) {
    console.error('contingency: notification failed', e); // a courtesy: never undoes the write
  }
}

/**
 * "Record draw-down" (AF `contingency`, C-4): a draw-down linked to one of the project's change requests, risks or NCRs,
 * within the provision left, submitted to the portfolio director (business date = status date). Toast "Draw-down recorded ·
 * Awaiting the director's validation"; the director is notified and finds it in My approvals.
 */
export async function recordDrawDownAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contingency');
  if ('error' in ok) return ok;
  const parsed = parseDrawDown(strings(values), await drawLinkOptions(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  let receipt;
  try {
    receipt = await submitContingencyDraw(ok.code, parsed.value, ok.actor);
  } catch (e) {
    if (e instanceof ContingencyError) return { error: await tr(e.message) };
    console.error('recordDrawDownAction', e);
    return { error: await tr('The change could not be saved') };
  }
  await notify(
    [{
      kind: 'approval', title: 'Contingency draw-down to validate', sub: `${receipt.projectCode} · ${receipt.amount} k€ · ${receipt.linkRef}`,
      screen: 'myapprovals', params: { filter: 'contingency' }, projectCode: receipt.projectCode, to: receipt.director,
    }],
    ok.notice,
  );
  refresh(ok.code);
  revalidatePath('/', 'layout'); // My approvals badge of the director
  return { toast: await tr(DRAW_RESULT) };
}

export type DrawDecisionResult = { ok: true; toast: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_RE = /^[A-Z]{3}-\d{3}$/;

/**
 * My approvals (C-4): the portfolio director validates (→ drawn) or rejects (optional comment the requester sees) a submitted
 * draw-down. Refused outside the inbox's workspace, for any other role, on unknown or already decided draw-downs, and when
 * validating would take the drawn total above the provision. Messages are English source strings (the inbox shows them with
 * toast showEn).
 */
export async function decideDrawDownAction(input: { projectCode: string; drawId: string; decision: string; comment?: string }): Promise<DrawDecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || !isDrawDecider(viewer.role)) return { ok: false, error: 'Only the portfolio director validates contingency draw-downs' };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const id = typeof input?.drawId === 'string' ? input.drawId.trim() : '';
  const decision = input?.decision === 'validated' || input?.decision === 'rejected' ? input.decision : null;
  if (!PROJECT_RE.test(code) || !UUID_RE.test(id) || !decision) return { ok: false, error: 'Invalid request' };
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) : '';
  let d;
  try {
    d = await decideContingencyDraw(code, id, decision, { name: viewer.name, role: viewer.role }, comment);
  } catch (e) {
    revalidatePath('/', 'layout'); // the row may be stale
    if (e instanceof ContingencyError) return { ok: false, error: e.message };
    console.error('decideDrawDownAction', e);
    return { ok: false, error: 'The decision could not be saved' };
  }
  const validated = d.decision === 'validated';
  await notify(
    [{
      kind: 'approval', title: validated ? 'Contingency draw-down validated' : 'Contingency draw-down rejected',
      sub: `${d.projectCode} · ${d.amount} k€ · ${d.linkRef}${!validated && comment ? ' · ' + comment : ''}`,
      screen: 'contingency', projectCode: d.projectCode, to: d.requestedBy || null,
    }],
    { name: viewer.name, short: viewer.short, personId: viewer.personId },
  );
  revalidatePath('/', 'layout');
  return { ok: true, toast: validated ? `${d.projectCode} · Draw-down validated` : `${d.projectCode} · Draw-down rejected` };
}
