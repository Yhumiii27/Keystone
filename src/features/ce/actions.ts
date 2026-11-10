'use server';
// R-160 (P2, D9-32): CE conformity Server Functions — save the CE file of an equipment line (Commissioning & handover screen), and
// keep the reference checklists (Settings › CE conformity checklists). Each one validates its input, checks the viewer's rights on
// the server (the file: `ceEditScope` from the project context — engineering lead and quality edit it all, a PM of the project
// the declaration and the marking, the director and the others read, a client never; the checklists: the Settings editors),
// writes through the DAL writers (which re-check the workspace and the role, and audit), then revalidates.
import { revalidatePath } from 'next/cache';
import { ceEditScope } from '@/domain/ce-conformity';
import { SETTINGS_DIRECTOR_ONLY, canEditSettings } from '@/domain/settings-rules';
import { addCeChecklistItem, resetCeChecklists, saveCeFile, setCeChecklistItemActive } from '@/server/dal/ce-conformity';
import { getProject } from '@/server/dal/projects';
import { staleRecordResult } from '@/server/dal/record-version';
import { getProjectContext, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type CeActionResult = { ok: true; toast?: string } | { error: string; conflict?: boolean };

const READ_ONLY = 'This CE file is read-only for you';

/** Refusals the writers raise, shown in the viewer's language (anything else: "The change could not be saved"). */
const KNOWN = new Set([
  READ_ONLY, 'Unknown equipment line', 'Invalid request', 'Unknown regime', 'Unknown category', 'Unknown conformity assessment route',
  'Risk assessment is not a Codex reference', 'Instructions is not a Codex reference', 'Declaration is not a Codex reference',
  'Technical file document is not a Codex reference', 'Invalid date', 'Signatory is too long', 'Partly completed machinery has no conformity assessment route',
  'Partly completed machinery bears no CE marking', 'A standard is too long', 'Too many standards', 'Unknown requirement', 'Unknown requirement status',
  'Unknown technical file heading', 'Unknown technical file status', 'Unknown deliverable', 'A heading marked done needs a deliverable or a Codex reference',
  'Unknown list', 'Number is required', 'A number reads "1.1.9"', 'A key reads "lowercase_letters"', 'Title is required', 'Title is too long',
  'This entry is already in the list', 'Unknown entry', SETTINGS_DIRECTOR_ONLY,
]);

async function failure(e: unknown): Promise<CeActionResult> {
  const { t, lang } = await getI18n();
  const stale = staleRecordResult(e, lang);
  if (stale) return stale;
  const msg = e instanceof Error ? e.message : '';
  if (!KNOWN.has(msg)) console.error('ce-conformity', e);
  return { error: t(KNOWN.has(msg) ? msg : 'The change could not be saved') };
}

/** "Save" of a CE file: `values` = the whole file as the form holds it; `token` = the R-010 version the page read. */
export async function saveCeFileAction(code: unknown, ref: unknown, values: unknown, token: unknown): Promise<CeActionResult> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || typeof ref !== 'string' || !/^EQ-\d{2,}$/.test(ref)) return { error: t('Invalid request') };
  if (token != null && typeof token !== 'string') return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'commissioning');
  const scope = ceEditScope(ctx.viewer.role, { lead: ctx.access.lead, canEditScreen: ctx.canEdit('commissioning') });
  if (scope === 'none') return { error: t(READ_ONLY) };
  let result: Awaited<ReturnType<typeof saveCeFile>>;
  try {
    result = await saveCeFile(project.code, ref, { values, token: token ?? null, scope }, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  revalidatePath('/portfolio/projects');
  if (!result.changed) return { ok: true, toast: t('No change to save') };
  const r = result.readiness;
  return { ok: true, toast: `${t(r.complete ? 'CE file saved · complete' : 'CE file saved')} · ${r.done}/${r.total}` };
}

/** The Settings editors (A-14: the portfolio director); the other roles of the workspace read. */
async function settingsEditor(): Promise<{ name: string; role: string } | { error: string }> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('settings')]);
  if (!access.canEdit) return { error: t('Settings are read-only for you') };
  if (!canEditSettings(access.viewer.role)) return { error: t(SETTINGS_DIRECTOR_ONLY) };
  return { name: access.viewer.name, role: access.viewer.role };
}

const refreshSettings = () => {
  revalidatePath('/admin/settings');
  revalidatePath('/projects', 'layout');
  revalidatePath('/portfolio/projects');
};

/** "Add" to a CE checklist: Annex III number (or technical-file key) and short title. */
export async function addCeChecklistItemAction(kind: unknown, code: unknown, title: unknown): Promise<CeActionResult> {
  const actor = await settingsEditor();
  if ('error' in actor) return actor;
  if (typeof kind !== 'string' || typeof code !== 'string' || typeof title !== 'string' || code.length > 60 || title.length > 400) return failure(new Error('Invalid request'));
  try {
    await addCeChecklistItem(kind, code, title, actor);
  } catch (e) {
    return failure(e);
  }
  refreshSettings();
  return { ok: true, toast: (await getI18n()).t('Entry added') };
}

/** "Remove" (deactivate) or "Restore" an entry of a CE checklist. */
export async function setCeChecklistItemActiveAction(kind: unknown, code: unknown, active: unknown): Promise<CeActionResult> {
  const actor = await settingsEditor();
  if ('error' in actor) return actor;
  if (typeof kind !== 'string' || typeof code !== 'string' || typeof active !== 'boolean') return failure(new Error('Invalid request'));
  try {
    await setCeChecklistItemActive(kind, code, active, actor);
  } catch (e) {
    return failure(e);
  }
  refreshSettings();
  return { ok: true, toast: (await getI18n()).t(active ? 'Entry restored' : 'Entry removed') };
}

/** "Reset to defaults" of the CE checklists. */
export async function resetCeChecklistsAction(): Promise<CeActionResult> {
  const actor = await settingsEditor();
  if ('error' in actor) return actor;
  try {
    await resetCeChecklists(actor);
  } catch (e) {
    return failure(e);
  }
  refreshSettings();
  return { ok: true, toast: (await getI18n()).t('CE checklists reset to defaults') };
}
