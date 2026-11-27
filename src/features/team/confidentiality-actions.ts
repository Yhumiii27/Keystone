'use server';
// ING-29 (owner, 27 Nov 2026): the project's confidentiality — normal or confidential — set from Project resources › Project team
// (side panel). Who: the project's leads (PM of record, co-PM, deputy) and the director (`canSetConfidentiality`), on a project
// whose Project resources they may edit (never outside the workspace, never a read-only project); a project the viewer does not
// see is unknown (404 rule). Audited by the DAL; to be published at the end of pub_projets (`confidentialite`).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { PROJECT_CONFIDENTIALITY_LABEL, canSetConfidentiality, isProjectConfidentiality } from '@/domain/confidentiality';
import { setProjectConfidentiality } from '@/server/dal/project-confidentiality';
import { getProject } from '@/server/dal/projects';
import { logError } from '@/server/log';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** "Confidentiality" side panel of the Project team card (field `confidentiality`). */
export async function setProjectConfidentialityAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'presources');
  if (!ctx.canEdit('presources') || !canSetConfidentiality(ctx.viewer.role, ctx.access)) return { error: await tr('Only the project’s leads and the director set the project confidentiality') };
  const value = values && typeof values === 'object' ? values.confidentiality : undefined;
  if (!isProjectConfidentiality(value)) return { error: await tr('Choose the project confidentiality') };
  try {
    await setProjectConfidentiality(project.code, value, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    logError('setProjectConfidentialityAction', e);
    return { error: await tr('The change could not be saved') };
  }
  // Who sees the project changes everywhere (lists, switcher, counters).
  revalidatePath('/', 'layout');
  return { toast: await tr(`Project confidentiality saved · ${PROJECT_CONFIDENTIALITY_LABEL[value]}`) };
}
