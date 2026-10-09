'use server';
// Schedule Server Functions (docs/spec/05 §1.5).
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { revalidatePath } from 'next/cache';
import { createBaselineSnapshot } from '@/server/dal/baselines';
import { listChangeRequestDetails } from '@/server/dal/changes';
import { getProject } from '@/server/dal/projects';
import { getScheduleControl } from '@/server/dal/planning';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { REBASELINE_RESULT, parseRebaseline } from './rebaseline';

/**
 * "Re-baseline" (AF `schedule`): validates the request and the viewer's right to edit the project's schedule, then
 * snapshots the dates and budgets of every activity as a new baseline row BLn (chapter 4, S-3) — *proposed*: it becomes
 * current through its change request (Change control). A change request named in the baseline name or the reason
 * ("BL2 — after CR-006") is linked when it exists on the project. Toast "{name} · Baseline frozen · BL3".
 */
export async function rebaselineSchedule(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const { t } = await getI18n();
  const project = typeof code === 'string' ? await getProject(code) : null;
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'schedule');
  if (!ctx.canEdit('schedule')) return { error: t('You cannot re-baseline this project') };
  const parsed = parseRebaseline(values);
  if (!parsed.ok) return { error: t(parsed.error) };
  if (!(await getScheduleControl(project.code))) return { error: t('No schedule recorded for this project') };
  const { name, reason, approver, scope } = parsed.value;
  const mentioned = [...`${name} ${reason}`.matchAll(/\bCR-\d{3,}\b/g)].map((m) => m[0]);
  const known = new Set((await listChangeRequestDetails(project.code)).map((c) => c.id));
  const cr = mentioned.find((n) => known.has(n)) ?? null;
  const res = await createBaselineSnapshot(project.code, {
    actorName: ctx.viewer.name, name, comment: reason, source: cr ? 'change_request' : 'snapshot', changeRequestNumber: cr,
    approverName: PERSONA_BY_ROLE[approver].name, scope,
  });
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { toast: `${name} · ${t(REBASELINE_RESULT)} · ${res.code}` };
}
