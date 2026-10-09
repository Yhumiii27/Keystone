// Budget › Structure & changes "Add category" / "Edit category" Server Functions (chapter 4, A-14) against an in-memory
// database: permission gate, Settings categories and their cost type, validation, toasts in the viewer's language.
// Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCostControl } from '@/server/dal/cost';
import { addCostCategoryAction, editCostCategoryAction } from './category-actions';
import { addCategoryFormDef, editCategoryFormDef, editCategoryValues, parseCategoryBudget } from './category-forms';

const last = async (code = 'HLT-026') => (await getCostControl(code))!.categories.at(-1)!;

describe('cost category Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('forms: Settings categories, type from the category, budget parsing', () => {
    const add = addCategoryFormDef([{ code: 'labor', label: 'Labor' }, { code: 'permits_fees', label: 'Permits & fees' }]);
    expect(add.fields.map((f) => f.id)).toEqual(['cat', 'type', 'name', 'budget']);
    expect(add.fields[1].options?.[0]).toEqual({ value: 'auto', label: 'From the category' });
    expect(editCategoryFormDef().fields.map((f) => f.id)).toEqual(['name', 'type', 'budget']);
    expect(editCategoryValues({ name: 'Études', costType: 'labor', budget: 160 })).toEqual({ name: 'Études', type: 'labor', budget: '160' });
    expect(['120', '120,5', ' 1 200 ', '', 'abc', '-3'].map((v) => parseCategoryBudget(v))).toEqual([120, 120.5, 1200, null, null, -3]);
  });

  it('refuses read-only viewers, unknown projects and projects without cost data', async () => {
    viewer.canEdit = false;
    expect(await addCostCategoryAction('HLT-026', { cat: 'labor', budget: '10' })).toEqual({ error: 'This budget is read-only for you' });
    expect(await editCostCategoryAction('HLT-026', 'C01', { name: 'x', type: 'labor', budget: '10' })).toEqual({ error: 'This budget is read-only for you' });
    viewer.canEdit = true;
    expect(await addCostCategoryAction('NOPE-000', { cat: 'labor', budget: '10' })).toEqual({ error: 'Unknown project' });
    expect(await addCostCategoryAction('SCP-033', { cat: 'labor', budget: '10' })).toEqual({ error: 'No cost data for this project yet' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('adds a Settings category with its type (or the chosen one) and an optional project name', async () => {
    // Without a project name the category takes its Settings label — HLT-026 already has "Permits & fees".
    expect(await addCostCategoryAction('HLT-026', { cat: 'permits_fees', type: 'auto', name: '', budget: '45' })).toEqual({ error: '"Permits & fees" is already a cost category of this project' });
    const r = await addCostCategoryAction('HLT-026', { cat: 'permits_fees', type: 'auto', name: 'Permis chantier', budget: '45' });
    expect(r).toMatchObject({ toast: expect.stringMatching(/^C\d{2} · Category added$/) });
    expect(await last()).toMatchObject({ name: 'Permis chantier', costType: 'fees', budget: 45, forecast: 45, actual: 0 });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    viewer.lang = 'fr';
    expect(await addCostCategoryAction('HLT-026', { cat: 'permits_fees', type: 'auto', name: 'permis CHANTIER', budget: '1' })).toEqual({ error: '« permis CHANTIER » est déjà une catégorie de coûts de ce projet' });
    expect(await addCostCategoryAction('HLT-026', { cat: 'equipment', type: 'subcontract', name: 'Grue mobile', budget: '12,5' })).toMatchObject({ toast: expect.stringMatching(/ · Catégorie ajoutée$/) });
    expect(await last()).toMatchObject({ name: 'Grue mobile', costType: 'subcontract', budget: 12.5 });
    expect(await addCostCategoryAction('HLT-026', { cat: 'nope', budget: '1' })).toEqual({ error: 'Catégorie inconnue' });
    expect(await addCostCategoryAction('HLT-026', { cat: 'labor', name: 'X', budget: 'abc' })).toEqual({ error: 'Saisissez un budget en k€ (0 ou plus)' });
    expect(await addCostCategoryAction('HLT-026', { cat: 'labor', name: 'X', type: 'gold', budget: '1' })).toEqual({ error: 'Type de coût inconnu' });
  });

  it('edits name, type and budget; validates', async () => {
    const c = await last();
    expect(await editCostCategoryAction('HLT-026', c.code, { name: 'Grue mobile 60 t', type: 'equipment', budget: '20' })).toEqual({ toast: `${c.code} · Category updated` });
    expect(await last()).toMatchObject({ code: c.code, name: 'Grue mobile 60 t', costType: 'equipment', budget: 20, forecast: 20 });
    expect(await editCostCategoryAction('HLT-026', c.code, { name: ' ', type: 'equipment', budget: '20' })).toEqual({ error: 'Category name is required' });
    expect(await editCostCategoryAction('HLT-026', c.code, { name: 'x', type: 'equipment', budget: '-2' })).toEqual({ error: 'Enter a budget in k€ (0 or more)' });
    expect(await editCostCategoryAction('HLT-026', 'C99', { name: 'x', type: 'equipment', budget: '2' })).toEqual({ error: 'Unknown cost category' });
    expect(await editCostCategoryAction('HLT-026', 'DROP TABLE', { name: 'x', type: 'equipment', budget: '2' })).toEqual({ error: 'Unknown cost category' });
  });
});
