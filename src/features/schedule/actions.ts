'use server';
// Schedule Server Functions (docs/spec/05 §1.5).
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { revalidatePath } from 'next/cache';
import { canSnapshotFreely } from '@/domain/baseline-policy';
import { createBaselineSnapshot, listProjectBaselines } from '@/server/dal/baselines';
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
 * S-3 (src/domain/baseline-policy.ts): up to BL1 the snapshot is free; from BL2 on it must name an open change request (draft or
 * in review) — the baseline it proposes becomes current when that request is approved. Otherwise it is refused.
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
  const crs = await listChangeRequestDetails(project.code);
  const known = new Set(crs.map((c) => c.id));
  const cr = mentioned.find((n) => known.has(n)) ?? null;
  const bls = await listProjectBaselines(project.code);
  const free = canSnapshotFreely(bls.map((b) => b.code));
  if (!free) {
    const open = crs.find((c) => c.id === cr && (c.status === 'draft' || c.status === 'in_review'));
    if (!open) return { error: t('After BL1, a new baseline goes through a change request — name an open change request (CR-…)') };
    const taken = bls.find((b) => b.changeRequest === cr && b.state === 'proposed');
    if (taken) return { error: `${cr} · ${t('already proposes baseline')} ${taken.code}` };
  }
  const res = await createBaselineSnapshot(project.code, {
    actorName: ctx.viewer.name, name, comment: reason, source: cr ? 'change_request' : 'snapshot', changeRequestNumber: cr,
    approverName: PERSONA_BY_ROLE[approver].name, scope, makeCurrent: free && !cr,
  });
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { toast: `${name} · ${t(REBASELINE_RESULT)} · ${res.code}` };
}
