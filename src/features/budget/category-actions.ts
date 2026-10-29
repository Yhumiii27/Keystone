'use server';
// Budget › Structure & changes Server Functions (chapter 4, A-14): "Add category" and "Edit category". Each validates the
// raw form values, checks the viewer may edit the project's budget (not outside the workspace, project not read-only),
// writes through src/server/dal/budget-categories.ts with the viewer as the actor (audit + activity), then revalidates
// the project's pages. Messages are translated for the viewer.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { CATEGORY_FROZEN_MESSAGE, categoryAmountFrozen } from '@/domain/baseline-policy';
import { costTypeOfSettingsCategory } from '@/domain/settings-rules';
import { costType } from '@/server/db/codes';
import { listProjectBaselines } from '@/server/dal/baselines';
import { addProjectCostCategory, updateProjectCostCategory } from '@/server/dal/budget-categories';
import { getCostControl } from '@/server/dal/cost';
import { getProject } from '@/server/dal/projects';
import { staleRecordResult } from '@/server/dal/record-version';
import { costCategoryOptions } from '@/server/dal/settings-lists';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { TYPE_FROM_CATEGORY, parseCategoryBudget } from './category-forms';

const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

async function tr(english: string): Promise<string> {
  const { t, lang } = await getI18n();
  const dup = /^"(.+)" is already a cost category of this project$/.exec(english);
  if (dup) return lang === 'fr' ? `« ${dup[1]} » est déjà une catégorie de coûts de ce projet` : english;
  return t(english);
}

const KNOWN = new Set(['Category name is required', 'Category name is too long', 'Enter a budget in k€ (0 or more)', 'Unknown cost type', 'Unknown cost category', CATEGORY_FROZEN_MESSAGE]);
const failure = async (e: unknown) => {
  const msg = e instanceof Error ? e.message : '';
  return { error: await tr(KNOWN.has(msg) || /is already a cost category of this project$/.test(msg) ? msg : 'The change could not be saved') };
};

/**
 * The project exists, has cost data and the viewer may edit its budget. `frozen` (R-081, C-3a): the project has BL1 — a
 * category's amount then changes only through an approved change request (the DAL re-checks it in its transaction).
 */
async function editable(code: unknown): Promise<{ code: string; actor: string; frozen: boolean } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'budget');
  if (!ctx.canEdit('budget')) return { error: await tr('This budget is read-only for you') };
  if (!(await getCostControl(project.code))) return { error: await tr('No cost data for this project yet') };
  const frozen = categoryAmountFrozen((await listProjectBaselines(project.code)).map((b) => b.code));
  return { code: project.code, actor: ctx.viewer.name, frozen };
}

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** "Add category": a Settings cost category, its type (or the category's), an optional project name, the budget (k€). */
export async function addCostCategoryAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code);
  if ('error' in ok) return ok;
  const v = strings(values);
  const options = await costCategoryOptions();
  const cat = options.find((o) => o.code === (v.cat || options[0]?.code));
  if (!cat) return { error: await tr('Unknown category') };
  const typeRaw = v.type || TYPE_FROM_CATEGORY;
  const type = typeRaw === TYPE_FROM_CATEGORY ? costTypeOfSettingsCategory(cat.code) : typeRaw;
  if (!costType.isCode(type)) return { error: await tr('Unknown cost type') };
  // R-081: after BL1 the form has no budget field — the category starts at 0; a budget sent anyway is refused.
  const budget = ok.frozen && !(v.budget ?? '').trim() ? 0 : parseCategoryBudget(v.budget);
  if (budget === null) return { error: await tr('Enter a budget in k€ (0 or more)') };
  if (ok.frozen && budget !== 0) return { error: await tr(CATEGORY_FROZEN_MESSAGE) };
  const name = (v.name ?? '').trim() || cat.label;
  let created: string;
  try {
    created = await addProjectCostCategory(ok.code, { name, type, budgetKeur: budget }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh(ok.code);
  return { toast: `${created} · ${await tr('Category added')}` };
}

/** "Edit category" (row pencil): name, type, budget. */
export async function editCostCategoryAction(code: string, categoryCode: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code);
  if ('error' in ok) return ok;
  if (typeof categoryCode !== 'string' || !/^C\d{1,4}$/.test(categoryCode)) return { error: await tr('Unknown cost category') };
  const v = strings(values);
  if (!costType.isCode(v.type)) return { error: await tr('Unknown cost type') };
  // R-081 (C-3a): a missing budget means "unchanged" (after BL1 the form has none); a change is refused by the DAL once frozen.
  const budget = (v.budget ?? '').trim() ? parseCategoryBudget(v.budget) : undefined;
  if (budget === null || (budget === undefined && !ok.frozen)) return { error: await tr('Enter a budget in k€ (0 or more)') };
  try {
    await updateProjectCostCategory(ok.code, categoryCode, { name: v.name ?? '', type: v.type, ...(budget !== undefined ? { budgetKeur: budget } : {}) }, ok.actor, { version: v.version ?? null });
  } catch (e) {
    const stale = staleRecordResult(e, (await getI18n()).lang);
    if (stale) return stale;
    return failure(e);
  }
  refresh(ok.code);
  return { toast: `${categoryCode} · ${await tr('Category updated')}` };
}
