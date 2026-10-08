'use server';
// Schedule Server Functions (docs/spec/05 §1.5).
import type { FormDialogResult } from '@/components/app/FormDialog';
import { getProject } from '@/server/dal/projects';
import { getScheduleControl } from '@/server/dal/planning';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { REBASELINE_RESULT, parseRebaseline } from './rebaseline';

/**
 * "Re-baseline" (AF `schedule`): validates the request and the viewer's right to edit the project's schedule,
 * then answers with the prototype toast "{name} · Baseline frozen". Toast-only as in the prototype: no data
 * changes, the current baseline stays BL1.
 * TODO(db): snapshot the dates and budgets of every activity as a new `baselines` row (state `proposed`, linked to
 * its change request, see Change control BASELINES) and revalidate the schedule / changes screens.
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
  return { toast: `${parsed.value.name} · ${t(REBASELINE_RESULT)}` };
}
