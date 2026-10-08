'use server';
// Risk register and Contingency register Server Functions (docs/spec/07 §2.1, §3 AF `risks`; 04 §5.5 AF
// `contingency`). Each one validates the raw input with the domain parsers, checks the viewer may edit the screen
// for this project (not outside the workspace, not a read-only project), writes through the data-layer writers
// with the viewer as the actor, then revalidates the project's pages (register, heat map, contingency exposure,
// trends, sidebar badge).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseDrawDown } from '@/domain/contingency';
import { parseNewRisk, parseRiskEdit, type RiskEdit } from '@/domain/risk';
import { recordContingencyDraw } from '@/server/dal/contingency';
import { getProject } from '@/server/dal/projects';
import { createRisk, listRisks, updateRisk } from '@/server/dal/risks';
import { getContingencyScreen, riskOwnerOptions } from '@/server/dal/risks-screen';
import { getProjectContext } from '@/server/project-context';
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
async function editable(code: unknown, screen: 'risks' | 'contingency'): Promise<{ code: string; actor: string } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen))
    return { error: await tr(screen === 'risks' ? 'This risk register is read-only for you' : 'This contingency register is read-only for you') };
  return { code: project.code, actor: ctx.viewer.name };
}

/** "New risk" (AF `risks`): numbers the risk R-21… and answers "R-21 · Risk registered". */
export async function createRiskAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'risks');
  if ('error' in ok) return ok;
  const parsed = parseNewRisk(strings(values), await riskOwnerOptions(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  const number = await createRisk(
    ok.code,
    { title: v.title, category: v.category, probability: v.probability, impact: v.impact, owner: v.owner, response: v.response, emvKeur: v.emvKeur, plan: v.plan },
    ok.actor,
  );
  refresh(ok.code);
  return { toast: `${number} · ${await tr(RISK_RESULT)}` };
}

/** Drawer edits (riskOv): probability / impact segments, response strategy, "Close risk" / "Reopen". */
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

/** "Record draw-down" (AF `contingency`): appends the draw (business date = status date), toast "Draw-down recorded". */
export async function recordDrawDownAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contingency');
  if ('error' in ok) return ok;
  const screen = await getContingencyScreen(ok.code);
  if (!screen) return { error: await tr('Unknown project') };
  const parsed = parseDrawDown(strings(values), screen.approvers);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  await recordContingencyDraw(ok.code, parsed.value, ok.actor);
  refresh(ok.code);
  return { toast: await tr(DRAW_RESULT) };
}
