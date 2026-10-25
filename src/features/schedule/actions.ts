'use server';
// Schedule Server Functions (docs/spec/05 §1.5).
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { revalidatePath } from 'next/cache';
import { BL1_TICKED, canSnapshotFreely } from '@/domain/baseline-policy';
import { parseCapexMilestoneCode } from '@/domain/capex-milestones';
import { canSetCapexMilestone } from '@/domain/rights';
import { UnknownMilestoneError, setMilestoneCapexCode } from '@/server/dal/capex-milestones';
import { BaselinePolicyError, createBaselineSnapshot, listProjectBaselines } from '@/server/dal/baselines';
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
  const { name, reason, approver, scope, estimateClass } = parsed.value;
  const mentioned = [...`${name} ${reason}`.matchAll(/\bCR-\d{3,}\b/g)].map((m) => m[0]);
  const crs = await listChangeRequestDetails(project.code);
  const known = new Set(crs.map((c) => c.id));
  const cr = mentioned.find((n) => known.has(n)) ?? null;
  const bls = await listProjectBaselines(project.code);
  const free = canSnapshotFreely(bls.map((b) => b.code));
  const open = cr && crs.some((c) => c.id === cr && (c.status === 'draft' || c.status === 'in_review')) ? cr : null;
  const taken = open ? bls.find((b) => b.changeRequest === open && b.state === 'proposed') : undefined;
  if (!free) {
    if (!open) return { error: t('After BL1, a new baseline goes through a change request — name an open change request (CR-…)') };
    if (taken) return { error: `${cr} · ${t('already proposes baseline')} ${taken.code}` };
  }
  // Only an open request that proposes no baseline yet can carry the snapshot (it becomes current at its approval); a closed
  // one named while snapshots are still free is ignored, else the baseline would stay proposed for ever (correctness review).
  const linked = open && !taken ? open : null;
  let res: Awaited<ReturnType<typeof createBaselineSnapshot>>;
  try {
    // Checked again inside the snapshot transaction (R-010): a concurrent BL1 or a concurrent proposal on the same request.
    res = await createBaselineSnapshot(project.code, {
      actorName: ctx.viewer.name, name, comment: reason, source: linked ? 'change_request' : 'snapshot', changeRequestNumber: linked,
      approverName: PERSONA_BY_ROLE[approver].name, scope, makeCurrent: free && !linked, enforcePolicy: true, estimateClass,
    });
  } catch (e) {
    if (!(e instanceof BaselinePolicyError)) throw e;
    if (e.reason === 'already_proposed') return { error: `${linked} · ${t('already proposes baseline')} ${e.baseline}` };
    return { error: t('After BL1, a new baseline goes through a change request — name an open change request (CR-…)') };
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  // R-054 (L-2 "a"): a BL1 made current here ticked « Planning BL1 posé » — said only when the tick changed.
  return { toast: `${name} · ${t(REBASELINE_RESULT)} · ${res.code}${res.bl1Ticked ? ` · ${t(BL1_TICKED)}` : ''}` };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R-189 (Arche K-04): which CAPEX milestone a schedule milestone is (Schedule screen, milestone list) — '' clears. The director
 * and the project's leads (`canSetCapexMilestone`) on a project whose schedule they may edit. A code held by another milestone of
 * the project moves to this one. Audited; pub_jalons_projets then publishes this milestone's BL1 date as `reference_le`.
 */
export async function setCapexMilestoneAction(code: string, milestoneId: string, capexCode: string): Promise<{ ok: true } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || typeof milestoneId !== 'string' || !UUID_RE.test(milestoneId) || typeof capexCode !== 'string') return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'schedule');
  if (!canSetCapexMilestone(ctx.viewer.role, ctx.access) || !ctx.canEdit('schedule')) return { error: t('Only the project’s leads and the director set the CAPEX milestones') };
  const parsed = parseCapexMilestoneCode(capexCode);
  if (!parsed.ok) return { error: t(parsed.error) };
  try {
    await setMilestoneCapexCode(project.code, milestoneId, parsed.value, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    if (e instanceof UnknownMilestoneError) return { error: t('Unknown milestone') };
    return { error: t('The change could not be saved') };
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { ok: true };
}
