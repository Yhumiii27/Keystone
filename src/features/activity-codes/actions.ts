'use server';
// R-204 — Server Functions of the activity codes (Plan screen): the dictionary (stored types and values) and the code of an
// activity. Rights: the project's leads and the director on a plan they may edit (`canEditStructure`, P-9a), never the client
// (getProjectContext refuses them). Input validated here and again by the pure rules in the writers (src/server/dal/activity-codes.ts).
import { revalidatePath } from 'next/cache';
import { ACTIVITY_CODE_ERRORS } from '@/domain/activity-codes';
import { canEditStructure } from '@/features/plan/rights';
import {
  ActivityCodeWriteError, addActivityCodeType, addActivityCodeValue, removeActivityCodeType, removeActivityCodeValue, setActivityCode,
} from '@/server/dal/activity-codes';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type CodeActionResult = { ok: true } | { error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACT_RE = /^[A-Za-z0-9._-]{1,20}$/;
const ONLY_LEADS = 'Only the project manager or the director can change the activity codes';

async function allowed(code: unknown): Promise<{ project: string; actor: { name: string; role: string } } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'plan');
  if (!canEditStructure(ctx)) return { error: t(ONLY_LEADS) };
  return { project: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

async function run(code: unknown, write: (project: string, actor: { name: string; role: string }) => Promise<unknown>): Promise<CodeActionResult> {
  const a = await allowed(code);
  if ('error' in a) return a;
  const { t } = await getI18n();
  try {
    await write(a.project, a.actor);
  } catch (e) {
    if (e instanceof ActivityCodeWriteError) return { error: t(e.code === 'unknownActivity' ? 'Unknown activity' : ACTIVITY_CODE_ERRORS[e.code]) };
    throw e;
  }
  revalidatePath(`/projects/${a.project}`, 'layout');
  return { ok: true };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Adds a code type (`kind` 'site' or 'custom'). */
export async function addCodeTypeAction(code: string, values: Record<string, string>): Promise<CodeActionResult> {
  return run(code, (p, actor) => addActivityCodeType(p, { name: str(values?.name), kind: str(values?.kind) || 'custom' }, actor));
}

export async function removeCodeTypeAction(code: string, typeId: string): Promise<CodeActionResult> {
  if (typeof typeId !== 'string' || !UUID_RE.test(typeId)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, (p, actor) => removeActivityCodeType(p, typeId, actor));
}

export async function addCodeValueAction(code: string, typeId: string, values: Record<string, string>): Promise<CodeActionResult> {
  if (typeof typeId !== 'string' || !UUID_RE.test(typeId)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, (p, actor) => addActivityCodeValue(p, typeId, { code: str(values?.code), label: str(values?.label) }, actor));
}

export async function removeCodeValueAction(code: string, valueId: string): Promise<CodeActionResult> {
  if (typeof valueId !== 'string' || !UUID_RE.test(valueId)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, (p, actor) => removeActivityCodeValue(p, valueId, actor));
}

/** Sets ('' clears) the value of a type on an activity; the equipment type writes the activity's equipment line (R-185). */
export async function setActivityCodeAction(code: string, activity: string, typeKey: string, valueKey: string): Promise<CodeActionResult> {
  const bad = typeof activity !== 'string' || !ACT_RE.test(activity) || typeof typeKey !== 'string' || typeof valueKey !== 'string'
    || !(typeKey === 'equipment' || typeKey === 'purchase_package' || UUID_RE.test(typeKey)) || !(valueKey === '' || UUID_RE.test(valueKey));
  if (bad) return { error: (await getI18n()).t('Invalid request') };
  return run(code, (p, actor) => setActivityCode(p, activity, typeKey, valueKey || null, actor));
}
