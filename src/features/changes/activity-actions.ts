'use server';
// Change request ↔ plan activities Server Functions (Delivery 7, NEW-D2-2 = a, R-062): link activities of the project's
// plan to an open request (Draft / In review), with the new duration it asks for, or remove one. Each checks that the
// viewer may edit the project's Change control (not outside the workspace, not a read-only project) and is not the client
// (the plan is internal; src/domain/change-activities.ts), validates the input, writes through the DAL (audited) and
// revalidates the app (Change control drawer, Plan drawer). Messages are translated for the viewer.
import { revalidatePath } from 'next/cache';
import { canEditCrActivities, isPlanActivityCode, parseNewDuration } from '@/domain/change-activities';
import { CrActivityError, linkCrActivities, unlinkCrActivity } from '@/server/dal/change-activities';
import { getProject } from '@/server/dal/projects';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type CrActivityResult = { ok: true; toast: string } | { error: string };

const CR_RE = /^CR-\d{3,}$/;

async function allowed(code: unknown): Promise<{ ctx: ProjectContext } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || !(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'changes');
  if (!canEditCrActivities(ctx.viewer, ctx.canEdit('changes'))) return { error: t('Only the project team links plan activities to a change request') };
  return { ctx };
}

async function failure(e: unknown): Promise<{ error: string }> {
  const { t } = await getI18n();
  if (e instanceof CrActivityError) {
    const m = /^Unknown activity (.+)$/.exec(e.message);
    return { error: m ? `${t('Unknown activity')} ${m[1]}` : t(e.message) };
  }
  console.error('change request activities', e);
  return { error: t('The change could not be saved') };
}

/** "Add" in the request's "Plan activities": the activity and, optionally, its new duration (working days). */
export async function linkCrActivityAction(code: string, number: string, input: { activity?: unknown; days?: unknown }): Promise<CrActivityResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  if (typeof number !== 'string' || !CR_RE.test(number) || !input || typeof input !== 'object') return { error: t('Invalid request') };
  if (!isPlanActivityCode(input.activity)) return { error: t('Choose an activity of the project plan') };
  const days = parseNewDuration(input.days);
  if (!days.ok) return { error: t(days.error) };
  try {
    await linkCrActivities(r.ctx.project.code, number, [{ code: input.activity, newDurationDays: days.value }], r.ctx.viewer.name);
  } catch (e) {
    return failure(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: `${number} · ${input.activity} · ${t('Activity linked')}` };
}

/** "×" on a linked activity of an open request. */
export async function unlinkCrActivityAction(code: string, number: string, activity: string): Promise<CrActivityResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  if (typeof number !== 'string' || !CR_RE.test(number) || !isPlanActivityCode(activity)) return { error: t('Invalid request') };
  try {
    await unlinkCrActivity(r.ctx.project.code, number, activity, r.ctx.viewer.name);
  } catch (e) {
    return failure(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: `${number} · ${activity} · ${t('Activity removed from the request')}` };
}
