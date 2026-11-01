'use server';
// R-196 (Crucible K-3, K-196): the project's category — client project or R&D project — changed on the Contract screen after the
// project's creation. The director and the project's leads (`canSetProjectCategory`), on a project whose Contract they may edit
// (never outside the workspace, never a read-only project, never the client); audited by the DAL; published in pub_projets.
import { revalidatePath } from 'next/cache';
import { canSetProjectCategory, isProjectCategory } from '@/domain/project-category';
import { setProjectCategory } from '@/server/dal/project-category';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { logError } from '@/server/log';

export type CategoryEditResult = { ok: true } | { error: string };

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

export async function setProjectCategoryAction(code: string, category: string): Promise<CategoryEditResult> {
  if (typeof code !== 'string' || !code || typeof category !== 'string') return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'contract');
  if (!canSetProjectCategory(ctx.viewer.role, ctx.access) || !ctx.canEdit('contract')) return { error: await tr('Only the project’s leads and the director set the project category') };
  if (!isProjectCategory(category)) return { error: await tr('Choose the project category') };
  try {
    await setProjectCategory(project.code, category, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    logError('setProjectCategoryAction', e);
    return { error: await tr('The change could not be saved') };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
